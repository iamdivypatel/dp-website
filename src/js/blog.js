// Blog pages only: the header and mobile menu, copy buttons on code, and the
// "On this page" list following the reader. Deliberately tiny: no GSAP, Lenis or Three.js.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* Header: solid background once you scroll */
const header = $('.site-header');
const onScroll = () => header?.classList.toggle('is-scrolled', window.scrollY > 20);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

/* Mobile menu */
const button = $('.menu-toggle');
const menu = $('#menu');
function setMenu(open) {
  if (!menu || !button) return;
  menu.hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  button.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  document.documentElement.style.overflow = open ? 'hidden' : '';
  if (open) $('#menu nav a')?.focus();
}
button?.addEventListener('click', () => setMenu(menu.hidden));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menu && !menu.hidden) { setMenu(false); button.focus(); }
});
$$('#menu a').forEach((a) => a.addEventListener('click', () => setMenu(false)));

/* Copy buttons on code blocks */
for (const block of $$('.prose .code')) {
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'code__copy';
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('pre', block).innerText);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Press Ctrl+C';
    }
    setTimeout(() => (copy.textContent = 'Copy'), 1600);
  });
  block.append(copy);
}

/* "On this page": mark the section being read; the list starts closed on small screens */
const toc = $('.toc details');
if (toc && window.matchMedia('(max-width: 1023px)').matches) toc.open = false;
const links = new Map($$('.toc a').map((a) => [a.hash.slice(1), a]));
const headings = [...links.keys()].map((id) => document.getElementById(id)).filter(Boolean);
if (headings.length && 'IntersectionObserver' in window) {
  const visible = new Set();
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target);
    const current = headings.find((h) => visible.has(h)) ??
      [...headings].reverse().find((h) => h.getBoundingClientRect().top < 120);
    for (const a of links.values()) a.removeAttribute('aria-current');
    if (current) links.get(current.id)?.setAttribute('aria-current', 'true');
  }, { rootMargin: '-80px 0px -60% 0px' });
  headings.forEach((h) => observer.observe(h));
}
