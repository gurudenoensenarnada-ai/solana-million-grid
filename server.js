/**
 * server.js - PRODUCTION VERSION with Cloudinary backup/restore for sales.json & images.json
 *
 * - Subida de logos LOCAL (sin IPFS) y COPIA opcional en Cloudinary (unsigned preset)
 * - Guardado en images.json cuando SAVE_IMAGES_IN_JSON=true
 * - Backup de sales.json + images.json a backups/ y subida a Cloudinary (resource_type=raw)
 * - Al arrancar, si sales.json/images.json no existen o están vacíos, intenta restaurar desde Cloudinary
 *
 * Mejoras aplicadas:
 * - No exponer keys hardcodeadas; RPC_URL se toma desde env y si no existe se usa clusterApiUrl(CLUSTER) como fallback (advertencia).
 * - Validación de env vars en producción (MERCHANT_WALLET requerido).
 * - Escritura atómica y serializada de sales.json (appendSaleAtomic) para evitar corrupciones por escrituras concurrentes.
 * - Revalidación de disponibilidad de bloques justo antes de persistir la venta.
 * - Tolerancia de pago configurable vía env PAYMENT_TOLERANCE_SOL.
 * - Menos logs que podrían exponer secretos; mensajes indicativos en su lugar.
 * - Retries leves al obtener transacción parseada para lidiar con latencia RPC.
 */

require('dotenv').config();

// APP_CONFIG: parsear una sola env var JSON cuando el host solo permite UNA variable.
// Ejemplo APP_CONFIG: {"RPC_URL":"https://...","SAVE_IMAGES_IN_JSON":true,"CLOUDINARY_CLOUD_NAME":"drubzopvu","CLOUDINARY_UPLOAD_PRESET":"solana_unsigned"}
if (process.env.APP_CONFIG) {
  try {
    const cfg = JSON.parse(process.env.APP_CONFIG);
    if (cfg.RPC_URL) process.env.RPC_URL = cfg.RPC_URL;
    if (cfg.SAVE_IMAGES_IN_JSON !== undefined) process.env.SAVE_IMAGES_IN_JSON = String(cfg.SAVE_IMAGES_IN_JSON);
    if (cfg.PERSISTENT_UPLOADS_DIR) process.env.PERSISTENT_UPLOADS_DIR = cfg.PERSISTENT_UPLOADS_DIR;
    if (cfg.REMOVE_LOCAL_AFTER_UPLOAD !== undefined) process.env.REMOVE_LOCAL_AFTER_UPLOAD = String(cfg.REMOVE_LOCAL_AFTER_UPLOAD);
    // Mapear Cloudinary también desde APP_CONFIG
    if (cfg.CLOUDINARY_CLOUD_NAME) process.env.CLOUDINARY_CLOUD_NAME = cfg.CLOUDINARY_CLOUD_NAME;
    if (cfg.CLOUDINARY_UPLOAD_PRESET) process.env.CLOUDINARY_UPLOAD_PRESET = cfg.CLOUDINARY_UPLOAD_PRESET;
    // Añadir API key/secret desde APP_CONFIG (si vienen incluidos)
    if (cfg.CLOUDINARY_API_KEY) process.env.CLOUDINARY_API_KEY = String(cfg.CLOUDINARY_API_KEY);
    if (cfg.CLOUDINARY_API_SECRET) process.env.CLOUDINARY_API_SECRET = String(cfg.CLOUDINARY_API_SECRET);
    // Opcional: RESTORE secret para proteger restore endpoint
    if (cfg.RESTORE_SECRET !== undefined) process.env.RESTORE_SECRET = String(cfg.RESTORE_SECRET);
    if (cfg.REMOVE_LOCAL_AFTER_UPLOAD !== undefined) process.env.REMOVE_LOCAL_AFTER_UPLOAD = String(cfg.REMOVE_LOCAL_AFTER_UPLOAD);
  } catch (e) {
    console.warn('APP_CONFIG no es JSON válido:', e.message || e);
  }
}

const express = require('express');
const path = require('path');
const fs = require('fs');
const { promises: fsp } = require('fs');
const multer = require('multer');
const solanaWeb3 = require('@solana/web3.js');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');

// nuevo helper para restauración más robusta desde Cloudinary (Admin API fallback)
const { restoreImagesFromCloudinary } = require('./cloudinary-helpers');

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(cors());

// ============================================
// CONFIGURACIÓN (usar .env en producción)
// ============================================
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const BASE_URL = process.env.BASE_URL || ''; // Para URLs completas

const DEFAULT_MERCHANT = (process.env.MERCHANT_WALLET || '3d7w4r4irLaKVYd4dLjpoiehJVawbbXWFWb1bCk9nGCo').trim();
const CLUSTER = process.env.CLUSTER || 'mainnet-beta';

// Antes: no hardcodear keys públicas en repo
const RPC_URL = (process.env.RPC_URL || '').trim();
if (!RPC_URL) {
  console.warn('⚠️ RPC_URL no configurada — usando clusterApiUrl(CLUSTER) como fallback para evitar fallo. Configura RPC_URL en .env para producción.');
}
const rpcToUse = RPC_URL || solanaWeb3.clusterApiUrl(CLUSTER);

const PAYMENT_TOLERANCE_SOL = parseFloat(process.env.PAYMENT_TOLERANCE_SOL || '0.00001');

// Validaciones mínimas al arranque
if (NODE_ENV === 'production') {
  const missing = [];
  if (!process.env.MERCHANT_WALLET) missing.push('MERCHANT_WALLET');
  if (!process.env.RPC_URL) missing.push('RPC_URL');
  if (missing.length) {
    console.error(`❌ Faltan variables de entorno en producción: ${missing.join(', ')}`);
    // No hacemos process.exit automáticamente si quieres permitir deploys con variables ausentes;
    // aquí preferimos forzar la salida para evitar operar con defaults inseguros.
    process.exit(1);
  }
}

// Cloudinary unsigned config (defaults to your values)
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || '';
// API key/secret (para Admin API fallback)
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '';
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
// API endpoints for raw uploads
const CLOUDINARY_RAW_API_URL = CLOUDINARY_CLOUD_NAME ? `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload` : null;
const CLOUDINARY_RAW_DELIVER_BASE = CLOUDINARY_CLOUD_NAME ? `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/raw/upload` : null;

const SALES_FILE = path.resolve(__dirname, 'sales.json');
// IMAGES_FILE ahora usa PERSISTENT_UPLOADS_DIR si está configurado (evita pérdida de images.json en redeploy)
const IMAGES_FILE = process.env.PERSISTENT_UPLOADS_DIR
  ? path.resolve(process.env.PERSISTENT_UPLOADS_DIR, 'images.json')
  : path.resolve(__dirname, 'images.json');

// UPLOADS_DIR: use persistent directory if provided via env, otherwise fall back to local uploads/.
const UPLOADS_DIR = process.env.PERSISTENT_UPLOADS_DIR
  ? path.resolve(process.env.PERSISTENT_UPLOADS_DIR)
  : path.resolve(__dirname, 'uploads');

const BACKUPS_DIR = path.resolve(__dirname, 'backups');
const LAMPORTS_PER_SOL = solanaWeb3.LAMPORTS_PER_SOL || 1000000000;

// MEMO_PROGRAM: usar string para evitar instanciar PublicKey en startup
const DEFAULT_MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLmfcHr';
const MEMO_PROGRAM_ID_STR = (process.env.MEMO_PROGRAM_ID || DEFAULT_MEMO_PROGRAM).toString().trim();
console.log('   MEMO_PROGRAM_ID used value:', MEMO_PROGRAM_ID_STR);

// Inicializar conexión a RPC (usada por /api/verify-purchase)
const connection = new solanaWeb3.Connection(rpcToUse, { commitment: 'confirmed' });
console.log('   RPC configured:', RPC_URL ? '[CUSTOM RPC]' : `[${CLUSTER} clusterApiUrl]`);

// Crear directorios necesarios (UPLOADS_DIR ahora puede ser persistente)
[UPLOADS_DIR, BACKUPS_DIR].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`   Directorio creado: ${dir}`);
    } else {
      console.log(`   Directorio existe: ${dir}`);
    }
  } catch (err) {
    console.error(`❌ No se pudo crear o acceder al directorio ${dir}:`, err);
    throw err;
  }
});

// ============================================
// UTIL: Cloudinary upload/download para backups (resource_type=raw)
// ============================================

async function uploadFileToCloudinary(filePath, publicId) {
  if (!CLOUDINARY_RAW_API_URL || !CLOUDINARY_UPLOAD_PRESET) {
    console.log('   Cloudinary no configurado para subir backups.');
    return null;
  }
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    form.append('resource_type', 'raw');
    if (publicId) form.append('public_id', publicId);

    const resp = await axios.post(CLOUDINARY_RAW_API_URL, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 120000
    });

    console.log(`   ✅ Backup subido a Cloudinary: ${resp.data?.secure_url ? '[secure_url]' : '[ok]'}`);
    return resp.data;
  } catch (err) {
    console.warn('   ⚠️ Error subiendo backup a Cloudinary:', err.message || err.toString());
    return null;
  }
}

async function uploadDataUrlToCloudinary(dataUrl, publicName) {
  if (!CLOUDINARY_CLOUD_NAME || (!CLOUDINARY_UPLOAD_PRESET && !(CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET))) {
    console.log('   Cloudinary no configurado para uploadDataUrlToCloudinary.');
    return null;
  }
  const m = String(dataUrl || '').match(/^data:(.+);base64,(.+)$/);
  if (!m) {
    console.warn('   uploadDataUrlToCloudinary: dataUrl inválida');
    return null;
  }
  const contentType = m[1];
  const b64 = m[2];
  const buffer = Buffer.from(b64, 'base64');

  try {
    const form = new FormData();
    form.append('file', buffer, { filename: publicName, contentType });
    if (CLOUDINARY_UPLOAD_PRESET) form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

    const resp = await axios.post(url, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 120000
    });

    console.log(`   ✅ Imagen (dataUrl) subida a Cloudinary: [secure_url]`);
    return resp.data;
  } catch (err) {
    console.warn('   ⚠️ Error subiendo dataUrl a Cloudinary:', err.message || err.toString());
    return null;
  }
}

// --- AUTO BACKUP: subir backups a Cloudinary cada vez que se añade una venta ----
let isUploadingBackups = false;
let pendingBackupTimeout = null;
const BACKUP_UPLOAD_DEBOUNCE_MS = 2000; // agrupar cambios en ventana de 2s

async function performBackupUpload() {
  if (!CLOUDINARY_RAW_API_URL || !CLOUDINARY_UPLOAD_PRESET) {
    console.log('   Cloudinary no configurado para backup upload.');
    return;
  }

  if (isUploadingBackups) {
    console.log('   Upload de backup ya en curso, saltando.');
    return;
  }
  isUploadingBackups = true;

  try {
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const salesBackupPath = path.join(BACKUPS_DIR, `sales_${timestamp}.json`);
    fs.copyFileSync(SALES_FILE, salesBackupPath);

    let salesResp = null;
    try {
      salesResp = await uploadFileToCloudinary(salesBackupPath, 'solana_sales_backup');
    } catch (e) {
      console.warn('   ⚠️ Error subiendo sales backup (async):', e.message || e);
    }

    let imagesResp = null;
    if (fs.existsSync(IMAGES_FILE)) {
      const imagesBackupPath = path.join(BACKUPS_DIR, `images_${timestamp}.json`);
      try {
        fs.copyFileSync(IMAGES_FILE, imagesBackupPath);
        imagesResp = await uploadFileToCloudinary(imagesBackupPath, 'solana_images_backup');
      } catch (e) {
        console.warn('   ⚠️ Error subiendo images backup (async):', e.message || e);
      }
    } else {
      console.log('   No existe images.json, no se sube images backup.');
    }

    console.log('   Resultado upload backups:', {
      sales: salesResp ? 'uploaded' : 'not_uploaded',
      images: imagesResp ? 'uploaded' : 'not_uploaded'
    });
  } catch (err) {
    console.warn('   ⚠️ Error creando/subiendo backups:', err.message || err);
  } finally {
    isUploadingBackups = false;
  }
}

function scheduleBackupUpload() {
  if (pendingBackupTimeout) clearTimeout(pendingBackupTimeout);
  pendingBackupTimeout = setTimeout(() => {
    pendingBackupTimeout = null;
    performBackupUpload().catch(e => console.warn('   ⚠️ performBackupUpload fallo:', e));
  }, BACKUP_UPLOAD_DEBOUNCE_MS);
}

// ============================================
// Crear sales.json e images.json si no existen (pero intentar restaurar desde Cloudinary primero)
// ============================================
async function ensureJsonFiles() {
  try {
    let needSales = false;
    if (!fs.existsSync(SALES_FILE)) needSales = true;
    else {
      const stat = fs.statSync(SALES_FILE);
      if (stat.size < 5) needSales = true;
    }

    if (needSales && CLOUDINARY_CLOUD_NAME) {
      console.log('   Intentando restaurar sales.json desde Cloudinary...');
      try {
        const resSales = await restoreImagesFromCloudinary(
          'solana_sales_backup',
          SALES_FILE,
          CLOUDINARY_CLOUD_NAME,
          CLOUDINARY_API_KEY,
          CLOUDINARY_API_SECRET
        );
        if (resSales.ok) {
          console.log(`   ✅ sales.json restaurado desde Cloudinary`);
        } else {
          console.warn('   ⚠️ No se pudo restaurar sales.json desde Cloudinary:', resSales.error);
          fs.writeFileSync(SALES_FILE, JSON.stringify({ sales: [] }, null, 2));
        }
      } catch (err) {
        console.warn('   ⚠️ Error intentando restaurar sales.json (helper):', err?.message || err);
        fs.writeFileSync(SALES_FILE, JSON.stringify({ sales: [] }, null, 2));
      }
    } else if (!fs.existsSync(SALES_FILE)) {
      fs.writeFileSync(SALES_FILE, JSON.stringify({ sales: [] }, null, 2));
    }

    let needImages = false;
    if (!fs.existsSync(IMAGES_FILE)) needImages = true;
    else {
      const stat2 = fs.statSync(IMAGES_FILE);
      if (stat2.size < 5) needImages = true;
    }

    if (needImages && CLOUDINARY_CLOUD_NAME) {
      console.log('   Intentando restaurar images.json desde Cloudinary...');
      try {
        const resImages = await restoreImagesFromCloudinary(
          'solana_images_backup',
          IMAGES_FILE,
          CLOUDINARY_CLOUD_NAME,
          CLOUDINARY_API_KEY,
          CLOUDINARY_API_SECRET
        );
        if (resImages.ok) {
          console.log(`   ✅ images.json restaurado desde Cloudinary`);
        } else {
          console.warn('   ⚠️ No se pudo restaurar images.json desde Cloudinary:', resImages.error);
          fs.writeFileSync(IMAGES_FILE, JSON.stringify({ images: {} }, null, 2));
        }
      } catch (err) {
        console.warn('   ⚠️ Error intentando restaurar images.json (helper):', err?.message || err);
        fs.writeFileSync(IMAGES_FILE, JSON.stringify({ images: {} }, null, 2));
      }
    } else if (!fs.existsSync(IMAGES_FILE)) {
      try {
        const dir = path.dirname(IMAGES_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      } catch (e) { /* ignore */ }
      fs.writeFileSync(IMAGES_FILE, JSON.stringify({ images: {} }, null, 2));
    }
  } catch (e) {
    console.error('❌ Error en ensureJsonFiles:', e);
    if (!fs.existsSync(SALES_FILE)) fs.writeFileSync(SALES_FILE, JSON.stringify({ sales: [] }, null, 2));
    if (!fs.existsSync(IMAGES_FILE)) fs.writeFileSync(IMAGES_FILE, JSON.stringify({ images: {} }, null, 2));
  }
}

(async () => {
  await ensureJsonFiles();
})();

// ============================================
// FUNCIONES DE BASE DE DATOS (lectura/escritura)
// ============================================
function readSales() {
  try {
    const data = fs.readFileSync(SALES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('❌ Error leyendo sales.json:', err.message || err);
    return { sales: [] };
  }
}

// images.json helpers
function readImages() {
  try {
    const data = fs.readFileSync(IMAGES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('❌ Error leyendo images.json:', err.message || err);
    return { images: {} };
  }
}

function writeImages(imgs) {
  try {
    fs.writeFileSync(IMAGES_FILE, JSON.stringify(imgs, null, 2));
  } catch (err) {
    console.error('❌ Error guardando images.json:', err.message || err);
    throw err;
  }
}

const SAVE_IMAGES_IN_JSON = process.env.SAVE_IMAGES_IN_JSON === 'true';

// ============================================
// APPEND SALE ATÓMICO (serializado en este proceso)
// ============================================
let _appendLock = Promise.resolve();

async function appendSaleAtomic(newSale) {
  // Serialize append operations within this Node process to avoid interleaved writes.
  _appendLock = _appendLock.then(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        let current = { sales: [] };
        try {
          const txt = await fsp.readFile(SALES_FILE, 'utf8');
          current = JSON.parse(txt || '{"sales":[]}');
        } catch (e) {
          current = { sales: [] };
        }

        // Push new sale
        current.sales.push(newSale);

        // Atomic write: write tmp then rename
        const tmpPath = SALES_FILE + '.tmp';
        await fsp.writeFile(tmpPath, JSON.stringify(current, null, 2), 'utf8');
        await fsp.rename(tmpPath, SALES_FILE);

        // Programar upload de backup (no bloqueante)
        try {
          scheduleBackupUpload();
        } catch (e) {
          console.warn('⚠️ No se pudo programar upload de backup:', e.message || e);
        }

        console.log(`✅ Venta guardada (atomic): ${newSale.metadata?.name || '(sin nombre)'}`);
        return;
      } catch (err) {
        console.warn('appendSaleAtomic: intento', attempt + 1, 'falló:', err.message || err);
        await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
      }
    }
    throw new Error('No se pudo guardar la venta después de varios intentos');
  });

  return _appendLock;
}

// ============================================
// Descargar archivo desde Cloudinary (fallback)
// ============================================
async function downloadFileFromCloudinary(publicId, destPath) {
  if (!CLOUDINARY_RAW_DELIVER_BASE) {
    console.log('   Cloudinary no configurado para descarga.');
    return false;
  }
  const url = `${CLOUDINARY_RAW_DELIVER_BASE}/${encodeURIComponent(publicId)}`;
  try {
    const resp = await axios.get(url, { responseType: 'stream', timeout: 120000 });
    const writer = fs.createWriteStream(destPath);
    resp.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    console.log(`   ✅ Backup descargado desde Cloudinary: ${url} -> ${destPath}`);
    return true;
  } catch (err) {
    console.warn(`   ⚠️ No se pudo descargar ${url}:`, err.message || err.toString());
    return false;
  }
}

// ============================================
// BACKUP AUTOMÁTICO (se mantiene backupSales, schedule definido arriba)
// ============================================
function backupSales() {
  try {
    let salesDb = { sales: [] };
    try {
      salesDb = readSales();
    } catch (e) {
      console.warn('   ⚠️ No se pudo leer sales.json al crear backup:', e.message || e);
    }

    const hasSales = Array.isArray(salesDb.sales) && salesDb.sales.length > 0;

    let hasImages = false;
    try {
      if (fs.existsSync(IMAGES_FILE)) {
        const imgs = readImages();
        hasImages = imgs && imgs.images && Object.keys(imgs.images).length > 0;
      }
    } catch (e) {
      console.warn('   ⚠️ No se pudo leer images.json al crear backup:', e.message || e);
    }

    if (!hasSales && !hasImages) {
      console.log('   ⚠️ No hay ventas ni imágenes. Se omite la creación/subida del backup en este momento.');
      return;
    }

    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const backupPath = path.join(BACKUPS_DIR, `sales_${timestamp}.json`);
    fs.copyFileSync(SALES_FILE, backupPath);
    console.log(`📦 Backup creado: sales_${timestamp}.json`);

    if (fs.existsSync(IMAGES_FILE) && hasImages) {
      const imgBackupPath = path.join(BACKUPS_DIR, `images_${timestamp}.json`);
      try {
        fs.copyFileSync(IMAGES_FILE, imgBackupPath);
        console.log(`📦 Backup creado: images_${timestamp}.json`);
      } catch (e) {
        console.warn('⚠️ No se pudo crear backup de images.json:', e.message || e);
      }
    }

    const backups = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith('sales_') || f.startsWith('images_'))
      .sort()
      .reverse();

    if (backups.length > 20) {
      backups.slice(20).forEach(file => {
        fs.unlinkSync(path.join(BACKUPS_DIR, file));
      });
    }

    (async () => {
      try {
        await uploadFileToCloudinary(backupPath, 'solana_sales_backup');
        const imgBackupName = fs.readdirSync(BACKUPS_DIR).find(f => f.startsWith(`images_${timestamp}`));
        if (imgBackupName) {
          const imgBackupFull = path.join(BACKUPS_DIR, imgBackupName);
          await uploadFileToCloudinary(imgBackupFull, 'solana_images_backup');
        }
      } catch (e) {
        console.warn('⚠️ Error en subida de backups a Cloudinary (async):', e.message || e);
      }
    })();

  } catch (err) {
    console.error('❌ Error creando backup:', err.message || err);
  }
}

setInterval(backupSales, 60 * 60 * 1000);

// ============================================
// MULTER PARA SUBIDA DE ARCHIVOS
// ============================================
const diskUpload = multer({
  dest: UPLOADS_DIR,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB máximo
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo imágenes.'));
    }
  }
});

// ============================================
// API: SUBIR LOGO -> guarda copia local, opcional dataURL en images.json, opcional upload a Cloudinary
// ============================================
app.post('/api/upload-logo', diskUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se recibió ningún archivo' });
    }

    const originalName = req.file.originalname;
    const tmpPath = req.file.path;

    const timestamp = Date.now();
    const safeName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const finalName = `${timestamp}_${safeName}`;
    const targetPath = path.join(UPLOADS_DIR, finalName);

    fs.renameSync(tmpPath, targetPath);

    let dataUrl = null;
    try {
      const buffer = fs.readFileSync(targetPath);
      dataUrl = `data:${req.file.mimetype};base64,${buffer.toString('base64')}`;
    } catch (err) {
      console.warn('⚠️ No se pudo crear dataURL de la imagen:', err.message || err);
    }

    if (SAVE_IMAGES_IN_JSON && dataUrl) {
      try {
        const imgs = readImages();
        imgs.images[finalName] = {
          dataUrl,
          mimetype: req.file.mimetype,
          size: req.file.size,
          uploadedAt: new Date().toISOString()
        };
        writeImages(imgs);
        console.log(`   ✅ Imagen guardada en images.json: ${finalName}`);
      } catch (err) {
        console.warn('   ⚠️ Error guardando imagen en images.json:', err.message || err);
      }
    }

    // Indicar solamente si Cloudinary está configurado, sin loggear claves
    const cloudConfigured = Boolean(
      (CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET) ||
      (CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET)
    );

    if (!cloudConfigured) {
      console.log('   Cloudinary no configurado, devolviendo URL local.');
      const localUrl = BASE_URL
        ? `${BASE_URL}/uploads/${encodeURIComponent(finalName)}`
        : `${req.protocol}://${req.get('host')}/uploads/${encodeURIComponent(finalName)}`;
      return res.json({
        ok: true,
        url: localUrl,
        name: finalName,
        dataUrl
      });
    }

    const fileStream = fs.createReadStream(targetPath);
    const form = new FormData();
    form.append('file', fileStream);
    if (CLOUDINARY_UPLOAD_PRESET) form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

    const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

    console.log(`📤 Subiendo ${finalName} a Cloudinary...`);
    try {
      const resp = await axios.post(uploadUrl, form, {
        headers: form.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 300000
      });
      const cloudResp = resp.data;
      console.log('   ✅ Subida a Cloudinary OK');

      if (process.env.REMOVE_LOCAL_AFTER_UPLOAD === 'true') {
        try {
          fs.unlinkSync(targetPath);
          console.log('   🗑️ Copia local eliminada:', targetPath);
        } catch (unlinkErr) {
          console.warn('   ⚠️ No se pudo eliminar copia local:', unlinkErr.message || unlinkErr);
        }
      }

      if (SAVE_IMAGES_IN_JSON && dataUrl) {
        try {
          const uploadResult = await uploadDataUrlToCloudinary(dataUrl, finalName);
          if (uploadResult && uploadResult.secure_url) {
            try {
              const imgs = readImages();
              if (imgs.images && imgs.images[finalName]) {
                imgs.images[finalName].cloudUrl = uploadResult.secure_url;
                delete imgs.images[finalName].dataUrl;
                writeImages(imgs);
                console.log(`   ✅ images.json actualizado con cloudUrl para ${finalName}`);
              }
            } catch (e) {
              console.warn('   ⚠️ No se pudo actualizar images.json con cloudUrl:', e.message || e);
            }
          }
        } catch (e) {
          console.warn('   ⚠️ Falló uploadDataUrlToCloudinary:', e.message || e);
        }
      }

      return res.json({
        ok: true,
        url: cloudResp.secure_url,
        public_id: cloudResp.public_id,
        version: cloudResp.version,
        name: finalName,
        dataUrl
      });
    } catch (err) {
      console.error('❌ Error subiendo a Cloudinary:', err.message || err.toString());

      if (dataUrl) {
        try {
          const uploadResult = await uploadDataUrlToCloudinary(dataUrl, finalName);
          if (uploadResult && uploadResult.secure_url) {
            if (process.env.REMOVE_LOCAL_AFTER_UPLOAD === 'true') {
              try { fs.unlinkSync(targetPath); } catch(e) { /* ignore */ }
            }
            if (SAVE_IMAGES_IN_JSON && uploadResult.secure_url) {
              try {
                const imgs = readImages();
                if (imgs.images && imgs.images[finalName]) {
                  imgs.images[finalName].cloudUrl = uploadResult.secure_url;
                  delete imgs.images[finalName].dataUrl;
                  writeImages(imgs);
                  console.log(`   ✅ images.json actualizado con cloudUrl (fallback) para ${finalName}`);
                }
              } catch (e) {
                console.warn('   ⚠️ No se pudo actualizar images.json con cloudUrl (fallback):', e.message || e);
              }
            }
            return res.json({
              ok: true,
              url: uploadResult.secure_url,
              public_id: uploadResult.public_id,
              version: uploadResult.version,
              name: finalName
            });
          }
        } catch (e) {
          console.warn('   ⚠️ Fallback uploadDataUrl también falló:', e.message || e);
        }
      }

      const localUrl = BASE_URL
        ? `${BASE_URL}/uploads/${encodeURIComponent(finalName)}`
        : `${req.protocol}://${req.get('host')}/uploads/${encodeURIComponent(finalName)}`;

      return res.status(502).json({
        ok: false,
        error: 'La subida a Cloudinary falló. Archivo guardado en local como respaldo.',
        localUrl,
        dataUrl,
        details: err.message
      });
    }

  } catch (err) {
    console.error('❌ Error guardando archivo:', err.message || err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Error al subir el archivo'
    });
  }
});

// Endpoint para obtener dataURL o servir archivo local
app.get('/api/image/:name', (req, res) => {
  try {
    const name = req.params.name;
    const imgs = readImages();
    const entry = imgs.images && imgs.images[name];
    if (entry && entry.dataUrl) {
      return res.json({ ok: true, name, dataUrl: entry.dataUrl, mimetype: entry.mimetype, size: entry.size });
    }
    if (entry && entry.cloudUrl) {
      return res.json({ ok: true, name, url: entry.cloudUrl, mimetype: entry.mimetype, size: entry.size });
    }

    const localPath = path.join(UPLOADS_DIR, name);
    if (fs.existsSync(localPath)) {
      return res.sendFile(localPath);
    }

    return res.status(404).json({ ok: false, error: 'Imagen no encontrada' });
  } catch (err) {
    console.error('❌ Error en /api/image/:', err.message || err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// Nuevo endpoint: listar images.json (solo metadata) para debugging
app.get('/api/images-list', (req, res) => {
  try {
    const imgs = readImages();
    const list = Object.entries(imgs.images || {}).map(([name, meta]) => ({
      name,
      mimetype: meta.mimetype,
      size: meta.size,
      uploadedAt: meta.uploadedAt,
      cloudUrl: meta.cloudUrl ? meta.cloudUrl : undefined
    }));
    return res.json({ ok: true, count: list.length, images: list });
  } catch (err) {
    console.error('❌ Error en /api/images-list:', err.message || err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// Endpoints para backups: listar y restaurar images.json desde backups
app.get('/api/backups-list', (req, res) => {
  try {
    const files = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith('sales_') || f.startsWith('images_'))
      .sort()
      .reverse();
    return res.json({ ok: true, files });
  } catch (err) {
    console.error('❌ Error listando backups:', err.message || err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// Restaurar images.json desde backups (protegido si RESTORE_SECRET está definido)
app.post('/api/restore-images', express.json(), (req, res) => {
  try {
    const backup = req.body?.backup;
    if (!backup) return res.status(400).json({ ok: false, error: 'Falta parámetro backup' });

    const RESTORE_SECRET = process.env.RESTORE_SECRET || '';
    if (RESTORE_SECRET) {
      const secret = req.headers['x-restore-secret'] || req.body?.secret;
      if (!secret || secret !== RESTORE_SECRET) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
    }

    const src = path.join(BACKUPS_DIR, backup);
    if (!fs.existsSync(src)) return res.status(404).json({ ok: false, error: 'Backup no encontrado' });

    fs.copyFileSync(src, IMAGES_FILE);
    console.log(`✅ images.json restaurado desde ${backup}`);
    return res.json({ ok: true, message: 'images.json restaurado', backup });
  } catch (err) {
    console.error('❌ Error restaurando images.json:', err.message || err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// Restaurar sales.json desde backups (protegido si RESTORE_SECRET está definido)
app.post('/api/restore-sales', express.json(), (req, res) => {
  try {
    const backup = req.body?.backup;
    if (!backup) return res.status(400).json({ ok: false, error: 'Falta parámetro backup' });

    const RESTORE_SECRET = process.env.RESTORE_SECRET || '';
    if (RESTORE_SECRET) {
      const secret = req.headers['x-restore-secret'] || req.body?.secret;
      if (!secret || secret !== RESTORE_SECRET) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
    }

    const src = path.join(BACKUPS_DIR, backup);
    if (!fs.existsSync(src)) return res.status(404).json({ ok: false, error: 'Backup no encontrado' });

    fs.copyFileSync(src, SALES_FILE);
    console.log(`✅ sales.json restaurado desde ${backup}`);
    return res.json({ ok: true, message: 'sales.json restaurado', backup });
  } catch (err) {
    console.error('❌ Error restaurando sales.json:', err.message || err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// ============================================
// NUEVO ENDPOINT: Forzar restauración desde Cloudinary (protegido por RESTORE_SECRET si se configura)
// ============================================
app.post('/api/restore-from-cloudinary', express.json(), async (req, res) => {
  try {
    const RESTORE_SECRET = process.env.RESTORE_SECRET || '';
    if (RESTORE_SECRET) {
      const secret = req.headers['x-restore-secret'] || req.body?.secret;
      if (!secret || secret !== RESTORE_SECRET) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
    }

    if (!CLOUDINARY_CLOUD_NAME) {
      return res.status(400).json({ ok: false, error: 'CLOUDINARY_CLOUD_NAME no configurado' });
    }

    const cloudName = CLOUDINARY_CLOUD_NAME;
    const apiKey = CLOUDINARY_API_KEY;
    const apiSecret = CLOUDINARY_API_SECRET;

    const salesRes = await restoreImagesFromCloudinary('solana_sales_backup', SALES_FILE, cloudName, apiKey, apiSecret);
    const imagesRes = await restoreImagesFromCloudinary('solana_images_backup', IMAGES_FILE, cloudName, apiKey, apiSecret);

    const result = { sales: salesRes, images: imagesRes };
    if (!salesRes.ok && !imagesRes.ok) {
      return res.status(500).json({ ok: false, result });
    }

    return res.json({ ok: true, result });
  } catch (err) {
    console.error('❌ Error en /api/restore-from-cloudinary:', err.message || err);
    return res.status(500).json({ ok: false, error: err.message || 'Error interno' });
  }
});

// ============================================
// PARSEAR MEMO (usa string MEMO_PROGRAM_ID_STR)
// ============================================
function parseMemoFromParsedTx(tx) {
  try {
    const instructions = tx.transaction.message.instructions;

    for (const ix of instructions) {
      if (ix.programId && ix.programId.toString() === MEMO_PROGRAM_ID_STR) {
        try {
          if (ix.data) {
            const buffer = Buffer.from(ix.data, 'base64');
            const txt = buffer.toString('utf8');
            try {
              return { raw: txt, json: JSON.parse(txt) };
            } catch {
              return { raw: txt, json: null };
            }
          }
        } catch (err) {
          console.warn('⚠️ No se pudo decodificar el memo:', err.message);
        }
      }
    }
  } catch (err) {
    console.error('❌ Error parseando memo:', err.message || err);
  }
  return null;
}

// ============================================
// VALIDAR QUE BLOQUES NO ESTÉN OCUPADOS
// ============================================
function areBlocksAvailable(selection) {
  const sales = readSales();

  for (const sale of sales.sales) {
    const s = sale.metadata?.selection;
    if (!s) continue;

    const noOverlap = (
      selection.minBlockX + selection.blocksX <= s.minBlockX ||
      selection.minBlockX >= s.minBlockX + s.blocksX ||
      selection.minBlockY + selection.blocksY <= s.minBlockY ||
      selection.minBlockY >= s.minBlockY + s.blocksY
    );

    if (!noOverlap) {
      return false;
    }
  }

  return true;
}

// Helper: retry getParsedTransaction a few veces (RPC puede tardar)
async function getParsedTransactionWithRetry(signature, attempts = 3, delayMs = 1500) {
  for (let i = 0; i < attempts; i++) {
    try {
      const tx = await connection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });
      if (tx) return tx;
    } catch (err) {
      // continue to retry
      console.warn(`getParsedTransaction attempt ${i + 1} failed:`, err.message || err);
    }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  return null;
}

// ============================================
// API: VERIFICAR COMPRA
// ============================================
app.post('/api/verify-purchase', async (req, res) => {
  const { signature, expectedAmountSOL, metadata } = req.body || {};

  console.log(`\n🔍 Verificando compra:`);
  console.log(`   Proyecto: ${metadata?.name}`);
  console.log(`   Monto esperado: ${expectedAmountSOL} SOL`);

  if (!signature || expectedAmountSOL === undefined || !metadata) {
    return res.status(400).json({
      ok: false,
      error: 'Faltan parámetros requeridos'
    });
  }

  if (metadata.selection && !areBlocksAvailable(metadata.selection)) {
    console.log(`❌ Bloques ya ocupados (pre-check)`);
    return res.status(400).json({
      ok: false,
      error: 'Los bloques seleccionados ya están ocupados. Refresca la página.'
    });
  }

  try {
    console.log('   ⏳ Obteniendo transacción parseada (con retries)...');

    const tx = await getParsedTransactionWithRetry(signature, 4, 2000);

    if (!tx || !tx.meta) {
      console.log(`❌ Transacción no encontrada`);
      return res.status(404).json({
        ok: false,
        error: 'Transacción no encontrada o aún no confirmada. Espera unos segundos.'
      });
    }

    console.log(`   ✅ Transacción encontrada`);
    console.log(`   🔗 Explorer: https://solscan.io/tx/${signature}?cluster=${CLUSTER}`);

    if (tx.meta.err) {
      console.log(`❌ Transacción falló en la blockchain`);
      return res.status(400).json({
        ok: false,
        error: 'La transacción falló en la blockchain'
      });
    }

    const instructions = tx.transaction.message.instructions;
    let transferFound = false;
    let amountReceived = 0;

    console.log(`   🔍 Analizando ${instructions.length} instrucciones...`);

    for (const ix of instructions) {
      if (ix.programId && ix.programId.toString() === '11111111111111111111111111111111') {
        if (ix.parsed && ix.parsed.type === 'transfer') {
          const info = ix.parsed.info;
          if (info.destination === DEFAULT_MERCHANT) {
            transferFound = true;
            amountReceived = info.lamports / LAMPORTS_PER_SOL;
            console.log(`      ✅ Transferencia al merchant confirmada: ${amountReceived} SOL`);
            break;
          } else {
            console.log(`      ⚠️ Transfer destino no coincide con merchant`);
          }
        }
      }
    }

    if (!transferFound) {
      console.log(`❌ No se encontró transferencia válida al merchant`);
      return res.status(400).json({
        ok: false,
        error: 'No se encontró transferencia válida al merchant wallet'
      });
    }

    const difference = Math.abs(amountReceived - expectedAmountSOL);

    console.log(`   💰 Verificando monto (tolerance ${PAYMENT_TOLERANCE_SOL} SOL):`);
    console.log(`      Esperado: ${expectedAmountSOL} SOL`);
    console.log(`      Recibido: ${amountReceived} SOL`);
    console.log(`      Diferencia: ${difference} SOL`);

    if (difference > PAYMENT_TOLERANCE_SOL) {
      console.log(`❌ Monto insuficiente`);
      return res.status(400).json({
        ok: false,
        error: `Monto insuficiente: se recibieron ${amountReceived.toFixed(4)} SOL, se esperaban ${expectedAmountSOL} SOL`
      });
    }

    console.log(`   ✅ Verificación de monto exitosa`);

    const memo = parseMemoFromParsedTx(tx);
    let memoMatches = false;

    if (memo && memo.json && metadata.selection) {
      const selMemo = memo.json.selection || {};
      const selReq = metadata.selection || {};
      memoMatches = (
        selMemo.minBlockX === selReq.minBlockX &&
        selMemo.minBlockY === selReq.minBlockY &&
        selMemo.blocksX === selReq.blocksX &&
        selMemo.blocksY === selReq.blocksY
      );
      console.log(`   📝 Memo parseado: ${memoMatches ? '✅ coincide' : '⚠️ no coincide'}`);
    }

    const buyerKey = tx.transaction.message.accountKeys && tx.transaction.message.accountKeys[0];
    const buyer = buyerKey && buyerKey.pubkey ? buyerKey.pubkey.toString() : String(buyerKey);

    const sale = {
      signature,
      buyer,
      amountSOL: amountReceived,
      merchant: DEFAULT_MERCHANT,
      metadata,
      memo: memo ? memo.raw : null,
      memoParsed: memo ? memo.json : null,
      memoMatches,
      timestamp: new Date().toISOString(),
      blockTime: tx.blockTime
    };

    // Revalidación final antes de persistir (evitar race)
    if (metadata.selection && !areBlocksAvailable(metadata.selection)) {
      console.log(`❌ Bloques ya ocupados (post-check)`);
      return res.status(400).json({
        ok: false,
        error: 'Los bloques seleccionados ya fueron ocupados durante la verificación. Intenta de nuevo.'
      });
    }

    // Guardar de forma atómica y serializada (esperar que termine)
    await appendSaleAtomic(sale);

    console.log(`✅ Compra verificada y guardada\n`);

    return res.json({
      ok: true,
      message: 'Compra verificada y registrada',
      sale,
      memoMatches,
      explorerUrl: `https://solscan.io/tx/${signature}?cluster=${CLUSTER}`
    });

  } catch (err) {
    console.error('❌ Error verificando transacción:', err.message || err);
    console.error('Error completo:', {
      message: err?.message,
      name: err?.name,
      stack: NODE_ENV === 'development' ? err?.stack : '(hidden in production)'
    });

    return res.status(500).json({
      ok: false,
      error: err?.message || 'Error al verificar la transacción',
      details: NODE_ENV === 'development' ? err?.stack : undefined
    });
  }
});

// ============================================
// API: OBTENER VENTAS
// ============================================
app.get('/api/sales', (req, res) => {
  try {
    const sales = readSales();
    res.json(sales);
  } catch (err) {
    console.error('❌ Error obteniendo ventas:', err.message || err);
    res.status(500).json({
      ok: false,
      error: 'Error al obtener las ventas'
    });
  }
});

// ============================================
// API: ESTADÍSTICAS
// ============================================
app.get('/api/stats', (req, res) => {
  try {
    const sales = readSales();
    const totalSales = sales.sales.length;
    const totalSOL = sales.sales.reduce((sum, s) => sum + (s.amountSOL || 0), 0);
    const totalPixels = sales.sales.reduce((sum, s) => {
      const sel = s.metadata?.selection;
      if (!sel) return sum;
      return sum + (sel.blocksX * sel.blocksY * 100); // 100 pixels por bloque
    }, 0);

    res.json({
      ok: true,
      stats: {
        totalSales,
        totalSOL: totalSOL.toFixed(2),
        totalPixels,
        percentageSold: ((totalPixels / 1000000) * 100).toFixed(2)
      }
    });
  } catch (err) {
    console.error('❌ Error obteniendo stats:', err.message || err);
    res.status(500).json({
      ok: false,
      error: 'Error al obtener estadísticas'
    });
  }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    status: 'healthy',
    cluster: CLUSTER,
    storage: UPLOADS_DIR,
    timestamp: new Date().toISOString()
  });
});

// ============================================
// FALLBACK SPA
// ============================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// MANEJO DE ERRORES GLOBAL
// ============================================
app.use((err, req, res, next) => {
  console.error('❌ Error no manejado:', err.message || err);
  res.status(500).json({
    ok: false,
    error: NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : err.message
  });
});

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, () => {
  console.log(`\n✅ Servidor iniciado en puerto ${PORT}`);
  if (BASE_URL) console.log(`🌐 Base URL: ${BASE_URL}`);
  console.log(`🌐 Frontend: http://localhost:${PORT}\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM recibido, creando backup final...');
  backupSales();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT recibido, creando backup final...');
  backupSales();
  process.exit(0);
});
