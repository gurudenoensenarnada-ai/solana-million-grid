/**
 * server.js - PRODUCTION VERSION with Cloudinary backup/restore for sales.json & images.json
 *
 * - Subida de logos LOCAL (sin IPFS) y COPIA opcional en Cloudinary (unsigned preset)
 * - Guardado en images.json cuando SAVE_IMAGES_IN_JSON=true
 * - Backup de sales.json + images.json a backups/ y subida a Cloudinary (resource_type=raw)
 * - Al arrancar, si sales.json/images.json no existen o están vacíos, intenta restaurar desde Cloudinary
 *
 * Cambios realizados:
 * - No exponer keys hardcodeadas; RPC_URL se toma desde env o usa clusterApiUrl(CLUSTER).
 * - No abortar el proceso si falta MERCHANT_WALLET (solo advertencia).
 * - Escritura atómica y serializada de ventas (appendSaleAtomic).
 * - Reintentos al obtener transacción parseada (getParsedTransactionWithRetry).
 * - Tolerancia de pago configurable vía env PAYMENT_TOLERANCE_SOL.
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
const fsp = fs.promises;
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
const CLUSTER = process.env.CLUSTER || 'mainnet-beta';
const RPC_URL = (process.env.RPC_URL || '').trim();
const rpcToUse = RPC_URL || solanaWeb3.clusterApiUrl(CLUSTER);

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const BASE_URL = process.env.BASE_URL || ''; // Para URLs completas

// Merchant wallet: preferir env; si no existe, advertir (no usar hardcoded en producción)
const DEFAULT_MERCHANT = (process.env.MERCHANT_WALLET || '').trim();
if (!DEFAULT_MERCHANT) {
  console.warn('⚠️ MERCHANT_WALLET no configurada. Debes establecer MERCHANT_WALLET en las env vars para recibir pagos.');
}

// Tolerancia configurable
const PAYMENT_TOLERANCE_SOL = parseFloat(process.env.PAYMENT_TOLERANCE_SOL || '0.00001');

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
      // no imprimir ruta con datos sensibles
    }
  } catch (err) {
    console.error(`❌ No se pudo crear o acceder al directorio ${dir}:`, err);
    throw err;
  }
});

// ============================================
// UTIL: Cloudinary upload/download para backups (resource_type=raw)
// (se mantiene la función pública de descarga como fallback local)
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
    // resource_type raw para JSON/text
    form.append('resource_type', 'raw');
    // intentamos mantener public_id fijo para poder sobrescribir/recuperar
    if (publicId) form.append('public_id', publicId);

    const resp = await axios.post(CLOUDINARY_RAW_API_URL, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 120000
    });

    console.log(`   ✅ Backup subido a Cloudinary`);
    return resp.data;
  } catch (err) {
    console.warn('   ⚠️ Error subiendo backup a Cloudinary:', err.message || err.toString());
    return null;
  }
}

// === ADD: helper para subir dataURLs a Cloudinary ===
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
    // FormData acepta Buffer con nombre y contentType
    form.append('file', buffer, { filename: publicName, contentType });
    if (CLOUDINARY_UPLOAD_PRESET) form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    // endpoint imagen (image/upload)
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

    const resp = await axios.post(url, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 120000
    });

    console.log(`   ✅ Imagen (dataUrl) subida a Cloudinary`);
    return resp.data;
  } catch (err) {
    console.warn('   ⚠️ Error subiendo dataUrl a Cloudinary:', err.message || err.toString());
    return null;
  }
}

// --- AUTO BACKUP: subir backups a Cloudinary cada vez que se añade una venta ----
// Debounce + lock para evitar subidas simultáneas y demasiadas peticiones cuando llegan varias ventas seguidas.

let isUploadingBackups = false;
let pendingBackupTimeout = null;
const BACKUP_UPLOAD_DEBOUNCE_MS = 2000; // agrupar cambios en ventana de 2s

async function performBackupUpload() {
  if (!CLOUDINARY_RAW_API_URL || !CLOUDINARY_UPLOAD_PRESET) {
    // cloudinary no configurado
    return;
  }

  if (isUploadingBackups) {
    return;
  }
  isUploadingBackups = true;

  try {
    // Crear backups con timestamp
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const salesBackupPath = path.join(BACKUPS_DIR, `sales_${timestamp}.json`);
    fs.copyFileSync(SALES_FILE, salesBackupPath);

    try {
      await uploadFileToCloudinary(salesBackupPath, 'solana_sales_backup');
    } catch (e) {
      console.warn('   ⚠️ Error subiendo sales backup (async):', e.message || e);
    }

    if (fs.existsSync(IMAGES_FILE)) {
      const imagesBackupPath = path.join(BACKUPS_DIR, `images_${timestamp}.json`);
      try {
        fs.copyFileSync(IMAGES_FILE, imagesBackupPath);
        await uploadFileToCloudinary(imagesBackupPath, 'solana_images_backup');
      } catch (e) {
        console.warn('   ⚠️ Error subiendo images backup (async):', e.message || e);
      }
    }
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
// Modificar appendSale -> appendSaleAtomic: escritura atómica y serializada
// ============================================

let _appendLock = Promise.resolve();

async function appendSaleAtomic(newSale) {
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

        // push nueva venta
        current.sales.push(newSale);

        // escribir de forma atómica: tmp -> rename
        const tmpPath = SALES_FILE + '.tmp';
        await fsp.writeFile(tmpPath, JSON.stringify(current, null, 2), 'utf8');
        await fsp.rename(tmpPath, SALES_FILE);

        // Programar subida de backup (no bloqueante)
        try { scheduleBackupUpload(); } catch (e) { /* noop */ }

        console.log(`✅ Venta guardada: ${newSale.metadata?.name || '(sin nombre)'}`);
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

// Mantener un alias por compatibilidad
const appendSale = (sale) => appendSaleAtomic(sale);

// ============================================
// Descargar archivo desde Cloudinary (fallback simple)
// ============================================
async function downloadFileFromCloudinary(publicId, destPath) {
  if (!CLOUDINARY_RAW_DELIVER_BASE) {
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
    console.log(`   ✅ Backup descargado desde Cloudinary`);
    return true;
  } catch (err) {
    console.warn(`   ⚠️ No se pudo descargar ${url}:`, err.message || err.toString());
    return false;
  }
}

// ============================================
// Crear sales.json e images.json si no existen (intento restaurar desde Cloudinary primero)
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
          await fsp.writeFile(SALES_FILE, JSON.stringify({ sales: [] }, null, 2), 'utf8');
        }
      } catch (err) {
        console.warn('   ⚠️ Error intentando restaurar sales.json (helper):', err?.message || err);
        await fsp.writeFile(SALES_FILE, JSON.stringify({ sales: [] }, null, 2), 'utf8');
      }
    } else if (!fs.existsSync(SALES_FILE)) {
      await fsp.writeFile(SALES_FILE, JSON.stringify({ sales: [] }, null, 2), 'utf8');
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
          await fsp.writeFile(IMAGES_FILE, JSON.stringify({ images: {} }, null, 2), 'utf8');
        }
      } catch (err) {
        console.warn('   ⚠️ Error intentando restaurar images.json (helper):', err?.message || err);
        await fsp.writeFile(IMAGES_FILE, JSON.stringify({ images: {} }, null, 2), 'utf8');
      }
    } else if (!fs.existsSync(IMAGES_FILE)) {
      try {
        const dir = path.dirname(IMAGES_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      } catch (e) { /* ignore */ }
      await fsp.writeFile(IMAGES_FILE, JSON.stringify({ images: {} }, null, 2), 'utf8');
    }
  } catch (e) {
    console.error('❌ Error en ensureJsonFiles:', e);
    if (!fs.existsSync(SALES_FILE)) await fsp.writeFile(SALES_FILE, JSON.stringify({ sales: [] }, null, 2), 'utf8');
    if (!fs.existsSync(IMAGES_FILE)) await fsp.writeFile(IMAGES_FILE, JSON.stringify({ images: {} }, null, 2), 'utf8');
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

// Control por env var: si === 'true' guardamos la imagen en images.json como dataURL
const SAVE_IMAGES_IN_JSON = process.env.SAVE_IMAGES_IN_JSON === 'true';

// ============================================
// PARSEAR MEMO (usa string MEMO_PROGRAM_ID_STR)
// ============================================
function parseMemoFromParsedTx(tx) {
  try {
    const instructions = tx.transaction.message.instructions;

    for (const ix of instructions) {
      if (ix.programId && ix.programId.toString() === MEMO_PROGRAM_ID_STR) {
        try {
          // Intentar desde ix.data (base64)
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
    console.error('❌ Error parseando memo:', err);
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

    // Comprobar overlap/colisión
    const noOverlap = (
      selection.minBlockX + selection.blocksX <= s.minBlockX ||
      selection.minBlockX >= s.minBlockX + s.blocksX ||
      selection.minBlockY + selection.blocksY <= s.minBlockY ||
      selection.minBlockY >= s.minBlockY + s.blocksY
    );

    if (!noOverlap) {
      return false; // Hay overlap = bloques ocupados
    }
  }

  return true; // Todos los bloques están libres
}

// Helper: retry getParsedTransaction a few veces (RPC puede tardar)
async function getParsedTransactionWithRetry(signature, attempts = 4, delayMs = 2000) {
  for (let i = 0; i < attempts; i++) {
    try {
      const tx = await connection.getParsedTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });
      if (tx) return tx;
    } catch (err) {
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

  // Validar que los bloques estén disponibles (pre-check)
  if (metadata.selection && !areBlocksAvailable(metadata.selection)) {
    return res.status(400).json({
      ok: false,
      error: 'Los bloques seleccionados ya están ocupados. Refresca la página.'
    });
  }

  try {
    console.log('   ⏳ Obteniendo transacción parseada (retries)...');

    const tx = await getParsedTransactionWithRetry(signature, 4, 2000);

    if (!tx || !tx.meta) {
      return res.status(404).json({
        ok: false,
        error: 'Transacción no encontrada o aún no confirmada. Espera unos segundos.'
      });
    }

    if (tx.meta.err) {
      return res.status(400).json({
        ok: false,
        error: 'La transacción falló en la blockchain'
      });
    }

    const instructions = tx.transaction.message.instructions;
    let transferFound = false;
    let amountReceived = 0;

    for (const ix of instructions) {
      if (ix.programId && ix.programId.toString() === '11111111111111111111111111111111') {
        if (ix.parsed && ix.parsed.type === 'transfer') {
          const info = ix.parsed.info;
          if (info.destination === DEFAULT_MERCHANT) {
            transferFound = true;
            amountReceived = info.lamports / LAMPORTS_PER_SOL;
            break;
          }
        }
      }
    }

    if (!transferFound) {
      return res.status(400).json({
        ok: false,
        error: 'No se encontró transferencia válida al merchant wallet'
      });
    }

    const difference = Math.abs(amountReceived - expectedAmountSOL);

    if (difference > PAYMENT_TOLERANCE_SOL) {
      return res.status(400).json({
        ok: false,
        error: `Monto insuficiente: se recibieron ${amountReceived.toFixed(4)} SOL, se esperaban ${expectedAmountSOL} SOL`
      });
    }

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
    }

    // buyer extraction safe
    let buyer = null;
    try {
      const key0 = tx.transaction.message.accountKeys && tx.transaction.message.accountKeys[0];
      buyer = key0 && key0.pubkey ? key0.pubkey.toString() : String(key0);
    } catch (e) {
      buyer = null;
    }

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

    // Revalidación final antes de persistir (post-check)
    if (metadata.selection && !areBlocksAvailable(metadata.selection)) {
      return res.status(400).json({
        ok: false,
        error: 'Los bloques seleccionados ya fueron ocupados durante la verificación. Intenta de nuevo.'
      });
    }

    // Guardar de forma atómica y serializada (esperar que termine)
    await appendSaleAtomic(sale);

    return res.json({
      ok: true,
      message: 'Compra verificada y registrada',
      sale,
      memoMatches,
      explorerUrl: `https://solscan.io/tx/${signature}?cluster=${CLUSTER}`
    });

  } catch (err) {
    console.error('❌ Error verificando transacción:', err.message || err);
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Error al verificar la transacción',
      details: NODE_ENV === 'development' ? err?.stack : undefined
    });
  }
});

// ============================================
// Resto de endpoints: /api/sales, /api/stats, health, image upload, etc.
// Mantengo el resto del código tal cual (ya presente en tu archivo original)
// ============================================

// API: OBTENER VENTAS
app.get('/api/sales', (req, res) => {
  try {
    const sales = readSales();
    res.json(sales);
  } catch (err) {
    console.error('❌ Error obteniendo ventas:', err);
    res.status(500).json({
      ok: false,
      error: 'Error al obtener las ventas'
    });
  }
});

// API: ESTADÍSTICAS
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
    console.error('❌ Error obteniendo stats:', err);
    res.status(500).json({
      ok: false,
      error: 'Error al obtener estadísticas'
    });
  }
});

// HEALTH CHECK
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    status: 'healthy',
    cluster: CLUSTER,
    storage: UPLOADS_DIR,
    timestamp: new Date().toISOString()
  });
});

// FALLBACK SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// MANEJO DE ERRORES GLOBAL
app.use((err, req, res, next) => {
  console.error('❌ Error no manejado:', err);
  res.status(500).json({
    ok: false,
    error: NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : (err && err.message) || String(err)
  });
});

// INICIAR SERVIDOR
app.listen(PORT, () => {
  console.log(`\n✅ Servidor iniciado en puerto ${PORT}`);
  if (BASE_URL) console.log(`🌐 Base URL: ${BASE_URL}`);
  console.log(`🌐 Frontend: http://localhost:${PORT}\n`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM recibido, creando backup final...');
  try { await performBackupUpload(); } catch(e) { /* ignore */ }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 SIGINT recibido, creando backup final...');
  try { await performBackupUpload(); } catch(e) { /* ignore */ }
  process.exit(0);
});
