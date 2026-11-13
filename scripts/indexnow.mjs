// Tell Bing (and through it ChatGPT search, DuckDuckGo, Yandex…) about new or changed pages via IndexNow.
// Run after a deploy has finished:  npm run indexnow -- /blog/new-post /   (paths), or with no paths to send the whole sitemap.
// Send only pages that actually changed; resending everything every time can get the key ignored.
import { readFileSync } from 'node:fs';

const KEY = '8e09c09d5466ffb2a2930562e40cab49'; // also served at /<key>.txt (public/8e09c09d5466ffb2a2930562e40cab49.txt)
const html = readFileSync('public/index.html', 'utf8');
const base = html.match(/<link rel="canonical" href="([^"]*?)\/">/)?.[1];
const paths = process.argv.slice(2);
const urls = paths.length
  ? paths.map((p) => base + (p.startsWith('/') ? p : '/' + p))
  : [...readFileSync('public/sitemap.xml', 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: new URL(base).host, key: KEY, keyLocation: `${base}/${KEY}.txt`, urlList: urls }),
});
console.log(`IndexNow: ${res.status} ${res.statusText} for ${urls.length} URL(s)`);
if (res.status >= 400) { console.log(await res.text()); process.exit(1); }
