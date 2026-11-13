// Build the blog from content/blog/<slug>/index.md (see content/blog/README.md):
// public/blog/index.html, public/blog/<slug>.html, public/blog/feed.xml and public/blog/posts.json
// (read by sections.mjs for the sitemap). Diagrams are inlined SVG, code is highlighted here at
// build time, and the pages load only the small blog.js: no Three.js, GSAP or Lenis.
// The header, mobile menu, CSP and Google Tag Manager snippet are copied from index.html, so the
// pages stay in step with the main site. Runs first in `npm run build` (Tailwind scans the output).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import matter from 'gray-matter';
import { Marked } from 'marked';
import { createHighlighter } from 'shiki';

const SRC = 'content/blog';
const OUT = 'public/blog';
const OG_DIR = 'public/assets/img/og';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const site = readFileSync('public/index.html', 'utf8');
const base = site.match(/<link rel="canonical" href="([^"]*?)\/">/)?.[1];
const pick = (re, what) => site.match(re)?.[0] ?? (() => { throw new Error(`index.html: no ${what}`); })();
const csp = pick(/<meta http-equiv="Content-Security-Policy"[^>]*>/, 'CSP meta');
const gtmHead = pick(/  <!-- Google Tag Manager -->[\s\S]*?<!-- End Google Tag Manager -->\n/, 'GTM snippet');
const gtmBody = pick(/  <!-- Google Tag Manager \(noscript\) -->[\s\S]*?<!-- End Google Tag Manager \(noscript\) -->\n/, 'GTM noscript');
const siteHeader = pick(/  <header class="site-header">[\s\S]*?<\/header>\n\n  <div class="menu" id="menu" hidden>[\s\S]*?<\/div>\n/, 'header and menu')
  .replace('aria-label="Divya Patel, back to top"', 'aria-label="Divya Patel, home"');
// on blog pages, "Writing" is the current nav item
const blogHeader = siteHeader.replace(/<a href="\/blog">(<small>\d+<\/small>)?Writing<\/a>/g, (m) => m.replace('<a ', '<a aria-current="page" '));
const sameAs = JSON.parse(site.match(/"sameAs": (\[[^\]]*\])/)?.[1] ?? '[]');

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = (t) => t.toLowerCase().replace(/<[^>]+>/g, '').replace(/&#?\w+;/g, '').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
const isoDate = (d) => new Date(d).toISOString().slice(0, 10);
const longDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const json = (data) => JSON.stringify(data, null, 2).replace(/</g, '\\u003c').split('\n').map((l) => '  ' + l).join('\n');

/* ---------- Posts ---------- */

const folders = existsSync(SRC) ? readdirSync(SRC, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(SRC, d.name, 'index.md'))) : [];
const posts = folders.map(({ name: slug }) => {
  const { data, content } = matter(readFileSync(join(SRC, slug, 'index.md'), 'utf8'));
  for (const key of ['title', 'description', 'date']) if (!data[key]) throw new Error(`${slug}: front matter needs "${key}"`);
  if (data.description.length > 170) console.warn(`! ${slug}: description is ${data.description.length} characters (aim for 155)`);
  return { slug, ...data, tags: data.tags ?? [], updated: data.updated ?? data.date, content, url: `${base}/blog/${slug}` };
}).filter((p) => !p.draft).sort((a, b) => new Date(b.date) - new Date(a.date));

const highlighter = await createHighlighter({
  themes: ['github-dark-default'],
  langs: ['ts', 'js', 'json', 'yaml', 'hcl', 'bash', 'shell', 'nginx', 'python', 'sql', 'lua', 'dockerfile', 'ini', 'toml', 'text'],
});
const loaded = new Set(highlighter.getLoadedLanguages());

function render(post, dir = join(SRC, post.slug)) {
  const toc = [];
  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = slugify(text);
        if (depth === 2 || depth === 3) toc.push({ id, text: text.replace(/<[^>]+>/g, ''), depth });
        if (depth === 1) depth = 2; // the post title is the only h1
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${text}</h${depth}>\n`;
      },
      code({ text, lang }) {
        const language = (lang || 'text').split(/\s/)[0].toLowerCase();
        const known = loaded.has(language) ? language : 'text';
        const html = highlighter.codeToHtml(text, { lang: known, theme: 'github-dark-default' })
          .replace(/ style="background-color:#0d1117;color:#e6edf3"/, '').replace(/ tabindex="0"/, '');
        const label = language === 'text' ? '' : `<span class="code__lang">${esc(language)}</span>`;
        return `<div class="code">${label}${html}</div>\n`;
      },
      image({ href, title, text }) {
        if (/^diagrams\/[\w-]+\.svg$/.test(href)) {
          const svg = readFileSync(join(dir, href), 'utf8').replace(/<\?xml[^>]*>\s*/, '').trim();
          if (/<script|<style|<foreignObject|\son\w+=|style="|href="(?!#)/i.test(svg)) throw new Error(`${post.slug}/${href}: scripts, styles and external links are not allowed in diagrams`);
          if (!/class="diagram"/.test(svg)) throw new Error(`${post.slug}/${href}: the <svg> needs class="diagram"`);
          const caption = title || text;
          return `<figure class="figure">${svg}${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`;
        }
        return `<img src="${esc(href)}" alt="${esc(text)}" loading="lazy">`;
      },
      paragraph({ tokens }) {
        // a paragraph that holds only a diagram becomes the figure itself
        if (tokens.length === 1 && tokens[0].type === 'image') return this.parser.parseInline(tokens) + '\n';
        return `<p>${this.parser.parseInline(tokens)}</p>\n`;
      },
      blockquote({ tokens }) {
        const body = this.parser.parse(tokens);
        const kind = body.match(/^<p><strong>(Note|Tip|Warning|Important):?<\/strong>/i)?.[1]?.toLowerCase();
        return kind ? `<aside class="callout callout--${kind}">${body}</aside>\n` : `<blockquote>${body}</blockquote>\n`;
      },
      table(token) {
        return `<div class="table-wrap" tabindex="0">${this.constructor.prototype.table.call(this, token)}</div>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const external = /^https?:\/\//.test(href) && !href.startsWith(base);
        return `<a href="${esc(href)}"${title ? ` title="${esc(title)}"` : ''}${external ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
      },
    },
  });
  const html = marked.parse(post.content);
  const words = post.content.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length;
  return { html, toc, words, minutes: Math.max(1, Math.round(words / 230)) };
}

/* ---------- Link-preview images (1200×630, rendered with Chrome when the title changes) ---------- */

function ogImage(post) {
  const file = `${OG_DIR}/${post.slug}.png`;
  const stamp = createHash('sha1').update(post.title + post.tags.join()).digest('hex').slice(0, 10);
  const cacheFile = join(SRC, '.og-cache.json');
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  if (existsSync(file) && cache[post.slug] === stamp) return file;
  if (!existsSync(CHROME)) { console.warn(`! ${post.slug}: Chrome not found, link preview falls back to the site image`); return null; }
  mkdirSync(OG_DIR, { recursive: true });
  const tmp = resolve('tools/.og-blog.html');
  writeFileSync(tmp, `<!doctype html><html class="js"><head><meta charset="utf-8"><link rel="stylesheet" href="${resolve('public/assets/css/styles.css')}"><style>
    @font-face{font-family:Archivo;src:url(${resolve('public/assets/fonts/Archivo-normal.woff2')}) format("woff2");font-weight:100 900}
    @font-face{font-family:"JetBrains Mono";src:url(${resolve('public/assets/fonts/JetBrainsMono-normal.woff2')}) format("woff2")}
    html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#0a0a0f}
    .og{position:relative;box-sizing:border-box;height:630px;padding:64px 72px;display:flex;flex-direction:column;justify-content:space-between;font-family:Archivo,sans-serif;color:#f5f6f8;
      background:radial-gradient(60% 80% at 100% 0%,rgb(77 141 255/.28),transparent 70%),radial-gradient(40% 50% at 90% 100%,rgb(124 231 255/.12),transparent 70%);}
    .og::after{content:"";position:absolute;inset:0;background-image:linear-gradient(rgb(255 255 255/.04) 1px,transparent 1px),linear-gradient(90deg,rgb(255 255 255/.04) 1px,transparent 1px);background-size:48px 48px;
      -webkit-mask-image:radial-gradient(70% 90% at 80% 20%,#000,transparent);}
    .top{display:flex;gap:12px;font-family:"JetBrains Mono",monospace;font-size:22px;color:#7ce7ff}
    .top span{border:1px solid rgb(124 231 255/.35);border-radius:999px;padding:6px 16px}
    h1{margin:0;font-size:${post.title.length > 70 ? 58 : 66}px;line-height:1.04;letter-spacing:-.03em;font-weight:800;max-width:1000px}
    .by{display:flex;align-items:center;gap:18px;font-size:26px;color:#9aa3b2}.by b{color:#f5f6f8}
    .mark{display:grid;place-items:center;width:56px;height:56px;border-radius:14px;background:#4d8dff;color:#05060a;font-weight:800;font-size:24px}
  </style></head><body><div class="og"><div class="top">${post.tags.slice(0, 3).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
  <h1>${esc(post.title)}</h1><div class="by"><span class="mark">DP</span><span><b>Divya Patel</b> · Backend &amp; Cloud Engineer · divypatel.in</span></div></div></body></html>`);
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${resolve('tools/.chrome-og')}`, '--window-size=1200,630', `--screenshot=${resolve(file)}`, `file://${tmp}`], { stdio: 'ignore' });
  rmSync(tmp);
  cache[post.slug] = stamp;
  writeFileSync(cacheFile, JSON.stringify(cache, null, 2) + '\n');
  return file;
}

/* ---------- Page shell ---------- */

const person = { '@id': `${base}/#person` };
function page({ title, description, path, type = 'website', image, extraHead = '', schema, body, blog = true }) {
  const url = `${base}${path}`;
  const img = image ? `${base}/${image.replace(/^public\//, '')}` : `${base}/assets/img/og-image.jpg`;
  return `<!doctype html>
<!-- Built by scripts/blog.mjs from content/blog. Edit the Markdown, not this file. -->
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  ${csp}
${gtmHead}  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  <meta name="author" content="Divya Patel">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <meta name="theme-color" content="#08090b">
  <meta name="color-scheme" content="dark">
  <link rel="canonical" href="${url}">
  <link rel="alternate" type="application/rss+xml" title="Divya Patel – Writing" href="${base}/blog/feed.xml">
  <meta property="og:type" content="${type}">
  <meta property="og:url" content="${url}">
  <meta property="og:site_name" content="Divya Patel">
  <meta property="og:locale" content="en_IN">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${img}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
${extraHead}  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="preload" href="/assets/fonts/Archivo-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/css/styles.css">
  <script type="application/ld+json">
${json({ '@context': 'https://schema.org', '@graph': schema })}
  </script>
  <script type="module" src="/assets/js/blog.js"></script>
</head>
<body class="blog-page">
${gtmBody}  <a class="skip-link" href="#main">Skip to content</a>

${blog ? blogHeader : siteHeader}
  <main id="main">
${body}
  </main>

  <footer class="footer blog-footer">
    <div class="container">
      <div class="footer__links">
        <a href="/">Portfolio</a>
        <a href="/blog">Writing</a>
        <a href="/contact">Contact</a>
        <a href="https://www.linkedin.com/in/divyapatel5113" target="_blank" rel="me noopener">LinkedIn</a>
        <a href="#main" class="footer__top">Back to top ↑</a>
      </div>
    </div>
    <p class="container footer__fine">© ${new Date().getFullYear()} Divya Patel. Writing on backend, cloud infrastructure and system design.</p>
  </footer>
</body>
</html>
`;
}

const tagList = (tags) => `<ul class="tags" aria-label="Topics">${tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
const crumbs = (items) => ({
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
});

/* ---------- Write ---------- */

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const built = posts.map((post) => ({ ...post, ...render(post), image: ogImage(post) }));

for (const post of built) {
  const others = built.filter((p) => p !== post).slice(0, 3);
  const tocHtml = post.toc.filter((t) => t.depth === 2).map((t) => `<li><a href="#${t.id}">${t.text}</a></li>`).join('');
  const body = `    <article class="post" itemscope>
      <header class="post__head container">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Divya Patel</a><span aria-hidden="true">/</span><a href="/blog">Writing</a></nav>
        ${tagList(post.tags)}
        <h1 class="post__title">${esc(post.title)}</h1>
        <p class="post__dek">${esc(post.description)}</p>
        <p class="post__meta"><span>By <a href="/about" rel="author">Divya Patel</a></span><span><time datetime="${isoDate(post.date)}">${longDate(post.date)}</time></span><span>${post.minutes} min read</span>${isoDate(post.updated) !== isoDate(post.date) ? `<span>Updated <time datetime="${isoDate(post.updated)}">${longDate(post.updated)}</time></span>` : ''}</p>
      </header>
      <div class="post__layout container">
        <aside class="toc" aria-label="On this page">
          <details open><summary>On this page</summary><ol>${tocHtml}</ol></details>
        </aside>
        <div class="prose">
${post.html}
        </div>
      </div>
      <footer class="post__foot container">
        <div class="author">
          <span class="brand__mark" aria-hidden="true">DP</span>
          <div>
            <p class="author__name">Divya Patel</p>
            <p class="author__bio">Backend &amp; Cloud Engineer in Ahmedabad, India. I design AWS infrastructure with Terraform and build the serverless services that run on it. Open to remote roles and contract work.</p>
          </div>
          <a class="btn btn--accent btn--sm" href="/contact">Work with me</a>
        </div>
        ${others.length ? `<h2 class="more__title">More writing</h2><ul class="post-list post-list--compact">${others.map(card).join('')}</ul>` : ''}
      </footer>
    </article>`;
  const schema = [
    {
      '@type': 'BlogPosting', '@id': `${post.url}#article`, headline: post.title, description: post.description,
      datePublished: isoDate(post.date), dateModified: isoDate(post.updated), url: post.url, mainEntityOfPage: post.url,
      image: post.image ? `${base}/${post.image.replace(/^public\//, '')}` : `${base}/assets/img/og-image.jpg`,
      keywords: post.tags.join(', '), wordCount: post.words, inLanguage: 'en',
      author: { ...person, '@type': 'Person', name: 'Divya Patel', url: `${base}/` },
      publisher: { ...person, '@type': 'Person', name: 'Divya Patel' },
      isPartOf: { '@id': `${base}/blog#blog` },
    },
    crumbs([['Divya Patel', `${base}/`], ['Writing', `${base}/blog`], [post.title, post.url]]),
  ];
  const extraHead = `  <meta property="article:published_time" content="${isoDate(post.date)}">\n  <meta property="article:modified_time" content="${isoDate(post.updated)}">\n  <meta property="article:author" content="${base}/">\n${post.tags.map((t) => `  <meta property="article:tag" content="${esc(t)}">\n`).join('')}`;
  writeFileSync(`${OUT}/${post.slug}.html`, page({ title: `${post.title} – Divya Patel`, description: post.description, path: `/blog/${post.slug}`, type: 'article', image: post.image, extraHead, schema, body }));
}

function card(post) {
  return `<li class="post-card"><a href="/blog/${post.slug}">
    <span class="post-card__meta"><time datetime="${isoDate(post.date)}">${longDate(post.date)}</time> · ${post.minutes} min read</span>
    <span class="post-card__title">${esc(post.title)}</span>
    <span class="post-card__desc">${esc(post.description)}</span>
    <span class="post-card__tags">${post.tags.slice(0, 3).map(esc).join(' · ')}</span>
  </a></li>`;
}

const indexDescription = 'Writing by Divya Patel, Backend & Cloud Engineer: practical guides on system design, AWS, Terraform, caching with Redis, CI/CD and self-hosted LLM infrastructure, with diagrams.';
writeFileSync(`${OUT}/index.html`, page({
  title: 'Writing – Divya Patel, Backend & Cloud Engineer',
  description: indexDescription,
  path: '/blog',
  schema: [
    { '@type': 'Blog', '@id': `${base}/blog#blog`, name: 'Divya Patel – Writing', url: `${base}/blog`, description: indexDescription, inLanguage: 'en', author: person, publisher: person,
      blogPost: built.map((p) => ({ '@id': `${p.url}#article` })) },
    { '@type': 'Person', ...person, name: 'Divya Patel', url: `${base}/`, jobTitle: 'Backend & Cloud Engineer', sameAs },
    crumbs([['Divya Patel', `${base}/`], ['Writing', `${base}/blog`]]),
  ],
  body: `    <section class="blog-index container">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Divya Patel</a><span aria-hidden="true">/</span><span>Writing</span></nav>
      <h1 class="post__title">Writing on backend, cloud and <span class="serif">system design.</span></h1>
      <p class="post__dek">Practical guides for developers and the people who hire them: how to design, deploy and pay for production systems on AWS, drawn as diagrams first and code second.</p>
      <ul class="post-list">${built.map(card).join('')}</ul>
      <p class="blog-index__rss">Follow along with the <a href="/blog/feed.xml">RSS feed</a>.</p>
    </section>`,
}));

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Divya Patel – Writing</title>
    <link>${base}/blog</link>
    <description>${esc(indexDescription)}</description>
    <language>en</language>
    <atom:link href="${base}/blog/feed.xml" rel="self" type="application/rss+xml"/>
${built.map((p) => `    <item>
      <title>${esc(p.title)}</title>
      <link>${p.url}</link>
      <guid>${p.url}</guid>
      <pubDate>${new Date(p.date).toUTCString()}</pubDate>
      <description>${esc(p.description)}</description>
${p.tags.map((t) => `      <category>${esc(t)}</category>`).join('\n')}
    </item>`).join('\n')}
  </channel>
</rss>
`;
writeFileSync(`${OUT}/feed.xml`, rss);
/* ---------- Standalone pages: content/pages/<slug>.md → /<slug> (e.g. the Ahmedabad page) ---------- */

const PAGES = 'content/pages';
const standalone = (existsSync(PAGES) ? readdirSync(PAGES).filter((f) => f.endsWith('.md')) : []).map((file) => {
  const slug = file.replace(/\.md$/, '');
  const { data, content } = matter(readFileSync(join(PAGES, file), 'utf8'));
  for (const key of ['title', 'h1', 'description', 'updated']) if (!data[key]) throw new Error(`pages/${file}: front matter needs "${key}"`);
  const page_ = { slug, ...data, content, url: `${base}/${slug}` };
  return { ...page_, ...render(page_, join(PAGES, slug)) };
});
for (const p of standalone) {
  const tocHtml = p.toc.filter((t) => t.depth === 2).map((t) => `<li><a href="#${t.id}">${t.text}</a></li>`).join('');
  const body = `    <article class="post">
      <header class="post__head container">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Divya Patel</a><span aria-hidden="true">/</span><span>${esc(p.crumb ?? p.h1)}</span></nav>
        <h1 class="post__title">${esc(p.h1)}</h1>
        <p class="post__dek">${esc(p.dek ?? p.description)}</p>
        <p class="post__cta"><a class="btn btn--accent" href="/contact">Get in touch</a><a class="btn btn--ghost" href="/assets/cv/Divya-Patel-CV-India.pdf" download="Divya-Patel-CV.pdf">Download CV</a></p>
      </header>
      <div class="post__layout container">
        <aside class="toc" aria-label="On this page">
          <details open><summary>On this page</summary><ol>${tocHtml}</ol></details>
        </aside>
        <div class="prose">
${p.html}
        </div>
      </div>
      <footer class="post__foot container">
        <div class="author">
          <span class="brand__mark" aria-hidden="true">DP</span>
          <div>
            <p class="author__name">Divya Patel</p>
            <p class="author__bio">Backend &amp; Cloud Engineer in Ahmedabad, India. Open to remote roles and contract work.</p>
          </div>
          <a class="btn btn--accent btn--sm" href="/contact">Work with me</a>
        </div>
        ${built.length ? `<h2 class="more__title">Writing</h2><ul class="post-list post-list--compact">${built.slice(0, 3).map(card).join('')}</ul>` : ''}
      </footer>
    </article>`;
  const schema = [
    { '@type': 'WebPage', '@id': `${p.url}#page`, url: p.url, name: p.title, description: p.description, dateModified: isoDate(p.updated), inLanguage: 'en', about: person, isPartOf: { '@id': `${base}/#website` } },
    crumbs([['Divya Patel', `${base}/`], [p.crumb ?? p.h1, p.url]]),
  ];
  writeFileSync(`public/${p.slug}.html`, page({ title: p.title, description: p.description, path: `/${p.slug}`, schema, body, blog: false }).replace('<!-- Built by scripts/blog.mjs from content/blog.', `<!-- Built by scripts/blog.mjs from content/pages/${p.slug}.md.`));
}

// every page this script makes, for the sitemap (scripts/sections.mjs)
const listed = [
  ...standalone.map((p) => ({ path: `/${p.slug}`, title: p.h1, lastmod: isoDate(p.updated) })),
  ...(built.length ? [{ path: '/blog', title: 'Writing', lastmod: built.map((p) => isoDate(p.updated)).sort().at(-1) }] : []),
  ...built.map((p) => ({ path: `/blog/${p.slug}`, title: p.title, lastmod: isoDate(p.updated) })),
];
writeFileSync(`${OUT}/posts.json`, JSON.stringify(listed, null, 2) + '\n');
console.log(`Pages: ${standalone.map((p) => '/' + p.slug).join(' ') || 'none'}. Blog: ${built.length} post(s)${built.length ? ': ' + built.map((p) => `${p.slug} (${p.words} words)`).join(', ') : ''}`);
