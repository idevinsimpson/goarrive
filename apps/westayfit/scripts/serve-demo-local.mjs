// Local-only static server for /demo screenshot capture.
// Mirrors firebase.westayfit.json's `cleanUrls: true` so /demo/squats resolves
// to /demo/squats.html, matching what the deployed hosting channel would serve.
// This file is not shipped with the app and is only used by the Playwright
// screenshot spec.

import http from 'node:http';
import { existsSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 4173);
const ROOT = path.resolve(process.cwd(), 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveFile(urlPath) {
  const clean = urlPath.split('?')[0].split('#')[0];
  const safe = path.normalize(clean).replace(/^\/+/, '');
  const abs = path.join(ROOT, safe);
  if (existsSync(abs) && statSync(abs).isFile()) return abs;
  if (existsSync(abs + '.html') && statSync(abs + '.html').isFile()) return abs + '.html';
  if (existsSync(path.join(abs, 'index.html'))) return path.join(abs, 'index.html');
  return null;
}

const server = http.createServer((req, res) => {
  const filePath = resolveFile(req.url ?? '/');
  if (!filePath) {
    const notFound = path.join(ROOT, '+not-found.html');
    if (existsSync(notFound)) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync(notFound));
      return;
    }
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
  res.end(readFileSync(filePath));
});

server.listen(PORT, () => {
  console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}`);
});
