/**
 * Catalog Matcher
 * Fuzzy-matches LLM-suggested category names and brand names
 * against the real data imported from mediavision's database.
 *
 * Data source: mod836_category_lang + mod836_manufacturer exports
 * stored in local SQLite reference_tables.
 */

const { getDB } = require('./db');

// ── In-memory cache ───────────────────────────────────────────────────────
let _categories    = null;
let _manufacturers = null;

function loadCategories() {
  if (_categories) return _categories;
  const db   = getDB();
  const rows = db.prepare(
    "SELECT row_data FROM reference_tables WHERE table_name = 'categories' ORDER BY id"
  ).all();
  _categories = rows.map(r => JSON.parse(r.row_data));
  return _categories;
}

function loadManufacturers() {
  if (_manufacturers) return _manufacturers;
  const db   = getDB();
  const rows = db.prepare(
    "SELECT row_data FROM reference_tables WHERE table_name = 'manufacturers' ORDER BY id"
  ).all();
  _manufacturers = rows.map(r => JSON.parse(r.row_data));
  return _manufacturers;
}

// Invalidate cache when tables are reimported
function invalidateCache() {
  _categories    = null;
  _manufacturers = null;
}

// ── Category matcher ──────────────────────────────────────────────────────
function matchCategory(suggestedName) {
  if (!suggestedName) return null;
  const cats = loadCategories();
  if (!cats.length) return null;

  const needle = normalizeStr(suggestedName);

  // 1. Exact match
  let found = cats.find(c => normalizeStr(c.name) === needle);
  if (found) return parseInt(found.id_category, 10);

  // 2. Contains match (needle inside category name)
  found = cats.find(c => normalizeStr(c.name).includes(needle));
  if (found) return parseInt(found.id_category, 10);

  // 3. Category name contains needle
  found = cats.find(c => needle.includes(normalizeStr(c.name)) && normalizeStr(c.name).length > 4);
  if (found) return parseInt(found.id_category, 10);

  // 4. Word overlap score
  const needleWords = needle.split(/\s+/);
  let best = null, bestScore = 0;

  for (const cat of cats) {
    const catWords = normalizeStr(cat.name).split(/\s+/);
    const overlap  = needleWords.filter(w => catWords.includes(w)).length;
    const score    = overlap / Math.max(needleWords.length, catWords.length);
    if (score > bestScore) { bestScore = score; best = cat; }
  }

  return bestScore >= 0.4 && best ? parseInt(best.id_category, 10) : null;
}

// ── Manufacturer matcher ──────────────────────────────────────────────────
function matchManufacturer(suggestedBrand) {
  if (!suggestedBrand) return null;
  const mfrs = loadManufacturers();
  if (!mfrs.length) return null;

  const needle = normalizeStr(suggestedBrand);

  // Exact
  let found = mfrs.find(m => normalizeStr(m.name) === needle);
  if (found) return parseInt(found.id_manufacturer, 10);

  // Contains
  found = mfrs.find(m => normalizeStr(m.name).includes(needle) || needle.includes(normalizeStr(m.name)));
  if (found) return parseInt(found.id_manufacturer, 10);

  return null;
}

// ── Get full lists for LLM context ───────────────────────────────────────
function getCategoryContext() {
  const cats = loadCategories();
  // Return a compact version for LLM: just id + name + parent
  return cats.map(c => `${c.id_category}:${c.name}(parent:${c.id_parent})`).join('\n');
}

function getManufacturerContext() {
  const mfrs = loadManufacturers();
  return mfrs.map(m => `${m.id_manufacturer}:${m.name}`).join('\n');
}

function normalizeStr(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  matchCategory,
  matchManufacturer,
  getCategoryContext,
  getManufacturerContext,
  invalidateCache,
};
