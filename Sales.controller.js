/**
 * Sales Controller
 * Handles sales-related operations
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const solanaService = require('../services/solana.service');
const telegramService = require('../services/telegram.service');
const cloudinaryService = require('../services/cloudinary.service');

const SALES_FILE = path.resolve(__dirname, '../../../sales.json');
let SALES_CACHE = null;

/**
 * Initialize sales data
 */
async function initSales() {
  try {
    // Try to load from Cloudinary
    if (cloudinaryService.enabled) {
      const result = await cloudinaryService.downloadJSONObject(config.storage.salesPublicId);
      if (result.ok && result.data) {
        SALES_CACHE = result.data;
        // Write local backup
        try {
          fs.writeFileSync(SALES_FILE, JSON.stringify(SALES_CACHE, null, 2), 'utf8');
        } catch (e) {
          console.warn('Could not write local sales backup:', e.message);
        }
        console.log('✅ Sales data loaded from Cloudinary');
        return;
      }
    }

    // Fallback to local file
    if (fs.existsSync(SALES_FILE)) {
      try {
        const data = JSON.parse(fs.readFileSync(SALES_FILE, 'utf8'));
        SALES_CACHE = data;
        console.log('✅ Sales data loaded from local file');
        return;
      } catch (e) {
        console.warn('Could not parse local sales file:', e.message);
      }
    }

    // Initialize empty
    SALES_CACHE = { sales: [] };
    await saveSales(SALES_CACHE);
    console.log('✅ Sales data initialized (empty)');
  } catch (err) {
    console.error('❌ Error initializing sales:', err.message);
    SALES_CACHE = { sales: [] };
  }
}

/**
 * Get all sales
 */
function getSales() {
  if (!SALES_CACHE) {
    return { sales: [] };
  }
  return SALES_CACHE;
}

/**
 * Save sales data
 * @param {Object} salesData - Sales data object
 */
async function saveSales(salesData) {
  SALES_CACHE = salesData;

  // Save to Cloudinary
  if (cloudinaryService.enabled) {
    try {
      const result = await cloudinaryService.uploadJSONObject(
        salesData,
        config.storage.salesPublicId
      );
      if (!result.ok) {
        console.warn('⚠️ Could not save to Cloudinary:', result.error);
      }
    } catch (err) {
      console.warn('⚠️ Exception saving to Cloudinary:', err.message);
    }
  }

  // Save local backup
  try {
    fs.writeFileSync(SALES_FILE, JSON.stringify(salesData, null, 2), 'utf8');
  } catch (e) {
    console.warn('⚠️ Could not write local backup:', e.message);
  }

  return true;
}

/**
 * Get sales statistics
 */
function getSalesStats() {
  const sales = getSales().sales || [];
  
  let goldSold = 0;
  let silverSold = 0;
  let bronzeSold = 0;
  let totalSales = 0;

  sales.forEach(sale => {
    const sel = sale.metadata?.selection;
    if (!sel) return;

    const blocksCount = sel.blocksX * sel.blocksY;
    const minY = sel.minBlockY;

    if (minY <= 24) {
      goldSold += blocksCount;
    } else if (minY >= 25 && minY <= 59) {
      silverSold += blocksCount;
    } else {
      bronzeSold += blocksCount;
    }

    totalSales += sale.amount || 0;
  });

  return {
    goldSold,
    silverSold,
    bronzeSold,
    totalSold: goldSold + silverSold + bronzeSold,
    totalSales: totalSales.toFixed(4),
    salesCount: sales.length
  };
}

/**
 * Process a new purchase
 * @param {Object} purchaseData - Purchase data
 */
async function processPurchase(purchaseData) {
  const {
    signature,
    buyer,
    metadata
  } = purchaseData;

  // Validate required fields
  if (!signature || !buyer || !metadata) {
    return {
      ok: false,
      error: 'Missing required fields: signature, buyer, metadata'
    };
  }

  // Validate Solana address
  if (!solanaService.isValidAddress(buyer)) {
    return {
      ok: false,
      error: 'Invalid buyer address'
    };
  }

  // Verify transaction
  console.log('🔍 Verifying transaction...');
  const verification = await solanaService.verifyTransaction(signature);
  
  if (!verification.ok) {
    console.error('❌ Transaction verification failed:', verification.error);
    return {
      ok: false,
      error: `Transaction verification failed: ${verification.error}`
    };
  }

  console.log('✅ Transaction verified:', verification.amount, 'SOL');

  // Check if already exists
  const sales = getSales();
  const exists = sales.sales.some(s => s.signature === signature);
  
  if (exists) {
    return {
      ok: false,
      error: 'Sale already recorded'
    };
  }

  // Check if wallet is owner
  const isOwner = solanaService.isOwnerWallet(buyer);

  // Create sale record
  const saleRecord = {
    signature,
    buyer,
    amount: verification.amount,
    timestamp: verification.timestamp * 1000 || Date.now(),
    metadata,
    isOwner,
    verified: true,
    slot: verification.slot
  };

  // Add to sales
  sales.sales.push(saleRecord);
  await saveSales(sales);

  console.log('✅ Sale recorded:', signature);

  // Send Telegram notification
  if (telegramService.enabled) {
    try {
      await telegramService.sendPurchaseNotification(saleRecord);
    } catch (err) {
      console.error('⚠️ Error sending Telegram notification:', err.message);
      // Don't fail the purchase if notification fails
    }
  }

  return {
    ok: true,
    sale: saleRecord,
    message: 'Purchase processed successfully'
  };
}

module.exports = {
  initSales,
  getSales,
  saveSales,
  getSalesStats,
  processPurchase
};
