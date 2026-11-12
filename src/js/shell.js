// Shared by every page: smooth scrolling, the header, the mobile menu, title reveals,
// the custom cursor and the pause control.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger, SplitText);

export const html = document.documentElement;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => gsap.utils.toArray(sel, root);
export const media = {
  reduce: window.matchMedia('(prefers-reduced-motion: reduce)'),
  fine: window.matchMedia('(hover: hover) and (pointer: fine)'),
  desktop: window.matchMedia('(min-width: 1024px)'),
};

export let lenis = null;
export let paused = false;
export const pausables = new Set(); // tweens and loops the pause button controls

/* ---------------- Smooth scrolling (Lenis drives ScrollTrigger) ---------------- */

const tick = (time) => lenis?.raf(time * 1000);
export function startLenis() {
  lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
}
export function stopLenis() {
  gsap.ticker.remove(tick);
  lenis?.destroy();
  lenis = null;
}

export function scrollToTarget(target, immediate = false) {
  const el = typeof target === 'string' ? $(target) : target;
  if (!el) return;
  const offset = el.id === 'top' ? 0 : -(parseFloat(getComputedStyle(html).scrollPaddingTop) || 80);
  if (lenis) lenis.scrollTo(el, { offset, immediate, duration: 1.4 });
  else el.scrollIntoView({ behavior: immediate || media.reduce.matches ? 'auto' : 'smooth' });
}

/* ---------------- Mobile menu ---------------- */

const menuButton = $('.menu-toggle');
const menu = $('#menu');
const menuOpen = () => menu && !menu.hidden;
function openMenu() {
  menu.hidden = false;
  menuButton.setAttribute('aria-expanded', 'true');
  menuButton.setAttribute('aria-label', 'Close menu');
  lenis?.stop();
  if (!media.reduce.matches) gsap.from('#menu nav a', { yPercent: 60, opacity: 0, stagger: 0.05, duration: 0.6, ease: 'power3.out' });
  $('#menu nav a')?.focus();
}
function closeMenu() {
  if (!menuOpen()) return;
  menu.hidden = true;
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Open menu');
  lenis?.start();
}

/* ---------------- Page shell: in-page links, header, menu, footer year ---------------- */

export function initShell() {
  // In-page links go through Lenis so they glide, and move focus for keyboard users.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href');
    const el = id.length > 1 ? $(id) : null;
    if (!el) return;
    e.preventDefault();
    closeMenu();
    scrollToTarget(el);
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
    history.pushState(null, '', id);
  });

  // Header: scrolled state, hide on scroll down, progress.
  const header = $('.site-header');
  ScrollTrigger.create({
    start: 0,
    end: 'max',
    onUpdate(self) {
      const y = self.scroll();
      header.classList.toggle('is-scrolled', y > 24);
      header.classList.toggle('is-hidden', self.direction === 1 && y > 600 && !menuOpen());
    },
  });
  gsap.to('.progress i', { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: true } });

  // The nav marks the section you're reading. Links to other pages are skipped.
  for (const a of $$('.nav a[href^="#"]')) {
    const section = $(a.getAttribute('href'));
    if (!section) continue;
    ScrollTrigger.create({
      trigger: section,
      start: 'top 50%',
      end: 'bottom 50%',
      onToggle: (self) => (self.isActive ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')),
    });
  }

  menuButton?.addEventListener('click', () => (menuOpen() ? closeMenu() : openMenu()));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuOpen()) {
      closeMenu();
      menuButton.focus();
    }
  });
  media.desktop.addEventListener('change', () => media.desktop.matches && closeMenu());

  const yearEl = $('[data-current-year]');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
}

/* ---------------- Reveals used on every page (call inside a gsap.matchMedia handler so they revert with it) ---------------- */

// Section titles: lines slide up from a mask.
export function splitTitles() {
  for (const el of $$('[data-split]')) {
    SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      linesClass: 'split-line',
      autoSplit: true,
      onSplit: (self) =>
        gsap.from(self.lines, { yPercent: 105, duration: 1, stagger: 0.09, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 86%' } }),
    });
  }
}

// Footer wordmark rises into place.
export function riseWordmark() {
  gsap.from('.wordmark', { yPercent: 45, opacity: 0, ease: 'none', scrollTrigger: { trigger: '.footer', start: 'top 85%', end: 'bottom bottom', scrub: true } });
}

/* ---------------- Custom cursor ---------------- */

export function initCursor() {
  const cursor = $('.cursor');
  const dot = $('.cursor__dot');
  const ring = $('.cursor__ring');
  const label = $('.cursor__label');
  html.classList.add('has-cursor');
  const dx = gsap.quickTo(dot, 'x', { duration: 0.08, ease: 'power3' });
  const dy = gsap.quickTo(dot, 'y', { duration: 0.08, ease: 'power3' });
  const rx = gsap.quickTo(ring, 'x', { duration: 0.45, ease: 'power3' });
  const ry = gsap.quickTo(ring, 'y', { duration: 0.45, ease: 'power3' });
  const move = (e) => {
    dx(e.clientX); dy(e.clientY); rx(e.clientX); ry(e.clientY);
    const t = e.target instanceof Element ? e.target : null;
    const labelled = t?.closest('[data-cursor]');
    const field = t?.closest('input, textarea, select');
    const interactive = t?.closest('a, button, label, summary');
    cursor.classList.toggle('is-hidden', Boolean(field));
    cursor.classList.toggle('is-label', Boolean(labelled) && !interactive);
    cursor.classList.toggle('is-link', Boolean(interactive));
    label.textContent = labelled && !interactive ? labelled.dataset.cursor : '';
  };
  const hide = () => cursor.classList.add('is-hidden');
  window.addEventListener('pointermove', move, { passive: true });
  document.documentElement.addEventListener('pointerleave', hide);

  // Magnetic buttons pull toward the pointer.
  const magnets = $$('.magnetic').map((el) => {
    const x = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'elastic.out(1, 0.4)' });
    const y = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'elastic.out(1, 0.4)' });
    let r = null;
    const enter = () => (r = el.getBoundingClientRect());
    const over = (e) => {
      if (!r) r = el.getBoundingClientRect();
      x((e.clientX - r.left - r.width / 2) * 0.3);
      y((e.clientY - r.top - r.height / 2) * 0.3);
    };
    const leave = () => {
      r = null;
      x(0);
      y(0);
    };
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointermove', over);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointermove', over);
      el.removeEventListener('pointerleave', leave);
      gsap.set(el, { clearProps: 'transform' });
    };
  });

  return () => {
    window.removeEventListener('pointermove', move);
    document.documentElement.removeEventListener('pointerleave', hide);
    magnets.forEach((fn) => fn());
    html.classList.remove('has-cursor');
  };
}

/* ---------------- Pause control for everything that moves on its own ---------------- */

// onChange runs after every toggle (and once at start) so a page can pause its own extras.
export function initMotionToggle(onChange = () => {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'motion-toggle';
  const render = () => {
    const text = paused ? 'Play motion' : 'Pause motion';
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', text);
    button.title = text;
    button.innerHTML = paused
      ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l11-7z"/></svg><span>${text}</span>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg><span>${text}</span>`;
  };
  const apply = () => {
    html.classList.toggle('is-paused', paused);
    pausables.forEach((t) => (paused ? t.pause() : t.resume()));
    onChange(paused);
    render();
  };
  try {
    paused = localStorage.getItem('dp-motion') === 'paused';
  } catch {}
  button.addEventListener('click', () => {
    paused = !paused;
    try {
      localStorage.setItem('dp-motion', paused ? 'paused' : 'on');
    } catch {}
    apply();
  });
  document.body.append(button);
  apply();
}
