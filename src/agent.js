/**
 * Phase 2c — LLM Enrichment Agent
 * Sends scraped content + reference to OpenAI or Gemini.
 * Returns structured product JSON matching MediaVision's PrestaShop format.
 */

const { getDB } = require('./db');

// ── Master prompt (matches blueprint spec, adapted for French/TND) ──────────
const PROMPT_TEMPLATE = `Tu es un technicien expert en catalogage e-commerce spécialisé dans les secteurs informatique, bureautique et sécurité. Tu travailles pour MediaVision Tunisie (mediavision.tn).

Tu recevras :
- Des pages web scrappées pour ce produit : {SCRAPED_CONTENT}
- Code de référence cible : {REFERENCE_CODE}
- Données initiales du fournisseur (Specs originelles) : {INITIAL_DATA}
- Tables de référence PrestaShop du client (catégories, taxes, etc.) : {REFERENCE_TABLES}

Ta sortie doit être un UNIQUE objet JSON strict. N'utilise PAS de blocs markdown. N'ajoute AUCUN texte introductif ou conclusif.

SCHÉMA JSON OBLIGATOIRE :
{
  "product_title": "Titre consommateur standard EN FRANÇAIS. Format : Marque + Modèle + Spec clé (ex: 'Imprimante EcoTank Epson L3250 Wifi')",
  "brand": "Nom de la marque EN MAJUSCULES (ex: 'EPSON', 'MSI', 'HIKVISION')",
  "html_description": "Génère une description HTML structurée. 1) Un paragraphe d'introduction clair. 2) Une liste à puces des points forts principaux. 3) OBLIGATOIREMENT un titre de section au format <h2 style='text-align:left;'><span style='color:#f5a623;'><strong>SPECIFICATIONS</strong></span></h2>. 4) Un tableau HTML OBLIGATOIREMENT formaté avec <table class='table table-striped'> (et <tbody>, <tr>, <td>) pour lister la fiche technique complète. NE PAS inventer de CSS inline complexe pour le tableau, utilise uniquement la classe table table-striped pour qu'il s'intègre parfaitement au thème PrestaShop.",
  "seo_excerpt": "Ceci correspond au 'Récapitulatif' du produit. Tu DOIS générer une liste à puces HTML (<ul><li>...</li></ul>) contenant les 4/5 spécifications majeures. RÈGLE CRITIQUE ABSOLUE : La longueur totale de ce texte HTML NE DOIT JAMAIS DEPASSER 350 CARACTÈRES. L'IA a tendance à faire trop long, sois extrêmement court et concis. Utilise du CSS inline pour colorer le texte. Exemple : <ul><li style='margin-bottom:4px;'>CPU: <strong style='color:#ea580c'>i5</strong></li></ul>. Uniquement du HTML.",
    "meta_title": "Titre SEO très court (max 60 caractères). RÈGLES : Uniquement lettres, chiffres et tirets. INTERDIT : emojis, guillemets, symboles (< > = { } ; \" ').",
      "meta_keywords": "5 mots-clés simples séparés par des virgules. INTERDIT : emojis, guillemets, symboles spéciaux.",
        "meta_description": "TRÈS IMPORTANT : Doit être une phrase courte (maximum 150 caractères). RÈGLES : Uniquement lettres, chiffres, virgules et points. INTERDIT : sauts de ligne, emojis, guillemets, symboles HTML ou spéciaux (< > = { } ; \" ').",
          "suggested_categories": ["Catégorie Principale Générale (ex: Pc Portable, Smartphone, Imprimante)", "Sous-catégorie spécifique (ex: Pc Portable Gamer)"],
            "resolved_category_ids": ["ID numérique 1", "ID numérique 2 (optionnel)"],
              "resolved_tax_rule_id": "L'ID numérique de la règle fiscale pour la TVA tunisienne standard (19%). Retourne null si inconnu.",
                "matched_features": [
                  {
                    "name": "Nom de la caractéristique EXACTEMENT tel qu'il apparait dans la table de référence 'features' (ex: Résolution, RAM)",
                    "value": "La valeur correspondante extraite (ex: 4K UHD)",
                    "is_custom": 1
                  }
                ],
                  "extracted_specs": {
    "RAM": "16 Go",
    "Résolution": "4K UHD",
    "Connectivité": "Filaire"
},
"mismatch_warning": "Si le contenu scrappé contredit clairement les 'Données initiales du fournisseur' (par ex. le fournisseur indique 16Go RAM mais la page web indique 8Go), décris la différence ici. Sinon, mets null.",
  "data_confidence_score": "Float entre 0 et 1 (ex: 0.85) estimant la certitude des specs extraites depuis le texte web. Ne mets PAS 0.95 par défaut. Évalue réellement.",
    "confidence_reason": "Si le data_confidence_score est inférieur à 0.8, explique brievement pourquoi tu as un doute (ex: 'Impossible de trouver le processeur exact sur les sites web'). Sinon, mets null."
}

RÈGLES CRITIQUES:
1. VÉRACITÉ: Si le contenu scrappé ne contient pas les specs de la référence cible, retourne null pour ces champs.NE JAMAIS inventer des specs.
2. HTML PROPRE ET BEAU: Toutes les balises doivent être équilibrées.Tu dois impérativement utiliser un joli tableau HTML pour les spécifications détaillées, en plus d'une présentation riche. Sois créatif pour simuler une fiche technique professionnelle et moderne.
3. LANGUE FRANÇAISE: Tout le texte de sortie(titre, description, extrait) DOIT être en français.
4. CORRESPONDANCE CATÉGORIE: Cherche en priorité la grande famille / catégorie principale du produit(ex: "Pc Portable", "Imprimante", "Smartphone") dans les tables de référence.Si tu trouves une sous - catégorie pertinente, ajoute - la en deuxième position.Choisis impérativement les noms EXACTS trouvés dans { REFERENCE_TABLES }.
5. CORRESPONDANCE CARACTÉRISTIQUES: Pour 'matched_features', tu dois impérativement utiliser les noms exacts de la table de référence 'features'.Tu peux extraire jusqu'à 15 caractéristiques si le texte le permet. Le champ 'is_custom' doit toujours être 1.
6. VÉRITÉ ABSOLUE DES DONNÉES INITIALES: Les 'Données initiales du fournisseur'(INITIAL_DATA) sont LA VÉRITÉ ABSOLUE.Si le contenu scrappé décrit un produit d'une autre marque ou d'un type totalement différent (ex: un chargeur DELL au lieu d'un écran MAXHUB), TU DOIS IGNORER TOTALEMENT LE CONTENU SCRAPPÉ. Ne modifie jamais la marque fournie initialement.
7. TOLÉRANCE AUX DONNÉES MINIMALES: Si le contenu scrappé est vide ou ignoré, MAIS que les INITIAL_DATA fournissent une marque et un modèle clairs (ex: 'MAXHUB S7520 A'), c'est SUFFISANT. Génère le JSON uniquement à partir des INITIAL_DATA, mets \`mismatch_warning\` à null, \`confidence_reason\` à null, et un \`data_confidence_score\` > 0.85. Ne pénalise pas la fiabilité si les données initiales sont claires.
8. VALIDATION SEO STRICTE: PrestaShop rejettera l'importation si meta_title, meta_keywords ou meta_description dépassent la taille maximale ou contiennent le moindre emoji ou symbole spécial (< > = { } ; " '). Utilise uniquement du texte basique(lettres et chiffres) pour ces trois champs.
9. GARANTIE(WARRANTY) : NE JAMAIS extraire ou inclure d'informations de garantie (ex: "1 an de garantie", "Warranty 3 years") à partir du contenu scrappé. La seule information de garantie autorisée est celle figurant explicitement dans les INITIAL_DATA. Si INITIAL_DATA n'en contient pas, ne mentionne AUCUNE garantie.`;

async function enrichProduct(reference, scrapedContent, referenceTables) {
  const db   = getDB();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const cfg  = Object.fromEntries(rows.map(r => [r.key, r.value]));

  const provider = cfg.llm_provider || 'openai';
  let defaultModel = 'gpt-4o-mini';
  if (provider === 'gemini') defaultModel = 'gemini-2.5-flash';
  if (provider === 'openrouter') defaultModel = 'google/gemini-2.0-flash-exp:free';
  
  let model = cfg.llm_model || defaultModel;
  // Automatically migrate deprecated Google models from user settings
  if (model === 'gemini-1.5-flash') model = 'gemini-2.5-flash';
  const apiKey   = cfg[`${provider}_key`];

  if (!apiKey) {
    throw new Error(`Aucune clé API configurée pour le LLM : ${provider}`);
  }

  const refTablesStr = referenceTables && Object.keys(referenceTables).length > 0
    ? JSON.stringify(referenceTables, null, 2).slice(0, 4000)
    : 'Aucune table de référence importée.';

  const initialDataStr = referenceTables?.initial_data 
    ? JSON.stringify(referenceTables.initial_data, null, 2)
    : 'Aucune donnée initiale.';

    let prompt = PROMPT_TEMPLATE
    .replace('{SCRAPED_CONTENT}',  (scrapedContent || 'Aucun contenu disponible.').slice(0, 12000))
    .replace('{REFERENCE_CODE}',   reference)
    .replace('{INITIAL_DATA}',     initialDataStr)
    .replace('{REFERENCE_TABLES}', refTablesStr);

  if (referenceTables?.initial_data?.custom_instruction) {
    prompt += `\n\nINSTRUCTION MANUELLE DE L'UTILISATEUR (PRIORITÉ MAXIMALE) :\n${referenceTables.initial_data.custom_instruction}\nVeille à appliquer cette instruction pour corriger ou orienter ta réponse.`;
  }

let rawText;

for (let attempt = 0; attempt <= 2; attempt++) {
  try {
    if (provider === 'openai') {
      rawText = await _callOpenAI(prompt, model, apiKey);
    } else if (provider === 'gemini') {
      rawText = await _callGemini(prompt, model, apiKey);
    } else if (provider === 'openrouter') {
      rawText = await _callOpenRouter(prompt, model, apiKey);
    } else {
      throw new Error(`Fournisseur LLM inconnu : ${provider}`);
    }

    const parsed = _parseJSON(rawText || '');

    const fs = require('fs');
    fs.writeFileSync('last_llm_output.txt', rawText || ''); // debug

    if (parsed && typeof parsed === 'object') {
      let conf = parseFloat(parsed.data_confidence_score);
      if (isNaN(conf)) conf = 0.5;
      parsed.data_confidence_score = conf;
    }

    return parsed;
  } catch (e) {
    if (attempt < 2 && (e.name === 'TimeoutError' || e.message.includes('Unable to parse'))) {
      console.warn(`[agent] LLM attempt ${attempt + 1} failed (${e.message}). Retrying...`);
      if (e.message.includes('Unable to parse')) {
        prompt += `\n\nATTENTION : Lors de la tentative précédente, tu as généré une erreur : JSON invalide. Tu DOIS renvoyer UNIQUEMENT un objet JSON valide, sans aucun texte introductif ou conclusif.`;
      }
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }
    throw e;
  }
}
}

// ── OpenAI ────────────────────────────────────────────────────────────────────
async function _callOpenAI(prompt, model, apiKey, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.15,
        max_tokens: 8000,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(180000),
    });

    if (!res.ok) {
      const err = await res.text();
      if ((res.status === 503 || res.status === 429) && i < retries) {
        await new Promise(r => setTimeout(r, 2000 * Math.pow(2, i))); // 2s, 4s, 8s
        continue;
      }
      if (res.status === 429) throw new Error(`Quota OpenAI épuisé ou surcharge (Rate Limit). Veuillez patienter.`);
      if (res.status === 503) throw new Error(`Serveur OpenAI saturé. Réessayez plus tard.`);
      if (res.status === 401) throw new Error(`Clé API OpenAI invalide.`);
      throw new Error(`Erreur API OpenAI (${res.status}): ${err.slice(0, 300)}`);
    }

    const data = await res.json();
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error(`OpenAI API returned invalid response: ${JSON.stringify(data)}`);
    }
    return data.choices[0].message.content;
  }
}

// ── OpenRouter ────────────────────────────────────────────────────────────────
async function _callOpenRouter(prompt, model, apiKey, retries = 3) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'MediaVision Pipeline'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.15,
        max_tokens: 8000
      }),
      signal: AbortSignal.timeout(180000),
    });

    if (!res.ok) {
      const err = await res.text();
      if ((res.status === 503 || res.status === 429) && i < retries) {
        await new Promise(r => setTimeout(r, 2000 * Math.pow(2, i)));
        continue;
      }
      if (res.status === 429) throw new Error(`Quota OpenRouter épuisé ou surcharge (Rate Limit). Veuillez patienter.`);
      if (res.status === 503) throw new Error(`Serveur OpenRouter saturé. Réessayez plus tard.`);
      if (res.status === 401) throw new Error(`Clé API OpenRouter invalide.`);
      if (res.status === 402) throw new Error(`Crédit OpenRouter insuffisant. Veuillez recharger votre compte.`);
      throw new Error(`Erreur API OpenRouter (${res.status}): ${err.slice(0, 300)}`);
    }

    const data = await res.json();
    if (data.error) {
      throw new Error(`OpenRouter returned error in body: ${JSON.stringify(data.error)}`);
    }
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error(`OpenRouter API returned invalid response: ${JSON.stringify(data)}`);
    }
    return data.choices[0].message.content;
  }
}

// ── Google Gemini ─────────────────────────────────────────────────────────────
async function _callGemini(prompt, model, apiKey, retries = 4) {
  let cleanModel = model.replace(/^models\//, '');
  if (cleanModel === 'gemini-1.5-flash') cleanModel = 'gemini-2.5-flash';

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;

  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: 8000,
          responseMimeType: 'application/json',
        },
      }),
      signal: AbortSignal.timeout(180000),
    });

    if (!res.ok) {
      const err = await res.text();
      if ((res.status === 503 || res.status === 429) && i < retries) {
        await new Promise(r => setTimeout(r, 2000 * Math.pow(2, i))); // 2s, 4s, 8s, 16s
        continue;
      }
      if (res.status === 429) throw new Error(`Quota Gemini épuisé ou surcharge (Rate Limit). Attendez un moment.`);
      if (res.status === 503) throw new Error(`Serveur Gemini indisponible pour le moment. Réessayez.`);
      if (res.status === 401) throw new Error(`Clé API Gemini invalide.`);
      throw new Error(`Erreur API Gemini (${res.status}): ${err.slice(0, 300)}`);
    }

    const data = await res.json();
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
      throw new Error(`Gemini API returned invalid response or blocked by safety: ${JSON.stringify(data)}`);
    }
    return data.candidates[0].content.parts[0].text;
  }
}

// ── JSON parser with cleanup ──────────────────────────────────────────────────
function _parseJSON(text) {
  let cleaned = text.trim();

  // Strip possible markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  try {
    return JSON.parse(cleaned);
  } catch (_) {
    try {
      // Find the first { or [ and the last } or ]
      const firstBrace = cleaned.indexOf('{');
      const firstBracket = cleaned.indexOf('[');
      const firstChar = (firstBrace !== -1 && firstBracket !== -1) ? Math.min(firstBrace, firstBracket) : Math.max(firstBrace, firstBracket);

      const lastBrace = cleaned.lastIndexOf('}');
      const lastBracket = cleaned.lastIndexOf(']');
      const lastChar = Math.max(lastBrace, lastBracket);

      if (firstChar !== -1 && lastChar !== -1 && lastChar > firstChar) {
        const extracted = cleaned.substring(firstChar, lastChar + 1);
        return JSON.parse(extracted);
      }
    } catch (e) { }

    throw new Error('Unable to parse LLM response to JSON: ' + cleaned.slice(0, 200));
  }
}

// ── Raw Input Analyzer (Phase 1) ──────────────────────────────────────────────
async function analyzeRawInput(rawText, provider, apiKey, model) {
  let prompt = `You are a data extraction assistant. I will provide you with a raw block of text pasted from a supplier's catalog or price list.
Extract all distinct products found in the text.
Your output MUST be a strict JSON object containing an "items" array.
Do NOT use markdown blocks, do not say anything else. Just the JSON object.

Format:
{
  "items": [
    {
      "reference": "The exact model/SKU/reference (MANDATORY)",
      "raw_price": 1234.5,
      "title": "Full name or title of the product",
      "brand": "Brand name if obvious",
      "specs": {
        "RAM": "16 Go",
        "Couleur": "Noir",
        "Connectivité": "Sans fil"
      }
    }
  ]
}

CRITÈRES STRICTS:
1. Pour l'objet "specs", extrait l'essentiel de manière CONCISE (sois rapide). RÈGLE CRITIQUE : La clé du JSON doit être le vrai nom de la spécification (ex: "RAM", "Résolution"). NE JAMAIS utiliser de noms génériques.
2. Formatte les valeurs de prix en nombres (sans devise).
3. Traduis les clés en français.
4. ATTENTION AUX PRIX: Le texte peut contenir des prix (ex: "300dt", "150 tnd"). Extrais-les dans "raw_price" (ex: 300).
5. IMPORTANT : Reste extrêmement rapide et concis. Ne rajoute aucun bla-bla. Vérifie bien que tu as fermé toutes les accolades et crochets de ton JSON.

Raw Text:
${rawText.slice(0, 8000)}`;

  let rawLLMText;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      if (provider === 'openai') {
        rawLLMText = await _callOpenAI(prompt, model, apiKey);
      } else if (provider === 'gemini') {
        rawLLMText = await _callGemini(prompt, model, apiKey);
      } else if (provider === 'openrouter') {
        rawLLMText = await _callOpenRouter(prompt, model, apiKey);
      } else {
        throw new Error(`Unknown LLM provider: ${provider}`);
      }

      const parsed = _parseJSON(rawLLMText || '{"items":[]}');

      const fs = require('fs');
      fs.writeFileSync('last_llm_ingest_output.txt', rawLLMText || ''); // debug

      if (parsed && Array.isArray(parsed.items)) {
        return parsed.items.map(i => ({ ...i, raw_price: i.raw_price || 0 }));
      } else if (Array.isArray(parsed)) {
        return parsed.map(i => ({ ...i, raw_price: i.raw_price || 0 }));
      }
      return [];
    } catch (e) {
      if (attempt < 2 && (e.name === 'TimeoutError' || e.message.includes('Unable to parse'))) {
        console.warn(`[agent-ingest] LLM attempt ${attempt + 1} failed (${e.message}). Retrying...`);
        if (e.message.includes('Unable to parse')) {
          prompt += `\n\nATTENTION : Lors de la tentative précédente, tu as généré une erreur : JSON invalide. Tu DOIS renvoyer UNIQUEMENT un objet JSON valide, sans balises markdown ou texte additionnel.`;
        }
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw e;
    }
  }
}

module.exports = { enrichProduct, analyzeRawInput };
