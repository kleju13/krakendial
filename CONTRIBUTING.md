# Contributing

Issues and pull requests are welcome. For anything bigger than a fix, open an issue first, so we can agree on the shape before you spend time on it.

The project is under the [GNU AGPL v3](LICENSE). By opening a pull request you agree that your contribution is licensed under it too. You keep the copyright to what you write; there is no CLA.

## Running it

```powershell
cargo build --release
$env:KRAKENDIAL_WEB = "$PWD\web"     # serve web/ from disk: edit, then reload the page
.\target\release\krakendial.exe
```

Only one copy can listen on port 30640, so stop an installed one first (`Get-Process krakendial | Stop-Process`). Open pages reload by themselves when the service restarts.

- `http://127.0.0.1:30640/lcd?mock` is the dial with made-up hardware, and URL parameters force a variant (see the README).
- `http://127.0.0.1:30640/` is the settings page.
- `http://127.0.0.1:30640/editor` is the face editor.
- `screen=240` (or `320`) on any of the three draws for a smaller Kraken screen; see below.

Before a pull request:

```powershell
cargo test
node tests/web.js
```

`cargo test tray -- --ignored` also puts a real icon in the tray and takes it out again. If you change `src/tray.rs`, click the icon and try every menu item too.

The logo is drawn pixel by pixel in `src/logo.rs`, for the tray, the exe's icon and the favicon. After changing it, run `cargo test logo -- --ignored` to write `assets/icon.svg` again; until you do, a test fails.

`tests/web.js` needs only Node. It builds every layout, gallery face, editor block and widget variant in English and Polish on a fake DOM, checks the gallery files, and checks that bad faces are cleaned up rather than thrown on. It catches crashes and missing translations, not how things look, so look at your change in a browser too: on the dial, in the settings and in the editor.

## How it fits together

| File | What it does |
|---|---|
| `src/main.rs` | HTTP server on 127.0.0.1:30640, settings, the API, the poller for the usage source |
| `src/limits.rs` | Reading the usage source, limit history and burn rate |
| `src/faces.rs` | Storing faces in `%LOCALAPPDATA%\krakendial\faces`, and the gallery |
| `src/media.rs` | Own backgrounds: upload, ffmpeg, serving |
| `src/tray.rs` | The tray icon: status, menu, hiding, and waking the running copy on a second start |
| `src/update.rs` | Updates from GitHub releases: the check at start, the download, and the new exe taking over |
| `src/logo.rs` | The logo, the dial's pixel kraken on a navy tile, at any size |
| `build.rs` | Links the logo into the exe as its icon, makes the favicon, and packs `web/gallery` into one list |
| `web/index.html` | The page CAM shows on the cooler: takes CAM's sensor data, polls `/api/state`, drives the dial |
| `web/dial.js` | Layouts (`scene*` functions), themes, mascots, the parts they are drawn with, and `KrakenDial.create()` |
| `web/bg.js` | Animated backgrounds, drawn on a canvas |
| `web/faces.js` | Faces: the widgets, their sources and properties, the editor's ready blocks, checking and drawing |
| `web/gallery/*.json` | The gallery's faces, one file each |
| `web/i18n.js` | Every piece of text, in English and Polish |
| `web/config.html` | Settings page |
| `web/editor.html`, `web/editor.js` | Face editor |
| `web/dial.css` | Dial styles and themes |

The release exe embeds the web files, so a release build is a single file.

### Screen sizes

Krakens have 640, 320 or 240 px screens, and CAM and camless tell the page which (`window.nzxt.v1.width`). The dial is always drawn in 640×640 units and scaled to the screen, so on a small one the small print shrinks with it. `SIZES` in `dial.js` sorts screens into `large` (480 px and up), `mid` (300 to 479) and `small`:

- On `mid` and `small`, the scene `<svg>` gets `is-mid` or `is-small`, and `dial.css` raises the small print (labels, units, the sync status) to a floor and thickens hairlines. Faces don't get these: they are drawn as made.
- Layouts also leave things out to make room, more on `small` than on `mid`: the reset times under the limits, the subdials' notes, a column. `env.size` says which size a layout is built for.
- Backgrounds are never drawn finer than the screen. Below 480 px their lines get heavier and character backgrounds use fewer, larger cells (`bg.js`, `backdrop().screen()`).
- The LCD page reports the size to the service with the hardware readings, and the settings and the editor preview the dial at it.

Check a layout change at 240, 320 and 640, in both languages: `/lcd?mock&screen=240&layout=<id>` in any browser window. A 640 screen must look exactly as before.

### Performance

CAM renders the page without a GPU and captures every changed frame, so CPU time on the page is what the user pays for.

- Layouts build their SVG once. On each update they change only what differs: `setText`, `setAttr`, `setSpans` and `setNum` in `dial.js` skip writes that change nothing.
- Prefer static SVG plus a few changing nodes to anything that redraws every frame.
- Animations go in backgrounds, which run at the frame rate set in the settings.

## Adding things

Ids are short English words, never shown to users. Names and descriptions go in `web/i18n.js`, under English and, if you can, Polish; a missing Polish key falls back to English.

### A layout

1. Write `sceneYourLayout(p, layer, env)` in `web/dial.js`.
   - `p` is the `<svg>` to draw into (640×640 units).
   - `env` has `animate`, `mascot`, `face`, `size` (`large`, `mid` or `small`, see Screen sizes), and what there is to show of the usage source:
     - `limits`: the entries of `LIMITS` to draw, 0 to 3 of them (switched on and sent by the source);
     - `cost`: whether a cost is shown;
     - `status`: whether there is a sync status to show (limits or a cost); `footer()` shows the date instead when there isn't.
   - Lay the layout out for any number of limits, with or without a cost, and give the room to the hardware when there are none. The layout is built again when what there is to show changes. `node tests/web.js` checks that a layout without a source says nothing about AI.
   - Return a list of updaters `(d) => …`. Each is called about once a second with `d = { now, hw, views, left, bars, unitWord, meta, cost, costs }`.
   - Build with the parts in `dial.js`, e.g. `num`, `arcGauge`, `barGauge`, `limitGauge`, `meta`, `footer`, `term`.
   - Its text is drawn in the classes of `dial.css` (`t-lbl`, `t-sub`, …), so it gets the floor on small screens. Text that can't grow without breaking the layout, like a terminal's grid of characters, stays as drawn: mark the layout `dense`.
2. Register it in `SCENES` and `LAYOUTS` (`mascot: true` if it has a mascot, `needsLimits: true` if it is made of limits only, `hwDesc: true` if it reads differently without them, `dense: true` if its text stays small on small screens; the settings say so there).
3. Add its id to `LAYOUTS` in `src/main.rs`.
4. Add `layout.<id>` and `layout.<id>.desc` to `web/i18n.js`, and `layout.<id>.descHw` with `hwDesc`.

### A theme

1. Add a `.th-<id>` block to `web/dial.css` with all the variables `.th-ice` has.
2. Add `{ id }` to `THEMES` in `web/dial.js` and the id to `THEMES` in `src/main.rs`.
3. Add `theme.<id>` to `web/i18n.js`.

### A background

1. Add a painter to `PAINT` in `web/bg.js`: `paint(ctx, t, s, p)` draws one frame at time `t` (seconds) on an `s`×`s` canvas, with the theme's colours in `p`. Optional `res` sets the canvas size; on a smaller screen the canvas is the screen's size instead, so draw in fractions of `s`. Multiply line widths by `p.thick` (1, up to 2 on a 240 px screen) and lay characters out with `grid()`, which makes cells larger on small canvases.
2. Add `{ id }` to `LIST` in `web/bg.js` and the id to `BGS` in `src/main.rs`.
3. Add `bg.<id>` to `web/i18n.js`.

### A face widget

Add an entry to `WIDGETS` in `web/faces.js`:

- `icon`: a character or two for the editor's palette, and `group`, the palette group it goes in: `text`, `gauge`, `clock` or `decor`.
- `props`: its properties. The editor makes the controls from these, and `normalize` checks them. Kinds:
  - `number` with `min`, `max` and optionally `step`;
  - `text` and `longtext`;
  - `bool`;
  - `select` with `options`;
  - `source`, with `gauged` if it needs a range, or `digits` if it spells the value in seven segments;
  - `color`, `media` and `mascot`.

  Give each a `default`. `label`, `hint` and `when(w)` are optional.
- `resize(w, k)`: what changes when it is scaled `k` times by the corner handle.
- `build(g, w, env)`: draws the widget into the SVG group `g` and returns an updater `(d) => …`, or nothing for something static.

Then add `w.<type>`, `wd.<type>` (a line on what it is, shown as the palette's tooltip) and any new `p.<prop>` keys to `web/i18n.js`. Widgets need no changes on the Rust side: the service stores faces as they come and the pages check them.

A new source goes in `SOURCES` in `web/faces.js`, with `src.<id>` in `web/i18n.js`. Its `read(d)` returns at least `n`, the text to show; add `frac` (0–1) if it can fill a gauge.

### A gallery face

1. Make the face in the editor, starting from a gallery face or a blank one, and **Export** it.
2. Save it as `web/gallery/<id>.json`, with the file name as its `id`. Give it a `group` (`clock`, `gauge`, `retro`, `minimal`, or `ai` if it shows limits or costs) and, usually, its own `theme` and `bg`. A face that uses an own background can't go in the gallery, since the file isn't there for others.
3. Add `gal.<id>` with the Polish name to the Polish dictionary in `web/i18n.js`. The English name is the face's `name`.
4. Run `node tests/web.js`: it checks that every widget and value survives the checks unchanged, and that a face outside `ai` doesn't use the usage source.

With `KRAKENDIAL_WEB` set, the service reads `web/gallery` from disk, so a reload of the settings page shows the change. The release build packs the files into the exe. Keep faces inside the circle: the corners of the 640×640 square show in the square thumbnails, not on the cooler. Look at the face in the settings, where its thumbnail is small, and on the dial, `/lcd?mock&layout=gallery:<id>&theme=<its theme>&bg=<its background>` (a layout forced in the URL leaves the look to the URL and the settings).

### A language

1. Add `{ id, name, locale }` to `LANGS` in `web/i18n.js`. `name` is in the language itself; `locale` is used for dates.
2. Add a dictionary under that id with the keys of the English one. Keys you leave out fall back to English.
3. Add the id to `LANGS` in `src/main.rs`.

The settings page lists languages from `LANGS`, and "Automatic" picks the first one that matches the browser's languages.

Terminal-style layouts keep the English of the tools they imitate (`cpu`, `memory`, `Uptime`); translate their statuses and dates, not their keys.

## Style

- Code, comments and commit messages are in English.
- New source files start with the same two SPDX lines as the others: the license and the copyright.
- Comments say why, briefly. Match the style of the code around them.
- No new runtime dependencies in the web pages. They load straight from the service, with no build step.
- Text shown to users goes through `t()`. Text that comes from users, such as face names and file names, goes in with `textContent`, never `innerHTML`.

## Releases

CI runs `cargo test` and `node tests/web.js` on every push and pull request. A release is a tag:

```powershell
# set version in Cargo.toml (say 0.3.0), commit, then
git tag v0.3.0
git push origin v0.3.0
```

The tag must be `v` plus the version in `Cargo.toml`: the app compares the two to decide whether a release is newer, and the release workflow stops on a mismatch. The workflow builds `krakendial.exe` on a Windows runner, publishes it with its SHA-256 as a GitHub release, and `scripts/install.ps1` picks up the latest one.
