const express = require('express');
const router  = express.Router();
const { getDB } = require('../db');

router.post('/:id/curate-images', async (req, res) => {
  const { id } = req.params;
  const db = getDB();
  
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!product) return res.status(404).json({ error: 'Produit introuvable.' });
    
    let images = [];
    try { images = JSON.parse(product.high_res_images); } catch(e) {}
    if (!images || images.length === 0) {
      return res.status(400).json({ error: 'Aucune image trouvée pour ce produit.' });
    }

    const rows = db.prepare('SELECT key, value FROM settings').all();
    const cfg  = Object.fromEntries(rows.map(r => [r.key, r.value]));
    
    const provider = cfg.llm_provider || 'openai';
    const apiKey = cfg[`${provider}_key`];
    
    if (!apiKey) return res.status(400).json({ error: 'Clé API IA manquante.' });

    // Try to curate using OpenRouter or OpenAI (they support image_url directly)
    let curatedUrls = [];

    const promptText = `
Tu es un expert en e-commerce. Voici les détails d'un produit:
Référence: ${product.reference}
Marque: ${product.brand || 'Inconnue'}
Titre: ${product.product_title || 'Inconnu'}

Je t'ai fourni plusieurs URLs d'images (ou les images elles-mêmes) trouvées sur le web.
Ta tâche:
1. Examine ces images.
2. Élimine les images qui ne sont pas le bon produit, qui sont des logos, des bannières, ou de mauvaise qualité.
3. Choisis les 3 à 5 meilleures images montrant le produit sous différents angles.
4. Renvoie-moi UNIQUEMENT un tableau JSON strict contenant les URLs exactes des images choisies. Aucune explication.

Exemple de sortie:
[
  "url1",
  "url2",
  "url3"
]
`;

    let rawContent = '';

    if (provider === 'gemini') {
      let model = (cfg.vision_model || 'gemini-2.5-flash').replace(/^models\//, '');
      if (model === 'gemini-1.5-flash') model = 'gemini-2.5-flash';
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      
      const parts = [{ text: promptText }];
      for (const url of images.slice(0, 10)) {
        try {
          const imgRes = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (!imgRes.ok) continue;
          const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
          const buffer = await imgRes.arrayBuffer();
          const base64 = Buffer.from(buffer).toString('base64');
          parts.push({ inlineData: { mimeType, data: base64 } });
        } catch (e) {}
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0.1 }
        }),
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Erreur API Gemini Vision: ${response.status} - ${err.slice(0,200)}`);
      }
      const data = await response.json();
      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        throw new Error(`Gemini API invalide/bloqué: ${JSON.stringify(data)}`);
      }
      rawContent = data.candidates[0].content.parts[0].text.trim();

    } else {
      // OpenAI or OpenRouter format
      const messages = [{
        role: 'user',
        content: [
          { type: 'text', text: promptText },
          ...images.slice(0, 10).map(url => ({ type: 'image_url', image_url: { url } }))
        ]
      }];

      let apiUrl = '';
      let model = cfg.vision_model || 'gpt-4o-mini';
      let headers = {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      };

      if (provider === 'openai') {
        apiUrl = 'https://api.openai.com/v1/chat/completions';
      } else if (provider === 'openrouter') {
        apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
        model = cfg.vision_model || 'google/gemini-2.0-flash-exp:free';
        headers['HTTP-Referer'] = 'http://localhost:3000';
        headers['X-Title'] = 'MediaVision';
      } else {
        throw new Error("Fournisseur non supporté pour la vision.");
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages,
          max_tokens: 1000,
          temperature: 0.1
        }),
        signal: AbortSignal.timeout(60000)
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Erreur API Vision: ${response.status} - ${err.slice(0,200)}`);
      }
      const data = await response.json();
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error(`Réponse IA invalide: ${JSON.stringify(data)}`);
      }
      rawContent = data.choices[0].message.content.trim();
    }
    
    // Parse the output
    let parsed = [];
    try {
      // Strip markdown code fences
      const cleaned = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const json = JSON.parse(cleaned);
      if (Array.isArray(json)) {
        parsed = json;
      } else if (json.images && Array.isArray(json.images)) {
        parsed = json.images;
      } else if (json.urls && Array.isArray(json.urls)) {
        parsed = json.urls;
      } else {
         // fallback extract string values looking like http
         parsed = Object.values(json).filter(v => typeof v === 'string' && v.startsWith('http'));
      }
    } catch(e) {
      throw new Error("L'IA n'a pas retourné un JSON valide.");
    }

    if (!parsed.length) {
      throw new Error("L'IA n'a sélectionné aucune image valide.");
    }

    // Filter parsed URLs to only include ones that were in the original array (to prevent hallucinations)
    const finalUrls = parsed.filter(u => images.includes(u));

    if (!finalUrls.length) {
      throw new Error("Les images sélectionnées par l'IA ne correspondent pas aux originales.");
    }

    // Save to DB
    db.prepare("UPDATE products SET selected_image = ?, updated_at = strftime('%s','now') WHERE id = ?")
      .run(JSON.stringify(finalUrls), id);

    res.json({ success: true, selected_images: finalUrls });

  } catch (err) {
    console.error('[curate-images]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
