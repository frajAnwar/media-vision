const express  = require('express');
const router   = express.Router();
const { getDB } = require('../db');

// GET /api/products
router.get('/', (req, res) => {
  const db = getDB();
  const { status, search } = req.query;

  let sql    = 'SELECT * FROM products';
  const args = [];
  const cond = [];

  if (status && status !== 'all') {
    cond.push('status = ?');
    args.push(status);
  }
  if (search) {
    cond.push('(UPPER(reference) LIKE ? OR UPPER(COALESCE(product_title,\'\')) LIKE ?)');
    args.push(`%${search.toUpperCase()}%`, `%${search.toUpperCase()}%`);
  }

  if (cond.length) sql += ' WHERE ' + cond.join(' AND ');
  sql += ' ORDER BY created_at DESC';

  const rows = db.prepare(sql).all(...args);
  res.json(rows.map(_hydrate));
});

// GET /api/products/stats
router.get('/stats', (req, res) => {
  const db    = getDB();
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'enriched'  THEN 1 ELSE 0 END) AS enriched,
      SUM(CASE WHEN status = 'approved'  THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN status = 'rejected'  THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN status = 'error'     THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) AS pending
    FROM products
  `).get();
  res.json(stats);
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  const db = getDB();
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(_hydrate(row));
});

// PUT /api/products/:id
router.put('/:id', (req, res) => {
  const db = getDB();
  const ALLOWED = [
    'product_title', 'brand', 'html_description', 'seo_excerpt',
    'suggested_category', 'resolved_category_id', 'resolved_tax_rule_id',
    'selected_image', 'raw_price', 'status',
    'meta_title', 'meta_keywords', 'meta_description', 'high_res_images'
  ];

  const fields = Object.keys(req.body).filter(k => ALLOWED.includes(k));
  if (!fields.length) return res.status(400).json({ error: 'Aucun champ valide.' });

  const set    = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => req.body[f]);

  db.prepare(`UPDATE products SET ${set}, updated_at = strftime('%s','now') WHERE id = ?`)
    .run(...values, req.params.id);

  res.json({ success: true });
});

// POST /api/products/:id/approve
router.post('/:id/approve', (req, res) => {
  getDB().prepare("UPDATE products SET status='approved', updated_at=strftime('%s','now') WHERE id=?")
    .run(req.params.id);
  res.json({ success: true });
});

// POST /api/products/:id/reject
router.post('/:id/reject', (req, res) => {
  getDB().prepare("UPDATE products SET status='rejected', updated_at=strftime('%s','now') WHERE id=?")
    .run(req.params.id);
  res.json({ success: true });
});

// DELETE /api/products/:id
router.delete('/:id', (req, res) => {
  getDB().prepare('DELETE FROM products WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// POST /api/products/bulk/approve
router.post('/bulk/approve', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids[] requis.' });
  const ph = ids.map(() => '?').join(',');
  getDB().prepare(`UPDATE products SET status='approved', updated_at=strftime('%s','now') WHERE id IN (${ph})`)
    .run(...ids);
  res.json({ success: true, count: ids.length });
});

// POST /api/products/bulk/delete
router.post('/bulk/delete', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids[] requis.' });
  const ph = ids.map(() => '?').join(',');
  getDB().prepare(`DELETE FROM products WHERE id IN (${ph})`).run(...ids);
  res.json({ success: true, count: ids.length });
});

function _hydrate(p) {
  return {
    ...p,
    extracted_specs: p.extracted_specs ? JSON.parse(p.extracted_specs) : {},
    high_res_images: p.high_res_images ? JSON.parse(p.high_res_images) : [],
  };
}

module.exports = router;
