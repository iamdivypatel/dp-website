// Render one blog diagram to a PNG with the site's colours, to check it by eye while drawing.
// usage: node scripts/diagram-preview.mjs content/blog/<slug>/diagrams/x.svg  → /private/tmp/diagram-preview/<x>.png
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const file = process.argv[2];
if (!file) throw new Error('usage: node scripts/diagram-preview.mjs path/to/diagram.svg');
const css = readFileSync('src/input.css', 'utf8');
const tokens = css.match(/:root \{[\s\S]*?\n\}/)[0];
const fonts = css.match(/@font-face \{[\s\S]*?\}/g).join('\n').replaceAll('../fonts/', resolve('public/assets/fonts') + '/');
const out = '/private/tmp/diagram-preview';
mkdirSync(out, { recursive: true });
const html = `<!doctype html><meta charset="utf-8"><style>${fonts}${tokens}
:root{--font-sans:"Archivo",system-ui,sans-serif;--font-mono:"JetBrains Mono",monospace}
body{margin:0;background:var(--bg);padding:24px;width:800px}${readFileSync('src/blog/diagram.css', 'utf8')}</style>${readFileSync(file, 'utf8')}`;
const page = `${out}/${basename(file, '.svg')}.html`;
writeFileSync(page, html);
const png = page.replace(/\.html$/, '.png');
execFileSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', `--user-data-dir=${out}/profile-${process.pid}`, '--hide-scrollbars', '--force-device-scale-factor=1.5', '--window-size=848,1100', `--screenshot=${png}`, `file://${page}`], { stdio: 'ignore' });
console.log(png);
