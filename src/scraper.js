/**
 * Phase 2a — Web Search
 * Queries SerpApi, Serper.dev, or Tavily for product reference URLs.
 * Provider is selected from DB settings.
 */

const { getDB } = require('./db');

async function searchProduct({ reference, title, brand, customInstruction }) {
  const db  = getDB();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const cfg  = Object.fromEntries(rows.map(r => [r.key, r.value]));

  const provider = cfg.search_provider || 'serper';
  const apiKey   = cfg[`${provider}_key`];
  
  if (!apiKey) {
    console.warn(`[scraper] No API key for ${provider}`);
    return [];
  }

  // Build the most precise query possible
  let queryTerms = [brand, title, reference].filter(Boolean);
  
  // If user provided a custom instruction on retry (e.g. "Maxhub"), prepend it to force the search engine
  let baseQuery = '';
  if (customInstruction) {
    baseQuery = `${customInstruction} ${reference}`.trim();
  } else {
    // If title is present, we might not need reference, but let's keep it safe
    baseQuery = `${brand || ''} ${title || reference}`.trim();
  }

  let queries = [];
  let domains = [];
  if (cfg.helper_websites) {
    domains = cfg.helper_websites.split(',').map(s => s.trim()).filter(Boolean);
    if (domains.length > 0) {
      const siteFilter = domains.map(h => `site:${h}`).join(' OR ');
      queries.unshift(`${baseQuery} (${siteFilter})`); // Helper query first with FULL details
    }
  }
  
  queries.push(`${baseQuery} specifications OR fiche technique`); // Global fallback with explicit spec requirement

  const resultsArray = await Promise.all(queries.map(async (q) => {
    try {
      if (provider === 'serpapi') return await _serpapi(q, apiKey);
      if (provider === 'serper') return await _serper(q, apiKey);
      if (provider === 'tavily') return await _tavily(q, apiKey);
      throw new Error(`Fournisseur inconnu : ${provider}`);
    } catch (e) {
      console.warn(`[scraper] search failed for query "${q}":`, e.message);
      return [];
    }
  }));

  let allResults = [];
  for (const res of resultsArray) allResults.push(...(res || []));

  // Deduplicate by URL
  const seen = new Set();
  return allResults.filter(r => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  }).slice(0, 5); // Keep top 5
}

async function searchImages({ reference, title, brand }) {
  const db   = getDB();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const cfg  = Object.fromEntries(rows.map(r => [r.key, r.value]));

  const provider = cfg.search_provider || 'serper';
  const apiKey   = cfg[`${provider}_key`];
  if (!apiKey) {
    throw new Error(`Clé API manquante pour le moteur de recherche (${provider}). Veuillez la configurer dans les paramètres.`);
  }

  // For images, the commercial title is much better than obscure reference codes
  let baseQuery = '';
  if (title && title.length > 5) {
    // Use the title directly (the LLM already includes the brand in a clean way)
    baseQuery = title.slice(0, 100);
  } else {
    baseQuery = `${brand || ''} ${reference}`.trim();
  }
  
  let queries = [baseQuery];

  let domains = [];
  if (cfg.helper_websites) {
    domains = cfg.helper_websites.split(',').map(s => s.trim()).filter(Boolean);
    if (domains.length > 0) {
      const siteFilter = domains.map(h => `site:${h}`).join(' OR ');
      queries.unshift(`${baseQuery} (${siteFilter})`);
    }
  }

  const resultsArray = await Promise.all(queries.map(async (q) => {
    try {
      if (provider === 'serpapi') return await _serpapiImages(q, apiKey);
      if (provider === 'serper') return await _serperImages(q, apiKey);
      if (provider === 'tavily') return await _tavilyImages(baseQuery, apiKey, domains);
      return [];
    } catch (e) {
      console.warn(`[scraper] image search failed for query "${q}":`, e.message);
      return [];
    }
  }));

  let allImages = [];
  if (provider === 'tavily') {
    allImages = (resultsArray[0] || []).map(url => ({ url, title: '' }));
  } else {
    for (const res of resultsArray) allImages.push(...(res || []));
  }

  // ── STRICT FILTERING ──
  // Filter images to ensure they actually match the specific product, not just the brand.
  const safeRef = (reference || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  
  // Extract significant words from the commercial title (excluding generic words and the brand itself)
  const titleWords = (title || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3 && w !== (brand || '').toLowerCase());

  let filteredImages = allImages.filter(img => {
    if (!img.title) return true; // Pass through if no title is provided by API
    
    const t = img.title.toLowerCase();
    const cleanT = t.replace(/[^a-z0-9]/g, '');
    
    // 1. Strongest match: Reference exists in the image title
    if (safeRef && safeRef.length >= 3 && cleanT.includes(safeRef)) return true;
    
    // 2. Strong match: At least one highly specific word from the commercial title (like model family, e.g., "ideapad", "ecotank") exists in the image title
    for (const word of titleWords) {
      if (t.includes(word)) return true;
    }
    
    // Just matching the brand is NOT enough, as it pulls in wrong models.
    return false;
  });

  // Fallback: If strict filtering removed absolutely everything, fallback to ONLY the top 1 result
  // (because lower ranked results are guaranteed to be generic visually-similar junk).
  if (filteredImages.length === 0 && allImages.length > 0) {
    filteredImages = allImages.slice(0, 1);
  }

  // Deduplicate by URL
  let uniqueImages = [...new Set(filteredImages.map(img => img.url))].slice(0, 15);

  // Validate images to remove corrupted or 404 links
  const validationResults = await Promise.all(
    uniqueImages.map(url => _validateImageUrl(url))
  );

  return uniqueImages.filter((_, idx) => validationResults[idx]);
}

// ── Image Validation ────────────────────────────────────────────────────────
async function _validateImageUrl(url) {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(3000)
    });
    // Some servers reject HEAD with 405 Method Not Allowed or 403 Forbidden, but the URL is valid
    if (!res.ok && res.status !== 405 && res.status !== 403 && res.status !== 401) return false;
    
    const contentType = res.headers.get('content-type');
    // If there is a content type, ensure it's an image
    if (contentType && !contentType.startsWith('image/')) {
      // Some CDNs might return octet-stream, but let's be strict to avoid corrupted files
      // Webp, jpeg, png, gif are all image/*
      if (!contentType.includes('octet-stream')) {
        return false;
      }
    }
    return true;
  } catch (e) {
    // Timeout or network error means the image is dead
    return false;
  }
}

// ── SerpApi ───────────────────────────────────────────────────────────────────
async function _serpapi(query, apiKey) {
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&num=5&api_key=${apiKey}`;
  const res  = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const data = await res.json();
  if (!data.organic_results) return [];
  return data.organic_results.slice(0, 4).map(r => ({
    url:     r.link,
    title:   r.title,
    snippet: r.snippet || '',
  }));
}

async function _serpapiImages(query, apiKey) {
  const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&tbm=isch&num=10&api_key=${apiKey}`;
  const res  = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const data = await res.json();
  if (!data.images_results) return [];
  return data.images_results.slice(0, 15).map(r => ({ url: r.original, title: r.title || '' })).filter(img => img.url);
}

// ── Serper.dev ────────────────────────────────────────────────────────────────
async function _serper(query, apiKey) {
  const res = await fetch('https://google.serper.dev/search', {
    method:  'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ q: query, num: 5, gl: 'tn', hl: 'fr' }),
    signal:  AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Serper API Error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!data.organic) return [];
  return data.organic.slice(0, 4).map(r => ({
    url:     r.link,
    title:   r.title,
    snippet: r.snippet || '',
  }));
}

async function _serperImages(query, apiKey) {
  const res = await fetch('https://google.serper.dev/images', {
    method:  'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ q: query, num: 10 }), // removed gl/hl to get more global image results
    signal:  AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Serper API Error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!data.images) return [];
  return data.images.slice(0, 15).map(r => ({ url: r.imageUrl, title: r.title || '' })).filter(img => img.url);
}

// ── Tavily ────────────────────────────────────────────────────────────────────
async function _tavily(query, apiKey) {
  const body = {
    api_key:             apiKey,
    query:               `${query} product specifications fiche technique`,
    search_depth:        'advanced',
    max_results:         4,
    include_raw_content: true,
  };

  const res = await fetch('https://api.tavily.com/search', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Tavily API Error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!data.results) return [];
  return data.results.map(r => ({
    url:     r.url,
    title:   r.title,
    snippet: r.content   || '',
    content: r.raw_content || '',
  }));
}

async function _tavilyImages(query, apiKey, domains = []) {
  const body = {
    api_key:             apiKey,
    query:               `${query} product high resolution`,
    include_images:      true,
    max_results:         5
  };
  if (domains && domains.length > 0) body.include_domains = domains;

  const res = await fetch('https://api.tavily.com/search', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Tavily API Error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (!data.images) return [];
  return data.images.slice(0, 15).filter(Boolean);
}

module.exports = { searchProduct, searchImages };
