const { getDB, initDB } = require('./src/db');
initDB();
const db = getDB();
const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('search_provider', 'serper_key', 'tavily_key')").all();
console.log(rows);
