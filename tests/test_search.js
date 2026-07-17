const { initDB, getDB } = require('../src/db');
const { searchProduct } = require('../src/scraper');

initDB();

(async () => {
  const db = getDB();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));
  console.log("Active Provider:", cfg.search_provider);
  console.log("Active Helper Websites:", cfg.helper_websites);

  const reference = "S7520 A";
  const title = "MAXHUB S7520 A";
  const brand = "MAXHUB";
  
  console.log("Running searchProduct...");
  const results = await searchProduct({ reference, title, brand });
  console.log("Search Results:", results.length);
  results.forEach(r => {
    console.log(`URL: ${r.url}`);
    console.log(`Title: ${r.title}`);
    console.log(`Snippet: ${r.snippet}`);
    console.log("---");
  });
})();
