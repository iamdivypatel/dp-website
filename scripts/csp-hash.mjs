// Keep the Content-Security-Policy in sync with the one inline script in index.html.
// Runs as part of `npm run build`, so editing that script never breaks the page.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const page = 'public/index.html';
const html = readFileSync(page, 'utf8');
const inline = html.match(/<script>([\s\S]*?)<\/script>/);
if (!inline) throw new Error('No inline <script> found in index.html');
const hash = `'sha256-${createHash('sha256').update(inline[1]).digest('base64')}'`;

for (const file of [page, 'public/_headers']) {
  const text = readFileSync(file, 'utf8');
  const next = text.replace(/'sha256-[^']*'/g, hash);
  if (next !== text) writeFileSync(file, next);
}
console.log(`CSP script hash: ${hash}`);
