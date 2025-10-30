/**
 * Referral System
 * Users earn commissions by bringing new buyers
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ReferralSystem {
  constructor(dataPath) {
    this.dataPath = dataPath;
    this.referralsFile = path.join(dataPath, 'referrals.json');
    this.commissionRate = 0.10; // 10% commission
    this.init();
  }

  // Initialize referrals file
  init() {
    if (!fs.existsSync(this.referralsFile)) {
      const initialData = {
        referrals: [],
        codes: {},
        stats: {
          totalReferrals: 0,
          totalCommissions: 0,
          activeReferrers: 0,
        },
      };
      fs.writeFileSync(this.referralsFile, JSON.stringify(initialData, null, 2));
      console.log('✅ Initialized referrals.json');
    }
  }

  // Read referrals data
  readData() {
    try {
      const data = fs.readFileSync(this.referralsFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading referrals:', error);
      return {
        referrals: [],
        codes: {},
        stats: { totalReferrals: 0, totalCommissions: 0, activeReferrers: 0 },
      };
    }
  }

  // Write referrals data
  writeData(data) {
    fs.writeFileSync(this.referralsFile, JSON.stringify(data, null, 2));
  }

  // Generate unique referral code
  generateCode(wallet) {
    // Use first 6 chars of wallet + random 4 chars
    const walletPart = wallet.substring(0, 6).toUpperCase();
    const randomPart = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `${walletPart}${randomPart}`;
  }

  // Create or get referral code for wallet
  getOrCreateCode(wallet, name = '') {
    const data = this.readData();

    // Check if wallet already has a code
    for (const [code, info] of Object.entries(data.codes)) {
      if (info.wallet === wallet) {
        return {
          ok: true,
          code,
          url: `${process.env.SITE_URL || 'https://www.solanamillondollar.com'}?ref=${code}`,
          ...info,
        };
      }
    }

    // Create new code
    let code = this.generateCode(wallet);
    
    // Ensure uniqueness
    while (data.codes[code]) {
      code = this.generateCode(wallet);
    }

    data.codes[code] = {
      wallet,
      name,
      created: Date.now(),
      totalReferrals: 0,
      totalCommissions: 0,
      pendingCommissions: 0,
      referrals: [],
    };

    this.writeData(data);

    console.log(`✅ Created referral code ${code} for ${wallet}`);

    return {
      ok: true,
      code,
      url: `${process.env.SITE_URL || 'https://www.solanamillondollar.com'}?ref=${code}`,
      ...data.codes[code],
    };
  }

  // Validate referral code
  validateCode(code) {
    if (!code || typeof code !== 'string') {
      return { ok: false, error: 'Invalid code' };
    }

    const data = this.readData();
    
    if (!data.codes[code]) {
      return { ok: false, error: 'Code not found' };
    }

    return {
      ok: true,
      referrer: data.codes[code],
    };
  }

  // Record a referral sale
  recordReferral(code, sale) {
    const data = this.readData();

    if (!data.codes[code]) {
      console.error(`❌ Referral code ${code} not found`);
      return { ok: false, error: 'Code not found' };
    }

    const commission = sale.amount * this.commissionRate;

    const referral = {
      code,
      referrer: data.codes[code].wallet,
      buyer: sale.buyer,
      amount: sale.amount,
      commission,
      signature: sale.signature,
      timestamp: Date.now(),
      paid: false,
    };

    // Add to referrals list
    data.referrals.push(referral);

    // Update code stats
    data.codes[code].totalReferrals++;
    data.codes[code].totalCommissions += commission;
    data.codes[code].pendingCommissions += commission;
    data.codes[code].referrals.push({
      buyer: sale.buyer,
      amount: sale.amount,
      commission,
      timestamp: referral.timestamp,
    });

    // Update global stats
    data.stats.totalReferrals++;
    data.stats.totalCommissions += commission;

    this.writeData(data);

    console.log(`✅ Recorded referral: ${code} earned ${commission} SOL`);

    return {
      ok: true,
      referral,
      commission,
    };
  }

  // Get referrer stats
  getStats(wallet) {
    const data = this.readData();

    for (const [code, info] of Object.entries(data.codes)) {
      if (info.wallet === wallet) {
        return {
          ok: true,
          code,
          ...info,
          referrals: info.referrals.slice(-10), // Last 10 referrals
        };
      }
    }

    return {
      ok: false,
      error: 'Wallet not found',
    };
  }

  // Get leaderboard
  getLeaderboard(limit = 10) {
    const data = this.readData();

    const leaderboard = Object.entries(data.codes)
      .map(([code, info]) => ({
        code,
        wallet: info.wallet.substring(0, 8) + '...',
        name: info.name || 'Anonymous',
        totalReferrals: info.totalReferrals,
        totalCommissions: info.totalCommissions,
      }))
      .sort((a, b) => b.totalCommissions - a.totalCommissions)
      .slice(0, limit);

    return {
      ok: true,
      leaderboard,
      stats: data.stats,
    };
  }

  // Mark commission as paid
  markPaid(referralId) {
    const data = this.readData();

    const referral = data.referrals.find(r => r.signature === referralId);
    if (!referral) {
      return { ok: false, error: 'Referral not found' };
    }

    referral.paid = true;
    referral.paidAt = Date.now();

    // Update code pending commissions
    if (data.codes[referral.code]) {
      data.codes[referral.code].pendingCommissions -= referral.commission;
    }

    this.writeData(data);

    return { ok: true };
  }
}

module.exports = ReferralSystem;
