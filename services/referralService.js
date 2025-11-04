/**
 * services/referralService.js
 * Intentará usar better-sqlite3 si está disponible.
 * Si no está instalado, caerá a un backend basado en JSON (data/referrals.json).
 *
 * Nota: el fallback JSON funciona bien para desarrollo y despliegues rápidos,
 * pero no es ideal en entornos con múltiples procesos/replicas (race conditions).
 */

const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let backend = null;

function nowISO() { return new Date().toISOString(); }
function atomicWrite(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

// JSON fallback implementation
function createJSONBackend() {
  const file = path.join(dataDir, 'referrals.json');

  // initialize if missing
  if (!fs.existsSync(file)) {
    const initial = {
      referrers: [],
      clicks: [],
      sales: [],
      tiers: [
        { id: 1, name: 'Bronze', min_sales: 0, commission_percent: 5 },
        { id: 2, name: 'Silver', min_sales: 10, commission_percent: 7 },
        { id: 3, name: 'Gold', min_sales: 30, commission_percent: 10 }
      ],
      _counters: { referrerId: 0, clickId: 0, saleId: 0, tierId: 3 }
    };
    atomicWrite(file, initial);
  }

  function load() {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  function save(data) {
    atomicWrite(file, data);
  }

  function generateCode(seed) {
    const base = (seed || Math.random().toString(36).slice(2,8)).replace(/[^a-z0-9]/gi,'').slice(0,6);
    return `${base}-${Date.now().toString(36)}`.slice(0,24);
  }

  return {
    createReferrer: ({name, wallet}) => {
      const data = load();
      data._counters.referrerId += 1;
      const id = data._counters.referrerId;
      let code = generateCode(name || wallet || undefined);
      // ensure uniqueness
      while (data.referrers.some(r => r.code === code)) {
        code = generateCode();
      }
      const ref = {
        id,
        code,
        name: name || null,
        wallet: wallet || null,
        balance_cents: 0,
        total_earnings_cents: 0,
        total_sales: 0,
        created_at: nowISO()
      };
      data.referrers.push(ref);
      save(data);
      return ref;
    },

    getReferrerByCode: (code) => {
      const data = load();
      return data.referrers.find(r => r.code === code) || null;
    },

    recordClick: (referrerId, ip, userAgent) => {
      const data = load();
      data._counters.clickId += 1;
      const click = {
        id: data._counters.clickId,
        referrer_id: referrerId,
        ip: ip || null,
        user_agent: userAgent || null,
        created_at: nowISO()
      };
      data.clicks.push(click);
      save(data);
      return click;
    },

    _computeCommissionForReferrer: (referrerId, amountCents) => {
      const data = load();
      const ref = data.referrers.find(r => r.id === referrerId);
      if (!ref) return 0;
      // pick highest tier with min_sales <= ref.total_sales
      const tier = data.tiers.filter(t => (t.min_sales || 0) <= (ref.total_sales || 0)).sort((a,b)=>b.min_sales - a.min_sales)[0];
      const pct = (tier && tier.commission_percent) ? tier.commission_percent : 5;
      return Math.floor(amountCents * pct / 100);
    },

    recordSale: ({referrerCode, saleId, amountCents}) => {
      const data = load();
      const ref = data.referrers.find(r => r.code === referrerCode);
      if (!ref) throw new Error('Referrer not found');
      // idempotency by saleId
      const exists = data.sales.find(s => s.sale_id === saleId);
      if (exists) return {alreadyExists: true, sale: exists};
      data._counters.saleId += 1;
      const commission = this ? 0 : 0; // placeholder removed below
      // compute commission using local logic:
      const compute = (rid, amt) => {
        const r = data.referrers.find(x => x.id === rid);
        const tier = data.tiers.filter(t => (t.min_sales || 0) <= (r.total_sales || 0)).sort((a,b)=>b.min_sales - a.min_sales)[0];
        const pct = (tier && tier.commission_percent) ? tier.commission_percent : 5;
        return Math.floor(amt * pct / 100);
      };
      const comm = compute(ref.id, amountCents);
      const sale = {
        id: data._counters.saleId,
        referrer_id: ref.id,
        sale_id: saleId,
        amount_cents: amountCents,
        commission_cents: comm,
        status: 'confirmed',
        created_at: nowISO()
      };
      data.sales.push(sale);
      // credit referrer
      ref.balance_cents = (ref.balance_cents || 0) + comm;
      ref.total_earnings_cents = (ref.total_earnings_cents || 0) + comm;
      ref.total_sales = (ref.total_sales || 0) + 1;
      save(data);
      return {sale};
    },

    confirmSaleStatus: (saleId, status) => {
      const data = load();
      const sale = data.sales.find(s => s.sale_id === saleId);
      if (!sale) return null;
      sale.status = status;
      save(data);
      return sale;
    },

    getLeaderboard: (limit = 10) => {
      const data = load();
      const list = data.referrers.slice().sort((a,b) => (b.total_earnings_cents||0) - (a.total_earnings_cents||0)).slice(0, limit);
      return list.map(r => ({ id: r.id, code: r.code, name: r.name, total_earnings_cents: r.total_earnings_cents || 0, total_sales: r.total_sales || 0 }));
    },

    getReferrerStats: (referrerId) => {
      const data = load();
      const clicks = data.clicks.filter(c => c.referrer_id === referrerId).length;
      const salesData = data.sales.filter(s => s.referrer_id === referrerId);
      const sales_count = salesData.length;
      const total_amount = salesData.reduce((acc,s)=>acc + (s.amount_cents||0), 0);
      const total_commission = salesData.reduce((acc,s)=>acc + (s.commission_cents||0), 0);
      const ref = data.referrers.find(r => r.id === referrerId);
      return {
        referrer: ref || null,
        clicks,
        sales_count,
        sales_amount_cents: total_amount,
        commission_cents: total_commission
      };
    },

    listReferrers: () => {
      const data = load();
      return data.referrers.slice().sort((a,b)=> (b.total_earnings_cents||0) - (a.total_earnings_cents||0));
    },

    listSales: () => {
      const data = load();
      // include referrer code/name
      return data.sales.slice().map(s => {
        const r = data.referrers.find(x => x.id === s.referrer_id) || {};
        return Object.assign({}, s, { ref_code: r.code || null, ref_name: r.name || null });
      }).sort((a,b)=> new Date(b.created_at) - new Date(a.created_at)).slice(0,500);
    },

    getTiers: () => {
      const data = load();
      return data.tiers.slice().sort((a,b)=> (a.min_sales||0) - (b.min_sales||0));
    },

    updateTier: (id, fields) => {
      const data = load();
      const t = data.tiers.find(x => String(x.id) === String(id));
      if (!t) return null;
      if (fields.name !== undefined) t.name = fields.name;
      if (fields.min_sales !== undefined) t.min_sales = Number(fields.min_sales);
      if (fields.commission_percent !== undefined) t.commission_percent = Number(fields.commission_percent);
      save(data);
      return t;
    }
  };
}

// Main attempt: try to use better-sqlite3 backend
try {
  const Database = require('better-sqlite3');
  const dbPath = process.env.REFERRAL_DB_PATH || path.join(dataDir, 'referrals.db');
  const db = new Database(dbPath);
  // create schema if needed
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
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER,
      sale_id TEXT UNIQUE,
      amount_cents INTEGER,
      commission_cents INTEGER,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      min_sales INTEGER DEFAULT 0,
      commission_percent INTEGER DEFAULT 5
    );
  `);

  // prepare statements
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

  backend = {
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
      const commission = backend._computeCommissionForReferrer(ref.id, amountCents);
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

  console.log('referralService: using better-sqlite3 backend');
} catch (err) {
  console.warn('referralService: better-sqlite3 not available, falling back to JSON backend. Error:', err && err.message);
  backend = createJSONBackend();
  console.log('referralService: using JSON fallback backend at data/referrals.json');
}

module.exports = backend;
