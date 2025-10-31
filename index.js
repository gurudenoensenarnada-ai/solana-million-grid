/**
 * Server Configuration
 * Centralizes all environment variables with validation
 */

require('dotenv').config();

/**
 * Validate required environment variables
 */
function validateEnv() {
  const required = [
    'MERCHANT_WALLET',
    'CLUSTER',
    'RPC_URL'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file against .env.example'
    );
  }
}

// Validate on load
validateEnv();

const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isDevelopment: process.env.NODE_ENV !== 'production',
  isProduction: process.env.NODE_ENV === 'production',

  // Solana
  solana: {
    merchantWallet: process.env.MERCHANT_WALLET,
    ownerWallet: process.env.OWNER_WALLET || process.env.MERCHANT_WALLET,
    cluster: process.env.CLUSTER || 'mainnet-beta',
    rpcUrl: process.env.RPC_URL,
  },

  // Cloudinary
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || null,
    uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || null,
    apiKey: process.env.CLOUDINARY_API_KEY || null,
    apiSecret: process.env.CLOUDINARY_API_SECRET || null,
    enabled: !!(
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    ),
  },

  // Storage
  storage: {
    saveImagesInJson: process.env.SAVE_IMAGES_IN_JSON === 'true',
    removeLocalAfterUpload: process.env.REMOVE_LOCAL_AFTER_UPLOAD === 'true',
    salesPublicId: process.env.SALES_PUBLIC_ID || 'sales_backup',
    persistentDir: process.env.PERSISTENT_DIR || null,
  },

  // Telegram
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || null,
    chatId: process.env.TELEGRAM_CHAT_ID || null,
    enabled: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  },

  // Security
  security: {
    restoreSecret: process.env.RESTORE_SECRET || 'default_secret_change_me',
    jwtSecret: process.env.JWT_SECRET || 'default_jwt_secret_change_me',
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 min
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  },

  // Grid Configuration
  grid: {
    canvasSize: 1000,
    blockSize: 10,
    blocksPerSide: 100,
    prices: {
      gold: 1.0,
      silver: 0.5,
      bronze: 0.1,
      owner: 0.0001,
    },
    zones: {
      goldEnd: 24,
      silverStart: 25,
      silverEnd: 59,
      bronzeStart: 60,
    },
  },
};

// Log configuration on startup (without sensitive data)
if (config.isDevelopment) {
  console.log('🔧 Configuration loaded:');
  console.log('  - Environment:', config.nodeEnv);
  console.log('  - Port:', config.port);
  console.log('  - Cluster:', config.solana.cluster);
  console.log('  - Cloudinary:', config.cloudinary.enabled ? '✅' : '❌');
  console.log('  - Telegram:', config.telegram.enabled ? '✅' : '❌');
}

module.exports = config;
