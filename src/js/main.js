// Divya Patel portfolio: motion, 3D stage and contact form.
// Every effect is an enhancement: with JavaScript off, or "reduce motion" on,
// the page is a calm, fully readable single page.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';

gsap.registerPlugin(ScrollTrigger, SplitText);

const html = document.documentElement;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => gsap.utils.toArray(sel, root);
const media = {
  reduce: window.matchMedia('(prefers-reduced-motion: reduce)'),
  fine: window.matchMedia('(hover: hover) and (pointer: fine)'),
  desktop: window.matchMedia('(min-width: 1024px)'),
};
const FORM_ENDPOINT = 'https://formsubmit.co/ajax/iamdivypatel@gmail.com';

let lenis = null;
let stage = null;
let stageSync = () => {}; // set once the motion setup runs
let paused = false;
const pausables = new Set(); // tweens and loops the pause button controls

/* ---------------- Smooth scrolling (Lenis drives ScrollTrigger) ---------------- */

const tick = (time) => lenis?.raf(time * 1000);
function startLenis() {
  lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
}
function stopLenis() {
  gsap.ticker.remove(tick);
  lenis?.destroy();
  lenis = null;
}

function scrollToTarget(target, immediate = false) {
  const el = typeof target === 'string' ? $(target) : target;
  if (!el) return;
  const offset = el.id === 'top' ? 0 : -(parseFloat(getComputedStyle(html).scrollPaddingTop) || 80);
  if (lenis) lenis.scrollTo(el, { offset, immediate, duration: 1.4 });
  else el.scrollIntoView({ behavior: immediate || media.reduce.matches ? 'auto' : 'smooth' });
}

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

/* ---------------- Header: scrolled state, hide on scroll down, progress, current section ---------------- */

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

const navLinks = $$('.nav a');
for (const a of navLinks) {
  const section = $(a.getAttribute('href'));
  if (!section) continue;
  ScrollTrigger.create({
    trigger: section,
    start: 'top 50%',
    end: 'bottom 50%',
    onToggle: (self) => (self.isActive ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')),
  });
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
menuButton?.addEventListener('click', () => (menuOpen() ? closeMenu() : openMenu()));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && menuOpen()) {
    closeMenu();
    menuButton.focus();
  }
});
media.desktop.addEventListener('change', () => media.desktop.matches && closeMenu());

/* ---------------- Hero name: split into letters that respond to the cursor ---------------- */

const chars = [];
for (const word of $$('.hero__word')) {
  const text = word.textContent.trim();
  word.textContent = '';
  for (const letter of text) {
    const span = document.createElement('span');
    span.className = 'ch';
    span.textContent = letter;
    word.append(span);
    chars.push({ el: span, w: 800, d: 100 });
  }
}
const paintChar = (c) => (c.el.style.fontVariationSettings = `"wght" ${c.w.toFixed(0)}, "wdth" ${c.d.toFixed(1)}`);

/* ---------------- Rotating headline ---------------- */

const rotatorWords = $$('.rotator__word');
let rotatorIndex = 0;
let rotatorTimer = null;
function rotateWord() {
  const current = rotatorWords[rotatorIndex];
  rotatorIndex = (rotatorIndex + 1) % rotatorWords.length;
  const next = rotatorWords[rotatorIndex];
  gsap.to(current, { yPercent: -60, opacity: 0, duration: 0.5, ease: 'power2.in', onComplete: () => current.classList.remove('is-active') });
  next.classList.add('is-active');
  gsap.fromTo(next, { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.7, delay: 0.25, ease: 'power3.out' });
}
function setRotator(on) {
  clearInterval(rotatorTimer);
  rotatorTimer = on && !paused && rotatorWords.length > 1 ? setInterval(rotateWord, 2600) : null;
}

/* ---------------- Odometer year ---------------- */

const odometerCols = [];
for (const digit of $$('.odometer__digit[data-digits]')) {
  const value = Number(digit.textContent.trim());
  const col = document.createElement('span');
  col.className = 'odometer__col';
  for (let n = 0; n <= 9; n++) {
    const i = document.createElement('i');
    i.textContent = String(n);
    col.append(i);
  }
  digit.replaceChildren(col);
  gsap.set(col, { yPercent: -10 * value });
  odometerCols.push(col);
}
function rollYear(year) {
  const tail = String(year).slice(-2);
  odometerCols.forEach((col, i) => gsap.to(col, { yPercent: -10 * Number(tail[i]), duration: 0.9, ease: 'power3.inOut', overwrite: 'auto' }));
}

/* ---------------- Everything that depends on motion and screen size ---------------- */

const mm = gsap.matchMedia();
mm.add(
  {
    // matchMedia only runs the handler when at least one condition matches,
    // so desktop + mobile together always cover every screen.
    desktop: '(min-width: 1024px) and (min-height: 600px)',
    mobile: '(max-width: 1023.98px), (max-height: 599.98px)',
    reduce: '(prefers-reduced-motion: reduce)',
    fine: '(hover: hover) and (pointer: fine)',
  },
  (ctx) => {
    const { desktop, reduce, fine } = ctx.conditions;
    const off = [];
    const motion = !reduce;
    html.classList.toggle('fx', motion);
    html.classList.toggle('fx-pin', motion && desktop);
    if (motion) startLenis();

    // Section titles: lines slide up from a mask.
    for (const el of $$('[data-split]')) {
      if (!motion) break;
      SplitText.create(el, {
        type: 'lines',
        mask: 'lines',
        linesClass: 'split-line',
        autoSplit: true,
        onSplit: (self) =>
          gsap.from(self.lines, { yPercent: 105, duration: 1, stagger: 0.09, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 86%' } }),
      });
    }

    // About: words brighten as you read down the paragraph.
    const words = $('[data-reveal-words]');
    if (words && motion) {
      SplitText.create(words, {
        type: 'words',
        autoSplit: true,
        onSplit: (self) =>
          gsap.fromTo(self.words, { opacity: 0.2 }, { opacity: 1, ease: 'none', stagger: 0.1, scrollTrigger: { trigger: words, start: 'top 78%', end: 'bottom 45%', scrub: true } }),
      });
    }

    // Portrait drifts against the scroll.
    if (motion) {
      gsap.fromTo('.portrait__img', { yPercent: -4 }, { yPercent: 4, ease: 'none', scrollTrigger: { trigger: '.portrait', start: 'top bottom', end: 'bottom top', scrub: true } });
    }

    // Stats count up once. Until then the real numbers stay in place (for crawlers and fast scrollers).
    for (const el of $$('[data-count]')) {
      if (!motion) break;
      const end = Number(el.dataset.count);
      const n = { v: 0 };
      ScrollTrigger.create({
        trigger: el,
        start: 'top 94%',
        once: true,
        onEnter: () => gsap.fromTo(n, { v: 0 }, { v: end, duration: 1.8, ease: 'power2.out', onUpdate: () => (el.textContent = String(Math.round(n.v))) }),
      });
    }

    // Generic fade-up reveals.
    const revealables = $$('.stats li, .role, .skill-card, .edu__item, .contact__list > div, .form, .manifest > div' + (desktop ? '' : ', .project, .step'));
    if (motion && revealables.length) {
      gsap.set(revealables, { opacity: 0, y: 28 });
      ScrollTrigger.batch(revealables, {
        start: 'top 88%',
        once: true,
        onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 0.8, stagger: 0.08, ease: 'power2.out' }),
      });
    }

    // Marquee: endless, faster while you scroll, paused off-screen.
    const marqueeLoops = [];
    for (const row of $$('[data-marquee]')) {
      const track = $('.marquee__track', row);
      if (!motion || !track) continue;
      const clone = track.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      row.append(clone);
      off.push(() => clone.remove());
      const dir = Number(row.dataset.marquee);
      const loop = gsap.fromTo([track, clone], { xPercent: dir > 0 ? 0 : -100 }, { xPercent: dir > 0 ? -100 : 0, duration: 32, ease: 'none', repeat: -1 });
      marqueeLoops.push(loop);
      pausables.add(loop);
      off.push(() => pausables.delete(loop));
    }
    if (marqueeLoops.length) {
      const boost = gsap.utils.pipe(Math.abs, gsap.utils.mapRange(0, 3000, 1, 4), gsap.utils.clamp(1, 4));
      ScrollTrigger.create({
        trigger: '.marquee',
        start: 'top bottom',
        end: 'bottom top',
        onToggle: (s) => marqueeLoops.forEach((l) => (s.isActive && !paused ? l.play() : l.pause())),
        onUpdate: (s) => marqueeLoops.forEach((l) => gsap.to(l, { timeScale: boost(s.getVelocity()), duration: 0.4, overwrite: true })),
      });
    }

    // Journey: the year rolls as each role reaches the middle of the screen.
    for (const role of $$('.role[data-year]')) {
      ScrollTrigger.create({ trigger: role, start: 'top 55%', end: 'bottom 55%', onToggle: (self) => self.isActive && rollYear(role.dataset.year) });
    }
    if (motion) {
      gsap.to('.journey__rail i', { scaleY: 1, ease: 'none', scrollTrigger: { trigger: '.journey__list', start: 'top 60%', end: 'bottom 60%', scrub: true } });
    }

    // Hero ranges: whether the 3D stage should be visible.
    const heroST = ScrollTrigger.create({ trigger: '#top', start: 'top top', end: 'bottom top', onToggle: syncStage });

    // "How I build": pinned story driving the 3D model (desktop, motion allowed).
    let stackST = null;
    if (motion && desktop) {
      const steps = $$('.step');
      let active = -1;
      gsap.set(steps, { opacity: 0, y: 30 });
      const setStep = (i) => {
        if (i === active) return;
        if (steps[active]) {
          steps[active].classList.remove('is-active');
          gsap.to(steps[active], { opacity: 0, y: -24, duration: 0.45, ease: 'power2.in', overwrite: true });
        }
        active = i;
        steps[i].classList.add('is-active');
        gsap.to(steps[i], { opacity: 1, y: 0, duration: 0.7, delay: 0.15, ease: 'power3.out', overwrite: true });
      };
      setStep(0);
      stackST = ScrollTrigger.create({
        trigger: '#stack',
        pin: '.stack__pin',
        start: 'top top',
        end: () => '+=' + window.innerHeight * steps.length,
        scrub: true,
        onUpdate: (self) => {
          const p = self.progress;
          setStep(Math.min(steps.length - 1, Math.floor(p * steps.length)));
          gsap.set('.stack__progress i', { scaleX: p });
          stage?.setProgress(p);
        },
        onToggle: syncStage,
      });
      off.push(() => {
        steps.forEach((s) => s.classList.remove('is-active'));
        gsap.set(steps, { clearProps: 'all' });
      });
    }
    const stackViewST = stackST ? ScrollTrigger.create({ trigger: '#stack', start: 'top bottom', end: 'bottom top', onToggle: syncStage }) : null;

    // Projects: vertical scroll moves the cards sideways (desktop, motion allowed).
    if (motion && desktop) {
      const track = $('.projects__track');
      const cards = $$('.project', track);
      const index = $('[data-project-index]');
      const dist = () => Math.max(0, track.scrollWidth - window.innerWidth);
      const tween = gsap.to(track, {
        x: () => -dist(),
        ease: 'none',
        scrollTrigger: {
          trigger: '#projects',
          pin: '.projects__pin',
          start: 'top top',
          end: () => '+=' + dist(),
          scrub: true,
          invalidateOnRefresh: true,
          onUpdate: (self) => {
            gsap.set('.projects__bar i', { scaleX: self.progress });
            index.textContent = String(Math.min(cards.length, Math.round(self.progress * (cards.length - 1)) + 1)).padStart(2, '0');
          },
        },
      });
      // Only the illustration zooms; the monogram (GD, AdUP…) stays put so it is never pushed out of the card.
      for (const card of cards) {
        const motif = $$('.project__art > :not(.art__mono)', card);
        gsap.fromTo(motif, { scale: 1.12 }, { scale: 1, ease: 'none', scrollTrigger: { containerAnimation: tween, trigger: card, start: 'left right', end: 'center center', scrub: true } });
      }
      // Keyboard: focusing a link inside an off-screen card scrolls the page to that card.
      const onFocus = (e) => {
        const card = e.target.closest('.project');
        if (!card) return;
        const st = tween.scrollTrigger;
        const y = st.start + gsap.utils.clamp(0, 1, card.offsetLeft / Math.max(1, dist())) * (st.end - st.start);
        if (lenis) lenis.scrollTo(y, { immediate: true });
        else window.scrollTo(0, y);
      };
      track.addEventListener('focusin', onFocus);
      off.push(() => track.removeEventListener('focusin', onFocus));
    }

    // Footer wordmark rises into place.
    if (motion) {
      gsap.from('.wordmark', { yPercent: 45, opacity: 0, ease: 'none', scrollTrigger: { trigger: '.footer', start: 'top 85%', end: 'bottom bottom', scrub: true } });
    }

    // Hero letters swell toward the cursor (variable font weight + width).
    if (motion && fine) {
      const tos = chars.map((c) => ({
        w: gsap.quickTo(c, 'w', { duration: 0.6, ease: 'power3', onUpdate: () => paintChar(c) }),
        d: gsap.quickTo(c, 'd', { duration: 0.6, ease: 'power3', onUpdate: () => paintChar(c) }),
      }));
      const radius = () => Math.max(220, window.innerWidth * 0.22);
      const onMove = (e) => {
        if (!heroST.isActive && window.scrollY > window.innerHeight) return;
        const rects = chars.map((c) => c.el.getBoundingClientRect());
        const R = radius();
        rects.forEach((r, i) => {
          const f = Math.max(0, 1 - Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)) / R);
          const ease = f * f * (3 - 2 * f);
          tos[i].w(800 + 100 * ease);
          tos[i].d(100 + 25 * ease);
        });
      };
      const onLeave = () => tos.forEach((t) => (t.w(800), t.d(100)));
      window.addEventListener('pointermove', onMove, { passive: true });
      document.documentElement.addEventListener('pointerleave', onLeave);
      off.push(() => {
        window.removeEventListener('pointermove', onMove);
        document.documentElement.removeEventListener('pointerleave', onLeave);
      });
    }

    // Custom cursor and magnetic buttons.
    if (motion && fine) off.push(initCursor());

    // Skill cards: a soft light follows the pointer.
    if (fine) {
      const grid = $('.skills__grid');
      const onMove = (e) => {
        const card = e.target.closest('.skill-card');
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${e.clientX - r.left}px`);
        card.style.setProperty('--my', `${e.clientY - r.top}px`);
      };
      grid?.addEventListener('pointermove', onMove);
      off.push(() => grid?.removeEventListener('pointermove', onMove));
    }

    setRotator(motion);
    syncStage();
    function syncStage() {
      if (!stage) return;
      const inStory = Boolean(stackST?.isActive);
      stage.setMode(inStory ? 'story' : 'hero');
      if (inStory) stage.setProgress(stackST.progress);
      const on = heroST.isActive || inStory || Boolean(stackViewST?.isActive) || window.scrollY < 10;
      $('.stage').classList.toggle('is-on', on);
      stage.setActive(on);
    }
    stageSync = syncStage;

    ScrollTrigger.refresh();
    return () => {
      off.forEach((fn) => fn());
      setRotator(false);
      if (lenis) stopLenis();
      html.classList.remove('fx', 'fx-pin');
    };
  },
);

/* ---------------- Custom cursor ---------------- */

function initCursor() {
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

/* ---------------- Intro: curtain, then the hero assembles ---------------- */

function heroIntro() {
  if (media.reduce.matches) return gsap.timeline();
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  chars.forEach((c) => {
    c.d = 62;
    paintChar(c);
  });
  tl.from(chars.map((c) => c.el), { yPercent: 70, opacity: 0, rotateX: -55, transformOrigin: '50% 100%', duration: 1.3, stagger: 0.045 }, 0)
    .to(chars, { d: 100, duration: 1.4, stagger: 0.045, ease: 'power3.out', onUpdate() { this.targets().forEach(paintChar); } }, 0.1)
    .from('[data-hero-fade]', { opacity: 0, y: 26, duration: 1, stagger: 0.1, ease: 'power3.out' }, 0.35)
    .from('.hero__meta > *', { opacity: 0, y: -12, duration: 0.8, stagger: 0.08, ease: 'power3.out' }, 0.2);
  return tl;
}

function runIntro() {
  const loader = $('.loader');
  if (!loader || media.reduce.matches || getComputedStyle(loader).display === 'none') {
    loader?.remove();
    heroIntro();
    return Promise.resolve();
  }
  const seen = html.classList.contains('intro-seen');
  const count = $('[data-loader-count]');
  const n = { v: 0 };
  lenis?.stop();
  return new Promise((resolve) => {
    const tl = gsap.timeline({
      onComplete: () => {
        loader.remove();
        lenis?.start();
        ScrollTrigger.refresh();
        resolve();
      },
    });
    tl.from('.loader__name span, .loader__role', { yPercent: 100, opacity: 0, duration: 0.7, stagger: 0.08, ease: 'power3.out' })
      .to(n, { v: 100, duration: seen ? 0.5 : 1.4, ease: 'power2.inOut', onUpdate: () => (count.textContent = Math.round(n.v)) }, 0.1)
      .to('.loader__bar i', { scaleX: 1, duration: seen ? 0.5 : 1.4, ease: 'power2.inOut' }, 0.1)
      .to(loader, { yPercent: -100, duration: 0.9, ease: 'expo.inOut' }, '+=0.1')
      .add(heroIntro(), '-=0.45');
  });
}

/* ---------------- Pause control for everything that moves on its own ---------------- */

function initMotionToggle() {
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
    stage?.setPaused(paused);
    setRotator(!media.reduce.matches);
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

/* ---------------- 3D stage (loaded after the intro so it never delays first paint) ---------------- */

async function initStage() {
  const canvas = $('.stage__canvas');
  if (!canvas) return;
  try {
    const { createStage, webglAvailable } = await import('./scene.js');
    if (!webglAvailable()) return;
    stage = await createStage({
      canvas,
      labelsEl: $('.stage__labels'),
      reducedMotion: media.reduce.matches,
      onLost: () => html.classList.remove('has-3d'),
    });
    if (!stage) return;
    html.classList.add('has-3d');
    if (new URLSearchParams(location.search).has('debug')) window.__stage = stage;
    stage.setPaused(paused);
    stageSync();
  } catch (err) {
    console.warn('3D stage unavailable:', err);
  }
}

/* ---------------- Contact: copy, local time, form ---------------- */

const copyStatus = $('[data-copy-status]');
for (const button of $$('[data-copy]')) {
  button.addEventListener('click', async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      ok = true;
    } catch {}
    button.textContent = ok ? 'Copied' : 'Copy failed';
    if (copyStatus) copyStatus.textContent = ok ? 'Email address copied.' : 'Couldn’t copy. Select the address instead.';
    setTimeout(() => (button.textContent = 'Copy'), 2000);
  });
}

const indiaTime = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
function updateTime() {
  const now = new Date();
  const time = indiaTime.format(now).replace(/\s*([AP])M$/i, (_, p) => ` ${p.toLowerCase()}m`);
  const ahead = 330 + now.getTimezoneOffset();
  let rel = 'same time zone as you';
  if (ahead) {
    const h = Math.floor(Math.abs(ahead) / 60);
    const m = Math.abs(ahead) % 60;
    rel = `${[h && `${h} h`, m && `${m} min`].filter(Boolean).join(' ')} ${ahead > 0 ? 'ahead of' : 'behind'} you`;
  }
  for (const el of $$('[data-local-time]')) el.textContent = `${time} in Ahmedabad`;
  for (const el of $$('[data-local-time-long]')) el.textContent = `It’s ${time} there now, ${rel}.`;
}
updateTime();
setInterval(() => !paused && updateTime(), 30000);
document.addEventListener('visibilitychange', () => !document.hidden && updateTime());

const yearEl = $('[data-current-year]');
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

const form = $('[data-contact-form]');
if (form) initForm(form);

function initForm(form) {
  const status = $('[data-form-status]', form);
  const submit = $('[data-submit]', form);
  const submitLabel = $('[data-submit-label]', form);
  const fields = {
    name: { el: $('#f-name'), check: (v) => (v.trim().length >= 2 ? '' : 'Please enter your name.') },
    email: { el: $('#f-email'), check: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? '' : 'Please enter a valid email address, like name@company.com.') },
    message: { el: $('#f-message'), check: (v) => (v.trim().length >= 10 ? '' : 'Please write a short message (at least 10 characters).') },
  };
  const showError = (key, msg) => {
    const { el } = fields[key];
    const err = $(`#${el.id}-err`);
    err.textContent = msg;
    if (msg) {
      el.setAttribute('aria-invalid', 'true');
      el.setAttribute('aria-describedby', err.id);
    } else {
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-describedby');
    }
    return !msg;
  };
  for (const [key, f] of Object.entries(fields)) {
    f.el.addEventListener('blur', () => f.el.value && showError(key, f.check(f.el.value)));
    f.el.addEventListener('input', () => f.el.getAttribute('aria-invalid') && showError(key, f.check(f.el.value)));
  }
  const setStatus = (text, kind = '') => {
    status.textContent = text;
    status.className = `form__status${kind ? ` is-${kind}` : ''}`;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let firstBad = null;
    for (const [key, f] of Object.entries(fields)) {
      if (!showError(key, f.check(f.el.value)) && !firstBad) firstBad = f.el;
    }
    if (firstBad) {
      setStatus('Please fix the highlighted fields.', 'error');
      firstBad.focus();
      return;
    }
    const data = Object.fromEntries(new FormData(form));
    if (data._honey) {
      setStatus('Thanks! Your message is on its way.', 'ok');
      form.reset();
      return;
    }
    submit.setAttribute('aria-busy', 'true');
    submitLabel.textContent = 'Sending…';
    setStatus('');
    try {
      const res = await fetch(FORM_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...data, _replyto: data.email }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && String(json.success) === 'true') {
        setStatus(`Thanks, ${data.name.trim().split(/\s+/)[0]}! Your message is on its way. I’ll reply by email.`, 'ok');
        form.reset();
      } else if (/activat/i.test(String(json.message || ''))) {
        setStatus('The form is waiting for a one-time activation. Please email iamdivypatel@gmail.com directly for now.', 'error');
      } else {
        throw new Error(json.message || `HTTP ${res.status}`);
      }
    } catch {
      setStatus('Couldn’t send right now. Please email iamdivypatel@gmail.com directly.', 'error');
    } finally {
      submit.removeAttribute('aria-busy');
      submitLabel.textContent = 'Send message';
    }
  });
}

/* ---------------- Start ---------------- */

initMotionToggle();
document.fonts?.ready.then(() => ScrollTrigger.refresh());
runIntro().then(() => {
  if (location.hash && $(location.hash)) scrollToTarget(location.hash, true);
});
// Let the intro own the first frames, then build the 3D scene.
(window.requestIdleCallback || ((fn) => setTimeout(fn, 400)))(() => initStage(), { timeout: 1500 });
