require('dotenv').config(); // Cargar variables de .env

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');

const app = express();
const PORT = process.env.PORT || 10000;

// ===== CONFIGURACIÓN =====
const CLUSTER = process.env.CLUSTER || 'mainnet-beta';
const MERCHANT_WALLET = process.env.MERCHANT_WALLET;
const RPC_URL = process.env.RPC_URL;

// Validar configuración crítica
if (!MERCHANT_WALLET || MERCHANT_WALLET === 'TU_WALLET_AQUI') {
  console.error('❌ ERROR CRÍTICO: MERCHANT_WALLET no está configurada');
  console.error('⚠️  Configura la variable de entorno MERCHANT_WALLET en Render');
  console.error('📝 Ejemplo: MERCHANT_WALLET=3d7w4r4irLaKVYd4dLjpoiehJVawbbXWFWb1bCk9nGCo');
  process.exit(1); // Detener servidor si no hay wallet
}

// Validar formato de wallet
try {
  new PublicKey(MERCHANT_WALLET);
  console.log('✅ MERCHANT_WALLET válida:', MERCHANT_WALLET);
} catch (err) {
  console.error('❌ ERROR: MERCHANT_WALLET tiene formato inválido:', MERCHANT_WALLET);
  console.error('⚠️  Debe ser una dirección válida de Solana (base58)');
  process.exit(1);
}

// Rutas de almacenamiento persistente
const PERSISTENT_DIR = process.env.PERSISTENT_DIR || 
                       (process.env.RENDER ? '/persistent' : path.join(__dirname, 'persistent'));
const UPLOADS_DIR = path.join(PERSISTENT_DIR, 'uploads');
const SALES_FILE = path.join(PERSISTENT_DIR, 'sales.json');

// ===== INICIALIZACIÓN: CREAR CARPETAS Y ARCHIVOS SI NO EXISTEN =====
function initializeStorage() {
  try {
    // Crear directorio persistent si no existe
    if (!fs.existsSync(PERSISTENT_DIR)) {
      fs.mkdirSync(PERSISTENT_DIR, { recursive: true });
      console.log('✅ Directorio persistent creado');
    }
    
    // Crear directorio uploads si no existe
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      console.log('✅ Directorio uploads creado');
    }
    
    // Crear sales.json si no existe
    if (!fs.existsSync(SALES_FILE)) {
      fs.writeFileSync(SALES_FILE, JSON.stringify({ sales: [] }, null, 2));
      console.log('✅ Archivo sales.json creado');
    }
    
    console.log('✅ Sistema de almacenamiento inicializado correctamente');
  } catch (err) {
    console.error('❌ Error inicializando almacenamiento:', err);
    // No lanzar error, continuar la ejecución
  }
}

// Inicializar al arrancar
initializeStorage();

// ===== CONEXIÓN SOLANA =====
let connection;
if (RPC_URL) {
  console.log('🔗 Usando RPC personalizado (Helius)');
  connection = new Connection(RPC_URL, 'confirmed');
} else {
  console.log(`🔗 Usando RPC público: ${CLUSTER}`);
  connection = new Connection(clusterApiUrl(CLUSTER), 'confirmed');
}

console.log(`🌐 Cluster configurado: ${CLUSTER}`);
console.log(`💰 Wallet del comerciante: ${MERCHANT_WALLET}`);
console.log(`⚠️  MODO PRODUCCIÓN: Transacciones con SOL REAL`);

// ===== MIDDLEWARE =====
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Servir archivos estáticos
app.use(express.static('public'));
app.use('/uploads', express.static(UPLOADS_DIR));

// ===== CONFIGURACIÓN MULTER =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (jpg, png, gif, webp)'));
    }
  }
});

// ===== FUNCIONES DE PERSISTENCIA =====
function readSales() {
  try {
    if (!fs.existsSync(SALES_FILE)) {
      console.log('⚠️ sales.json no existe, creándolo...');
      const emptyData = { sales: [] };
      fs.writeFileSync(SALES_FILE, JSON.stringify(emptyData, null, 2));
      return emptyData;
    }
    
    const data = fs.readFileSync(SALES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('❌ Error leyendo sales.json:', err);
    return { sales: [] };
  }
}

function writeSales(data) {
  try {
    if (!fs.existsSync(PERSISTENT_DIR)) {
      fs.mkdirSync(PERSISTENT_DIR, { recursive: true });
    }
    
    fs.writeFileSync(SALES_FILE, JSON.stringify(data, null, 2));
    console.log('✅ sales.json guardado correctamente');
    return true;
  } catch (err) {
    console.error('❌ Error guardando sales.json:', err);
    return false;
  }
}

// ===== ENDPOINTS =====

// Favicon (evitar error 404)
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Endpoint de configuración
app.get('/api/config', (req, res) => {
  res.json({
    ok: true,
    cluster: CLUSTER,
    merchantWallet: MERCHANT_WALLET,
    isMainnet: CLUSTER === 'mainnet-beta'
  });
});

// Subir logo
app.post('/api/upload-logo', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se subió ningún archivo' });
    }
    
    const fileUrl = `/uploads/${req.file.filename}`;
    console.log('✅ Logo subido:', fileUrl);
    
    res.json({ ok: true, url: fileUrl });
  } catch (err) {
    console.error('❌ Error subiendo logo:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Obtener blockhash reciente
app.post('/api/get-latest-blockhash', async (req, res) => {
  try {
    const { blockhash } = await connection.getLatestBlockhash('finalized');
    console.log('✅ Blockhash obtenido:', blockhash);
    res.json({ ok: true, blockhash });
  } catch (err) {
    console.error('❌ Error obteniendo blockhash:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Verificar transacción
app.post('/api/verify-transaction', async (req, res) => {
  try {
    const { signature } = req.body;
    
    if (!signature) {
      return res.status(400).json({ ok: false, error: 'Falta signature' });
    }
    
    console.log('🔍 Verificando transacción:', signature);
    
    const status = await connection.getSignatureStatus(signature);
    
    if (!status || !status.value) {
      return res.json({ ok: true, confirmed: false });
    }
    
    const confirmed = status.value.confirmationStatus === 'confirmed' || 
                      status.value.confirmationStatus === 'finalized';
    
    console.log('📊 Status:', status.value.confirmationStatus, '| Confirmado:', confirmed);
    
    res.json({
      ok: true,
      confirmed: confirmed,
      status: status.value
    });
    
  } catch (err) {
    console.error('❌ Error verificando transacción:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Guardar venta
app.post('/api/save-sale', (req, res) => {
  try {
    const saleData = req.body;
    
    // Validar datos básicos
    if (!saleData.signature || !saleData.buyer || !saleData.metadata) {
      return res.status(400).json({ ok: false, error: 'Datos incompletos' });
    }
    
    // Validar que la selección no solape con ventas existentes
    const data = readSales();
    const newSel = saleData.metadata.selection;
    
    for (const sale of data.sales) {
      const existingSel = sale.metadata.selection;
      
      // Verificar solapamiento
      const overlapX = !(newSel.minBlockX > existingSel.minBlockX + existingSel.blocksX - 1 ||
                         newSel.minBlockX + newSel.blocksX - 1 < existingSel.minBlockX);
      const overlapY = !(newSel.minBlockY > existingSel.minBlockY + existingSel.blocksY - 1 ||
                         newSel.minBlockY + newSel.blocksY - 1 < existingSel.minBlockY);
      
      if (overlapX && overlapY) {
        console.log('❌ Intento de compra sobre bloques ocupados');
        return res.status(400).json({ 
          ok: false, 
          error: 'Algunos bloques ya están ocupados. Por favor recarga la página.' 
        });
      }
    }
    
    console.log('💾 Guardando venta:', saleData.signature);
    
    // Verificar si ya existe
    const exists = data.sales.some(s => s.signature === saleData.signature);
    if (exists) {
      console.log('⚠️ Venta duplicada, ignorando');
      return res.json({ ok: true, message: 'Venta ya registrada' });
    }
    
    // Agregar venta
    data.sales.push(saleData);
    
    const saved = writeSales(data);
    
    if (!saved) {
      return res.status(500).json({ ok: false, error: 'Error guardando venta' });
    }
    
    console.log('✅ Venta guardada. Total ventas:', data.sales.length);
    console.log('💰 Monto:', saleData.amount, 'SOL');
    
    res.json({ ok: true, message: 'Venta guardada correctamente' });
    
  } catch (err) {
    console.error('❌ Error guardando venta:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Obtener todas las ventas
app.get('/api/sales', (req, res) => {
  try {
    const data = readSales();
    console.log('📊 Enviando ventas:', data.sales.length);
    res.json({ ok: true, sales: data.sales });
  } catch (err) {
    console.error('❌ Error obteniendo ventas:', err);
    res.status(500).json({ ok: false, error: err.message, sales: [] });
  }
});

// Health check
app.get('/health', (req, res) => {
  const data = readSales();
  const totalRevenue = data.sales.reduce((sum, sale) => sum + (sale.amount || 0), 0);
  
  res.json({ 
    ok: true, 
    status: 'Server running',
    cluster: CLUSTER,
    isMainnet: CLUSTER === 'mainnet-beta',
    timestamp: new Date().toISOString(),
    salesCount: data.sales.length,
    totalRevenue: totalRevenue.toFixed(4) + ' SOL',
    merchantWallet: MERCHANT_WALLET
  });
});

// Endpoint para estadísticas (opcional)
app.get('/api/stats', (req, res) => {
  try {
    const data = readSales();
    
    let goldSold = 0, silverSold = 0, bronzeSold = 0;
    let totalRevenue = 0;
    
    data.sales.forEach(sale => {
      const sel = sale.metadata.selection;
      const blocksTotal = sel.blocksX * sel.blocksY;
      
      // Determinar zona
      if (sel.minBlockY <= 24) {
        goldSold += blocksTotal;
      } else if (sel.minBlockY >= 25 && sel.minBlockY <= 59) {
        silverSold += blocksTotal;
      } else {
        bronzeSold += blocksTotal;
      }
      
      totalRevenue += sale.amount || 0;
    });
    
    res.json({
      ok: true,
      goldSold,
      silverSold,
      bronzeSold,
      totalSales: data.sales.length,
      totalRevenue: totalRevenue.toFixed(4)
    });
  } catch (err) {
    console.error('❌ Error obteniendo stats:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ===== MANEJO DE ERRORES =====
app.use((err, req, res, next) => {
  console.error('❌ Error no manejado:', err);
  res.status(500).json({ ok: false, error: err.message });
});

// ===== INICIAR SERVIDOR =====
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📁 Directorio persistent: ${PERSISTENT_DIR}`);
  console.log(`🖼️  Directorio uploads: ${UPLOADS_DIR}`);
  console.log(`📄 Archivo sales: ${SALES_FILE}`);
  console.log(`🌐 Cluster: ${CLUSTER}`);
  console.log(`💰 Wallet: ${MERCHANT_WALLET}`);
  console.log(`⚠️  MODO: ${CLUSTER === 'mainnet-beta' ? '🔴 PRODUCCIÓN (SOL REAL)' : '🟡 DESARROLLO (SOL FALSO)'}\n`);
});
