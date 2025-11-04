/**
 * Solana Million Grid - Main Server
 * Complete and functional server implementation
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Fetch polyfill for Node.js < 18
if (!globalThis.fetch) {
  const fetch = require('node-fetch');
  globalThis.fetch = fetch;
}

// Load configuration
const config = require('./index.js');

// Load new services
const referralRoutes = require('./routes/referrals');
const referralService = require('./services/referralService');

const rateLimiter = require('./middleware/rateLimiter');
const Analytics = require('./services/Analytics');
const PreviewSystem = require('./services/PreviewSystem');
const ReferralSystem = require('./ReferralSystem.js');

// Initialize services
const analytics = new Analytics(__dirname);
const previewSystem = new PreviewSystem(__dirname);
const referralSystem = new ReferralSystem(__dirname);

// ==========================================
// Telegram Notification Service
// ==========================================
function escapeMarkdownV2(text) {
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

async function sendTelegramNotification(saleData) {
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

  console.log('\n📱 === TELEGRAM NOTIFICATION ===');
  console.log('Bot token exists?', !!TELEGRAM_BOT_TOKEN);
  console.log('Chat ID exists?', !!TELEGRAM_CHAT_ID);

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('⚠️ Telegram not configured');
    return { ok: true, skipped: true };
  }

  try {
    const meta = saleData.metadata || {};
    const sel = meta.selection || { minBlockY: 0, blocksX: 1, blocksY: 1, minBlockX: 0 };

    let zone = '🥉 BRONZE';
    if (sel.minBlockY <= (config.grid?.zones?.goldEnd ?? 24)) zone = '🥇 GOLD';
    else if (sel.minBlockY >= (config.grid?.zones?.silverStart ?? 25) && sel.minBlockY <= (config.grid?.zones?.silverEnd ?? 59)) zone = '🥈 SILVER';

    const blocksTotal = (sel.blocksX || 1) * (sel.blocksY || 1);
    const amount = (typeof saleData.amount === 'number') ? saleData.amount.toFixed(4) : String(saleData.amount || 0);
    const isOwner = saleData.buyer === config.solana.ownerWallet;

    const safeName = escapeMarkdownV2(meta.name || '');
    const safeUrl = escapeMarkdownV2(meta.url || '');
    const safeAmount = escapeMarkdownV2(amount);
    const safeBlocksTotal = escapeMarkdownV2(blocksTotal);
    const safeBlocksX = escapeMarkdownV2(sel.blocksX || 0);
    const safeBlocksY = escapeMarkdownV2(sel.blocksY || 0);
    const safeRow = escapeMarkdownV2((sel.minBlockY || 0) + 1);
    const safeCol = escapeMarkdownV2((sel.minBlockX || 0) + 1);
    const safeSignature = escapeMarkdownV2(saleData.signature || '');
    const safeDate = escapeMarkdownV2(
      new Date(saleData.timestamp || Date.now()).toLocaleString('en-US', {
        timeZone: 'Europe/Madrid',
        dateStyle: 'medium',
        timeStyle: 'short'
      })
    );

    let message;
    if (isOwner) {
      message = `🎉 *NEW PURCHASE ON SOLANA MILLION GRID\\!*\n\n🥇 *Zone:* ${zone}\n⭐ *OWNER PURCHASE \\- SPECIAL PRICE*\n\n📊 *Purchase Details:*\n• Project: *${safeName}*\n• URL: ${safeUrl}\n• Blocks: *${safeBlocksTotal}* \\(${safeBlocksX}×${safeBlocksY}\\)\n• Position: Row ${safeRow}, Column ${safeCol}\n\n💰 *Payment:*\n• Amount: *${safeAmount} SOL*\n\n🔗 *Transaction:*\n[View on Solscan](https://solscan\\.io/tx/${safeSignature})\n\n⏰ ${safeDate}`;
    } else {
      message = `🎉 *NEW PURCHASE ON SOLANA MILLION GRID\\!*\n\n${zone} *Zone: ${zone}*\n\n📊 *Purchase Details:*\n• Project: *${safeName}*\n• URL: ${safeUrl}\n• Blocks: *${safeBlocksTotal}* \\(${safeBlocksX}×${safeBlocksY}\\)\n• Position: Row ${safeRow}, Column ${safeCol}\n\n💰 *Payment:*\n• Amount: *${safeAmount} SOL*\n\n🔗 *Transaction:*\n[View on Solscan](https://solscan\\.io/tx/${safeSignature})\n\n⏰ ${safeDate}`;
    }

    let logoUrl = meta.logo || '';
    if (logoUrl && !logoUrl.startsWith('http')) {
      const host = process.env.RENDER ? `https://${process.env.RENDER_EXTERNAL_URL || 'www.solanamillondollar.com'}` : 'http://localhost:3000';
      logoUrl = `${host}${meta.logo}`;
    }

    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;
    const response = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, photo: logoUrl, caption: message, parse_mode: 'MarkdownV2' })
    });

    const result = await response.json();
    if (!result.ok) {
      console.error('❌ Telegram API error:', result);
      throw new Error(`Telegram API error: ${result.description || 'Unknown'}`);
    }

    console.log('✅ Telegram notification sent successfully!');
    return { ok: true, result };
  } catch (error) {
    console.error('❌ Telegram notification error:', error.message);
    throw error;
  }
}

// Initialize Express app
const app = express();

console.log('🚀 Starting Solana Million Grid Server...\n');

// ==========================================
// Middleware
// ==========================================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ==========================================
// Create necessary directories
// ==========================================
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const persistentDir = config.storage.persistentDir ? path.resolve(config.storage.persistentDir) : __dirname;
if (config.storage.persistentDir && !fs.existsSync(persistentDir)) fs.mkdirSync(persistentDir, { recursive: true });

let persistentUploadsDir = uploadsDir;
if (config.storage.persistentDir) {
  persistentUploadsDir = path.join(persistentDir, 'uploads');
  if (!fs.existsSync(persistentUploadsDir)) fs.mkdirSync(persistentUploadsDir, { recursive: true });
}

// ==========================================
// Multer storage and upload middleware (DEFINED BEFORE upload routes)
// ==========================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = config.storage.persistentDir ? path.join(persistentDir, 'uploads') : uploadsDir;
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) return cb(null, true);
    cb(new Error('Only image files are allowed (JPEG, PNG, GIF, WEBP)'));
  }
});

// ==========================================
// Static Files
// ==========================================
app.use(express.static(__dirname));
app.use('/uploads', express.static(uploadsDir));
if (config.storage.persistentDir && fs.existsSync(persistentUploadsDir)) {
  app.use('/uploads', express.static(persistentUploadsDir));
  console.log('✅ Serving uploads from persistent directory:', persistentUploadsDir);
}
if (fs.existsSync(publicDir)) app.use(express.static(publicDir));

// Mount referrals routes
app.use('/api/referrals', referralRoutes);

// ==========================================
// Root and misc routes (index, whitepaper, health, config)
// ==========================================
const publicDir = path.join(__dirname, 'public');

app.get('/', (req, res) => {
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(404).json({ ok: false, error: 'Index not found' });
});

app.get('/whitepaper.html', (req, res) => {
  const p = path.join(publicDir, 'whitepaper.html');
  if (fs.existsSync(p)) return res.sendFile(p);
  res.status(404).json({ ok: false, error: 'Whitepaper not found' });
});

app.get('/whitepaper', (req, res) => {
  const p = path.join(publicDir, 'whitepaper.html');
  if (fs.existsSync(p)) return res.sendFile(p);
  res.status(404).json({ ok: false, error: 'Whitepaper not found' });
});

app.get('/whitepaper-smd.md', (req, res) => {
  const p = path.join(publicDir, 'whitepaper-smd.md');
  if (fs.existsSync(p)) {
    res.setHeader('Content-Type', 'text/markdown');
    return res.sendFile(p);
  }
  res.status(404).json({ ok: false, error: 'Whitepaper markdown not found' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime(), environment: config.nodeEnv, cluster: config.solana.cluster, version: '2.0.0' });
});

app.get('/api/config', (req, res) => {
  res.json({
    ok: true,
    merchantWallet: config.solana.merchantWallet,
    ownerWallet: config.solana.ownerWallet,
    cluster: config.solana.cluster,
    grid: config.grid,
    cloudinaryEnabled: config.cloudinary.enabled,
    cloudinaryCloudName: config.cloudinary.cloudName,
    cloudinaryUploadPreset: config.cloudinary.uploadPreset,
    telegramEnabled: config.telegram.enabled
  });
});

// ==========================================
// SALES_FILE init and /api/sales
// ==========================================
const SALES_FILE = config.storage.persistentDir ? path.join(persistentDir, 'sales.json') : path.join(__dirname, 'sales.json');
console.log('📊 Sales file location:', SALES_FILE);

function initSalesFile() {
  if (!fs.existsSync(SALES_FILE)) {
    const initialData = { sales: [], stats: { totalSales: 0, totalBlocks: 0, totalRevenue: 0 } };
    fs.writeFileSync(SALES_FILE, JSON.stringify(initialData, null, 2));
    console.log('✅ Initialized sales.json file');
  }
}
initSalesFile();

app.get('/api/sales', (req, res) => {
  try {
    if (!fs.existsSync(SALES_FILE)) return res.json({ ok: true, sales: [], stats: { totalSales: 0, totalBlocks: 0, totalRevenue: 0 } });
    const raw = fs.readFileSync(SALES_FILE, 'utf8');
    let data = {};
    try { data = JSON.parse(raw); } catch (err) {
      console.warn('⚠️ /api/sales parse error', err.message);
      return res.json({ ok: true, sales: [], stats: { totalSales: 0, totalBlocks: 0, totalRevenue: 0 } });
    }
    if (Array.isArray(data)) data = { sales: data, stats: { totalSales: data.length, totalBlocks: 0, totalRevenue: 0 } };
    if (!data.sales || !Array.isArray(data.sales)) data.sales = [];
    if (!data.stats) data.stats = { totalSales: data.sales.length || 0, totalBlocks: 0, totalRevenue: 0 };
    return res.json({ ok: true, ...data });
  } catch (error) {
    console.error('❌ /api/sales error:', error);
    return res.json({ ok: true, sales: [], stats: { totalSales: 0, totalBlocks: 0, totalRevenue: 0 } });
  }
});

// ==========================================
// Solana endpoints and sales handlers (verify, save-sale, purchase)
// ==========================================
app.post('/api/get-latest-blockhash', async (req, res) => {
  try {
    const { Connection, clusterApiUrl } = require('@solana/web3.js');
    const rpcUrl = config.solana.rpcUrl || clusterApiUrl(config.solana.cluster);
    const connection = new Connection(rpcUrl, 'confirmed');
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    res.json({ ok: true, blockhash, lastValidBlockHeight });
  } catch (error) {
    console.error('❌ Error getting blockhash:', error);
    res.status(500).json({ ok: false, error: 'Failed to get blockhash: ' + error.message });
  }
});

app.post('/api/verify-transaction', async (req, res) => {
  try {
    const { signature } = req.body;
    if (!signature) return res.status(400).json({ ok: false, error: 'Missing signature' });
    const { Connection, clusterApiUrl } = require('@solana/web3.js');
    const rpcUrl = config.solana.rpcUrl || clusterApiUrl(config.solana.cluster);
    const connection = new Connection(rpcUrl, 'confirmed');
    const status = await connection.getSignatureStatus(signature);
    if (!status || !status.value) return res.json({ ok: true, confirmed: false, status: null });
    const confirmed = status.value.confirmationStatus === 'confirmed' || status.value.confirmationStatus === 'finalized';
    res.json({ ok: true, confirmed, status: status.value });
  } catch (error) {
    console.error('❌ Error verifying transaction:', error);
    res.status(500).json({ ok: false, error: 'Failed to verify transaction: ' + error.message });
  }
});

// Save sale (alias for /api/purchase)
app.post('/api/save-sale', async (req, res) => {
  try {
    const { signature, buyer, metadata, amount, timestamp, confirmed } = req.body;
    if (!signature || !buyer || !metadata) return res.status(400).json({ ok: false, error: 'Missing required fields' });

    let salesData = { sales: [], stats: { totalSales: 0, totalBlocks: 0, totalRevenue: 0 } };
    try {
      if (fs.existsSync(SALES_FILE)) {
        const fileContent = fs.readFileSync(SALES_FILE, 'utf8');
        salesData = JSON.parse(fileContent);
        if (!salesData.stats) salesData.stats = { totalSales: 0, totalBlocks: 0, totalRevenue: 0 };
        if (!salesData.sales) salesData.sales = [];
      }
    } catch (e) { console.warn('⚠️ Error reading sales file', e.message); salesData = { sales: [], stats: { totalSales: 0, totalBlocks: 0, totalRevenue: 0 } }; }

    const existingSale = salesData.sales.find(s => s.signature === signature);
    if (existingSale) return res.json({ ok: true, message: 'Sale already registered', sale: existingSale });

    let blocks = 1;
    if (metadata.selection) blocks = metadata.selection.blocksX * metadata.selection.blocksY;

    const sale = { signature, buyer, metadata, amount: amount || 0, blocks, timestamp: timestamp || Date.now(), verified: confirmed || false };
    salesData.sales.push(sale);
    salesData.stats.totalSales++;
    salesData.stats.totalBlocks += blocks;
    salesData.stats.totalRevenue += (amount || 0);
    fs.writeFileSync(SALES_FILE, JSON.stringify(salesData, null, 2));

    try { await sendTelegramNotification(sale); } catch (e) { console.warn('Telegram failed', e.message); }
    try { analytics.trackSale(sale); analytics.trackEvent('purchase', { signature, amount, blocks }, req); } catch (e) { console.warn('Analytics failed', e.message); }

    const referralCode = req.body.referralCode || req.query.referralCode;
    if (referralCode) {
      try {
        if (referralService && referralService.recordSale) referralService.recordSale({ referrerCode: referralCode, saleId: signature, amountCents: Math.round((amount || 0) * 1e6) });
        else if (referralSystem && referralSystem.recordReferral) referralSystem.recordReferral(referralCode, sale);
      } catch (e) { console.warn('Referral processing failed:', e.message); }
    }

    res.status(201).json({ ok: true, message: 'Sale saved successfully', sale });
  } catch (error) {
    console.error('❌ Error saving sale:', error);
    res.status(500).json({ ok: false, error: 'Failed to save sale: ' + error.message });
  }
});

// Purchase endpoint (creates gifts for GOLD/SILVER)
app.post('/api/purchase', rateLimiter.middleware('purchase'), async (req, res) => {
  try {
    const { signature, buyer, metadata, referralCode } = req.body;
    if (!signature || !buyer || !metadata) return res.status(400).json({ ok: false, error: 'Missing required fields' });

    let salesData = { sales: [], stats: { totalSales: 0, totalBlocks: 0, totalRevenue: 0 } };
    try { if (fs.existsSync(SALES_FILE)) salesData = JSON.parse(fs.readFileSync(SALES_FILE, 'utf8')); } catch (e) { console.warn('⚠️ sales.json parse failed', e.message); salesData = { sales: [], stats: { totalSales: 0, totalBlocks: 0, totalRevenue: 0 } }; }

    let blocks = 1;
    let amount = 0;
    if (metadata.selection) {
      blocks = metadata.selection.blocksX * metadata.selection.blocksY;
      const row = metadata.selection.minBlockY;
      const isOwner = buyer === config.solana.ownerWallet;
      if (isOwner) amount = blocks * (config.grid?.prices?.owner ?? 0);
      else if (row <= (config.grid?.zones?.goldEnd ?? 24)) amount = blocks * (config.grid?.prices?.gold ?? 0);
      else if (row >= (config.grid?.zones?.silverStart ?? 25) && row <= (config.grid?.zones?.silverEnd ?? 59)) amount = blocks * (config.grid?.prices?.silver ?? 0);
      else amount = blocks * (config.grid?.prices?.bronze ?? 0);
    }

    const sale = { signature, buyer, metadata, amount, blocks, timestamp: Date.now(), verified: true };
    salesData.sales.push(sale);
    salesData.stats.totalSales++;
    salesData.stats.totalBlocks += blocks;
    salesData.stats.totalRevenue += amount;
    fs.writeFileSync(SALES_FILE, JSON.stringify(salesData, null, 2));

    try { await sendTelegramNotification(sale); } catch (e) { console.warn('Telegram failed', e.message); }
    try { analytics.trackSale(sale); analytics.trackEvent('purchase', { signature, amount, blocks }, req); } catch (e) { console.warn('Analytics failed', e.message); }

    if (referralCode) {
      try {
        if (referralService && referralService.recordSale) referralService.recordSale({ referrerCode: referralCode, saleId: signature, amountCents: Math.round(amount * 1e6) });
        else if (referralSystem && referralSystem.recordReferral) referralSystem.recordReferral(referralCode, sale);
      } catch (e) { console.warn('Referral processing failed:', e.message); }
    }

    let generatedGift = null;
    try {
      if (metadata.selection) {
        const row = metadata.selection.minBlockY;
        let giftValue = 0;
        if (row <= (config.grid?.zones?.goldEnd ?? 24)) giftValue = 1.0;
        else if (row >= (config.grid?.zones?.silverStart ?? 25) && row <= (config.grid?.zones?.silverEnd ?? 59)) giftValue = 0.5;

        if (giftValue > 0) {
          if (referralService && referralService.createGiftCode) generatedGift = referralService.createGiftCode({ wallet: buyer, valueSol: giftValue });
          else {
            try {
              const resp = await fetch(`${req.protocol}://${req.get('host')}/api/referrals/admin/gift/create?admin_password=${encodeURIComponent(process.env.ADMIN_PASSWORD || 'changeme')}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ wallet: buyer, valueSol: giftValue })
              });
              if (resp.ok) { const body = await resp.json(); generatedGift = body.gift || null; }
            } catch (e) { console.warn('Fallback gift creation failed:', e.message); }
          }
        }
      }
    } catch (giftErr) { console.warn('Gift generation failed:', giftErr.message); }

    const responsePayload = { ok: true, message: 'Purchase recorded successfully', sale };
    if (generatedGift) responsePayload.gift = generatedGift;
    res.status(201).json(responsePayload);
  } catch (error) {
    console.error('❌ Error processing purchase:', error);
    res.status(500).json({ ok: false, error: 'Failed to process purchase: ' + error.message });
  }
});

// ==========================================
// File upload endpoints (upload defined above)
// ==========================================
app.post('/api/upload', rateLimiter.middleware('upload'), upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    const fileUrl = `/uploads/${req.file.filename}`;
    res.status(201).json({ ok: true, url: fileUrl, filename: req.file.filename, path: req.file.path });
  } catch (error) {
    console.error('❌ Error uploading file:', error);
    res.status(500).json({ ok: false, error: 'Failed to upload file: ' + error.message });
  }
});

app.post('/api/upload-logo', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file uploaded' });
    const fileUrl = `/uploads/${req.file.filename}`;
    res.status(201).json({ ok: true, url: fileUrl, filename: req.file.filename, path: req.file.path });
  } catch (error) {
    console.error('❌ Error uploading file:', error);
    res.status(500).json({ ok: false, error: 'Failed to upload file: ' + error.message });
  }
});

// ==========================================
// Admin & referrals routes are mounted earlier (routes/referrals)
// ==========================================

// ==========================================
// Error handling & 404
// ==========================================
app.use((err, req, res, next) => {
  console.error('❌ Error:', err && err.message);
  res.status(err.status || 500).json({ ok: false, error: err.message || 'Internal server error' });
});
app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Not found: ' + req.path });
});

// ==========================================
// Start Server
// ==========================================
const PORT = process.env.PORT || config.port || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log('\n🚀 ================================');
  console.log('   SOLANA MILLION GRID');
  console.log('   ================================\n');
  console.log(`   🌐 Server listening on: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`   📦 Environment: ${config.nodeEnv}`);
  console.log(`   🔗 Cluster: ${config.solana.cluster}`);
  console.log(`   💼 Merchant: ${config.solana.merchantWallet?.substring(0, 8)}...`);
  console.log(`   👤 Owner: ${config.solana.ownerWallet?.substring(0, 8)}...`);
  console.log('\n   ✅ Server is ready and listening!\n');
});

server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;

process.on('SIGTERM', () => {
  console.log('\n👋 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
process.on('SIGINT', () => {
  console.log('\n👋 SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
process.on('uncaughtException', (error) => { console.error('❌ Uncaught Exception:', error); });
process.on('unhandledRejection', (reason, promise) => { console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason); });

module.exports = app;
