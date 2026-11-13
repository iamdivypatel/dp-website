// Divya Patel portfolio, home page: hero, 3D stage, "How I build" story, projects and contact form.
// Every effect is an enhancement: with JavaScript off, or "reduce motion" on,
// the page is a calm, fully readable single page.
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import {
  html, $, $$, media, lenis, paused, pausables,
  startLenis, stopLenis, scrollToTarget, closeMenu, initShell, initCursor, initMotionToggle, splitTitles, riseWordmark,
} from './shell.js';
import { routes } from './routes.js';
import { watchIllustrations, driftWords, initTilt } from './projects.js';

const FORM_ENDPOINT = 'https://formsubmit.co/ajax/iamdivypatel@gmail.com';

let stage = null;
let stageSync = () => {}; // set once the motion setup runs

initShell();
watchIllustrations();

/* ---------------- Section addresses: /about, /journey… (see routes.js) ---------------- */

const cleanPath = (path) => path.replace(/\.html$/, '').replace(/(.)\/+$/, '$1') || '/';
const routeByPath = new Map(routes.map((r) => [r.path, r]));
const routeOf = (path) => routeByPath.get(cleanPath(path));
let followScroll = false; // the address bar follows the scroll once any deep link has been honoured

function goToRoute(route, immediate = false) {
  const el = document.getElementById(route.id);
  if (!el) return;
  document.title = route.title;
  scrollToTarget(el, immediate);
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

// Section links glide to their section and update the address, without reloading the page.
// New-tab clicks (Cmd/Ctrl/Shift, middle button) still open the address normally.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/"]');
  if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target || a.hasAttribute('download')) return;
  const url = new URL(a.href);
  const route = url.origin === location.origin && !url.hash ? routeOf(url.pathname) : null;
  if (!route) return;
  e.preventDefault();
  closeMenu();
  if (route.path !== cleanPath(location.pathname)) history.pushState(null, '', route.path);
  goToRoute(route);
});
window.addEventListener('popstate', () => {
  const route = routeOf(location.pathname);
  if (route && !location.hash) goToRoute(route);
});

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
    if (motion) splitTitles();

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
    const revealables = $$('.stats li, .role, .project, .pattern, .skill-card, .edu__item, .contact__list > div, .form' + (desktop ? '' : ', .step'));
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

    // Declared before any trigger exists: a trigger can call syncStage() while it's being created
    // (when this handler re-runs after a resize or a motion-setting change, with the 3D stage loaded).
    let heroST = null;
    let stackST = null;
    let stackViewST = null;

    // Hero ranges: whether the 3D stage should be visible.
    heroST = ScrollTrigger.create({ trigger: '#top', start: 'top top', end: 'bottom top', onToggle: syncStage });

    // "How I build": pinned story driving the 3D model (desktop, motion allowed).
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
    if (stackST) stackViewST = ScrollTrigger.create({ trigger: '#stack', start: 'top bottom', end: 'bottom top', onToggle: syncStage });

    // Footer wordmark rises into place.
    if (motion) riseWordmark();

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

    // Projects: the word behind each illustration drifts; on desktop the cards tilt toward the pointer.
    if (motion) driftWords();
    if (motion && fine) off.push(initTilt());

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

    // The nav, the address bar and the tab title follow the section you're reading (no new history entries).
    for (const route of routes) {
      const section = document.getElementById(route.id);
      if (!section) continue;
      const link = $(`.nav a[href="${route.path}"]`);
      ScrollTrigger.create({
        trigger: section,
        start: 'top 50%',
        end: 'bottom 50%',
        onToggle: (self) => {
          if (self.isActive) link?.setAttribute('aria-current', 'true');
          else link?.removeAttribute('aria-current');
          if (!self.isActive || !followScroll || route.path === cleanPath(location.pathname)) return;
          history.replaceState(null, '', route.path);
          document.title = route.title;
        },
      });
    }

    setRotator(motion);
    syncStage();
    function syncStage() {
      if (!stage) return;
      const inStory = Boolean(stackST?.isActive);
      stage.setMode(inStory ? 'story' : 'hero');
      if (inStory) stage.setProgress(stackST.progress);
      const on = Boolean(heroST?.isActive) || inStory || Boolean(stackViewST?.isActive) || window.scrollY < 10;
      $('.stage').classList.toggle('is-on', on);
      stage.setActive(on);
    }
    stageSync = syncStage;

    // Measure every trigger in page order, so the pinned "How I build" story (created after the
    // journey and reveal triggers below it) adds its scroll length before they are measured.
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
    return () => {
      off.forEach((fn) => fn());
      setRotator(false);
      if (lenis) stopLenis();
      html.classList.remove('fx', 'fx-pin');
    };
  },
);

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

initMotionToggle(() => {
  stage?.setPaused(paused);
  setRotator(!media.reduce.matches);
});
document.fonts?.ready.then(() => ScrollTrigger.refresh());
runIntro().then(() => {
  const route = routeOf(location.pathname);
  if (location.hash && $(location.hash)) scrollToTarget(location.hash, true);
  else if (route && route.path !== '/') goToRoute(route, true);
  // Let that jump land before the address bar starts following the scroll.
  requestAnimationFrame(() => requestAnimationFrame(() => (followScroll = true)));
});
// Let the intro own the first frames, then build the 3D scene when the browser is idle.
// Low-end phones and tablets keep the flat version: building the scene there blocks taps for too long.
const lowEnd = window.matchMedia('(pointer: coarse)').matches && ((navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4);
if (!lowEnd) (window.requestIdleCallback || ((fn) => setTimeout(fn, 1200)))(() => initStage());
