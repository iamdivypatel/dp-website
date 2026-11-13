// Give a blog diagram depth at build time, so the SVG sources stay flat and simple to draw:
// - every box (.d-box) becomes a raised tile: a soft shadow, a coloured side below it and a sheen on top;
// - chart bars (.d-fill-*) become blocks with a lit top face and a darker right face;
// - chart lines (.d-line) get a faint offset shadow;
// - a box with data-logo="<name>" gets that tool's logo (public/assets/logos/<name>.svg) on its corner.
// The colours live in src/blog/diagram.css (.d3-*). Everything stays inline SVG: crisp, small, no scripts.
import { existsSync } from 'node:fs';

const DEPTH = 8;      // how far a box's side shows below it
const BAR = 7;        // depth of a chart bar's top and side faces
const LOGO = 26;      // logo badge size

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
const num = (a, k) => Number.parseFloat(a[k] ?? '0');
const fmt = (n) => Math.round(n * 100) / 100;

export function dimensionalize(svg, name) {
  const id = svg.match(/<title id="([\w-]+)-t"/)?.[1] ?? name;
  let extraBottom = 0;
  const logos = new Set();

  // boxes
  svg = svg.replace(/<rect\b[^>]*class="d-box([^"]*)"[^>]*\/>/g, (tag, variant) => {
    const a = attrs(tag);
    const [x, y, w, h, rx] = ['x', 'y', 'width', 'height', 'rx'].map((k) => num(a, k));
    const tone = (variant.match(/d-(accent|cyan|warn|ok)/) ?? [])[1] ?? 'plain';
    const r = `rx="${rx}"`;
    extraBottom = Math.max(extraBottom, y + h + DEPTH + 10);
    let badge = '';
    if (a['data-logo']) {
      const logo = a['data-logo'];
      if (!existsSync(`public/assets/logos/${logo}.svg`)) throw new Error(`${name}: no logo public/assets/logos/${logo}.svg`);
      logos.add(logo);
      const bx = fmt(Math.max(2, x - LOGO / 2 + 4)), by = fmt(Math.max(2, y - LOGO / 2 + 2));
      badge = `<rect class="d3-badge-ring" x="${fmt(bx - 2)}" y="${fmt(by - 2)}" width="${LOGO + 4}" height="${LOGO + 4}" rx="9"/>`
        + `<image href="/assets/logos/${logo}.svg" x="${bx}" y="${by}" width="${LOGO}" height="${LOGO}" clip-path="url(#${id}-d3clip)" preserveAspectRatio="xMidYMid slice"/>`;
    }
    const clean = tag.replace(/\sdata-logo="[^"]*"/, '');
    return `<g class="d3-tile">`
      + `<rect class="d3-shadow" x="${fmt(x + 4)}" y="${fmt(y + DEPTH + 6)}" width="${w}" height="${h}" ${r} filter="url(#${id}-d3blur)"/>`
      + `<rect class="d3-side d3-${tone}" x="${x}" y="${fmt(y + DEPTH)}" width="${w}" height="${h}" ${r}/>`
      + `<rect class="d3-base" x="${x}" y="${y}" width="${w}" height="${h}" ${r}/>`
      + clean
      + `<rect class="d3-sheen" x="${x}" y="${y}" width="${w}" height="${fmt(h * 0.55)}" ${r} fill="url(#${id}-d3sheen)"/>`
      + `</g>${badge ? `<!--badge:${badge}-->` : ''}`;
  });

  // chart bars: skip legend swatches (small) and shaded regions (they carry an opacity).
  // In a stacked bar only the last segment gets a side face; the others butt against the next one.
  const barRe = /<rect\b[^>]*class="d-fill-(accent|cyan|warn|ok)"[^>]*\/>/g;
  const bars = [...svg.matchAll(barRe)].map(([tag]) => attrs(tag)).map((a) => ['x', 'y', 'width', 'height'].map((k) => num(a, k)));
  const joined = (x, y, w, h) => bars.some(([x2, y2, , h2]) => Math.abs(x2 - (x + w)) < 0.6 && Math.abs(y2 - y) < 0.6 && Math.abs(h2 - h) < 0.6);
  const stackedAbove = (x, y, w) => bars.some(([x2, y2, w2, h2]) => Math.abs(x2 - x) < 0.6 && Math.abs(w2 - w) < 0.6 && Math.abs(y2 + h2 - y) < 0.6);
  svg = svg.replace(barRe, (tag, tone) => {
    const a = attrs(tag);
    const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((k) => num(a, k));
    if (a.opacity || w < 20 || h < 10) return tag;
    const hasRight = !joined(x, y, w, h), hasTop = !stackedAbove(x, y, w);
    const d = BAR;
    const top = `${fmt(x)},${fmt(y)} ${fmt(x + d)},${fmt(y - d)} ${fmt(x + w + d)},${fmt(y - d)} ${fmt(x + w)},${fmt(y)}`;
    const right = `${fmt(x + w)},${fmt(y)} ${fmt(x + w + d)},${fmt(y - d)} ${fmt(x + w + d)},${fmt(y + h - d)} ${fmt(x + w)},${fmt(y + h)}`;
    return `${tag}${hasTop ? `<polygon class="d3-bar-top d3-${tone}" points="${top}"/>` : ''}${hasRight ? `<polygon class="d3-bar-side d3-${tone}" points="${right}"/>` : ''}`;
  });

  // chart lines: a soft offset copy underneath
  svg = svg.replace(/<(path|polyline)\b([^>]*class="d-line[^"]*"[^>]*)\/>/g, (tag, el, rest) =>
    `<${el}${rest.replace(/class="[^"]*"/, 'class="d3-line-shadow"').replace(/\sid="[^"]*"/, '')} transform="translate(3 5)"/>${tag}`);

  // badges go last so they sit above every connector
  const badges = [];
  svg = svg.replace(/<!--badge:([\s\S]*?)-->/g, (_, b) => { badges.push(b); return ''; });

  const defs = `<defs>`
    + `<filter id="${id}-d3blur" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>`
    + `<linearGradient id="${id}-d3sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="d3-sheen-a"/><stop offset="1" class="d3-sheen-b"/></linearGradient>`
    + `<clipPath id="${id}-d3clip" clipPathUnits="objectBoundingBox"><rect width="1" height="1" rx="0.26"/></clipPath>`
    + `</defs>`;
  svg = svg.replace(/(<svg\b[^>]*>)/, `$1${defs}`);
  if (badges.length) svg = svg.replace(/<\/svg>\s*$/, `<g class="d3-badges">${badges.join('')}</g></svg>`);

  // room for the raised sides and shadows at the bottom edge
  svg = svg.replace(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/, (m, w, h) =>
    extraBottom > Number(h) ? `viewBox="0 0 ${w} ${fmt(extraBottom)}"` : m);
  return svg;
}
