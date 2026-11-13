// Build one page per section address (/about, /journey… listed in src/js/routes.js).
// Each is a copy of index.html with that section's title and description, so a shared link
// gets its own preview, and main.js scrolls to the section on load. The body is the same
// one-page site, so the canonical stays "/": Google would fold identical copies into it
// anyway. The search pages with their own content are the blog and the pages from
// scripts/blog.mjs. Also writes sitemap.xml (canonical pages only).
// Runs last in `npm run build` (after the CSP step, so the copies carry the right hash).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

const modified = html.match(/"dateModified": "([\d-]+)"/)?.[1];
if (!modified) throw new Error('index.html JSON-LD has no dateModified');
// the blog and standalone pages (scripts/blog.mjs) list themselves in posts.json
const posts = existsSync('public/blog/posts.json') ? JSON.parse(readFileSync('public/blog/posts.json', 'utf8')) : [];
const pages = [{ path: '/', lastmod: modified }, ...posts];
const urls = pages.map((page) => `  <url>\n    <loc>${base}${page.path}</loc>\n    <lastmod>${page.lastmod}</lastmod>\n  </url>`).join('\n');
writeFileSync('public/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
console.log(`Section pages: ${sections.map((r) => r.path).join(' ')} (+ sitemap.xml)`);
