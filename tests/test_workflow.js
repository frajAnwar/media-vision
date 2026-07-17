const { analyzeRawInput, enrichProduct } = require('../src/agent');
const { searchProduct, searchImages } = require('../src/scraper');
const { getDB } = require('../src/db');

async function testWorkflow() {
  console.log('=== STARTING TEST WORKFLOW ===');
  const db = getDB();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));

  const rawText = `
-- EASY (Clear Brand, Ref, and Specs) --
REF: 9S7-158571-042
MSI Katana 15 B13VGK
Intel Core i7-13620H, 16Go RAM, 512Go SSD, RTX 4070 8Go
Ecran 15.6" 144Hz
Prix: 4850.000

-- MEDIUM (Missing Brand, Messy Specs) --
REF: 50A200T01
Téléviseur 50 pouces Smart 4K UHD
Récepteur intégré, Dolby Vision
Garantie 3 ans
Prix: 1250.000

-- HARD (Obscure Reference, Easily Confused with Other Models) --
REF: CT1000P3PSSD8
Disque dur interne SSD 1To M.2 PCIe Gen4 NVMe
Lecture: 5000 Mo/s, Ecriture: 3600 Mo/s
Prix: 230.000

-- EXTREME (No title, just EAN/Barcode and scattered specs) --
REF: 4719072970119
Câble tressé 2 mètres. Supporte 100W PD (Power Delivery).
Connecteurs Type-C vers Type-C. Transfert de données 480Mbps.
Prix: 35.000
  `;

  console.log('\n[1] Running Ingestion Agent on 4 products...');
  let items = await analyzeRawInput(rawText, cfg.llm_provider, cfg[`${cfg.llm_provider}_key`], cfg.llm_model);
  if (items && !Array.isArray(items)) {
      items = items.products || items.items || items.data || [];
  }
  
  if (items.length === 0) {
    console.error('Ingestion failed to return items.');
    return;
  }
  
  for (const item of items) {
    console.log(`\n\n>>> TESTING PRODUCT: ${item.reference} - ${item.title}`);
    console.log('Initial Specs:', JSON.stringify(item.specs));

    console.log('  [+] Running Search (Images)...');
    const images = await searchImages({ reference: item.reference, title: item.title, brand: item.brand });
    console.log(`  Found ${images.length} clean images.`);
    images.forEach((img, i) => console.log(`    - [${i}] ${img}`));

    console.log('  [+] Running Search (Product Info)...');
    const results = await searchProduct({ reference: item.reference, title: item.title, brand: item.brand });
    const urls = results.map(r => r.url).filter(Boolean);
    
    let scrapedContent = '';
    for (const url of urls.slice(0, 2)) {
      try {
        const res = await fetch(`https://r.jina.ai/${url}`, { headers: { 'Accept': 'application/json' }});
        if (res.ok) {
          const data = await res.json();
          scrapedContent += `\n\n--- Source: ${url} ---\n${data.data.content}`;
        }
      } catch(e) {}
    }
    
    console.log(`  Scraped ${scrapedContent.length} bytes of content.`);

    console.log('  [+] Running Enrichment Agent...');
    const refTables = { initial_data: { title: item.title, brand: item.brand, specs: item.specs }, images };
    const enriched = await enrichProduct(item.reference, scrapedContent, refTables);

    console.log('  === ENRICHED RESULT ===');
    console.log('  Title:', enriched.product_title);
    console.log('  Brand:', enriched.brand);
    console.log('  Warning:', enriched.mismatch_warning);
    console.log('  Specs:', JSON.stringify(enriched.extracted_specs));
  }
  
  console.log('\n=== TEST COMPLETE ===');
}

testWorkflow().catch(console.error);
