# Writing a post

Each post is a folder: `content/blog/<slug>/index.md` plus `content/blog/<slug>/diagrams/*.svg`.
`npm run build` (scripts/blog.mjs) turns it into `/blog/<slug>`. The slug is the folder name: lowercase words joined by hyphens, carrying the search phrase (e.g. `redis-cache-stampede-aurora`).

## Front matter

```yaml
---
title: "Cache-aside, write-through and stampede protection: Redis in front of Aurora PostgreSQL"
description: "One or two sentences, at most 155 characters. Shown in Google and on share cards."
date: 2026-11-13          # first published
updated: 2026-11-13       # optional; last real content change
tags: [Redis, AWS, System design]
draft: false              # true keeps it out of the build
---
```

## Shape of a post (1,800–2,800 words)

1. One-line intro paragraph that names the problem and who it's for.
2. `## TL;DR`: 3–5 bullets with the answer up front.
3. A hero diagram before the long explanation.
4. Core sections (`##`, with `###` inside). Each one leads with a diagram or table, then explains it, then shows a short snippet (10–30 lines) that would actually run: TypeScript, YAML, HCL or shell.
5. A trade-off table comparing the options (latency, cost, complexity, failure mode…).
6. `## Gotchas` and `## When not to use this`.
7. `## Checklist` (a short `- [ ]` list).
8. `## Further reading`: primary sources only (AWS docs, project docs, RFCs).

Voice: simple words, written like a person talking, like one developer explaining something to another over coffee. Use "you" and "I", short sentences and short paragraphs. Explain every term in one plain sentence the first time it appears. Many readers don't speak English as their first language, so pick the everyday word over the fancy one. No filler, no hype words ("leverage", "robust", "seamless"). Include a TL;DR that a CTO can skim.

What a post must never do:
- repeat the portfolio's work history;
- name employers or clients, or leak internal details (account IDs, hostnames, numbers from real systems);
- invent benchmarks. Any number is either cited (with the source and the month checked) or clearly marked as an example ("say 2M requests a day").

Callouts are blockquotes that start with a bold label: `> **Note:** …`, `> **Warning:** …`, `> **Tip:** …`.

## Diagrams

Diagrams are hand-written SVG files, inlined into the page at build time. Draw them with the classes below, and never with hard-coded colours or fonts: the site's CSS colours them for the dark theme and they stay crisp at any size.

Reference one from Markdown on its own line: `![Alt text describing the diagram](diagrams/cache-aside.svg "Caption shown under the figure")`.

Rules:
- Root: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 H" class="diagram" role="img" aria-labelledby="<id>-t <id>-d">`, then `<title id="<id>-t">` and `<desc id="<id>-d">` (one sentence describing what the diagram shows). Width is always 800; pick the height to fit, typically 260–520.
- **Every `id` must be unique on the page**, because all of a post's SVGs are inlined into one document. Prefix every id with the diagram name, e.g. `cache-aside-arrow`, `cache-aside-t`.
- Arrowheads: define one marker per SVG, `<marker id="<name>-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="d-head"/></marker>`, and use it with `marker-end="url(#<name>-arrow)"`.
- Text: 13–16 px, `text-anchor="middle"` inside boxes, at least 12 px padding inside every box. Labels must not overlap lines or other labels. Keep labels short (2–4 words); put the detail in the prose.
- Boxes: `rx="10"`. Leave at least 24 px between boxes.
- No `<style>`, `<script>`, `<foreignObject>`, external images, `style=""` or `fill="#…"` attributes. Use classes only.

| Class | Use |
|---|---|
| `d-box` | default node (card fill, subtle border) |
| `d-box d-accent` | the thing the diagram is about (blue) |
| `d-box d-cyan` | caches / fast path (cyan) |
| `d-box d-warn` | failure, error, overload (red) |
| `d-box d-ok` | success, healthy, done (green) |
| `d-zone` | dashed boundary around a group (VPC, account, "AWS") |
| `d-zone-label` | small label on a zone |
| `d-text` | main label (white) |
| `d-sub` | secondary label (muted, smaller) |
| `d-mono` | code / resource names, add to a text element |
| `d-edge` | connector line (pair with `marker-end`) |
| `d-edge d-edge-accent` / `d-edge-warn` / `d-edge-ok` | coloured connectors |
| `d-edge d-dashed` | async / optional / return path |
| `d-head` | the arrowhead path inside the marker (inherits nothing; always add it) |
| `d-grid` | chart gridlines |
| `d-axis` | chart axes |
| `d-line d-accent-stroke` / `d-cyan-stroke` / `d-warn-stroke` / `d-ok-stroke` | chart series lines |
| `d-fill-accent` / `d-fill-cyan` / `d-fill-warn` / `d-fill-ok` | translucent filled areas / bars |
| `d-num` | small circled step numbers: a `<circle class="d-num">` with a `<text class="d-num-text">` |

Preview while drawing: `node scripts/diagram-preview.mjs content/blog/<slug>/diagrams/x.svg` writes a PNG next to /private/tmp so you can look at it.
