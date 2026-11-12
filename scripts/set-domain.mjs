// Point every absolute URL on the site at your real address.
// Usage: npm run set-domain -- https://divypatel.in   (then npm run build)
// The site must be served from the root of a domain: pages load /assets/… and use /about-style addresses.
//
// Link previews (LinkedIn, WhatsApp, Slack) and search engines need absolute URLs,
// so the canonical link, Open Graph tags, structured data, robots.txt and the
// sitemap all carry the site's address. Run it again whenever the address changes.
import { readFileSync, writeFileSync } from 'node:fs';

let base;
try {
  const url = new URL(process.argv[2]);
  base = (url.origin + url.pathname).replace(/\/+$/, '');
} catch {
  console.error('Usage: npm run set-domain -- https://your-domain.com');
  process.exit(1);
}

// Group 1 of each pattern is the current base address, whatever it is today.
const files = {
  'public/index.html': [
    /<link rel="canonical" href="([^"]*?)\/">/,
    /<meta property="og:url" content="([^"]*?)\/">/,
    /<meta property="og:image" content="([^"]*?)\/assets\/img\/og-image\.jpg">/,
    /"@type": "WebSite", "name": "Divya Patel", "url": "([^"]*?)\/"/,
    /"@type": "ProfilePage",\s*"url": "([^"]*?)\/"/,
    /"image": "([^"]*?)\/assets\/img\/portrait-coder\.webp"/,
  ],
  'public/robots.txt': [/Sitemap: (\S*?)\/sitemap\.xml/],
  // sitemap.xml and the section pages (/about, /journey…) are rebuilt from index.html by `npm run build`.
};

for (const [file, patterns] of Object.entries(files)) {
  let text = readFileSync(file, 'utf8');
  for (const pattern of patterns) {
    // A /g pattern updates every match (the sitemap lists one URL per page); the others update one.
    const matches = pattern.global ? [...text.matchAll(pattern)] : [text.match(pattern)].filter(Boolean);
    if (!matches.length) {
      console.error(`Could not find ${pattern} in ${file}. Was the markup changed?`);
      process.exit(1);
    }
    for (const match of matches) text = text.replace(match[0], match[0].replace(match[1], base));
  }
  writeFileSync(file, text);
  console.log(`${file}: now uses ${base}/`);
}
console.log('Now run `npm run build` to rebuild the section pages and sitemap.xml.');
