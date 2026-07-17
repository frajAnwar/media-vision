/**
 * Pipeline Orchestrator
 * Ties together: scraper → fetcher → agent
 * Pushes SSE progress events to connected frontend clients.
 * Concurrency: 2 items processed in parallel.
 */

const { getDB }          = require('./db');
const { searchProduct, searchImages }  = require('./scraper');
const { fetchPageContent } = require('./fetcher');
const { enrichProduct }  = require('./agent');

// ── SSE client registry ───────────────────────────────────────────────────────
const _clients = new Map(); // jobId → Set<Response>
const _cancelledJobs = new Set(); // jobId

function cancelJob(jobId) {
  _cancelledJobs.add(jobId);
}

function addSSEClient(jobId, res) {
  if (!_clients.has(jobId)) _clients.set(jobId, new Set());
  _clients.get(jobId).add(res);
}

function removeSSEClient(jobId, res) {
  _clients.get(jobId)?.delete(res);
}

function _broadcast(jobId, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of (_clients.get(jobId) || [])) {
    try { client.write(msg); } catch (_) {}
  }
}

// ── Main pipeline ─────────────────────────────────────────────────────────────
async function startPipeline(items, jobId) {
  const db = getDB();

  // ── Load reference tables for LLM context ──────────────────────────────
  const refTables = {};
  const tableNames = db.prepare(
    'SELECT DISTINCT table_name FROM reference_tables'
  ).all();

  for (const { table_name } of tableNames) {
    const tableRows = db.prepare(
      'SELECT row_data FROM reference_tables WHERE table_name = ? LIMIT 150'
    ).all(table_name);
    refTables[table_name] = tableRows.map(r => JSON.parse(r.row_data));
  }

  // ── Update job record ───────────────────────────────────────────────────
  db.prepare('UPDATE jobs SET status = ?, total = ? WHERE id = ?')
    .run('running', items.length, jobId);

  _broadcast(jobId, 'start', { total: items.length, jobId });

  // ── Process with concurrency limit ──────────────────────────────────────
  const CONCURRENCY = 3;
  let completed = 0;

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    if (_cancelledJobs.has(jobId)) {
      db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('cancelled', jobId);
      _broadcast(jobId, 'cancelled', { jobId });
      _cancelledJobs.delete(jobId);
      return;
    }

    const batch = items.slice(i, i + CONCURRENCY);

    await Promise.all(batch.map(item => _processItem(item, jobId, refTables, db, () => {
      completed++;
      db.prepare('UPDATE jobs SET completed = ? WHERE id = ?').run(completed, jobId);
    })));
  }

  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('done', jobId);
  _broadcast(jobId, 'complete', { jobId, completed });
}

async function _processItem(item, jobId, refTables, db, onDone) {
  const productId = item.id;
  const reference = item.reference;
  const raw_price = item.raw_price;
  const initial_title = item.title || item.product_title;
  const initial_brand = item.brand;
  
  let initial_specs = item.specs || item.extracted_specs;
  if (typeof initial_specs === 'string') {
    try { initial_specs = JSON.parse(initial_specs); } catch(e) {}
  }

  try {
    // ── Step 1: Search ──────────────────────────────────────────────────
    _broadcast(jobId, 'item_update', { id: productId, reference, status: 'searching' });

    let urls = [];
    let searchSnippets = '';
    try {
      const results = await searchProduct({ 
        reference, 
        title: initial_title, 
        brand: initial_brand,
        customInstruction: item.custom_instruction 
      });
      urls = results.map(r => r.url).filter(Boolean);
      
      // Extract snippets and content from the search results as a baseline
      for (const r of results) {
        if (r.snippet || r.content) {
          searchSnippets += `\n\n--- Extrait Web (Source: ${r.url}) ---\n`;
          if (r.title) searchSnippets += `Titre: ${r.title}\n`;
          if (r.snippet) searchSnippets += `${r.snippet}\n`;
          if (r.content) searchSnippets += `${r.content}\n`;
        }
      }
    } catch (e) {
      if (e.message.includes('API') || e.message.includes('Unauthorized')) {
        throw e; // Bubble up critical API configuration errors
      }
      console.warn(`[pipeline] search failed for ${reference}:`, e.message);
    }

    // ── Step 2: Fetch page content ──────────────────────────────────────
    _broadcast(jobId, 'item_update', { id: productId, reference, status: 'scraping', urls });

    let scrapedContent = searchSnippets;
    for (const url of urls.slice(0, 3)) {
      const content = await fetchPageContent(url).catch(() => null);
      if (content) {
        scrapedContent += `\n\n--- Page Web Complète: ${url} ---\n${content}`;
      }
    }

    let imageResults = [];
    
    // ── Step 3: LLM enrichment ──────────────────────────────────────────
    _broadcast(jobId, 'item_update', { id: productId, reference, status: 'enriching' });

    refTables.initial_data = {
      title: initial_title,
      brand: initial_brand,
      specs: initial_specs,
      custom_instruction: item.custom_instruction
    };

    const enriched = await enrichProduct(reference, scrapedContent, refTables);
    
    // --- Step 4: Post-Enrichment Image Search ---
    // Now that the LLM has extracted the perfect commercial title, we search for images using it.
    let finalImages = [];
    try {
      const bestTitle = enriched.product_title || initial_title;
      const bestBrand = enriched.brand || initial_brand;
      finalImages = await searchImages({ reference, title: bestTitle, brand: bestBrand }) || [];
    } catch (e) {
      if (e.message.includes('API') || e.message.includes('Unauthorized')) {
        throw e; // Bubble up critical API configuration errors
      }
      console.warn(`[pipeline] post-enrichment searchImages failed:`, e.message);
    }

    // Auto-select only the very first (best) image by default to prevent forcing 4 images
    const images = finalImages.slice(0, 1);

    // ── Step 4: Persist ─────────────────────────────────────────────────
    db.prepare(`
      UPDATE products SET
        status = 'enriched', 
        confidence = ?, 
        confidence_reason = ?,
        product_title = ?, 
        brand = ?, 
        html_description = ?, 
        seo_excerpt = ?,
        meta_title = ?,
        meta_keywords = ?,
        meta_description = ?,
        suggested_category = ?, 
        resolved_category_id = ?, 
        resolved_category_ids = ?, 
        resolved_tax_rule_id = ?,
        extracted_specs = ?, 
        high_res_images = ?, 
        selected_image = ?, 
        mismatch_warning = ?, 
        matched_features = ?, 
        updated_at = strftime('%s','now')
      WHERE id = ?
    `).run(
      enriched.data_confidence_score || 0,
      enriched.confidence_reason     || null,
      enriched.product_title         || null,
      enriched.brand                 || null,
      enriched.html_description      || null,
      enriched.seo_excerpt           || null,
      enriched.meta_title            || null,
      enriched.meta_keywords         || null,
      enriched.meta_description      || null,
      enriched.suggested_categories ? JSON.stringify(enriched.suggested_categories) : null,
      (enriched.resolved_category_ids && enriched.resolved_category_ids.length > 0) ? enriched.resolved_category_ids[0] : null,
      enriched.resolved_category_ids ? JSON.stringify(enriched.resolved_category_ids) : null,
      enriched.resolved_tax_rule_id  ?? null,
      JSON.stringify(enriched.extracted_specs || {}),
      JSON.stringify(images),
      JSON.stringify(images),
      enriched.mismatch_warning || null,
      enriched.matched_features ? JSON.stringify(enriched.matched_features) : null,
      productId
    );

    onDone();
    _broadcast(jobId, 'item_update', {
      id: productId, reference, status: 'enriched',
      confidence: enriched.data_confidence_score || 0,
      confidence_reason: enriched.confidence_reason || null,
      title: enriched.product_title,
    });

  } catch (err) {
    console.error(`[pipeline] ERROR for ${reference}:`, err.message);

    db.prepare(`
      UPDATE products SET status = 'error', error_message = ?, updated_at = strftime('%s','now')
      WHERE id = ?
    `).run(err.message, productId);

    onDone();
    _broadcast(jobId, 'item_update', { id: productId, reference, status: 'error', error: err.message });
  }
}

module.exports = {
  startPipeline,
  addSSEClient,
  removeSSEClient,
  cancelJob
};
