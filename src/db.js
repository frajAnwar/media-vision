const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DB_PATH 
  ? path.dirname(process.env.DB_PATH) 
  : path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'mediavision.db');

let _db = null;

function getDB() {
  if (!_db) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
  }
  return _db;
}

function initDB() {
  const db = getDB();

  // ── Products staging table ────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id                  TEXT PRIMARY KEY,
      reference           TEXT NOT NULL,
      raw_price           REAL,
      status              TEXT DEFAULT 'pending',
      confidence          REAL DEFAULT 0,
      product_title       TEXT,
      brand               TEXT,
      html_description    TEXT,
      seo_excerpt         TEXT,
      suggested_category  TEXT,
      resolved_category_id   INTEGER,
      resolved_tax_rule_id   INTEGER,
      extracted_specs     TEXT,
      high_res_images     TEXT,
      selected_image      TEXT,
      error_message       TEXT,
      mismatch_warning    TEXT,
      confidence_reason   TEXT,
      resolved_category_ids TEXT,
      matched_features    TEXT,
      created_at          INTEGER DEFAULT (strftime('%s','now')),
      updated_at          INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  try {
    db.exec(`ALTER TABLE products ADD COLUMN confidence_reason TEXT`);
  } catch (e) {}

  try {
    db.exec(`ALTER TABLE products ADD COLUMN resolved_category_ids TEXT`);
  } catch (e) {}

  try {
    db.exec(`ALTER TABLE products ADD COLUMN meta_title TEXT`);
  } catch (e) {}

  try {
    db.exec(`ALTER TABLE products ADD COLUMN meta_keywords TEXT`);
  } catch (e) {}

  try {
    db.exec(`ALTER TABLE products ADD COLUMN meta_description TEXT`);
  } catch (e) {}

  try {
    db.exec(`ALTER TABLE products ADD COLUMN matched_features TEXT`);
  } catch (e) {}

  // ── Settings key/value store ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // ── Reference tables (categories, tax rules, etc.) ────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS reference_tables (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name  TEXT NOT NULL,
      row_data    TEXT NOT NULL,
      created_at  INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  // ── Pre-seed PrestaShop Categories ────────────────────────────────────────
  try {
    const catsCount = db.prepare("SELECT COUNT(*) as count FROM reference_tables WHERE table_name = 'categories'").get().count;
    if (catsCount === 0) {
      const catsPath = path.join(__dirname, 'data', 'categories.json');
      if (fs.existsSync(catsPath)) {
        const catsData = JSON.parse(fs.readFileSync(catsPath, 'utf8'));
        const insert = db.prepare("INSERT INTO reference_tables (table_name, row_data) VALUES ('categories', ?)");
        const run = db.transaction(() => {
          for (const row of catsData) {
            insert.run(JSON.stringify(row));
          }
        });
        run();
        console.log(`✅ Pre-seeded ${catsData.length} PrestaShop categories.`);
      }
    }
  } catch(e) {
    console.error('Failed to pre-seed categories:', e);
  }

  // ── Pipeline jobs ─────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id          TEXT PRIMARY KEY,
      status      TEXT DEFAULT 'pending',
      total       INTEGER DEFAULT 0,
      completed   INTEGER DEFAULT 0,
      created_at  INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  console.log('✅ Database ready at', DB_PATH);
}

module.exports = { getDB, initDB };
