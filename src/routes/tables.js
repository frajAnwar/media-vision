const express  = require('express');
const router   = express.Router();
const { getDB } = require('../db');

// GET /api/tables — list all imported reference tables with counts
router.get('/', (req, res) => {
  const db    = getDB();
  const tables = db.prepare(`
    SELECT table_name, COUNT(*) as row_count, MAX(created_at) as last_updated
    FROM reference_tables
    GROUP BY table_name
    ORDER BY table_name
  `).all();
  res.json(tables);
});

// GET /api/tables/:name — get rows of a table (max 500)
router.get('/:name', (req, res) => {
  const db   = getDB();
  const rows = db.prepare(
    'SELECT row_data FROM reference_tables WHERE table_name = ? ORDER BY id LIMIT 500'
  ).all(req.params.name);
  res.json(rows.map(r => JSON.parse(r.row_data)));
});

// POST /api/tables/import — paste CSV text to import a reference table
router.post('/import', (req, res) => {
  const { tableName, csvText } = req.body;

  if (!tableName || !csvText) {
    return res.status(400).json({ error: 'tableName et csvText sont requis.' });
  }

  try {
    const rows = _parseCSV(csvText.trim());
    if (!rows.length) {
      return res.status(400).json({ error: 'Aucune donnée trouvée dans le CSV.' });
    }

    const db     = getDB();
    const del    = db.prepare('DELETE FROM reference_tables WHERE table_name = ?');
    const insert = db.prepare('INSERT INTO reference_tables (table_name, row_data) VALUES (?, ?)');

    const run = db.transaction(() => {
      del.run(tableName);
      for (const row of rows) insert.run(tableName, JSON.stringify(row));
    });
    run();

    res.json({ success: true, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tables/:name — remove a reference table
router.delete('/:name', (req, res) => {
  getDB().prepare('DELETE FROM reference_tables WHERE table_name = ?').run(req.params.name);
  res.json({ success: true });
});

// ── CSV parser (handles ; and , delimiters, quoted cells with newlines) ─────
function _parseCSV(text) {
  const sep = text.split('\n')[0].includes(';') ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const nextC = text[i + 1];

    if (c === '"') {
      if (inQ && nextC === '"') {
        cell += '"';
        i++; // skip next quote
      } else {
        inQ = !inQ;
      }
    } else if (c === sep && !inQ) {
      row.push(cell.trim());
      cell = '';
    } else if ((c === '\n' || (c === '\r' && nextC === '\n')) && !inQ) {
      if (c === '\r') i++; // skip \n
      row.push(cell.trim());
      if (row.some(x => x)) rows.push(row); // push if not totally empty
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }
  // push last cell/row
  row.push(cell.trim());
  if (row.some(x => x)) rows.push(row);

  if (rows.length < 2) return [];

  const headers = rows[0];
  const parsedRows = [];
  
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    const parsedRow = {};
    headers.forEach((h, idx) => {
      let key = h.replace(/^"(.*)"$/, '$1');
      let val = (values[idx] || '').replace(/^"(.*)"$/, '$1');
      parsedRow[key] = val;
    });
    parsedRows.push(parsedRow);
  }

  return parsedRows;
}

module.exports = router;
