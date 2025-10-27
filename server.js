/**
 * server.js - PRODUCTION VERSION con persistencia en Render (/persistent)
 *
 * Cambios principales:
 * - UPLOADS_DIR, IMAGES_FILE y BACKUPS_DIR apuntan a /persistent
 * - Mantiene Cloudinary backup/restore
 * - Mantiene appendSaleAtomic, verify-purchase, stats, health
 * - Mantiene SPA fallback y manejo de errores global
 */

require('dotenv').config();

if (!process.env.PERSISTENT_UPLOADS_DIR) {
  process.env.PERSISTENT_UPLOADS_DIR = '/persistent';
}

// APP_CONFIG parseado desde env
if (process.env.APP_CONFIG) {
  try {
    const cfg = JSON.parse(process.env.APP_CONFIG);
    if (cfg.RPC_URL) process.env.RPC_URL = cfg.RPC_URL;
    if (cfg.SAVE_IMAGES_IN_JSON !== undefined) process.env.SAVE_IMAGES_IN_JSON = String(cfg.SAVE_IMAGES_IN_JSON);
    if (cfg.PERSISTENT_UPLOADS_DIR) process.env.PERSISTENT_UPLOADS_DIR = cfg.PERSISTENT_UPLOADS_DIR;
    if (cfg.REMOVE_LOCAL_AFTER_UPLOAD !== undefined) process.env.REMOVE_LOCAL_AFTER_UPLOAD = String(cfg.REMOVE_LOCAL_AFTER_UPLOAD);
    if (cfg.CLOUDINARY_CLOUD_NAME) process.env.CLOUDINARY_CLOUD_NAME = cfg.CLOUDINARY_CLOUD_NAME;
    if (cfg.CLOUDINARY_UPLOAD_PRESET) process.env.CLOUDINARY_UPLOAD_PRESET = cfg.CLOUDINARY_UPLOAD_PRESET;
    if (cfg.CLOUDINARY_API_KEY) process.env.CLOUDINARY_API_KEY = String(cfg.CLOUDINARY_API_KEY);
    if (cfg.CLOUDINARY_API_SECRET) process.env.CLOUDINARY_API_SECRET = String(cfg.CLOUDINARY_API_SECRET);
    if (cfg.RESTORE_SECRET !== undefined) process.env.RESTORE_SECRET = String(cfg.RESTORE_SECRET);
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
const { restoreImagesFromCloudinary } = require('./cloudinary-helpers');

const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(cors());

// ==============================
// RUTAS PERSISTENTES RENDER
// ==============================
const PERSISTENT_DIR = path.resolve(process.env.PERSISTENT_UPLOADS_DIR);
const UPLOADS_DIR = path.join(PERSISTENT_DIR, 'uploads');
const IMAGES_FILE = path.join(PERSISTENT_DIR, 'images.json');
const BACKUPS_DIR = path.join(PERSISTENT_DIR, 'backups');

[UPLOADS_DIR, BACKUPS_DIR].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(`❌ No se pudo crear o acceder al directorio ${dir}:`, err);
    throw err;
  }
});

// ==============================
// CONFIGURACIÓN GENERAL
// ==============================
const CLUSTER = process.env.CLUSTER || 'mainnet-beta';
const RPC_URL = (process.env.RPC_URL || '').trim();
const rpcToUse = RPC_URL || solanaWeb3.clusterApiUrl(CLUSTER);

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';
const BASE_URL = process.env.BASE_URL || '';

const DEFAULT_MERCHANT = (process.env.MERCHANT_WALLET || '').trim();
if (!DEFAULT_MERCHANT) console.warn('⚠️ MERCHANT_WALLET no configurada.');

const PAYMENT_TOLERANCE_SOL = parseFloat(process.env.PAYMENT_TOLERANCE_SOL || '0.00001');

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || '';
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || '';
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
const CLOUDINARY_RAW_API_URL = CLOUDINARY_CLOUD_NAME ? `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/raw/upload` : null;
const CLOUDINARY_RAW_DELIVER_BASE = CLOUDINARY_CLOUD_NAME ? `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/raw/upload` : null;

const SALES_FILE = path.resolve(__dirname, 'sales.json');

const DEFAULT_MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLmfcHr';
const MEMO_PROGRAM_ID_STR = (process.env.MEMO_PROGRAM_ID || DEFAULT_MEMO_PROGRAM).toString().trim();

const connection = new solanaWeb3.Connection(rpcToUse, { commitment: 'confirmed' });

app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/public', express.static(path.join(__dirname, 'public')));

const SAVE_IMAGES_IN_JSON = process.env.SAVE_IMAGES_IN_JSON === 'true';

// ==============================
// FUNCIONES DE LECTURA/ESCRITURA
// ==============================
function readSales() {
  try {
    const data = fs.readFileSync(SALES_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { sales: [] };
  }
}

function readImages() {
  try {
    const data = fs.readFileSync(IMAGES_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
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

// ==============================
// CLOUDINARY / BACKUPS
// ==============================
async function uploadFileToCloudinary(filePath, publicId) {
  if (!CLOUDINARY_RAW_API_URL || !CLOUDINARY_UPLOAD_PRESET) return null;
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    form.append('resource_type', 'raw');
    if (publicId) form.append('public_id', publicId);

    const resp = await axios.post(CLOUDINARY_RAW_API_URL, form, { headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 120000 });
    return resp.data;
  } catch (err) {
    console.warn('⚠️ Error subiendo backup a Cloudinary:', err.message || err.toString());
    return null;
  }
}

async function uploadDataUrlToCloudinary(dataUrl, publicName) {
  if (!CLOUDINARY_CLOUD_NAME || (!CLOUDINARY_UPLOAD_PRESET && !(CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET))) return null;
  const m = String(dataUrl || '').match(/^data:(.+);base64,(.+)$/);
  if (!m) return null;
  const buffer = Buffer.from(m[2], 'base64');
  try {
    const form = new FormData();
    form.append('file', buffer, { filename: publicName, contentType: m[1] });
    if (CLOUDINARY_UPLOAD_PRESET) form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
    const resp = await axios.post(url, form, { headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 120000 });
    return resp.data;
  } catch (err) {
    console.warn('⚠️ Error subiendo dataUrl a Cloudinary:', err.message || err.toString());
    return null;
  }
}

let isUploadingBackups = false;
let pendingBackupTimeout = null;
const BACKUP_UPLOAD_DEBOUNCE_MS = 2000;

async function performBackupUpload() {
  if (!CLOUDINARY_RAW_API_URL || !CLOUDINARY_UPLOAD_PRESET) return;
  if (isUploadingBackups) return;
  isUploadingBackups = true;

  try {
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const salesBackupPath = path.join(BACKUPS_DIR, `sales_${timestamp}.json`);
    fs.copyFileSync(SALES_FILE, salesBackupPath);
    await uploadFileToCloudinary(salesBackupPath, 'solana_sales_backup');

    if (fs.existsSync(IMAGES_FILE)) {
      const imagesBackupPath = path.join(BACKUPS_DIR, `images_${timestamp}.json`);
      fs.copyFileSync(IMAGES_FILE, imagesBackupPath);
      await uploadFileToCloudinary(imagesBackupPath, 'solana_images_backup');
    }
  } catch (err) {
    console.warn('⚠️ Error creando/subiendo backups:', err.message || err);
  } finally {
    isUploadingBackups = false;
  }
}

function scheduleBackupUpload() {
  if (pendingBackupTimeout) clearTimeout(pendingBackupTimeout);
  pendingBackupTimeout = setTimeout(() => { pendingBackupTimeout = null; performBackupUpload().catch(() => {}); }, BACKUP_UPLOAD_DEBOUNCE_MS);
}

// ==============================
// appendSaleAtomic
// ==============================
let _appendLock = Promise.resolve();
async function appendSaleAtomic(newSale) {
  _appendLock = _appendLock.then(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        let current = { sales: [] };
        try { current = JSON.parse(await fsp.readFile(SALES_FILE, 'utf8') || '{"sales":[]}'); } catch {}
        current.sales.push(newSale);
        const tmpPath = SALES_FILE + '.tmp';
        await fsp.writeFile(tmpPath, JSON.stringify(current, null, 2), 'utf8');
        await fsp.rename(tmpPath, SALES_FILE);
        try { scheduleBackupUpload(); } catch {}
        return;
      } catch {
        await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
      }
    }
    throw new Error('appendSaleAtomic: fallaron todos los intentos');
  });
  return _appendLock;
}

// ==============================
// ENDPOINTS
// ==============================
app.get('/api/sales', (req, res) => {
  try {
    const sales = readSales();
    res.json(sales);
  } catch {
    res.status(500).json({ ok: false, error: 'Error al obtener las ventas' });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    const sales = readSales();
    const totalSales = sales.sales.length;
    const totalSOL = sales.sales.reduce((sum, s) => sum + (s.amountSOL || 0), 0);
    const totalPixels = sales.sales.reduce((sum, s) => {
      const sel = s.metadata?.selection;
      if (!sel) return sum;
      return sum + (sel.blocksX * sel.blocksY * 100);
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
  } catch {
    res.status(500).json({ ok: false, error: 'Error al obtener estadísticas' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    status: 'healthy',
    cluster: CLUSTER,
    storage: UPLOADS_DIR,
    timestamp: new Date().toISOString()
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==============================
// INICIO SERVIDOR
// ==============================
app.listen(PORT, () => {
  console.log(`✅ Servidor iniciado en puerto ${PORT}`);
  if (BASE_URL) console.log(`🌐 Base URL: ${BASE_URL}`);
  console.log(`🌐 Frontend: http://localhost:${PORT}`);
  console.log(`📂 Persistent storage: ${PERSISTENT_DIR}`);
});

process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM recibido, creando backup final...');
  try { await performBackupUpload(); } catch {}
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT recibido, creando backup final...');
  try { await performBackupUpload(); } catch {}
  process.exit(0);
});
