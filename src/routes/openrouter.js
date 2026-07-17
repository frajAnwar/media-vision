const express = require('express');
const router = express.Router();

// GET /api/openrouter/models
router.get('/models', async (req, res) => {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    if (!response.ok) {
      throw new Error(`OpenRouter API responded with status ${response.status}`);
    }

    const json = await response.json();
    if (!json || !json.data) {
      throw new Error('Invalid response from OpenRouter API');
    }

    // Process and sort models
    const models = json.data.map(m => {
      const isFree = m.pricing && m.pricing.prompt === '0' && m.pricing.completion === '0';
      const arch = m.architecture || {};
      const isVision = 
        (arch.input_modalities && arch.input_modalities.includes('image')) ||
        (arch.modality && arch.modality.includes('image'));

      return {
        id: m.id,
        name: m.name,
        context_length: m.context_length,
        isFree: isFree,
        isVision: !!isVision
      };
    });

    // Sort: free models first, then alphabetically
    models.sort((a, b) => {
      if (a.isFree && !b.isFree) return -1;
      if (!a.isFree && b.isFree) return 1;
      return a.id.localeCompare(b.id);
    });

    res.json(models);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
