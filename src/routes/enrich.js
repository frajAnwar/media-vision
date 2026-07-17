const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const { getDB } = require('../db');
const { startPipeline, addSSEClient, removeSSEClient, cancelJob } = require('../pipeline');

// POST /api/enrich/start — kick off enrichment job
router.post('/start', async (req, res) => {
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items[] est requis.' });
  }

  const jobId       = crypto.randomUUID();
  const itemsWithId = items.map(item => ({ ...item, id: crypto.randomUUID() }));

  const db = getDB();
  db.prepare('INSERT INTO jobs (id, status, total) VALUES (?, ?, ?)')
    .run(jobId, 'pending', items.length);

  // Insert placeholder product rows so the dashboard can show them immediately
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO products (id, reference, raw_price, product_title, brand, extracted_specs, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `);
  const insertMany = db.transaction((rows) => {
    for (const r of rows) {
      insertStmt.run(r.id, r.reference, r.raw_price ?? null, r.title ?? null, r.brand ?? null, JSON.stringify(r.specs || {}));
    }
  });
  insertMany(itemsWithId);

  // Fire pipeline async — don't await
  startPipeline(itemsWithId, jobId).catch(console.error);

  res.json({ jobId, count: items.length });
});

// POST /api/enrich/bulk/retry
router.post('/bulk/retry', async (req, res) => {
  const { ids, reason } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids[] est requis.' });

  const db = getDB();
  const ph = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, reference, raw_price, product_title as title, brand, extracted_specs as specs FROM products WHERE id IN (${ph})`).all(...ids);
  
  if (reason) {
    rows.forEach(r => r.custom_instruction = reason);
  }
  
  if (!rows.length) return res.status(404).json({ error: 'Aucun produit trouvé.' });

  const jobId = crypto.randomUUID();
  db.prepare('INSERT INTO jobs (id, status, total) VALUES (?, ?, ?)')
    .run(jobId, 'pending', rows.length);

  // Set status back to pending
  db.prepare(`UPDATE products SET status='pending' WHERE id IN (${ph})`).run(...ids);

  // Fire pipeline async
  startPipeline(rows, jobId).catch(console.error);

  res.json({ jobId, count: rows.length });
});

// DELETE /api/enrich/cancel/:jobId
router.delete('/cancel/:jobId', (req, res) => {
  cancelJob(req.params.jobId);
  res.json({ success: true });
});

// GET /api/enrich/stream/:jobId — SSE stream
router.get('/stream/:jobId', (req, res) => {
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx passthrough
  res.flushHeaders();

  const { jobId } = req.params;
  addSSEClient(jobId, res);

  // Heartbeat keeps the connection alive through proxies
  const hb = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch (_) { clearInterval(hb); }
  }, 25000);

  req.on('close', () => {
    clearInterval(hb);
    removeSSEClient(jobId, res);
  });
});

// GET /api/enrich/status/:jobId
router.get('/status/:jobId', (req, res) => {
  const db  = getDB();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job introuvable' });
  res.json(job);
});

// GET /api/enrich/active
router.get('/active', (req, res) => {
  const db = getDB();
  const job = db.prepare('SELECT id FROM jobs WHERE status IN (?, ?) ORDER BY rowid DESC LIMIT 1').get('pending', 'running');
  if (!job) return res.json({ active: false });
  res.json({ active: true, jobId: job.id });
});

module.exports = router;
