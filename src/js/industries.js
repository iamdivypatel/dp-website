// Industries page: the shared shell, plus card reveals, illustrations that play only while
// on screen, and a 3D tilt on desktop. With JavaScript off, or "reduce motion" on, every
// illustration is a still picture and the page reads top to bottom.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  html, $, $$, lenis,
  startLenis, stopLenis, scrollToTarget, initShell, initCursor, initMotionToggle, splitTitles, riseWordmark,
} from './shell.js';

initShell();

/* ---------------- Illustrations animate only while they're on screen ---------------- */

const visuals = $$('.ind__visual');
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => e.target.classList.toggle('is-live', e.isIntersecting)), { rootMargin: '0px 0px -8% 0px' });
  visuals.forEach((v) => io.observe(v));
} else {
  visuals.forEach((v) => v.classList.add('is-live'));
}

/* ---------------- Everything that depends on motion and pointer ---------------- */

const mm = gsap.matchMedia();
mm.add(
  {
    // "all" always matches, so the handler runs on every screen.
    all: 'all',
    reduce: '(prefers-reduced-motion: reduce)',
    fine: '(hover: hover) and (pointer: fine)',
  },
  (ctx) => {
    const { reduce, fine } = ctx.conditions;
    const off = [];
    const motion = !reduce;
    html.classList.toggle('fx', motion);

    if (motion) {
      startLenis();
      splitTitles();
      riseWordmark();
      gsap.from('[data-hero-fade]', { opacity: 0, y: 24, duration: 1, stagger: 0.1, delay: 0.15, ease: 'power3.out' });

      // Cards rise in as they arrive; pattern rows follow the same rhythm, quicker.
      const cards = $$('.ind');
      gsap.set(cards, { opacity: 0, y: 64 });
      ScrollTrigger.batch(cards, {
        start: 'top 92%',
        once: true,
        onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 1.1, stagger: 0.14, ease: 'power3.out' }),
      });
      const rows = $$('.pattern');
      gsap.set(rows, { opacity: 0, y: 28 });
      ScrollTrigger.batch(rows, {
        start: 'top 90%',
        once: true,
        onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 0.8, stagger: 0.08, ease: 'power2.out' }),
      });

      // The big word behind each illustration drifts against the scroll.
      for (const card of cards) {
        gsap.fromTo($('.ind__word', card), { yPercent: 16 }, { yPercent: -16, ease: 'none', scrollTrigger: { trigger: card, start: 'top bottom', end: 'bottom top', scrub: true } });
      }
    }

    if (motion && fine) {
      off.push(initCursor());
      off.push(initTilt());
    }

    ScrollTrigger.refresh();
    return () => {
      off.forEach((fn) => fn());
      if (lenis) stopLenis();
      html.classList.remove('fx');
    };
  },
);

/* ---------------- 3D tilt: the illustration leans toward the pointer and its chips float above it ---------------- */

function initTilt() {
  const cleanups = $$('.ind').map((card) => {
    const visual = $('.ind__visual', card);
    const t = { rx: 0, ry: 0 };
    const paint = () => {
      visual.style.setProperty('--rx', `${t.rx.toFixed(2)}deg`);
      visual.style.setProperty('--ry', `${t.ry.toFixed(2)}deg`);
    };
    const toX = gsap.quickTo(t, 'rx', { duration: 0.7, ease: 'power3', onUpdate: paint });
    const toY = gsap.quickTo(t, 'ry', { duration: 0.7, ease: 'power3', onUpdate: paint });
    // Measure the card, not the tilted illustration, so the tilt never feeds back into itself.
    const move = (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / visual.offsetHeight;
      toX((0.5 - Math.min(y, 1)) * 9);
      toY((x - 0.5) * 12);
      visual.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      visual.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    };
    const leave = () => {
      toX(0);
      toY(0);
    };
    card.addEventListener('pointermove', move);
    card.addEventListener('pointerleave', leave);
    return () => {
      card.removeEventListener('pointermove', move);
      card.removeEventListener('pointerleave', leave);
      gsap.killTweensOf(t);
      for (const prop of ['--rx', '--ry', '--mx', '--my']) visual.style.removeProperty(prop);
    };
  });
  return () => cleanups.forEach((fn) => fn());
}

/* ---------------- Start ---------------- */

initMotionToggle();
document.fonts?.ready.then(() => {
  ScrollTrigger.refresh();
  const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target) scrollToTarget(target, true);
});
