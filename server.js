const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDB } = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
initDB();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/ingest',   require('./src/routes/ingest'));
app.use('/api/enrich',   require('./src/routes/enrich'));
app.use('/api/products', require('./src/routes/products'));
app.use('/api/products', require('./src/routes/vision'));
app.use('/api/export',   require('./src/routes/export'));
app.use('/api/settings', require('./src/routes/settings'));
app.use('/api/tables',   require('./src/routes/tables'));
app.use('/api/openrouter', require('./src/routes/openrouter'));
app.use('/api/ps',       require('./src/routes/push'));

// Serve SPA for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   MediaVision AI Enrichment Pipeline      ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║   🚀  http://localhost:${PORT}              ║`);
  console.log('╚══════════════════════════════════════════╝\n');
});
