// Ejecutar solo si tienes data/referrals.json y quieres importar a SQLite
const fs = require('fs');
const path = require('path');
const referralService = require('../services/referralService');

const file = path.join(__dirname, '..', 'data', 'referrals.json');
if (!fs.existsSync(file)) {
  console.error('No existe data/referrals.json — nada que migrar');
  process.exit(1);
}
const content = JSON.parse(fs.readFileSync(file,'utf8'));

// Example file structure expectation:
// [
//   { "code":"abc", "name":"Juan", "wallet":"...","balance_cents":0,"total_earnings_cents":0,"total_sales":0, "clicks": [], "sales": [] }
// ]

(async () => {
  try {
    content.forEach(r => {
      // create referrer (idempotent by code not implemented here): we create new with same code using raw SQL
      // WARNING: this script is simple — revisa antes de ejecutar
      const dbPath = path.join(__dirname, '..', 'data', 'referrals.db');
      const Database = require('better-sqlite3');
      const db = new Database(dbPath);
      db.prepare('INSERT OR IGNORE INTO referrers (code, name, wallet, balance_cents, total_earnings_cents, total_sales, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        r.code, r.name || null, r.wallet || null, r.balance_cents || 0, r.total_earnings_cents || 0, r.total_sales || 0, r.created_at || null
      );
      // optional: add clicks and sales if shape matches
      const ref = db.prepare('SELECT id FROM referrers WHERE code = ?').get(r.code);
      if (ref && Array.isArray(r.clicks)) {
        const insertClick = db.prepare('INSERT INTO clicks (referrer_id, ip, user_agent, created_at) VALUES (?, ?, ?, ?)');
        r.clicks.forEach(c => insertClick.run(ref.id, c.ip || null, c.user_agent || null, c.created_at || null));
      }
      if (ref && Array.isArray(r.sales)) {
        const insertSale = db.prepare('INSERT OR IGNORE INTO sales (referrer_id, sale_id, amount_cents, commission_cents, status, created_at) VALUES (?, ?, ?, ?, ?, ?)');
        r.sales.forEach(s => insertSale.run(ref.id, s.sale_id, s.amount_cents || 0, s.commission_cents || 0, s.status || 'confirmed', s.created_at || null));
      }
      db.close();
    });
    console.log('Migración completada (revisa logs).');
  } catch (err) {
    console.error('Error durante migración', err);
  }
})();
