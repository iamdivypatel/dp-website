# Divya Patel – portfolio

A one-page, dark, cinematic portfolio for Divya Patel, Backend & Cloud Engineer. It is built with plain HTML, Tailwind CSS and JavaScript, using these libraries:

- **Three.js** for the 3D model.
- **GSAP** (ScrollTrigger and SplitText) for animation.
- **Lenis** for smooth scrolling.

## What's on the page

- **Hero:** your avatar and a greeting, plus your name in giant type that swells toward the cursor (variable-font weight and width). Behind it is a live 3D model of the cloud system you run at Refy9: API Gateway, the Lambda authorizer, 45 Lambda cells, PgBouncer, private Aurora behind an SSM bastion, SQS FIFO, EventBridge, notifications, EC2 with Grafana and the RunPod GPU. Glowing data packets flow between them.
- **About:** your summary brightens word by word as you scroll, beside your portrait. A switcher flips between five professional looks (coder by default). Count-up stats follow. Every number comes from the CV.
- **Tech ribbon:** two rows of tools that move faster while you scroll.
- **Journey:** "Let's go back in time". A big year rolls 2026 → 2024 → 2023 as each role passes.
- **How I build:** a pinned 3D story. Scrolling lifts the model apart in six steps (requests, serverless, caching, IaC & security, async, observability & AI), and each step shows the matching Refy9 work. Every box carries its service logo: faint at rest, bright when the cursor touches it.
- **Projects:** a pinned section that slides the five key projects sideways.
- **Skills, education and contact:** the contact form emails you.
- **Footer:** a giant wordmark.

## The Industries page (`/industries/`)

- **Six cards, one per industry from the CV:** fashion & AI (OKKAI at Refy9), golf training, carbon credits, ad-tech, EV lifecycle and fuel monitoring (the Blisslers client products).
- **Each card** has its own colour and an animated illustration of what you built there (a wardrobe filling up, a golf shot that becomes a session update, a carbon certificate being verified, a New Tab page with its analytics, a vehicle moving through five roles, dispenser data streaming over MQTT). Below it come the product, what you built and the stack.
- **On desktop** each illustration tilts toward the cursor, and its chips float in front of it. Illustrations only animate while they're on screen; the pause button and "reduce motion" stop them.
- **"Different industries, same problems."** lists the backend problems you solved in more than one industry, with the industries tagged.
- It's linked from the header, the mobile menu, the Projects heading and the footer.

**The text matches the CV** in `public/assets/cv/` (every download button serves the India CV). When the CV changes, update `public/index.html` to match.

## Run locally

You need Node.js 20 or newer and Python 3.

```bash
npm install
npm run build      # CSS + JavaScript + security hash
npm run serve      # http://localhost:5173
npm run dev        # rebuild on every save (run `npm run serve` in a second terminal)
```

## Files

| Path | What it is |
|---|---|
| `public/` | The website. Deploy this folder only. |
| `public/index.html` | All the page text and meta tags. |
| `src/input.css` | Design tokens and component styles (Tailwind v4). |
| `public/industries/index.html` | The Industries page. |
| `src/js/shell.js` | Shared by both pages: smooth scrolling, header, menu, cursor, pause button. |
| `src/js/main.js` | Home page: hero, 3D stage, story, projects, form. |
| `src/js/industries.js` | Industries page: card reveals, live illustrations, tilt. |
| `src/js/scene.js` | The 3D model: node labels and links live in the `NODES` and `LINKS` lists at the top. |
| `public/assets/css`, `public/assets/js` | Build output. Don't edit these by hand. |
| `scripts/` | `set-domain` (absolute URLs), `csp-hash` (security policy), `clean-js`. |
| `tools/og.html` | Source for the 1200×630 link-preview image. |
| `archive/v1-flamegraph/` | The previous design, kept for reference. Safe to delete. |

## The contact form

The form sends messages to **iamdivypatel@gmail.com** through [FormSubmit](https://formsubmit.co), a free service that needs no account.

1. **Activate it once.** After you deploy, send yourself a test message from the live site. FormSubmit then emails iamdivypatel@gmail.com an "Activate Form" button. Click it, and every later message arrives as a neat table. Hitting Reply goes straight to the sender.
2. **Before activation:** visitors see a polite note asking them to email you directly.
3. **Spam protection:** a hidden honeypot field. Messages are also validated before sending.
4. **Switching to another provider** (Formspree, Web3Forms and so on) takes three changes:
   - Change `FORM_ENDPOINT` in `src/js/main.js`.
   - Change the form's `action` in `index.html`.
   - Change `connect-src` and `form-action` in the Content-Security-Policy, which appears in `index.html` and `public/_headers`.

## Photos

The source photo is a Canva export (`Divya Patel – CV (International).png`). Apple's on-device Vision subject detection cuts it out; it runs locally, so the photo never leaves the Mac. Five looks are built from it. Only the background, light, colour grade, crop and the screen reflection in the glasses change; the face is never altered.

| Look | What it is | Where it's used |
|---|---|---|
| **Coder** | Dark room, blurred code editors behind you, cool monitor light, code reflected in your glasses | About portrait (default), avatar |
| **Studio** | Dark navy, blue glow, cyan rim light | About look switcher |
| **Monochrome** | Editorial black and white | About look switcher |
| **Duotone** | Brand blue tones | About look switcher |
| **Natural** | True colour on light studio grey | About look switcher |

- **Avatar:** the round, face-centred crop of the coder look. It appears on the intro screen, beside the hero greeting and on the contact card.
- **Link preview:** uses the studio-lit cut-out.
- **Full-resolution copies:** in `photos/`, which is not deployed.
  - `divya-patel-headshot-square.jpg` is sized for LinkedIn.
  - The cut-outs are transparent PNGs.

To use a new photo, run these two commands. Pillow is the only requirement. If the new photo is framed differently, adjust the `LENSES` coordinates in `tools/looks.py` (they place the glasses reflection).

```bash
swift tools/subject_mask.swift photo.png mask.png        # macOS: on-device cut-out
python3 tools/looks.py photo.png mask.png public/assets/img photos
```

## Before you deploy: set your address

```bash
npm run set-domain -- https://your-domain.com
```

This writes your address into the canonical links, the Open Graph tags and the structured data of both pages, plus `robots.txt` and `sitemap.xml`.

## Deploy

**Live site:** https://divypatel.in (Vercel, deployed from the `main` branch of github.com/iamdivypatel/dp-website). The domain is connected in Vercel under **Settings → Domains**.

- **Vercel:** every push to `main` redeploys.
  - Vercel runs `npm run build` and serves the `public/` folder.
  - Security headers come from `vercel.json`.
- **Other hosts:**
  - Netlify and Cloudflare read `public/_headers` instead.
  - Build command: `npm run build`. Output folder: `public`.
- **Security policy:** `npm run build` recomputes the hashes of the inline scripts in both pages and writes them into the pages, `public/_headers` and `vercel.json`.

## Regenerate the link-preview image

```bash
npx esbuild tools/og.js --bundle --format=esm --minify --outfile=tools/og.bundle.js
python3 -m http.server 5174          # run from the project root
```

Then:

1. Open `http://localhost:5174/tools/og.html` in Chrome.
2. Turn on DevTools device mode and set the size to 1200 × 630.
3. Run **Capture screenshot**, convert it to JPEG (about 100 KB), and save it over `public/assets/img/og-image.jpg`. It shows `photos/divya-patel-cutout-studio.png` in front of the 3D model.

## Motion, accessibility and performance

- **Pause motion:** a button in the bottom-right corner pauses everything that moves on its own: the 3D model, the ribbon, the rotating headline and the status pulse. The choice is remembered.
- **Reduce motion setting:** with it switched on in the operating system, there is no smooth scrolling, no pinning, no reveals and no intro. The 3D model is rendered as a still image.
- **Without JavaScript:** the page is a complete, readable single page.
- **Keyboard:** every control works with the keyboard. Focusing a project link inside the sideways-sliding section scrolls it into view. The custom cursor appears only on mouse or trackpad devices, and text fields keep the normal I-beam cursor.
- **Performance:**
  - The 3D code (about 580 KB minified, about 150 KB gzipped) loads after the intro, so it never delays the first paint.
  - It renders only while visible.
  - It caps pixel density, and it skips the bloom glow on phones and low-power devices.
  - Without WebGL, the hero falls back to a soft glow.

## Credits

- **Typefaces:** Archivo, Instrument Serif and JetBrains Mono (SIL Open Font License), self-hosted.
- **Libraries:** [GSAP](https://gsap.com) (free "no charge" license), [Lenis](https://github.com/darkroomengineering/lenis) (MIT), [Three.js](https://threejs.org) (MIT).
- **Service logos in the 3D model** (`public/assets/logos/`):
  - AWS service icons are the official [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/), used as intended for architecture diagrams.
  - Other brand marks come from [Simple Icons](https://simpleicons.org) (CC0); the brands remain trademarks of their owners.
  - To change a box's logos, edit `logos: [...]` in the `NODES` list at the top of `src/js/scene.js`.
- **Skills used to build it:**
  - [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
  - [GreenSock's official GSAP skills](https://github.com/greensock/gsap-skills)
  - [cloudai-x Three.js skills](https://github.com/CloudAI-X/threejs-skills)
