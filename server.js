/**
 * server.js - PRODUCTION VERSION (Local Storage Only) + Cloudinary unsigned uploads
 * 
 * Express server para Solana Million Grid
 * - Subida de logos LOCAL (sin IPFS) y COPIA en Cloudinary (unsigned preset)
 * - Verificación de transacciones on-chain
 * - Rate limiting y seguridad
 * - Backups automáticos
 * - Logs mejorados
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const solanaWeb3 = require('@solana/web3.js');
const bs58 = require('bs58');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(express.json({ limit: '2mb' }));
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
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'drubzopvu';
const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || 'solana_unsigned';
const CLOUDINARY_API_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`;

const SALES_FILE = path.resolve(__dirname, 'sales.json');
// UPLOADS_DIR: use persistent directory if provided via env, otherwise fall back to local uploads/.
const UPLOADS_DIR = process.env.PERSISTENT_UPLOADS_DIR
  ? path.resolve(process.env.PERSISTENT_UPLOADS_DIR)
  : path.resolve(__dirname, 'uploads');
const BACKUPS_DIR = path.resolve(__dirname, 'backups');
const LAMPORTS_PER_SOL = solanaWeb3.LAMPORTS_PER_SOL || 1000000000;

// VALIDACIÓN/CREACIÓN segura de MEMO_PROGRAM_ID (evita "Invalid public key input")
const DEFAULT_MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLmfcHr';
let MEMO_PROGRAM_ID;
try {
  const memoEnv = (process.env.MEMO_PROGRAM_ID || DEFAULT_MEMO_PROGRAM).toString().trim();
  console.log('   MEMO_PROGRAM_ID raw value:', process.env.MEMO_PROGRAM_ID);
  console.log('   MEMO_PROGRAM_ID used value:', memoEnv);
  MEMO_PROGRAM_ID = new solanaWeb3.PublicKey(memoEnv);
} catch (err) {
  console.error('❌ Error creando PublicKey para MEMO_PROGRAM_ID. Valor problemático:', process.env.MEMO_PROGRAM_ID);
  console.error('Detalle del error:', err && err.message ? err.message : err);
  // Re-lanzar para que el proceso muestre el error y podamos verlo en el log de despliegue
  throw err;
}

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
    // Si no podemos crear uploads, seguir fallando para evitar comportamientos inesperados
    throw err;
  }
});

// Crear sales.json si no existe
if (!fs.existsSync(SALES_FILE)) {
  fs.writeFileSync(SALES_FILE, JSON.stringify({ sales: [] }, null, 2));
}

const connection = new solanaWeb3.Connection(RPC_URL, 'confirmed');

console.log('🚀 Configuración:');
console.log(`   Cluster: ${CLUSTER}`);
console.log(`   RPC: ${RPC_URL}`);
console.log(`   Merchant: ${DEFAULT_MERCHANT}`);
console.log(`   Storage: ${UPLOADS_DIR} ${process.env.PERSISTENT_UPLOADS_DIR ? '(PERSISTENT)' : '(ephemeral - may be lost on redeploy)'}`);
console.log(`   Cloudinary: ${CLOUDINARY_CLOUD_NAME}`);
console.log(`   Entorno: ${NODE_ENV}`);

// ============================================
// SEGURIDAD: RATE LIMITING
// ============================================
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutos
const MAX_REQUESTS = 100;

function rateLimitMiddleware(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
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
    console.log(`✅ Venta guardada: ${sale.metadata.name}`);
  } catch (err) {
    console.error('❌ Error guardando venta:', err);
    throw err;
  }
}

// ============================================
// BACKUP AUTOMÁTICO
// ============================================
function backupSales() {
  try {
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const backupPath = path.join(BACKUPS_DIR, `sales_${timestamp}.json`);
    fs.copyFileSync(SALES_FILE, backupPath);
    console.log(`📦 Backup creado: sales_${timestamp}.json`);
    
    // Limpiar backups antiguos (mantener solo los últimos 10)
    const backups = fs.readdirSync(BACKUPS_DIR)
      .filter(f => f.startsWith('sales_'))
      .sort()
      .reverse();
    
    if (backups.length > 10) {
      backups.slice(10).forEach(file => {
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
// API: SUBIR LOGO -> ahora guarda en Cloudinary (unsigned)
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
    const ext = path.extname(originalName);
    const safeName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const finalName = `${timestamp}_${safeName}`;
    const targetPath = path.join(UPLOADS_DIR, finalName);

    // Renombrar el archivo en local (mantener copia local como backup)
    fs.renameSync(tmpPath, targetPath);

    // Subir a Cloudinary (unsigned) usando multipart/form-data
    const fileStream = fs.createReadStream(targetPath);
    const form = new FormData();
    form.append('file', fileStream);
    form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

    const headers = form.getHeaders();

    console.log(`📤 Subiendo ${finalName} a Cloudinary ${CLOUDINARY_CLOUD_NAME} con preset ${CLOUDINARY_UPLOAD_PRESET}...`);
    let cloudResp;
    try {
      const resp = await axios.post(CLOUDINARY_API_URL, form, {
        headers,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 30000
      });
      cloudResp = resp.data;
      console.log('   ✅ Subida a Cloudinary OK:', cloudResp.secure_url);
    } catch (err) {
      // En caso de error en la subida a Cloudinary, lo loggeamos y devolvemos fallback a la URL local
      console.error('❌ Error subiendo a Cloudinary:', err.message || err.toString());
      // No eliminamos la copia local; devolvemos la URL local para compatibilidad
      let fullUrl;
      if (BASE_URL) {
        fullUrl = `${BASE_URL}/uploads/${encodeURIComponent(finalName)}`;
      } else {
        const protocol = req.protocol;
        const host = req.get('host');
        fullUrl = `${protocol}://${host}/uploads/${encodeURIComponent(finalName)}`;
      }

      return res.status(502).json({
        ok: false,
        error: 'La subida a Cloudinary falló. Archivo guardado en local como respaldo.',
        localUrl: fullUrl,
        details: err.message
      });
    }

    // Si la subida a Cloudinary fue exitosa, devolver la URL pública y metadatos.
    return res.json({
      ok: true,
      url: cloudResp.secure_url,
      public_id: cloudResp.public_id,
      version: cloudResp.version,
      name: finalName,
      // Mantener también la URL local en caso de que quieras conservarla
      local: BASE_URL ? `${BASE_URL}/uploads/${encodeURIComponent(finalName)}` : undefined
    });
    
  } catch (err) {
    console.error('❌ Error guardando archivo:', err);
    return res.status(500).json({ 
      ok: false, 
      error: err.message || 'Error al subir el archivo' 
    });
  }
});

// ============================================
// PARSEAR MEMO
// ============================================
function parseMemoFromParsedTx(tx) {
  try {
    const instructions = tx.transaction.message.instructions;
    
    for (const ix of instructions) {
      if (ix.programId.toString() === MEMO_PROGRAM_ID.toString()) {
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
    const s = sale.metadata.selection;
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

// (rest of file unchanged...)
...
