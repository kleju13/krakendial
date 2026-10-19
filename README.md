<img src="assets/icon.svg" width="160" height="160" alt="">

# KrakenDial

[Polski](README.pl.md)

An open-source dial for the NZXT Kraken Elite LCD (640×640), shown through the Web Integration mode of NZXT CAM. It shows:

- CPU, GPU and liquid temperatures, CPU and GPU load and power, RAM and the time;
- optionally, your Claude (5h, 7d) and Codex (7d) usage limits with a pace marker, and what they cost, from a usage source you run yourself;
- your own faces, built in the editor from values, gauges, bars, graphs, text, pictures and mascots.

The dial and the settings are in English or Polish.

![Six of the layouts](docs/img/dials.png)

Not affiliated with or endorsed by NZXT. NZXT, CAM and Kraken are trademarks of NZXT, Inc.

## How it works

A small Rust service (`krakendial.exe`, no window but an icon in the tray, about 14 MB of RAM) serves the dial at `http://127.0.0.1:30640/`. CAM loads that page on the cooler and pushes its sensor readings into it. The service keeps your settings and faces, and polls the usage source if you set one.

- It listens on 127.0.0.1 only.
- Settings can be changed only from its own pages. Other sites open in your browser can't change them, and requests addressed to any other host name are refused.
- It connects only to the usage source you enter, and to GitHub once at each start to look for a new release. No telemetry.

## Install

Windows with NZXT CAM and a Kraken Elite. In PowerShell:

```powershell
irm https://raw.githubusercontent.com/kleju13/krakendial/main/scripts/install.ps1 | iex
```

This downloads the latest [release](https://github.com/kleju13/krakendial/releases), checks it against the SHA-256 published with it, copies it to `%LOCALAPPDATA%\krakendial`, adds it to the Start menu and starts it now and at every logon. The exe is not code-signed. Running the same line again updates it. From 0.3.0 on, *Updates* on the settings page does too: it downloads the new release, checks its SHA-256 and restarts KrakenDial.

From a clone with [Rust](https://rustup.rs) installed, `.\scripts\install.ps1` builds it instead of downloading. `.\scripts\uninstall.ps1` stops it and removes the autostart and the Start menu entry; `-Purge` also deletes settings, faces and media. [ffmpeg](https://ffmpeg.org) is optional; it shrinks your own videos to 640×640.

In NZXT CAM: **Lighting** → the Kraken's **Mode** → **Web Integration** → **Custom Mode** → **Edit**, URL `http://127.0.0.1:30640/`.

## Tray icon

While KrakenDial runs, its icon is in the Windows tray. Windows 11 may put a new icon under **^**; drag it out to keep it in sight.

- **Blue:** the cooler gets the dial.
- **Grey:** CAM sends nothing, so the dial isn't on the cooler.
- **Red dot:** the usage source fails.

Click it for the status, **Open settings**, **Face editor**, **Copy address for CAM** (`http://127.0.0.1:30640/`), **Hide icon…** and **Quit KrakenDial**.

A hidden icon comes back with **Tray icon** → **Shown** in the settings, or when KrakenDial is started again from the Start menu. After **Quit**, the Start menu starts it again.

## Settings

CAM's **Configure** button, or `http://127.0.0.1:30640/` in a browser, opens the settings with a live preview. A choice reaches the cooler within about 3 seconds.

- **Layout:** 17 built-in layouts, plus your own faces.
  - Round dials: Cockpit, Chronograph, Columns, Clock, One number, Limits only, Hardware only.
  - Rotation (limits and hardware in turns) and Adaptive (hardware while the GPU is busy). These two and Limits only need a usage source.
  - Terminal-style: Terminal, htop, btop, neofetch, fastfetch, pfetch, macchina, cpufetch. The fetch layouts have a mascot (Kraken, Crab, Ghost, Cat or Robot) that blinks, looks around and walks a little.
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

## Face editor

`http://127.0.0.1:30640/editor`, or **My faces** in the settings. Start from a template or a blank face:

- add widgets from the palette;
- drag them on the dial; they snap to the centre and to each other;
- resize them by the corner handle;
- change everything else in the properties panel.

Undo, redo, layers, duplicating, and import and export as JSON are all there. Changes save as you go. **Show on the cooler** puts the face on the dial.

![The face editor](docs/img/editor.png)

The faces are JSON files in `%LOCALAPPDATA%\krakendial\faces`. Their format is in [docs/faces.md](docs/faces.md).

## Usage limits and costs

The dial does not talk to Claude or Codex and never reads their tokens. Instead it reads one JSON summary from a URL you set in **Usage source**, or with the `KRAKENDIAL_USAGE` environment variable before the first start. The summary is polled every minute, and 15 s after the source says it refreshed.

You make that source yourself. KrakenDial doesn't ship one and won't, because everyone gets these numbers differently. Anything that answers `GET` with the JSON will do. The format is in [docs/usage-source.md](docs/usage-source.md).

Each layout shows the limits that are switched on and that the source sends, and the cost if it sends one, and closes up around the rest. Without a source the layouts show only the hardware, with the date where the sync status was. Rotation, Adaptive and Limits only then show Hardware only, and the settings leave them out.

## Development

- `http://127.0.0.1:30640/lcd?mock` is the bare dial with made-up hardware readings.

  `layout`, `theme`, `bg`, `units`, `look`, `mascot`, `bars`, `cost`, `limits`, `fps` and `lang` force a variant, e.g. `/lcd?mock&layout=neofetch&theme=tokyo&mascot=ghost&lang=pl`. A face goes as `layout=face:<id>`. `limits=claude5h,codex7d` picks limits, `limits=none` switches them all off.
- Start the exe with `KRAKENDIAL_WEB=<repo>\web` to serve the web files from disk, without rebuilding. Open pages reload themselves when the service restarts.
- `cargo test` runs the service tests. `node tests/web.js` builds every layout, template and widget in both languages on a fake DOM.
- Logs, settings, faces and media are in `%LOCALAPPDATA%\krakendial`.

How the code is laid out, and how to add a layout, theme, background, widget or language: [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Copyright (C) 2026 kleju13 and KrakenDial contributors.

[GNU AGPL v3](LICENSE). Use it, change it and share it freely, at work too. If you pass on a changed version, or run one for other people over a network, you must publish its source under the same license.
