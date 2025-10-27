/**
 * server.js - PRODUCTION VERSION COMPLETO
 */

require('dotenv').config();

// Parsear APP_CONFIG si existe
if (process.env.APP_CONFIG) {
  try {
    const config = JSON.parse(process.env.APP_CONFIG);
    // Asignar cada propiedad como variable de entorno
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

// Usar disco persistente si está disponible, si no usar local
const PERSISTENT_DIR = process.env.PERSISTENT_DIR || '/persistent';
const USE_PERSISTENT = fs.existsSync(PERSISTENT_DIR);

const UPLOADS_DIR = USE_PERSISTENT 
  ? path.join(PERSISTENT_DIR, 'uploads')
  : path.resolve(__dirname, 'uploads');
  
const SALES_FILE = USE_PERSISTENT
  ? path.join(PERSISTENT_DIR, 'sales.json')
  : path.resolve(__dirname, 'sales.json');

const CLUSTER = process.env.CLUSTER || 'mainnet-beta';
const RPC_URL = process.env.RPC_URL || solanaWeb3.clusterApiUrl(CLUSTER);
const MERCHANT_WALLET = process.env.MERCHANT_WALLET || '3d7w4r4irLaKVYd4dLjpoiehJVawbbXWFWb1bCk9nGCo';

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

const connection = new solanaWeb3.Connection(RPC_URL, 'confirmed');

console.log('🚀 Configuración:');
console.log(`   Cluster: ${CLUSTER}`);
console.log(`   RPC: ${RPC_URL}`);
console.log(`   Merchant: ${MERCHANT_WALLET}`);
console.log(`   Puerto: ${PORT}`);

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

// POST /api/save-sale - Guardar venta
app.post('/api/save-sale', async (req, res) => {
  try {
    const { signature, buyer, metadata, amount, timestamp } = req.body;

    if (!signature || !buyer || !metadata || !amount) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Faltan datos requeridos' 
      });
    }

    console.log('💾 Guardando venta:', signature);

    // Leer ventas actuales
    const salesData = readSales();

    // Verificar si ya existe esta transacción
    const exists = salesData.sales.some(s => s.signature === signature);
    if (exists) {
      console.log('⚠️ Venta duplicada, ignorando:', signature);
      return res.json({ ok: true, message: 'Venta ya registrada' });
    }

    // Validar selección
    const sel = metadata.selection;
    if (!sel || !sel.minBlockX === undefined || !sel.minBlockY === undefined || !sel.blocksX || !sel.blocksY) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Selección inválida' 
      });
    }

    // Verificar que los bloques no estén ocupados
    for (const sale of salesData.sales) {
      const existingSel = sale.metadata?.selection;
      if (!existingSel) continue;

      // Detectar overlap
      const overlap = !(
        sel.minBlockX + sel.blocksX <= existingSel.minBlockX ||
        sel.minBlockX >= existingSel.minBlockX + existingSel.blocksX ||
        sel.minBlockY + sel.blocksY <= existingSel.minBlockY ||
        sel.minBlockY >= existingSel.minBlockY + existingSel.blocksY
      );

      if (overlap) {
        console.log('❌ Bloques ocupados');
        return res.status(409).json({ 
          ok: false, 
          error: 'Los bloques seleccionados ya están ocupados' 
        });
      }
    }

    // Añadir nueva venta
    const newSale = {
      signature,
      buyer,
      metadata,
      amountSOL: amount,
      timestamp: timestamp || Date.now(),
      createdAt: new Date().toISOString()
    };

    salesData.sales.push(newSale);

    // Guardar
    writeSales(salesData);

    console.log('✅ Venta guardada exitosamente');

    res.json({ 
      ok: true, 
      message: 'Venta registrada exitosamente',
      sale: newSale
    });

  } catch (err) {
    console.error('Error en /api/save-sale:', err);
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
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    status: 'healthy',
    cluster: CLUSTER,
    timestamp: new Date().toISOString()
  });
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
