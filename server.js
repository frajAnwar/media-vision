require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initDB } = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
initDB();

// Security Middlewares
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'", "https://openrouter.ai", "http://localhost:3000"]
    }
  }
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Limit each IP to 500 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

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
