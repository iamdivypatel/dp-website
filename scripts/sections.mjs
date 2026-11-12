// Build one page per section address (/about, /journey… listed in src/js/routes.js).
// Each is a copy of index.html with that section's title, description and canonical URL:
// the same one-page site, so search results and shared links get their own title, and
// main.js scrolls to the section on load. Also writes sitemap.xml.
// Runs last in `npm run build` (after the CSP step, so the copies carry the right hash).
import { readFileSync, writeFileSync } from 'node:fs';
import { routes } from '../src/js/routes.js';

const html = readFileSync('public/index.html', 'utf8');
const base = html.match(/<link rel="canonical" href="([^"]*?)\/">/)?.[1];
if (!base) throw new Error('index.html has no canonical link');
const esc = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const [home, ...sections] = routes;
if (!html.includes(`<title>${esc(home.title)}</title>`)) throw new Error('The <title> in index.html must match the "/" route in routes.js');

for (const route of sections) {
  if (!html.includes(`id="${route.id}"`)) throw new Error(`index.html has no section with id="${route.id}" for ${route.path}`);
  const url = base + route.path;
  const heads = [
    [/<title>[^<]*<\/title>/, `<title>${esc(route.title)}</title>`],
    [/(<meta name="description" content=")[^"]*/, `$1${esc(route.description)}`],
    [/(<link rel="canonical" href=")[^"]*/, `$1${url}`],
    [/(<meta property="og:url" content=")[^"]*/, `$1${url}`],
    [/(<meta property="og:title" content=")[^"]*/, `$1${esc(route.title)}`],
    [/(<meta property="og:description" content=")[^"]*/, `$1${esc(route.description)}`],
    [/<!doctype html>\n/, `<!doctype html>\n<!-- Built from index.html by scripts/sections.mjs. Edit index.html, not this file. -->\n`],
  ];
  let page = html;
  for (const [pattern, replacement] of heads) {
    if (!pattern.test(page)) throw new Error(`index.html: could not find ${pattern}`);
    page = page.replace(pattern, replacement);
  }
  writeFileSync(`public${route.path}.html`, page);
}

const urls = routes.map((route) => `  <url>\n    <loc>${base}${route.path}</loc>\n  </url>`).join('\n');
writeFileSync('public/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
console.log(`Section pages: ${sections.map((r) => r.path).join(' ')} (+ sitemap.xml)`);
