/**
 * API Routes
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();

const config = require('../config');
const { asyncHandler } = require('../middleware/errorHandler');
const { apiLimiter, strictLimiter, uploadLimiter } = require('../middleware/rateLimit');
const salesController = require('../controllers/sales.controller');
const uploadController = require('../controllers/upload.controller');
const solanaService = require('../services/solana.service');
const telegramService = require('../services/telegram.service');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.resolve(__dirname, '../../../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'logo-' + uniqueSuffix + path.extname(file.originalname));
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

// Apply rate limiting to all API routes
router.use(apiLimiter);

/**
 * GET /api/config
 * Get server configuration
 */
router.get('/config', asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    merchantWallet: config.solana.merchantWallet,
    ownerWallet: config.solana.ownerWallet,
    cluster: config.solana.cluster,
    grid: config.grid,
    cloudinaryEnabled: config.cloudinary.enabled,
    telegramEnabled: config.telegram.enabled
  });
}));

/**
 * GET /api/sales
 * Get all sales data
 */
router.get('/sales', asyncHandler(async (req, res) => {
  const sales = salesController.getSales();
  res.json({
    ok: true,
    ...sales
  });
}));

/**
 * GET /api/stats
 * Get sales statistics
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const stats = salesController.getSalesStats();
  res.json({
    ok: true,
    ...stats
  });
}));

/**
 * POST /api/purchase
 * Process a new purchase
 */
router.post('/purchase', strictLimiter, asyncHandler(async (req, res) => {
  const { signature, buyer, metadata } = req.body;

  if (!signature || !buyer || !metadata) {
    return res.status(400).json({
      ok: false,
      error: 'Missing required fields: signature, buyer, metadata'
    });
  }

  const result = await salesController.processPurchase({
    signature,
    buyer,
    metadata
  });

  if (result.ok) {
    res.status(201).json(result);
  } else {
    res.status(400).json(result);
  }
}));

/**
 * POST /api/upload
 * Upload an image/logo
 */
router.post('/upload', 
  uploadLimiter,
  upload.single('logo'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: 'No file uploaded'
      });
    }

    const result = await uploadController.processUpload(req.file);

    if (result.ok) {
      res.status(201).json(result);
    } else {
      res.status(400).json(result);
    }
  })
);

/**
 * GET /api/uploads
 * List uploaded files
 */
router.get('/uploads', asyncHandler(async (req, res) => {
  const result = uploadController.listUploads();
  res.json(result);
}));

/**
 * DELETE /api/uploads/:filename
 * Delete an uploaded file
 */
router.delete('/uploads/:filename', strictLimiter, asyncHandler(async (req, res) => {
  const { filename } = req.params;
  const result = await uploadController.deleteUpload(filename);

  if (result.ok) {
    res.json(result);
  } else {
    res.status(404).json(result);
  }
}));

/**
 * GET /api/verify/:signature
 * Verify a transaction
 */
router.get('/verify/:signature', asyncHandler(async (req, res) => {
  const { signature } = req.params;
  const result = await solanaService.verifyTransaction(signature);

  if (result.ok) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
}));

/**
 * GET /api/balance/:address
 * Get wallet balance
 */
router.get('/balance/:address', asyncHandler(async (req, res) => {
  const { address } = req.params;

  if (!solanaService.isValidAddress(address)) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid Solana address'
    });
  }

  const balance = await solanaService.getBalance(address);
  res.json({
    ok: true,
    address,
    balance
  });
}));

/**
 * GET /api/cluster-info
 * Get Solana cluster information
 */
router.get('/cluster-info', asyncHandler(async (req, res) => {
  const info = await solanaService.getClusterInfo();
  res.json(info);
}));

/**
 * POST /api/test-telegram
 * Test Telegram bot connection (development only)
 */
if (config.isDevelopment) {
  router.post('/test-telegram', asyncHandler(async (req, res) => {
    const result = await telegramService.testConnection();
    res.json(result);
  }));
}

module.exports = router;
