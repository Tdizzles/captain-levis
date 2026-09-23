# Building a service page — the recipe

Reference for building the remaining service pages (`hull-repairs.html`,
`deck-repairs.html`, `transom-replacement.html`, `stringer-repairs.html`,
`bulkhead-repairs.html`, `custom-fabrication.html`, and later `detailing.html`,
`boat-yard.html`, `services.html`).

`structural-fiberglass-repair.html` + `structural.css` are the worked example.
Read this first, then copy that pair and swap the content.

---

## 0. The one rule

**The design system already exists in `styles.css`. A new page adds content, not
a new visual language.** Before writing any CSS, check whether the thing you
need is already built. Most of it is. Every new rule you write is a thing that
can drift from the homepage.

---

## 1. File layout

```
index.html                          homepage
structural-fiberglass-repair.html   service page (the template)
styles.css                          shared: tokens, header, footer, buttons,
                                    eyebrows, cards, contact form, chat widget
structural.css                      page-specific sections only, all .sfr- prefixed
script.js                           shared: nav, dropdown, sliders, form, chat
assets/                             all imagery
```

**A new page gets its own stylesheet** (`hull-repairs.css`, …) loaded *after*
`styles.css`, with its own class prefix. Never edit another page's stylesheet.

```html
<link rel="stylesheet" href="styles.css?v=20260923-sfr">
<link rel="stylesheet" href="hull-repairs.css?v=20260923-hull">
...
<script src="script.js?v=20260923-sfr"></script>
```

**Cache-bust convention:** `?v=YYYYMMDD-slug`. When you change `styles.css` or
`script.js`, bump the version string **on every page that links them**, or
returning visitors get the old file. This bit me — the dropdown CSS is in
`styles.css`, so `index.html` had to be bumped too.

---

## 2. Design tokens

From `:root` in `styles.css`. Use the variables, never the hex values.

| Token | Value | Used for |
|---|---|---|
| `--navy` | `#00264B` | body text, headings, dark bands |
| `--navy-2` | `#001C3B` | darker band ends, gradient starts |
| `--accent` | `#5ECDFA` | eyebrow rules, accent text on dark |
| `--accent-btn` | `#7FE1FD` | primary CTA fill, step number badges |
| `--gray-text` | `#5C7488` | body copy / descriptions |
| `--light-bg` | `#F4F9FE` | alternating light section background |
| `--icon-bg` | `#DCEEFC` | icon circle fill on light |
| `--icon-blue` | `#1C94DC` | accent text on light, card links |
| `--container` | `1536px` | max content width |
| `--pad` | `clamp(20px,6vw,127px)` | container side padding |

Fonts: `--font-head` (Plus Jakarta Sans, headings/buttons/labels),
`--font-body` (Inter, copy), `--font-script` (Caveat, taglines).

**Useful number:** at a 1905px viewport the `.container` inner content is
**1282px**. Mockups are drawn at **1536px**. When a mockup measurement needs
converting, scale by the ratio of the container content widths, not the
viewport widths.

---

## 3. Reuse inventory — do not rebuild these

| Need | Use | Where |
|---|---|---|
| Header + nav + dropdown | copy the `<header class="site-header">` block verbatim | `styles.css` |
| Footer | copy `<footer class="site-footer">` verbatim | `styles.css` |
| Chat widget | copy the `<div class="chat-widget">` block verbatim | `styles.css` + `script.js` |
| Quote form section | copy `<section class="contact" id="quote">` verbatim | `styles.css` |
| Buttons | `.btn` + `.btn-accent` / `.btn-navy` / `.btn-outline-light` | `styles.css` |
| Section label | `.eyebrow` + `.eyebrow-light` (on dark) / `.eyebrow-dark` (on light) / `.eyebrow-left` | `styles.css` |
| Script tagline | `.script-tagline` (has the swoosh underline via `::after`) | `styles.css` |
| 6-up photo card grid | `.container.fg-grid` > `.fg-card` > `.fg-card-media` / `.fg-card-icon` / `.fg-card-body` / `.fg-card-link` | `styles.css` |
| Before/after slider | `.sfr-ba` markup block | `structural.css` + `script.js` |

The card grid is the big one. `.fg-*` already handles the image, the overlapping
navy icon badge, the hover lift, and the 6→3→2→1 column collapse. Reusing it is
why the service page's card row is pixel-consistent with the homepage's.

**Copy the header/footer/chat/contact blocks byte-for-byte** between pages, then
change only: `<title>`, `<meta name="description">`, the `aria-current="page"`
marker in the nav dropdown, the contact-section lead sentence, the `<select>`
options, and the chat greeting.

---

## 4. Page skeleton

```
header.site-header                 ← shared
section.XXX-hero                   ← photo + scrim + copy + script tagline
section.XXX-services  #services    ← centered head + .fg-grid of cards
section.XXX-process                ← dark band: photo | copy | numbered steps
section.XXX-results   #repairs     ← copy | before/after sliders
section.XXX-why                    ← copy | 4 features | full-bleed photo
section.XXX-areas                  ← skyline band: copy | pins | script | CTA card
section.contact       #quote       ← shared
footer.site-footer                 ← shared
div.chat-widget                    ← shared
```

Alternate light and dark bands down the page. The rhythm on the structural page
is: dark hero → light cards → dark process → white results → light why → dark
areas → light contact.

Every `#quote` / `#repairs` / `#services` anchor already clears the sticky
header via `scroll-margin-top` in `styles.css`. Keep using those ids.

---

## 5. Section recipes

Padding everywhere is `clamp(mobile, fluid-vw, desktop)` so sections shrink on
phones without a media query. Only structural changes (column counts, stacking)
go in media queries.

### Hero
`<img>` absolutely positioned with `object-fit:cover` + a separate scrim div —
**not** a CSS `background-image`. The `<img>` gets `fetchpriority="high"` and
real `width`/`height` attributes so the browser reserves space.

```css
.XXX-hero-img{ position:absolute; inset:0; width:100%; height:100%;
               object-fit:cover; object-position:60% center; }
```

`object-position` is the tuning knob. `hero.jpg` is 1536×319 with the boat at
46–84% of the width; at tall viewports `cover` crops the sides, so `60%` keeps
the boat in frame. **Work out the crop before guessing:** with a visible width
fraction `f`, an `object-position` of `X` shows the range `[X(1−f), X(1−f)+f]`.

Scrim is a two-layer gradient — a strong left-to-right wash for text contrast
plus a light top-down one. On phones (`≤640px`) swap it for a top-to-bottom
wash, because the copy is full width there.

The script tagline sits over the photo, so it carries its own contrast:
`text-shadow:0 2px 16px rgba(0,22,46,.8), 0 1px 4px rgba(0,22,46,.65)` and
`transform:rotate(-7deg) translateY(-26%)` to lift it clear of the subject.

### Services card grid
Centered `.XXX-section-head` (eyebrow + h2 + lead, `max-width:860px`,
`margin-inline:auto`), then `<div class="container fg-grid">` with six
`<article class="fg-card" id="slug">`. Give each card an `id` — the nav and
cross-links use them.

### Process band
```css
.XXX-process      { display:grid; grid-template-columns:minmax(260px,27%) minmax(0,1fr); }
.XXX-process-body { display:grid; grid-template-columns:minmax(260px,31%) minmax(0,1fr); }
```
The photo gets a chevron notch on its trailing edge:
```css
clip-path:polygon(0 0, calc(100% - 38px) 0, 100% 50%, calc(100% - 38px) 100%, 0 100%);
```
Drop the `clip-path` at `≤1024px` when it stacks.

`svc-worker.jpg` has the pull-quote **baked into the image** — do not overlay
text on it. It needs `object-position:10% center` so the quote survives the crop.

Step cards: `position:relative` with the number badge and icon both absolutely
positioned overlapping the top edge (`top:-15px` / `top:-14px`), and
`padding-top:34px` on the card to clear them. This is more robust than trying to
lay them out in flow.

### Before/after sliders
Two stacked divs with `background-image` set inline, the top one clipped with
`clip-path:inset(0 0 0 N%)`. JS drives `N`. Needs
`touch-action:none; user-select:none; cursor:ew-resize` on the container.

Markup must include `role="slider"`, `tabindex="0"`, `aria-valuemin/max/now` and
an `aria-label` — `script.js` updates `aria-valuenow` on drag and supports
arrow keys. The handler auto-binds to every `.sfr-ba` on the page, so extra
sliders need no JS.

`aspect-ratio:2/1` desktop. `BEFORE` / `AFTER` chips are absolutely positioned
bottom-left and bottom-right; **omit them when the source image already has
labels burned in** (`before-after.jpg` does).

### Why band
Full-bleed photo pinned to the right edge, content padded to clear it:
```css
.XXX-why-inner{ padding-right:clamp(200px,20vw,380px); }
.XXX-why-photo{ position:absolute; top:0; right:0; bottom:0;
                width:clamp(190px,20vw,380px); }
```
At `≤1024px` the photo goes `position:static; width:100%` with a fixed
`aspect-ratio` and the padding reverts to `var(--pad)`.

### Areas band
`grid-template-columns: minmax(0,1fr) auto auto minmax(340px,1fr)` —
copy | pins | script | CTA card. The CTA card's `min-width` of 340px is what
keeps its two buttons on one row; below that they wrap, which is fine.

Pins are a `repeat(2,auto)` grid collapsing to one column at `≤400px`.

---

## 6. Assets

| File | Size | Content | Used as |
|---|---|---|---|
| `hero.jpg` | 1536×319 | boat running, skyline, flat blue left third | hero |
| `svc-worker.jpg` | 816×334 | technician grinding, **quote baked in** | process band |
| `svc-collision.jpg` | 451×170 | hole punched through hull | Hull Repairs |
| `svc-hull-deck.jpg` | 451×170 | deck fitting, damaged surface | Deck Repairs |
| `svc-transom.jpg` | 451×170 | stripped transom bay, bare wood | Transom Replacement |
| `svc-structural.jpg` | 451×170 | laminate being wet out | Stringer Repairs |
| `card-structural.jpg` | 305×90 | plywood bulkheads in a hull | Bulkhead Repairs |
| `svc-custom.jpg` | 451×170 | moulded white console parts | Custom Fabrication |
| `svc-gelcoat.jpg` | 451×170 | buffing gelcoat | Gelcoat |
| `areas-boat.jpg` | 746×372 | finished boat, angled white corner | why-band photo |
| `results-marina.jpg` | 2200×1467 | marina + skyline + palms | areas band background |
| `contact-bg.jpg` | 1672×878 | bow at dusk | contact section |
| `areas-coast.jpg` | 1876×1360 | faded skyline + palms | alt dark background |
| `before-after.jpg` | 443×179 | side-by-side, labels burned in | genuine slider pair |

**Check the source resolution against the rendered size before picking an
image.** `.fg-card-media img` is `aspect-ratio:16/9`; at six-up on a 1536
container each card renders ~230px wide. A 451×170 source cropped to 16/9 shows
~52% of its width — fine. `card-structural.jpg` at 305×90 is the weakest of the
set and upscales ~1.4×; acceptable but replace it when a better photo exists.

Every `<img>` needs `width`/`height` attributes matching the natural size
(`styles.css` sets `img{height:auto}` so CSS stays in charge of display size),
plus `loading="lazy" decoding="async"` on everything below the fold.

---

## 7. Responsive ladder

`structural.css` uses: **1400, 1240, 1100, 1024, 820, 640, 400** (all
`max-width`), plus one `min-width:1025px` for a desktop-only type tweak.

What changes where:

- **1400** — areas band drops from 4 columns to 3
- **1240** — process body stacks; steps go 4→2; results stack; why stacks
- **1100** — hero script moves below the copy
- **1024** — the nav breakpoint. Header collapses to hamburger; process photo
  loses its notch and becomes a banner; sliders 3→2; why photo goes static;
  areas band fully stacks
- **820** — why features 4→2; type eases down
- **640** — phone. Everything single-column, buttons full width, padding and
  type step down hard
- **400** — pin list 2→1 column

**1024 is the hinge.** Anything tied to the desktop nav layout belongs on one
side or the other of it.

### Gotcha: desktop-only type tricks must be scoped

Tightening a label so it holds one line in a narrow desktop column will overflow
on a phone. Scope it:

```css
@media (min-width:1025px){
  .XXX-why-copy .eyebrow span{ white-space:nowrap; }
}
```

I shipped an unscoped `white-space:nowrap` and it pushed 7px past the viewport
at 320px. Caught by the overflow sweep below.

---

## 8. How to verify 1:1 — measure, don't eyeball

Screenshots from the browser extension come back at inconsistent scales and
crops, so **they are not reliable for measurement**. Two artifacts to expect:
captures that look horizontally clipped when the page is fine, and
`getComputedStyle` returning stale values mid-transition. Use screenshots to
judge *design*; use JS to judge *layout*.

Serve the site first — `file://` works but a server matches production:

```bash
cd /c/Users/1234/captain-levis && python -m http.server 8777 --bind 127.0.0.1
```

### Overflow sweep across every breakpoint

Loads the page in a sized iframe and reports anything crossing the viewport edge.
Run it from the console on any page in the same origin.

```js
window.__test = async (w) => {
  const f = document.createElement('iframe');
  f.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:900px;border:0;z-index:99999;background:#fff`;
  f.src = 'structural-fiberglass-repair.html';
  document.body.appendChild(f);
  await new Promise(r => f.addEventListener('load', r, {once:true}));
  await new Promise(r => setTimeout(r, 800));
  const d = f.contentDocument, W = d.documentElement.clientWidth, bad = [];
  d.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > W + 1 || r.left < -1))
      bad.push(el.tagName + '.' + String(el.className).split(' ')[0]);
  });
  const res = { w: W, ovf: d.documentElement.scrollWidth - W,
                h: d.documentElement.scrollHeight, bad: [...new Set(bad)].slice(0,6) };
  f.remove();
  return res;
};
const out = [];
for (const w of [320,390,480,768,1024,1280,1600]) out.push(await window.__test(w));
JSON.stringify(out, null, 1)
```

Pass = `ovf: 0` and `bad: []` at every width.

### Line-break check

The mockup's line breaks are part of the design. This counts rendered lines so
you can tell a heading is wrapping when it shouldn't:

```js
const lines = (sel) => {
  const el = document.querySelector(sel); if (!el) return null;
  const cs = getComputedStyle(el);
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.15;
  return Math.round(el.getBoundingClientRect().height / lh);
};
lines('.sfr-process-copy h2')   // expect 1
```

### When a heading wraps, measure the shortfall

Don't guess a font size — clone the node, force `nowrap`, measure, compare to
the column:

```js
const probe = (sel) => {
  const el = document.querySelector(sel);
  const c = el.cloneNode(true);
  c.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;width:auto;';
  el.parentNode.appendChild(c);
  const w = c.getBoundingClientRect().width; c.remove(); return Math.round(w);
};
probe('.sfr-results-copy h2')  // 376px needed
// column measured 310px → widen the column, drop the size, or both
```

That's how the four wrapping headings got fixed: `Built Right. Step by Step.`
(widened the copy column 27%→31%, size 34→31px), `Before & After Repairs`
(column 23%→26%, size 36→30px), `Experience You / Can Count On` (column
23%→29%), and the why-band eyebrow (11px / 1.3px tracking / 22px rule, desktop
only).

### Asset + behaviour checks

```js
// every referenced asset returns 200, no broken <img>
const urls=[...new Set([...document.querySelectorAll('img[src]')].map(i=>i.getAttribute('src'))
  .concat([...document.querySelectorAll('link[rel=stylesheet]')].map(l=>l.getAttribute('href')))
  .concat([...document.querySelectorAll('script[src]')].map(s=>s.getAttribute('src')))
  .concat([...document.querySelectorAll('.sfr-ba-img')].map(e=>(e.style.backgroundImage.match(/url\(["']?([^"')]+)/)||[])[1]))
  .filter(Boolean))];
const r={}; for(const u of urls){ if(!/^https?:/.test(u)) r[u]=(await fetch(u,{method:'HEAD'})).status; }
JSON.stringify({assets:r, broken:[...document.querySelectorAll('img')].filter(i=>i.complete&&i.naturalWidth===0).length})
```

```bash
# internal links resolve
grep -o 'href="[^"#:]*\.html[^"]*"' page.html | sed 's/href="//;s/"$//;s/#.*//' \
  | sort -u | while read t; do [ -f "$t" ] && echo "OK $t" || echo "MISSING $t"; done

# CSS braces balance
grep -o '{' file.css | wc -l; grep -o '}' file.css | wc -l

# JS parses
node --check script.js
```

---

## 9. Shipping checklist

- [ ] `<title>` and `<meta name="description">` written for this page
- [ ] Header/footer/chat/contact copied verbatim from the template
- [ ] `aria-current="page"` on this page's entry in the nav dropdown
- [ ] Contact `<select>` options relevant to this page
- [ ] Every `<img>` has `width`/`height`; below-fold ones have `loading="lazy" decoding="async"`
- [ ] Decorative images `alt=""` + `aria-hidden="true"`; meaningful ones described
- [ ] Icons inside labelled elements are `aria-hidden="true"`
- [ ] Cache-bust `?v=` bumped on **every** page if shared files changed
- [ ] Overflow sweep clean at 320→1600
- [ ] Line-break check on every heading the mockup breaks deliberately
- [ ] All assets 200, no broken images, no console errors
- [ ] Dropdown works on desktop (hover) and mobile (accordion)
- [ ] Sliders drag, respond to arrow keys, update `aria-valuenow`
- [ ] Internal link audit run; any 404 is deliberate and recorded below

---

## 10. Known debt

- **Missing pages still linked.** `services.html`, `detailing.html`,
  `boat-yard.html` were referenced from `index.html` before this work and still
  404. The six sub-repair pages linked from the structural page's "Learn More"
  buttons are the ones being built next. The nav dropdown deliberately links
  only to pages that exist, so the global nav never 404s — keep it that way.
- **`index.html` still has ten `services.html#…` links** across eight anchors
  (`fiberglass-repair` ×2, `gelcoat-repair` ×2, `collision-repair`,
  `collision-damage`, `bottom-repair`, `hull-deck-repair`, `transom-stringers`,
  `custom-fiberglass`). Re-point these as each real page lands.
- **Two of the three before/after pairs are placeholders** — a damage photo
  paired with a different finished photo, flagged with HTML comments in the
  markup. Only the third (`before-after.jpg`) is a genuine pair. Swap in real
  pairs when available.
- **`card-structural.jpg` is 305×90** and upscales slightly in the card grid.
- **The contact form does not submit anywhere.** `script.js` blocks submit,
  disables the fields and reveals `.form-success`. The reCAPTCHA checkbox is
  decorative markup, not real reCAPTCHA. Wire both up before launch.
