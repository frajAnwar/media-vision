const { initDB, getDB } = require('../src/db');
const { searchImages } = require('../src/scraper');

initDB();

(async () => {
  const db = getDB();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));
  console.log("Active Provider:", cfg.search_provider);

  const reference = "S7520 A";
  const title = "MAXHUB S7520 A";
  const brand = "MAXHUB";
  
  console.log("Running searchImages...");
  const results = await searchImages({ reference, title, brand });
  console.log("Image Results:", results.length);
  results.forEach(r => {
    console.log(`URL: ${r}`);
  });
})();
