// Local dev server — sirve index.html + /api/terrain
require('dotenv').config({ path: '.env.local' });

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT = 3000;

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);

  // ── API route ──
  if (parsed.pathname === '/api/terrain') {
    // Simulate Vercel's req/res interface
    req.query = parsed.query;
    const apiHandler = require('./api/terrain');
    // Wrap res with minimal Vercel-compatible helpers
    res.status = (code) => { res.statusCode = code; return res; };
    res.json   = (data) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };
    res.end = res.end.bind(res);
    try {
      await apiHandler(req, res);
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Static: index.html ──
  if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.statusCode = 404; res.end('Not found'); return; }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(data);
    });
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  Calificador de Terrenos corriendo en:`);
  console.log(`  http://localhost:${PORT}\n`);
});
