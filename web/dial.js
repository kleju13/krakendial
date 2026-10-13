// Kraken Elite LCD dial (640×640, round). Pure SVG, no dependencies.
// KrakenDial.create(svg, { layout: "adaptive" | "fixed" }) -> { update(data), setMode("work" | "game") }
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const C = 320;
  const STALE_MS = 5 * 60e3;
  const TEMP_MIN = 20;
  const TEMP_MAX = 100;
  const HOT = { cpu: 85, gpu: 80 };
  const DAYS = ["nd", "pn", "wt", "śr", "cz", "pt", "sb"];

  // ---------- helpers ----------

  function el(parent, tag, attrs, text) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const polar = (r, deg) => {
    const a = (deg * Math.PI) / 180;
    return [C + r * Math.sin(a), C - r * Math.cos(a)];
  };
  function arcD(r, a0, a1) {
    const [x0, y0] = polar(r, a0);
    const [x1, y1] = polar(r, a1);
    const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
    const sweep = a1 > a0 ? 1 : 0;
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  const pad = (n) => String(n).padStart(2, "0");
  const hhmm = (t) => {
    const d = new Date(t);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const when = (t, now) => (t - now < 18 * 3600e3 ? hhmm(t) : `${DAYS[new Date(t).getDay()]} ${hhmm(t)}`);
  function dur(ms) {
    const m = Math.max(0, Math.round(ms / 60e3));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${pad(m % 60)}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
  }
  const dec = (v, d = 1) => (v == null ? "—" : v.toFixed(d).replace(".", ","));
  const deg = (v) => (v == null ? "—" : `${Math.round(v)}`);
  const tempF = (t) => clamp(((t ?? TEMP_MIN) - TEMP_MIN) / (TEMP_MAX - TEMP_MIN), 0, 1) * 100;

  // Sets text from parts [{t, signal}] using tspans so one line can mix ink and signal.
  function setParts(textEl, parts) {
    while (textEl.firstChild) textEl.removeChild(textEl.firstChild);
    for (const p of parts) el(textEl, "tspan", p.signal ? { class: "is-signal" } : {}, p.t);
  }
  // Big number with a lighter unit glyph; a degree sign is lifted to cap height.
  function setNum(textEl, num, unit, unitSize, fontSize) {
    while (textEl.firstChild) textEl.removeChild(textEl.firstChild);
    textEl.appendChild(document.createTextNode(num));
    if (!unit) return;
    const attrs = { class: "u", "font-size": unitSize };
    if (unit === "°" && fontSize) attrs.dy = (-(fontSize - unitSize) * 0.68).toFixed(1);
    el(textEl, "tspan", attrs, unit);
  }

  // ---------- limit model -> what the dial shows ----------

  function limitView(l, now, interval) {
    if (!l || l.pct == null) {
      const sub = l && l.error ? [{ t: l.error, signal: true }] : [{ t: "czekam na dane" }];
      return { state: l && l.error ? "error" : "none", pct: 0, pace: null, value: "—", frac: 0, dim: true, sub };
    }
    const age = now - l.fetchedAt;
    const pace = l.windowMs && l.resetsAt ? clamp(100 * (1 - (l.resetsAt - now) / l.windowMs), 0, 100) : null;
    const base = { pct: clamp(l.pct, 0, 100), pace, value: `${Math.round(l.pct)}`, frac: clamp(age / interval, 0, 1), fetchedAt: l.fetchedAt };

    if (!l.resetsAt && age <= STALE_MS) {
      // the window starts with the first request; nothing is ticking yet
      return { ...base, state: l.error ? "error" : "ok", dim: false, sub: [{ t: "okno nie wystartowało" }] };
    }
    if (l.resetsAt && now >= l.resetsAt) {
      return { ...base, state: "reset", pct: 0, pace: 0, value: "0", dim: true, sub: [{ t: "po resecie · czekam na dane" }] };
    }
    if (age > STALE_MS) {
      const why = l.error ? [{ t: `${l.error} · ${dur(age)}`, signal: true }] : [{ t: `dane sprzed ${dur(age)}` }];
      return { ...base, state: l.error ? "error" : "stale", dim: true, sub: why };
    }
    const reset = `reset ${when(l.resetsAt, now)}`;
    let sub;
    if (l.pct >= 100) sub = [{ t: `limit · ${reset}`, signal: true }];
    else if (l.burnAt && l.burnAt < l.resetsAt) sub = [{ t: `${reset} · ` }, { t: `koniec za ${dur(l.burnAt - now)}`, signal: true }];
    else sub = [{ t: `${reset} · starczy` }];
    return { ...base, state: l.error ? "error" : "ok", dim: false, sub };
  }

  // ---------- primitives ----------

  // A gauge is any path drawn with pathLength=100: an arc or a straight bar.
  // fill shows [0, min(f, overFrom)], the signal segment shows [overFrom, f], the notch marks a reference.
  function gauge(parent, geo, width) {
    const g = el(parent, "g", { class: "gauge" });
    const common = { d: geo.d, "stroke-width": width, pathLength: 100 };
    el(g, "path", { ...common, class: "g-track" });
    const fill = el(g, "path", { ...common, class: "g-fill", "stroke-dasharray": "0 200" });
    const over = el(g, "path", { ...common, class: "g-over", "stroke-dasharray": "0 0 0 200" });
    const notch = el(g, "g", { class: "notch" });
    const h = width / 2;
    if (geo.kind === "arc") {
      const r = geo.r;
      const out = geo.notchInside ? -1 : 1;
      const tip = C - (r + out * (h + 3));
      const base = C - (r + out * (h + 11));
      el(notch, "path", { d: `M${C - 5} ${base}L${C + 5} ${base}L${C} ${tip}Z` });
      el(notch, "line", { x1: C, x2: C, y1: C - (r - h - 1), y2: C - (r + h + 1) });
    } else {
      el(notch, "path", { d: `M-4.5 ${geo.y - h - 9}L4.5 ${geo.y - h - 9}L0 ${geo.y - h - 2}Z` });
      el(notch, "line", { x1: 0, x2: 0, y1: geo.y - h - 1, y2: geo.y + h + 1 });
    }
    const place = (f) =>
      geo.kind === "arc"
        ? `rotate(${geo.a0 + ((geo.a1 - geo.a0) * f) / 100}deg)`
        : `translate(${geo.x0 + ((geo.x1 - geo.x0) * f) / 100}px, 0px)`;
    return {
      g,
      notch,
      set(f, notchF, overFrom) {
        const cut = overFrom == null ? f : Math.min(f, overFrom);
        fill.setAttribute("stroke-dasharray", `${cut.toFixed(2)} 200`);
        const ov = overFrom != null && f > overFrom ? f - overFrom : 0;
        over.setAttribute("stroke-dasharray", `0 ${(overFrom ?? 0).toFixed(2)} ${ov.toFixed(2)} 200`);
        notch.style.display = notchF == null ? "none" : "";
        if (notchF != null) notch.style.transform = place(notchF);
      },
    };
  }
  const arcGauge = (p, r, a0, a1, w, notchInside) => gauge(p, { kind: "arc", d: arcD(r, a0, a1), r, a0, a1, notchInside }, w);
  const barGauge = (p, x0, x1, y, w) => gauge(p, { kind: "bar", d: `M${x0} ${y}H${x1}`, x0, x1, y }, w);

  function ticks(parent, r0, r1, a0, a1, n, cls = "tick", width = 1.5) {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const [x0, y0] = polar(r0, a);
      const [x1, y1] = polar(r1, a);
      el(parent, "line", { x1: x0, y1: y0, x2: x1, y2: y1, class: cls, "stroke-width": width });
    }
  }

  function pie(parent, x, y, r = 6) {
    const outer = el(parent, "g", { transform: `translate(${x} ${y})` });
    const g = el(outer, "g", { class: "pie" });
    const inner = el(g, "g", { class: "pie-inner" });
    el(inner, "circle", { r, class: "pie-ring" });
    const wedge = el(inner, "path", { class: "pie-wedge" });
    let lastFetch = null;
    return {
      move(nx, ny) {
        outer.setAttribute("transform", `translate(${nx} ${ny})`);
      },
      set(v) {
        g.setAttribute("class", `pie is-${v.state === "reset" || v.state === "none" ? "stale" : v.state}`);
        const ri = r - 2.2;
        const live = v.state === "ok" || (v.state === "error" && !v.dim);
        const f = live ? Math.max(0.04, v.frac) : 0;
        if (f >= 0.999) wedge.setAttribute("d", `M0 ${-ri}A${ri} ${ri} 0 1 1 -0.01 ${-ri}Z`);
        else {
          const a = f * 2 * Math.PI;
          wedge.setAttribute("d", `M0 0L0 ${-ri}A${ri} ${ri} 0 ${f > 0.5 ? 1 : 0} 1 ${(ri * Math.sin(a)).toFixed(2)} ${(-ri * Math.cos(a)).toFixed(2)}Z`);
        }
        if (lastFetch != null && v.fetchedAt !== lastFetch) {
          inner.classList.remove("pulse");
          void inner.getBBox();
          inner.classList.add("pulse");
        }
        lastFetch = v.fetchedAt;
      },
    };
  }

  // Places the pie just left of a centred label once the font has been laid out.
  function pinPieLeft(pieObj, label, cx, y) {
    const place = () => pieObj.move(cx - label.getComputedTextLength() / 2 - 14, y);
    place();
    if (document.fonts) document.fonts.ready.then(place);
  }

  // ---------- widgets ----------

  const LIMITS = [
    { key: "claude5h", label: "CLAUDE · 5H", short: "CLAUDE 5H" },
    { key: "claude7d", label: "CLAUDE · 7D", short: "CLAUDE 7D" },
    { key: "codex7d", label: "CODEX · 7D", short: "CODEX 7D" },
  ];

  // Hero limit: owns the whole bezel arc and the centre of the dial.
  function heroLimit(p, def) {
    const arc = arcGauge(p, 282, -135, 135, 12);
    ticks(p, 262, 269, -135, 135, 10, "tick", 1.5);
    const label = el(p, "text", { x: C, y: 140, "text-anchor": "middle", class: "t-lbl" }, def.label);
    const pi = pie(p, 0, 0);
    pinPieLeft(pi, label, C, 135);
    const val = el(p, "text", { x: C + 6, y: 260, "text-anchor": "middle", class: "t-hero dimmable" });
    const sub = el(p, "text", { x: C, y: 298, "text-anchor": "middle", class: "t-sub" });
    return (d) => {
      const v = d.views[def.key];
      arc.set(v.pct, v.pace, v.pace);
      arc.g.classList.toggle("is-dashed", v.state === "reset" || v.state === "none");
      setNum(val, v.value, "%", 50);
      val.classList.toggle("is-dim", v.dim);
      setParts(sub, v.sub);
      pi.set(v);
    };
  }

  // Row limit: label + value on one line, bar with pace notch, fine print below.
  function rowLimit(p, def, y, x0, x1) {
    const pi = pie(p, x0 + 6, y - 6);
    el(p, "text", { x: x0 + 20, y, class: "t-lbl" }, def.short);
    const val = el(p, "text", { x: x1, y: y + 2, "text-anchor": "end", class: "t-val dimmable" });
    const barY = y + 20;
    const bar = barGauge(p, x0, x1, barY, 6);
    const sub = el(p, "text", { x: x1, y: barY + 25, "text-anchor": "end", class: "t-fine" });
    return (d) => {
      const v = d.views[def.key];
      bar.set(v.pct, v.pace, v.pace);
      bar.g.classList.toggle("is-dashed", v.state === "reset" || v.state === "none");
      setNum(val, v.value, "%", 22);
      val.classList.toggle("is-dim", v.dim);
      setParts(sub, v.sub);
      pi.set(v);
    };
  }

  // Mini limit: compact column for the rail under the hardware scene.
  function miniLimit(p, def, cx, y) {
    const w = 92;
    const label = el(p, "text", { x: cx + 7, y, "text-anchor": "middle", class: "t-lbl-s" }, def.short);
    const pi = pie(p, 0, 0, 5);
    pinPieLeft(pi, label, cx + 7, y - 4.5);
    const val = el(p, "text", { x: cx, y: y + 33, "text-anchor": "middle", class: "t-small dimmable" });
    const bar = barGauge(p, cx - w / 2, cx + w / 2, y + 52, 5);
    return (d) => {
      const v = d.views[def.key];
      bar.set(v.pct, v.pace, v.pace);
      setNum(val, v.value, "%", 17);
      val.classList.toggle("is-dim", v.dim);
      pi.set(v);
    };
  }

  // Twin bezel thermometers: CPU rises up the left edge, GPU up the right.
  function tempArcs(p) {
    const cpu = arcGauge(p, 282, -150, -30, 12);
    const gpu = arcGauge(p, 282, 150, 30, 12);
    cpu.notch.classList.add("is-peak");
    gpu.notch.classList.add("is-peak");
    ticks(p, 262, 269, -150, -30, 8);
    ticks(p, 262, 269, 150, 30, 8);
    return (d) => {
      cpu.set(tempF(d.hw.cpu.temp), d.hw.cpu.peak != null ? tempF(d.hw.cpu.peak) : null, tempF(HOT.cpu));
      gpu.set(tempF(d.hw.gpu.temp), d.hw.gpu.peak != null ? tempF(d.hw.gpu.peak) : null, tempF(HOT.gpu));
    };
  }

  const FS = { "t-hero": 142, "t-big": 100, "t-mid": 46, "t-val": 36, "t-small": 27 };

  function tempBlock(p, key, cx, y, cls, unitSize, withSub) {
    el(p, "text", { x: cx, y: y - (cls === "t-big" ? 86 : 52), "text-anchor": "middle", class: "t-lbl" }, key.toUpperCase());
    const val = el(p, "text", { x: cx + unitSize * 0.18, y, "text-anchor": "middle", class: cls });
    const sub = withSub ? el(p, "text", { x: cx, y: y + 30, "text-anchor": "middle", class: "t-fine" }) : null;
    return (d) => {
      const h = d.hw[key];
      setNum(val, deg(h.temp), "°", unitSize, FS[cls]);
      val.classList.toggle("is-signal", h.temp != null && h.temp >= HOT[key]);
      if (sub) sub.textContent = `${h.load == null ? "—" : Math.round(h.load * 100)}% · ${h.power == null ? "—" : Math.round(h.power)} W`;
    };
  }

  function statBlock(p, label, cx, y, cls, unitSize, read) {
    el(p, "text", { x: cx, y: y - (cls === "t-mid" ? 48 : 36), "text-anchor": "middle", class: "t-lbl" }, label);
    const val = el(p, "text", { x: cx, y, "text-anchor": "middle", class: cls });
    return (d) => {
      const [num, unit] = read(d);
      setNum(val, num, unit, unitSize, FS[cls]);
    };
  }
  const readLiquid = (d) => [dec(d.hw.liquid), "°"];
  const readPower = (d) => {
    const w = (d.hw.cpu.power ?? 0) + (d.hw.gpu.power ?? 0);
    return [d.hw.cpu.power == null && d.hw.gpu.power == null ? "—" : `${Math.round(w)}`, " W"];
  };

  function ramLine(p, y, cx = C) {
    const t = el(p, "text", { x: cx, y, "text-anchor": "middle", class: "t-fine" });
    return (d) => {
      const r = d.hw.ram || {};
      const used = r.used == null ? "—" : dec(r.used / 1024);
      const total = r.total == null ? "—" : Math.round(r.total / 1024);
      t.textContent = `RAM  ${used} / ${total} GB`;
    };
  }

  function clock(p, y) {
    const t = el(p, "text", { x: C, y, "text-anchor": "middle", class: "t-clock" });
    return (d) => (t.textContent = hhmm(d.now));
  }

  // ---------- scenes ----------

  function sceneWork(p) {
    const up = [clock(p, 92), heroLimit(p, LIMITS[0])];
    el(p, "line", { x1: 168, x2: 472, y1: 328, y2: 328, class: "rule" });
    up.push(rowLimit(p, LIMITS[1], 368, 168, 472));
    up.push(rowLimit(p, LIMITS[2], 452, 168, 472));
    // hardware rail sits in the gap at the bottom of the bezel arc
    const cols = [
      ["CPU", (d) => [deg(d.hw.cpu.temp), "°"], 196],
      ["GPU", (d) => [deg(d.hw.gpu.temp), "°"], 279],
      ["H₂O", readLiquid, 361],
      ["MOC", readPower, 444],
    ];
    for (const [label, read, x] of cols) {
      el(p, "text", { x, y: 534, "text-anchor": "middle", class: "t-lbl-s" }, label);
      const v = el(p, "text", { x, y: 563, "text-anchor": "middle", class: "t-small" });
      up.push((d) => {
        const [n, u] = read(d);
        setNum(v, n, u, 17, FS["t-small"]);
      });
    }
    up.push(ramLine(p, 594));
    return up;
  }

  function sceneGame(p) {
    const up = [clock(p, 98), tempArcs(p)];
    up.push(tempBlock(p, "cpu", 222, 262, "t-big", 50, true));
    up.push(tempBlock(p, "gpu", 418, 262, "t-big", 50, true));
    el(p, "line", { x1: C, x2: C, y1: 168, y2: 290, class: "rule" });
    up.push(statBlock(p, "H₂O", 236, 384, "t-mid", 26, readLiquid));
    up.push(statBlock(p, "MOC", 404, 384, "t-mid", 22, readPower));
    up.push(ramLine(p, 420));
    el(p, "line", { x1: 168, x2: 472, y1: 446, y2: 446, class: "rule" });
    up.push(miniLimit(p, LIMITS[0], 202, 482));
    up.push(miniLimit(p, LIMITS[1], 320, 482));
    up.push(miniLimit(p, LIMITS[2], 438, 482));
    return up;
  }

  function sceneFixed(p) {
    const up = [clock(p, 80), tempArcs(p)];
    up.push(rowLimit(p, LIMITS[0], 122, 162, 478));
    up.push(rowLimit(p, LIMITS[1], 200, 162, 478));
    up.push(rowLimit(p, LIMITS[2], 278, 162, 478));
    el(p, "line", { x1: 162, x2: 478, y1: 342, y2: 342, class: "rule" });
    up.push(tempBlock(p, "cpu", 236, 432, "t-mid", 26, true));
    up.push(tempBlock(p, "gpu", 404, 432, "t-mid", 26, true));
    up.push(statBlock(p, "H₂O", 236, 530, "t-val", 20, readLiquid));
    up.push(statBlock(p, "MOC", 404, 530, "t-val", 18, readPower));
    up.push(ramLine(p, 570));
    return up;
  }

  // ---------- dial ----------

  function create(svg, opts = {}) {
    const layout = opts.layout || "adaptive";
    svg.setAttribute("viewBox", "0 0 640 640");
    svg.classList.add("kd");
    const uid = Math.random().toString(36).slice(2, 8);
    const defs = el(svg, "defs");
    const grad = el(defs, "radialGradient", { id: `kd-dial-${uid}`, cx: "50%", cy: "44%", r: "62%" });
    el(grad, "stop", { offset: "0", style: "stop-color: var(--dial-hi)" });
    el(grad, "stop", { offset: "0.72", style: "stop-color: var(--dial-hi)" });
    el(grad, "stop", { offset: "1", style: "stop-color: var(--dial-lo)" });
    el(svg, "circle", { cx: C, cy: C, r: 320, fill: `url(#kd-dial-${uid})` });
    // minute track on the rim, as on a watch dial
    const rim = el(svg, "g", { opacity: 0.55 });
    for (let i = 0; i < 60; i++) {
      const major = i % 5 === 0;
      const [x0, y0] = polar(major ? 301 : 306, i * 6);
      const [x1, y1] = polar(313, i * 6);
      el(rim, "line", { x1: x0, y1: y0, x2: x1, y2: y1, class: "tick", "stroke-width": major ? 2.2 : 1.1 });
    }

    const scenes = {};
    let updaters = [];
    const mk = (name, build) => {
      const g = el(svg, "g", { class: "scene" });
      scenes[name] = g;
      updaters = updaters.concat(build(g));
    };
    if (layout === "fixed") mk("fixed", sceneFixed);
    else {
      mk("work", sceneWork);
      mk("game", sceneGame);
    }
    let mode = layout === "fixed" ? "fixed" : "work";
    const applyMode = () => {
      for (const k in scenes) scenes[k].classList.toggle("is-off", k !== mode);
    };
    applyMode();

    return {
      update(data) {
        const now = data.now ?? Date.now();
        const interval = data.interval ?? 60e3;
        const views = {};
        for (const def of LIMITS) views[def.key] = limitView(data.limits[def.key], now, interval);
        const d = { ...data, now, views };
        for (const u of updaters) u(d);
      },
      setMode(m) {
        if (layout === "fixed" || m === mode) return;
        mode = m;
        applyMode();
      },
      get mode() {
        return mode;
      },
    };
  }

  window.KrakenDial = { create, limitView, dur };
})();
