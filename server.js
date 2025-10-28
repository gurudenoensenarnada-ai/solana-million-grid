require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== CONFIGURACIÓN =====
const CLUSTER = process.env.CLUSTER || 'mainnet-beta';
const MERCHANT_WALLET = process.env.MERCHANT_WALLET;
const RPC_URL = process.env.RPC_URL;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const OWNER_WALLET = 'B7nB9QX1KC4QXp5GMxR8xzh3yzoqp6NjxSwfNBXtgPc1';

// Validar configuración crítica
if (!MERCHANT_WALLET || MERCHANT_WALLET === 'TU_WALLET_AQUI') {
  console.error('❌ ERROR CRÍTICO: MERCHANT_WALLET no está configurada');
  console.error('⚠️  Configura la variable de entorno MERCHANT_WALLET en Render');
  console.error('📝 Ejemplo: MERCHANT_WALLET=3d7w4r4irLaKVYd4dLjpoiehJVawbbXWFWb1bCk9nGCo');
  process.exit(1);
}

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

// ===== INICIALIZACIÓN =====
function initializeStorage() {
  try {
    if (!fs.existsSync(PERSISTENT_DIR)) {
      fs.mkdirSync(PERSISTENT_DIR, { recursive: true });
      console.log('✅ Directorio persistent creado');
    }
    
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      console.log('✅ Directorio uploads creado');
    }
    
    if (!fs.existsSync(SALES_FILE)) {
      fs.writeFileSync(SALES_FILE, JSON.stringify({ sales: [] }, null, 2));
      console.log('✅ Archivo sales.json creado');
    }
    
    console.log('✅ Sistema de almacenamiento inicializado correctamente');
  } catch (err) {
    console.error('❌ Error inicializando almacenamiento:', err);
  }
}

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
console.log(`⭐ Wallet del owner: ${OWNER_WALLET}`);
console.log(`⚠️  MODO PRODUCCIÓN: Transacciones con SOL REAL`);

if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
  console.log('✅ Notificaciones de Telegram activadas');
  console.log(`📱 Chat ID: ${TELEGRAM_CHAT_ID}`);
} else {
  console.log('⚠️  Notificaciones de Telegram desactivadas (falta configuración)');
}

// ===== REDIRECCIÓN WWW =====
app.use((req, res, next) => {
  const host = req.get('host');
  
  if (host && !host.startsWith('www.') && !host.startsWith('localhost')) {
    console.log(`🔀 Redirigiendo: ${host} → www.${host}`);
    return res.redirect(301, `https://www.${host}${req.originalUrl}`);
  }
  
  next();
});

// ===== MIDDLEWARE =====
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Servir archivos estáticos
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOADS_DIR));

// Ruta específica para el index
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error - Archivo no encontrado</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            background: #0a0a0a; 
            color: #fff; 
            display: flex; 
            align-items: center; 
            justify-content: center; 
            height: 100vh; 
            margin: 0;
            text-align: center;
          }
          .error-box {
            background: #1a1a2e;
            padding: 40px;
            border-radius: 10px;
            border: 2px solid gold;
            max-width: 600px;
          }
          h1 { color: gold; }
          code { 
            background: #333; 
            padding: 2px 8px; 
            border-radius: 4px; 
            color: #ffd700;
          }
          .path { color: #aaa; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="error-box">
          <h1>❌ Error 404</h1>
          <p>No se encontró el archivo <code>index.html</code></p>
          <p>Por favor asegúrate de que el archivo existe en:</p>
          <div class="path">${indexPath}</div>
        </div>
      </body>
      </html>
    `);
  }
});

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
  limits: { fileSize: 5 * 1024 * 1024 },
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

// ===== FUNCIONES DE TELEGRAM (ARREGLADO - ESCAPE COMPLETO) =====
function escapeMarkdownV2(text) {
  // Escapar TODOS los caracteres especiales de MarkdownV2
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

async function sendTelegramNotification(saleData) {
  console.log('\n🔍 === DEBUG TELEGRAM ===');
  console.log('TELEGRAM_BOT_TOKEN existe?', !!TELEGRAM_BOT_TOKEN);
  console.log('TELEGRAM_CHAT_ID existe?', !!TELEGRAM_CHAT_ID);
  
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('⚠️ Telegram NO configurado');
    return { ok: true, skipped: true };
  }

  try {
    console.log('📱 Preparando notificación...');
    
    const meta = saleData.metadata;
    const sel = meta.selection;
    
    let zone = '🥉 BRONCE';
    let zoneEmoji = '🥉';
    if (sel.minBlockY <= 24) {
      zone = '🥇 ORO';
      zoneEmoji = '🥇';
    } else if (sel.minBlockY >= 25 && sel.minBlockY <= 59) {
      zone = '🥈 PLATA';
      zoneEmoji = '🥈';
    }
    
    const blocksTotal = sel.blocksX * sel.blocksY;
    const amount = saleData.amount.toFixed(4);
    const isOwnerWallet = saleData.buyer === OWNER_WALLET;
    
    // 🔧 Escapar TODOS los datos
    const safeName = escapeMarkdownV2(meta.name);
    const safeUrl = escapeMarkdownV2(meta.url);
    const safeAmount = escapeMarkdownV2(amount);
    const safeBlocksTotal = escapeMarkdownV2(blocksTotal);
    const safeBlocksX = escapeMarkdownV2(sel.blocksX);
    const safeBlocksY = escapeMarkdownV2(sel.blocksY);
    const safeRow = escapeMarkdownV2(sel.minBlockY + 1);
    const safeCol = escapeMarkdownV2(sel.minBlockX + 1);
    const safeBuyerStart = escapeMarkdownV2(saleData.buyer.substring(0, 8));
    const safeBuyerEnd = escapeMarkdownV2(saleData.buyer.substring(saleData.buyer.length - 8));
    const safeDate = escapeMarkdownV2(new Date(saleData.timestamp).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }));
    
    let message;
    
    if (isOwnerWallet) {
      message = `🎉 *¡NUEVA COMPRA EN SOLANA MILLION GRID\\!*

${zoneEmoji} *Zona:* ${zone}
⭐ *COMPRA DEL OWNER \\- PRECIO ESPECIAL*

📊 *Datos de la compra:*
• Proyecto: *${safeName}*
• URL: ${safeUrl}
• Bloques: *${safeBlocksTotal}* \\(${safeBlocksX}×${safeBlocksY}\\)
• Posición: Fila ${safeRow}, Columna ${safeCol}

💰 *Pago:*
• Monto: *${safeAmount} SOL*
• Precio/bloque: *0\\.0001 SOL* 🌟
• Comprador: \`${safeBuyerStart}\\.\\.\\.${safeBuyerEnd}\`

🔗 *Transacción:*
[Ver en Solscan](https://solscan\\.io/tx/${saleData.signature})

⏰ ${safeDate}`;
    } else {
      message = `🎉 *¡NUEVA COMPRA EN SOLANA MILLION GRID\\!*

${zoneEmoji} *Zona:* ${zone}

📊 *Datos de la compra:*
• Proyecto: *${safeName}*
• URL: ${safeUrl}
• Bloques: *${safeBlocksTotal}* \\(${safeBlocksX}×${safeBlocksY}\\)
• Posición: Fila ${safeRow}, Columna ${safeCol}

💰 *Pago:*
• Monto: *${safeAmount} SOL*
• Comprador: \`${safeBuyerStart}\\.\\.\\.${safeBuyerEnd}\`

🔗 *Transacción:*
[Ver en Solscan](https://solscan\\.io/tx/${saleData.signature})

⏰ ${safeDate}`;
    }

    console.log('📝 Mensaje preparado (longitud:', message.length, 'chars)');

    // Construir URL del logo
    let logoUrl = meta.logo;
    if (!logoUrl.startsWith('http')) {
      const host = process.env.RENDER ? 'https://www.solanamillondollar.com' : 'http://localhost:3000';
      logoUrl = `${host}${meta.logo}`;
    }

    console.log('📷 URL del logo:', logoUrl);

    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
    
    const formData = new URLSearchParams();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('photo', logoUrl);
    formData.append('caption', message);
    formData.append('parse_mode', 'MarkdownV2');

    console.log('🚀 Enviando request a Telegram API...');
    console.log('   Chat ID:', TELEGRAM_CHAT_ID);
    
    const response = await fetch(telegramApiUrl, {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    console.log('📥 Respuesta recibida - Status:', response.status);

    const result = await response.json();
    console.log('📦 Resultado OK:', result.ok);
    
    if (result.ok) {
      console.log('✅ ¡TELEGRAM ENVIADO CORRECTAMENTE!');
      if (isOwnerWallet) {
        console.log('⭐ Era compra del OWNER');
      }
      return { ok: true, sent: true };
    } else {
      console.error('❌ ERROR EN RESPUESTA DE TELEGRAM');
      console.error('   error_code:', result.error_code);
      console.error('   description:', result.description);
      return { ok: false, error: result.description };
    }
  } catch (err) {
    console.error('❌ EXCEPCIÓN EN sendTelegramNotification');
    console.error('   Error:', err.message);
    return { ok: false, error: err.message };
  } finally {
    console.log('=== FIN DEBUG TELEGRAM ===\n');
  }
}

// ===== ENDPOINTS =====

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

app.get('/api/config', (req, res) => {
  res.json({
    ok: true,
    cluster: CLUSTER,
    merchantWallet: MERCHANT_WALLET,
    isMainnet: CLUSTER === 'mainnet-beta'
  });
});

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

// ===== SAVE-SALE CORREGIDO Y MEJORADO =====
app.post('/api/save-sale', async (req, res) => {
  try {
    const saleData = req.body;
    
    console.log('\n=== 💾 NUEVA VENTA RECIBIDA ===');
    console.log('Signature:', saleData.signature);
    console.log('Buyer:', saleData.buyer);
    console.log('Amount:', saleData.amount, 'SOL');
    
    if (!saleData.signature || !saleData.buyer || !saleData.metadata) {
      console.error('❌ Datos incompletos');
      return res.status(400).json({ ok: false, error: 'Datos incompletos' });
    }
    
    const isOwner = saleData.buyer === OWNER_WALLET;
    if (isOwner) {
      console.log('⭐ COMPRA DEL OWNER DETECTADA');
      console.log(`💰 Monto: ${saleData.amount} SOL (precio especial 0.0001 SOL/bloque)`);
    }
    
    // Validar que la selección no solape con ventas existentes
    const data = readSales();
    const newSel = saleData.metadata.selection;
    
    console.log(`📦 Selección: ${newSel.blocksX}x${newSel.blocksY} bloques en (${newSel.minBlockX}, ${newSel.minBlockY})`);
    
    for (const sale of data.sales) {
      const existingSel = sale.metadata.selection;
      
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
    
    console.log('💾 Guardando venta...');
    
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
      console.error('❌ Error guardando archivo sales.json');
      return res.status(500).json({ ok: false, error: 'Error guardando venta' });
    }
    
    console.log('✅ Venta guardada. Total ventas:', data.sales.length);
    console.log('💰 Monto:', saleData.amount, 'SOL');
    
    // 🔧 CRÍTICO: Enviar notificación ANTES de responder
    console.log('📱 Intentando enviar notificación a Telegram...');
    const telegramResult = await sendTelegramNotification(saleData);
    
    if (telegramResult.ok) {
      if (telegramResult.skipped) {
        console.log('⚠️ Telegram no configurado - continuando sin notificación');
      } else if (telegramResult.sent) {
        console.log('✅ ¡Notificación de Telegram enviada exitosamente!');
      }
    } else {
      console.error('❌ Error enviando notificación de Telegram:', telegramResult.error);
      console.error('⚠️ La venta se guardó pero Telegram falló - NO CRÍTICO');
      // NO fallar la venta si Telegram falla
    }
    
    console.log('=== ✅ VENTA COMPLETADA ===\n');
    
    res.json({ ok: true, message: 'Venta guardada correctamente' });
    
  } catch (err) {
    console.error('❌ Error guardando venta:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

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

app.get('/health', (req, res) => {
  const data = readSales();
  const totalRevenue = data.sales.reduce((sum, sale) => sum + (sale.amount || 0), 0);
  
  const ownerSales = data.sales.filter(s => s.buyer === OWNER_WALLET).length;
  const ownerRevenue = data.sales
    .filter(s => s.buyer === OWNER_WALLET)
    .reduce((sum, sale) => sum + (sale.amount || 0), 0);
  
  res.json({ 
    ok: true, 
    status: 'Server running',
    cluster: CLUSTER,
    isMainnet: CLUSTER === 'mainnet-beta',
    timestamp: new Date().toISOString(),
    salesCount: data.sales.length,
    totalRevenue: totalRevenue.toFixed(4) + ' SOL',
    ownerSales: ownerSales,
    ownerRevenue: ownerRevenue.toFixed(4) + ' SOL',
    merchantWallet: MERCHANT_WALLET,
    ownerWallet: OWNER_WALLET,
    telegramEnabled: !!(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID)
  });
});

app.get('/api/stats', (req, res) => {
  try {
    const data = readSales();
    
    let goldSold = 0, silverSold = 0, bronzeSold = 0;
    let totalRevenue = 0;
    let ownerRevenue = 0;
    
    data.sales.forEach(sale => {
      const sel = sale.metadata.selection;
      const blocksTotal = sel.blocksX * sel.blocksY;
      
      if (sel.minBlockY <= 24) {
        goldSold += blocksTotal;
      } else if (sel.minBlockY >= 25 && sel.minBlockY <= 59) {
        silverSold += blocksTotal;
      } else {
        bronzeSold += blocksTotal;
      }
      
      totalRevenue += sale.amount || 0;
      
      if (sale.buyer === OWNER_WALLET) {
        ownerRevenue += sale.amount || 0;
      }
    });
    
    res.json({
      ok: true,
      goldSold,
      silverSold,
      bronzeSold,
      totalSales: data.sales.length,
      totalRevenue: totalRevenue.toFixed(4),
      ownerRevenue: ownerRevenue.toFixed(4)
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
  console.log(`⭐ Owner Wallet: ${OWNER_WALLET} (Precio especial: 0.0001 SOL/bloque)`);
  console.log(`⚠️  MODO: ${CLUSTER === 'mainnet-beta' ? '🔴 PRODUCCIÓN (SOL REAL)' : '🟡 DESARROLLO (SOL FALSO)'}`);
  console.log(`📱 Telegram: ${TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID ? '✅ Activado' : '❌ Desactivado'}`);
  console.log(`🔀 Redirección WWW: ✅ Activada\n`);
});
