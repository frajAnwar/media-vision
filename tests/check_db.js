const { getDB, initDB } = require('../src/db');
initDB();
const rows = getDB().prepare("SELECT reference, confidence FROM products WHERE reference LIKE '%72A%'").all();
console.log('Results:', rows);
