const Database = require('better-sqlite3');
const db = new Database('data/mediavision.db');
const rows = db.prepare(`SELECT reference, seo_excerpt, meta_description FROM products WHERE reference IN ('KB223', 'KB271', 'KB2008', 'KB866L')`).all();
console.log(JSON.stringify(rows, null, 2));
