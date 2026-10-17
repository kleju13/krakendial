// Faces made in the editor: a list of widgets, each drawn with the parts of the built-in layouts
// (kit in dial.js), so a face follows the theme and costs CAM no more than a built-in layout.
//   KrakenFaces.build(svg, face, env)  -> updaters (d) => …; dial.js calls it for "face:<id>"
//   KrakenFaces.normalize(face)        -> the face with only known widgets and values in range
//   KrakenFaces.WIDGETS, SOURCES       -> what the editor offers: widget types and what they show
//   KrakenFaces.TEMPLATES              -> faces to start from
// A face is plain JSON, documented in docs/faces.md:
//   { "version": 1, "id": "my-face", "name": "My face", "widgets": [{ "type": "value", "x": 320, ... }] }
// To add a widget type, add it to WIDGETS: its props (which the editor turns into fields and
// normalize() checks), how it scales when resized, and build(g, w, env) returning an updater.
(function () {
  const K = window.KrakenDial.kit;
  const t = window.KrakenI18n.t;
  const { C, el, clamp, int, dec, setText, setAttr, setSpans, setParts, setNum } = K;

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
      label: () => t("lbl.time"), text: true,
      read: (d) => {
        const at = new Date(d.now);
        return { n: K.hhmm(d.now), u: "", frac: (at.getHours() * 60 + at.getMinutes()) / 1440, sub: K.dateText(d.now, "date") };
      },
    },
    "time.seconds": {
      label: () => t("lbl.time"), text: true,
      read: (d) => ({ n: K.hhmmss(d.now), u: "", frac: new Date(d.now).getSeconds() / 60, sub: K.dateText(d.now, "date") }),
    },
    date: {
      label: () => t("lbl.date"), text: true,
      read: (d) => ({ n: K.dateText(d.now, "date"), u: "", frac: null, sub: "" }),
    },
  };
  // Sources that fill a gauge: everything with a scale.
  const GAUGED = Object.keys(SOURCES).filter((k) => !SOURCES[k].text);
  const sourceOf = (id) => SOURCES[id] || SOURCES["cpu.temp"];
  // A source as text, with its unit: "54°", "15%", "42 W", "$14.29", "21:07".
  const valueText = (r) => `${r.n}${r.n === "—" ? "" : r.u}`;
  const subText = (r) => (Array.isArray(r.sub) ? r.sub.map((x) => x.t).join(" ") : r.sub || "");

  // Fills a gauge the way the built-in layouts do: limits with their pace, temperatures with the
  // recent peak and the hot part in the second colour, the rest plainly.
  function fillGauge(gg, r) {
    if (r.v) return K.limitGauge(gg, r.v);
    const p = (f) => (f == null ? null : f * 100);
    if (r.hot != null) return gg.set(p(r.frac) ?? 0, p(r.peak), p(r.hot), { hot: true });
    gg.set(p(r.frac) ?? 0, null, null);
  }

  // ---------- colours ----------
  // Roles follow the theme; a widget may also have a fixed #rrggbb.
  const ROLES = { ink: "--ink", ink2: "--ink-2", ink3: "--ink-3", accent: "--fill", accent2: "--fill-2", warn: "--warn", track: "--track" };
  const colorOf = (c) => (ROLES[c] ? `var(${ROLES[c]})` : /^#[0-9a-f]{6}$/i.test(c || "") ? c : null);
  // Gauges and bars paint with --fill; giving the group another --fill recolours just them.
  function tint(g, c) {
    if (c && c !== "accent" && colorOf(c)) g.style.setProperty("--fill", colorOf(c));
  }

  // ---------- widgets ----------
  // Prop kinds: number {min, max, step}, text, longtext, bool, select {options}, source {gauged},
  // color, media, mascot. x and y come with every widget.

  const ALIGN = { kind: "select", options: [["start", "p.alignStart"], ["middle", "p.alignMiddle"], ["end", "p.alignEnd"]] };
  const GLYPHS = { block: ["█", "░"], square: ["■", "■"], dot: ["●", "○"], pipe: ["|", "·"] };
  // whole units once a size is big enough to not need the fraction
  const round = (v) => (Math.abs(v) >= 20 ? Math.round(v) : Math.round(v * 10) / 10);
  const scaled = (...keys) => (w, k) => Object.fromEntries(keys.map((key) => [key, round(w[key] * k)]));

  const WIDGETS = {
    // A big number with its unit, a label above and a line below, like the round layouts.
    value: {
      icon: "42",
      props: {
        source: { kind: "source", default: "cpu.temp" },
        size: { kind: "number", min: 16, max: 280, default: 110 },
        showLabel: { kind: "bool", default: true, label: "p.showLabel" },
        label: { kind: "text", default: "", hint: "p.labelAuto", when: (w) => w.showLabel },
        sub: { kind: "bool", default: true },
        align: { ...ALIGN, default: "middle" },
        color: { kind: "color", default: "ink" },
      },
      resize: scaled("size"),
      build(g, w) {
        const src = sourceOf(w.source), s = w.size;
        const lbl = w.showLabel ? el(g, "text", { x: w.x, y: (w.y - s * 0.9).toFixed(1), "text-anchor": w.align, class: "t-lbl", style: `font-size:${Math.max(10, s * 0.18).toFixed(1)}px` }) : null;
        const val = K.num(g, w.x, w.y, s, w.align);
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

    // Text, with {source} placeholders filled in: "CPU {cpu.temp} · {cpu.load}". One line per line.
    text: {
      icon: "Aa",
      props: {
        text: { kind: "longtext", default: "{time}", hint: "p.textHint" },
        size: { kind: "number", min: 8, max: 200, default: 28 },
        font: { kind: "select", options: [["sans", "p.fontSans"], ["mono", "p.fontMono"]], default: "sans" },
        bold: { kind: "bool", default: false, label: "p.weight" },
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
          if (w.bold) n.style.fontWeight = "700";
          return n;
        });
        const parts = lines.map((line) => line.split(/(\{[a-z0-9.]+\})/i));
        return (d) => {
          const cache = {};
          parts.forEach((ps, i) => {
            const s = ps.map((p) => {
              const id = /^\{([a-z0-9.]+)\}$/i.exec(p);
              if (!id || !SOURCES[id[1]]) return p;
              return (cache[id[1]] = cache[id[1]] || valueText(SOURCES[id[1]].read(d)));
            });
            setText(nodes[i], s.join(""));
          });
        };
      },
    },

    // An arc around (x, y), like the rim gauges: limits show their pace, temperatures their peak.
    arc: {
      icon: "◠",
      props: {
        source: { kind: "source", gauged: true, default: "cpu.temp" },
        r: { kind: "number", min: 16, max: 320, default: 284 },
        start: { kind: "number", min: -360, max: 360, default: -150 },
        end: { kind: "number", min: -360, max: 360, default: -30 },
        width: { kind: "number", min: 1, max: 60, default: 14 },
        ticks: { kind: "number", min: 0, max: 60, default: 0, label: "p.count" },
        color: { kind: "color", default: "accent" },
      },
      resize: scaled("r", "width"),
      build(g, w) {
        const src = sourceOf(w.source);
        // a full circle can't be one arc: stop just short of it
        const end = Math.abs(w.end - w.start) >= 360 ? w.start + Math.sign(w.end - w.start || 1) * 359.9 : w.end;
        tint(g, w.color);
        const gg = K.arcGauge(g, w.r, w.start, end, w.width, w.x, w.y);
        if (src.read === SOURCES["cpu.temp"].read || src.read === SOURCES["gpu.temp"].read) gg.notch.classList.add("is-peak");
        if (w.ticks) K.ticks(g, w.r - w.width / 2 - 18, w.r - w.width / 2 - 10, w.start, end, w.ticks, w.x, w.y);
        return (d) => fillGauge(gg, src.read(d));
      },
    },

    // A straight bar centred on (x, y).
    bar: {
      icon: "▬",
      props: {
        source: { kind: "source", gauged: true, default: "limit.claude5h" },
        length: { kind: "number", min: 10, max: 640, default: 300 },
        width: { kind: "number", min: 1, max: 80, default: 10 },
        vertical: { kind: "bool", default: false },
        color: { kind: "color", default: "accent" },
      },
      resize: scaled("length", "width"),
      build(g, w) {
        const src = sourceOf(w.source), h = w.length / 2;
        tint(g, w.color);
        const gg = w.vertical ? K.columnGauge(g, w.x, w.y + h, w.y - h, w.width) : K.barGauge(g, w.x - h, w.x + h, w.y, w.width);
        return (d) => fillGauge(gg, src.read(d));
      },
    },

    // A bar of characters, ■■■■□□□ 42%, filling to its exact place like the terminal layouts.
    cells: {
      icon: "▮▯",
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

    // The last minutes of a value, as a line, an area or btop's braille, scaled to what it holds.
    graph: {
      icon: "⌁",
      props: {
        source: { kind: "source", gauged: true, default: "cpu.temp" },
        w: { kind: "number", min: 40, max: 640, default: 300 },
        h: { kind: "number", min: 16, max: 400, default: 90 },
        style: { kind: "select", options: [["area", "p.styleArea"], ["line", "p.styleLine"], ["braille", "p.styleBraille"]], default: "area" },
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
        const area = w.style === "area" ? el(g, "path", { style: `fill:${col};fill-opacity:0.18;stroke:none` }) : null;
        const line = el(g, "path", { style: `fill:none;stroke:${col};stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round` });
        el(g, "path", { d: `M${x0} ${w.y + w.h / 2}H${x0 + w.w}`, class: "rule", style: "stroke-width:1.5" });
        return (d) => {
          if (d.now - sampledAt < 3000) return;
          sampledAt = d.now;
          hist.push(src.read(d).raw ?? null);
          if (hist.length > n) hist.shift();
          const [lo, hi] = range();
          const pts = [];
          hist.forEach((v, i) => {
            if (v == null) return;
            const x = x0 + (w.w * (n - hist.length + i)) / Math.max(1, n - 1);
            pts.push([x, w.y + w.h / 2 - (w.h * clamp((v - lo) / (hi - lo), 0, 1))]);
          });
          const dl = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
          setAttr(line, "d", dl);
          if (area) setAttr(area, "d", pts.length ? `${dl}L${pts[pts.length - 1][0].toFixed(1)} ${w.y + w.h / 2}L${pts[0][0].toFixed(1)} ${w.y + w.h / 2}Z` : "");
        };
      },
    },

    // Hour, minute and (optionally) second hands turning round (x, y).
    hands: {
      icon: "◷",
      props: {
        size: { kind: "number", min: 20, max: 320, default: 240, label: "p.r" },
        seconds: { kind: "bool", default: true },
      },
      resize: scaled("size"),
      build(g, w) {
        const k = w.size / 246;
        const hand = (len, tail, cls, width) => {
          const h = el(g, "g", { class: `hand ${cls}` });
          el(h, "line", { x1: w.x, y1: w.y + tail * k, x2: w.x, y2: w.y - len * k, style: `stroke-width:${(width * k).toFixed(2)}px` });
          return h;
        };
        const hh = hand(124, 20, "hand-h", 9), mm = hand(212, 24, "hand-m", 5.5);
        const ss = w.seconds ? hand(246, 46, "hand-s", 2.5) : null;
        el(g, "circle", { cx: w.x, cy: w.y, r: (9 * k).toFixed(1), class: "hub" });
        el(g, "circle", { cx: w.x, cy: w.y, r: (3.5 * k).toFixed(1), class: "hub-s" });
        return (d) => {
          const at = new Date(d.now);
          const s = at.getSeconds(), m = at.getMinutes() + s / 60, h = (at.getHours() % 12) + m / 60;
          setAttr(hh, "transform", `rotate(${(h * 30).toFixed(1)} ${w.x} ${w.y})`);
          setAttr(mm, "transform", `rotate(${(m * 6).toFixed(1)} ${w.x} ${w.y})`);
          if (ss) setAttr(ss, "transform", `rotate(${s * 6} ${w.x} ${w.y})`);
        };
      },
    },

    // A mascot standing on (x, y); with room to walk it wanders, blinks and looks around.
    mascot: {
      icon: "👾",
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
      icon: "◔",
      props: {},
      build(g, w) {
        return K.meta(g, w.y, w.x - 10);
      },
    },

    // A picture or GIF from the media folder, optionally cut round.
    image: {
      icon: "▣",
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

    // A ring, a disc, a rectangle or a line, centred on (x, y).
    shape: {
      icon: "◯",
      props: {
        kind: { kind: "select", options: [["ring", "p.kindRing"], ["circle", "p.kindCircle"], ["rect", "p.kindRect"], ["line", "p.kindLine"]], default: "ring" },
        w: { kind: "number", min: 1, max: 640, default: 200 },
        h: { kind: "number", min: 0, max: 640, default: 200, when: (w) => w.kind === "rect" || w.kind === "line" },
        stroke: { kind: "number", min: 0, max: 60, default: 2 },
        color: { kind: "color", default: "track" },
        opacity: { kind: "number", min: 0.05, max: 1, step: 0.05, default: 1 },
      },
      resize: scaled("w", "h"),
      build(g, w) {
        const col = colorOf(w.color) || "var(--track)";
        const line = `fill:none;stroke:${col};stroke-width:${w.stroke}px`, fill = `fill:${col};stroke:none`;
        g.setAttribute("opacity", w.opacity);
        if (w.kind === "ring") el(g, "circle", { cx: w.x, cy: w.y, r: w.w / 2, style: line });
        else if (w.kind === "circle") el(g, "circle", { cx: w.x, cy: w.y, r: w.w / 2, style: fill });
        else if (w.kind === "rect") el(g, "rect", { x: w.x - w.w / 2, y: w.y - w.h / 2, width: w.w, height: w.h, rx: Math.min(14, w.h / 2), style: w.stroke ? line : fill });
        else el(g, "path", { d: `M${w.x - w.w / 2} ${w.y - w.h / 2}L${w.x + w.w / 2} ${w.y + w.h / 2}`, style: `${line};stroke-linecap:round` });
        return null;
      },
    },

    // A ring of ticks round (x, y), as on a watch face.
    ticks: {
      icon: "⁞",
      props: {
        r: { kind: "number", min: 10, max: 320, default: 300 },
        length: { kind: "number", min: 1, max: 80, default: 10, label: "p.tickLen" },
        count: { kind: "number", min: 1, max: 180, default: 60, step: 1 },
        start: { kind: "number", min: -360, max: 360, default: 0 },
        end: { kind: "number", min: -360, max: 360, default: 360 },
        width: { kind: "number", min: 0.5, max: 12, default: 1.5 },
        color: { kind: "color", default: "ink3" },
      },
      resize: scaled("r", "length"),
      build(g, w) {
        // a full turn would put the last tick on the first
        const full = Math.abs(w.end - w.start) >= 360;
        const n = Math.round(w.count);
        const end = full ? w.start + ((w.end - w.start) * (n - 1)) / n : w.end;
        K.ticks(g, w.r - w.length, w.r, w.start, end, full ? n - 1 : n, w.x, w.y, w.width);
        if (colorOf(w.color)) for (const l of g.children || []) l.style && (l.style.stroke = colorOf(w.color));
        return null;
      },
    },
  };
  let clips = 0;

  // ---------- checking a face ----------

  const newId = () => Math.random().toString(36).slice(2, 10);
  const MEDIA = /^media:[^/\\]{1,200}$/;
  function fixProp(spec, v) {
    switch (spec.kind) {
      case "number": {
        const n = typeof v === "number" && isFinite(v) ? v : spec.default;
        const c = clamp(n, spec.min, spec.max);
        return spec.step ? Math.round(c / spec.step) * spec.step : Math.round(c * 10) / 10;
      }
      case "bool":
        return typeof v === "boolean" ? v : spec.default;
      case "text":
      case "longtext":
        return typeof v === "string" ? v.slice(0, 500) : spec.default;
      case "select":
        return spec.options.some(([o]) => o === v) ? v : spec.default;
      case "source":
        return SOURCES[v] && (!spec.gauged || GAUGED.includes(v)) ? v : spec.default;
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
      widgets,
    };
  }
  const widget = (type, props) => normalizeWidget({ type, ...props });

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

  // ---------- faces to start from ----------
  // The widgets of each are what the editor puts down; they are also examples of the format.
  const TEMPLATES = [
    { id: "blank", widgets: () => [] },
    {
      id: "gauges",
      widgets: () => [
        widget("arc", { source: "cpu.temp", r: 284, start: -150, end: -30, width: 14, ticks: 8 }),
        widget("arc", { source: "gpu.temp", r: 284, start: 150, end: 30, width: 14, ticks: 8 }),
        widget("text", { text: "{time}", x: 320, y: 96, size: 30, color: "ink2" }),
        widget("value", { source: "cpu.temp", x: 226, y: 290, size: 106 }),
        widget("value", { source: "gpu.temp", x: 414, y: 290, size: 106 }),
        widget("shape", { kind: "line", x: 320, y: 230, w: 0, h: 140, stroke: 2 }),
        widget("value", { source: "liquid", x: 226, y: 450, size: 70, sub: false }),
        widget("value", { source: "power", x: 414, y: 450, size: 70, sub: false }),
        widget("status", { x: 320, y: 552 }),
      ],
    },
    {
      id: "limits",
      widgets: () => [
        widget("arc", { source: "limit.claude5h", r: 290, start: -135, end: 135, width: 16, ticks: 10 }),
        widget("arc", { source: "limit.claude7d", r: 258, start: -135, end: 135, width: 10 }),
        widget("arc", { source: "limit.codex7d", r: 234, start: -135, end: 135, width: 10, color: "accent2" }),
        widget("text", { text: "{time}", x: 320, y: 140, size: 30, color: "ink2" }),
        widget("value", { source: "limit.claude5h", x: 320, y: 360, size: 150 }),
        widget("text", { text: "7d {limit.claude7d} · codex {limit.codex7d}", x: 320, y: 470, size: 22, color: "ink2" }),
        widget("status", { x: 320, y: 560 }),
      ],
    },
    {
      id: "terminal",
      widgets: () => [
        widget("mascot", { x: 320, y: 214, px: 7, walk: 220 }),
        widget("text", { text: "kraken@lcd", x: 138, y: 262, size: 24, font: "mono", align: "start", color: "accent", bold: true }),
        widget("text", { text: "cpu    {cpu.temp}\ngpu    {gpu.temp}\nliquid {liquid}\npower  {power}", x: 138, y: 300, size: 24, font: "mono", align: "start", color: "ink" }),
        widget("cells", { source: "cpu.load", x: 330, y: 300, size: 24, cells: 7, value: false }),
        widget("cells", { source: "gpu.load", x: 330, y: 328.8, size: 24, cells: 7, value: false }),
        widget("cells", { source: "limit.claude5h", x: 138, y: 448, size: 24, cells: 10 }),
        widget("cells", { source: "limit.claude7d", x: 138, y: 480, size: 24, cells: 10 }),
        widget("text", { text: "{time.seconds}", x: 320, y: 540, size: 18, font: "mono", color: "ink3" }),
      ],
    },
    {
      id: "clock",
      widgets: () => [
        widget("ticks", { r: 302, length: 12, count: 60, width: 1.5 }),
        widget("ticks", { r: 302, length: 26, count: 12, width: 4, color: "ink2" }),
        widget("text", { text: "{date}", x: 320, y: 210, size: 22, color: "ink2" }),
        widget("value", { source: "cpu.temp", x: 220, y: 420, size: 46, sub: false }),
        widget("value", { source: "gpu.temp", x: 420, y: 420, size: 46, sub: false }),
        widget("hands", { size: 250 }),
      ],
    },
  ];

  window.KrakenFaces = { build, normalize, normalizeWidget, widget, WIDGETS, SOURCES, GAUGED, TEMPLATES, ROLES, newId };
})();
