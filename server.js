/**
 * server.js - PRODUCTION VERSION (Local Storage Only) + optional Cloudinary + images.json dataURL backup
 *
 * Express server para Solana Million Grid
 * - Subida de logos LOCAL (sin IPFS) y COPIA opcional en Cloudinary (unsigned preset)
 * - Opcional: guardar imagen en images.json como dataURL (SAVE_IMAGES_IN_JSON=true)
 * - Verificación de transacciones on-chain
 * - Rate limiting y seguridad
 * - Backups automáticos
 * - Logs mejorados
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
    // Opcional: RESTORE secret para proteger restore endpoint
    if (cfg.RESTORE_SECRET !== undefined) process.env.RESTORE_SECRET = String(cfg.RESTORE_SECRET);
  } catch (e) {
    console.warn('APP_CONFIG no es JSON válido:', e.message || e);
  }
}

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const solanaWeb3 = require('@solana/web3.js');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(cors());

// ============================================
// CONFIGURACIÓN (usar .env en producción)
// ============================================
const DEFAULT_MERCHANT = process.env.MERCHANT_WALLET || '3d7w4r4irLaKVYd4dLjpoiehJVawbbXWFWb1bCk9nGCo';
const CLUSTER = process.env.CLUSTER || 'mainnet-beta';
const RPC_URL = process.env.RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=cfadb209-0424-4c46-86cf-aa6f3f0c8d01';
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const BASE_URL = process.env.BASE_URL || ''; // Para URLs completas

// Cloudinary unsigned config (defaults to your values)
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || '';
const CLOUDINARY_API_URL = CLOUDINARY_CLOUD_NAME ? `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload` : null;

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
console.log('   MEMO_PROGRAM_ID raw value:', process.env.MEMO_PROGRAM_ID);
console.log('   MEMO_PROGRAM_ID used value:', MEMO_PROGRAM_ID_STR);

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

// Crear sales.json e images.json si no existen
if (!fs.existsSync(SALES_FILE)) {
  fs.writeFileSync(SALES_FILE, JSON.stringify({ sales: [] }, null, 2));
}
if (!fs.existsSync(IMAGES_FILE)) {
  // Si IMAGES_FILE está en un directorio persistente que no existe, crearlo antes de escribir
  try {
    const dir = path.dirname(IMAGES_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (e) { /* ignore */ }
  fs.writeFileSync(IMAGES_FILE, JSON.stringify({ images: {} }, null, 2));
}

const connection = new solanaWeb3.Connection(RPC_URL, 'confirmed');

console.log('🚀 Configuración:');
console.log(`   Cluster: ${CLUSTER}`);
console.log(`   RPC: ${RPC_URL}`);
console.log(`   Merchant: ${DEFAULT_MERCHANT}`);
console.log(`   Storage: ${UPLOADS_DIR} ${process.env.PERSISTENT_UPLOADS_DIR ? '(PERSISTENT)' : '(ephemeral - may be lost on redeploy)'}`);
console.log(`   IMAGES_FILE: ${IMAGES_FILE}`);
console.log(`   Cloudinary configured: ${CLOUDINARY_CLOUD_NAME ? 'yes' : 'no'}`);
console.log(`   Entorno: ${NODE_ENV}`);

const RESTORE_SECRET = process.env.RESTORE_SECRET || '';

// ============================================
// SEGURIDAD: RATE LIMITING
// ============================================
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutos
const MAX_REQUESTS = 100;

function rateLimitMiddleware(req, res, next) {
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
  const now = Date.now();

  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, []);
  }

  const requests = requestCounts.get(ip).filter(time => now - time < RATE_LIMIT_WINDOW);

  if (requests.length >= MAX_REQUESTS) {
    return res.status(429).json({
      ok: false,
      error: 'Demasiadas peticiones. Intenta más tarde.'
    });
  }

  requests.push(now);
  requestCounts.set(ip, requests);
  next();
}

app.use('/api/', rateLimitMiddleware);

// ============================================
// SERVIR ARCHIVOS ESTÁTICOS
// ============================================
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ============================================
// FUNCIONES DE BASE DE DATOS
// ============================================
function readSales() {
  try {
    const data = fs.readFileSync(SALES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('❌ Error leyendo sales.json:', err);
    return { sales: [] };
  }
}

function appendSale(sale) {
  try {
    const db = readSales();
    db.sales.push(sale);
    fs.writeFileSync(SALES_FILE, JSON.stringify(db, null, 2));
    console.log(`✅ Venta guardada: ${sale.metadata?.name || '(sin nombre)'}`);
  } catch (err) {
    console.error('❌ Error guardando venta:', err);
    throw err;
  }
}

// images.json helpers
function readImages() {
  try {
    const data = fs.readFileSync(IMAGES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('❌ Error leyendo images.json:', err);
    return { images: {} };
  }
}

function writeImages(imgs) {
  try {
    fs.writeFileSync(IMAGES_FILE, JSON.stringify(imgs, null, 2));
  } catch (err) {
    console.error('❌ Error guardando images.json:', err);
    throw err;
  }
}

// Control por env var: si === 'true' guardamos la imagen en images.json como dataURL
const SAVE_IMAGES_IN_JSON = process.env.SAVE_IMAGES_IN_JSON === 'true';

// ============================================
// BACKUP AUTOMÁTICO
// ============================================
function backupSales() {
  try {
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const backupPath = path.join(BACKUPS_DIR, `sales_${timestamp}.json`);
    fs.copyFileSync(SALES_FILE, backupPath);
    console.log(`📦 Backup creado: sales_${timestamp}.json`);

    // Copiar también images.json si existe (respaldo de dataURLs)
    if (fs.existsSync(IMAGES_FILE)) {
      const imgBackupPath = path.join(BACKUPS_DIR, `images_${timestamp}.json`);
      try {
        fs.copyFileSync(IMAGES_FILE, imgBackupPath);
        console.log(`📦 Backup creado: images_${timestamp}.json`);
      } catch (e) {
        console.warn('⚠️ No se pudo crear backup de images.json:', e.message || e);
      }
    }

    // Limpiar backups antiguos (mantener solo los últimos 10 pares)
    const backups = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith('sales_') || f.startsWith('images_'))
      .sort()
      .reverse();

    // Mantener solo los últimos 20 (10 sales + 10 images) por simplicidad
    if (backups.length > 20) {
      backups.slice(20).forEach(file => {
        fs.unlinkSync(path.join(BACKUPS_DIR, file));
      });
    }
  } catch (err) {
    console.error('❌ Error creando backup:', err);
  }
}

// Backup cada hora
setInterval(backupSales, 60 * 60 * 1000);
// Backup inicial al iniciar
backupSales();

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

    // Generar nombre único (local)
    const timestamp = Date.now();
    const safeName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const finalName = `${timestamp}_${safeName}`;
    const targetPath = path.join(UPLOADS_DIR, finalName);

    // Renombrar el archivo en local (mantener copia local como backup)
    fs.renameSync(tmpPath, targetPath);

    // Crear data URL (base64) para guardarlo en JSON si se desea
    let dataUrl = null;
    try {
      const buffer = fs.readFileSync(targetPath);
      dataUrl = `data:${req.file.mimetype};base64,${buffer.toString('base64')}`;
    } catch (err) {
      console.warn('⚠️ No se pudo crear dataURL de la imagen:', err.message || err);
    }

    // Guardar en images.json si está habilitado
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

    // Si Cloudinary no está configurado, devolver la URL local y dataUrl (si existe)
    const cloudConfigured = Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_UPLOAD_PRESET);
    if (!cloudConfigured) {
      console.log('   Cloudinary no configurado, devolviendo URL local.');
      const localUrl = BASE_URL
        ? `${BASE_URL}/uploads/${encodeURIComponent(finalName)}`
        : `${req.protocol}://${req.get('host')}/uploads/${encodeURIComponent(finalName)}`;
      return res.json({
        ok: true,
        url: localUrl,
        name: finalName,
        dataUrl // puede ser null si falla la conversión
      });
    }

    // Si Cloudinary está configurado: subir (puede aceptar dataURL o stream)
    // Preferimos subir como stream desde el archivo local para mayor fiabilidad
    const fileStream = fs.createReadStream(targetPath);
    const form = new FormData();
    form.append('file', fileStream);
    form.append('upload_preset', process.env.CLOUDINARY_UPLOAD_PRESET);
    // opcional: form.append('folder', 'solana-million-grid');

    const headers = form.getHeaders();

    console.log(`📤 Subiendo ${finalName} a Cloudinary...`);
    try {
      const resp = await axios.post(process.env.CLOUDINARY_API_URL || CLOUDINARY_API_URL, form, {
        headers,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 300000
      });
      const cloudResp = resp.data;
      console.log('   ✅ Subida a Cloudinary OK:', cloudResp.secure_url);

      // Opción para eliminar copia local tras upload
      if (process.env.REMOVE_LOCAL_AFTER_UPLOAD === 'true') {
        try {
          fs.unlinkSync(targetPath);
          console.log('   🗑️ Copia local eliminada:', targetPath);
        } catch (unlinkErr) {
          console.warn('   ⚠️ No se pudo eliminar copia local:', unlinkErr.message || unlinkErr);
        }
      }

      return res.json({
        ok: true,
        url: cloudResp.secure_url,
        public_id: cloudResp.public_id,
        version: cloudResp.version,
        name: finalName,
        dataUrl // útil para uso inmediato en cliente si quieres mostrar la imagen sin depender del hosting
      });
    } catch (err) {
      console.error('❌ Error subiendo a Cloudinary:', err.message || err.toString());

      // Fallback: devolver URL local + dataUrl
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
    console.error('❌ Error guardando archivo:', err);
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

    const localPath = path.join(UPLOADS_DIR, name);
    if (fs.existsSync(localPath)) {
      return res.sendFile(localPath);
    }

    return res.status(404).json({ ok: false, error: 'Imagen no encontrada' });
  } catch (err) {
    console.error('❌ Error en /api/image/:', err);
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
      uploadedAt: meta.uploadedAt
    }));
    return res.json({ ok: true, count: list.length, images: list });
  } catch (err) {
    console.error('❌ Error en /api/images-list:', err);
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
    console.error('❌ Error listando backups:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
});

// Restaurar images.json desde backups (protegido si RESTORE_SECRET está definido)
app.post('/api/restore-images', express.json(), (req, res) => {
  try {
    const backup = req.body?.backup;
    if (!backup) return res.status(400).json({ ok: false, error: 'Falta parámetro backup' });

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
    console.error('❌ Error restaurando images.json:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
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

// ============================================
// API: VERIFICAR COMPRA
// ============================================
app.post('/api/verify-purchase', async (req, res) => {
  const { signature, expectedAmountSOL, metadata } = req.body || {};

  console.log(`\n🔍 Verificando compra:`);
  console.log(`   Signature: ${signature}`);
  console.log(`   Proyecto: ${metadata?.name}`);
  console.log(`   Monto esperado: ${expectedAmountSOL} SOL`);

  if (!signature || expectedAmountSOL === undefined || !metadata) {
    return res.status(400).json({
      ok: false,
      error: 'Faltan parámetros requeridos'
    });
  }

  // Validar que los bloques estén disponibles
  if (metadata.selection && !areBlocksAvailable(metadata.selection)) {
    console.log(`❌ Bloques ya ocupados`);
    return res.status(400).json({
      ok: false,
      error: 'Los bloques seleccionados ya están ocupados. Refresca la página.'
    });
  }

  try {
    console.log('   ⏳ Obteniendo transacción parseada...');

    const tx = await connection.getParsedTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });

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
        console.log('      ✓ Instrucción del System Program encontrada');

        if (ix.parsed && ix.parsed.type === 'transfer') {
          const info = ix.parsed.info;
          console.log(`      📤 De: ${info.source}`);
          console.log(`      📥 A: ${info.destination}`);
          console.log(`      💵 Monto: ${info.lamports} lamports`);

          if (info.destination === DEFAULT_MERCHANT) {
            transferFound = true;
            amountReceived = info.lamports / LAMPORTS_PER_SOL;
            console.log(`      ✅ Transferencia al merchant confirmada: ${amountReceived} SOL`);
            break;
          } else {
            console.log(`      ⚠️ Destino no coincide.`);
            console.log(`         Esperado: ${DEFAULT_MERCHANT}`);
            console.log(`         Recibido: ${info.destination}`);
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

    const tolerance = 0.00001;
    const difference = Math.abs(amountReceived - expectedAmountSOL);

    console.log(`   💰 Verificando monto:`);
    console.log(`      Esperado: ${expectedAmountSOL} SOL`);
    console.log(`      Recibido: ${amountReceived} SOL`);
    console.log(`      Diferencia: ${difference} SOL`);
    console.log(`      Tolerancia: ${tolerance} SOL`);

    if (difference > tolerance) {
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

    const buyer = tx.transaction.message.accountKeys[0].pubkey
      ? tx.transaction.message.accountKeys[0].pubkey.toString()
      : tx.transaction.message.accountKeys[0].toString();

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

    appendSale(sale);

    console.log(`✅ Compra verificada y guardada\n`);

    return res.json({
      ok: true,
      message: 'Compra verificada y registrada',
      sale,
      memoMatches,
      explorerUrl: `https://solscan.io/tx/${signature}?cluster=${CLUSTER}`
    });

  } catch (err) {
    console.error('❌ Error verificando transacción:', err);
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
    console.error('❌ Error obteniendo ventas:', err);
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
    console.error('❌ Error obteniendo stats:', err);
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
  console.error('❌ Error no manejado:', err);
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
  console.log(`🌐 Accede en: http://localhost:${PORT}\n`);
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
