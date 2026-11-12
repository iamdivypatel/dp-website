// Project cards: illustrations that play only while on screen, a drifting word behind
// each one, and a 3D tilt on desktop. With JavaScript off, or "reduce motion" on, every
// illustration is a still picture.
import { gsap } from 'gsap';
import { $, $$ } from './shell.js';

// The CSS keys every illustration loop off .is-live, so only the cards in view animate.
export function watchIllustrations() {
  const visuals = $$('.scene');
  if (!('IntersectionObserver' in window)) {
    visuals.forEach((v) => v.classList.add('is-live'));
    return;
  }
  const io = new IntersectionObserver((entries) => entries.forEach((e) => e.target.classList.toggle('is-live', e.isIntersecting)), { rootMargin: '0px 0px -8% 0px' });
  visuals.forEach((v) => io.observe(v));
}

// The big word behind each illustration drifts against the scroll. Call inside a gsap.matchMedia handler.
export function driftWords() {
  for (const card of $$('.project')) {
    gsap.fromTo($('.scene__word', card), { yPercent: 16 }, { yPercent: -16, ease: 'none', scrollTrigger: { trigger: card, start: 'top bottom', end: 'bottom top', scrub: true } });
  }
}

// 3D tilt: the illustration leans toward the pointer and its chips float above it.
export function initTilt() {
  const cleanups = $$('.project').map((card) => {
    const visual = $('.scene', card);
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
