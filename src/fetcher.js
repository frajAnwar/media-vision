/**
 * Phase 2b — Page Content Fetcher
 * Downloads clean text from a URL.
 * Primary:  Jina AI Reader (r.jina.ai) — returns clean markdown, bypasses blocks
 * Fallback: Raw fetch + HTML strip
 */

const { getDB } = require('./db');

async function fetchPageContent(url) {
  const db   = getDB();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const cfg  = Object.fromEntries(rows.map(r => [r.key, r.value]));

  // ── Primary: Jina AI Reader ───────────────────────────────────────────────
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const headers = {
      'Accept':     'text/plain',
      'User-Agent': 'MediaVisionBot/1.0',
    };
    if (cfg.jina_key) {
      headers['Authorization'] = `Bearer ${cfg.jina_key}`;
    }

    const res = await fetch(jinaUrl, {
      headers,
      signal: AbortSignal.timeout(20000),
    });

    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 200) {
        return text.slice(0, 10000);
      }
    }
  } catch (e) {
    console.warn(`[fetcher] Jina failed for ${url}: ${e.message}`);
  }

  // ── Fallback: Raw HTTP + strip HTML ──────────────────────────────────────
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (res.ok) {
      const html = await res.text();
      // Intelligent fallback: discard obvious Cloudflare blocks, Captchas, or JS-only stubs
      const lowerHtml = html.toLowerCase();
      if (lowerHtml.includes('cloudflare') && lowerHtml.includes('ray id')) return null;
      if (lowerHtml.includes('enable javascript') || lowerHtml.includes('access denied')) return null;
      
      const stripped = _stripHtml(html);
      if (stripped.length < 300) return null; // Too short to be a real product page
      
      return stripped.slice(0, 10000);
    }
  } catch (e) {
    console.warn(`[fetcher] Raw fetch failed for ${url}: ${e.message}`);
  }

  return null;
}

function _stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    // Preserve tables structure
    .replace(/<\/td>/gi, ' | ')
    .replace(/<\/th>/gi, ' | ')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Remove remaining tags
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up spaces but keep newlines
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { fetchPageContent };
