const express = require('express');
const router = express.Router();
const referralService = require('../services/referralService');

const adminPassword = process.env.ADMIN_PASSWORD || 'changeme';
function adminAuth(req, res, next){
  const auth = req.headers['x-admin-password'] || req.query.admin_password || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!auth || auth !== adminPassword) return res.status(401).json({error: 'unauthorized'});
  next();
}

// Public: create/get a referrer (idempotent if wallet provided)
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

// Public: track click (called from landing page when ?ref=CODE)
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

// Public: record confirmed sale (idempotent by saleId)
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

// Public: leaderboard
router.get('/leaderboard', (req, res) => {
  const list = referralService.getLeaderboard(25);
  res.json({list});
});

// Public: get referrer stats by code
router.get('/stats/:code', (req, res) => {
  const code = req.params.code;
  const ref = referralService.getReferrerByCode(code);
  if (!ref) return res.status(404).json({error: 'not found'});
  const stats = referralService.getReferrerStats(ref.id);
  res.json({stats});
});

// Admin: list all referrers
router.get('/admin/referrers', adminAuth, (req, res) => {
  const r = referralService.listReferrers();
  res.json({referrers: r});
});

// Admin: list sales
router.get('/admin/sales', adminAuth, (req, res) => {
  const s = referralService.listSales();
  res.json({sales: s});
});

// Admin: tiers
router.get('/admin/tiers', adminAuth, (req, res) => {
  res.json({tiers: referralService.getTiers()});
});
router.post('/admin/tiers/:id', adminAuth, (req, res) => {
  referralService.updateTier(req.params.id, req.body || {});
  res.json({ok: true});
});

module.exports = router;
