const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../data/mediavision.db'));

const errors = db.prepare("SELECT id, reference, error_message FROM products WHERE status = 'error' LIMIT 10").all();
console.log('--- ERRORS ---');
for (const e of errors) {
  console.log(`Ref: ${e.reference} | Error: ${e.error_message}`);
}
