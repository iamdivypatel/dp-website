// Keep the Content-Security-Policy in sync with the inline scripts in every page.
// Runs as part of `npm run build`, so editing an inline script never breaks a page.
// It writes the hashes into each page's <meta> policy, public/_headers and vercel.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const pages = ['public/index.html']; // the section pages are copies of it (scripts/sections.mjs)
const hashes = new Set();
for (const page of pages) {
  const scripts = [...readFileSync(page, 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (!scripts.length) throw new Error(`No inline <script> found in ${page}`);
  for (const [, code] of scripts) hashes.add(`'sha256-${createHash('sha256').update(code).digest('base64')}'`);
}
const value = [...hashes].join(' ');

for (const file of [...pages, 'public/_headers', 'vercel.json']) {
  const text = readFileSync(file, 'utf8');
  const next = text.replace(/'sha256-[^']*'(?: 'sha256-[^']*')*/g, value);
  if (next !== text) writeFileSync(file, next);
}
console.log(`CSP script hashes: ${value}`);
