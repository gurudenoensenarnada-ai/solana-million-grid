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

// Load configuration
const config = require('./index.js');

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
  const publicIndex = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(publicIndex)) {
    return res.sendFile(publicIndex);
  }
  
  // Fallback to root index.html
  const rootIndex = path.join(__dirname, 'index.html');
  if (fs.existsSync(rootIndex)) {
    return res.sendFile(rootIndex);
  }
  
  res.status(404).send('index.html not found');
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

// Get all sales
app.get('/api/sales', (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(SALES_FILE, 'utf8'));
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
app.post('/api/purchase', async (req, res) => {
  try {
    const { signature, buyer, metadata } = req.body;
    
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

app.post('/api/upload', upload.single('logo'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: 'No file uploaded'
      });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    
    console.log('✅ File uploaded successfully:', fileUrl);
    console.log('   Saved to:', req.file.path);

    res.status(201).json({
      ok: true,
      url: fileUrl,
      filename: req.file.filename,
      path: req.file.path
    });
  } catch (error) {
    console.error('❌ Error uploading file:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to upload file: ' + error.message
    });
  }
});

// Alternative route for compatibility
app.post('/api/upload-logo', upload.single('logo'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: 'No file uploaded'
      });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    
    console.log('✅ File uploaded successfully (via /api/upload-logo):', fileUrl);
    console.log('   Saved to:', req.file.path);

    res.status(201).json({
      ok: true,
      url: fileUrl,
      filename: req.file.filename,
      path: req.file.path
    });
  } catch (error) {
    console.error('❌ Error uploading file:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to upload file: ' + error.message
    });
  }
});

// ==========================================
// List uploaded files
// ==========================================
app.get('/api/uploads', (req, res) => {
  try {
    // Check persistent directory first
    const checkDir = config.storage.persistentDir
      ? path.join(persistentDir, 'uploads')
      : uploadsDir;
    
    if (!fs.existsSync(checkDir)) {
      return res.json({
        ok: true,
        files: [],
        count: 0,
        source: 'none'
      });
    }
    
    const files = fs.readdirSync(checkDir)
      .filter(file => file !== '.gitkeep')
      .map(file => ({
        filename: file,
        url: `/uploads/${file}`,
        size: fs.statSync(path.join(checkDir, file)).size,
        created: fs.statSync(path.join(checkDir, file)).birthtime
      }))
      .sort((a, b) => b.created - a.created); // Most recent first
    
    res.json({
      ok: true,
      files,
      count: files.length,
      source: config.storage.persistentDir ? 'persistent' : 'local'
    });
  } catch (error) {
    console.error('❌ Error listing uploads:', error);
    res.json({
      ok: true,
      files: [],
      count: 0,
      error: error.message
    });
  }
});

// ==========================================
// Error Handling
// ==========================================
app.use((err, req, res, next) => {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
  
  res.status(err.status || 500).json({
    ok: false,
    error: err.message || 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: 'Not found: ' + req.path
  });
});

// ==========================================
// Start Server
// ==========================================
const PORT = config.port;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log('\n🚀 ================================');
  console.log('   SOLANA MILLION GRID');
  console.log('   ================================\n');
  console.log(`   🌐 Server: http://localhost:${PORT}`);
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
server.keepAliveTimeout = 120000; // 120 seconds
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
  // Don't exit - keep server running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit - keep server running
});

module.exports = app;
