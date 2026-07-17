/**
 * PrestaShop Webservice API Client
 * Uses the official PS REST API to create products across ALL related tables.
 * Auth: HTTP Basic with API key as username, empty password.
 * Prefix: mod836_ (handled transparently by PS — we don't specify it in API calls)
 */

const { getDB }  = require('./db');
const { matchCategory, matchManufacturer } = require('./catalog');

const PS_API_PATH = '/api';

// ── Get PS connection config from settings ────────────────────────────────
function getPSConfig() {
  const db   = getDB();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const cfg  = Object.fromEntries(rows.map(r => [r.key, r.value]));

  return {
    baseUrl: (cfg.ps_url || 'https://www.mediavision.tn').replace(/\/$/, ''),
    apiKey:  cfg.ps_api_key || '',
  };
}

// ── Low-level fetch helper ────────────────────────────────────────────────
async function psRequest(method, endpoint, body = null, isImage = false) {
  const { baseUrl, apiKey } = getPSConfig();

  if (!apiKey) throw new Error('Clé API PrestaShop non configurée dans les Paramètres.');

  const url      = `${baseUrl}${PS_API_PATH}${endpoint}`;
  const authB64  = Buffer.from(`${apiKey}:`).toString('base64');

  const opts = {
    method,
    headers: { 'Authorization': `Basic ${authB64}` },
    signal: AbortSignal.timeout(30000),
  };

  if (body && !isImage) {
    opts.headers['Content-Type'] = 'application/xml';
    opts.body = body;
  } else if (body && isImage) {
    // body is a FormData for image upload
    opts.body = body;
  }

  const res = await fetch(url, opts);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PS API ${method} ${endpoint} → ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.text();
}

// ── Test connection ───────────────────────────────────────────────────────
async function testConnection() {
  try {
    const xml = await psRequest('GET', '/');
    return { ok: true, message: 'Connexion PrestaShop réussie ✓' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// ── Get blank product schema from PS (to know all writable fields) ────────
async function getProductSchema() {
  const xml = await psRequest('GET', '/products?schema=blank');
  return xml;
}

// ── Build product XML ─────────────────────────────────────────────────────
function buildProductXML(product, categoryId, manufacturerId) {
  const name        = xmlEsc(product.product_title || product.reference);
  const ref         = xmlEsc(product.reference);
  const price       = (product.raw_price || 0).toFixed(6);
  const desc        = product.html_description || '';
  const descShort   = product.seo_excerpt      || '';
  const metaTitle   = name.slice(0, 128);
  const metaDesc    = xmlEsc((product.seo_excerpt || name).slice(0, 512));
  const slug        = slugify(product.product_title || product.reference);

  return `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <product>
    <id_manufacturer>${manufacturerId || 0}</id_manufacturer>
    <id_category_default>${categoryId || 2}</id_category_default>
    <id_shop_default>1</id_shop_default>
    <id_tax_rules_group>0</id_tax_rules_group>
    <reference>${ref}</reference>
    <price>${price}</price>
    <wholesale_price>0.000000</wholesale_price>
    <ecotax>0.000000</ecotax>
    <minimal_quantity>1</minimal_quantity>
    <low_stock_threshold>0</low_stock_threshold>
    <low_stock_alert>0</low_stock_alert>
    <weight>0.000000</weight>
    <width>0.000000</width>
    <height>0.000000</height>
    <depth>0.000000</depth>
    <out_of_stock>2</out_of_stock>
    <quantity_discount>0</quantity_discount>
    <on_sale>0</on_sale>
    <online_only>0</online_only>
    <active>1</active>
    <available_for_order>1</available_for_order>
    <show_price>1</show_price>
    <show_condition>1</show_condition>
    <condition>new</condition>
    <visibility>both</visibility>
    <redirect_type>default</redirect_type>
    <id_type_redirected>0</id_type_redirected>
    <available_date>0000-00-00</available_date>
    <advanced_stock_management>0</advanced_stock_management>
    <pack_stock_type>3</pack_stock_type>
    <state>1</state>
    <product_type>standard</product_type>
    <additional_delivery_times>1</additional_delivery_times>
    <customizable>0</customizable>
    <uploadable_files>0</uploadable_files>
    <text_fields>0</text_fields>
    <name>
      <language id="1"><![CDATA[${name}]]></language>
    </name>
    <description>
      <language id="1"><![CDATA[${desc}]]></language>
    </description>
    <description_short>
      <language id="1"><![CDATA[${xmlEsc(descShort)}]]></language>
    </description_short>
    <meta_title>
      <language id="1"><![CDATA[${metaTitle}]]></language>
    </meta_title>
    <meta_description>
      <language id="1"><![CDATA[${metaDesc}]]></language>
    </meta_description>
    <meta_keywords>
      <language id="1"><![CDATA[]]></language>
    </meta_keywords>
    <link_rewrite>
      <language id="1"><![CDATA[${slug}]]></language>
    </link_rewrite>
    <available_now>
      <language id="1"><![CDATA[En Stock]]></language>
    </available_now>
    <available_later>
      <language id="1"><![CDATA[]]></language>
    </available_later>
    <delivery_in_stock>
      <language id="1"><![CDATA[]]></language>
    </delivery_in_stock>
    <delivery_out_stock>
      <language id="1"><![CDATA[]]></language>
    </delivery_out_stock>
    <associations>
      <categories>
        <category><id>${categoryId || 2}</id></category>
      </categories>
    </associations>
  </product>
</prestashop>`;
}

// ── Create a product via PS API ───────────────────────────────────────────
async function createProduct(product) {
  // 1. Resolve category ID
  const categoryId     = product.resolved_category_id
    || matchCategory(product.suggested_category);

  // 2. Resolve manufacturer ID
  const manufacturerId = product.resolved_manufacturer_id
    || matchManufacturer(product.brand);

  // 3. POST product XML
  const xml       = buildProductXML(product, categoryId, manufacturerId);
  const resultXml = await psRequest('POST', '/products', xml);

  // 4. Extract new product ID from response
  const idMatch = resultXml.match(/<id>(\d+)<\/id>/);
  if (!idMatch) throw new Error('Impossible d\'extraire l\'ID du produit créé');

  const newProductId = parseInt(idMatch[1], 10);

  // 5. Upload cover image if available
  let imageUploaded = false;
  const imageUrl = product.selected_image
    || (product.high_res_images && product.high_res_images[0]);

  if (imageUrl) {
    try {
      await uploadProductImage(newProductId, imageUrl);
      imageUploaded = true;
    } catch (e) {
      console.warn(`[ps-api] Image upload failed for product ${newProductId}:`, e.message);
    }
  }

  // 6. Set stock quantity
  try {
    await setStock(newProductId, 10);
  } catch (e) {
    console.warn(`[ps-api] Stock update failed for product ${newProductId}:`, e.message);
  }

  return { newProductId, categoryId, manufacturerId, imageUploaded };
}

// ── Upload product image ──────────────────────────────────────────────────
async function uploadProductImage(productId, imageUrl) {
  const { baseUrl, apiKey } = getPSConfig();

  // Download the image first
  const imgRes = await fetch(imageUrl, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'MediaVisionBot/1.0' },
  });

  if (!imgRes.ok) throw new Error(`Cannot download image: ${imgRes.status}`);

  const buffer  = Buffer.from(await imgRes.arrayBuffer());
  const ext     = (imageUrl.match(/\.(jpg|jpeg|png|webp)$/i) || ['', 'jpg'])[1].toLowerCase();
  const mime    = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

  // Build multipart form
  const boundary = `----MediaVisionBoundary${Date.now()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="product.${ext}"\r\nContent-Type: ${mime}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const authB64 = Buffer.from(`${apiKey}:`).toString('base64');
  const res = await fetch(
    `${baseUrl}${PS_API_PATH}/images/products/${productId}`,
    {
      method:  'POST',
      headers: {
        'Authorization':  `Basic ${authB64}`,
        'Content-Type':   `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      body,
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Image upload ${res.status}: ${text.slice(0, 200)}`);
  }

  return true;
}

// ── Set stock for a product ───────────────────────────────────────────────
async function setStock(productId, quantity = 10) {
  // Get current stock entry ID
  const xml = await psRequest('GET', `/stock_availables?filter[id_product]=${productId}&filter[id_product_attribute]=0`);
  const idMatch = xml.match(/id="(\d+)"/);
  if (!idMatch) return;

  const stockId = idMatch[1];

  const stockXml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop xmlns:xlink="http://www.w3.org/1999/xlink">
  <stock_available>
    <id>${stockId}</id>
    <id_product>${productId}</id_product>
    <id_product_attribute>0</id_product_attribute>
    <id_shop>1</id_shop>
    <id_shop_group>0</id_shop_group>
    <quantity>${quantity}</quantity>
    <depends_on_stock>0</depends_on_stock>
    <out_of_stock>2</out_of_stock>
  </stock_available>
</prestashop>`;

  await psRequest('PUT', `/stock_availables/${stockId}`, stockXml);
}

// ── Helpers ───────────────────────────────────────────────────────────────
function xmlEsc(str) {
  return String(str || '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&apos;');
}

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 128);
}

module.exports = { testConnection, createProduct, getProductSchema, getPSConfig };
