/**
 * server.js - PRODUCTION VERSION MEJORADA
 * Mejoras: Validación de transacciones en servidor, locks, mejor manejo de errores
 */

require('dotenv').config();

// Parsear APP_CONFIG si existe
if (process.env.APP_CONFIG) {
  try {
    const config = JSON.parse(process.env.APP_CONFIG);
    Object.keys(config).forEach(key => {
      if (!process.env[key]) {
        process.env[key] = String(config[key]);
      }
    });
    console.log('✅ APP_CONFIG parseado correctamente');
  } catch (err) {
    console.error('⚠️ Error parseando APP_CONFIG:', err.message);
  }
}

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const solanaWeb3 = require('@solana/web3.js');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// ==============================
// CONFIGURACIÓN
// ==============================
const PORT = process.env.PORT || 3000;

// Usar disco persistente si está disponible
const PERSISTENT_DIR = process.env.PERSISTENT_DIR || '/persistent';
const USE_PERSISTENT = fs.existsSync(PERSISTENT_DIR);

const UPLOADS_DIR = USE_PERSISTENT 
  ? path.join(PERSISTENT_DIR, 'uploads')
  : path.resolve(__dirname, 'uploads');
  
const SALES_FILE = USE_PERSISTENT
  ? path.join(PERSISTENT_DIR, 'sales.json')
  : path.resolve(__dirname, 'sales.json');

const LOCKS_FILE = USE_PERSISTENT
  ? path.join(PERSISTENT_DIR, 'locks.json')
  : path.resolve(__dirname, 'locks.json');

const CLUSTER = process.env.CLUSTER || 'mainnet-beta';
const RPC_URL = process.env.RPC_URL || solanaWeb3.clusterApiUrl(CLUSTER);
const MERCHANT_WALLET = process.env.MERCHANT_WALLET;

// Validar configuración
if (!MERCHANT_WALLET) {
  console.error('❌ ERROR: MERCHANT_WALLET no configurada');
  process.exit(1);
}

if (!RPC_URL.includes('helius') && !RPC_URL.includes('quicknode') && CLUSTER === 'mainnet-beta') {
  console.warn('⚠️ ADVERTENCIA: Usando RPC público para mainnet, puede ser lento');
}

console.log('🚀 Configuración:');
console.log(`   Cluster: ${CLUSTER}`);
console.log(`   Merchant: ${MERCHANT_WALLET}`);
console.log(`   Puerto: ${PORT}`);
console.log('\n💾 Almacenamiento:');
console.log(`   Persistent disk: ${USE_PERSISTENT ? '✅ Activo' : '⚠️ Local (se borra al redesplegar)'}`);
console.log(`   Uploads: ${UPLOADS_DIR}`);
console.log(`   Sales: ${SALES_FILE}`);

// Crear directorios necesarios
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log('✅ Directorio uploads creado');
}

if (!fs.existsSync(SALES_FILE)) {
  fs.writeFileSync(SALES_FILE, JSON.stringify({ sales: [] }, null, 2));
  console.log('✅ Archivo sales.json creado');
}

if (!fs.existsSync(LOCKS_FILE)) {
  fs.writeFileSync(LOCKS_FILE, JSON.stringify({ locks: {} }, null, 2));
  console.log('✅ Archivo locks.json creado');
}

// Conexión a Solana (segura en el servidor)
const connection = new solanaWeb3.Connection(RPC_URL, 'confirmed');

// ==============================
// SISTEMA DE LOCKS (previene race conditions)
// ==============================
const activeLocks = new Map(); // locks en memoria para mejor rendimiento

function acquireLock(key, timeoutMs = 30000) {
  const now = Date.now();
  const existing = activeLocks.get(key);
  
  if (existing && existing.expiresAt > now) {
    return false; // Lock ocupado
  }
  
  activeLocks.set(key, {
    acquiredAt: now,
    expiresAt: now + timeoutMs
  });
  
  return true;
}

function releaseLock(key) {
  activeLocks.delete(key);
}

// Limpiar locks expirados cada minuto
setInterval(() => {
  const now = Date.now();
  for (const [key, lock] of activeLocks.entries()) {
    if (lock.expiresAt < now) {
      activeLocks.delete(key);
    }
  }
}, 60000);

// ==============================
// SERVIR ARCHIVOS ESTÁTICOS
// ==============================
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ==============================
// FUNCIONES AUXILIARES
// ==============================
function readSales() {
  try {
    const data = fs.readFileSync(SALES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error leyendo sales.json:', err);
    return { sales: [] };
  }
}

function writeSales(salesData) {
  try {
    fs.writeFileSync(SALES_FILE, JSON.stringify(salesData, null, 2));
  } catch (err) {
    console.error('Error escribiendo sales.json:', err);
    throw err;
  }
}

// Validar que una transacción existe y fue confirmada
async function validateTransaction(signature, expectedAmount, expectedRecipient) {
  try {
    console.log('🔍 Validando transacción:', signature);
    
    // Obtener información de la transacción
    const tx = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed'
    });
    
    if (!tx) {
      console.log('❌ Transacción no encontrada');
      return { valid: false, error: 'Transacción no encontrada' };
    }
    
    if (tx.meta?.err) {
      console.log('❌ Transacción falló:', tx.meta.err);
      return { valid: false, error: 'Transacción falló en blockchain' };
    }
    
    // Verificar las instrucciones de la transacción
    const instructions = tx.transaction.message.instructions;
    let transferFound = false;
    let transferAmount = 0;
    
    for (const ix of instructions) {
      if (ix.program === 'system' && ix.parsed?.type === 'transfer') {
        const info = ix.parsed.info;
        if (info.destination === expectedRecipient) {
          transferFound = true;
          transferAmount = info.lamports;
          break;
        }
      }
    }
    
    if (!transferFound) {
      console.log('❌ No se encontró transferencia al merchant');
      return { valid: false, error: 'Transferencia no encontrada' };
    }
    
    // Permitir una pequeña variación por fees (1%)
    const expectedLamports = expectedAmount * solanaWeb3.LAMPORTS_PER_SOL;
    const tolerance = expectedLamports * 0.01;
    
    if (Math.abs(transferAmount - expectedLamports) > tolerance) {
      console.log(`❌ Monto incorrecto: esperado ${expectedLamports}, recibido ${transferAmount}`);
      return { 
        valid: false, 
        error: `Monto incorrecto: esperado ${expectedAmount} SOL, recibido ${transferAmount / solanaWeb3.LAMPORTS_PER_SOL} SOL` 
      };
    }
    
    console.log('✅ Transacción válida');
    return { 
      valid: true, 
      amount: transferAmount / solanaWeb3.LAMPORTS_PER_SOL,
      blockTime: tx.blockTime
    };
    
  } catch (err) {
    console.error('Error validando transacción:', err);
    return { valid: false, error: 'Error al validar transacción: ' + err.message };
  }
}

// Verificar que los bloques no estén ocupados
function checkBlocksAvailable(selection, existingSales) {
  for (const sale of existingSales) {
    const existingSel = sale.metadata?.selection;
    if (!existingSel) continue;
    
    // Detectar overlap
    const overlap = !(
      selection.minBlockX + selection.blocksX <= existingSel.minBlockX ||
      selection.minBlockX >= existingSel.minBlockX + existingSel.blocksX ||
      selection.minBlockY + selection.blocksY <= existingSel.minBlockY ||
      selection.minBlockY >= existingSel.minBlockY + existingSel.blocksY
    );
    
    if (overlap) {
      return false;
    }
  }
  return true;
}

// ==============================
// MULTER PARA SUBIDA DE ARCHIVOS
// ==============================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes'));
    }
  }
});

// ==============================
// API ENDPOINTS
// ==============================

// GET /api/config - Configuración pública (SIN secretos)
app.get('/api/config', (req, res) => {
  res.json({
    ok: true,
    merchantWallet: MERCHANT_WALLET,
    cluster: CLUSTER,
    pricePerBlock: 0.0001
  });
});

// GET /api/sales - Obtener todas las ventas
app.get('/api/sales', (req, res) => {
  try {
    const sales = readSales();
    res.json(sales);
  } catch (err) {
    console.error('Error en /api/sales:', err);
    res.status(500).json({ ok: false, error: 'Error al obtener ventas' });
  }
});

// POST /api/upload-logo - Subir logo
app.post('/api/upload-logo', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se recibió archivo' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    
    console.log('✅ Logo subido:', req.file.filename);
    
    res.json({
      ok: true,
      url: fileUrl,
      filename: req.file.filename
    });
  } catch (err) {
    console.error('Error en /api/upload-logo:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/verify-transaction - Verificar transacción
app.post('/api/verify-transaction', async (req, res) => {
  try {
    const { signature } = req.body;

    if (!signature) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Signature requerida' 
      });
    }

    console.log('🔍 Verificando transacción:', signature);

    // Obtener estado de la transacción
    const status = await connection.getSignatureStatus(signature);

    if (!status || !status.value) {
      return res.json({
        ok: true,
        confirmed: false,
        status: null
      });
    }

    const confirmed = status.value.confirmationStatus === 'confirmed' || 
                     status.value.confirmationStatus === 'finalized';

    res.json({
      ok: true,
      confirmed,
      status: status.value,
      confirmationStatus: status.value.confirmationStatus,
      err: status.value.err
    });

  } catch (err) {
    console.error('Error verificando transacción:', err);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al verificar transacción' 
    });
  }
});

// POST /api/get-latest-blockhash - Obtener blockhash
app.post('/api/get-latest-blockhash', async (req, res) => {
  try {
    const latestBlockhash = await connection.getLatestBlockhash('finalized');
    
    res.json({
      ok: true,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
    });
  } catch (err) {
    console.error('Error obteniendo blockhash:', err);
    res.status(500).json({ 
      ok: false, 
      error: 'Error al obtener blockhash' 
    });
  }
});

// POST /api/save-sale - Guardar venta (CON VALIDACIÓN DE TRANSACCIÓN)
app.post('/api/save-sale', async (req, res) => {
  const lockKey = 'save-sale';
  
  try {
    const { signature, buyer, metadata, amount, timestamp } = req.body;

    // Validación de datos
    if (!signature || !buyer || !metadata || !amount) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Faltan datos requeridos' 
      });
    }

    // Adquirir lock
    if (!acquireLock(lockKey, 30000)) {
      return res.status(429).json({
        ok: false,
        error: 'Otra compra en proceso, intenta de nuevo en unos segundos'
      });
    }

    console.log('💾 Guardando venta:', signature);

    // Leer ventas actuales
    const salesData = readSales();

    // Verificar si ya existe esta transacción
    const exists = salesData.sales.some(s => s.signature === signature);
    if (exists) {
      console.log('⚠️ Venta duplicada, ignorando:', signature);
      releaseLock(lockKey);
      return res.json({ ok: true, message: 'Venta ya registrada' });
    }

    // Validar selección
    const sel = metadata.selection;
    if (!sel || sel.minBlockX === undefined || sel.minBlockY === undefined || !sel.blocksX || !sel.blocksY) {
      releaseLock(lockKey);
      return res.status(400).json({ 
        ok: false, 
        error: 'Selección inválida' 
      });
    }

    // Verificar que los bloques no estén ocupados
    if (!checkBlocksAvailable(sel, salesData.sales)) {
      console.log('❌ Bloques ocupados');
      releaseLock(lockKey);
      return res.status(409).json({ 
        ok: false, 
        error: 'Los bloques seleccionados ya están ocupados' 
      });
    }

    // VALIDAR TRANSACCIÓN EN BLOCKCHAIN
    console.log('🔍 Validando transacción en blockchain...');
    const validation = await validateTransaction(signature, amount, MERCHANT_WALLET);
    
    if (!validation.valid) {
      console.log('❌ Transacción inválida:', validation.error);
      releaseLock(lockKey);
      return res.status(400).json({
        ok: false,
        error: validation.error || 'Transacción inválida'
      });
    }

    console.log('✅ Transacción validada correctamente');

    // Añadir nueva venta
    const newSale = {
      signature,
      buyer,
      metadata,
      amountSOL: validation.amount,
      timestamp: timestamp || Date.now(),
      blockTime: validation.blockTime,
      createdAt: new Date().toISOString(),
      validated: true
    };

    salesData.sales.push(newSale);

    // Guardar
    writeSales(salesData);

    console.log('✅ Venta guardada exitosamente');

    releaseLock(lockKey);

    res.json({ 
      ok: true, 
      message: 'Venta registrada exitosamente',
      sale: newSale
    });

  } catch (err) {
    console.error('Error en /api/save-sale:', err);
    releaseLock(lockKey);
    res.status(500).json({ 
      ok: false, 
      error: err.message || 'Error al guardar la venta' 
    });
  }
});

// GET /api/stats - Estadísticas
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
        totalSOL: totalSOL.toFixed(4),
        totalPixels,
        percentageSold: ((totalPixels / 1000000) * 100).toFixed(2)
      }
    });
  } catch (err) {
    console.error('Error en /api/stats:', err);
    res.status(500).json({ ok: false, error: 'Error al obtener estadísticas' });
  }
});

// GET /api/health - Health check
app.get('/api/health', async (req, res) => {
  try {
    // Verificar conexión con Solana
    const slot = await connection.getSlot();
    
    res.json({
      ok: true,
      status: 'healthy',
      cluster: CLUSTER,
      currentSlot: slot,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      status: 'unhealthy',
      error: err.message
    });
  }
});

// ==============================
// FALLBACK SPA
// ==============================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==============================
// MANEJO DE ERRORES
// ==============================
app.use((err, req, res, next) => {
  console.error('❌ Error no manejado:', err);
  res.status(500).json({
    ok: false,
    error: 'Error interno del servidor'
  });
});

// ==============================
// INICIAR SERVIDOR
// ==============================
app.listen(PORT, () => {
  console.log(`\n✅ Servidor iniciado en puerto ${PORT}`);
  console.log(`🌐 Accede en: http://localhost:${PORT}`);
  console.log(`📂 Uploads: ${UPLOADS_DIR}`);
  console.log(`💾 Sales: ${SALES_FILE}`);
  console.log(`🔒 Persistent storage: ${USE_PERSISTENT ? 'ACTIVADO ✅' : 'DESACTIVADO ⚠️'}\n`);
  console.log('🔐 Sistema de locks activado');
  console.log('✅ Validación de transacciones activada\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM recibido, cerrando servidor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT recibido, cerrando servidor...');
  process.exit(0);
});
