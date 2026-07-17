const { getDB, initDB } = require('../src/db');
initDB();
const rows = getDB().prepare("SELECT key, value FROM settings WHERE key='serper_key'").all();
console.log('Key:', rows[0]?.value);
