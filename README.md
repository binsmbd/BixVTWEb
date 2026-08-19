# Bix Transform

**Turn any image into something you can actually use again** — editable vectors, pixel art,
halftone separations, plotter-ready line art, stipple drawings, mosaics and more.
Everything runs in the browser. No uploads, no server, no build step.

Bix Transform is the image-conversion tool of the **Bix** family: sixteen transforms,
each with a full parameter set and hand-tuned presets, a live canvas with
before/after comparison, and exports that drop straight into Illustrator, Figma,
Affinity, Inkscape, Aseprite or a pen plotter.

---

## Run it

**Just want to open it?** Double-click the launcher for your system:

| System | File |
| --- | --- |
| macOS | `start.command` |
| Windows | `start.bat` |
| Linux | `start.sh` |

The launcher starts a local server, opens your browser at the app, and prints the
address in case you want a second window. Press `Ctrl+C` in that window to stop it.

It uses Node.js when it's installed and falls back to Python automatically. If
neither is available it tells you where to get Node. (On macOS, the first launch
may need `chmod +x start.command`, or right-click → Open to get past Gatekeeper.)

**From a terminal:**

```bash
npm start                      # start and open the browser
npm run serve                  # start without opening a browser
npm run network                # also serve to phones/tablets on your Wi-Fi
node server.mjs --port 8080    # pick your own port
```

If the port is busy the server quietly moves to the next free one and tells you
where it landed. It serves the folder it lives in, so the launchers work no matter
which directory you start them from.

A server *is* required — browsers refuse to load ES modules over `file://`, so
opening `index.html` directly will not work.

**Seeing `404 Not Found`?** The launcher window prints the folder it is serving —
check that it is the Bix Transform folder, the one holding `index.html`. The
usual cause is a launcher (or `server.mjs`) that got moved out of the project
folder; the launcher now refuses to start in that case and says so. Requests
that 404 are logged in that window too, so you can see exactly which address
failed.

Then drop in an image, or start from one of the built-in sample images —
they're drawn procedurally in code, so the app is fully usable offline.

---

## The transforms

### Vector — real, editable paths

| Transform | What it does |
| --- | --- |
| **Color Trace** | Quantises to a palette, cleans up specks, then traces every colour region into Bézier paths. Layered, named, and seam-free. |
| **Stencil / Screenprint** | Threshold or multi-level posterisation traced as stacked ink layers — cutting files, stencils, screen prints. |
| **Centerline / Plotter** | Skeletonises strokes into *single-line* paths. The format pen plotters, laser engravers and CNC actually want. |

The tracer walks the exact pixel boundary rather than sampling a grid, so adjacent
colour regions share identical vertices — no hairline gaps between shapes. Curve
fitting keeps deliberate corners sharp while smoothing away pixel stair-stepping,
controlled by **Corner threshold** and **Corner min length**.

### Pixel

| Transform | What it does |
| --- | --- |
| **Pixel Art** | Grid sampling (average / nearest / median / dominant), 20 built-in palettes, 13 dither kernels, and shaped pixels (square, circle, diamond, cross, hex). Exports as raster **and** as an SVG of merged runs. |

### Print

| Transform | What it does |
| --- | --- |
| **Halftone Screen** | Dots, lines, crosses, rings and triangles at any screen angle — including genuine 4-colour CMYK separations with correct 15°/75°/0°/45° angles. |
| **ASCII Mosaic** | Character-grid rendering with ten ramps. Exports as SVG, raster, or plain `.txt` you can paste anywhere. |

### Geometric

| Transform | What it does |
| --- | --- |
| **Low Poly** | Edge-weighted point sampling → Delaunay triangulation → shaded facets. |
| **Mosaic / Tessellation** | Voronoi shards, hex tiles, brickwork, diamonds and fish scales, with grout and rounding. |
| **Stipple / Dots** | Weighted dot fields with Lloyd relaxation — ink-drawing density that follows tone. |

### Line

| Transform | What it does |
| --- | --- |
| **Flow & Line Art** | Six line systems: flow field, sine weave, spiral portrait, concentric rings, radial burst and woven grid. Stroke width follows the image, so every line is a tapered ribbon. |
| **Cross Hatch** | Engraving-style hatching: each tonal band adds another pen pass at a new angle, with hand jitter and overshoot. |
| **Contour Map** | Iso-luminance curves — any photo becomes a topographic map, as lines, filled bands, or both. |

### Tone & Artistic

| Transform | What it does |
| --- | --- |
| **Posterize & Duotone** | Tone banding, gradient mapping, duotone/tritone inks, threshold, and palette lock. |
| **Painterly** | Oil (Kuwahara), watercolour wash, graphite pencil, charcoal and comic ink. |
| **Edge & Glow** | Sobel / Canny / DoG / emboss rendered as technical ink, neon, blueprint, chrome or spectral gradient. |
| **Glitch Lab** | RGB channel splitting, slice displacement, pixel sorting, scanlines, bloom and vignette. |

---

## Everything is adjustable

* **Image tab** — exposure, contrast, gamma, black/white points, saturation, vibrance,
  hue, temperature, edge-aware denoise, blur and sharpen. Applied before every transform.
* **Presets** — 5–6 tuned starting points per transform, plus your own saved presets
  (kept in `localStorage`).
* **Live preview** with a working-resolution cap so sliders stay responsive; exports
  re-render at full quality.
* **Compare** — result, split (Shift-drag the divider), side by side, or hold **B** to
  peek at the original.
* **Undo / redo** across every parameter change.

## Export

| Format | Notes |
| --- | --- |
| **SVG** | True paths, grouped and labelled with `data-bix-layer`. Editable anywhere. |
| **PNG / JPEG / WebP** | 0.5× to 4× the source size, with transparent / white / black backgrounds. |
| **TXT** | Plain-text art from the ASCII transform. |
| **GPL / JSON** | Extracted palettes for GIMP, Aseprite or your own tooling. |

Copy-to-clipboard works for every format.

## Keyboard

| | |
| --- | --- |
| `F` / `0` | Fit / 100% |
| `+` `−` / wheel | Zoom (zooms about the pointer) |
| drag | Pan · double-click to fit |
| hold `B` | Peek at the original |
| `R` / `S` | Result / split compare |
| Shift-drag | Move the split divider |
| `1`–`9` | Jump to a transform |
| ⌘/Ctrl `Z` · ⇧⌘`Z` | Undo · redo |
| ⌘/Ctrl `O` · `E` | Open · export |

---

## How it is built

```
index.html            shell markup
css/app.css           interface styles
js/
  main.js             entry point
  core/               store (state + undo), pipeline, image I/O, utilities
  image/              colour spaces, filters, adjustments, quantisation, dithering
  geom/               contour tracing, polyline simplification, Delaunay, Voronoi, sampling
  transforms/         the sixteen transforms + registry
  export/             SVG assembly, rasterisation, palette files
  ui/                 control builder, canvas viewport, application wiring
server.mjs            dependency-free static server + browser launcher
start.command         double-click launcher (macOS)
start.bat             double-click launcher (Windows)
start.sh              launcher (Linux / terminal)
```

The pipeline is a single line of flow:

```
source image → working-resolution fit → image adjustments → transform.run() → SVG or ImageData
```

Notable pieces:

* **`geom/trace.js`** — pixel-boundary contour tracing with consistent winding
  (so SVG's nonzero fill-rule handles holes for free), plus marching squares for
  iso-lines and a skeleton walker for centrelines.
* **`geom/poly.js`** — Ramer–Douglas–Peucker simplification, corner-aware
  Catmull-Rom → cubic Bézier conversion, and variable-width ribbon generation.
* **`image/dither.js`** — seven error-diffusion kernels (Floyd–Steinberg, Atkinson,
  Jarvis, Stucki, Sierra, Sierra Lite, Burkes) plus Bayer 2/4/8, blue noise and a
  clustered-dot screen.
* **`image/quantize.js`** — median cut with k-means refinement, or any of the
  built-in palettes.

### Adding a transform

Drop a module in `js/transforms/` that exports a default object:

```js
export default {
  id: 'my-transform',
  label: 'My Transform',
  group: 'Vector',            // Vector | Pixel | Print | Geometric | Line | Tone | Artistic
  icon: 'M4 4 L20 20',        // 24×24 SVG path, stroked
  blurb: 'One line describing it.',
  output: 'svg',              // or 'raster'
  params: [ P.group('Section'), P.range('size', 'Size', 1, 40, 1, 8) ],
  presets: [{ name: 'Default-ish', values: { size: 12 } }],
  run(ctx) {
    // ctx.img (adjusted ImageData), ctx.srcWidth / srcHeight (document size), ctx.params
    return { type: 'svg', svg, stats: { shapes: 1 } };
  },
};
```

Register it in `js/transforms/index.js`. The control panel, presets, exports,
undo/redo and persistence all follow from the schema — nothing else to wire up.

## Browser support

Any current Chrome, Edge, Firefox or Safari. Uses ES modules, Canvas 2D,
`ImageData`, `ResizeObserver` and the Clipboard API (copy-to-clipboard degrades
gracefully where images aren't supported).

## Privacy

Every pixel stays on your machine. There is no backend, no analytics and no
network request after the page loads.

---

## สรุปภาษาไทย

**Bix Transform** คือเว็บแอปแปลงรูปภาพในตระกูล Bix ที่ทำงานในเบราว์เซอร์ทั้งหมด
ไม่ต้องอัปโหลดไฟล์ไปที่ไหน มีเครื่องมือแปลง 16 แบบ แบ่งเป็น 7 หมวด:

* **เวกเตอร์** – แปลงเป็นเส้น Bézier จริงที่แก้ไขต่อได้ (Color Trace), ทำสเตนซิล/สกรีนปรินต์
  และเส้นกึ่งกลางสำหรับเครื่องพล็อตเตอร์/เลเซอร์
* **พิกเซล** – พิกเซลอาร์ตพร้อมพาเลตต์สำเร็จ 20 ชุด และ dithering 13 แบบ
* **งานพิมพ์** – ฮาล์ฟโทน (รวมการแยกสี CMYK จริง) และ ASCII
* **เรขาคณิต** – Low poly, โมเสก/Voronoi, สtipple
* **เส้นสาย** – Flow field, คลื่นไซน์, ภาพก้นหอย, ครอสแฮตช์, เส้นชั้นความสูง
* **โทนสี & ศิลป์** – โพสเตอร์ไรซ์/ดูโอโทน, สีน้ำ/สีน้ำมัน/ดินสอ, เส้นขอบ/นีออน, กลิตช์

ทุกตัวปรับค่าได้ละเอียด มีพรีเซ็ตให้เริ่มต้น บันทึกพรีเซ็ตของตัวเองได้
ส่งออกได้ทั้ง **SVG** (เป็นเส้นเวกเตอร์จริง), **PNG/JPEG/WebP** (ขยายได้ถึง 4 เท่า),
ไฟล์ข้อความ และไฟล์พาเลตต์สี — นำไปใช้งานต่อได้จริงทั้งงานพิมพ์ งานตัดสติกเกอร์
และงานออกแบบ

**วิธีเปิดใช้งาน** — ดับเบิลคลิกไฟล์ตัวรันตามระบบที่ใช้ได้เลย:
`start.command` (macOS) · `start.bat` (Windows) · `start.sh` (Linux)
ตัวรันจะเปิดเซิร์ฟเวอร์และเปิดเบราว์เซอร์ให้อัตโนมัติ ถ้า port ชนก็ขยับไปตัวถัดไปเอง
กด `Ctrl+C` ในหน้าต่างนั้นเพื่อปิด

หรือสั่งจากเทอร์มินัล: `npm start` (เปิดเบราว์เซอร์ให้), `npm run serve` (ไม่เปิด),
`npm run network` (ให้มือถือในวง Wi-Fi เดียวกันเข้าใช้ได้)

*ต้องเปิดผ่านเซิร์ฟเวอร์เท่านั้น* — เปิดไฟล์ `index.html` ตรงๆ จะไม่ทำงาน
เพราะเบราว์เซอร์ไม่ยอมโหลด ES modules จาก `file://`

---

MIT licensed.
