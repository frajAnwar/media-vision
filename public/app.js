/* ─────────────────────────────────────────────────────────────────────────
   MediaVision Enrichment Pipeline — Frontend SPA
   Vanilla JS, no framework dependencies.
───────────────────────────────────────────────────────────────────────────── */

'use strict';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  currentTab:    'input',
  parsedItems:   [],
  products:      [],
  selectedIds:   new Set(),
  currentFilter: 'all',
  searchQuery:   '',
  editingProduct: null,
  jobId:         null,
  progressItems: {}, // id → { reference, status, title }
};

// ── API ────────────────────────────────────────────────────────────────────
const api = {
  async post(url, body) {
    const r = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({ error: r.statusText }));
      throw new Error(e.error || r.statusText);
    }
    return r.json();
  },

  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.statusText);
    return r.json();
  },

  async put(url, body) {
    const r = await fetch(url, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({ error: r.statusText }));
      throw new Error(e.error || r.statusText);
    }
    return r.json();
  },

  async del(url) {
    const r = await fetch(url, { method: 'DELETE' });
    if (!r.ok) throw new Error(r.statusText);
    return r.json();
  },

  ingest:  (rawText) => api.post('/api/ingest', { rawText }),
  enrich:  (items)   => api.post('/api/enrich/start', { items }),

  products: {
    list:   (status, search) => api.get(`/api/products?status=${status||''}&search=${search||''}`),
    stats:  ()               => api.get('/api/products/stats'),
    update: (id, data)       => api.put(`/api/products/${id}`, data),
    approve:(id)             => api.post(`/api/products/${id}/approve`, {}),
    reject: (id)             => api.post(`/api/products/${id}/reject`, {}),
    remove: (id)             => api.del(`/api/products/${id}`),
    bulkApprove:(ids)        => api.post('/api/products/bulk/approve', { ids }),
    bulkDelete: (ids)        => api.post('/api/products/bulk/delete',  { ids }),
    bulkRetry:  (ids, reason) => api.post('/api/enrich/bulk/retry', { ids, reason }),
  },

  settings: {
    get:  ()    => api.get('/api/settings'),
    save: (cfg) => api.put('/api/settings', cfg),
  },

  tables: {
    list:   ()             => api.get('/api/tables'),
    get:    (name)         => api.get(`/api/tables/${name}`),
    import: (tableName, csvText) => api.post('/api/tables/import', { tableName, csvText }),
    remove: (name)         => api.del(`/api/tables/${name}`),
  },
};

// ── Router ─────────────────────────────────────────────────────────────────
function switchTab(tab) {
  state.currentTab = tab;

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(el => {
    el.classList.toggle('active', el.id === `tab-${tab}`);
  });

  if (tab === 'dashboard') loadDashboard();
  if (tab === 'tables')    loadTables();
  if (tab === 'settings')  loadSettings();
}

// ── Tab: Input ─────────────────────────────────────────────────────────────
function initInputTab() {
  $('btn-clear-input').addEventListener('click', () => {
    $('raw-input').value = '';
    $('preview-card').style.display = 'none';
    state.parsedItems = [];
    $('btn-enrich').disabled = true;
    $('enrich-count').textContent = '';
  });

  $('btn-parse').addEventListener('click', async () => {
    const raw = $('raw-input').value.trim();
    if (!raw) return toast('Paste text to analyze', 'warn');

    const btn = $('btn-parse');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'AI Analyzing...';

    try {
      const { items } = await api.ingest(raw);
      state.parsedItems = items || [];

      if (!state.parsedItems.length) {
        btn.disabled = false;
        btn.innerHTML = originalText;
        return toast('No references detected. Check the format.', 'warn');
      }

      renderParsedItems(state.parsedItems);
      $('preview-card').style.display = '';
      $('btn-enrich').disabled = false;
      $('enrich-count').textContent = `(${state.parsedItems.length})`;
      toast(`${state.parsedItems.length} reference(s) detected`, 'ok');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  });

  $('btn-enrich').addEventListener('click', startEnrichment);
  $('btn-goto-dashboard').addEventListener('click', () => switchTab('dashboard'));

  $('btn-cancel-job').addEventListener('click', async () => {
    if (!state.jobId) return;
    try {
      await api.del(`/api/enrich/cancel/${state.jobId}`);
      toast('Annulation en cours...', 'info');
      $('btn-cancel-job').disabled = true;
      $('btn-cancel-job').textContent = 'Annulation...';
    } catch (e) {
      toast(e.message, 'err');
    }
  });
}

function renderParsedItems(items) {
  const list = $('parsed-list');
  $('parsed-count').textContent = items.length;
  list.innerHTML = items.map(item => `
    <div class="parsed-item" style="display:flex; flex-direction:column; gap:4px">
      <div style="display:flex; justify-content:space-between">
        <span class="parsed-ref">${esc(item.reference)}</span>
        ${item.raw_price != null
          ? `<span class="parsed-price">${item.raw_price.toFixed(3)} TND</span>`
          : `<span class="parsed-no-price">No price detected</span>`}
      </div>
      ${item.title || item.brand ? `
        <div style="font-size:0.8rem; color:var(--text-secondary)">
          ${item.brand ? `<strong>${esc(item.brand)}</strong> - ` : ''}${esc(item.title || '')}
        </div>
      ` : ''}
      ${item.specs && Object.keys(item.specs).length > 0 ? `
        <div style="font-size:0.75rem; margin-top:6px; color:var(--text-secondary); background: rgba(255,255,255,0.03); padding: 8px; border-radius: 4px;">
          <strong>Caractéristiques extraites :</strong><br>
          <ul style="margin: 4px 0 0 16px; padding: 0;">
            ${Object.entries(item.specs).slice(0, 8).map(([k, v]) => `<li><b>${esc(k)}</b>: ${esc(String(v))}</li>`).join('')}
            ${Object.keys(item.specs).length > 8 ? `<li><i>...et ${Object.keys(item.specs).length - 8} autres</i></li>` : ''}
          </ul>
        </div>
      ` : ''}
    </div>
  `).join('');
}

async function startEnrichment() {
  if (!state.parsedItems.length) return;

  $('btn-enrich').disabled = true;
  $('progress-card').style.display = '';
  $('progress-done').style.display  = 'none';
  $('progress-bar').style.width     = '0%';
  $('progress-list').innerHTML = '';
  $('progress-summary').textContent = `0 / ${state.parsedItems.length}`;
  state.progressItems = {};

  // Init progress rows
  state.parsedItems.forEach(item => {
    state.progressItems[item.reference] = { reference: item.reference, status: 'pending' };
    appendProgressRow(item.reference, 'pending');
  });

  try {
    const { jobId } = await api.enrich(state.parsedItems);
    state.jobId = jobId;
    $('btn-cancel-job').style.display = 'block';
    $('btn-cancel-job').disabled = false;
    $('btn-cancel-job').textContent = 'Annuler';
    connectSSE(jobId);
    toast('Enrichment started', 'info');
  } catch (e) {
    toast(e.message, 'err');
    $('btn-enrich').disabled = false;
  }
}

async function retryEnrichment(ids, fromDashboard = false, reason = "") {
  if (!fromDashboard) {
    $('progress-card').style.display = '';
    $('progress-done').style.display  = 'none';
    $('progress-bar').style.width     = '0%';
    $('progress-list').innerHTML = '';
    $('progress-summary').textContent = `0 / ${ids.length}`;
    state.progressItems = {};
    _progressDone = 0;
    _progressTotal = 0;
  }

  try {
    const { jobId } = await api.products.bulkRetry(ids, reason);
    state.jobId = jobId;
    $('btn-cancel-job').style.display = 'block';
    $('btn-cancel-job').disabled = false;
    $('btn-cancel-job').textContent = 'Annuler';
    connectSSE(jobId, fromDashboard);
    toast('Retry started', 'info');
  } catch (e) {
    toast(e.message, 'err');
  }
}

function connectSSE(jobId, fromDashboard = false) {
  const es = new EventSource(`/api/enrich/stream/${jobId}`);

  es.addEventListener('start', e => {
    const { total } = JSON.parse(e.data);
    if (!fromDashboard) $('progress-summary').textContent = `0 / ${total}`;
  });

  es.addEventListener('item_update', e => {
    const { id, reference, status, title, confidence, error } = JSON.parse(e.data);
    updateProgressRow(reference, status, title, confidence, error, id, fromDashboard);
  });

  es.addEventListener('complete', e => {
    es.close();
    if (!fromDashboard) {
      $('progress-done').style.display = '';
      $('progress-bar').style.width    = '100%';
      $('badge-dashboard').textContent = Object.keys(state.progressItems).length;
    }
    toast('Enrichment finished!', 'ok');
    $('btn-enrich').disabled = false;
    
    // Refresh products if on dashboard, otherwise switch to dashboard
    if (fromDashboard) {
      refreshProducts();
      refreshStats();
    } else {
      switchTab('dashboard');
    }
  });

  es.addEventListener('cancelled', e => {
    es.close();
    toast('Enrichissement annulé', 'warn');
    $('btn-enrich').disabled = false;
    $('btn-cancel-job').style.display = 'none';
    if (!fromDashboard) {
      $('progress-done').style.display = '';
      $('progress-done').innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Enrichissement annulé.`;
    }
    if (fromDashboard) {
      refreshProducts();
      refreshStats();
    }
  });

  es.onerror = () => { es.close(); };
}

let _progressDone = 0;
let _progressTotal = 0;

function appendProgressRow(reference, status) {
  const id = `prow-${reference.replace(/[^a-z0-9]/gi, '_')}`;
  const div = document.createElement('div');
  div.id = id;
  div.className = `progress-item pi-${status}`;
  div.innerHTML = _progressRowHTML(reference, status);
  $('progress-list').appendChild(div);
  _progressTotal++;
}

function updateProgressRow(reference, status, title, confidence, error, id, fromDashboard = false) {
  if (!fromDashboard) {
    const domId  = `prow-${reference.replace(/[^a-z0-9]/gi, '_')}`;
    const row = document.getElementById(domId);
    if (row) {
      row.className = `progress-item pi-${status}`;
      row.innerHTML = _progressRowHTML(reference, status, title, error, id);
    }
    if (status === 'enriched' || status === 'error') {
      _progressDone++;
      const pct = Math.round((_progressDone / _progressTotal) * 100);
      $('progress-bar').style.width    = pct + '%';
      $('progress-summary').textContent = `${_progressDone} / ${_progressTotal}`;
    }
  } else {
    const dashCard = document.querySelector(`.product-card[data-id="${id}"]`);
    if (dashCard) {
      if (status === 'enriched' || status === 'error') {
        // Will be refreshed in 'complete' event, but can add a temporary class
        dashCard.style.opacity = '1';
      } else {
        dashCard.style.opacity = '0.5';
        const statusEl = dashCard.querySelector('.pr-status');
        if (statusEl) statusEl.innerHTML = `<span class="status-chip s-pending">Traitement...</span>`;
      }
    }
  }
}

function _progressRowHTML(reference, status, title, error, dbId) {
  const icons = {
    pending:   '<svg class="pi-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    searching: '<svg class="pi-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    scraping:  '<svg class="pi-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>',
    enriching: '<svg class="pi-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>',
    enriched:  '<svg class="pi-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
    error:     '<svg class="pi-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  };
  const labels = { pending:'Pending', searching:'Searching...', scraping:'Scraping...', enriching:'AI processing...', enriched:'Finished', error:'Error' };
  const shortTitle = title ? title.slice(0, 55) + (title.length > 55 ? '…' : '') : '';

  return `
    ${icons[status] || icons.pending}
    <div style="flex:1; overflow:hidden;">
      <div style="font-weight:600; font-size:0.9rem">${esc(reference)} <span style="font-weight:normal;color:var(--text-muted)">${esc(shortTitle)}</span></div>
      ${status === 'error' && error ? `<div style="font-size:0.8rem;color:var(--danger); background:rgba(239,68,68,0.1); padding: 4px 8px; border-radius: 4px; margin-top: 4px; white-space: pre-wrap; word-break: break-word;">${esc(error)}</div>` : ''}
    </div>
    <div style="font-size:0.85rem; display:flex; align-items:center; gap:8px;">
      <span class="pi-label">${labels[status] || status}</span>
      ${status === 'error' && dbId ? `<button class="btn btn-sm btn-secondary" onclick="retryEnrichment(['${esc(dbId)}'])" style="padding:2px 8px;font-size:12px">Retry</button>` : ''}
    </div>
  `;
}

// ── Tab: Dashboard ─────────────────────────────────────────────────────────
async function loadDashboard() {
  await refreshStats();
  await refreshProducts();
  updateSelectBar();
}

async function refreshStats() {
  try {
    const stats = await api.products.stats();
    $('stat-total').textContent    = stats.total    || 0;
    $('stat-enriched').textContent = stats.enriched || 0;
    $('stat-approved').textContent = stats.approved || 0;
    $('stat-errors').textContent   = stats.errors   || 0;
    $('badge-dashboard').textContent = stats.total || 0;
  } catch (_) {}
}

async function refreshProducts() {
  try {
    const rawProducts = await api.products.list('', state.searchQuery);
    
    // Filter locally based on current filter
    if (state.currentFilter === 'all') {
      state.products = rawProducts.filter(p => p.status !== 'error');
    } else if (state.currentFilter) {
      state.products = rawProducts.filter(p => p.status === state.currentFilter);
    } else {
      state.products = rawProducts;
    }
    
    renderProductList();
  } catch (e) {
    toast(e.message, 'err');
  }
}

function renderProductList() {
  const list = $('product-list');

  if (!state.products.length) {
    list.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>
        <p>Aucun produit trouvé pour ce filtre.</p>
      </div>`;
    return;
  }

  list.innerHTML = state.products.map(p => productCardHTML(p)).join('');

  // Bind card events
  list.querySelectorAll('.pc-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const pId = cb.dataset.id;
      if (cb.checked) state.selectedIds.add(pId);
      else state.selectedIds.delete(pId);
      cb.closest('.product-card').classList.toggle('selected', cb.checked);
      updateSelectBar();
    });
  });

  list.querySelectorAll('.dg-item').forEach(item => {
    item.addEventListener('click', async () => {
      const pId = item.dataset.pid;
      const url = item.dataset.url;
      const p = state.products.find(x => x.id === pId);
      if (!p) return;

      let selectedImgs = [];
      try { selectedImgs = JSON.parse(p.selected_image || '[]'); } 
      catch (e) { selectedImgs = p.selected_image ? [p.selected_image] : []; }

      if (selectedImgs.includes(url)) {
        selectedImgs = selectedImgs.filter(u => u !== url);
      } else {
        selectedImgs.push(url);
      }

      p.selected_image = JSON.stringify(selectedImgs);
      
      // Update UI immediately for responsiveness
      item.classList.toggle('selected', selectedImgs.includes(url));
      
      // Update numbers for all siblings
      const gallery = item.closest('.dash-gallery');
      gallery.querySelectorAll('.dg-item').forEach(sibling => {
        const siblingUrl = sibling.dataset.url;
        const numSpan = sibling.querySelector('.dg-num');
        const isSel = selectedImgs.includes(siblingUrl);
        sibling.classList.toggle('selected', isSel);
        
        if (isSel) {
          const idx = selectedImgs.indexOf(siblingUrl) + 1;
          if (numSpan) numSpan.textContent = idx;
          else sibling.insertAdjacentHTML('beforeend', `<span class="dg-num">${idx}</span>`);
        } else {
          if (numSpan) numSpan.remove();
        }
      });

      // Save to DB in background
      try {
        await api.put(`/api/products/${pId}`, { selected_image: JSON.stringify(selectedImgs) });
      } catch (e) {
        toast('Erreur de sauvegarde: ' + e.message, 'err');
      }
    });
  });

  list.querySelectorAll('.btn-edit-product').forEach(btn => {
    btn.addEventListener('click', () => openDrawer(btn.dataset.id));
  });

  list.querySelectorAll('.btn-retry-product').forEach(btn => {
    btn.addEventListener('click', async () => {
      const reason = prompt("Instructions pour l'IA (optionnel, ex: 'Trouve une image avec fond noir') :", "");
      if (reason === null) return;
      await retryEnrichment([btn.dataset.id], true, reason);
    });
  });

  list.querySelectorAll('.btn-approve-product').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pId = btn.dataset.id;
      const p = state.products.find(x => x.id === pId);
      if (p) {
        if ((p.confidence < 0.6) || p.mismatch_warning) {
          if (!confirm("Attention : L'IA a signalé une faible fiabilité ou une incohérence sur ce produit. Êtes-vous sûr de vouloir l'approuver sans vérifier les modifications ?")) {
            return;
          }
        }
      }
      try {
        await api.products.approve(pId);
        toast('Produit approuvé', 'ok');
        await refreshProducts();
        await refreshStats();
      } catch (e) { toast(e.message, 'err'); }
    });
  });

  list.querySelectorAll('.btn-reject-product').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api.products.reject(btn.dataset.id);
        toast('Produit rejeté', 'warn');
        await refreshProducts();
        await refreshStats();
      } catch (e) { toast(e.message, 'err'); }
    });
  });
}

function productCardHTML(p) {
  const conf       = p.confidence || 0;
  const isSelected = state.selectedIds.has(p.id);
  const price      = p.raw_price != null ? `${Number(p.raw_price).toFixed(3)} TND` : '—';
  
  let specsHTML = '';
  if (p.extracted_specs && typeof p.extracted_specs === 'object') {
    specsHTML = Object.entries(p.extracted_specs)
      .slice(0, 4)
      .map(([k, v]) => `<span class="spec-tag"><strong>${esc(k)}</strong>: ${esc(String(v))}</span>`)
      .join('');
  }

  const mismatchBadge = p.mismatch_warning 
    ? `<div class="mismatch-badge" title="${esc(p.mismatch_warning)}">⚠️ Mismatch: ${esc(p.mismatch_warning)}</div>` 
    : '';

  const confidenceReasonBadge = p.confidence_reason
    ? `<div class="mismatch-badge" style="background:var(--error-bg);color:var(--error);border-color:rgba(239,68,68,0.3);" title="${esc(p.confidence_reason)}">❓ Fiabilité Faible: ${esc(p.confidence_reason)}</div>`
    : '';

  const errorBadge = p.status === 'error' && p.error_message
    ? `<div class="mismatch-badge" style="background:var(--error-bg);color:var(--error);border-color:rgba(239,68,68,1); font-weight: bold; margin-top: 8px;">💥 Erreur IA: ${esc(p.error_message)}</div>`
    : '';

  const confClass  = conf >= 0.8 ? 'conf-high' : conf >= 0.5 ? 'conf-medium' : 'conf-low';
  const confTooltip = conf >= 0.8 ? 'Données très fiables' : conf >= 0.5 ? 'Vérification recommandée' : 'Risque élevé, vérification obligatoire';
  const confLabel  = Math.round(conf*100) + '%';
  let selectedImgs = [];
  try {
    selectedImgs = JSON.parse(p.selected_image || '[]');
    if (!Array.isArray(selectedImgs)) selectedImgs = [p.selected_image];
  } catch (e) {
    selectedImgs = p.selected_image ? [p.selected_image] : [];
  }

    let galleryHTML = '<div class="pr-image-thumb"><span class="no-img">📦</span></div>';
  if (selectedImgs.length > 0) {
    galleryHTML = `<img src="${esc(selectedImgs[0])}" class="pr-image-thumb" loading="lazy" onerror="this.style.display='none'" />`;
  } else if (p.high_res_images && p.high_res_images.length > 0) {
    galleryHTML = `<img src="${esc(p.high_res_images[0])}" class="pr-image-thumb" loading="lazy" onerror="this.style.display='none'" />`;
  }

  const isLowConf = conf < 0.75 && p.status === 'enriched';
  return `
    <div class="product-row${isSelected ? ' selected' : ''}${isLowConf ? ' low-confidence-alert' : ''}" data-id="${p.id}" onclick="openDrawer('${p.id}')">
      <div class="pr-checkbox" onclick="event.stopPropagation()">
        <input type="checkbox" class="pc-cb" data-id="${p.id}"${isSelected ? ' checked' : ''} />
      </div>
      
      <div class="pr-image-col">
        ${galleryHTML}
      </div>

      <div class="pr-ref-brand">
        <span class="pr-ref">${esc(p.reference)}</span>
        ${p.brand ? `<span class="pr-brand">${esc(p.brand)}</span>` : ''}
        ${p.suggested_category ? `<span class="pr-cat">${esc(p.suggested_category)}</span>` : ''}
      </div>

      <div class="pr-main">
        <div class="pr-title" title="${esc(p.product_title || '')}">${esc(p.product_title || '(No Title)')}</div>
        <div class="pr-specs-grid">
          ${specsHTML}
        </div>
        ${mismatchBadge}
        ${confidenceReasonBadge}
        ${errorBadge}
      </div>
      
      <div class="pr-price">${price}</div>
      
      <div class="pr-status">
        <span class="status-chip s-${p.status}">${statusLabel(p.status)}</span>
        <span class="confidence-badge ${confClass}" title="${confTooltip}">${confLabel}</span>
      </div>

      <div class="pr-actions" style="display:flex; gap:4px; justify-content:flex-end;">
        ${p.status !== 'error' && p.status !== 'approved' ? `
        <button class="btn-icon btn-success btn-approve-product" data-id="${p.id}" title="Approuver" onclick="event.stopPropagation()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
        </button>` : ''}
        ${p.status !== 'error' && p.status !== 'rejected' ? `
        <button class="btn-icon btn-danger btn-reject-product" data-id="${p.id}" title="Rejeter" onclick="event.stopPropagation()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>` : ''}
      </div>
    </div>
  `;
}

function statusLabel(s) {
  const map = { pending:'Pending', enriched:'Finished', approved:'Approved', rejected:'Rejected', error:'Error' };
  return map[s] || s;
}

function updateSelectBar() {
  const count = state.selectedIds.size;
  const showBar = state.products.length > 0;
  $('select-bar').style.display  = showBar ? '' : 'none';
  $('bulk-actions').style.display = count > 0 ? '' : 'none';
  $('selected-count').textContent = `${count} sélectionné(s)`;

  const allCb = $('select-all-cb');
  allCb.checked       = count > 0 && count === state.products.length;
  allCb.indeterminate = count > 0 && count < state.products.length;
}

function initDashboardTab() {
  // Filter chips
  document.querySelectorAll('.chip-filter').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip-filter').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.currentFilter = chip.dataset.filter;
      state.selectedIds.clear();
      refreshProducts();
    });
  });

  // Search
  let searchTimer;
  $('search-products').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.searchQuery = e.target.value;
      refreshProducts();
    }, 300);
  });

  // Refresh button
  $('btn-refresh-dashboard').addEventListener('click', () => loadDashboard());

  // Select all
  $('select-all-cb').addEventListener('change', e => {
    if (e.target.checked) {
      state.products.forEach(p => state.selectedIds.add(p.id));
    } else {
      state.selectedIds.clear();
    }
    renderProductList();
    updateSelectBar();
  });

  // Bulk approve
  $('btn-bulk-approve').addEventListener('click', async () => {
    const ids = [...state.selectedIds];
    if (!ids.length) return;
    try {
      await api.products.bulkApprove(ids);
      state.selectedIds.clear();
      toast(`${ids.length} produit(s) approuvé(s)`, 'ok');
      await loadDashboard();
    } catch (e) { toast(e.message, 'err'); }
  });

  // Bulk retry
  $('btn-bulk-retry').addEventListener('click', async () => {
    const ids = [...state.selectedIds];
    if (!ids.length) return;
    const reason = prompt("Instructions pour l'IA (optionnel, ex: 'Trouve une image avec fond noir') :", "");
    if (reason === null) return;
    state.selectedIds.clear();
    await retryEnrichment(ids, true, reason);
  });

  // Bulk delete
  $('btn-bulk-delete').addEventListener('click', async () => {
    const ids = [...state.selectedIds];
    if (!ids.length) return;
    if (!confirm(`Supprimer ${ids.length} produit(s) ?`)) return;
    try {
      await api.products.bulkDelete(ids);
      state.selectedIds.clear();
      toast(`${ids.length} produit(s) supprimé(s)`, 'ok');
      await loadDashboard();
    } catch (e) { toast(e.message, 'err'); }
  });

  // CSV Export
  $('btn-export-csv').addEventListener('click', async () => {
    toast('Génération du package d\'export...', 'info');
    try {
      const res = await api.get('/api/export/package');
      showExportModal(res);
    } catch (err) {
      toast('Erreur export: ' + err.message, 'err');
    }
  });

  function showExportModal(data) {
    const container = $('export-buttons-container');
    container.innerHTML = '';
    
    function createDownloadBtn(label, content, filename, primary = false) {
      const btn = document.createElement('button');
      btn.className = primary ? 'btn btn-primary' : 'btn btn-secondary';
      btn.style.width = '100%';
      btn.style.textAlign = 'left';
      btn.style.justifyContent = 'flex-start';
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;margin-right:8px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg> ${label}`;
      btn.onclick = () => {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      };
      container.appendChild(btn);
    }

    let step = 1;
    if (data.newCategoriesCsv) {
      createDownloadBtn(`Étape ${step++}: Nouvelles Catégories`, data.newCategoriesCsv, 'nouvelles_categories.csv', true);
    }
    if (data.newFeaturesCsv) {
      createDownloadBtn(`Étape ${step++}: Nouvelles Caractéristiques`, data.newFeaturesCsv, 'nouvelles_caracteristiques.csv', true);
    }
    createDownloadBtn(`Étape ${step}: Produits Principaux`, data.productsCsv, `mediavision_import_${new Date().toISOString().slice(0, 10)}.csv`, step === 1);

    $('export-overlay').style.display = 'block';
    $('export-modal').style.display = 'block';
  }

  $('export-close')?.addEventListener('click', () => {
    $('export-overlay').style.display = 'none';
    $('export-modal').style.display = 'none';
  });
}

// ── Product Edit Drawer ────────────────────────────────────────────────────
function openDrawer(productId) {
  const product = state.products.find(p => p.id === productId);
  if (!product) return;

  state.editingProduct = { ...product };
  $('drawer-title').textContent = product.reference;
  renderDrawerBody(product);

  $('drawer-overlay').classList.add('open');
  $('product-drawer').classList.add('open');
}

function closeDrawer() {
  $('drawer-overlay').classList.remove('open');
  $('product-drawer').classList.remove('open');
  state.editingProduct = null;
}

function renderDrawerBody(p) {
  const images = p.high_res_images || [];
  const specs  = p.extracted_specs || {};
  
  let selectedImages = [];
  try {
    const parsed = JSON.parse(p.selected_image);
    if (Array.isArray(parsed)) selectedImages = parsed;
    else selectedImages = [String(p.selected_image)];
  } catch(e) {
    if (p.selected_image) selectedImages = [p.selected_image];
  }

  // Initialize state map for checkboxes
  state.editingProduct.selected_images_array = [...selectedImages];

  $('drawer-body').innerHTML = `
    <!-- SPLIT LAYOUT -->
    <div id="drawer-split-mode" style="display:grid; grid-template-columns: 1fr 1fr; gap: 24px; height: 100%;">
      
      <!-- LEFT: RAW DATA & PREVIEW -->
      <div class="drawer-left-col" style="overflow-y: auto; padding-right: 12px;">
        ${p.mismatch_warning ? `<div class="mismatch-alert">⚠️ <strong>Mismatch:</strong> ${esc(p.mismatch_warning)}</div>` : ''}
        
        <h2 style="font-size:18px; color:var(--text-primary); margin-bottom: 4px;">${esc(p.product_title || '(Sans titre)')}</h2>
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:16px;">Ref: ${esc(p.reference)} | Marque: ${esc(p.brand || 'N/A')}</div>

        ${selectedImages.length ? `
          <div class="preview-gallery">
            <img src="${esc(selectedImages[0])}" class="preview-main-img" onerror="this.src=''" />
            <div class="preview-thumbs">
              ${selectedImages.slice(1).map(u => `<img src="${esc(u)}" onerror="this.src=''" />`).join('')}
            </div>
          </div>
        ` : `<div style="padding:40px;text-align:center;color:var(--text-muted);background:var(--surface-hover);border-radius:8px;margin-bottom:16px;">Aucune image sélectionnée.</div>`}

        <div style="margin-bottom: 16px;">
          <span style="font-size:16px; font-weight:700; color:var(--text-primary);">${p.raw_price != null ? Number(p.raw_price).toFixed(3) + ' TND' : 'Prix non défini'}</span>
          <span style="font-size:12px; color:var(--text-secondary); margin-left:12px;">📁 ${esc(p.suggested_category || 'Aucune catégorie')}</span>
        </div>

        ${Object.keys(specs).length ? `
        <div style="margin-bottom: 16px;">
          <div style="font-size:12px; font-weight:600; color:var(--primary-light); margin-bottom:8px;">Caractéristiques extraites</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            ${Object.entries(specs).map(([k,v]) => `
              <div style="font-size:12px;padding:6px 10px;background:rgba(99,102,241,0.06);border-radius:6px;display:flex;flex-direction:column;">
                <strong style="color:var(--text-primary);margin-bottom:2px;">${esc(k)}</strong>
                <span style="color:var(--text-secondary);">${esc(String(v))}</span>
              </div>
            `).join('')}
          </div>
        </div>` : ''}
      </div>

      <!-- RIGHT: EDITABLE FIELDS -->
      <div class="drawer-right-col" style="overflow-y: auto; padding-right: 12px; border-left: 1px solid var(--border); padding-left: 24px;">
        <div class="drawer-section-title">Titre produit</div>
        <input type="text" class="form-input" id="d-title" value="${esc(p.product_title || '')}" placeholder="Titre..." />

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px; margin-top:16px;">
          <div>
            <div class="drawer-section-title">Marque</div>
            <input type="text" class="form-input" id="d-brand" value="${esc(p.brand || '')}" placeholder="Marque..." />
          </div>
          <div>
            <div class="drawer-section-title">Prix HT (TND)</div>
            <input type="number" class="form-input" id="d-price" value="${p.raw_price ?? ''}" placeholder="0.000" step="0.001" />
          </div>
        </div>

        <div style="margin-top:16px;">
          <div class="drawer-section-title">Catégorie suggérée</div>
          <input type="text" class="form-input" id="d-cat" value="${esc(p.suggested_category || '')}" placeholder="Catégorie..." />
        </div>

        <div style="margin-top:16px;">
          <div class="drawer-section-title">Extrait SEO</div>
          <textarea class="form-textarea" id="d-excerpt" rows="4">${esc(p.seo_excerpt || '')}</textarea>
        </div>

        <div style="margin-top:16px;">
          <div class="drawer-section-title" style="display:flex;align-items:center;justify-content:space-between">
            Description HTML
            <button class="btn btn-ghost btn-sm" id="d-preview-toggle">Aperçu</button>
          </div>
          <textarea class="form-textarea" id="d-html" rows="8">${esc(p.html_description || '')}</textarea>
          <div class="html-preview" id="d-html-preview" style="display:none"></div>
        </div>

        ${images.length ? `
        <div style="margin-top:16px;">
          <div class="drawer-section-title" style="display:flex;justify-content:space-between;align-items:center;">
            Sélectionner les images
            <button class="btn btn-secondary btn-sm" id="btn-auto-curate" data-id="${p.id}">✨ Auto-Curate</button>
          </div>
          <div class="image-grid" id="drawer-img-grid">
            ${images.map((url, i) => {
              const isSel = selectedImages.includes(url);
              return `
              <div class="img-thumb${isSel ? ' active' : ''}" data-url="${esc(url)}" title="${esc(url)}">
                <img src="${esc(url)}" loading="lazy" onerror="this.src=''" />
                ${isSel ? '<div class="check">✓</div>' : ''}
              </div>
            `}).join('')}
          </div>
        </div>` : ''}
      </div>
    </div>
  `;

  // HTML preview toggle
  $('d-preview-toggle').addEventListener('click', (e) => {
    e.preventDefault();
    const ta = $('d-html');
    const pv = $('d-html-preview');
    if (ta.style.display !== 'none') {
      pv.innerHTML = ta.value;
      ta.style.display = 'none'; pv.style.display = 'block';
      e.target.textContent = 'Code';
    } else {
      ta.style.display = 'block'; pv.style.display = 'none';
      e.target.textContent = 'Aperçu';
    }
  });

  // Image multi-picker
  const imgGrid = $('drawer-img-grid');
  if (imgGrid) {
    imgGrid.querySelectorAll('.img-thumb').forEach(thumb => {
      thumb.addEventListener('click', () => {
        const url = thumb.dataset.url;
        const isActive = thumb.classList.contains('active');
        
        if (isActive) {
          thumb.classList.remove('active');
          const c = thumb.querySelector('.check');
          if (c) c.remove();
          state.editingProduct.selected_images_array = state.editingProduct.selected_images_array.filter(u => u !== url);
        } else {
          thumb.classList.add('active');
          thumb.insertAdjacentHTML('beforeend', '<div class="check">✓</div>');
          if (!state.editingProduct.selected_images_array.includes(url)) {
            state.editingProduct.selected_images_array.push(url);
          }
        }
      });
    });

    const btnAuto = $('btn-auto-curate');
    if (btnAuto) {
      btnAuto.addEventListener('click', async () => {
        btnAuto.disabled = true;
        btnAuto.textContent = 'Curating...';
        try {
          const res = await fetch(`/api/products/${btnAuto.dataset.id}/curate-images`, { method: 'POST' });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          
          state.editingProduct.selected_images_array = data.selected_images;
          toast('Images organisées avec succès !', 'ok');
          
          // refresh thumbs visually
          imgGrid.querySelectorAll('.img-thumb').forEach(t => {
            const u = t.dataset.url;
            t.classList.remove('active');
            const c = t.querySelector('.check'); if(c) c.remove();
            
            if (data.selected_images.includes(u)) {
              t.classList.add('active');
              t.insertAdjacentHTML('beforeend', '<div class="check">✓</div>');
            }
          });
        } catch(e) {
          toast(e.message, 'err');
        } finally {
          btnAuto.disabled = false;
          btnAuto.textContent = '✨ Auto-Curate Photos';
        }
      });
    }
  }
}

async function saveDrawer() {
  if (!state.editingProduct) return;
  const p = state.editingProduct;

  const updates = {
    product_title:     $('d-title').value.trim(),
    brand:             $('d-brand').value.trim(),
    raw_price:         parseFloat($('d-price').value) || null,
    suggested_category:$('d-cat').value.trim(),
    seo_excerpt:       $('d-excerpt').value.trim(),
    html_description:  $('d-html').value.trim(),
    selected_image:    p.selected_image || null,
  };

  try {
    await api.products.update(p.id, updates);
    toast('Modifications enregistrées', 'ok');
    closeDrawer();
    await refreshProducts();
  } catch (e) { toast(e.message, 'err'); }
}

async function approveFromDrawer() {
  if (!state.editingProduct) return;
  await saveDrawer();
  try {
    await api.products.approve(state.editingProduct?.id || '');
    toast('Produit approuvé', 'ok');
    closeDrawer();
    await loadDashboard();
  } catch (e) { toast(e.message, 'err'); }
}

function initDrawer() {
  $('drawer-close').addEventListener('click', closeDrawer);
  $('drawer-overlay').addEventListener('click', closeDrawer);
  $('drawer-save').addEventListener('click', saveDrawer);
  $('drawer-approve').addEventListener('click', approveFromDrawer);
}

// ── Tab: Reference Tables ──────────────────────────────────────────────────
async function loadTables() {
  try {
    const tables = await api.tables.list();
    renderTablesList(tables);
  } catch (e) { toast(e.message, 'err'); }
}

function renderTablesList(tables) {
  const list = $('tables-list');
  if (!tables.length) {
    list.innerHTML = '<div class="empty-state" style="padding:20px 0">Aucune table importée.</div>';
    return;
  }

  list.innerHTML = tables.map(t => `
    <div class="table-row">
      <span class="table-row-name">📋 ${esc(t.table_name)}</span>
      <span class="table-row-count">${t.row_count} lignes</span>
      <span class="table-row-date">${_formatDate(t.last_updated)}</span>
      <button class="btn btn-ghost btn-sm" data-action="preview" data-name="${esc(t.table_name)}">Aperçu</button>
      <button class="btn btn-danger btn-sm"  data-action="delete"  data-name="${esc(t.table_name)}">✕</button>
    </div>
  `).join('');

  list.querySelectorAll('[data-action="preview"]').forEach(btn => {
    btn.addEventListener('click', () => previewTable(btn.dataset.name));
  });

  list.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Supprimer la table "${btn.dataset.name}" ?`)) return;
      try {
        await api.tables.remove(btn.dataset.name);
        toast('Table supprimée', 'ok');
        loadTables();
      } catch (e) { toast(e.message, 'err'); }
    });
  });
}

async function previewTable(name) {
  try {
    const rows = await api.tables.get(name);
    if (!rows.length) return toast('Table vide', 'warn');

    const headers = Object.keys(rows[0]);
    const tableHTML = `
      <table>
        <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.slice(0, 50).map(r =>
          `<tr>${headers.map(h => `<td>${esc(String(r[h] ?? ''))}</td>`).join('')}</tr>`
        ).join('')}</tbody>
      </table>
      ${rows.length > 50 ? `<p style="color:var(--text-muted);font-size:12px;padding:8px 0">… et ${rows.length - 50} autres lignes</p>` : ''}
    `;

    $('table-preview-label').textContent = `Aperçu : ${name} (${rows.length} lignes)`;
    $('table-preview-wrap').innerHTML = tableHTML;
    $('table-preview-card').style.display = '';
    $('table-preview-card').scrollIntoView({ behavior: 'smooth' });
  } catch (e) { toast(e.message, 'err'); }
}

function initTablesTab() {
  $('btn-import-table').addEventListener('click', async () => {
    const tableName = $('table-name-select').value;
    const csvText   = $('table-csv-input').value.trim();

    if (!csvText) return toast('Collez vos données CSV d\'abord', 'warn');

    try {
      $('btn-import-table').disabled = true;
      const { count } = await api.tables.import(tableName, csvText);
      $('import-feedback').textContent = `✓ ${count} lignes importées`;
      $('import-feedback').className   = 'import-feedback feedback-ok';
      $('table-csv-input').value = '';
      toast(`Table "${tableName}" importée avec ${count} lignes`, 'ok');
      loadTables();
    } catch (e) {
      $('import-feedback').textContent = `✗ ${e.message}`;
      $('import-feedback').className   = 'import-feedback feedback-err';
      toast(e.message, 'err');
    } finally {
      $('btn-import-table').disabled = false;
      setTimeout(() => { $('import-feedback').textContent = ''; }, 4000);
    }
  });

  $('btn-refresh-tables').addEventListener('click', loadTables);

  $('btn-close-preview').addEventListener('click', () => {
    $('table-preview-card').style.display = 'none';
  });
}

// ── Tab: Settings ──────────────────────────────────────────────────────────
async function loadSettings() {
  try {
    const cfg = await api.settings.get();

    $('llm-provider').value     = cfg.llm_provider   || 'openai';
    
    $('openai-key').value       = cfg.openai_key || '';
    $('gemini-key').value       = cfg.gemini_key || '';
    $('openrouter-key').value   = cfg.openrouter_key || '';

    _toggleProviderFields(cfg.llm_provider || 'openai');
    
    if (cfg.llm_provider === 'openrouter') {
      // Just put it as a single option initially until they fetch
      $('llm-model-select').innerHTML = `<option value="${cfg.llm_model}">${cfg.llm_model || 'google/gemini-2.0-flash-exp:free'}</option>`;
      $('llm-model-select').value = cfg.llm_model || 'google/gemini-2.0-flash-exp:free';
      $('llm-model').value = cfg.llm_model || '';

      $('vision-model-select').innerHTML = `<option value="${cfg.vision_model}">${cfg.vision_model || 'google/gemini-2.0-flash-exp:free'}</option>`;
      $('vision-model-select').value = cfg.vision_model || 'google/gemini-2.0-flash-exp:free';
      $('vision-model').value = cfg.vision_model || '';
    } else {
      $('llm-model').value = cfg.llm_model || '';
      $('vision-model').value = cfg.vision_model || 'google/gemini-2.0-flash-exp:free';
    }

    $('search-provider').value  = cfg.search_provider || 'serper';
    $('search-key').value       = cfg[`${cfg.search_provider || 'serper'}_key`] || '';
    $('helper-websites').value  = cfg.helper_websites || '';
    $('jina-key').value         = cfg.jina_key        || '';

    _updateApiStatus(cfg);
  } catch (e) { toast(e.message, 'err'); }
}

function _toggleProviderFields(provider) {
  $('group-openai-key').style.display = provider === 'openai' ? '' : 'none';
  $('group-gemini-key').style.display = provider === 'gemini' ? '' : 'none';
  $('group-openrouter-key').style.display = provider === 'openrouter' ? '' : 'none';
  
  $('llm-model').style.display = provider === 'openrouter' ? 'none' : '';
  $('llm-model-select').style.display = provider === 'openrouter' ? '' : 'none';
  $('vision-model').style.display = provider === 'openrouter' ? 'none' : '';
  $('vision-model-select').style.display = provider === 'openrouter' ? '' : 'none';
  $('btn-fetch-openrouter').style.display = provider === 'openrouter' ? '' : 'none';
  
  if (provider === 'openai') $('llm-model').placeholder = 'gpt-4o-mini';
  else if (provider === 'gemini') $('llm-model').placeholder = 'gemini-1.5-flash';
}

function initSettingsTab() {
  $('btn-save-settings').addEventListener('click', async () => {
    const provider = $('llm-provider').value;
    const search   = $('search-provider').value;

    const cfg = {
      llm_provider:    provider,
      llm_model:       provider === 'openrouter' ? $('llm-model-select').value : $('llm-model').value.trim(),
      vision_model:    provider === 'openrouter' ? $('vision-model-select').value : $('vision-model').value.trim(),
      openai_key:      $('openai-key').value.trim(),
      gemini_key:      $('gemini-key').value.trim(),
      openrouter_key:  $('openrouter-key').value.trim(),
      search_provider: search,
      [`${search}_key`]: $('search-key').value.trim(),
      helper_websites: $('helper-websites').value.trim(),
      jina_key:        $('jina-key').value.trim(),
    };

    try {
      await api.settings.save(cfg);
      $('save-feedback').textContent = '✓ Paramètres enregistrés';
      $('save-feedback').className   = 'save-feedback feedback-ok';
      _updateApiStatus(cfg);
      toast('Paramètres enregistrés', 'ok');
    } catch (e) {
      $('save-feedback').textContent = `✗ ${e.message}`;
      $('save-feedback').className   = 'save-feedback feedback-err';
      toast(e.message, 'err');
    }

    setTimeout(() => { $('save-feedback').textContent = ''; }, 4000);
  });

  // Toggle show/hide password
  document.querySelectorAll('.eye-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = $(btn.dataset.target);
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  // Update UI on LLM provider change
  $('llm-provider').addEventListener('change', e => {
    _toggleProviderFields(e.target.value);
  });

  // Fetch OpenRouter models
  $('btn-fetch-openrouter').addEventListener('click', async () => {
    try {
      $('btn-fetch-openrouter').disabled = true;
      $('btn-fetch-openrouter').textContent = 'Chargement...';
      const models = await api.get('/api/openrouter/models');
      const sel = $('llm-model-select');
      const prevVal = sel.value;
      const vSel = $('vision-model-select');
      const vPrevVal = vSel.value;
      
      sel.innerHTML = models.map(m => 
        `<option value="${m.id}">${m.isFree ? '⭐ GRATUIT: ' : ''}${m.name} (${m.context_length} ctx)</option>`
      ).join('');
      
      const visionModels = models.filter(m => m.isVision);
      vSel.innerHTML = visionModels.map(m => 
        `<option value="${m.id}">${m.isFree ? '⭐ GRATUIT: ' : ''}${m.name} (${m.context_length} ctx)</option>`
      ).join('');
      
      if (prevVal && models.find(m => m.id === prevVal)) {
        sel.value = prevVal;
      }
      if (vPrevVal && visionModels.find(m => m.id === vPrevVal)) {
        vSel.value = vPrevVal;
      }
      toast(`${models.length} modèles OpenRouter chargés (${visionModels.length} supportent la vision)`, 'ok');
    } catch (e) { toast(e.message, 'err'); } finally {
      $('btn-fetch-openrouter').disabled = false;
      $('btn-fetch-openrouter').textContent = 'Charger la liste API';
    }
  });
}

function _updateApiStatus(cfg) {
  const dot   = $('api-status-dot');
  const label = $('api-status-label');

  const hasLLM    = cfg.openai_key || cfg.gemini_key || cfg.openrouter_key;
  const hasSearch = cfg.serpapi_key || cfg.serper_key || cfg.tavily_key;

  if (hasLLM && hasSearch) {
    dot.className = 'status-dot ok';
    label.textContent = 'Prêt';
  } else if (hasLLM || hasSearch) {
    dot.className = 'status-dot warn';
    label.textContent = 'Partiel';
  } else {
    dot.className = 'status-dot error';
    label.textContent = 'Non configuré';
  }
}

// ── Toast System ───────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el  = document.createElement('div');
  el.className = `toast toast-${type}`;
  
  const icons = { ok:'✓', err:'✗', warn:'⚠', info:'ℹ' };
  
  const closeBtn = document.createElement('span');
  closeBtn.innerHTML = ' ×';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.marginLeft = '12px';
  closeBtn.style.fontWeight = 'bold';
  closeBtn.style.float = 'right';
  closeBtn.onclick = () => {
    el.classList.add('toast-exit');
    setTimeout(() => el.remove(), 250);
  };

  el.innerHTML = `<span style="font-weight:700; margin-right:8px">${icons[type]||'ℹ'}</span> <span>${esc(msg)}</span>`;
  el.appendChild(closeBtn);

  $('toast-container').appendChild(el);
  
  // Do not auto-dismiss errors so the user has time to read them
  if (type !== 'err') {
    setTimeout(() => {
      if (el.parentNode) {
        el.classList.add('toast-exit');
        setTimeout(() => el.remove(), 250);
      }
    }, 4000);
  }
}

// ── Utilities ──────────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _formatDate(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts) * 1000);
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' });
}

// ── Init ───────────────────────────────────────────────────────────────────
function init() {
  // Navigation
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Init all tabs
  initInputTab();
  initDashboardTab();
  initTablesTab();
  initSettingsTab();
  initDrawer();

  // Load initial settings for status indicator
  api.settings.get()
    .then(_updateApiStatus)
    .catch(() => {});

  // Auto-import the mediavision products CSV if it was detected
  // (User can also do this manually from the Tables tab)

  // Check for active background job to recover SSE
  api.get('/api/enrich/active').then(async act => {
    if (act.active) {
      state.jobId = act.jobId;
      
      // Keep them on the Input tab and show the progress UI
      $('btn-enrich').disabled = true;
      $('progress-card').style.display = '';
      $('progress-done').style.display  = 'none';
      $('btn-cancel-job').style.display = 'block';
      $('btn-cancel-job').disabled = false;
      $('btn-cancel-job').textContent = 'Annuler';
      
      try {
        const jobInfo = await api.get(`/api/enrich/status/${act.jobId}`);
        _progressTotal = jobInfo.total;
        _progressDone = jobInfo.completed || 0;
        
        $('progress-list').innerHTML = '';
        state.progressItems = {};
        
        // Fetch all pending products to populate the list
        const pendingProds = await api.products.list('pending');
        pendingProds.forEach(item => {
          state.progressItems[item.reference] = { reference: item.reference, status: 'pending' };
          appendProgressRow(item.reference, 'pending');
        });
        
        $('progress-summary').textContent = `${_progressDone} / ${_progressTotal}`;
        const pct = _progressTotal > 0 ? Math.round((_progressDone / _progressTotal) * 100) : 0;
        $('progress-bar').style.width = pct + '%';
        
        connectSSE(act.jobId, false);
        toast('Reprise de la progression en cours...', 'info');
      } catch(e) {
        // Fallback
        switchTab('dashboard');
        connectSSE(act.jobId, true);
      }
    }
  }).catch(() => {});

  console.log('%c🚀 MediaVision Pipeline Ready', 'color:#6366f1;font-weight:bold;font-size:16px');
}

document.addEventListener('DOMContentLoaded', init);
