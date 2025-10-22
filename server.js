/**
 * server.js - PRODUCTION VERSION
 * 
 * Express server para Solana Million Grid
 * - Subida de logos (local o IPFS)
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
const DEFAULT_MERCHANT = process.env.MERCHANT_WALLET || 'CEBiKkD8q6F28byTb9iVqPUiojv9n5bHEW5wEJJpVAQE';
const CLUSTER = process.env.CLUSTER || 'mainnet-beta'; // ← Cambiar de mainnet-beta a devnet
const RPC_URL = process.env.RPC_URL || solanaWeb3.clusterApiUrl(CLUSTER);
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'production';

const SALES_FILE = path.resolve(__dirname, 'sales.json');
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');
const BACKUPS_DIR = path.resolve(__dirname, 'backups');
const LAMPORTS_PER_SOL = solanaWeb3.LAMPORTS_PER_SOL || 1000000000;
const MEMO_PROGRAM_ID = new solanaWeb3.PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

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
console.log(`   Cluster: ${CLUSTER}`);
console.log(`   RPC: ${RPC_URL}`);
console.log(`   Merchant: ${DEFAULT_MERCHANT}`);
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
    
    const url = `/uploads/${encodeURIComponent(finalName)}`;
    console.log(`📤 Logo subido: ${finalName}`);
    
    return res.json({ 
      ok: true, 
      url, 
      name: finalName 
    });
  } catch (err) {
    console.error('❌ Error subiendo logo:', err);
    return res.status(500).json({ 
      ok: false, 
      error: err.message || 'Error al subir el archivo' 
    });
  }
});

// ============================================
// PARSEAR MEMO (CORREGIDO)
// ============================================
function parseMemoFromTx(tx) {
  try {
    const message = tx.transaction.message;
    const accountKeys = message.accountKeys.map(k => k.toString());
    const instructions = message.instructions || [];
    
    for (const instr of instructions) {
      const programId = accountKeys[instr.programIdIndex];
      if (programId === MEMO_PROGRAM_ID.toString()) {
        try {
          // Intentar decodificar desde base64 primero
          const buffer = Buffer.from(instr.data, 'base64');
          const txt = buffer.toString('utf8');
          try {
            return { raw: txt, json: JSON.parse(txt) };
          } catch {
            return { raw: txt, json: null };
          }
        } catch {
          // Fallback a base58 si falla base64
          try {
            const buffer = bs58.decode(instr.data);
            const txt = buffer.toString('utf8');
            try {
              return { raw: txt, json: JSON.parse(txt) };
            } catch {
              return { raw: txt, json: null };
            }
          } catch {
            console.warn('⚠️ No se pudo decodificar el memo');
          }
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
    // Obtener transacción
    const tx = await connection.getTransaction(signature, { 
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });
    
    if (!tx) {
      console.log(`❌ Transacción no encontrada`);
      return res.status(404).json({ 
        ok: false, 
        error: 'Transacción no encontrada o aún no confirmada. Espera unos segundos.' 
      });
    }
    
    console.log(`   ✅ Transacción encontrada`);
    console.log(`   🔗 Solscan: https://solscan.io/tx/${signature}`);
    
    // Verificar que el merchant esté en la transacción
    const accountKeys = tx.transaction.message.accountKeys.map(k => k.toString());
    const merchantIndex = accountKeys.findIndex(k => 
      k === (new solanaWeb3.PublicKey(DEFAULT_MERCHANT)).toString()
    );
    
    if (merchantIndex < 0) {
      console.log(`❌ Merchant no encontrado en la transacción`);
      return res.status(400).json({ 
        ok: false, 
        error: 'La transacción no incluye la wallet del merchant' 
      });
    }
    
    // Verificar balances
    if (!tx.meta || !tx.meta.preBalances || !tx.meta.postBalances) {
      console.log(`❌ No hay información de balances`);
      return res.status(400).json({ 
        ok: false, 
        error: 'No se pudo verificar el monto de la transacción' 
      });
    }
    
    const pre = tx.meta.preBalances[merchantIndex];
    const post = tx.meta.postBalances[merchantIndex];
    const lamportsReceived = post - pre;
    const expectedLamports = Math.round(expectedAmountSOL * LAMPORTS_PER_SOL);
    
    console.log(`   💰 Lamports recibidos: ${lamportsReceived}`);
    console.log(`   💰 Lamports esperados: ${expectedLamports}`);
    
    if (lamportsReceived < expectedLamports) {
      console.log(`❌ Monto insuficiente`);
      return res.status(400).json({ 
        ok: false, 
        error: `Monto insuficiente: se recibieron ${(lamportsReceived / LAMPORTS_PER_SOL).toFixed(4)} SOL, se esperaban ${expectedAmountSOL} SOL` 
      });
    }
    
    // Parsear memo
    const memo = parseMemoFromTx(tx);
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
      console.log(`   📝 Memo parseado: ${memoMatches ? '✅' : '⚠️ no coincide'}`);
    }
    
    // Guardar venta
    const sale = {
      signature,
      amountSOL: expectedAmountSOL,
      lamportsReceived,
      merchant: DEFAULT_MERCHANT,
      metadata,
      memo: memo ? memo.raw : null,
      memoParsed: memo ? memo.json : null,
      memoMatches,
      timestamp: new Date().toISOString()
    };
    
    appendSale(sale);
    
    console.log(`✅ Compra verificada y guardada\n`);
    
    return res.json({ 
      ok: true, 
      message: 'Compra verificada y registrada', 
      sale, 
      memoMatches,
      explorerUrl: `https://solscan.io/tx/${signature}`
    });
    
  } catch (err) {
    console.error('❌ Error verificando transacción:', err);
    return res.status(500).json({ 
      ok: false, 
      error: err.message || 'Error al verificar la transacción' 
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