const express = require('express');
const router = express.Router();
const referralService = require('../services/referralService');

const adminPassword = process.env.ADMIN_PASSWORD || 'changeme';
function adminAuth(req, res, next){
  const auth = req.headers['x-admin-password'] || req.query.admin_password || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!auth || auth !== adminPassword) return res.status(401).json({error: 'unauthorized'});
  next();
}

// Create/get referrer
router.post('/create', (req, res) => {
  try {
    const {name, wallet} = req.body || {};
    if (!wallet && !name) return res.status(400).json({error: 'name or wallet required'});
    const ref = referralService.createReferrer({name, wallet});
    res.json({ref});
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Track click
router.post('/click', (req, res) => {
  try {
    const {code} = req.body;
    const ref = referralService.getReferrerByCode(code);
    if (!ref) return res.status(404).json({error: 'referrer not found'});
    referralService.recordClick(ref.id, req.ip, req.get('user-agent'));
    res.json({ok: true});
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Record sale (idempotent)
router.post('/record-sale', (req, res) => {
  try {
    const {code, saleId, amountCents} = req.body || {};
    if (!code || !saleId || typeof amountCents !== 'number') return res.status(400).json({error: 'missing fields'});
    const result = referralService.recordSale({referrerCode: code, saleId, amountCents});
    res.json({ok: true, result});
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Leaderboard
router.get('/leaderboard', (req, res) => {
  const list = referralService.getLeaderboard(25);
  res.json({list});
});

// Get referrer stats by code
router.get('/stats/:code', (req, res) => {
  const code = req.params.code;
  const ref = referralService.getReferrerByCode(code);
  if (!ref) return res.status(404).json({error: 'not found'});
  const stats = referralService.getReferrerStats(ref.id);
  res.json({stats});
});

// Admin list referrers & sales & tiers (protected)
router.get('/admin/referrers', adminAuth, (req, res) => {
  const r = referralService.listReferrers();
  res.json({referrers: r});
});
router.get('/admin/sales', adminAuth, (req, res) => {
  const s = referralService.listSales();
  res.json({sales: s});
});
router.get('/admin/tiers', adminAuth, (req, res) => {
  res.json({tiers: referralService.getTiers()});
});
router.post('/admin/tiers/:id', adminAuth, (req, res) => {
  referralService.updateTier(req.params.id, req.body || {});
  res.json({ok: true});
});

// --- Gift code endpoints ---

// Public: get latest gift code for a wallet (call this after user connects wallet)
router.get('/gift/latest/:wallet', (req, res) => {
  try {
    const wallet = req.params.wallet;
    if (!wallet) return res.status(400).json({error: 'wallet required'});
    const gift = referralService.getLatestGiftForWallet(wallet);
    res.json({gift});
  } catch (err) {
    res.status(500).json({error: err.message});
  }
});

// Admin: create gift code (assign to wallet or generic)
router.post('/admin/gift/create', adminAuth, (req, res) => {
  try {
    const { wallet, valueSol, code, expiresAt } = req.body || {};
    if (!valueSol) return res.status(400).json({ error: 'valueSol required' });
    const gift = referralService.createGiftCode({ code, wallet, valueSol, expiresAt });
    res.json({ gift });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: list gifts
router.get('/admin/gifts', adminAuth, (req, res) => {
  try {
    const list = referralService.listGifts();
    res.json({ gifts: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Redeem gift
router.post('/gift/redeem', (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'code required' });
    const result = referralService.redeemGift(code);
    if (!result) return res.status(404).json({ error: 'gift not found' });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
