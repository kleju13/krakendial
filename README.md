<img src="assets/icon.svg" width="64" height="64" alt="">

# krakenlcdfree

[Polski](README.pl.md)

A free dial for the NZXT Kraken Elite LCD (640×640), shown through the Web Integration mode of NZXT CAM. It shows:

- CPU, GPU and liquid temperatures, CPU and GPU load and power, RAM and the time;
- optionally, your Claude (5h, 7d) and Codex (7d) usage limits with a pace marker, and what they cost, from a usage source you run yourself;
- your own faces, built in the editor from values, gauges, bars, graphs, text, pictures and mascots.

The dial and the settings are in English or Polish.

Not affiliated with or endorsed by NZXT. NZXT, CAM and Kraken are trademarks of NZXT, Inc.

## How it works

A small Rust service (`krakenlcd.exe`, no window, about 14 MB of RAM) serves the dial at `http://127.0.0.1:30640/`. CAM loads that page on the cooler and pushes its sensor readings into it. The service keeps your settings and faces, and polls the usage source if you set one.

- It listens on 127.0.0.1 only.
- Settings can be changed only from its own pages. Other sites open in your browser can't change them, and requests addressed to any other host name are refused.
- It connects to nothing except the usage source you enter. No telemetry.

## Install

Windows with NZXT CAM and a Kraken Elite. There are no prebuilt releases yet, so you need [Rust](https://rustup.rs). [ffmpeg](https://ffmpeg.org) is optional; it shrinks your own videos to 640×640.

```powershell
.\scripts\install.ps1     # builds, copies to %LOCALAPPDATA%\krakenlcd, starts it now and at every logon
.\scripts\uninstall.ps1   # stops it and removes the autostart (-Purge also deletes settings, faces and media)
```

In NZXT CAM: **Lighting** → the Kraken's **Mode** → **Web Integration** → **Custom Mode** → **Edit**, URL `http://127.0.0.1:30640/`.

## Settings

CAM's **Configure** button, or `http://127.0.0.1:30640/` in a browser, opens the settings with a live preview. A choice reaches the cooler within about 3 seconds.

- **Layout:** 17 built-in layouts, plus your own faces.
  - Round dials: Cockpit, Chronograph, Columns, Clock, One number, Limits only, Hardware only.
  - Rotation (limits and hardware in turns) and Adaptive (hardware while the GPU is busy).
  - Terminal-style: Terminal, htop, btop, neofetch, fastfetch, pfetch, macchina, cpufetch. The fetch layouts have a mascot (Kraken, Crab, Ghost, Cat or Robot) that blinks, looks around and walks a little.
- **Theme:** 22 themes, among them Nord, Tokyo Night, Catppuccin, Dracula, Solarized, Gruvbox and Synthwave.
- **Background:** 18 drawn animations, from liquid and aurora to `donut.c`, fire, Game of Life and pipes. They speed up with GPU load.
- **Own backgrounds:** a video, GIF or picture of your own. It can be drawn tinted to the theme, as it is, or as ASCII characters.
- **Frame rate:** 10, 20 or 30 fps. CAM renders the page without the GPU and spends about 2–3% of one core per frame per second, so 10 is the default.
- **Limits show:** what is left, or what is used.
- **CPU and GPU bars:** load or temperature, in the terminal layouts.
- **Cost:** last 24 h, today, last 7 days, this month, or off.
- **Language:** automatic (from the browser), English or Polski.
- **Usage source:** where the limits and costs come from (see below). Leave it empty if you only want hardware.

## Face editor

`http://127.0.0.1:30640/editor`, or **My faces** in the settings. Start from a template or a blank face:

- add widgets from the palette;
- drag them on the dial; they snap to the centre and to each other;
- resize them by the corner handle;
- change everything else in the properties panel.

Undo, redo, layers, duplicating, and import and export as JSON are all there. Changes save as you go. **Show on the cooler** puts the face on the dial.

The faces are JSON files in `%LOCALAPPDATA%\krakenlcd\faces`. Their format is in [docs/faces.md](docs/faces.md).

## Usage limits and costs

The dial does not talk to Claude or Codex and never reads their tokens. Instead it reads one JSON summary from a URL you set in **Usage source**, or with the `KRAKENLCD_USAGE` environment variable before the first start. The summary is polled every minute, and 15 s after the source says it refreshed.

You need to run something that produces that summary. The format is in [docs/usage-source.md](docs/usage-source.md).

Without a source, the limit and cost parts of the layouts say so quietly. Everything else works.

## Development

- `http://127.0.0.1:30640/lcd?mock` is the bare dial with made-up hardware readings.

  `layout`, `theme`, `bg`, `units`, `look`, `mascot`, `bars`, `cost`, `fps` and `lang` force a variant, e.g. `/lcd?mock&layout=neofetch&theme=tokyo&mascot=ghost&lang=pl`. A face goes as `layout=face:<id>`.
- Start the exe with `KRAKENLCD_WEB=<repo>\web` to serve the web files from disk, without rebuilding. Open pages reload themselves when the service restarts.
- `cargo test` runs the service tests. `node tests/web.js` builds every layout, template and widget in both languages on a fake DOM.
- Logs, settings, faces and media are in `%LOCALAPPDATA%\krakenlcd`.

How the code is laid out, and how to add a layout, theme, background, widget or language: [CONTRIBUTING.md](CONTRIBUTING.md).
