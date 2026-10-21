# Face format

A face is a JSON file in `%LOCALAPPDATA%\krakendial\faces\<id>.json`. The editor writes these files; you can also write one by hand, or import one in the editor. The dial and the editor draw faces with the same code, `web/faces.js`.

The faces in the **Gallery** use the same format. They come with KrakenDial, from `web/gallery/<id>.json`, and can't be changed in place: **Edit a copy** opens one in the editor as a face of your own.

```json
{
  "version": 1,
  "id": "my-face",
  "name": "My face",
  "theme": "night",
  "bg": "stars",
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
- `theme`, `bg` and `look` are optional: the face's own look. Picking the face puts them on the dial, as if picked in the settings, and changing the theme or background in the settings while the face is on the dial saves the change into the face. A face without them takes the look set in the settings.
  - `theme` is a theme id from the settings: `ice`, `deep`, `ocean`, `amber` and so on (the list is `THEMES` in `web/dial.js`).
  - `bg` is a background id (`BGS` in `web/dial.js`, e.g. `none`, `liquid`, `stars`) or `media:<file name>`, a file from **Own backgrounds**.
  - `look` is how an own background is drawn: `plain`, `raw` or `ascii`. It only counts with a `media:` background.

## The gallery

A gallery face is picked as the layout `gallery:<id>`. Its file has one more field, `group`, which places it in the gallery: `clock`, `gauge`, `retro`, `minimal` or `ai`. The `ai` group is for faces that show limits or costs; the settings and the editor only offer it once a usage source is set. Faces in the other groups must not use the usage source. `node tests/web.js` checks that, and that every widget and value in each file comes through the checks below unchanged.

See [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-gallery-face) for adding one.

## Coordinates

The dial is 640×640 units, with (320, 320) in the middle. The visible part is the circle of radius 320 around it.

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
| Value | `value` | `source` (source, default `"cpu.temp"`)<br>`size` (16–280, default `110`)<br>`showLabel` (bool, default `true`)<br>`label` (text, default `""`)<br>`sub` (bool, default `true`)<br>`font` (`sans` / `light` / `serif` / `mono`, default `"sans"`)<br>`align` (`start` / `middle` / `end`, default `"middle"`)<br>`color` (color, default `"ink"`) |
| Segment digits | `segment` | `source` (digit source, default `"time"`)<br>`size` (16–300, default `120`)<br>`prefix` (text, default `""`)<br>`unit` (bool, default `true`)<br>`ghost` (bool, default `true`)<br>`slant` (bool, default `true`)<br>`align` (`start` / `middle` / `end`, default `"middle"`)<br>`color` (color, default `"accent"`) |
| Text | `text` | `text` (text, several lines, default `"{time}"`)<br>`size` (8–200, default `28`)<br>`font` (`sans` / `light` / `serif` / `mono`, default `"sans"`)<br>`bold` (bool, default `false`)<br>`spacing` (0–1, default `0`)<br>`align` (`start` / `middle` / `end`, default `"middle"`)<br>`color` (color, default `"ink2"`) |
| Curved text | `arctext` | `text` (text, default `"KRAKENDIAL"`)<br>`r` (20–320, default `250`)<br>`angle` (-360–360, default `0`)<br>`size` (8–120, default `22`)<br>`font` (`sans` / `light` / `serif` / `mono`, default `"sans"`)<br>`bold` (bool, default `true`)<br>`spacing` (0–1, default `0.3`)<br>`flip` (bool, default `false`)<br>`color` (color, default `"ink2"`) |
| Arc gauge | `arc` | `source` (gauged source, default `"cpu.temp"`)<br>`r` (16–320, default `284`)<br>`start` (-360–360, default `-150`)<br>`end` (-360–360, default `-30`)<br>`width` (1–60, default `14`)<br>`ticks` (0–60, default `0`)<br>`rounded` (bool, default `false`)<br>`track` (bool, default `true`)<br>`color` (color, default `"accent"`) |
| Needle | `needle` | `source` (gauged source, default `"gpu.load"`)<br>`length` (10–320, default `220`)<br>`start` (-360–360, default `-135`)<br>`end` (-360–360, default `135`)<br>`width` (1–40, default `8`)<br>`tail` (0–160, default `36`)<br>`hub` (0–60, default `14`)<br>`style` (`taper` / `line`, default `"taper"`)<br>`color` (color, default `"warn"`) |
| Lamps | `dots` | `source` (gauged source, default `"cpu.load"`)<br>`layout` (`arc` / `line`, default `"arc"`)<br>`count` (2–120, default `36`)<br>`r` (10–320, default `270`)<br>`start` (-360–360, default `-135`)<br>`end` (-360–360, default `135`)<br>`length` (10–640, default `300`)<br>`size` (1–30, default `5`)<br>`shape` (`dot` / `dash`, default `"dot"`)<br>`color` (color, default `"accent"`) |
| Bar | `bar` | `source` (gauged source, default `"limit.claude5h"`)<br>`length` (10–640, default `300`)<br>`width` (1–80, default `10`)<br>`vertical` (bool, default `false`)<br>`rounded` (bool, default `false`)<br>`color` (color, default `"accent"`) |
| Terminal bar | `cells` | `source` (gauged source, default `"cpu.load"`)<br>`cells` (2–40, default `10`)<br>`size` (8–80, default `22`)<br>`glyph` (`square` / `block` / `dot` / `pipe`, default `"square"`)<br>`value` (bool, default `true`)<br>`color` (color, default `"accent"`) |
| Graph | `graph` | `source` (gauged source, default `"cpu.temp"`)<br>`w` (40–640, default `300`)<br>`h` (16–400, default `90`)<br>`style` (`area` / `line` / `bars` / `braille`, default `"area"`)<br>`minutes` (1–15, default `2`)<br>`color` (color, default `"accent"`) |
| Clock hands | `hands` | `size` (20–320, default `240`)<br>`style` (`classic` / `sport` / `thin`, default `"classic"`)<br>`seconds` (bool, default `true`)<br>`color` (color, default `"ink"`)<br>`second` (color, default `"accent"`) |
| Numerals | `numerals` | `kind` (`hours` / `roman` / `quarters` / `scale`, default `"hours"`)<br>`r` (10–320, default `250`)<br>`size` (8–160, default `34`)<br>`from` (-9999–9999, default `0`)<br>`to` (-9999–9999, default `100`)<br>`count` (2–60, default `11`)<br>`start` (-360–360, default `-135`)<br>`end` (-360–360, default `135`)<br>`upright` (bool, default `true`)<br>`font` (`sans` / `light` / `serif` / `mono`, default `"sans"`)<br>`bold` (bool, default `false`)<br>`color` (color, default `"ink2"`) |
| Ticks | `ticks` | `r` (10–320, default `300`)<br>`length` (1–80, default `10`)<br>`count` (1–180, default `60`)<br>`start` (-360–360, default `0`)<br>`end` (-360–360, default `360`)<br>`width` (0.5–12, default `1.5`)<br>`color` (color, default `"ink3"`) |
| Shape | `shape` | `kind` (`ring` / `circle` / `rect` / `line` / `arc`, default `"ring"`)<br>`w` (0–640, default `200`)<br>`h` (0–640, default `200`)<br>`start` (-360–360, default `-60`)<br>`end` (-360–360, default `60`)<br>`stroke` (0–60, default `2`)<br>`dash` (0–60, default `0`)<br>`color` (color, default `"track"`)<br>`opacity` (0.05–1, default `1`) |
| Picture | `image` | `src` (media, default `""`)<br>`w` (8–640, default `200`)<br>`h` (8–640, default `200`)<br>`round` (bool, default `true`)<br>`opacity` (0.05–1, default `1`) |
| Mascot | `mascot` | `mascot` (mascot, default `"auto"`)<br>`px` (2–16, default `7`)<br>`walk` (0–600, default `200`)<br>`ascii` (bool, default `false`) |
| Sync status | `status` | — |

`size` of a value or of segment digits is the height of its digits. `r` is a radius. `w` and `h` are a width and a height. A `line` shape goes from one corner of its `w` × `h` box to the other, so `w: 0` is a vertical line and `h: 0` a level one. In `cells`, `cells` is the number of characters in the bar. The `mascot` widget's `mascot` is `auto`, which follows the settings, or one of `kraken`, `crab`, `ghost`, `cat` and `robot`. `walk` is how far it may wander sideways. `src` of a picture is `media:<file name>`, a file from **Own backgrounds**. The sync status shows the date while there is no usage source.

Some properties only count with others: `from`, `to`, `count`, `start` and `end` of numerals only with `kind: "scale"` (the other kinds go round the whole dial); `r`, `start` and `end` of lamps only with `layout: "arc"`, `length` only with `layout: "line"`; `start` and `end` of a shape only with `kind: "arc"`. The editor hides the ones that don't count.

- **Segment digits** spell a number or the time in seven segments, like an alarm clock or a VFD. `prefix` goes in front, e.g. `CPU`; seven segments can draw digits and A–Z except K, M, Q, W and X. `ghost` draws the unlit segments faintly, `slant` leans the digits.
- **Curved text** is bent round (`x`, `y`) at radius `r`, centred on `angle`. `flip` runs it anticlockwise, which reads upright along the bottom of the dial.
- **Needle** turns from `start` to `end` as its source fills, like a speedometer. `tail` is how far it reaches back past the centre, `hub` the radius of the cap.
- **Lamps** are a row of `count` dots or dashes that light up with the value, round an arc or along a line.
- **Numerals** put the hours (`hours`, `roman`, `quarters`) round the dial, or a `scale` from `from` to `to` in `count` steps between two angles. `upright` keeps them level instead of turned to the centre.
- **Clock hands** come in three `style`s, with their own colours for the hands and the second hand.
- `font` is `sans` (the dial's own), `light`, `serif` (for watch numerals) or `mono` (the terminal's). `spacing` is extra space between letters, in parts of the text size.

## Sources

What a value, gauge, bar or graph shows. Gauged sources have a range, so they can fill a gauge, a needle, lamps or a bar; the others are text only. Segment digits take digit sources, which today are the same as the gauged ones: numbers and the time. Limits fill with what is left or what is used, following the settings. The time fills over the day, the time with seconds over the minute, so a needle on `time.seconds` is a second hand.

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
| `time` | Time | yes |
| `time.seconds` | Time with seconds | yes |
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
