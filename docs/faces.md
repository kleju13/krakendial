# Face format

A face is a JSON file in `%LOCALAPPDATA%\krakendial\faces\<id>.json`. The editor writes these files; you can also write one by hand, or import one in the editor. The dial and the editor draw faces with the same code, `web/faces.js`.

```json
{
  "version": 1,
  "id": "my-face",
  "name": "My face",
  "widgets": [
    { "type": "arc", "id": "a1", "x": 320, "y": 320, "source": "cpu.temp", "r": 284, "start": -150, "end": -30, "width": 14 },
    { "type": "value", "id": "v1", "x": 320, "y": 330, "source": "cpu.temp", "size": 150 },
    { "type": "text", "id": "t1", "x": 320, "y": 470, "text": "{date}\nGPU {gpu.temp}", "size": 26 }
  ]
}
```

- `id` is 1–40 characters of `a-z`, `0-9` and `-`. The service picks one from the name when a face is first saved. It is also the file name, and the layout is called `face:<id>`.
- `name` is up to 60 characters.
- `widgets` are drawn in order, so later ones are on top. A face holds up to 200 widgets and 256 KB.

## Coordinates

The dial is 640×640 units, with (320, 320) in the middle. The visible part is the circle of radius 320 around it.

The units are scaled to the screen: a unit is a pixel on a 640 px Kraken Elite, half a pixel on a 320 px Kraken Z3 and 0.375 of one on a 240 px Kraken 2023. A face is drawn the same on all of them, so text sized 22 is about 8 px tall on a 240 px screen, too small to read. For the smaller screens, keep text at 30 or more and values at 100 or more, or start from the *Big print* template. The editor shows the face at the screen's real size next to the properties.

Every widget has `type`, `id` (1–16 characters of `a-z0-9`), `x` and `y` (−320 to 960). `x` and `y` are the widget's anchor: the centre of gauges, bars, graphs, shapes and pictures, and the baseline of a value or of the first line of text. Optional fields:

- `hidden: true` keeps a widget in the file but doesn't draw it.
- `name` labels it in the editor's layer list.

Angles are in degrees, clockwise, with 0 at 12 o'clock. A gauge from −150 to −30 sits on the left, from 30 to 150 on the right.

## Checking

Every face is checked before it is drawn, both on the dial and in the editor:

- unknown widget types are dropped;
- a missing or invalid property gets its default;
- numbers are clamped to their range.

A broken file can't break the dial; at worst a widget falls back to its defaults.

## Widgets

| Widget | `type` | Properties |
|---|---|---|
| Value | `value` | `source` (source, default `"cpu.temp"`)<br>`size` (16–280, default `110`)<br>`showLabel` (bool, default `true`)<br>`label` (text, default `""`)<br>`sub` (bool, default `true`)<br>`align` (`start` / `middle` / `end`, default `"middle"`)<br>`color` (color, default `"ink"`) |
| Text | `text` | `text` (longtext, default `"{time}"`)<br>`size` (8–200, default `28`)<br>`font` (`sans` / `mono`, default `"sans"`)<br>`bold` (bool, default `false`)<br>`align` (`start` / `middle` / `end`, default `"middle"`)<br>`color` (color, default `"ink2"`) |
| Arc gauge | `arc` | `source` (gauged source, default `"cpu.temp"`)<br>`r` (16–320, default `284`)<br>`start` (-360–360, default `-150`)<br>`end` (-360–360, default `-30`)<br>`width` (1–60, default `14`)<br>`ticks` (0–60, default `0`)<br>`color` (color, default `"accent"`) |
| Bar | `bar` | `source` (gauged source, default `"limit.claude5h"`)<br>`length` (10–640, default `300`)<br>`width` (1–80, default `10`)<br>`vertical` (bool, default `false`)<br>`color` (color, default `"accent"`) |
| Terminal bar | `cells` | `source` (gauged source, default `"cpu.load"`)<br>`cells` (2–40, default `10`)<br>`size` (8–80, default `22`)<br>`glyph` (`square` / `block` / `dot` / `pipe`, default `"square"`)<br>`value` (bool, default `true`)<br>`color` (color, default `"accent"`) |
| Graph | `graph` | `source` (gauged source, default `"cpu.temp"`)<br>`w` (40–640, default `300`)<br>`h` (16–400, default `90`)<br>`style` (`area` / `line` / `braille`, default `"area"`)<br>`minutes` (1–15, default `2`)<br>`color` (color, default `"accent"`) |
| Clock hands | `hands` | `size` (20–320, default `240`)<br>`seconds` (bool, default `true`) |
| Mascot | `mascot` | `mascot` (mascot, default `"auto"`)<br>`px` (2–16, default `7`)<br>`walk` (0–600, default `200`)<br>`ascii` (bool, default `false`) |
| Sync status | `status` | — |
| Picture | `image` | `src` (media, default `""`)<br>`w` (8–640, default `200`)<br>`h` (8–640, default `200`)<br>`round` (bool, default `true`)<br>`opacity` (0.05–1, default `1`) |
| Shape | `shape` | `kind` (`ring` / `circle` / `rect` / `line`, default `"ring"`)<br>`w` (1–640, default `200`)<br>`h` (0–640, default `200`)<br>`stroke` (0–60, default `2`)<br>`color` (color, default `"track"`)<br>`opacity` (0.05–1, default `1`) |
| Ticks | `ticks` | `r` (10–320, default `300`)<br>`length` (1–80, default `10`)<br>`count` (1–180, default `60`)<br>`start` (-360–360, default `0`)<br>`end` (-360–360, default `360`)<br>`width` (0.5–12, default `1.5`)<br>`color` (color, default `"ink3"`) |

`size` of a value is the height of its digits. `r` is a radius. `w` and `h` are a width and a height. In `cells`, `cells` is the number of characters in the bar. The `mascot` widget's `mascot` is `auto`, which follows the settings, or one of `kraken`, `crab`, `ghost`, `cat` and `robot`. `walk` is how far it may wander sideways. `src` of a picture is `media:<file name>`, a file from **Own backgrounds**. The sync status shows the date while there is no usage source.

## Sources

What a value, gauge, bar or graph shows. Gauged sources have a range, so they can fill a gauge or a bar; the others are text only. Limits fill with what is left or what is used, following the settings.

| Source | Shows | Gauged |
|---|---|---|
| `cpu.temp` | CPU temperature | yes |
| `cpu.load` | CPU load | yes |
| `cpu.power` | CPU power | yes |
| `gpu.temp` | GPU temperature | yes |
| `gpu.load` | GPU load | yes |
| `gpu.power` | GPU power | yes |
| `liquid` | Liquid temperature | yes |
| `power` | Total power | yes |
| `ram` | Memory used | yes |
| `ram.pct` | Memory used, % | yes |
| `limit.claude5h` | Claude 5h limit | yes |
| `limit.claude7d` | Claude 7d limit | yes |
| `limit.codex7d` | Codex 7d limit | yes |
| `cost` | Cost (period from the settings) | no |
| `cost.today` | Cost today | no |
| `cost.last24h` | Cost, last 24 h | no |
| `cost.last7d` | Cost, last 7 days | no |
| `cost.month` | Cost this month | no |
| `time` | Time | no |
| `time.seconds` | Time with seconds | no |
| `date` | Date | no |

In a `text` widget, `{source}` is replaced by the source's value, e.g. `CPU {cpu.temp} · {time}`. A line break in the text starts a new line on the dial.

## Colours

A colour is either a role that follows the theme, or a fixed `#rrggbb`.

| Colour | Means |
|---|---|
| `ink` | Text (`--ink`) |
| `ink2` | Text, quieter (`--ink-2`) |
| `ink3` | Text, faint (`--ink-3`) |
| `accent` | Accent (`--fill`) |
| `accent2` | Accent, light (`--fill-2`) |
| `warn` | Warning (`--warn`) |
| `track` | Track (`--track`) |
