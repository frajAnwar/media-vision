const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const { getDB } = require('../db');
const { testConnection, createProduct, getPSConfig } = require('../prestashop-api');
const { invalidateCache } = require('../catalog');

// POST /api/ps/test — test PS API connection
router.post('/test', async (req, res) => {
  const result = await testConnection();
  res.json(result);
});

// GET /api/ps/config — get current PS config (masked)
router.get('/config', (req, res) => {
  const { baseUrl, apiKey } = getPSConfig();
  res.json({
    ps_url:     baseUrl,
    ps_api_key: apiKey ? apiKey.slice(0, 4) + '••••••••' + apiKey.slice(-4) : '',
  });
});

// POST /api/ps/push/:id — push a single approved product to PS
router.post('/push/:id', async (req, res) => {
  const db      = getDB();
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);

  if (!product) return res.status(404).json({ error: 'Produit introuvable' });
  if (product.status !== 'approved') {
    return res.status(400).json({ error: 'Le produit doit être approuvé avant l\'envoi.' });
  }

  try {
    // Hydrate JSON fields
    const hydrated = {
      ...product,
      high_res_images: product.high_res_images ? JSON.parse(product.high_res_images) : [],
    };

    const result = await createProduct(hydrated);

    // Mark as published
    db.prepare(
      "UPDATE products SET status = 'published', updated_at = strftime('%s','now') WHERE id = ?"
    ).run(product.id);

    res.json({
      success: true,
      ps_product_id:  result.newProductId,
      category_id:    result.categoryId,
      manufacturer_id: result.manufacturerId,
      image_uploaded: result.imageUploaded,
    });

  } catch (err) {
    console.error('[ps/push] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ps/push-bulk — push all approved products
router.post('/push-bulk', async (req, res) => {
  const db       = getDB();
  const products = db.prepare(
    "SELECT * FROM products WHERE status = 'approved'"
  ).all();

  if (!products.length) {
    return res.status(400).json({ error: 'Aucun produit approuvé à envoyer.' });
  }

  // Stream results via SSE
  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (event, data) => {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {}
  };

  send('start', { total: products.length });

  let done = 0, errors = 0;

  for (const product of products) {
    try {
      const hydrated = {
        ...product,
        high_res_images: product.high_res_images ? JSON.parse(product.high_res_images) : [],
      };

      const result = await createProduct(hydrated);

      db.prepare(
        "UPDATE products SET status = 'published', updated_at = strftime('%s','now') WHERE id = ?"
      ).run(product.id);

      done++;
      send('item_ok', {
        id:            product.id,
        reference:     product.reference,
        ps_product_id: result.newProductId,
        image_uploaded: result.imageUploaded,
      });

    } catch (err) {
      errors++;
      send('item_error', { id: product.id, reference: product.reference, error: err.message });
    }

    // Small delay to avoid hammering the server
    await new Promise(r => setTimeout(r, 400));
  }

  send('complete', { done, errors });
  res.end();
});

module.exports = router;
