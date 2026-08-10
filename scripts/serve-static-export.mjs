import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] || 'apps/goarrive/dist');
const port = Number(process.env.STATIC_EXPORT_PORT || 4173);

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
    let filePath = resolve(root, `.${pathname}`);

    if (!filePath.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }

    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, 'index.html');
    }

    if (!existsSync(filePath)) {
      const routeIndex = resolve(root, `.${pathname}`, 'index.html');
      filePath = existsSync(routeIndex) ? routeIndex : join(root, 'index.html');
    }

    const contentType = contentTypes[extname(filePath).toLowerCase()] || 'application/octet-stream';
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': contentType,
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
}).listen(port, '0.0.0.0', () => {
  process.stdout.write(`Local preview: http://127.0.0.1:${port}/coach-discovery\n`);
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) {
        process.stdout.write(`Phone preview: http://${address.address}:${port}/coach-discovery\n`);
      }
    }
  }
});
