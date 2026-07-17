const { initDB, getDB } = require('../src/db');
initDB();

async function _serperImages(query, apiKey) {
  const res = await fetch('https://google.serper.dev/images', {
    method:  'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ q: query, num: 10 }),
    signal:  AbortSignal.timeout(15000),
  });
  const data = await res.json();
  console.log("Raw Response from Serper:", JSON.stringify(data, null, 2).slice(0, 500));
  if (!data.images) return [];
  return data.images.slice(0, 15).map(r => r.imageUrl).filter(Boolean);
}

(async () => {
  const db = getDB();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const key = cfg.serper_key;

  const q1 = "MAXHUB S7520 A";
  console.log("Query:", q1);
  await _serperImages(q1, key);
})();
