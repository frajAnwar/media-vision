const { getDB, initDB } = require('../src/db');
initDB();
const db = getDB();
db.prepare("UPDATE products SET confidence = 0.9 WHERE confidence = '0. nine'").run();
console.log('Fixed DB.');
