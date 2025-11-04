const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.REFERRAL_DB_PATH || path.join(dataDir, 'referrals.db');
const db = new Database(dbPath);

// Init schema (idempotente)
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS referrers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT,
  wallet TEXT,
  balance_cents INTEGER DEFAULT 0,
  total_earnings_cents INTEGER DEFAULT 0,
  total_sales INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(referrer_id) REFERENCES referrers(id)
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER,
  sale_id TEXT UNIQUE,
  amount_cents INTEGER,
  commission_cents INTEGER,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(referrer_id) REFERENCES referrers(id)
);
CREATE TABLE IF NOT EXISTS tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  min_sales INTEGER DEFAULT 0,
  commission_percent INTEGER DEFAULT 5
);
`);

const createReferrerStmt = db.prepare('INSERT INTO referrers (code, name, wallet) VALUES (?, ?, ?)');
const getReferrerByCodeStmt = db.prepare('SELECT * FROM referrers WHERE code = ?');
const getReferrerByIdStmt = db.prepare('SELECT * FROM referrers WHERE id = ?');
const insertClickStmt = db.prepare('INSERT INTO clicks (referrer_id, ip, user_agent) VALUES (?, ?, ?)');
const insertSaleStmt = db.prepare('INSERT INTO sales (referrer_id, sale_id, amount_cents, commission_cents, status) VALUES (?, ?, ?, ?, ?)');
const updateSaleStatusStmt = db.prepare('UPDATE sales SET status = ? WHERE sale_id = ?');
const updateReferrerEarningsStmt = db.prepare('UPDATE referrers SET balance_cents = balance_cents + ?, total_earnings_cents = total_earnings_cents + ?, total_sales = total_sales + 1 WHERE id = ?');
const getLeaderboardStmt = db.prepare('SELECT id, code, name, total_earnings_cents, total_sales FROM referrers ORDER BY total_earnings_cents DESC LIMIT ?');

function generateCode(seed) {
  const base = (seed || Math.random().toString(36).slice(2,8)).replace(/[^a-z0-9]/gi,'').slice(0,6);
  return `${base}-${Date.now().toString(36)}`.slice(0,24);
}

function ensureDefaultTiers() {
  const row = db.prepare('SELECT COUNT(*) AS c FROM tiers').get();
  if (row.c === 0) {
    const insert = db.prepare('INSERT INTO tiers (name, min_sales, commission_percent) VALUES (?, ?, ?)');
    const insertMany = db.transaction((arr) => {
      arr.forEach(r => insert.run(r.name, r.min_sales, r.commission_percent));
    });
    insertMany([
      {name: 'Bronze', min_sales: 0, commission_percent: 5},
      {name: 'Silver', min_sales: 10, commission_percent: 7},
      {name: 'Gold', min_sales: 30, commission_percent: 10}
    ]);
  }
}
ensureDefaultTiers();

module.exports = {
  createReferrer: ({name, wallet}) => {
    const code = generateCode(name || wallet || undefined);
    const info = createReferrerStmt.run(code, name || null, wallet || null);
    return getReferrerByIdStmt.get(info.lastInsertRowid);
  },

  getReferrerByCode: (code) => {
    return getReferrerByCodeStmt.get(code);
  },

  recordClick: (referrerId, ip, userAgent) => {
    return insertClickStmt.run(referrerId, ip || null, userAgent || null);
  },

  _computeCommissionForReferrer: (referrerId, amountCents) => {
    const ref = getReferrerByIdStmt.get(referrerId);
    if (!ref) return 0;
    const tier = db.prepare('SELECT commission_percent FROM tiers WHERE min_sales <= ? ORDER BY min_sales DESC LIMIT 1').get(ref.total_sales || 0);
    const pct = (tier && tier.commission_percent) ? tier.commission_percent : 5;
    const commission = Math.floor(amountCents * pct / 100);
    return commission;
  },

  recordSale: ({referrerCode, saleId, amountCents}) => {
    const ref = getReferrerByCodeStmt.get(referrerCode);
    if (!ref) throw new Error('Referrer not found');
    const exists = db.prepare('SELECT * FROM sales WHERE sale_id = ?').get(saleId);
    if (exists) return {alreadyExists: true, sale: exists};
    const commission = module.exports._computeCommissionForReferrer(ref.id, amountCents);
    const info = insertSaleStmt.run(ref.id, saleId, amountCents, commission, 'confirmed');
    updateReferrerEarningsStmt.run(commission, commission, ref.id);
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(info.lastInsertRowid);
    return {sale};
  },

  confirmSaleStatus: (saleId, status) => {
    return updateSaleStatusStmt.run(status, saleId);
  },

  getLeaderboard: (limit = 10) => {
    return getLeaderboardStmt.all(limit);
  },

  getReferrerStats: (referrerId) => {
    const clicks = db.prepare('SELECT COUNT(*) as c FROM clicks WHERE referrer_id = ?').get(referrerId);
    const sales = db.prepare('SELECT COUNT(*) as c, SUM(amount_cents) as total_amount, SUM(commission_cents) as total_commission FROM sales WHERE referrer_id = ?').get(referrerId);
    const ref = getReferrerByIdStmt.get(referrerId);
    return {
      referrer: ref,
      clicks: clicks.c || 0,
      sales_count: sales.c || 0,
      sales_amount_cents: sales.total_amount || 0,
      commission_cents: sales.total_commission || 0
    };
  },

  listReferrers: () => {
    return db.prepare('SELECT * FROM referrers ORDER BY total_earnings_cents DESC').all();
  },

  listSales: () => {
    return db.prepare('SELECT sales.*, referrers.code as ref_code, referrers.name as ref_name FROM sales LEFT JOIN referrers ON sales.referrer_id = referrers.id ORDER BY sales.created_at DESC LIMIT 500').all();
  },

  getTiers: () => {
    return db.prepare('SELECT * FROM tiers ORDER BY min_sales ASC').all();
  },

  updateTier: (id, fields) => {
    const stmt = db.prepare('UPDATE tiers SET name = coalesce(?, name), min_sales = coalesce(?, min_sales), commission_percent = coalesce(?, commission_percent) WHERE id = ?');
    return stmt.run(fields.name || null, fields.min_sales || null, fields.commission_percent || null, id);
  }
};
