/**
 * server.js - PRODUCTION VERSION (Local Storage Only)
 * * Express server para Solana Million Grid
 * - Subida de logos LOCAL (sin IPFS)
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

const SALES_FILE = path.resolve(__dirname, 'sales.json');
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');
const BACKUPS_DIR = path.resolve(__dirname, 'backups');
const LAMPORTS_PER_SOL = solanaWeb3.LAMPORTS_PER_SOL || 1000000000;
// const MEMO_PROGRAM_ID = new solanaWeb3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'); // ❌ ELIMINADA

// Crear directorios necesarios
[UPLOADS_DIR, BACKUPS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Crear sales.json si no existe
if (!fs.existsSync(SALES_FILE)) {
  fs.writeFileSync(SALES_FILE, JSON.stringify({ sales: [] }, null, 2));
}

const connection = new solanaWeb3.Connection(RPC_URL, 'confirmed');

console.log('🚀 Configuración:');
console.log(`   Cluster: ${CLUSTER}`);
console.log(`   RPC: ${RPC_URL}`);
console.log(`   Merchant: ${DEFAULT_MERCHANT}`);
console.log(`   Storage: Local (uploads/)`);
console.log(`   Entorno: ${NODE_ENV}`);

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
// API: SUBIR LOGO
// ============================================
app.post('/api/upload-logo', diskUpload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se recibió ningún archivo' });
    }
    
    const originalName = req.file.originalname;
    const tmpPath = req.file.path;
    
    // Generar nombre único
    const timestamp = Date.now();
    const ext = path.extname(originalName);
    const safeName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const finalName = `${timestamp}_${safeName}`;
    const targetPath = path.join(UPLOADS_DIR, finalName);
    
    fs.renameSync(tmpPath, targetPath);
    
    // Generar URL completa
    let fullUrl;
    if (BASE_URL) {
      fullUrl = `${BASE_URL}/uploads/${encodeURIComponent(finalName)}`;
    } else {
      const protocol = req.protocol;
      const host = req.get('host');
      fullUrl = `${protocol}://${host}/uploads/${encodeURIComponent(finalName)}`;
    }
    
    console.log(`📤 Logo guardado: ${finalName}`);
    console.log(`🔗 URL completa: ${fullUrl}`);
    
    return res.json({ 
      ok: true, 
      url: fullUrl,
      name: finalName
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
/* ❌ ELIMINADA para evitar fallos por rent fee */
// function parseMemoFromParsedTx(tx) { ... }


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

// ============================================
// API: VERIFICAR COMPRA (✅ CORREGIDO - SIN MEMO)
// ============================================
app.post('/api/verify-purchase', async (req, res) => {
  const { signature, expectedAmountSOL, metadata } = req.body || {};
  
  console.log(`\n🔍 Verificando compra:`);
  console.log(`   Signature: ${signature}`);
  console.log(`   Proyecto: ${metadata?.name}`);
  console.log(`   Monto esperado: ${expectedAmountSOL} SOL`);
  
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
    // Usar getParsedTransaction para obtener detalles
    console.log('   ⏳ Obteniendo transacción parseada...');
    
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
    
    console.log(`   ✅ Transacción encontrada`);
    console.log(`   🔗 Explorer: https://solscan.io/tx/${signature}?cluster=${CLUSTER}`);
    
    // Verificar que no haya error en la transacción
    if (tx.meta.err) {
      console.log(`❌ Transacción falló en la blockchain`);
      return res.status(400).json({ 
        ok: false, 
        error: 'La transacción falló en la blockchain' 
      });
    }
    
    // Buscar la instrucción de transferencia parseada (System Program)
    const instructions = tx.transaction.message.instructions;
    let transferFound = false;
    let amountReceived = 0;
    
    console.log(`   🔍 Analizando ${instructions.length} instrucciones...`);
    
    for (const ix of instructions) {
      // Verificar si es una transferencia del System Program
      if (ix.programId.toString() === '11111111111111111111111111111111') {
        if (ix.parsed && ix.parsed.type === 'transfer') {
          const info = ix.parsed.info;
          
          // Verificar que el destinatario es nuestro merchant wallet
          if (info.destination === DEFAULT_MERCHANT) {
            transferFound = true;
            amountReceived = info.lamports / LAMPORTS_PER_SOL;
            console.log(`      ✅ Transferencia al merchant confirmada: ${amountReceived} SOL`);
            break;
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
    
    // Verificar el monto con tolerancia mínima
    const tolerance = 0.00001; // Tolerancia de 0.00001 SOL
    const difference = Math.abs(amountReceived - expectedAmountSOL);
    
    console.log(`   💰 Verificando monto:`);
    console.log(`      Esperado: ${expectedAmountSOL} SOL`);
    console.log(`      Recibido: ${amountReceived} SOL`);
    
    if (difference > tolerance) {
      console.log(`❌ Monto insuficiente`);
      return res.status(400).json({ 
        ok: false, 
        error: `Monto insuficiente: se recibieron ${amountReceived.toFixed(4)} SOL, se esperaban ${expectedAmountSOL} SOL` 
      });
    }
    
    console.log(`   ✅ Verificación de monto exitosa`);
    
    // Obtener el buyer (primera cuenta de la transacción)
    const buyer = tx.transaction.message.accountKeys[0].pubkey 
      ? tx.transaction.message.accountKeys[0].pubkey.toString() 
      : tx.transaction.message.accountKeys[0].toString();
    
    // Guardar venta
    const sale = {
      signature,
      buyer,
      amountSOL: amountReceived,
      merchant: DEFAULT_MERCHANT,
      metadata,
      // memo y memoMatches ya no se guardan
      timestamp: new Date().toISOString(),
      blockTime: tx.blockTime
    };
    
    appendSale(sale);
    
    console.log(`✅ Compra verificada y guardada\n`);
    
    return res.json({ 
      ok: true, 
      message: 'Compra verificada y registrada', 
      sale, 
      explorerUrl: `https://solscan.io/tx/${signature}?cluster=${CLUSTER}`
    });
    
  } catch (err) {
    console.error('❌ Error verificando transacción:', err);
    console.error('Error completo:', {
      message: err.message,
      name: err.name,
      stack: NODE_ENV === 'development' ? err.stack : '(hidden in production)'
    });
    
    return res.status(500).json({ 
      ok: false, 
      error: err.message || 'Error al verificar la transacción',
      details: NODE_ENV === 'development' ? err.stack : undefined
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
    storage: 'local',
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
