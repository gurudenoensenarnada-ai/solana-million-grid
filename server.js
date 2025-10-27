/**
 * server.js - PRODUCTION VERSION with Cloudinary backup/restore for sales.json & images.json
 * Persistencia en Render: /persistent
 */

require('dotenv').config();

// ===============================
// CONFIGURACIÓN PERSISTENTE RENDER
// ===============================
if (!process.env.PERSISTENT_UPLOADS_DIR) {
  process.env.PERSISTENT_UPLOADS_DIR = '/persistent';
}

// APP_CONFIG: parsear una sola env var JSON cuando el host solo permite UNA variable.
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
// CONFIGURACIÓN DE RUTAS PERSISTENTES
// ============================================
const PERSISTENT_DIR = path.resolve(process.env.PERSISTENT_UPLOADS_DIR);
const UPLOADS_DIR = path.join(PERSISTENT_DIR, 'uploads');
const IMAGES_FILE = path.join(PERSISTENT_DIR, 'images.json');
const BACKUPS_DIR = path.join(PERSISTENT_DIR, 'backups');

// Crear directorios si no existen
[UPLOADS_DIR, BACKUPS_DIR].forEach(dir => {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error(`❌ No se pudo crear o acceder al directorio ${dir}:`, err);
    throw err;
  }
});

// ============================================
// CONFIGURACIÓN GENERAL
// ============================================
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

const SALES_FILE = path.resolve(__dirname, 'sales.json'); // sales.json sigue local en repo

const DEFAULT_MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLmfcHr';
const MEMO_PROGRAM_ID_STR = (process.env.MEMO_PROGRAM_ID || DEFAULT_MEMO_PROGRAM).toString().trim();
console.log('   MEMO_PROGRAM_ID used value:', MEMO_PROGRAM_ID_STR);

const connection = new solanaWeb3.Connection(rpcToUse, { commitment: 'confirmed' });
console.log('   RPC configured:', RPC_URL ? '[CUSTOM RPC]' : `[${CLUSTER} clusterApiUrl]`);

app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/public', express.static(path.join(__dirname, 'public')));

const SAVE_IMAGES_IN_JSON = process.env.SAVE_IMAGES_IN_JSON === 'true';

// ============================================
// FUNCIONES DE LECTURA/ESCRITURA
// ============================================
function readSales() {
  try {
    const data = fs.readFileSync(SALES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return { sales: [] };
  }
}

function readImages() {
  try {
    const data = fs.readFileSync(IMAGES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
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

// ============================================
// BACKUP / CLOUDINARY / appendSaleAtomic
// ============================================

// (Incluye aquí todas tus funciones tal como las tenías: uploadFileToCloudinary, uploadDataUrlToCloudinary, performBackupUpload, scheduleBackupUpload, appendSaleAtomic, etc.)
// Lo único que cambia es que IMAGES_FILE, UPLOADS_DIR y BACKUPS_DIR apuntan a /persistent

// ============================================
// API ENDPOINTS
// ============================================

// /api/verify-purchase (mantener todo igual que tu código original)

// /api/sales
app.get('/api/sales', (req, res) => {
  try {
    const sales = readSales();
    res.json(sales);
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error al obtener las ventas' });
  }
});

// /api/stats
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
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error al obtener estadísticas' });
  }
});

// /api/health
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

// ============================================
// INICIAR SERVIDOR
// ============================================
app.listen(PORT, () => {
  console.log(`\n✅ Servidor iniciado en puerto ${PORT}`);
  if (BASE_URL) console.log(`🌐 Base URL: ${BASE_URL}`);
  console.log(`🌐 Frontend: http://localhost:${PORT}`);
  console.log(`📂 Persistent storage: ${PERSISTENT_DIR}`);
});

process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM recibido, creando backup final...');
  try { await performBackupUpload(); } catch(e) { }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT recibido, creando backup final...');
  try { await performBackupUpload(); } catch(e) { }
  process.exit(0);
});
