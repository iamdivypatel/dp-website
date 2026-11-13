// Local preview with the live site's clean addresses: /about serves about.html, like Vercel.
// Usage: npm run serve   (http://localhost:5173; set PORT to change it)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = 'public';
const port = Number(process.env.PORT) || 5173;
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.pdf': 'application/pdf',
};

createServer(async (req, res) => {
  // normalize() on an absolute path can't climb above it, so requests stay inside public/.
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  for (const file of path.endsWith('/') ? [join(path, 'index.html')] : [path, `${path}.html`, join(path, 'index.html')]) {
    try {
      const body = await readFile(join(root, file));
      res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
      return res.end(body);
    } catch {}
  }
  res.writeHead(404, { 'Content-Type': types['.html'] });
  res.end(await readFile(join(root, '404.html')).catch(() => 'Not found'));
}).listen(port, () => console.log(`Serving public/ at http://localhost:${port}`));
