<img src="assets/icon.svg" width="160" height="160" alt="">

# KrakenDial

[Polski](README.pl.md)

An open-source dial for the LCD of NZXT Kraken coolers, shown through the Web Integration mode of NZXT CAM or by [camless](https://github.com/kleju13/camless). It shows:

- CPU, GPU and liquid temperatures, CPU and GPU load and power, RAM and the time;
- optionally, your Claude (5h, 7d) and Codex (7d) usage limits with a pace marker, and what they cost, from a usage source you run yourself;
- 23 ready faces in the gallery, from watch dials and a speedometer to a VFD clock and a CRT terminal;
- your own faces, built in the editor from values, gauges and lamps, needles, seven-segment digits, clock hands, text, pictures and mascots.

The dial and the settings are in English or Polish.

![Six of the layouts](docs/img/dials.png)

Not affiliated with or endorsed by NZXT. NZXT, CAM and Kraken are trademarks of NZXT, Inc.

## How it works

A small Rust service (`krakendial.exe`, no window but an icon in the tray, about 14 MB of RAM) serves the dial at `http://127.0.0.1:30640/`. CAM loads that page on the cooler and pushes its sensor readings into it. The service keeps your settings and faces, and polls the usage source if you set one.

- It listens on 127.0.0.1 only.
- Settings can be changed only from its own pages. Other sites open in your browser can't change them, and requests addressed to any other host name are refused.
- It connects only to the usage source you enter, and to GitHub once at each start to look for a new release. No telemetry.

## Screens

The dial is drawn for the screen it is on, at the size CAM or camless reports:

| Screen | Krakens |
| --- | --- |
| 640×640 | Kraken Elite 2023 and 2024 |
| 320×320 | Kraken Z3 |
| 240×240 | Kraken 2023 |

The Kraken Plus 2024 gets the size it reports. Under camless, the Z3's screen shows only its own display, so KrakenDial reaches it only through CAM.

Below 480 px the small print grows, so it stays readable, and the built-in layouts leave out a few details to make room for it, such as the reset times under the limits. The smaller the screen, the more they leave out. The terminal-style layouts carry the most text and read best on a 640 px screen. Faces are drawn as made. The settings preview everything at the cooler's size, and the face editor shows the face at its real size too.

Only the 640 px Kraken Elite 2024 has run KrakenDial so far. The smaller screens were checked in a browser drawn at their size, not on a cooler.

## Install

Windows with NZXT CAM (or camless) and a Kraken with an LCD. In PowerShell:

```powershell
irm https://raw.githubusercontent.com/kleju13/krakendial/main/scripts/install.ps1 | iex
```

This downloads the latest [release](https://github.com/kleju13/krakendial/releases), checks it against the SHA-256 published with it, copies it to `%LOCALAPPDATA%\krakendial`, adds it to the Start menu and starts it now and at every logon. The exe is not code-signed. Running the same line again updates it. From 0.3.0 on, *Updates* on the settings page does too: it downloads the new release, checks its SHA-256 and restarts KrakenDial.

From a clone with [Rust](https://rustup.rs) installed, `.\scripts\install.ps1` builds it instead of downloading. `.\scripts\uninstall.ps1` stops it and removes the autostart and the Start menu entry; `-Purge` also deletes settings, faces and media. [ffmpeg](https://ffmpeg.org) is optional; it shrinks your own videos to 640×640.

In NZXT CAM: **Lighting** → the Kraken's **Mode** → **Web Integration** → **Custom Mode** → **Edit**, URL `http://127.0.0.1:30640/`. In camless: the LCD's web mode with the same URL (see [its README](https://github.com/kleju13/camless#readme)).

## Tray icon

While KrakenDial runs, its icon is in the Windows tray. Windows 11 may put a new icon under **^**; drag it out to keep it in sight.

- **Blue:** the cooler gets the dial.
- **Grey:** CAM sends nothing, so the dial isn't on the cooler.
- **Red dot:** the usage source fails.

Click it for the status, **Open settings**, **Face editor**, **Copy address for CAM** (`http://127.0.0.1:30640/`), **Hide icon…** and **Quit KrakenDial**.

A hidden icon comes back with **Tray icon** → **Shown** in the settings, or when KrakenDial is started again from the Start menu. After **Quit**, the Start menu starts it again.

## Settings

CAM's **Configure** button, or `http://127.0.0.1:30640/` in a browser, opens the settings with a live preview. A choice reaches the cooler within about 3 seconds.

- **Layout:** 17 built-in layouts, plus faces from the gallery and your own.
  - Round dials: Cockpit, Chronograph, Columns, Clock, One number, Limits only, Hardware only.
  - Rotation (limits and hardware in turns) and Adaptive (hardware while the GPU is busy). These two and Limits only need a usage source.
  - Terminal-style: Terminal, htop, btop, neofetch, fastfetch, pfetch, macchina, cpufetch. The fetch layouts have a mascot (Kraken, Crab, Ghost, Cat or Robot) that blinks, looks around and walks a little.
- **Gallery:** 23 ready faces in five groups: clocks (Classic, Roman, Diver, Pilot, Alarm clock, VFD, Orbit), gauges (Speedometer, Twin needles, Activity rings, LED ring and more), retro and terminal, minimal, and two for AI limits that show up once there is a usage source. A gallery face brings its own theme and background; picking it puts them on, and you can change them afterwards. **Edit a copy** opens it in the editor as a face of your own.
- **Theme:** 22 themes, among them Nord, Tokyo Night, Catppuccin, Dracula, Solarized, Gruvbox and Synthwave.
- **Background:** 18 drawn animations, from liquid and aurora to `donut.c`, fire, Game of Life and pipes. They speed up with GPU load.
- **Own backgrounds:** a video, GIF or picture of your own. It can be drawn tinted to the theme, as it is, or as ASCII characters.
- **Frame rate:** 10, 20 or 30 fps. CAM renders the page without the GPU and spends about 2–3% of one core per frame per second, so 10 is the default.
- **Camless mode:** off by default. Only for [camless](https://github.com/kleju13/camless), which can show the dial instead of CAM. KrakenDial then hands camless its background once, as a loop, and the browser draws only when the numbers change: with a video background, about 8% of one core for the browser and camless together instead of about 38%. A drawn background repeats every 20 seconds, or sooner while GPU load speeds it up. A new one takes a few seconds to prepare, a video about as long as it plays.
- **CPU and GPU bars:** load or temperature, in the terminal layouts.
- **Language:** automatic (from the browser), English or Polski.
- **Usage source:** where the limits and costs come from (see below). Leave it empty if you only want hardware.
- With a usage source, three more:
  - **AI limits:** Claude 5h, Claude 7d and Codex 7d, each on or off.
  - **Limits show:** what is left, or what is used.
  - **Cost:** last 24 h, today, last 7 days, this month, or off.

![Twenty of the gallery's faces](docs/img/gallery.png)

## Face editor

`http://127.0.0.1:30640/editor`, or **My faces** in the settings. A new face starts from one in the gallery or from a blank one; the gallery face stays as it is and you change a copy.

- **Look:** the face's own theme and background, picked from thumbnails, or left to the settings. Own videos, GIFs and pictures can be added right there.
- **Add:** ready blocks (a ring gauge, a speedometer, a watch, a digital clock, CPU and GPU side by side, an LED ring) and single elements in four groups: text and numbers, gauges, clock, decoration. Click one to add it in the middle, or drag it where you want it.
- **On the dial:** drag to move; things snap to the centre and to each other. The corner handle resizes. Drag across empty space to select several, then move, line up, recolour, copy or remove them together.
- **Element:** everything else about what is selected. **Layers** lists it all in drawing order.

Undo and redo, copy and paste between faces, nudging with the arrow keys, and import and export as JSON are all there. Changes save as you go. **Show on the cooler** puts the face on the dial with its look.

![The face editor](docs/img/editor.png)

The faces are JSON files in `%LOCALAPPDATA%\krakendial\faces`. Their format is in [docs/faces.md](docs/faces.md).

## Usage limits and costs

The dial does not talk to Claude or Codex and never reads their tokens. Instead it reads one JSON summary from a URL you set in **Usage source**, or with the `KRAKENDIAL_USAGE` environment variable before the first start. The summary is polled every minute, and 15 s after the source says it refreshed.

You make that source yourself. KrakenDial doesn't ship one and won't, because everyone gets these numbers differently. Anything that answers `GET` with the JSON will do. The format is in [docs/usage-source.md](docs/usage-source.md).

Each layout shows the limits that are switched on and that the source sends, and the cost if it sends one, and closes up around the rest. Without a source the layouts show only the hardware, with the date where the sync status was. Rotation, Adaptive and Limits only then show Hardware only, and the settings leave them out.

## Development

- `http://127.0.0.1:30640/lcd?mock` is the bare dial with made-up hardware readings.

  `layout`, `theme`, `bg`, `units`, `look`, `mascot`, `bars`, `cost`, `limits`, `fps` and `lang` force a variant, e.g. `/lcd?mock&layout=neofetch&theme=tokyo&mascot=ghost&lang=pl`. A face goes as `layout=face:<id>`, a gallery face as `layout=gallery:<id>`. `limits=claude5h,codex7d` picks limits, `limits=none` switches them all off.

  Without CAM or camless, the dial is drawn for a screen the size of the window. `screen=240` draws it for a 240 px screen in a window of any size. `/settings?screen=240` and `/editor?screen=240` preview the dial at that size.
- Start the exe with `KRAKENDIAL_WEB=<repo>\web` to serve the web files from disk, without rebuilding. Open pages reload themselves when the service restarts.
- `cargo test` runs the service tests. `node tests/web.js` builds every layout, gallery face and widget in both languages on a fake DOM.
- Logs, settings, faces and media are in `%LOCALAPPDATA%\krakendial`.

How the code is laid out, and how to add a layout, theme, background, widget or language: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Copyright (C) 2026 kleju13 and KrakenDial contributors.

[GNU AGPL v3](LICENSE). Use it, change it and share it freely, at work too. If you pass on a changed version, or run one for other people over a network, you must publish its source under the same license.
