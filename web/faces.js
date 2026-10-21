// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 kleju13 and KrakenDial contributors
// Faces made in the editor: a list of widgets, each drawn with the parts of the built-in layouts
// (kit in dial.js), so a face follows the theme and costs CAM no more than a built-in layout.
//   KrakenFaces.build(svg, face, env)  -> updaters (d) => …; dial.js calls it for "face:<id>"
//   KrakenFaces.normalize(face)        -> the face with only known widgets and values in range
//   KrakenFaces.WIDGETS, SOURCES       -> what the editor offers: widget types and what they show
//   KrakenFaces.BLOCKS                 -> ready groups of widgets the editor adds in one go
// A face is plain JSON, documented in docs/faces.md:
//   { "version": 1, "id": "my-face", "name": "My face", "theme": "night", "bg": "stars",
//     "widgets": [{ "type": "value", "x": 320, ... }] }
// theme, bg and look are the face's own look, put on when the face is picked; without them the
// face takes the look set in the settings.
// To add a widget type, add it to WIDGETS: its props (which the editor turns into fields and
// normalize() checks), how it scales when resized, and build(g, w, env) returning an updater.
(function () {
  const K = window.KrakenDial.kit;
  const t = window.KrakenI18n.t;
  const { C, el, clamp, polar, arcD, int, dec, setText, setAttr, setSpans, setParts, setNum } = K;

  // ---------- what a widget can show ----------
  // read(d) -> { n: number text, u: unit, us: unit size (share of the number), frac: 0..1 for
  // gauges or null, raw: the plain number for graphs, warn, dim, sub: line under a value,
  // v: the limit's view (gauges then show its pace), peak/hot: for temperatures }

  const pctOf = (v) => (v == null ? null : clamp(v, 0, 1));
  const hwSub = (h, but) =>
    [but !== "temp" && `${int(h.temp)}°`, but !== "load" && K.loadText(h), but !== "power" && `${int(h.power)} W`].filter(Boolean).join(" · ");
  function hwSource(key, what) {
    const label = () => (what === "temp" ? t(`lbl.${key}`) : `${t(`lbl.${key}`)} ${t(`lbl.${what === "load" ? "load" : "power"}`)}`);
    if (what === "temp")
      return {
        label, span: 15,
        read: (d) => {
          const h = d.hw[key];
          const f = (v) => (v == null ? null : K.tempF(v) / 100);
          return { n: int(h.temp), u: "°", us: 0.5, frac: f(h.temp), raw: h.temp, warn: K.isHot(h, key), peak: f(h.peak), hot: f(K.HOT[key]), sub: hwSub(h, "temp") };
        },
      };
    if (what === "load")
      return {
        label, span: 20,
        read: (d) => {
          const h = d.hw[key];
          return { n: h.load == null ? "—" : `${Math.round(h.load * 100)}`, u: "%", us: 0.45, frac: pctOf(h.load), raw: h.load == null ? null : h.load * 100, sub: hwSub(h, "load") };
        },
      };
    const max = key === "cpu" ? 250 : 450;
    return {
      label, span: 40,
      read: (d) => {
        const h = d.hw[key];
        return { n: int(h.power), u: " W", us: 0.38, frac: h.power == null ? null : pctOf(h.power / max), raw: h.power, sub: hwSub(h, "power") };
      },
    };
  }
  function limitSource(def) {
    return {
      label: () => def.label, limit: true, span: 10,
      read: (d) => {
        const v = d.views[def.key];
        return { n: v.value, u: "%", us: 0.45, frac: v.state === "none" ? null : v.pct / 100, raw: v.state === "none" ? null : v.pct, warn: !!v.hot, dim: v.dim, sub: v.sub, v };
      },
    };
  }
  function costSource(period) {
    return {
      label: () => `${t("lbl.cost")} · ${(period ? K.COSTS.find((c) => c.id === period).short : "").toUpperCase()}`.replace(/ · $/, ""),
      text: true,
      read: (d) => {
        if (!period) {
          const c = d.cost;
          return c ? { n: c.value, u: "", frac: null, dim: c.dim, sub: c.short } : { n: "—", u: "", frac: null, dim: true, sub: "" };
        }
        const v = d.costs && typeof d.costs[period] === "number" ? d.costs[period] : null;
        return { n: K.money(v), u: "", frac: null, dim: v == null, sub: K.COSTS.find((c) => c.id === period).short };
      },
    };
  }
  const ramGb = (r) => (r.used == null ? "—" : dec(r.used / 1024));
  const SOURCES = {
    "cpu.temp": hwSource("cpu", "temp"),
    "cpu.load": hwSource("cpu", "load"),
    "cpu.power": hwSource("cpu", "power"),
    "gpu.temp": hwSource("gpu", "temp"),
    "gpu.load": hwSource("gpu", "load"),
    "gpu.power": hwSource("gpu", "power"),
    liquid: {
      label: () => t("lbl.liquid"), span: 4,
      read: (d) => ({ n: dec(d.hw.liquid), u: "°", us: 0.5, frac: d.hw.liquid == null ? null : K.scale(d.hw.liquid, 20, 50) / 100, raw: d.hw.liquid, sub: "" }),
    },
    power: {
      label: () => t("lbl.power"), span: 40,
      read: (d) => {
        const p = K.power(d.hw);
        return { n: int(p), u: " W", us: 0.38, frac: p == null ? null : pctOf(p / 600), raw: p, sub: `CPU ${int(d.hw.cpu.power)} W · GPU ${int(d.hw.gpu.power)} W` };
      },
    },
    ram: {
      label: () => t("lbl.ram"), span: 2,
      read: (d) => {
        const r = d.hw.ram || {};
        return { n: ramGb(r), u: " GB", us: 0.38, frac: K.memFrac(r), raw: r.used == null ? null : r.used / 1024, sub: r.total ? `/ ${Math.round(r.total / 1024)} GB` : "" };
      },
    },
    "ram.pct": {
      label: () => t("lbl.ram"), span: 10,
      read: (d) => {
        const f = K.memFrac(d.hw.ram || {});
        return { n: f == null ? "—" : `${Math.round(f * 100)}`, u: "%", us: 0.45, frac: f, raw: f == null ? null : f * 100, sub: `${ramGb(d.hw.ram || {})} GB` };
      },
    },
    ...Object.fromEntries(K.LIMITS.map((def) => [`limit.${def.key}`, limitSource(def)])),
    cost: costSource(null),
    "cost.today": costSource("today"),
    "cost.last24h": costSource("last24h"),
    "cost.last7d": costSource("last7d"),
    "cost.month": costSource("month"),
    time: {
      label: () => t("lbl.time"), text: true, digits: true, gauge: true,
      read: (d) => {
        const at = new Date(d.now);
        return { n: K.hhmm(d.now), u: "", frac: (at.getHours() * 60 + at.getMinutes()) / 1440, sub: K.dateText(d.now, "date") };
      },
    },
    "time.seconds": {
      label: () => t("lbl.time"), text: true, digits: true, gauge: true,
      read: (d) => ({ n: K.hhmmss(d.now), u: "", frac: new Date(d.now).getSeconds() / 60, sub: K.dateText(d.now, "date") }),
    },
    date: {
      label: () => t("lbl.date"), text: true,
      read: (d) => ({ n: K.dateText(d.now, "date"), u: "", frac: null, sub: "" }),
    },
  };
  // Sources that fill a gauge: everything with a scale, and the time (the day, or the minute
  // with seconds) going round.
  const GAUGED = Object.keys(SOURCES).filter((k) => !SOURCES[k].text || SOURCES[k].gauge);
  // Sources that seven segments can spell: numbers and the time.
  const DIGITAL = Object.keys(SOURCES).filter((k) => !SOURCES[k].text || SOURCES[k].digits);
  const sourceOf = (id) => SOURCES[id] || SOURCES["cpu.temp"];
  // A source as text, with its unit: "54°", "15%", "42 W", "$14.29", "21:07".
  const valueText = (r) => `${r.n}${r.n === "—" ? "" : r.u}`;

  // Fills a gauge the way the built-in layouts do: limits with their pace, temperatures with the
  // recent peak and the hot part in the second colour, the rest plainly.
  function fillGauge(gg, r) {
    if (r.v) return K.limitGauge(gg, r.v);
    const p = (f) => (f == null ? null : f * 100);
    if (r.hot != null) return gg.set(p(r.frac) ?? 0, p(r.peak), p(r.hot), { hot: true });
    gg.set(p(r.frac) ?? 0, null, null);
  }
  // Where a gauge without a scale of its own points: 0..1, never missing.
  const fracOf = (r) => (r.frac == null ? 0 : clamp(r.frac, 0, 1));

  // ---------- colours and fonts ----------
  // Roles follow the theme; a widget may also have a fixed #rrggbb.
  const ROLES = { ink: "--ink", ink2: "--ink-2", ink3: "--ink-3", accent: "--fill", accent2: "--fill-2", warn: "--warn", track: "--track" };
  const colorOf = (c) => (ROLES[c] ? `var(${ROLES[c]})` : /^#[0-9a-f]{6}$/i.test(c || "") ? c : null);
  // Gauges and bars paint with --fill; giving the group another --fill recolours just them.
  function tint(g, c) {
    if (c && c !== "accent" && colorOf(c)) g.style.setProperty("--fill", colorOf(c));
  }
  // Sets one style property, only when it changes.
  function paint(node, prop, v) {
    if (node[`_${prop}`] === v) return;
    node[`_${prop}`] = v;
    node.style[prop] = v;
  }
  // The dial's own type, a light cut of it, a serif for watch numerals and the terminal's.
  const FONT = { kind: "select", options: [["sans", "p.fontSans"], ["light", "p.fontLight"], ["serif", "p.fontSerif"], ["mono", "p.fontMono"]], default: "sans" };
  const MONO = "'Cascadia Mono','Cascadia Code',Consolas,monospace";
  function setFont(n, font) {
    if (font === "light") n.style.fontWeight = "300";
    if (font === "serif") n.style.fontFamily = "Georgia,'Times New Roman',serif";
    if (font === "mono") n.style.fontFamily = MONO;
  }
  // Round line ends on a gauge's track and fill. The part past the pace or the hot mark keeps
  // square ends: rounded, its empty start would leave a dot in the second colour.
  function roundEnds(gg) {
    const [track, fill] = gg.g.children || [];
    for (const p of [track, fill]) if (p && p.style) p.style.strokeLinecap = "round";
  }
  const hideTrack = (gg) => {
    const track = (gg.g.children || [])[0];
    if (track && track.style) track.style.display = "none";
  };

  // ---------- seven segments ----------
  // Digits as on an alarm clock: a cell per character, the segments that are off drawn faintly
  // (or not at all), a decimal point after a digit and narrower cells for colons.
  const SEG = {
    0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg",
    "-": "g", "°": "abfg", _: "d", " ": "",
    A: "abcefg", B: "cdefg", C: "adef", D: "bcdeg", E: "adefg", F: "aefg", G: "acdef", H: "bcefg", I: "ef", J: "bcde", L: "def",
    N: "ceg", O: "abcdef", P: "abefg", R: "eg", S: "acdfg", T: "defg", U: "bcdef", V: "bcdef", Y: "bcdfg", Z: "abdeg",
  };
  // Polygons of the seven segments of a cell w wide and h high, standing on (0, 0).
  function segments(w, h) {
    const k = h * 0.13, g = k * 0.14, hx = (cx, cy, L) => [[cx - L / 2, cy], [cx - L / 2 + k / 2, cy - k / 2], [cx + L / 2 - k / 2, cy - k / 2], [cx + L / 2, cy], [cx + L / 2 - k / 2, cy + k / 2], [cx - L / 2 + k / 2, cy + k / 2]];
    const vx = (cx, cy, L) => [[cx, cy - L / 2], [cx + k / 2, cy - L / 2 + k / 2], [cx + k / 2, cy + L / 2 - k / 2], [cx, cy + L / 2], [cx - k / 2, cy + L / 2 - k / 2], [cx - k / 2, cy - L / 2 + k / 2]];
    const L = w - k - 2 * g, V = h / 2 - k / 2 - 2 * g, top = -h + k / 2, mid = -h / 2, bot = -k / 2;
    const s = {
      a: hx(w / 2, top, L), g: hx(w / 2, mid, L), d: hx(w / 2, bot, L),
      f: vx(k / 2, (top + mid) / 2, V), b: vx(w - k / 2, (top + mid) / 2, V), e: vx(k / 2, (mid + bot) / 2, V), c: vx(w - k / 2, (mid + bot) / 2, V),
    };
    return Object.fromEntries(Object.entries(s).map(([id, pts]) => [id, pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")]));
  }
  // "21:07" -> cells [{ ch: "2" }, { ch: "1" }, { colon }, ...]; a point joins the digit before it.
  function cellsOf(s) {
    const out = [];
    for (const ch of s) {
      if (ch === "." && out.length && !out[out.length - 1].colon) out[out.length - 1].dp = true;
      else if (ch === ":") out.push({ colon: true });
      else out.push({ ch: ch === "—" ? "-" : ch.toUpperCase() });
    }
    return out;
  }

  // ---------- widgets ----------
  // Prop kinds: number {min, max, step}, text, longtext, bool, select {options}, source {gauged,
  // digits}, color, media, mascot. x and y come with every widget. group places it in the
  // editor's palette.

  const ALIGN = { kind: "select", options: [["start", "p.alignStart"], ["middle", "p.alignMiddle"], ["end", "p.alignEnd"]] };
  const GLYPHS = { block: ["█", "░"], square: ["■", "■"], dot: ["●", "○"], pipe: ["|", "·"] };
  // whole units once a size is big enough to not need the fraction
  const round = (v) => (Math.abs(v) >= 20 ? Math.round(v) : Math.round(v * 10) / 10);
  const scaled = (...keys) => (w, k) => Object.fromEntries(keys.map((key) => [key, round(w[key] * k)]));
  const angle = (d) => ({ kind: "number", min: -360, max: 360, default: d });
  let clips = 0;

  const WIDGETS = {
    // A big number with its unit, a label above and a line below, like the round layouts.
    value: {
      icon: "42", group: "text",
      props: {
        source: { kind: "source", default: "cpu.temp" },
        size: { kind: "number", min: 16, max: 280, default: 110 },
        showLabel: { kind: "bool", default: true, label: "p.showLabel" },
        label: { kind: "text", default: "", hint: "p.labelAuto", when: (w) => w.showLabel },
        sub: { kind: "bool", default: true },
        font: FONT,
        align: { ...ALIGN, default: "middle" },
        color: { kind: "color", default: "ink" },
      },
      resize: scaled("size"),
      build(g, w) {
        const src = sourceOf(w.source), s = w.size;
        const lbl = w.showLabel ? el(g, "text", { x: w.x, y: (w.y - s * 0.9).toFixed(1), "text-anchor": w.align, class: "t-lbl", style: `font-size:${Math.max(10, s * 0.18).toFixed(1)}px` }) : null;
        const val = K.num(g, w.x, w.y, s, w.align);
        setFont(val, w.font);
        if (colorOf(w.color) && w.color !== "ink") val.style.fill = colorOf(w.color);
        const sub = w.sub ? el(g, "text", { x: w.x, y: (w.y + Math.max(16, s * 0.3)).toFixed(1), "text-anchor": w.align, class: "t-sub", style: `font-size:${Math.max(11, s * 0.17).toFixed(1)}px` }) : null;
        let nudged = false;
        return (d) => {
          const r = src.read(d);
          // a degree sign hangs off the number, so a centred one shifts right to look centred
          if (!nudged && w.align === "middle" && r.u === "°") {
            nudged = true;
            setAttr(val, "x", (w.x + s * 0.09).toFixed(1));
          }
          if (src.text) setText(val, r.n);
          else setNum(val, r.n, r.u, s * (r.us || 0.42), s);
          val.classList.toggle("is-dim", !!r.dim);
          val.classList.toggle("is-warn", !!r.warn);
          if (lbl) setText(lbl, w.label || src.label());
          if (sub) {
            if (Array.isArray(r.sub)) setParts(sub, r.sub);
            else setText(sub, r.sub || "");
          }
        };
      },
    },

    // A number or the time in seven segments, as on an alarm clock or a VFD; a few letters too.
    segment: {
      icon: "8.8", group: "text",
      props: {
        source: { kind: "source", digits: true, default: "time" },
        size: { kind: "number", min: 16, max: 300, default: 120, label: "p.height" },
        prefix: { kind: "text", default: "", hint: "p.prefixHint" },
        unit: { kind: "bool", default: true },
        ghost: { kind: "bool", default: true },
        slant: { kind: "bool", default: true },
        align: { ...ALIGN, default: "middle" },
        color: { kind: "color", default: "accent" },
      },
      resize: scaled("size"),
      build(g, w) {
        const src = sourceOf(w.source), H = w.size, W = H * 0.54, CW = H * 0.26, GAP = H * 0.17;
        const col = colorOf(w.color) || "var(--fill)";
        const polys = segments(W, H);
        const off = w.ghost ? "0.09" : "0";
        const box = el(g, "g");
        const unit = el(g, "text", { y: w.y, style: `font-size:${(H * 0.34).toFixed(1)}px;font-weight:600` });
        const cells = [];
        // A cell has the seven segments, a point and a colon; which show depends on what it holds.
        function cell(i) {
          if (cells[i]) return cells[i];
          const cg = el(box, "g");
          const segs = Object.fromEntries(Object.entries(polys).map(([id, pts]) => [id, el(cg, "polygon", { points: pts })]));
          const dot = (x, y) => el(cg, "rect", { x: (x - H * 0.055).toFixed(1), y: (y - H * 0.055).toFixed(1), width: (H * 0.11).toFixed(1), height: (H * 0.11).toFixed(1), rx: (H * 0.02).toFixed(1) });
          return (cells[i] = { g: cg, segs, dp: dot(W + GAP * 0.5, -H * 0.055), c1: dot(CW / 2, -H * 0.7), c2: dot(CW / 2, -H * 0.3) });
        }
        const show = (n, on) => setAttr(n, "display", on ? "inline" : "none");
        let last = null;
        return (d) => {
          const r = src.read(d);
          let s = `${w.prefix}${r.n === "—" ? "--" : r.n}`, u = w.unit ? r.u.trim() : "";
          if (u === "°") [s, u] = [`${s}°`, ""];
          const key = `${s}|${u}|${!!r.warn}|${!!r.dim}`;
          if (key === last) return;
          last = key;
          const list = cellsOf(s);
          const widths = list.map((c) => (c.colon ? CW : W));
          const uw = u ? H * 0.34 * 0.62 * u.length + GAP : 0;
          const total = widths.reduce((a, b) => a + b, 0) + GAP * Math.max(0, list.length - 1) + uw;
          let x = w.align === "start" ? w.x : w.align === "end" ? w.x - total : w.x - total / 2;
          list.forEach((c, i) => {
            const it = cell(i);
            show(it.g, true);
            setAttr(it.g, "transform", `translate(${x.toFixed(1)} ${w.y})${w.slant ? " skewX(-7)" : ""}`);
            const lit = c.colon ? "" : SEG[c.ch] ?? "";
            for (const [id, n] of Object.entries(it.segs)) {
              show(n, !c.colon);
              setAttr(n, "opacity", lit.includes(id) ? "1" : off);
            }
            show(it.dp, !!c.dp);
            show(it.c1, !!c.colon);
            show(it.c2, !!c.colon);
            x += widths[i] + GAP;
          });
          for (let i = list.length; i < cells.length; i++) show(cells[i].g, false);
          setAttr(unit, "x", x.toFixed(1));
          setText(unit, u);
          const fill = r.warn ? "var(--warn)" : col;
          paint(box, "fill", fill);
          paint(unit, "fill", fill);
          setAttr(g, "opacity", r.dim ? "0.4" : "1");
        };
      },
    },

    // Text, with {source} placeholders filled in: "CPU {cpu.temp} · {cpu.load}". One line per line.
    text: {
      icon: "Aa", group: "text",
      props: {
        text: { kind: "longtext", default: "{time}", hint: "p.textHint" },
        size: { kind: "number", min: 8, max: 200, default: 28 },
        font: FONT,
        bold: { kind: "bool", default: false, label: "p.weight" },
        spacing: { kind: "number", min: 0, max: 1, step: 0.01, default: 0 },
        align: { ...ALIGN, default: "middle" },
        color: { kind: "color", default: "ink2" },
      },
      resize: scaled("size"),
      build(g, w) {
        const lines = String(w.text).split("\n").slice(0, 20);
        const nodes = lines.map((_, i) => {
          const y = (w.y + i * w.size * 1.2).toFixed(1);
          const n = w.font === "mono" ? K.term(g, w.x, y, w.size, w.align) : el(g, "text", { x: w.x, y, "text-anchor": w.align, style: `font-size:${w.size}px` });
          n.style.fill = colorOf(w.color) || "";
          if (w.font !== "mono") setFont(n, w.font);
          if (w.bold) n.style.fontWeight = "700";
          if (w.spacing) n.style.letterSpacing = `${w.spacing}em`;
          return n;
        });
        const fill = textFiller(lines);
        return (d) => fill(d).forEach((s, i) => setText(nodes[i], s));
      },
    },

    // Text bent round (x, y), as the maker's name on a watch: over the top, or under the bottom.
    arctext: {
      icon: "⌒", group: "text",
      props: {
        text: { kind: "text", default: "KRAKENDIAL", hint: "p.textHint" },
        r: { kind: "number", min: 20, max: 320, default: 250 },
        angle: angle(0),
        size: { kind: "number", min: 8, max: 120, default: 22 },
        font: FONT,
        bold: { kind: "bool", default: true, label: "p.weight" },
        spacing: { kind: "number", min: 0, max: 1, step: 0.01, default: 0.3 },
        flip: { kind: "bool", default: false },
        color: { kind: "color", default: "ink2" },
      },
      resize: scaled("r", "size"),
      build(g, w) {
        // a circle starting opposite the text, so the text's middle (50%) lands on the angle;
        // clockwise it reads over the top, the other way round it reads upright under the bottom
        const id = `farc${++clips}`, a0 = w.angle + 180, dir = w.flip ? -1 : 1, sweep = w.flip ? 0 : 1;
        const pt = (a) => polar(w.r, a, w.x, w.y).map((v) => v.toFixed(2)).join(" ");
        el(g, "path", { id, d: `M${pt(a0)}A${w.r} ${w.r} 0 1 ${sweep} ${pt(a0 + dir * 180)}A${w.r} ${w.r} 0 1 ${sweep} ${pt(a0 + dir * 359.9)}`, style: "fill:none;stroke:none" });
        const text = el(g, "text", { "text-anchor": "middle", "dominant-baseline": "central", style: `font-size:${w.size}px` });
        text.style.fill = colorOf(w.color) || "";
        setFont(text, w.font);
        if (w.bold) text.style.fontWeight = "700";
        if (w.spacing) text.style.letterSpacing = `${w.spacing}em`;
        const path = el(text, "textPath", { href: `#${id}`, startOffset: "50%" });
        const fill = textFiller([w.text]);
        return (d) => setText(path, fill(d)[0]);
      },
    },

    // An arc around (x, y), like the rim gauges: limits show their pace, temperatures their peak.
    arc: {
      icon: "◠", group: "gauge",
      props: {
        source: { kind: "source", gauged: true, default: "cpu.temp" },
        r: { kind: "number", min: 16, max: 320, default: 284 },
        start: angle(-150),
        end: angle(-30),
        width: { kind: "number", min: 1, max: 60, default: 14 },
        ticks: { kind: "number", min: 0, max: 60, default: 0, label: "p.count" },
        rounded: { kind: "bool", default: false },
        track: { kind: "bool", default: true },
        color: { kind: "color", default: "accent" },
      },
      resize: scaled("r", "width"),
      build(g, w) {
        const src = sourceOf(w.source);
        // a full circle can't be one arc: stop just short of it
        const end = Math.abs(w.end - w.start) >= 360 ? w.start + Math.sign(w.end - w.start || 1) * 359.9 : w.end;
        tint(g, w.color);
        const gg = K.arcGauge(g, w.r, w.start, end, w.width, w.x, w.y);
        if (w.rounded) roundEnds(gg);
        if (!w.track) hideTrack(gg);
        if (src.read === SOURCES["cpu.temp"].read || src.read === SOURCES["gpu.temp"].read) gg.notch.classList.add("is-peak");
        if (w.ticks) K.ticks(g, w.r - w.width / 2 - 18, w.r - w.width / 2 - 10, w.start, end, w.ticks, w.x, w.y);
        return (d) => fillGauge(gg, src.read(d));
      },
    },

    // A pointer turning round (x, y) from the start angle to the end one, as on a speedometer.
    needle: {
      icon: "↗", group: "gauge",
      props: {
        source: { kind: "source", gauged: true, default: "gpu.load" },
        length: { kind: "number", min: 10, max: 320, default: 220 },
        start: angle(-135),
        end: angle(135),
        width: { kind: "number", min: 1, max: 40, default: 8 },
        tail: { kind: "number", min: 0, max: 160, default: 36 },
        hub: { kind: "number", min: 0, max: 60, default: 14 },
        style: { kind: "select", options: [["taper", "p.styleTaper"], ["line", "p.styleLine"]], default: "taper" },
        color: { kind: "color", default: "warn" },
      },
      resize: scaled("length", "width", "tail", "hub"),
      build(g, w) {
        const src = sourceOf(w.source), { x, y } = w;
        g.style.setProperty("--needle", colorOf(w.color) || "var(--warn)");
        const hand = el(g, "g");
        if (w.style === "line") el(hand, "line", { x1: x, y1: y + w.tail, x2: x, y2: y - w.length, style: `stroke:var(--needle);stroke-width:${w.width}px;stroke-linecap:round` });
        else {
          const b = w.width / 2, tip = Math.max(0.8, w.width / 8);
          el(hand, "path", { d: `M${x - b} ${y + w.tail}L${x - tip} ${y - w.length}L${x + tip} ${y - w.length}L${x + b} ${y + w.tail}Z`, style: "fill:var(--needle)" });
        }
        if (w.hub) {
          el(g, "circle", { cx: x, cy: y, r: w.hub, style: "fill:var(--needle)" });
          el(g, "circle", { cx: x, cy: y, r: (w.hub * 0.38).toFixed(1), style: "fill:var(--bg-lo)" });
        }
        return (d) => setAttr(hand, "transform", `rotate(${(w.start + (w.end - w.start) * fracOf(src.read(d))).toFixed(1)} ${x} ${y})`);
      },
    },

    // A row of lamps along an arc or a line that light up to the value, like an LED ring.
    dots: {
      icon: "⋯", group: "gauge",
      props: {
        source: { kind: "source", gauged: true, default: "cpu.load" },
        layout: { kind: "select", options: [["arc", "p.layoutArc"], ["line", "p.layoutLine"]], default: "arc" },
        count: { kind: "number", min: 2, max: 120, default: 36, step: 1 },
        r: { kind: "number", min: 10, max: 320, default: 270, when: (w) => w.layout === "arc" },
        start: { ...angle(-135), when: (w) => w.layout === "arc" },
        end: { ...angle(135), when: (w) => w.layout === "arc" },
        length: { kind: "number", min: 10, max: 640, default: 300, when: (w) => w.layout === "line" },
        size: { kind: "number", min: 1, max: 30, default: 5 },
        shape: { kind: "select", options: [["dot", "p.shapeDot"], ["dash", "p.shapeDash"]], default: "dot" },
        color: { kind: "color", default: "accent" },
      },
      resize: (w, k) => ({ r: round(w.r * k), length: round(w.length * k), size: round(w.size * k) }),
      build(g, w) {
        const src = sourceOf(w.source), n = Math.round(w.count), s = w.size;
        const col = colorOf(w.color) || "var(--fill)";
        // a full turn would put the last lamp on the first
        const full = Math.abs(w.end - w.start) >= 360;
        const lamps = Array.from({ length: n }, (_, i) => {
          const f = n === 1 ? 0.5 : full ? i / n : i / (n - 1);
          if (w.layout === "line") {
            const x = w.x - w.length / 2 + w.length * f;
            return w.shape === "dash" ? el(g, "rect", { x: (x - s / 2).toFixed(1), y: (w.y - s * 1.6).toFixed(1), width: s, height: (s * 3.2).toFixed(1), rx: (s * 0.3).toFixed(1) }) : el(g, "circle", { cx: x.toFixed(1), cy: w.y, r: s });
          }
          const a = w.start + (w.end - w.start) * f;
          const [cx, cy] = polar(w.r, a, w.x, w.y);
          if (w.shape !== "dash") return el(g, "circle", { cx: cx.toFixed(1), cy: cy.toFixed(1), r: s });
          return el(g, "rect", { x: (cx - s / 2).toFixed(1), y: (cy - s * 1.6).toFixed(1), width: s, height: (s * 3.2).toFixed(1), rx: (s * 0.3).toFixed(1), transform: `rotate(${a.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})` });
        });
        return (d) => {
          const r = src.read(d), lit = Math.round(fracOf(r) * n);
          lamps.forEach((lamp, i) => {
            // lit past the hot mark (temperatures) or all of it once a limit is used up
            const hot = i < lit && ((r.hot != null && (i + 0.5) / n >= r.hot) || (r.hot == null && r.warn));
            paint(lamp, "fill", i >= lit ? "var(--track)" : hot ? "var(--warn)" : col);
          });
          setAttr(g, "opacity", r.dim ? "0.4" : "1");
        };
      },
    },

    // A straight bar centred on (x, y).
    bar: {
      icon: "▬", group: "gauge",
      props: {
        source: { kind: "source", gauged: true, default: "limit.claude5h" },
        length: { kind: "number", min: 10, max: 640, default: 300 },
        width: { kind: "number", min: 1, max: 80, default: 10 },
        vertical: { kind: "bool", default: false },
        rounded: { kind: "bool", default: false },
        color: { kind: "color", default: "accent" },
      },
      resize: scaled("length", "width"),
      build(g, w) {
        const src = sourceOf(w.source), h = w.length / 2;
        tint(g, w.color);
        const gg = w.vertical ? K.columnGauge(g, w.x, w.y + h, w.y - h, w.width) : K.barGauge(g, w.x - h, w.x + h, w.y, w.width);
        if (w.rounded) roundEnds(gg);
        return (d) => fillGauge(gg, src.read(d));
      },
    },

    // A bar of characters, ■■■■□□□ 42%, filling to its exact place like the terminal layouts.
    cells: {
      icon: "▮▯", group: "gauge",
      props: {
        source: { kind: "source", gauged: true, default: "cpu.load" },
        cells: { kind: "number", min: 2, max: 40, default: 10 },
        size: { kind: "number", min: 8, max: 80, default: 22 },
        glyph: { kind: "select", options: [["square", "■■■"], ["block", "██░"], ["dot", "●●○"], ["pipe", "|||"]], default: "square" },
        value: { kind: "bool", default: true, label: "p.sub" },
        color: { kind: "color", default: "accent" },
      },
      resize: scaled("size"),
      build(g, w) {
        const src = sourceOf(w.source), [full, empty] = GLYPHS[w.glyph] || GLYPHS.square, n = Math.round(w.cells);
        tint(g, w.color);
        const line = K.term(g, w.x, w.y, w.size);
        const bar = src.limit ? K.limitBar(g, w.x, w.y, w.size, 0, n, full) : K.fracBar(g, w.x, w.y, w.size, 0, n, full);
        return (d) => {
          const r = src.read(d);
          setSpans(line, [K.track(n, empty), ...(w.value ? [[r.warn ? "tm-w" : r.dim ? "tm-d" : "", ` ${valueText(r)}`]] : [])]);
          bar(src.limit ? r.v : r.frac);
        };
      },
    },

    // The last minutes of a value, as a line, an area, bars or btop's braille, scaled to what it holds.
    graph: {
      icon: "⌁", group: "gauge",
      props: {
        source: { kind: "source", gauged: true, default: "cpu.temp" },
        w: { kind: "number", min: 40, max: 640, default: 300 },
        h: { kind: "number", min: 16, max: 400, default: 90 },
        style: { kind: "select", options: [["area", "p.styleArea"], ["line", "p.styleLine"], ["bars", "p.styleBars"], ["braille", "p.styleBraille"]], default: "area" },
        minutes: { kind: "number", min: 1, max: 15, default: 2, step: 1 },
        color: { kind: "color", default: "accent" },
      },
      resize: scaled("w", "h"),
      build(g, w) {
        const src = sourceOf(w.source), x0 = w.x - w.w / 2, y0 = w.y - w.h / 2, n = Math.round(w.minutes * 20);
        const col = colorOf(w.color) || "var(--fill)";
        const hist = [];
        let sampledAt = -Infinity;
        const range = () => {
          const v = hist.filter((x) => x != null);
          if (!v.length) return [0, 1];
          const lo = Math.floor(Math.min(...v)), span = src.span || 10;
          return [lo, Math.max(lo + span, Math.ceil(Math.max(...v)))];
        };
        if (w.style === "braille") {
          const S = 20, cw = K.advance(g, S), cols = Math.max(2, Math.round(w.w / cw)), rows = Math.max(1, Math.round(w.h / 23));
          const lines = Array.from({ length: rows }, (_, r) => K.term(g, x0, (y0 + (r + 1) * 23 - 5).toFixed(1), S));
          for (const l of lines) l.style.fill = col;
          return (d) => {
            if (d.now - sampledAt >= 3000) {
              sampledAt = d.now;
              hist.push(src.read(d).raw ?? null);
              if (hist.length > cols * 2) hist.shift();
            }
            const [lo, hi] = range();
            K.braille(hist.map((v) => (v == null ? null : (v - lo) / (hi - lo))), cols, rows).forEach((s, r) => setText(lines[r], s));
          };
        }
        const base = w.y + w.h / 2;
        // bars: one path of thick vertical strokes, a sample each
        const bw = (w.w / n) * 0.62;
        const area = w.style === "area" ? el(g, "path", { style: `fill:${col};fill-opacity:0.18;stroke:none` }) : null;
        const line = el(g, "path", { style: w.style === "bars" ? `fill:none;stroke:${col};stroke-width:${bw.toFixed(2)}px` : `fill:none;stroke:${col};stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round` });
        el(g, "path", { d: `M${x0} ${base}H${x0 + w.w}`, class: "rule", style: "stroke-width:1.5" });
        return (d) => {
          if (d.now - sampledAt < 3000) return;
          sampledAt = d.now;
          hist.push(src.read(d).raw ?? null);
          if (hist.length > n) hist.shift();
          const [lo, hi] = range();
          const pts = [];
          hist.forEach((v, i) => {
            if (v == null) return;
            const x = w.style === "bars" ? x0 + (w.w * (n - hist.length + i + 0.5)) / n : x0 + (w.w * (n - hist.length + i)) / Math.max(1, n - 1);
            pts.push([x, base - w.h * clamp((v - lo) / (hi - lo), 0, 1)]);
          });
          if (w.style === "bars") return setAttr(line, "d", pts.map(([x, y]) => `M${x.toFixed(1)} ${base}V${Math.min(base - 1.5, y).toFixed(1)}`).join(""));
          const dl = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
          setAttr(line, "d", dl);
          if (area) setAttr(area, "d", pts.length ? `${dl}L${pts[pts.length - 1][0].toFixed(1)} ${base}L${pts[0][0].toFixed(1)} ${base}Z` : "");
        };
      },
    },

    // Hour, minute and (optionally) second hands turning round (x, y).
    hands: {
      icon: "◷", group: "clock",
      props: {
        size: { kind: "number", min: 20, max: 320, default: 240, label: "p.r" },
        style: { kind: "select", options: [["classic", "p.styleClassic"], ["sport", "p.styleSport"], ["thin", "p.styleThin"]], default: "classic" },
        seconds: { kind: "bool", default: true },
        color: { kind: "color", default: "ink" },
        second: { kind: "color", default: "accent", when: (w) => w.seconds },
      },
      resize: scaled("size"),
      build(g, w) {
        const k = w.size / 246, { x, y } = w;
        const ink = colorOf(w.color) || "var(--ink)", sec = colorOf(w.second) || "var(--fill)";
        const widths = { classic: [9, 5.5, 2.5], sport: [9, 5.5, 2], thin: [4, 2.6, 1.3] }[w.style] || [9, 5.5, 2.5];
        const hand = (len, tail, width, color, cls) => {
          const h = el(g, "g", { class: `hand ${cls}` });
          if (w.style === "sport" && cls !== "hand-s") {
            // a sword: wide at the hub, pointed at the tip, with a lighter strip of lume
            const b = width * 0.95 * k, tip = len * k;
            el(h, "path", { d: `M${x - b} ${y + tail * k}L${x - b * 0.8} ${y - tip * 0.86}L${x} ${y - tip}L${x + b * 0.8} ${y - tip * 0.86}L${x + b} ${y + tail * k}Z`, style: `fill:${color}` });
            el(h, "line", { x1: x, y1: y - tip * 0.3, x2: x, y2: y - tip * 0.8, style: `stroke:var(--fill-2);stroke-width:${(width * 0.55 * k).toFixed(2)}px` });
          } else el(h, "line", { x1: x, y1: y + tail * k, x2: x, y2: y - len * k, style: `stroke:${color};stroke-width:${(width * k).toFixed(2)}px` });
          return h;
        };
        const hh = hand(124, 20, widths[0], ink, "hand-h"), mm = hand(212, 24, widths[1], ink, "hand-m");
        const ss = w.seconds ? hand(246, 46, widths[2], sec, "hand-s") : null;
        if (ss && w.style !== "thin") el(ss, "circle", { cx: x, cy: y + 36 * k, r: (5 * k).toFixed(1), style: `fill:${sec}` });
        const hub = w.style === "thin" ? 5 : 9;
        el(g, "circle", { cx: x, cy: y, r: (hub * k).toFixed(1), style: `fill:${ink}` });
        el(g, "circle", { cx: x, cy: y, r: (3.5 * k).toFixed(1), style: `fill:${sec}` });
        return (d) => {
          const at = new Date(d.now);
          const s = at.getSeconds(), m = at.getMinutes() + s / 60, h = (at.getHours() % 12) + m / 60;
          setAttr(hh, "transform", `rotate(${(h * 30).toFixed(1)} ${x} ${y})`);
          setAttr(mm, "transform", `rotate(${(m * 6).toFixed(1)} ${x} ${y})`);
          if (ss) setAttr(ss, "transform", `rotate(${s * 6} ${x} ${y})`);
        };
      },
    },

    // Numbers round (x, y): the hours, in Roman numerals or only the quarters, or a scale from
    // one number to another between two angles, as on a speedometer.
    numerals: {
      icon: "12", group: "clock",
      props: {
        kind: { kind: "select", options: [["hours", "p.kindHours"], ["roman", "p.kindRoman"], ["quarters", "p.kindQuarters"], ["scale", "p.kindScale"]], default: "hours", label: "p.numerals" },
        r: { kind: "number", min: 10, max: 320, default: 250 },
        size: { kind: "number", min: 8, max: 160, default: 34 },
        from: { kind: "number", min: -9999, max: 9999, default: 0, step: 1, when: (w) => w.kind === "scale" },
        to: { kind: "number", min: -9999, max: 9999, default: 100, step: 1, when: (w) => w.kind === "scale" },
        count: { kind: "number", min: 2, max: 60, default: 11, step: 1, when: (w) => w.kind === "scale" },
        start: { ...angle(-135), when: (w) => w.kind === "scale" },
        end: { ...angle(135), when: (w) => w.kind === "scale" },
        upright: { kind: "bool", default: true },
        font: FONT,
        bold: { kind: "bool", default: false, label: "p.weight" },
        color: { kind: "color", default: "ink2" },
      },
      resize: scaled("r", "size"),
      build(g, w) {
        const ROMAN = ["XII", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI"];
        let marks;
        if (w.kind === "scale") {
          const n = Math.round(w.count), full = Math.abs(w.end - w.start) >= 360;
          marks = Array.from({ length: n }, (_, i) => {
            const v = w.from + ((w.to - w.from) * i) / (n - 1);
            return [w.start + ((w.end - w.start) * i) / (full ? n : n - 1), Number.isInteger(v) ? `${v}` : v.toFixed(1)];
          });
          // a full turn ends where it starts, so the last number would sit on the first
          if (full) marks.pop();
        } else {
          const hours = w.kind === "quarters" ? [0, 3, 6, 9] : [...Array(12).keys()];
          marks = hours.map((h) => [h * 30, w.kind === "roman" ? ROMAN[h] : `${h || 12}`]);
        }
        for (const [a, s] of marks) {
          const [px, py] = polar(w.r, a, w.x, w.y);
          const n = el(g, "text", { x: px.toFixed(1), y: py.toFixed(1), "text-anchor": "middle", "dominant-baseline": "central", style: `font-size:${w.size}px` }, s);
          n.style.fill = colorOf(w.color) || "";
          setFont(n, w.font);
          if (w.bold) n.style.fontWeight = "700";
          if (!w.upright) n.setAttribute("transform", `rotate(${a.toFixed(1)} ${px.toFixed(1)} ${py.toFixed(1)})`);
        }
        return null;
      },
    },

    // A ring of ticks round (x, y), as on a watch face.
    ticks: {
      icon: "⁞", group: "clock",
      props: {
        r: { kind: "number", min: 10, max: 320, default: 300 },
        length: { kind: "number", min: 1, max: 80, default: 10, label: "p.tickLen" },
        count: { kind: "number", min: 1, max: 180, default: 60, step: 1 },
        start: angle(0),
        end: angle(360),
        width: { kind: "number", min: 0.5, max: 12, default: 1.5 },
        color: { kind: "color", default: "ink3" },
      },
      resize: scaled("r", "length"),
      build(g, w) {
        // count is the number of ticks, as with lamps and numerals; K.ticks takes the gaps
        // between them. A full turn would put the last tick on the first, so it stops a gap short.
        const full = Math.abs(w.end - w.start) >= 360;
        const n = Math.round(w.count);
        const end = n === 1 ? w.start : full ? w.start + ((w.end - w.start) * (n - 1)) / n : w.end;
        K.ticks(g, w.r - w.length, w.r, w.start, end, Math.max(1, n - 1), w.x, w.y, w.width);
        if (colorOf(w.color)) for (const l of g.children || []) l.style && (l.style.stroke = colorOf(w.color));
        return null;
      },
    },

    // A ring, a disc, a rectangle, a line or an arc, centred on (x, y).
    shape: {
      icon: "◯", group: "decor",
      props: {
        kind: { kind: "select", options: [["ring", "p.kindRing"], ["circle", "p.kindCircle"], ["rect", "p.kindRect"], ["line", "p.kindLine"], ["arc", "p.kindArc"]], default: "ring" },
        w: { kind: "number", min: 0, max: 640, default: 200 },
        h: { kind: "number", min: 0, max: 640, default: 200, when: (w) => w.kind === "rect" || w.kind === "line" },
        start: { ...angle(-60), when: (w) => w.kind === "arc" },
        end: { ...angle(60), when: (w) => w.kind === "arc" },
        stroke: { kind: "number", min: 0, max: 60, default: 2 },
        dash: { kind: "number", min: 0, max: 60, default: 0, when: (w) => w.kind !== "circle" },
        color: { kind: "color", default: "track" },
        opacity: { kind: "number", min: 0.05, max: 1, step: 0.05, default: 1 },
      },
      resize: scaled("w", "h"),
      build(g, w) {
        const col = colorOf(w.color) || "var(--track)";
        const dash = w.dash && w.kind !== "circle" ? `;stroke-dasharray:${w.dash} ${w.dash}` : "";
        const line = `fill:none;stroke:${col};stroke-width:${w.stroke}px${dash}`, fill = `fill:${col};stroke:none`;
        g.setAttribute("opacity", w.opacity);
        if (w.kind === "ring") el(g, "circle", { cx: w.x, cy: w.y, r: w.w / 2, style: line });
        else if (w.kind === "circle") el(g, "circle", { cx: w.x, cy: w.y, r: w.w / 2, style: fill });
        else if (w.kind === "rect") el(g, "rect", { x: w.x - w.w / 2, y: w.y - w.h / 2, width: w.w, height: w.h, rx: Math.min(14, w.h / 2), style: w.stroke ? line : fill });
        else if (w.kind === "arc") el(g, "path", { d: arcD(w.w / 2, w.start, Math.abs(w.end - w.start) >= 360 ? w.start + 359.9 : w.end, w.x, w.y), style: `${line};stroke-linecap:${w.dash ? "butt" : "round"}` });
        else el(g, "path", { d: `M${w.x - w.w / 2} ${w.y - w.h / 2}L${w.x + w.w / 2} ${w.y + w.h / 2}`, style: `${line};stroke-linecap:round` });
        return null;
      },
    },

    // A picture or GIF from the media folder, optionally cut round.
    image: {
      icon: "▣", group: "decor",
      props: {
        src: { kind: "media", default: "" },
        w: { kind: "number", min: 8, max: 640, default: 200 },
        h: { kind: "number", min: 8, max: 640, default: 200 },
        round: { kind: "bool", default: true },
        opacity: { kind: "number", min: 0.05, max: 1, step: 0.05, default: 1 },
      },
      resize: scaled("w", "h"),
      build(g, w) {
        const name = /^media:(.+)$/.exec(w.src || "");
        const box = { x: w.x - w.w / 2, y: w.y - w.h / 2, width: w.w, height: w.h };
        if (!name) {
          el(g, "rect", { ...box, rx: w.round ? Math.min(w.w, w.h) / 2 : 12, style: "fill:none;stroke:var(--ink-3);stroke-width:2;stroke-dasharray:6 6" });
          return null;
        }
        const img = el(g, "image", { ...box, href: `/media/${encodeURIComponent(name[1])}`, preserveAspectRatio: "xMidYMid slice", opacity: w.opacity });
        if (w.round) {
          const id = `fclip${++clips}`;
          const cp = el(g, "clipPath", { id });
          el(cp, "ellipse", { cx: w.x, cy: w.y, rx: w.w / 2, ry: w.h / 2 });
          img.setAttribute("clip-path", `url(#${id})`);
        }
        return null;
      },
    },

    // A mascot standing on (x, y); with room to walk it wanders, blinks and looks around.
    mascot: {
      icon: "👾", group: "decor",
      props: {
        mascot: { kind: "mascot", default: "auto" },
        px: { kind: "number", min: 2, max: 16, default: 7, step: 1 },
        walk: { kind: "number", min: 0, max: 600, default: 200 },
        ascii: { kind: "bool", default: false, label: "p.fontMono" },
      },
      resize: (w, k) => ({ px: Math.round(w.px * k) }),
      build(g, w, env) {
        const m = K.mascotById(w.mascot === "auto" ? env.mascot : w.mascot);
        const s = w.ascii ? K.asciiSprite(g, m, w.px / 1.17) : K.sprite(g, m, Math.round(w.px));
        K.walker(s, m, w.x - w.walk / 2, w.x + w.walk / 2, w.y, env.animate);
        return null;
      },
    },

    // When the limits were synced, with the pie filling until the next sync, and the cost.
    status: {
      icon: "◔", group: "decor",
      props: {},
      build(g, w) {
        return K.meta(g, w.y, w.x - 10);
      },
    },
  };

  // Lines of text with their {source} placeholders filled in: lines -> (d) => strings.
  function textFiller(lines) {
    const parts = lines.map((line) => String(line).split(/(\{[a-z0-9.]+\})/i));
    return (d) => {
      const cache = {};
      return parts.map((ps) =>
        ps.map((p) => {
          const id = /^\{([a-z0-9.]+)\}$/i.exec(p);
          if (!id || !SOURCES[id[1]]) return p;
          return (cache[id[1]] = cache[id[1]] || valueText(SOURCES[id[1]].read(d)));
        }).join(""));
    };
  }

  // ---------- checking a face ----------

  const newId = () => Math.random().toString(36).slice(2, 10);
  const MEDIA = /^media:[^/\\]{1,200}$/;
  const LOOKS = ["plain", "raw", "ascii"];
  function fixProp(spec, v) {
    switch (spec.kind) {
      case "number": {
        const n = typeof v === "number" && isFinite(v) ? v : spec.default;
        const c = clamp(n, spec.min, spec.max);
        return spec.step ? Math.round(Math.round(c / spec.step) * spec.step * 1000) / 1000 : Math.round(c * 10) / 10;
      }
      case "bool":
        return typeof v === "boolean" ? v : spec.default;
      case "text":
      case "longtext":
        return typeof v === "string" ? v.slice(0, 500) : spec.default;
      case "select":
        return spec.options.some(([o]) => o === v) ? v : spec.default;
      case "source":
        return SOURCES[v] && (!spec.gauged || GAUGED.includes(v)) && (!spec.digits || DIGITAL.includes(v)) ? v : spec.default;
      case "color":
        return ROLES[v] || /^#[0-9a-f]{6}$/i.test(v || "") ? v : spec.default;
      case "media":
        return typeof v === "string" && (v === "" || MEDIA.test(v)) ? v : spec.default;
      case "mascot":
        return v === "auto" || window.KrakenDial.MASCOTS.some((m) => m.id === v) ? v : spec.default;
      default:
        return spec.default;
    }
  }
  function normalizeWidget(w) {
    const def = w && WIDGETS[w.type];
    if (!def) return null;
    const out = {
      type: w.type,
      id: /^[a-z0-9]{1,16}$/.test(w.id || "") ? w.id : newId(),
      x: fixProp({ kind: "number", min: -320, max: 960, default: C }, w.x),
      y: fixProp({ kind: "number", min: -320, max: 960, default: C }, w.y),
    };
    for (const [k, spec] of Object.entries(def.props)) out[k] = fixProp(spec, w[k]);
    if (w.hidden === true) out.hidden = true;
    if (typeof w.name === "string" && w.name) out.name = w.name.slice(0, 60);
    return out;
  }
  // The face's own look, each part only when it is one the dial knows.
  function lookOf(f) {
    const out = {};
    if (window.KrakenDial.THEMES.some((x) => x.id === f.theme)) out.theme = f.theme;
    if (window.KrakenDial.BGS.some((x) => x.id === f.bg) || MEDIA.test(f.bg || "")) out.bg = f.bg;
    if (LOOKS.includes(f.look)) out.look = f.look;
    return out;
  }
  function normalize(face) {
    const f = face && typeof face === "object" ? face : {};
    const seen = new Set();
    const widgets = (Array.isArray(f.widgets) ? f.widgets : []).slice(0, 200).map(normalizeWidget).filter(Boolean);
    // ids must be unique within a face, for the editor to tell widgets apart
    for (const w of widgets) {
      while (seen.has(w.id)) w.id = newId();
      seen.add(w.id);
    }
    return {
      version: 1,
      id: /^[a-z0-9-]{1,40}$/.test(f.id || "") ? f.id : "",
      name: typeof f.name === "string" && f.name.trim() ? f.name.trim().slice(0, 60) : t("ed.untitled"),
      ...lookOf(f),
      widgets,
    };
  }
  const widget = (type, props) => normalizeWidget({ type, ...props });
  // Whether a face shows anything of the usage source: limits or costs, as gauges or in text.
  const usesSource = (face) =>
    ((face && face.widgets) || []).some((w) => /^(limit\.|cost)/.test(w.source || "") || /\{(limit\.|cost)/.test(w.text || ""));

  // ---------- building ----------

  function build(p, face, env) {
    const ups = [];
    for (const w of normalize(face).widgets) {
      if (w.hidden) continue;
      const g = el(p, "g", { "data-w": w.id });
      try {
        const u = WIDGETS[w.type].build(g, w, env || {});
        if (u) ups.push(u);
      } catch (e) {
        // one broken widget must not take the face down with it
        console.error("face widget", w.type, e);
      }
    }
    return ups;
  }

  // ---------- blocks ----------
  // Widgets that make one thing together, added in one go and selected together, so they move as
  // one. Laid out round the middle of the dial.
  const BLOCKS = [
    {
      id: "ring",
      widgets: () => [
        widget("arc", { source: "cpu.load", r: 120, start: 0, end: 360, width: 16, rounded: true }),
        widget("value", { source: "cpu.load", y: 340, size: 76, sub: false, showLabel: false }),
        widget("text", { text: "CPU", y: 382, size: 18, bold: true, spacing: 0.2, color: "ink3" }),
      ],
    },
    {
      id: "speedo",
      widgets: () => [
        widget("ticks", { r: 160, length: 10, count: 51, start: -135, end: 135, width: 1.5 }),
        widget("ticks", { r: 160, length: 20, count: 11, start: -135, end: 135, width: 3, color: "ink2" }),
        widget("numerals", { kind: "scale", r: 120, size: 20, from: 0, to: 100, count: 6, start: -135, end: 135 }),
        widget("needle", { source: "gpu.load", length: 150, tail: 26, width: 8, hub: 12 }),
        widget("value", { source: "gpu.load", y: 430, size: 44, sub: false, showLabel: false }),
        widget("text", { text: "GPU", y: 462, size: 15, bold: true, spacing: 0.2, color: "ink3" }),
      ],
    },
    {
      id: "analog",
      widgets: () => [
        widget("ticks", { r: 190, length: 8, count: 60, width: 1.2 }),
        widget("ticks", { r: 190, length: 18, count: 12, width: 4, color: "ink2" }),
        widget("numerals", { r: 148, size: 26 }),
        widget("hands", { size: 180 }),
      ],
    },
    {
      id: "digital",
      widgets: () => [
        widget("segment", { source: "time", y: 350, size: 100 }),
        widget("text", { text: "{date}", y: 400, size: 22 }),
      ],
    },
    {
      id: "pair",
      widgets: () => [
        widget("value", { source: "cpu.temp", x: 226, y: 350, size: 96 }),
        widget("shape", { kind: "line", y: 320, w: 0, h: 120, stroke: 2 }),
        widget("value", { source: "gpu.temp", x: 414, y: 350, size: 96 }),
      ],
    },
    {
      id: "leds",
      widgets: () => [
        widget("dots", { source: "gpu.temp", r: 140, count: 32, size: 6, start: -135, end: 135 }),
        widget("value", { source: "gpu.temp", y: 350, size: 90, sub: false }),
      ],
    },
  ];

  window.KrakenFaces = { build, normalize, normalizeWidget, widget, usesSource, WIDGETS, SOURCES, GAUGED, DIGITAL, BLOCKS, ROLES, LOOKS, newId };
})();
