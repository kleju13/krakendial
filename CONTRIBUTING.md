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

Before a pull request:

```powershell
cargo test
node tests/web.js
```

`tests/web.js` needs only Node. It builds every layout, face template and widget variant in English and Polish on a fake DOM, and checks that bad faces are cleaned up rather than thrown on. It catches crashes and missing translations, not how things look, so look at your change in a browser too: on the dial, in the settings and in the editor.

## How it fits together

| File | What it does |
|---|---|
| `src/main.rs` | HTTP server on 127.0.0.1:30640, settings, the API, the poller for the usage source |
| `src/limits.rs` | Reading the usage source, limit history and burn rate |
| `src/faces.rs` | Storing faces in `%LOCALAPPDATA%\krakendial\faces` |
| `src/media.rs` | Own backgrounds: upload, ffmpeg, serving |
| `web/index.html` | The page CAM shows on the cooler: takes CAM's sensor data, polls `/api/state`, drives the dial |
| `web/dial.js` | Layouts (`scene*` functions), themes, mascots, the parts they are drawn with, and `KrakenDial.create()` |
| `web/bg.js` | Animated backgrounds, drawn on a canvas |
| `web/faces.js` | Faces: the widgets, their sources and properties, checking and drawing |
| `web/i18n.js` | Every piece of text, in English and Polish |
| `web/config.html` | Settings page |
| `web/editor.html`, `web/editor.js` | Face editor |
| `web/dial.css` | Dial styles and themes |

The release exe embeds the web files, so a release build is a single file.

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
   - `env` has `animate`, `mascot`, `cost` (whether a cost is shown) and `face`.
   - Return a list of updaters `(d) => …`. Each is called about once a second with `d = { now, hw, views, left, bars, unitWord, meta, cost, costs }`.
   - Build with the parts in `dial.js`, e.g. `num`, `arcGauge`, `barGauge`, `limitGauge`, `meta`, `term`.
2. Register it in `SCENES` and `LAYOUTS` (`mascot: true` if it has a mascot).
3. Add its id to `LAYOUTS` in `src/main.rs`.
4. Add `layout.<id>` and `layout.<id>.desc` to `web/i18n.js`.

### A theme

1. Add a `.th-<id>` block to `web/dial.css` with all the variables `.th-ice` has.
2. Add `{ id }` to `THEMES` in `web/dial.js` and the id to `THEMES` in `src/main.rs`.
3. Add `theme.<id>` to `web/i18n.js`.

### A background

1. Add a painter to `PAINT` in `web/bg.js`: `paint(ctx, t, s, p)` draws one frame at time `t` (seconds) on an `s`×`s` canvas, with the theme's colours in `p`. Optional `res` sets the canvas size.
2. Add `{ id }` to `LIST` in `web/bg.js` and the id to `BGS` in `src/main.rs`.
3. Add `bg.<id>` to `web/i18n.js`.

### A face widget

Add an entry to `WIDGETS` in `web/faces.js`:

- `icon`: a character or two for the editor's palette.
- `props`: its properties. The editor makes the controls from these, and `normalize` checks them. Kinds:
  - `number` with `min`, `max` and optionally `step`;
  - `text` and `longtext`;
  - `bool`;
  - `select` with `options`;
  - `source`, with `gauged` if it needs a range;
  - `color`, `media` and `mascot`.

  Give each a `default`. `label`, `hint` and `when(w)` are optional.
- `resize(w, k)`: what changes when it is scaled `k` times by the corner handle.
- `build(g, w, env)`: draws the widget into the SVG group `g` and returns an updater `(d) => …`, or nothing for something static.

Then add `w.<type>` and any new `p.<prop>` keys to `web/i18n.js`. Widgets need no changes on the Rust side: the service stores faces as they come and the pages check them.

A new source goes in `SOURCES` in `web/faces.js`, with `src.<id>` in `web/i18n.js`. Its `read(d)` returns at least `n`, the text to show; add `frac` (0–1) if it can fill a gauge.

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
# bump version in Cargo.toml, commit, then
git tag v0.2.0
git push origin v0.2.0
```

The release workflow builds `krakendial.exe` on a Windows runner, publishes it with its SHA-256 as a GitHub release, and `scripts/install.ps1` picks up the latest one.
