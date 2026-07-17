const { getDB } = require('../src/db');
const key = getDB().prepare("SELECT value FROM settings WHERE key='gemini_key'").get()?.value;
console.log("KEY IS:", key ? "FOUND" : "NOT FOUND");
fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + key)
  .then(r => r.json())
  .then(d => console.log(d.models ? d.models.map(m => m.name) : d))
  .catch(console.error);
