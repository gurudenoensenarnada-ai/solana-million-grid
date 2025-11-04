/**
 * services/referralService.js
 * Referral service with SQLite (better-sqlite3) if available,
 * otherwise JSON fallback in data/referrals.json.
 *
 * Provides:
 * - createReferrer / getReferrerByCode / recordClick / recordSale ...
 * - createGiftIfEligible(wallet, amountSol) -> generates gift code for purchases >= thresholds
 * - getLatestGiftForWallet(wallet)
 * - admin create/list gift codes
 */

const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let backend = null;
function nowISO(){ return new Date().toISOString(); }
function atomicWrite(filePath, data){
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}
function generateCodeSeed(seed){
  const base = (seed || Math.random().toString(36).slice(2,8)).replace(/[^a-z0-9]/gi,'').slice(0,6);
  return `${base}-${Date.now().toString(36)}`.slice(0,24);
}

/* -----------------------
   JSON fallback backend
   ----------------------- */
function createJSONBackend(){
  const file = path.join(dataDir, 'referrals.json');

  if (!fs.existsSync(file)){
    const initial = {
      referrers: [],
      clicks: [],
      sales: [],
      tiers: [
        { id: 1, name: 'Bronze', min_sales: 0, commission_percent: 5 },
        { id: 2, name: 'Silver', min_sales: 10, commission_percent: 7 },
        { id: 3, name: 'Gold', min_sales: 30, commission_percent: 10 }
      ],
      gifts: [], // gift codes
      _counters: { referrerId: 0, clickId: 0, saleId: 0, giftId: 0, tierId: 3 }
    };
    atomicWrite(file, initial);
  }

  function load(){ return JSON.parse(fs.readFileSync(file,'utf8')); }
  function save(d){ atomicWrite(file, d); }

  return {
    // existing methods (createReferrer, getReferrerByCode, recordClick, recordSale, etc.)
    createReferrer: ({name, wallet}) => {
      const data = load();
      data._counters.referrerId += 1;
      const id = data._counters.referrerId;
      let code = generateCodeSeed(name || wallet);
      while (data.referrers.some(r => r.code === code)) code = generateCodeSeed();
      const ref = { id, code, name: name||null, wallet: wallet||null, balance_cents:0, total_earnings_cents:0, total_sales:0, created_at: nowISO() };
      data.referrers.push(ref);
      save(data);
      return ref;
    },

    getReferrerByCode: (code) => {
      const data = load();
      return data.referrers.find(r=>r.code===code) || null;
    },

    recordClick: (referrerId, ip, userAgent) => {
      const data = load();
      data._counters.clickId += 1;
      const click = { id: data._counters.clickId, referrer_id: referrerId, ip: ip||null, user_agent: userAgent||null, created_at: nowISO() };
      data.clicks.push(click);
      save(data);
      return click;
    },

    _computeCommissionForReferrer: (referrerId, amountCents) => {
      const data = load();
      const ref = data.referrers.find(r=>r.id===referrerId);
      if (!ref) return 0;
      const tier = data.tiers.filter(t => (t.min_sales||0) <= (ref.total_sales||0)).sort((a,b)=>b.min_sales - a.min_sales)[0];
      const pct = (tier && tier.commission_percent) ? tier.commission_percent : 5;
      return Math.floor(amountCents * pct / 100);
    },

    recordSale: ({referrerCode, saleId, amountCents}) => {
      const data = load();
      const ref = data.referrers.find(r=>r.code===referrerCode);
      if (!ref) throw new Error('Referrer not found');
      const exists = data.sales.find(s => s.sale_id === saleId);
      if (exists) return { alreadyExists:true, sale:exists };
      data._counters.saleId += 1;
      const commission = (function(rid, amt){
        const r = data.referrers.find(x=>x.id===rid);
        const tier = data.tiers.filter(t => (t.min_sales||0) <= (r.total_sales||0)).sort((a,b)=>b.min_sales - a.min_sales)[0];
        const pct = (tier && tier.commission_percent) ? tier.commission_percent : 5;
        return Math.floor(amt * pct / 100);
      })(ref.id, amountCents);
      const sale = { id: data._counters.saleId, referrer_id: ref.id, sale_id: saleId, amount_cents: amountCents, commission_cents: commission, status: 'confirmed', created_at: nowISO() };
      data.sales.push(sale);
      ref.balance_cents = (ref.balance_cents||0) + commission;
      ref.total_earnings_cents = (ref.total_earnings_cents||0) + commission;
      ref.total_sales = (ref.total_sales||0) + 1;
      save(data);
      return { sale };
    },

    confirmSaleStatus: (saleId, status) => {
      const data = load();
      const s = data.sales.find(x => x.sale_id === saleId);
      if (!s) return null;
      s.status = status;
      save(data);
      return s;
    },

    getLeaderboard: (limit=10) => {
      const data = load();
      return data.referrers.slice().sort((a,b)=> (b.total_earnings_cents||0) - (a.total_earnings_cents||0)).slice(0,limit)
        .map(r=>({ id: r.id, code: r.code, name: r.name, total_earnings_cents: r.total_earnings_cents||0, total_sales: r.total_sales||0 }));
    },

    getReferrerStats: (referrerId) => {
      const data = load();
      const clicks = data.clicks.filter(c=>c.referrer_id===referrerId).length;
      const sales = data.sales.filter(s=>s.referrer_id===referrerId);
      return {
        referrer: data.referrers.find(r=>r.id===referrerId) || null,
        clicks,
        sales_count: sales.length,
        sales_amount_cents: sales.reduce((a,b)=>a + (b.amount_cents||0),0),
        commission_cents: sales.reduce((a,b)=>a + (b.commission_cents||0),0)
      };
    },

    listReferrers: () => { const data = load(); return data.referrers.slice().sort((a,b)=> (b.total_earnings_cents||0) - (a.total_earnings_cents||0)); },
    listSales: () => { const data = load(); return data.sales.slice().map(s => { const r = data.referrers.find(x=>x.id===s.referrer_id)||{}; return Object.assign({}, s, { ref_code: r.code||null, ref_name: r.name||null }); }).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at)).slice(0,500); },
    getTiers: () => { const data = load(); return data.tiers.slice().sort((a,b)=> (a.min_sales||0) - (b.min_sales||0)); },
    updateTier: (id, fields) => {
      const data = load();
      const t = data.tiers.find(x => String(x.id) === String(id));
      if (!t) return null;
      if (fields.name !== undefined) t.name = fields.name;
      if (fields.min_sales !== undefined) t.min_sales = Number(fields.min_sales);
      if (fields.commission_percent !== undefined) t.commission_percent = Number(fields.commission_percent);
      save(data);
      return t;
    },

    /* Gift codes (JSON) */
    createGiftCode: ({code, wallet, valueSol, expiresAt}) => {
      const data = load();
      data._counters.giftId += 1;
      const id = data._counters.giftId;
      let c = code || generateCodeSeed(wallet);
      while (data.gifts.some(g => g.code === c)) c = generateCodeSeed();
      const gift = { id, code: c, wallet: wallet || null, value_sol: valueSol || 0, used: false, created_at: nowISO(), expires_at: expiresAt || null };
      data.gifts.push(gift);
      save(data);
      return gift;
    },

    createGiftIfEligible: (wallet, amountSol) => {
      // Generate a 1 SOL code if amount >= 1, else 0.5 SOL if >=0.5
      if (!wallet) return null;
      const value = amountSol >= 1 ? 1.0 : (amountSol >= 0.5 ? 0.5 : 0);
      if (!value) return null;
      const gift = this.createGiftCode({ wallet, valueSol: value });
      return gift;
    },

    getLatestGiftForWallet: (wallet) => {
      const data = load();
      const gifts = data.gifts.filter(g => g.wallet === wallet).sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
      return gifts[0] || null;
    },

    listGifts: () => { const data = load(); return data.gifts.slice().sort((a,b) => new Date(b.created_at) - new Date(a.created_at)); },

    redeemGift: (code) => {
      const data = load();
      const g = data.gifts.find(x => x.code === code);
      if (!g) return null;
      if (g.used) return { alreadyUsed: true, gift: g };
      g.used = true;
      g.redeemed_at = nowISO();
      save(data);
      return { gift: g };
    }
  };
}

/* -----------------------
   Try better-sqlite3 backend
   ----------------------- */
try {
  const Database = require('better-sqlite3');
  const dbPath = process.env.REFERRAL_DB_PATH || path.join(dataDir, 'referrals.db');
  const db = new Database(dbPath);
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
    CREATE TABLE IF NOT EXISTS gifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      wallet TEXT,
      value_sol REAL DEFAULT 0,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT,
      redeemed_at TEXT
    );
  `);

  // Prepare statements
  const createReferrerStmt = db.prepare('INSERT INTO referrers (code, name, wallet) VALUES (?, ?, ?)');
  const getReferrerByCodeStmt = db.prepare('SELECT * FROM referrers WHERE code = ?');
  const getReferrerByIdStmt = db.prepare('SELECT * FROM referrers WHERE id = ?');
  const insertClickStmt = db.prepare('INSERT INTO clicks (referrer_id, ip, user_agent) VALUES (?, ?, ?)');
  const insertSaleStmt = db.prepare('INSERT INTO sales (referrer_id, sale_id, amount_cents, commission_cents, status) VALUES (?, ?, ?, ?, ?)');
  const updateSaleStatusStmt = db.prepare('UPDATE sales SET status = ? WHERE sale_id = ?');
  const updateReferrerEarningsStmt = db.prepare('UPDATE referrers SET balance_cents = balance_cents + ?, total_earnings_cents = total_earnings_cents + ?, total_sales = total_sales + 1 WHERE id = ?');
  const getLeaderboardStmt = db.prepare('SELECT id, code, name, total_earnings_cents, total_sales FROM referrers ORDER BY total_earnings_cents DESC LIMIT ?');

  const createGiftStmt = db.prepare('INSERT INTO gifts (code, wallet, value_sol, used, expires_at) VALUES (?, ?, ?, 0, ?)');
  const getLatestGiftStmt = db.prepare('SELECT * FROM gifts WHERE wallet = ? ORDER BY created_at DESC LIMIT 1');
  const getGiftByCodeStmt = db.prepare('SELECT * FROM gifts WHERE code = ?');
  const redeemGiftStmt = db.prepare('UPDATE gifts SET used = 1, redeemed_at = ? WHERE code = ?');

  function generateCode(seed){ return generateCodeSeed(seed); }

  function ensureDefaultTiers(){
    const row = db.prepare('SELECT COUNT(*) AS c FROM tiers').get();
    if (row.c === 0){
      const insert = db.prepare('INSERT INTO tiers (name, min_sales, commission_percent) VALUES (?, ?, ?)');
      const insertMany = db.transaction((arr)=> arr.forEach(r => insert.run(r.name, r.min_sales, r.commission_percent)));
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
      const code = generateCode(name || wallet);
      const info = createReferrerStmt.run(code, name || null, wallet || null);
      return getReferrerByIdStmt.get(info.lastInsertRowid);
    },

    getReferrerByCode: (code) => getReferrerByCodeStmt.get(code),

    recordClick: (referrerId, ip, userAgent) => insertClickStmt.run(referrerId, ip || null, userAgent || null),

    _computeCommissionForReferrer: (referrerId, amountCents) => {
      const ref = getReferrerByIdStmt.get(referrerId);
      if (!ref) return 0;
      const tier = db.prepare('SELECT commission_percent FROM tiers WHERE min_sales <= ? ORDER BY min_sales DESC LIMIT 1').get(ref.total_sales || 0);
      const pct = (tier && tier.commission_percent) ? tier.commission_percent : 5;
      return Math.floor(amountCents * pct / 100);
    },

    recordSale: ({referrerCode, saleId, amountCents}) => {
      const ref = getReferrerByCodeStmt.get(referrerCode);
      if (!ref) throw new Error('Referrer not found');
      const exists = db.prepare('SELECT * FROM sales WHERE sale_id = ?').get(saleId);
      if (exists) return { alreadyExists:true, sale:exists };
      const commission = backend._computeCommissionForReferrer(ref.id, amountCents);
      const info = insertSaleStmt.run(ref.id, saleId, amountCents, commission, 'confirmed');
      updateReferrerEarningsStmt.run(commission, commission, ref.id);
      const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(info.lastInsertRowid);
      return { sale };
    },

    confirmSaleStatus: (saleId, status) => updateSaleStatusStmt.run(status, saleId),

    getLeaderboard: (limit=10) => getLeaderboardStmt.all(limit),

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

    listReferrers: () => db.prepare('SELECT * FROM referrers ORDER BY total_earnings_cents DESC').all(),
    listSales: () => db.prepare('SELECT sales.*, referrers.code as ref_code, referrers.name as ref_name FROM sales LEFT JOIN referrers ON sales.referrer_id = referrers.id ORDER BY sales.created_at DESC LIMIT 500').all(),
    getTiers: () => db.prepare('SELECT * FROM tiers ORDER BY min_sales ASC').all(),
    updateTier: (id, fields) => {
      const stmt = db.prepare('UPDATE tiers SET name = coalesce(?, name), min_sales = coalesce(?, min_sales), commission_percent = coalesce(?, commission_percent) WHERE id = ?');
      return stmt.run(fields.name || null, fields.min_sales || null, fields.commission_percent || null, id);
    },

    /* Gifts (SQLite) */
    createGiftCode: ({code, wallet, valueSol, expiresAt}) => {
      const c = code || generateCode(wallet);
      createGiftStmt.run(c, wallet || null, valueSol || 0, expiresAt || null);
      return getGiftByCodeStmt.get(c);
    },

    createGiftIfEligible: (wallet, amountSol) => {
      if (!wallet) return null;
      const value = amountSol >= 1 ? 1.0 : (amountSol >= 0.5 ? 0.5 : 0);
      if (!value) return null;
      const gift = backend.createGiftCode({ wallet, valueSol: value });
      return gift;
    },

    getLatestGiftForWallet: (wallet) => getLatestGiftStmt.get(wallet),

    listGifts: () => db.prepare('SELECT * FROM gifts ORDER BY created_at DESC').all(),

    redeemGift: (code) => {
      const g = getGiftByCodeStmt.get(code);
      if (!g) return null;
      if (g.used) return { alreadyUsed: true, gift: g };
      const now = nowISO();
      redeemGiftStmt.run(now, code);
      return getGiftByCodeStmt.get(code);
    }
  };

  console.log('referralService: using better-sqlite3 backend');
} catch (err) {
  console.warn('referralService: better-sqlite3 not available, falling back to JSON backend. Error:', err && err.message);
  backend = createJSONBackend();
  console.log('referralService: using JSON fallback backend at data/referrals.json');
}

module.exports = backend;
