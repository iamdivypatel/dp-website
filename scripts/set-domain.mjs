// Point every absolute URL on the site at your real address.
// Usage: npm run set-domain -- https://divyapatel.dev
//        npm run set-domain -- https://USERNAME.github.io/REPO   (GitHub Pages project site)
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
  'public/sitemap.xml': [/<loc>([^<]*?)\/<\/loc>/],
};

for (const [file, patterns] of Object.entries(files)) {
  let text = readFileSync(file, 'utf8');
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      console.error(`Could not find ${pattern} in ${file}. Was the markup changed?`);
      process.exit(1);
    }
    text = text.replace(match[0], match[0].replace(match[1], base));
  }
  writeFileSync(file, text);
  console.log(`${file}: now uses ${base}/`);
}
