const express  = require('express');
const router   = express.Router();
const { getDB } = require('../db');

// GET /api/settings
router.get('/', (req, res) => {
  const db   = getDB();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const cfg  = Object.fromEntries(rows.map(r => [r.key, r.value]));

  // Mask secrets for display — send back masked version
  const out = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (k.endsWith('_key') && v && v.length > 8) {
      out[k] = v.slice(0, 4) + '••••••••' + v.slice(-4);
    } else {
      out[k] = v;
    }
  }

  res.json(out);
});

// PUT /api/settings
router.put('/', (req, res) => {
  const db      = getDB();
  const upsert  = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const ALLOWED = [
    'llm_provider', 'llm_model', 'vision_model',
    'openai_key', 'gemini_key', 'openrouter_key',
    'search_provider',
    'serpapi_key', 'serper_key', 'tavily_key',
    'jina_key',
    'ps_url', 'ps_api_key',
    'helper_websites'
  ];

  const save = db.transaction((body) => {
    for (const [k, v] of Object.entries(body)) {
      if (!ALLOWED.includes(k)) continue;
      if (typeof v !== 'string') continue;
      // Skip if user sent back our masked placeholder
      if (v.includes('••••')) continue;
      upsert.run(k, v.trim());
    }
  });

  save(req.body);
  res.json({ success: true });
});

module.exports = router;
