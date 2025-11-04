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
// Añade al inicio con otros requires
const referralRoutes = require('./routes/referrals');

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
  // Escape special characters for Telegram MarkdownV2
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
    const meta = saleData.metadata;
    const sel = meta.selection;

    // Determine zone
    let zone = '🥉 BRONZE';
    let zoneEmoji = '🥉';
    if (sel.minBlockY <= 24) {
      zone = '🥇 GOLD';
      zoneEmoji = '🥇';
    } else if (sel.minBlockY >= 25 && sel.minBlockY <= 59) {
      zone = '🥈 SILVER';
      zoneEmoji = '🥈';
    }

    const blocksTotal = sel.blocksX * sel.blocksY;
    const amount = saleData.amount.toFixed(4);
    const isOwner = saleData.buyer === config.solana.ownerWallet;

    // Escape all text for Telegram MarkdownV2
    const safeName = escapeMarkdownV2(meta.name);
    const safeUrl = escapeMarkdownV2(meta.url);
    const safeAmount = escapeMarkdownV2(amount);
    const safeBlocksTotal = escapeMarkdownV2(blocksTotal);
    const safeBlocksX = escapeMarkdownV2(sel.blocksX);
    const safeBlocksY = escapeMarkdownV2(sel.blocksY);
    const safeRow = escapeMarkdownV2(sel.minBlockY + 1);
    const safeCol = escapeMarkdownV2(sel.minBlockX + 1);
    const safeSignature = escapeMarkdownV2(saleData.signature);
    const safeDate = escapeMarkdownV2(
      new Date(saleData.timestamp).toLocaleString('en-US', {
        timeZone: 'Europe/Madrid',
        dateStyle: 'medium',
        timeStyle: 'short'
      })
    );

    // Build message (English, no wallet shown)
    let message;

    if (isOwner) {
      message = `🎉 *NEW PURCHASE ON SOLANA MILLION GRID\\!*

${zoneEmoji} *Zone:* ${zone}
⭐ *OWNER PURCHASE \\- SPECIAL PRICE*

📊 *Purchase Details:*
• Project: *${safeName}*
• URL: ${safeUrl}
• Blocks: *${safeBlocksTotal}* \\(${safeBlocksX}×${safeBlocksY}\\)
• Position: Row ${safeRow}, Column ${safeCol}

💰 *Payment:*
• Amount: *${safeAmount} SOL*
• Price/block: *0\\.0001 SOL* 🌟

🔗 *Transaction:*
[View on Solscan](https://solscan\\.io/tx/${safeSignature})

⏰ ${safeDate}`;
    } else {
      message = `🎉 *NEW PURCHASE ON SOLANA MILLION GRID\\!*

${zoneEmoji} *Zone:* ${zone}

📊 *Purchase Details:*
• Project: *${safeName}*
• URL: ${safeUrl}
• Blocks: *${safeBlocksTotal}* \\(${safeBlocksX}×${safeBlocksY}\\)
• Position: Row ${safeRow}, Column ${safeCol}

💰 *Payment:*
• Amount: *${safeAmount} SOL*

🔗 *Transaction:*
[View on Solscan](https://solscan\\.io/tx/${safeSignature})

⏰ ${safeDate}`;
    }

    console.log('📝 Message prepared (length:', message.length, 'chars)');

    // Build logo URL (full URL for Telegram)
    let logoUrl = meta.logo;
    if (!logoUrl.startsWith('http')) {
      const host = process.env.RENDER
        ? 'https://www.solanamillondollar.com'
        : 'http://localhost:3000';
      logoUrl = `${host}${meta.logo}`;
    }

    console.log('🖼️ Logo URL:', logoUrl);

    // Send to Telegram
    const telegramApiUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`;

    const response = await fetch(telegramApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        photo: logoUrl,
        caption: message,
        parse_mode: 'MarkdownV2',
      }),
    });

    const result = await response.json();

    if (!result.ok) {
      console.error('❌ Telegram API error:', result);
      throw new Error(`Telegram API error: ${result.description || 'Unknown'}`);
    }

    console.log('✅ Telegram notification sent successfully!');
    console.log('   Message ID:', result.result.message_id);

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

// Mount referral routes (after app and JSON/urlencoded middlewares)
app.use('/api/referrals', referralRoutes);

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  
  // Track page views para analytics
  if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.includes('.')) {
    analytics.trackPageView(req);
  }
  
  next();
});

// ==========================================
// Create necessary directories
// ==========================================
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('✅ Created uploads directory');
}

const persistentDir = config.storage.persistentDir 
  ? path.resolve(config.storage.persistentDir) 
  : __dirname;

if (config.storage.persistentDir && !fs.existsSync(persistentDir)) {
  fs.mkdirSync(persistentDir, { recursive: true });
  console.log('✅ Created persistent directory:', persistentDir);
}

// Create uploads directory in persistent disk if configured
let persistentUploadsDir = uploadsDir;
if (config.storage.persistentDir) {
  persistentUploadsDir = path.join(persistentDir, 'uploads');
  if (!fs.existsSync(persistentUploadsDir)) {
    fs.mkdirSync(persistentUploadsDir, { recursive: true });
    console.log('✅ Created persistent uploads directory:', persistentUploadsDir);
  }
}

// ==========================================
// Static Files
// ==========================================
app.use(express.static(__dirname));

// Serve uploads from both local and persistent directory
app.use('/uploads', express.static(uploadsDir));

// If persistent directory exists, also serve from there
if (config.storage.persistentDir && fs.existsSync(persistentDir)) {
  const persistentUploads = path.join(persistentDir, 'uploads');
  if (fs.existsSync(persistentUploads)) {
    app.use('/uploads', express.static(persistentUploads));
    console.log('✅ Serving uploads from persistent directory:', persistentUploads);
  }
}

// Public folder if exists
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// ==========================================
// Root Route - Serve index.html
// ==========================================
app.get('/', (req, res) => {
  // Try public/index.html first
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).json({ ok: false, error: 'Index not found' });
  }
});

// Whitepaper route
app.get('/whitepaper.html', (req, res) => {
  const whitepaperPath = path.join(publicDir, 'whitepaper.html');
  if (fs.existsSync(whitepaperPath)) {
    res.sendFile(whitepaperPath);
  } else {
    res.status(404).json({ ok: false, error: 'Whitepaper not found. Please ensure whitepaper.html is in the public/ directory' });
  }
});

// Also support /whitepaper without .html
app.get('/whitepaper', (req, res) => {
  const whitepaperPath = path.join(publicDir, 'whitepaper.html');
  if (fs.existsSync(whitepaperPath)) {
    res.sendFile(whitepaperPath);
  } else {
    res.status(404).json({ ok: false, error: 'Whitepaper not found. Please ensure whitepaper.html is in the public/ directory' });
  }
});

// Serve whitepaper markdown
app.get('/whitepaper-smd.md', (req, res) => {
  const mdPath = path.join(publicDir, 'whitepaper-smd.md');
  if (fs.existsSync(mdPath)) {
    res.setHeader('Content-Type', 'text/markdown');
    res.sendFile(mdPath);
  } else {
    res.status(404).json({ ok: false, error: 'Whitepaper markdown not found' });
  }
});

// ==========================================
// Health Check
// ==========================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.nodeEnv,
    cluster: config.solana.cluster,
    version: '2.0.0'
  });
});

// ==========================================
// API Configuration Endpoint
// ==========================================
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
// Sales Management
// ==========================================
const SALES_FILE = config.storage.persistentDir
  ? path.join(persistentDir, 'sales.json')
  : path.join(__dirname, 'sales.json');

console.log('📊 Sales file location:', SALES_FILE);

// Initialize sales file if it doesn't exist
function initSalesFile() {
  if (!fs.existsSync(SALES_FILE)) {
    const initialData = {
      sales: [],
      stats: {
        totalSales: 0,
        totalBlocks: 0,
        totalRevenue: 0
      }
    };
    fs.writeFileSync(SALES_FILE, JSON.stringify(initialData, null, 2));
    console.log('✅ Initialized sales.json file');
  }
}

initSalesFile();

// ==========================================
// Solana Blockchain Endpoints
// ==========================================

// Get latest blockhash
app.post('/api/get-latest-blockhash', async (req, res) => {
  try {
    const { Connection, clusterApiUrl } = require('@solana/web3.js');
    
    const rpcUrl = config.solana.rpcUrl || clusterApiUrl(config.solana.cluster);
    const connection = new Connection(rpcUrl, 'confirmed');
    
    console.log('🔗 Getting latest blockhash...');
    
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    
    console.log('✅ Blockhash obtained:', blockhash.substring(0, 8) + '...');
    
    res.json({
      ok: true,
      blockhash,
      lastValidBlockHeight
    });
  } catch (error) {
    console.error('❌ Error getting blockhash:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to get blockhash: ' + error.message
    });
  }
});

// Verify transaction
app.post('/api/verify-transaction', async (req, res) => {
  try {
    const { signature } = req.body;
    
    if (!signature) {
      return res.status(400).json({
        ok: false,
        error: 'Missing signature'
      });
    }
    
    const { Connection, clusterApiUrl } = require('@solana/web3.js');
    
    const rpcUrl = config.solana.rpcUrl || clusterApiUrl(config.solana.cluster);
    const connection = new Connection(rpcUrl, 'confirmed');
    
    console.log('🔍 Verifying transaction:', signature.substring(0, 8) + '...');
    
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
    
    console.log(confirmed ? '✅ Transaction confirmed' : '⏳ Transaction pending');
    
    res.json({
      ok: true,
      confirmed,
      status: status.value
    });
  } catch (error) {
    console.error('❌ Error verifying transaction:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to verify transaction: ' + error.message
    });
  }
});

// Save sale (alias for /api/purchase)
app.post('/api/save-sale', async (req, res) => {
  try {
    const { signature, buyer, metadata, amount, timestamp, confirmed } = req.body;
    
    console.log('\n💾 Saving sale:');
    console.log('  Signature:', signature);
    console.log('  Buyer:', buyer);
    console.log('  Confirmed:', confirmed);
    
    if (!signature || !buyer || !metadata) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: signature, buyer, metadata'
      });
    }

    // Read current sales with proper initialization
    let salesData;
    try {
      if (fs.existsSync(SALES_FILE)) {
        const fileContent = fs.readFileSync(SALES_FILE, 'utf8');
        salesData = JSON.parse(fileContent);
        
        // Ensure stats object exists
        if (!salesData.stats) {
          salesData.stats = {
            totalSales: 0,
            totalBlocks: 0,
            totalRevenue: 0
          };
        }
        
        // Ensure sales array exists
        if (!salesData.sales) {
          salesData.sales = [];
        }
      } else {
        // File doesn't exist, create initial structure
        salesData = {
          sales: [],
          stats: {
            totalSales: 0,
            totalBlocks: 0,
            totalRevenue: 0
          }
        };
      }
    } catch (parseError) {
      console.error('⚠️  Error reading sales file, creating new:', parseError.message);
      salesData = {
        sales: [],
        stats: {
          totalSales: 0,
          totalBlocks: 0,
          totalRevenue: 0
        }
      };
    }

    // Check if sale already exists
    const existingSale = salesData.sales.find(s => s.signature === signature);
    if (existingSale) {
      console.log('⚠️  Sale already exists');
      return res.json({
        ok: true,
        message: 'Sale already registered',
        sale: existingSale
      });
    }

    // Calculate blocks
    let blocks = 1;
    if (metadata.selection) {
      blocks = metadata.selection.blocksX * metadata.selection.blocksY;
    }

    // Create sale record
    const sale = {
      signature,
      buyer,
      metadata,
      amount: amount || 0,
      blocks,
      timestamp: timestamp || Date.now(),
      verified: confirmed || false
    };

    // Add to sales
    salesData.sales.push(sale);
    salesData.stats.totalSales++;
    salesData.stats.totalBlocks += blocks;
    salesData.stats.totalRevenue += (amount || 0);

    // Save with error handling
    try {
      fs.writeFileSync(SALES_FILE, JSON.stringify(salesData, null, 2));
      console.log('✅ Sale saved successfully');
      console.log(`  Total sales: ${salesData.stats.totalSales}`);
      console.log(`  Total blocks: ${salesData.stats.totalBlocks}`);
    } catch (writeError) {
      console.error('❌ Error writing sales file:', writeError);
      throw new Error('Failed to write sales file: ' + writeError.message);
    }

    // Send Telegram notification
    try {
      await sendTelegramNotification(sale);
    } catch (telegramError) {
      console.error('⚠️ Telegram notification failed:', telegramError.message);
      // Don't fail the sale if Telegram fails
    }
    
    // Track sale in analytics
    try {
      analytics.trackSale(sale);
      analytics.trackEvent('purchase', { 
        signature, 
        amount, 
        blocks,
        zone: sale.metadata?.selection?.minBlockY <= 24 ? 'gold' : 
              sale.metadata?.selection?.minBlockY >= 25 && sale.metadata?.selection?.minBlockY <= 59 ? 'silver' : 'bronze'
      }, req);
    } catch (analyticsError) {
      console.error('⚠️ Analytics tracking failed:', analyticsError.message);
    }
    
    // Process referral if provided
    if (referralCode) {
      try {
        const referralResult = referralSystem.recordReferral(referralCode, sale);
        if (referralResult.ok) {
          console.log(`✅ Referral commission recorded: ${referralResult.commission} SOL`);
        }
      } catch (referralError) {
        console.error('⚠️ Referral processing failed:', referralError.message);
      }
    }

    res.status(201).json({
      ok: true,
      message: 'Sale saved successfully',
      sale
    });
  } catch (error) {
    console.error('❌ Error saving sale:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to save sale: ' + error.message
    });
  }
});

// Get all sales
app.get('/api/sales', (req, res) => {
  try {
    if (!fs.existsSync(SALES_FILE)) {
      return res.json({
        ok: true,
        sales: [],
        stats: { totalSales: 0, totalBlocks: 0, totalRevenue: 0 }
      });
    }
    
    const data = JSON.parse(fs.readFileSync(SALES_FILE, 'utf8'));
    
    // Ensure structure is correct
    if (!data.stats) {
      data.stats = { totalSales: 0, totalBlocks: 0, totalRevenue: 0 };
    }
    if (!data.sales) {
      data.sales = [];
    }
    
    res.json({
      ok: true,
      ...data
    });
  } catch (error) {
    console.error('❌ Error reading sales:', error.message);
    res.json({
      ok: true,
      sales: [],
      stats: { totalSales: 0, totalBlocks: 0, totalRevenue: 0 }
    });
  }
});

// Get stats
app.get('/api/stats', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(SALES_FILE, 'utf8'));
    res.json({
      ok: true,
      ...data.stats
    });
  } catch (error) {
    console.error('❌ Error reading stats:', error.message);
    res.json({
      ok: true,
      totalSales: 0,
      totalBlocks: 0,
      totalRevenue: 0
    });
  }
});

// ==========================================
// Purchase Endpoint
// ==========================================
app.post('/api/purchase', rateLimiter.middleware('purchase'), async (req, res) => {
  try {
    const { signature, buyer, metadata, referralCode } = req.body;
    
    console.log('\n📝 New purchase request:');
    console.log('  Signature:', signature);
    console.log('  Buyer:', buyer);
    console.log('  Metadata:', JSON.stringify(metadata, null, 2));
    
    if (!signature || !buyer || !metadata) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: signature, buyer, metadata'
      });
    }

    // Read current sales
    let salesData = { sales: [], stats: { totalSales: 0, totalBlocks: 0, totalRevenue: 0 } };
    if (fs.existsSync(SALES_FILE)) {
      salesData = JSON.parse(fs.readFileSync(SALES_FILE, 'utf8'));
    }

    // Calculate blocks and amount
    let blocks = 1;
    let amount = 0;
    
    if (metadata.selection) {
      blocks = metadata.selection.blocksX * metadata.selection.blocksY;
      
      // Calculate price based on zone
      const row = metadata.selection.minBlockY;
      const isOwner = buyer === config.solana.ownerWallet;
      
      if (isOwner) {
        amount = blocks * config.grid.prices.owner;
      } else if (row <= config.grid.zones.goldEnd) {
        amount = blocks * config.grid.prices.gold;
      } else if (row >= config.grid.zones.silverStart && row <= config.grid.zones.silverEnd) {
        amount = blocks * config.grid.prices.silver;
      } else {
        amount = blocks * config.grid.prices.bronze;
      }
    }

    // Create sale record
    const sale = {
      signature,
      buyer,
      metadata,
      amount,
      blocks,
      timestamp: Date.now(),
      verified: true
    };

    // Add to sales
    salesData.sales.push(sale);
    salesData.stats.totalSales++;
    salesData.stats.totalBlocks += blocks;
    salesData.stats.totalRevenue += amount;

    // Save
    fs.writeFileSync(SALES_FILE, JSON.stringify(salesData, null, 2));

    // Send Telegram notification
    try {
      await sendTelegramNotification(sale);
    } catch (telegramError) {
      console.error('⚠️ Telegram notification failed:', telegramError.message);
      // Don't fail the sale if Telegram fails
    }

    console.log('✅ Purchase recorded successfully');
    console.log(`  Blocks: ${blocks}`);
    console.log(`  Amount: ${amount} SOL`);

    res.status(201).json({
      ok: true,
      message: 'Purchase recorded successfully',
      sale
    });
  } catch (error) {
    console.error('❌ Error processing purchase:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to process purchase: ' + error.message
    });
  }
});

// ==========================================
// File Upload
// ==========================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use persistent uploads directory if configured, otherwise local
    const uploadDir = config.storage.persistentDir 
      ? path.join(persistentDir, 'uploads')
      : uploadsDir;
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed (JPEG, PNG, GIF, WEBP)'));
    }
  }
});

// ==========================================
// ANALYTICS ENDPOINTS
// ==========================================
// ...rest of file unchanged...
// ==========================================
// Start Server (updated to respect Render's PORT and bind to 0.0.0.0)
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
  console.log(`   💼 Merchant: ${config.solana.merchantWallet.substring(0, 8)}...`);
  console.log(`   👤 Owner: ${config.solana.ownerWallet.substring(0, 8)}...`);
  
  if (config.cloudinary.enabled) {
    console.log(`   ☁️  Cloudinary: ✅ (${config.cloudinary.cloudName})`);
  } else {
    console.log(`   ☁️  Cloudinary: ❌`);
  }
  
  if (config.telegram.enabled) {
    console.log(`   📱 Telegram: ✅`);
  } else {
    console.log(`   📱 Telegram: ❌`);
  }
  
  console.log('\n   ================================');
  console.log('   ✅ Server is ready and listening!');
  console.log('   📝 Logs will appear below');
  console.log('   ================================\n');
});

// Keep server alive
server.keepAliveTimeout = 120000;
server.headersTimeout = 120000;

// Graceful shutdown
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

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;
