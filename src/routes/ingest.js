const express = require('express');
const router  = express.Router();
const { analyzeRawInput } = require('../agent');
const { getDB } = require('../db');

// POST /api/ingest
// Accepts raw supplier text, returns parsed items array via LLM
router.post('/', async (req, res) => {
  const { rawText } = req.body;

  if (!rawText || typeof rawText !== 'string' || rawText.trim().length < 3) {
    return res.status(400).json({ error: 'rawText is required.' });
  }

  try {
    const db = getDB();
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
    
    const provider = settings.llm_provider || 'openai';
    const apiKey   = settings[`${provider}_key`];
    const model    = settings.llm_model;

    if (!apiKey) {
      return res.status(400).json({ error: `API key for ${provider} is missing. Please configure it in settings.` });
    }

    let items = await analyzeRawInput(rawText, provider, apiKey, model);
    if (items && !Array.isArray(items)) {
      items = items.products || items.items || items.data || [];
    }
    
    if (!Array.isArray(items)) items = [];

    // Assign a temporary unique ID for the frontend just in case it's needed
    const { randomUUID } = require('crypto');
    const enrichedItems = items.map(i => ({
      ...i,
      id: randomUUID()
    }));

    res.json({ items: enrichedItems, count: enrichedItems.length });
  } catch (err) {
    console.error('[ingest] AI extraction error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
