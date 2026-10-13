// Kraken Elite LCD dial (640×640, round). SVG over a canvas background (bg.js), no dependencies.
// CAM renders web integrations without a GPU, so everything here keeps the CPU idle: scenes are
// separate layers so fades are composited, and the DOM is only touched when a value really changes.
//   const dial = KrakenDial.create(container, { layout, theme, bg, fps, units, look });
//   dial.update({ now, hw, limits, interval, mode });        // call about once a second
//   dial.configure({ layout, theme, bg, fps, units, look }); // switch variant live
//   dial.setActivity(gpuLoad);                               // 0..1, speeds the background up under load
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const C = 320;
  const STALE_MS = 5 * 60e3;
  const ROTATE_MS = 12e3;
  const CAROUSEL_MS = 6e3;
  const HOT = { cpu: 85, gpu: 80 };
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const LAYOUTS = [
    { id: "rotacja", name: "Rotation", desc: "Limits and hardware, taking turns every 12 s." },
    { id: "adaptacyjny", name: "Adaptive", desc: "Limits; hardware while you game." },
    { id: "kokpit", name: "Cockpit", desc: "Everything at once: limits, temperatures, power, RAM." },
    { id: "chronograf", name: "Chronograph", desc: "A watch with hands, a subdial per limit." },
    { id: "slupki", name: "Columns", desc: "Seven bars side by side." },
    { id: "terminal", name: "Terminal", desc: "Everything as console output." },
    { id: "htop", name: "htop", desc: "Meters on top, limits as the process list." },
    { id: "btop", name: "btop", desc: "Boxes and braille graphs of the last minutes." },
    { id: "neofetch", name: "neofetch", desc: "A kraken logo and the system at a glance." },
    { id: "zegar", name: "Clock", desc: "The time, large; limits and hardware around it." },
    { id: "jedna", name: "One number", desc: "One huge value, the next one every 6 s." },
    { id: "limity", name: "Limits only", desc: "Claude 5h, Claude 7d and Codex." },
    { id: "sprzet", name: "Hardware only", desc: "CPU, GPU, liquid and power." },
  ];
  const THEMES = [
    { id: "ice", name: "Ice" },
    { id: "porcelana", name: "Porcelain" },
    { id: "mroz", name: "Frost" },
    { id: "blue", name: "Blue" },
    { id: "ocean", name: "Ocean" },
    { id: "deep", name: "Deep" },
    { id: "indygo", name: "Indigo" },
    { id: "grafit", name: "Graphite" },
    { id: "night", name: "Night" },
    { id: "neon", name: "Neon" },
  ];
  const BGS = window.KrakenBg.LIST;
  const LIMITS = [
    { key: "claude5h", label: "CLAUDE · 5H", short: "CLAUDE 5H", tiny: "5H", cmd: "claude 5h" },
    { key: "claude7d", label: "CLAUDE · 7D", short: "CLAUDE 7D", tiny: "7D", cmd: "claude 7d" },
    { key: "codex7d", label: "CODEX · 7D", short: "CODEX 7D", tiny: "CODEX", cmd: "codex  7d" },
  ];

  // ---------- helpers ----------

  function el(parent, tag, attrs, text) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const polar = (r, deg, cx = C, cy = C) => {
    const a = (deg * Math.PI) / 180;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  };
  function arcD(r, a0, a1, cx = C, cy = C) {
    const [x0, y0] = polar(r, a0, cx, cy);
    const [x1, y1] = polar(r, a1, cx, cy);
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    const sweep = a1 > a0 ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  const pad = (n) => String(n).padStart(2, "0");
  const hhmm = (t) => {
    const d = new Date(t);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const hhmmss = (t) => `${hhmm(t)}:${pad(new Date(t).getSeconds())}`;
  const when = (t, now) => (t - now < 18 * 3600e3 ? hhmm(t) : `${DAYS[new Date(t).getDay()]} ${hhmm(t)}`);
  function dur(ms) {
    const m = Math.max(0, Math.round(ms / 60e3));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${pad(m % 60)}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
  }
  const every = (ms) => (ms < 60e3 ? `${Math.round(ms / 1e3)} s` : `${Math.round(ms / 60e3)} min`);
  const dec = (v, d = 1) => (v == null ? "—" : v.toFixed(d));
  const int = (v) => (v == null ? "—" : `${Math.round(v)}`);
  const scale = (v, lo, hi) => clamp(((v ?? lo) - lo) / (hi - lo), 0, 1) * 100;
  const tempF = (t) => scale(t, 20, 100);
  const power = (hw) => (hw.cpu.power == null && hw.gpu.power == null ? null : (hw.cpu.power ?? 0) + (hw.gpu.power ?? 0));
  const isHot = (h, key) => h.temp != null && h.temp >= HOT[key];

  function setText(node, s) {
    if (node.textContent !== s) node.textContent = s;
  }
  function setAttr(node, k, v) {
    if (node.getAttribute(k) !== v) node.setAttribute(k, v);
  }
  function setParts(textEl, parts) {
    const key = JSON.stringify(parts);
    if (textEl._key === key) return;
    textEl._key = key;
    textEl.replaceChildren();
    for (const p of parts) el(textEl, "tspan", p.warn ? { class: "is-warn" } : {}, p.t);
  }
  // Coloured runs of text: [[className, text], ...]
  function setSpans(textEl, spans) {
    const key = spans.map((s) => s.join("\u0001")).join("\u0002");
    if (textEl._key === key) return;
    textEl._key = key;
    textEl.replaceChildren();
    for (const [cls, s] of spans) if (s) el(textEl, "tspan", cls ? { class: cls } : {}, s);
  }
  // Number with a lighter unit; a degree sign is lifted to cap height.
  function setNum(textEl, num, unit, unitSize, fontSize) {
    const key = `${num}|${unit}|${unitSize}`;
    if (textEl._key === key) return;
    textEl._key = key;
    textEl.replaceChildren(document.createTextNode(num));
    if (!unit) return;
    const attrs = { class: "u", "font-size": unitSize };
    if (unit === "°") attrs.dy = (-(fontSize - unitSize) * 0.68).toFixed(1);
    el(textEl, "tspan", attrs, unit);
  }
  const num = (p, x, y, size, anchor = "middle") =>
    el(p, "text", { x, y, "text-anchor": anchor, class: "n dimmable", "font-size": size });

  // ---------- data -> what the dial shows ----------

  // `left`: show what remains of the limit instead of what has been used.
  function limitView(l, now, interval, left) {
    const staleAfter = Math.max(STALE_MS, 3 * interval);
    if (!l || l.pct == null) {
      const sub = l && l.error ? [{ t: l.error, warn: true }] : [{ t: "waiting for data" }];
      return { state: l && l.error ? "error" : "none", pct: 0, pace: null, value: "—", dim: true, sub, left };
    }
    const show = (used) => (left ? 100 - used : used);
    const age = now - l.fetchedAt;
    const pace = l.windowMs && l.resetsAt ? clamp(100 * (1 - (l.resetsAt - now) / l.windowMs), 0, 100) : null;
    const pct = show(clamp(l.pct, 0, 100));
    const base = { pct, pace, value: `${Math.round(pct)}`, dim: false, state: "ok", left, resetsAt: l.resetsAt };
    if (l.resetsAt && now >= l.resetsAt) {
      return { ...base, state: "reset", pct: show(0), pace: 0, value: `${show(0)}`, dim: true, sub: [{ t: "window reset" }] };
    }
    if (age > staleAfter) {
      return { ...base, state: l.error ? "error" : "stale", dim: true, sub: [{ t: `${dur(age)} ago` }] };
    }
    if (!l.resetsAt) return { ...base, sub: [{ t: "window idle" }] };
    if (l.pct >= 100) return { ...base, hot: true, sub: [{ t: `limit · reset ${when(l.resetsAt, now)}`, warn: true }] };
    return { ...base, sub: [{ t: `reset ${when(l.resetsAt, now)}` }] };
  }

  // Where a limit gauge fills to, where the pace line sits and where the second colour starts.
  // The pace line is where the gauge would be at an even pace through the window: used, the
  // part past it is drawn lighter; left, the line marks how much should still be there.
  function limitSpan(v) {
    if (v.state === "none") return { f: 0, notch: null, over: null };
    if (!v.left) return { f: v.pct, notch: v.pace, over: v.pace };
    return { f: v.pct, notch: v.pace == null ? null : 100 - v.pace, over: null };
  }

  // The quiet status line: when limits were last fetched and how often, or what is failing.
  function metaView(limits, now, interval) {
    const entries = Object.entries(limits || {}).filter(([, l]) => l);
    const failing = entries.find(([, l]) => l.error);
    const last = Math.max(0, ...entries.map(([, l]) => l.fetchedAt || 0));
    if (failing) {
      const who = failing[0].startsWith("claude") ? "Claude" : "Codex";
      const retry = failing[1].nextAt > now ? ` · retry ${hhmm(failing[1].nextAt)}` : "";
      return { state: "error", frac: 1, last, text: `${who}: ${failing[1].error}${retry}` };
    }
    if (!last) return { state: "stale", frac: 0, last, text: "waiting for data" };
    // The real cadence: the service stretches it when a provider asks us to slow down.
    const cadence = Math.max(interval, ...entries.map(([, l]) => (l.fetchedAt && l.nextAt > l.fetchedAt ? l.nextAt - l.fetchedAt : 0)));
    const age = now - last;
    const stale = age > Math.max(STALE_MS, 3 * cadence);
    return { state: stale ? "stale" : "ok", frac: clamp(age / cadence, 0, 1), last, text: `synced ${hhmmss(last)} · every ${every(cadence)}` };
  }

  // ---------- primitives ----------

  // Any path drawn with pathLength=100 (arc or straight bar). fill covers [0, min(f, overFrom)],
  // the second colour covers [overFrom, f], and a thin line across it marks a reference: the
  // pace for limits, the recent peak for temperatures.
  function gauge(parent, geo, width) {
    const g = el(parent, "g", { class: "gauge" });
    const common = { d: geo.d, "stroke-width": width, pathLength: 100 };
    el(g, "path", { ...common, class: "g-track" });
    const fill = el(g, "path", { ...common, class: "g-fill", "stroke-dasharray": "0 200" });
    const over = el(g, "path", { ...common, class: "g-over", "stroke-dasharray": "0 0 0 200" });
    const notch = el(g, "g", { class: "notch" });
    const h = width / 2 + 3;
    let place;
    if (geo.kind === "arc") {
      const { r, cx, cy, a0, a1 } = geo;
      el(notch, "path", { d: `M${cx} ${cy - (r - h)}V${cy - (r + h)}` });
      if (cx !== C || cy !== C) notch.style.transformOrigin = `${cx}px ${cy}px`;
      place = (f) => `rotate(${(a0 + ((a1 - a0) * f) / 100).toFixed(2)}deg)`;
    } else {
      // A straight bar: the line is drawn across its start and slides along it.
      const { x0, y0, x1, y1 } = geo;
      const len = Math.hypot(x1 - x0, y1 - y0), dx = (x1 - x0) / len, dy = (y1 - y0) / len;
      el(notch, "path", { d: `M${x0 - dy * h} ${y0 + dx * h}L${x0 + dy * h} ${y0 - dx * h}` });
      place = (f) => `translate(${(((x1 - x0) * f) / 100).toFixed(1)}px, ${(((y1 - y0) * f) / 100).toFixed(1)}px)`;
    }
    let placed = (notch.style.transform = place(0));
    return {
      g,
      notch,
      set(f, notchF, overFrom, state = {}) {
        const cut = overFrom == null ? f : Math.min(f, overFrom);
        setAttr(fill, "stroke-dasharray", `${cut.toFixed(1)} 200`);
        const ov = overFrom != null && f > overFrom ? f - overFrom : 0;
        setAttr(over, "stroke-dasharray", `0 ${(overFrom ?? 0).toFixed(1)} ${ov.toFixed(1)} 200`);
        const display = notchF == null ? "none" : "";
        if (notch.style.display !== display) notch.style.display = display;
        const at = notchF == null ? placed : place(Math.round(notchF * 10) / 10);
        if (at !== placed) notch.style.transform = placed = at;
        g.classList.toggle("is-hot", !!state.hot);
        g.classList.toggle("is-dashed", !!state.dashed);
      },
    };
  }
  const arcGauge = (p, r, a0, a1, w, cx = C, cy = C) => gauge(p, { kind: "arc", d: arcD(r, a0, a1, cx, cy), r, a0, a1, cx, cy }, w);
  const barGauge = (p, x0, x1, y, w) => gauge(p, { kind: "bar", d: `M${x0} ${y}H${x1}`, x0, y0: y, x1, y1: y }, w);
  const columnGauge = (p, x, bottom, top, w) => gauge(p, { kind: "bar", d: `M${x} ${bottom}V${top}`, x0: x, y0: bottom, x1: x, y1: top }, w);
  // Limits change once per fetch, so they may glide; hardware gauges tick every second and jump.
  function limitGauge(gg, v) {
    const s = limitSpan(v);
    gg.g.classList.add("smooth");
    gg.set(s.f, s.notch, s.over, { hot: v.hot, dashed: v.state === "reset" || v.state === "none" });
  }
  const tempGauge = (gg, h, key) => gg.set(tempF(h.temp), h.peak != null ? tempF(h.peak) : null, tempF(HOT[key]), { hot: true });

  function ticks(parent, r0, r1, a0, a1, n, cx = C, cy = C, width = 2) {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const [x0, y0] = polar(r0, a, cx, cy);
      const [x1, y1] = polar(r1, a, cx, cy);
      el(parent, "line", { x1: x0, y1: y0, x2: x1, y2: y1, class: "tick", "stroke-width": width });
    }
  }

  function pie(parent, r = 6.5) {
    const outer = el(parent, "g");
    const g = el(outer, "g", { class: "pie" });
    const inner = el(g, "g", { class: "pie-inner" });
    el(inner, "circle", { r, class: "pie-ring" });
    const wedge = el(inner, "path", { class: "pie-wedge" });
    let lastFetch = null;
    return {
      move(x, y) {
        outer.setAttribute("transform", `translate(${x.toFixed(1)} ${y})`);
      },
      set(m) {
        setAttr(g, "class", `pie is-${m.state}`);
        const ri = r - 2.4;
        const f = m.state === "ok" ? Math.max(0.04, Math.round(m.frac * 40) / 40) : m.state === "error" ? 1 : 0;
        if (f >= 0.999) setAttr(wedge, "d", `M0 ${-ri}A${ri} ${ri} 0 1 1 -0.01 ${-ri}Z`);
        else {
          const a = f * 2 * Math.PI;
          setAttr(wedge, "d", `M0 0L0 ${-ri}A${ri} ${ri} 0 ${f > 0.5 ? 1 : 0} 1 ${(ri * Math.sin(a)).toFixed(2)} ${(-ri * Math.cos(a)).toFixed(2)}Z`);
        }
        if (lastFetch && m.last && m.last !== lastFetch) {
          inner.classList.remove("pulse");
          void inner.getBBox();
          inner.classList.add("pulse");
        }
        lastFetch = m.last;
      },
    };
  }

  // ---------- shared widgets ----------

  function clock(p, y) {
    const t = el(p, "text", { x: C, y, "text-anchor": "middle", class: "t-clock" });
    return (d) => setText(t, hhmm(d.now));
  }

  function meta(p, y) {
    const t = el(p, "text", { x: C + 10, y, "text-anchor": "middle", class: "t-meta" });
    const pi = pie(p);
    let lastText = null;
    return (d) => {
      const m = d.meta;
      if (m.text !== lastText) {
        t.textContent = m.text;
        t.classList.toggle("is-warn", m.state === "error");
        pi.move(C + 10 - t.getComputedTextLength() / 2 - 14, y - 5.5);
        lastText = m.text;
      }
      pi.set(m);
    };
  }

  // "LEFT" or "USED": says which way the limit numbers read.
  function unitHead(p, x, y, anchor = "middle") {
    const t = el(p, "text", { x, y, "text-anchor": anchor, class: "t-head" });
    return (d) => setText(t, d.unitWord);
  }

  function ramLine(p, y) {
    const t = el(p, "text", { x: C, y, "text-anchor": "middle", class: "t-sub" });
    return (d) => {
      const r = d.hw.ram || {};
      setText(t, `RAM  ${r.used == null ? "—" : dec(r.used / 1024)} / ${r.total == null ? "—" : Math.round(r.total / 1024)} GB`);
    };
  }

  // CPU rises up the left edge, GPU up the right; grey notch = peak of the last minutes.
  function tempArcs(p) {
    const cpu = arcGauge(p, 284, -150, -30, 14);
    const gpu = arcGauge(p, 284, 150, 30, 14);
    cpu.notch.classList.add("is-peak");
    gpu.notch.classList.add("is-peak");
    ticks(p, 262, 270, -150, -30, 8);
    ticks(p, 262, 270, 150, 30, 8);
    return (d) => {
      tempGauge(cpu, d.hw.cpu, "cpu");
      tempGauge(gpu, d.hw.gpu, "gpu");
    };
  }

  function tempBlock(p, key, cx, y, size, withSub) {
    el(p, "text", { x: cx, y: y - size * 0.86, "text-anchor": "middle", class: size > 80 ? "t-lbl" : "t-lbl-s" }, key.toUpperCase());
    const val = num(p, cx + size * 0.09, y, size);
    const sub = withSub ? el(p, "text", { x: cx, y: y + 34, "text-anchor": "middle", class: "t-sub" }) : null;
    return (d) => {
      const h = d.hw[key];
      setNum(val, int(h.temp), "°", size * 0.5, size);
      val.classList.toggle("is-warn", isHot(h, key));
      if (sub) setText(sub, `${h.load == null ? "—" : Math.round(h.load * 100)}% · ${int(h.power)} W`);
    };
  }

  // read(d) -> [number, unit, unit size as a share of size, warn?]
  function statBlock(p, label, cx, y, size, read, lblClass = "t-lbl") {
    el(p, "text", { x: cx, y: y - size * 0.92, "text-anchor": "middle", class: lblClass }, label);
    const val = num(p, cx, y, size);
    return (d) => {
      const [n, u, us, warn] = read(d);
      setNum(val, n, u, size * (us || 0.42), size);
      val.classList.toggle("is-warn", !!warn);
    };
  }
  const readLiquid = (d) => [dec(d.hw.liquid), "°", 0.5];
  const readPower = (d) => [int(power(d.hw)), " W", 0.38];
  const readRam = (d) => [d.hw.ram && d.hw.ram.used != null ? dec(d.hw.ram.used / 1024) : "—", " GB", 0.38];
  const readTemp = (key) => (d) => [int(d.hw[key].temp), "°", 0.5, isHot(d.hw[key], key)];

  // ---------- scenes ----------

  // Three limits, one per row: label + reset on the left, big percentage on the right, pace bar below.
  function sceneLimity(p) {
    const up = [clock(p, 96)];
    const x0 = 118, x1 = 522;
    up.push(unitHead(p, x1, 128, "end"));
    LIMITS.forEach((def, i) => {
      const yb = 204 + i * 128;
      el(p, "text", { x: x0, y: yb - 38, class: "t-lbl" }, def.short);
      const sub = el(p, "text", { x: x0, y: yb - 6, class: "t-sub" });
      const val = num(p, x1, yb, 88, "end");
      const bar = barGauge(p, x0, x1, yb + 26, 10);
      up.push((d) => {
        const v = d.views[def.key];
        limitGauge(bar, v);
        setNum(val, v.value, "%", 40, 88);
        val.classList.toggle("is-dim", v.dim);
        setParts(sub, v.sub);
      });
    });
    up.push(meta(p, 560));
    return up;
  }

  function sceneSprzet(p) {
    const up = [clock(p, 96), tempArcs(p)];
    up.push(tempBlock(p, "cpu", 226, 270, 106, true));
    up.push(tempBlock(p, "gpu", 414, 270, 106, true));
    el(p, "line", { x1: C, x2: C, y1: 160, y2: 300, class: "rule" });
    up.push(statBlock(p, "LIQUID", 226, 444, 74, readLiquid));
    up.push(statBlock(p, "POWER", 414, 444, 74, readPower));
    up.push(ramLine(p, 500));
    up.push(meta(p, 552));
    return up;
  }

  // Everything at once, in reading order: three limits with pace bars, then the hardware.
  function sceneKokpit(p) {
    const up = [clock(p, 90), tempArcs(p), unitHead(p, C, 126)];
    LIMITS.forEach((def, i) => {
      const x = 200 + i * 120;
      el(p, "text", { x, y: 158, "text-anchor": "middle", class: "t-lbl-xs" }, def.short);
      const val = num(p, x + 6, 216, 60);
      const bar = barGauge(p, x - 46, x + 46, 238, 6);
      const sub = el(p, "text", { x, y: 266, "text-anchor": "middle", class: "t-sub-s" });
      up.push((d) => {
        const v = d.views[def.key];
        limitGauge(bar, v);
        setNum(val, v.value, "%", 26, 60);
        val.classList.toggle("is-dim", v.dim);
        setParts(sub, v.sub);
      });
    });
    el(p, "line", { x1: 170, x2: 470, y1: 292, y2: 292, class: "rule" });
    up.push(tempBlock(p, "cpu", 226, 398, 92, true));
    up.push(tempBlock(p, "gpu", 414, 398, 92, true));
    up.push(statBlock(p, "LIQUID", 200, 500, 38, readLiquid, "t-lbl-xs"));
    up.push(statBlock(p, "POWER", 320, 500, 38, readPower, "t-lbl-xs"));
    up.push(statBlock(p, "RAM", 440, 500, 38, readRam, "t-lbl-xs"));
    up.push(meta(p, 554));
    return up;
  }

  // A watch: hands for the time, a subdial per limit, the hardware in the window at twelve.
  function sceneChronograf(p) {
    const up = [];
    for (let i = 0; i < 12; i++) {
      const [x0, y0] = polar(i % 3 ? 274 : 264, i * 30);
      const [x1, y1] = polar(290, i * 30);
      el(p, "line", { x1: x0, y1: y0, x2: x1, y2: y1, class: "hour" });
    }
    for (const [def, cx, cy] of [[LIMITS[0], 182, 322], [LIMITS[1], 458, 322], [LIMITS[2], 320, 452]]) {
      el(p, "circle", { cx, cy, r: 82, class: "face" });
      ticks(p, 72, 79, -135, 135, 10, cx, cy, 1.4);
      const g = arcGauge(p, 60, -135, 135, 8, cx, cy);
      el(p, "text", { x: cx, y: cy - 14, "text-anchor": "middle", class: "t-lbl-xxs" }, def.short);
      const val = num(p, cx + 6, cy + 28, 42);
      const sub = el(p, "text", { x: cx, y: cy + 64, "text-anchor": "middle", class: "t-sub-xs" });
      up.push((d) => {
        const v = d.views[def.key];
        limitGauge(g, v);
        setNum(val, v.value, "%", 20, 42);
        val.classList.toggle("is-dim", v.dim);
        val.classList.toggle("is-warn", !!v.hot);
        setParts(sub, v.sub);
      });
    }
    el(p, "rect", { x: 198, y: 128, width: 244, height: 78, rx: 18, class: "window" });
    [["CPU", 242, readTemp("cpu")], ["GPU", 320, readTemp("gpu")], ["LIQUID", 398, readLiquid]].forEach(([label, x, read]) => {
      up.push(statBlock(p, label, x + 3, 192, 32, read, "t-lbl-xxs"));
    });
    const extra = el(p, "text", { x: C, y: 232, "text-anchor": "middle", class: "t-sub-s" });
    up.push((d) => {
      const r = d.hw.ram || {};
      setText(extra, `${int(power(d.hw))} W · RAM ${r.used == null ? "—" : dec(r.used / 1024)} GB`);
    });
    up.push(meta(p, 566));
    // hands last, so they pass over everything
    const hand = (len, tail, cls) => {
      const g = el(p, "g", { class: cls });
      el(g, "line", { x1: C, y1: C + tail, x2: C, y2: C - len });
      return g;
    };
    const hh = hand(124, 20, "hand hand-h");
    const mm = hand(212, 24, "hand hand-m");
    const ss = hand(246, 46, "hand hand-s");
    el(ss, "circle", { cx: C, cy: C + 36, r: 5 });
    el(p, "circle", { cx: C, cy: C, r: 9, class: "hub" });
    el(p, "circle", { cx: C, cy: C, r: 3.5, class: "hub-s" });
    up.push((d) => {
      const t = new Date(d.now);
      const s = t.getSeconds(), m = t.getMinutes() + s / 60, h = (t.getHours() % 12) + m / 60;
      setAttr(hh, "transform", `rotate(${(h * 30).toFixed(1)} ${C} ${C})`);
      setAttr(mm, "transform", `rotate(${(m * 6).toFixed(1)} ${C} ${C})`);
      setAttr(ss, "transform", `rotate(${s * 6} ${C} ${C})`);
    });
    return up;
  }

  // Seven columns side by side: the three limits, then CPU, GPU, liquid and power.
  function sceneSlupki(p) {
    const up = [clock(p, 96)];
    const X = (i) => C + (i - 3) * 58 + (i < 3 ? -14 : 14);
    const top = 238, bottom = 436;
    up.push(unitHead(p, X(1), 150));
    el(p, "text", { x: (X(4) + X(5)) / 2, y: 150, "text-anchor": "middle", class: "t-head" }, "HARDWARE");
    const cols = [
      ...LIMITS.map((def) => ({ label: def.tiny, limit: def.key })),
      { label: "CPU", temp: "cpu" },
      { label: "GPU", temp: "gpu" },
      { label: "LIQUID", read: (d) => [int(d.hw.liquid), "°", 14], f: (d) => scale(d.hw.liquid, 20, 50) },
      { label: "POWER", read: (d) => [int(power(d.hw)), "W", 12], f: (d) => scale(power(d.hw), 0, 600) },
    ];
    cols.forEach((col, i) => {
      const x = X(i);
      const bar = columnGauge(p, x, bottom, top, 30);
      if (col.temp) bar.notch.classList.add("is-peak");
      const val = num(p, x + 3, 214, 28);
      el(p, "text", { x, y: 466, "text-anchor": "middle", class: "t-lbl-xxs" }, col.label);
      up.push((d) => {
        if (col.limit) {
          const v = d.views[col.limit];
          limitGauge(bar, v);
          setNum(val, v.value, "%", 13, 28);
          val.classList.toggle("is-dim", v.dim);
          val.classList.toggle("is-warn", !!v.hot);
        } else if (col.temp) {
          const h = d.hw[col.temp];
          tempGauge(bar, h, col.temp);
          setNum(val, int(h.temp), "°", 14, 28);
          val.classList.toggle("is-warn", isHot(h, col.temp));
        } else {
          const [n, u, us] = col.read(d);
          bar.set(col.f(d), null, null);
          setNum(val, n, u, us, 28);
        }
      });
    });
    el(p, "path", { d: `M${X(0) - 15} 480V486H${X(1) + 15}V480`, class: "bracket" });
    el(p, "text", { x: (X(0) + X(1)) / 2, y: 506, "text-anchor": "middle", class: "t-head" }, "CLAUDE");
    up.push(ramLine(p, 534));
    up.push(meta(p, 568));
    return up;
  }

  // ---------- the terminal family ----------
  // Monospace output. Bars are character cells; the pace is the same thin line as on the other
  // layouts, laid over the cells at its exact position rather than rounded to a whole cell.

  const term = (p, x, y, size, anchor = "start") =>
    el(p, "text", { x: x.toFixed(1), y, "text-anchor": anchor, class: "t-term", style: `font-size:${size}px` });
  const advances = {};
  // Width of one character of the terminal font, measured once it has been laid out.
  function advance(p, size) {
    if (advances[size]) return advances[size];
    const t = term(p, 0, -50, size);
    t.textContent = "0".repeat(20);
    const w = t.getComputedTextLength() / 20;
    t.remove();
    if (w > 0) advances[size] = w;
    return w > 0 ? w : size * 0.586;
  }

  // ██████░░░░ : a limit in n cells; what was used past the pace is in the lighter colour.
  function cells(v, n, full = "█", empty = "░") {
    const s = limitSpan(v);
    const end = Math.round((s.f / 100) * n);
    const cut = s.over == null ? end : Math.min(end, Math.round((s.over / 100) * n));
    return [["tm-f", full.repeat(cut)], [v.hot ? "tm-w" : "tm-o", full.repeat(end - cut)], ["tm-e", empty.repeat(n - end)]];
  }
  function bar(frac, n, full = "█", empty = "░") {
    const k = frac == null ? 0 : Math.round(clamp(frac, 0, 1) * n);
    return [["tm-f", full.repeat(k)], ["tm-e", empty.repeat(n - k)]];
  }
  const fit = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const pctText = (v) => (v.value === "—" ? "   —" : `${v.value.padStart(3)}%`);
  // Time to the reset for narrow columns, or the short status when there is no countdown.
  const resetIn = (v, now) => (v.state === "ok" && v.resetsAt ? dur(v.resetsAt - now) : v.sub.map((x) => x.t).join(" "));
  const subClass = (v) => (v.sub.some((x) => x.warn) ? "tm-w" : "tm-d");
  const ram = (hw) => hw.ram || {};

  // The pace line over the n cells that start at column col of a line of text.
  function paceLine(p, x, y, size, col, n) {
    const line = el(p, "path", { class: "pace" });
    return (v) => {
      const at = limitSpan(v).notch;
      const display = at == null ? "none" : "";
      if (line.style.display !== display) line.style.display = display;
      if (at == null) return;
      const px = (x + (col + (n * at) / 100) * advance(p, size)).toFixed(1);
      setAttr(line, "d", `M${px} ${(y - size * 0.98).toFixed(1)}V${(y + size * 0.3).toFixed(1)}`);
    };
  }

  // Everything as console output, with a blinking cursor.
  function sceneTerminal(p) {
    const Y = [128, 168, 204, 240, 284, 320, 356, 392, 428, 472, 510];
    const L = Y.map((y) => term(p, 78, y, 20));
    const pace = LIMITS.map((_, i) => paceLine(p, 78, Y[1 + i], 20, 10, 10));
    const prompt = (cmd) => [["tm-p", "kraken"], ["tm-d", "@lcd ~ $ "], ["", cmd]];
    return [
      (d) => {
        setSpans(L[0], prompt(`limits --${d.left ? "left" : "used"}`));
        LIMITS.forEach((def, i) => {
          const v = d.views[def.key];
          setSpans(L[1 + i], [
            ["tm-k", `${def.cmd} `],
            ...cells(v, 10),
            [v.dim ? "tm-d" : v.hot ? "tm-w" : "", ` ${pctText(v)}`],
            [subClass(v), `  ${fit(v.sub.map((x) => x.t).join(" "), 16)}`],
          ]);
          pace[i](v);
        });
        setSpans(L[4], prompt("hw"));
        for (const [i, key] of [[5, "cpu"], [6, "gpu"]]) {
          const h = d.hw[key];
          setSpans(L[i], [
            ["tm-k", key.padEnd(7)],
            [isHot(h, key) ? "tm-w" : "", `${int(h.temp)}°`.padStart(4)],
            ["", "  "],
            ...bar(h.load, 10),
            ["", ` ${h.load == null ? "  —" : String(Math.round(h.load * 100)).padStart(3)}%`],
            ["tm-d", `  ${int(h.power).padStart(3)} W`],
          ]);
        }
        setSpans(L[7], [["tm-k", "liquid "], ["", `${dec(d.hw.liquid)}°`.padEnd(8)], ["tm-k", "power "], ["", `${int(power(d.hw))} W`]]);
        const r = ram(d.hw);
        setSpans(L[8], [["tm-k", "ram    "], ["", `${r.used == null ? "—" : dec(r.used / 1024)} / ${r.total == null ? "—" : Math.round(r.total / 1024)} GB`]]);
        setSpans(L[9], [[d.meta.state === "error" ? "tm-w" : "tm-d", `# ${d.meta.text}`]]);
        setSpans(L[10], [["tm-d", `[${hhmmss(d.now)}] `], ["tm-p", "~ $ "], ["tm-c", Math.floor(d.now / 1000) % 2 ? " " : "▌"]]);
      },
    ];
  }

  // htop: meters for the hardware up top, the limits as the process list under an inverse
  // header (the one furthest behind its pace selected), F-keys along the bottom.
  function sceneHtop(p) {
    const S = 19, N = 36, cw = advance(p, S), x = C - (N * cw) / 2;
    const line = (y) => term(p, x, y, S);
    const band = (col, n, y, cls) =>
      el(p, "rect", { x: (x + col * cw).toFixed(1), y: (y - S * 0.93).toFixed(1), width: (n * cw).toFixed(1), height: (S * 1.17).toFixed(1), class: cls });
    const meters = [136, 166, 196, 226, 256].map(line);
    const clockLine = line(290);
    const sel = band(0, N, 0, "tm-sel");
    band(0, N, 330, "tm-inv-bg");
    const head = line(330);
    const ROWS = [362, 394, 426];
    const rows = ROWS.map(line);
    const pace = ROWS.map((y) => paceLine(p, x, y, S, 16, 10));
    const note = line(464);
    // F-keys: the number plain, its label inverse
    const keys = [["F1", "Help"], ["F2", "Setup"], ["F3", "Theme"], ["F10", "Quit"]];
    let col = 0;
    for (const [k] of keys) {
      band(col + k.length, 6, 512, "tm-inv-bg");
      col += k.length + 6;
    }
    setSpans(line(512), keys.flatMap(([k, label]) => [["", k], ["tm-inv", label.padEnd(6)]]));
    // CPU[||||||||        52°C 15%] : the value is written over the right end of the bar
    const meter = (label, frac, text, warn) => {
      const n = N - 5, room = n - text.length;
      const k = frac == null ? 0 : Math.round(clamp(frac, 0, 1) * n);
      return [["tm-k", label], ["tm-b", "["], ["tm-f", "|".repeat(Math.min(k, room))], ["", " ".repeat(Math.max(0, room - k))], [warn ? "tm-w" : "tm-d", text], ["tm-b", "]"]];
    };
    return [
      (d) => {
        const hw = d.hw, r = ram(hw), pw = power(hw);
        for (const [i, key, label] of [[0, "cpu", "CPU"], [1, "gpu", "GPU"]]) {
          const h = hw[key];
          setSpans(meters[i], meter(label, h.load, `${int(h.temp)}°C ${h.load == null ? "—" : Math.round(h.load * 100)}%`, isHot(h, key)));
        }
        setSpans(meters[2], meter("Liq", hw.liquid == null ? null : (hw.liquid - 20) / 30, `${dec(hw.liquid)}°C`));
        setSpans(meters[3], meter("Mem", r.used != null && r.total ? r.used / r.total : null, `${r.used == null ? "—" : dec(r.used / 1024)}G/${r.total == null ? "—" : dec(r.total / 1024)}G`));
        setSpans(meters[4], meter("Pwr", pw == null ? null : pw / 600, `${int(pw)}W`));
        setSpans(clockLine, [["tm-k", " Time: "], ["", hhmmss(d.now)]]);
        setSpans(head, [["tm-inv", ` ${"LIMIT".padEnd(10)}${(d.left ? "LEFT" : "USED").padStart(4)} ${"PACE".padEnd(10)} ${"RESET".padStart(8)} `]]);
        let worst = 0, behind = -Infinity;
        LIMITS.forEach((def, i) => {
          const v = d.views[def.key], s = limitSpan(v);
          setSpans(rows[i], [
            ["tm-k", ` ${def.cmd} `],
            [v.dim ? "tm-d" : v.hot ? "tm-w" : "", pctText(v)],
            ["", " "],
            ...cells(v, 10, "|", " "),
            [subClass(v), ` ${fit(resetIn(v, d.now), 8).padStart(8)}`],
          ]);
          pace[i](v);
          // how far the limit is behind an even pace
          const gap = s.notch == null || v.dim ? -Infinity : d.left ? s.notch - s.f : s.f - s.notch;
          if (gap > behind) [worst, behind] = [i, gap];
        });
        setAttr(sel, "y", (ROWS[worst] - S * 0.93).toFixed(1));
        setSpans(note, [[d.meta.state === "error" ? "tm-w" : "tm-d", ` ${fit(d.meta.text, N - 1)}`]]);
      },
    ];
  }

  // btop's graphs: braille, two samples per character and four dots per row, rising from the bottom.
  const DOT_L = [0x40, 0x04, 0x02, 0x01], DOT_R = [0x80, 0x20, 0x10, 0x08];
  function braille(samples, cols, rows) {
    const s = Array(Math.max(0, cols * 2 - samples.length)).fill(null).concat(samples).slice(-cols * 2);
    const level = (v) => (v == null ? 0 : Math.max(1, Math.round(clamp(v, 0, 1) * rows * 4)));
    return Array.from({ length: rows }, (_, r) => {
      const base = (rows - 1 - r) * 4;
      let out = "";
      for (let c = 0; c < cols; c++) {
        const a = clamp(level(s[2 * c]) - base, 0, 4), b = clamp(level(s[2 * c + 1]) - base, 0, 4);
        let code = 0x2800;
        for (let k = 0; k < a; k++) code |= DOT_L[k];
        for (let k = 0; k < b; k++) code |= DOT_R[k];
        out += String.fromCharCode(code);
      }
      return out;
    });
  }

  // btop: rounded boxes with their titles set into the border, temperature graphs of the last
  // minute and a half, the clock in the corner.
  function sceneBtop(p) {
    const S = 17, N = 41, cw = advance(p, S), x0 = C - (N * cw) / 2;
    const X = (col) => x0 + col * cw;
    // A box from column c0 to c1; the title gap at the left, an optional label gap at the right.
    function box(c0, c1, y0, y1, num, title, right = 0) {
      const xa = X(c0) + cw / 2, xb = X(c1) - cw / 2, r = 8;
      const ta = X(c0 + 1.5) - 2, tb = X(c0 + 1.5 + num.length + title.length) + 2;
      const ra = X(c1 - 1.5 - right) - 2, rb = X(c1 - 1.5) + 2;
      const f = (v) => v.toFixed(1);
      let d = `M${f(ta)} ${y0}H${f(xa + r)}Q${f(xa)} ${y0} ${f(xa)} ${y0 + r}V${y1 - r}Q${f(xa)} ${y1} ${f(xa + r)} ${y1}`;
      d += `H${f(xb - r)}Q${f(xb)} ${y1} ${f(xb)} ${y1 - r}V${y0 + r}Q${f(xb)} ${y0} ${f(xb - r)} ${y0}`;
      d += right ? `H${f(rb)}M${f(ra)} ${y0}H${f(tb)}` : `H${f(tb)}`;
      el(p, "path", { d, class: "tm-box" });
      setSpans(term(p, X(c0 + 1.5), y0 + S * 0.3, S), [["tm-p", num], ["tm-t", title]]);
      return right ? term(p, X(c1 - 1.5 - right), y0 + S * 0.3, S) : null;
    }
    const at = (c, y) => term(p, X(c), y, S);
    const clockText = box(0, N, 136, 232, "¹", "limits", 8);
    const LY = [166, 192, 218];
    const rows = LY.map((y) => at(1.5, y));
    const pace = LY.map((y) => paceLine(p, X(1.5), y, S, 10, 15));
    const GY = [278, 297, 316];
    const panes = [["cpu", 0, 20, "²"], ["gpu", 21, N, "³"]].map(([key, c0, c1, num]) => {
      box(c0, c1, 252, 356, num, key);
      return { key, graph: GY.map((y) => at(c0 + 1.5, y)), text: at(c0 + 1.5, 342), hist: [] };
    });
    box(0, N, 376, 444, "⁴", "sys");
    const sys = [404, 430].map((y) => at(1.5, y));
    const note = term(p, C, 482, 15, "middle");
    let sampledAt = 0;
    return [
      (d) => {
        setText(clockText, hhmmss(d.now));
        LIMITS.forEach((def, i) => {
          const v = d.views[def.key];
          setSpans(rows[i], [
            ["tm-k", `${def.cmd} `],
            ...cells(v, 15, "■", "■"),
            [v.dim ? "tm-d" : v.hot ? "tm-w" : "", ` ${pctText(v)}`],
            [subClass(v), `  ${fit(resetIn(v, d.now), 6).padStart(6)}`],
          ]);
          pace[i](v);
        });
        const sample = d.now - sampledAt >= 2500;
        if (sample) sampledAt = d.now;
        for (const pane of panes) {
          const h = d.hw[pane.key];
          if (sample) {
            pane.hist.push(h.temp == null ? null : (h.temp - 25) / 70);
            if (pane.hist.length > 34) pane.hist.shift();
          }
          braille(pane.hist, 17, 3).forEach((s, r) => setSpans(pane.graph[r], [[r ? "tm-f" : "tm-o", s]]));
          setSpans(pane.text, [
            [isHot(h, pane.key) ? "tm-w" : "tm-t", `${int(h.temp)}°C`.padEnd(6)],
            ["", `${h.load == null ? "—" : Math.round(h.load * 100)}%`.padStart(4)],
            ["tm-d", `${int(h.power)} W`.padStart(7)],
          ]);
        }
        const r = ram(d.hw);
        setSpans(sys[0], [["tm-k", "liquid "], ["tm-t", `${dec(d.hw.liquid)}°C`.padEnd(14)], ["tm-k", "power "], ["tm-t", `${int(power(d.hw))} W`]]);
        setSpans(sys[1], [
          ["tm-k", "mem "],
          ...bar(r.used != null && r.total ? r.used / r.total : null, 24, "■", "■"),
          ["", ` ${r.used == null ? "—" : dec(r.used / 1024)}/${r.total == null ? "—" : Math.round(r.total / 1024)}G`],
        ]);
        setSpans(note, [[d.meta.state === "error" ? "tm-w" : "tm-d", d.meta.text]]);
      },
    ];
  }

  // neofetch's logo, a kraken in blocks.
  const KRAKEN = [
    "    ▄▄████▄▄    ",
    "  ▄██████████▄  ",
    " ██████████████ ",
    " ███  ████  ███ ",
    " ███▄▄████▄▄███ ",
    "  ▀██████████▀  ",
    " ▄█▀▄█▀█▀▀█▀█▄▀█▄",
    "▄▀ ▄▀ ▄▀  ▀▄ ▀▄ ▀▄",
    "▀  ▀  ▀    ▀  ▀  ▀",
  ];

  // neofetch: the logo on the left, the system as key: value lines, the theme's colours below.
  function sceneNeofetch(p) {
    const S = 16, lh = Math.round(S * 1.17);
    KRAKEN.forEach((r, i) => {
      const t = term(p, 78, 232 + i * lh, S);
      t.classList.add("nf-logo");
      t.textContent = r;
    });
    const x = 266, Y = Array.from({ length: 15 }, (_, i) => 148 + i * 24);
    const L = Y.map((y) => term(p, x, y, S));
    setSpans(L[0], [["tm-p", "kraken"], ["", "@"], ["tm-p", "lcd"]]);
    setSpans(L[1], [["", "-".repeat(10)]]);
    const kv = (k, v, cls = "") => [["tm-p", `${k}: `], [cls, v]];
    setSpans(L[2], kv("OS", "NZXT CAM"));
    setSpans(L[3], kv("Host", "Kraken Elite"));
    setSpans(L[14], [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [`nf-${i}`, "███"]));
    const pace = LIMITS.map((_, i) => paceLine(p, x, Y[10 + i], S, 16, 10));
    const note = term(p, C, 532, 15, "middle");
    const names = ["Claude 5h:", "Claude 7d:", "Codex 7d: "];
    return [
      (d) => {
        const hw = d.hw, r = ram(hw);
        setSpans(L[4], kv("Time", hhmmss(d.now)));
        for (const [i, key] of [[5, "cpu"], [6, "gpu"]]) {
          const h = hw[key];
          setSpans(L[i], kv(key.toUpperCase(), `${int(h.temp)}°C · ${h.load == null ? "—" : Math.round(h.load * 100)}% · ${int(h.power)} W`, isHot(h, key) ? "tm-w" : ""));
        }
        setSpans(L[7], kv("Liquid", `${dec(hw.liquid)}°C`));
        setSpans(L[8], kv("Power", `${int(power(hw))} W`));
        setSpans(L[9], kv("Memory", `${r.used == null ? "—" : Math.round(r.used)}MiB / ${r.total == null ? "—" : Math.round(r.total)}MiB`));
        LIMITS.forEach((def, i) => {
          const v = d.views[def.key];
          setSpans(L[10 + i], [["tm-p", `${names[i]} `], [v.dim ? "tm-d" : v.hot ? "tm-w" : "", `${pctText(v).trim().padEnd(5)}`], ...cells(v, 10)]);
          pace[i](v);
        });
        setSpans(note, [[d.meta.state === "error" ? "tm-w" : "tm-d", d.meta.text]]);
      },
    ];
  }

  // The time, large; limits above it, hardware below, a seconds marker running round the rim.
  function sceneZegar(p) {
    const up = [unitHead(p, C, 102)];
    LIMITS.forEach((def, i) => {
      const x = 216 + i * 104;
      el(p, "text", { x, y: 130, "text-anchor": "middle", class: "t-lbl-xs" }, def.short);
      const val = num(p, x + 5, 170, 36);
      const bar = barGauge(p, x - 34, x + 34, 188, 4);
      up.push((d) => {
        const v = d.views[def.key];
        limitGauge(bar, v);
        setNum(val, v.value, "%", 16, 36);
        val.classList.toggle("is-dim", v.dim);
        val.classList.toggle("is-warn", !!v.hot);
      });
    });
    const time = el(p, "text", { x: C, y: 348, "text-anchor": "middle", class: "n t-big", "font-size": 164 });
    const date = el(p, "text", { x: C, y: 400, "text-anchor": "middle", class: "t-date" });
    const sec = el(p, "line", { x1: C, y1: C - 298, x2: C, y2: C - 314, class: "sec-now" });
    up.push((d) => {
      const t = new Date(d.now);
      setText(time, hhmm(d.now));
      setText(date, `${DAY_NAMES[t.getDay()]}, ${t.getDate()} ${MONTHS[t.getMonth()]}`);
      setAttr(sec, "transform", `rotate(${t.getSeconds() * 6} ${C} ${C})`);
    });
    up.push(statBlock(p, "CPU", 194, 492, 30, readTemp("cpu"), "t-lbl-xs"));
    up.push(statBlock(p, "GPU", 278, 492, 30, readTemp("gpu"), "t-lbl-xs"));
    up.push(statBlock(p, "LIQUID", 362, 492, 30, readLiquid, "t-lbl-xs"));
    up.push(statBlock(p, "POWER", 446, 492, 30, readPower, "t-lbl-xs"));
    up.push(meta(p, 550));
    return up;
  }

  // One huge value at a time; the rim gauge and the dots follow the carousel.
  function sceneJedna(p, layer) {
    const items = [
      ...LIMITS.map((def) => ({ label: def.label, limit: def.key })),
      { label: "CPU", temp: "cpu" },
      { label: "GPU", temp: "gpu" },
      { label: "LIQUID", read: readLiquid, gauge: (d) => scale(d.hw.liquid, 20, 50) },
      { label: "POWER", read: readPower, gauge: (d) => scale(power(d.hw), 0, 600), sub: (d) => `CPU ${int(d.hw.cpu.power)} W · GPU ${int(d.hw.gpu.power)} W` },
    ];
    const up = [clock(p, 108)];
    const groups = items.map((it) => {
      const g = layer();
      g.classList.add("is-off");
      const arc = arcGauge(g, 284, -135, 135, 14);
      if (it.temp) arc.notch.classList.add("is-peak");
      const lbl = el(g, "text", { x: C, y: 196, "text-anchor": "middle", class: "t-lbl" }, it.label);
      const unit = it.limit ? el(lbl, "tspan", { class: "t-unit" }) : null;
      const val = num(g, it.temp || it.read === readLiquid ? C + 16 : C, 384, 196);
      const sub = el(g, "text", { x: C, y: 438, "text-anchor": "middle", class: "t-sub" });
      up.push((d) => {
        if (it.limit) {
          const v = d.views[it.limit];
          setText(unit, ` · ${d.unitWord}`);
          limitGauge(arc, v);
          setNum(val, v.value, "%", 80, 196);
          val.classList.toggle("is-dim", v.dim);
          setParts(sub, v.sub);
        } else if (it.temp) {
          const h = d.hw[it.temp];
          tempGauge(arc, h, it.temp);
          setNum(val, int(h.temp), "°", 98, 196);
          val.classList.toggle("is-warn", isHot(h, it.temp));
          setText(sub, `load ${h.load == null ? "—" : Math.round(h.load * 100)}% · ${int(h.power)} W`);
        } else {
          const [n, u, us] = it.read(d);
          arc.set(it.gauge(d), null, null);
          setNum(val, n, u, 196 * us, 196);
          setText(sub, it.sub ? it.sub(d) : "");
        }
      });
      return g;
    });
    const dots = items.map((_, i) => el(p, "circle", { cx: C + (i - (items.length - 1) / 2) * 20, cy: 490, r: 4.5, class: "dot" }));
    up.push((d) => {
      const active = Math.floor(d.now / CAROUSEL_MS) % items.length;
      groups.forEach((g, i) => g.classList.toggle("is-off", i !== active));
      dots.forEach((c, i) => c.classList.toggle("is-on", i === active));
    });
    up.push(meta(p, 552));
    return up;
  }

  const SCENES = {
    limity: sceneLimity,
    sprzet: sceneSprzet,
    kokpit: sceneKokpit,
    chronograf: sceneChronograf,
    slupki: sceneSlupki,
    terminal: sceneTerminal,
    htop: sceneHtop,
    btop: sceneBtop,
    neofetch: sceneNeofetch,
    zegar: sceneZegar,
    jedna: sceneJedna,
  };
  const LEGACY = { adaptive: "adaptacyjny", fixed: "kokpit", pierscienie: "kokpit", work: "limity", game: "sprzet" };
  function normLayout(l) {
    const id = LEGACY[l] || l;
    return LAYOUTS.some((x) => x.id === id) ? id : "rotacja";
  }
  const validBg = (b) => BGS.some((x) => x.id === b) || /^media:./.test(b || "");

  // ---------- dial ----------

  function create(container, cfg = {}) {
    const root = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.className = "kd-bg";
    root.appendChild(canvas);
    const rim = el(root, "svg", { viewBox: "0 0 640 640" });
    for (let i = 0; i < 60; i++) {
      const major = i % 5 === 0;
      const [x0, y0] = polar(major ? 302 : 307, i * 6);
      const [x1, y1] = polar(313, i * 6);
      el(rim, "line", { x1: x0, y1: y0, x2: x1, y2: y1, class: "tick", "stroke-width": major ? 2.2 : 1.1 });
    }
    container.replaceChildren(root);
    const back = window.KrakenBg.backdrop(canvas, root);
    const animate = cfg.animate !== false;

    let layout = null, theme = null, bgType = null, left = true;
    let scenes = {}, updaters = [];
    // Every scene is its own <svg>, so switching between them is a composited fade, not a repaint.
    const layer = () => el(root, "svg", { viewBox: "0 0 640 640", class: "scene" });

    function buildLayout() {
      for (const n of root.querySelectorAll("svg.scene")) n.remove();
      const names = layout === "rotacja" || layout === "adaptacyjny" ? ["limity", "sprzet"] : [layout];
      scenes = {};
      updaters = [];
      for (const name of names) {
        scenes[name] = layer();
        updaters = updaters.concat(SCENES[name](scenes[name], layer));
      }
    }

    function configure(next) {
      const l = normLayout(next.layout);
      const t = THEMES.some((x) => x.id === next.theme) ? next.theme : "ice";
      const b = validBg(next.bg) ? next.bg : "ciecz";
      left = next.units !== "used";
      back.fps(next.fps);
      back.look(next.look);
      const themed = t !== theme;
      if (themed) root.className = `kd th-${(theme = t)}`;
      if (themed || b !== bgType) back.set((bgType = b), animate);
      if (l !== layout) {
        layout = l;
        buildLayout();
      }
    }

    configure(cfg);

    return {
      configure,
      setActivity(load) {
        back.speed(1 + 2.2 * clamp(load || 0, 0, 1));
      },
      update(data) {
        const now = data.now ?? Date.now();
        const interval = data.interval ?? 60e3;
        const views = {};
        for (const def of LIMITS) views[def.key] = limitView((data.limits || {})[def.key], now, interval, left);
        const d = { now, hw: data.hw || emptyHw(), views, left, unitWord: left ? "LEFT" : "USED", meta: metaView(data.limits, now, interval) };
        let active = Object.keys(scenes);
        if (layout === "rotacja") active = [Math.floor(now / ROTATE_MS) % 2 ? "sprzet" : "limity"];
        if (layout === "adaptacyjny") active = [data.mode === "game" ? "sprzet" : "limity"];
        for (const k in scenes) scenes[k].classList.toggle("is-off", !active.includes(k));
        for (const u of updaters) u(d);
      },
      get layout() {
        return layout;
      },
    };
  }

  function emptyHw() {
    return { cpu: {}, gpu: {}, liquid: null, ram: {} };
  }

  // A bare background in a theme, for swatches: a still frame until play() is called.
  function background(container, { theme, bg, look }) {
    const root = document.createElement("div");
    root.className = `kd th-${theme}`;
    const canvas = document.createElement("canvas");
    canvas.className = "kd-bg";
    root.appendChild(canvas);
    container.replaceChildren(root);
    const back = window.KrakenBg.backdrop(canvas, root);
    back.look(look);
    back.set(bg, false);
    return back;
  }

  window.KrakenDial = { create, background, LAYOUTS, THEMES, BGS, emptyHw };
})();
