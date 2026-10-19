// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 kleju13 and KrakenDial contributors
// Kraken Elite LCD dial (640×640, round). SVG over a canvas background (bg.js), no dependencies.
// CAM renders web integrations without a GPU, so everything here keeps the CPU idle: scenes are
// separate layers so fades are composited, and the DOM is only touched when a value really changes.
//   const dial = KrakenDial.create(container, { layout, theme, bg, fps, units, look });
//   dial.update({ now, hw, limits, costs, interval, mode }); // call about once a second
//   dial.configure({ layout, theme, bg, fps, units, look, mascot, cost, bars, lang, face }); // switch variant live
//   dial.setActivity(gpuLoad);                               // 0..1, speeds the background up under load
//   dial.camless(on);                                        // camless mode: camless plays the background
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const C = 320;
  const STALE_MS = 5 * 60e3;
  const ROTATE_MS = 12e3;
  const CAROUSEL_MS = 6e3;
  const HOT = { cpu: 85, gpu: 80 };
  const I18N = window.KrakenI18n;
  const t = I18N.t;
  // Lists whose names follow the language: each entry reads its name from the translations.
  const named = (prefix, items) =>
    items.map((it) => Object.defineProperty({ ...it }, "name", { get: () => t(`${prefix}.${it.id}`), enumerable: true }));

  // needsLimits: the layout is the hardware one while there are no limits to show. hwDesc: it
  // reads differently without limits, so descHw says what it shows then.
  const LAYOUTS = named("layout", [
    { id: "rotation", needsLimits: true },
    { id: "adaptive", needsLimits: true },
    { id: "cockpit", hwDesc: true },
    { id: "chronograph", hwDesc: true },
    { id: "columns" },
    { id: "terminal" },
    { id: "htop", hwDesc: true },
    { id: "btop" },
    { id: "neofetch", mascot: true },
    { id: "fastfetch", mascot: true },
    { id: "pfetch", mascot: true },
    { id: "macchina", mascot: true },
    { id: "cpufetch", mascot: true },
    { id: "clock", hwDesc: true },
    { id: "one" },
    { id: "limits", needsLimits: true },
    { id: "hardware" },
  ]).map((l) =>
    Object.defineProperties(l, {
      desc: { get: () => t(`layout.${l.id}.desc`), enumerable: true },
      descHw: { get: () => (l.hwDesc ? t(`layout.${l.id}.descHw`) : l.desc), enumerable: true },
    }));
  const THEMES = named("theme", [
    { id: "ice" },
    { id: "porcelain" },
    { id: "frost" },
    { id: "blue" },
    { id: "ocean" },
    { id: "deep" },
    { id: "indigo" },
    { id: "graphite" },
    { id: "night" },
    { id: "neon" },
    { id: "nord" },
    { id: "tokyo" },
    { id: "catppuccin" },
    { id: "latte" },
    { id: "dracula" },
    { id: "solarized" },
    { id: "gruvbox" },
    { id: "synthwave" },
    { id: "phosphor" },
    { id: "amber" },
    { id: "mono" },
    { id: "paper" },
  ]);
  const BGS = named("bg", window.KrakenBg.LIST.map(({ id }) => ({ id })));
  const LIMITS = [
    { key: "claude5h", label: "CLAUDE · 5H", short: "CLAUDE 5H", tiny: "5H", cmd: "claude 5h", name: "Claude 5h", brief: "5h" },
    { key: "claude7d", label: "CLAUDE · 7D", short: "CLAUDE 7D", tiny: "7D", cmd: "claude 7d", name: "Claude 7d", brief: "7d" },
    { key: "codex7d", label: "CODEX · 7D", short: "CODEX 7D", tiny: "CODEX", cmd: "codex  7d", name: "Codex 7d", brief: "codex" },
  ];
  // What Claude and Codex cost, as the usage source counts it; the period is a setting.
  const COSTS = named("cost", [{ id: "last24h" }, { id: "today" }, { id: "last7d" }, { id: "month" }, { id: "off" }]).map((c) =>
    Object.defineProperty(c, "short", { get: () => t(`cost.${c.id}.short`), enumerable: true }));

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
  // Dates in the dial's language; the formatters are made once per language.
  const formats = {};
  function dateText(at, kind) {
    const key = `${I18N.locale}|${kind}`;
    const opts = kind === "day" ? { weekday: "short" } : { weekday: "long", day: "numeric", month: "long" };
    formats[key] = formats[key] || new Intl.DateTimeFormat(I18N.locale, opts);
    return formats[key].format(at);
  }
  const when = (at, now) => (at - now < 18 * 3600e3 ? hhmm(at) : `${dateText(at, "day")} ${hhmm(at)}`);
  function dur(ms) {
    const m = Math.max(0, Math.round(ms / 60e3));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${pad(m % 60)}m`;
    return `${Math.floor(h / 24)}d ${h % 24}h`;
  }
  // The same in as few characters as a terminal column allows: 31m, 2h50, 2d13h.
  function durShort(ms) {
    const m = Math.max(0, Math.round(ms / 60e3));
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h${pad(m % 60)}` : `${Math.floor(h / 24)}d${h % 24}h`;
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
    if (l && l.nextAt > l.fetchedAt) interval = Math.max(interval, l.nextAt - l.fetchedAt);
    const staleAfter = Math.max(STALE_MS, 3 * interval);
    if (!l || l.pct == null) {
      // with no usage source set up, the limits are quietly empty instead of failing
      const failed = l && l.error && l.error !== "unset";
      const sub = failed ? [{ t: errText(l.error), warn: true }] : [{ t: t(l && l.error ? "st.noSource" : "st.waiting") }];
      return { state: failed ? "error" : "none", pct: 0, pace: null, value: "—", dim: true, sub, left };
    }
    const show = (used) => (left ? 100 - used : used);
    const age = now - l.fetchedAt;
    const pace = l.windowMs && l.resetsAt ? clamp(100 * (1 - (l.resetsAt - now) / l.windowMs), 0, 100) : null;
    const pct = show(clamp(l.pct, 0, 100));
    const base = { pct, pace, value: `${Math.round(pct)}`, dim: false, state: "ok", left, resetsAt: l.resetsAt };
    if (l.resetsAt && now >= l.resetsAt) {
      return { ...base, state: "reset", pct: show(0), pace: 0, value: `${show(0)}`, dim: true, sub: [{ t: t("st.reset") }] };
    }
    if (age > staleAfter) {
      return { ...base, state: l.error ? "error" : "stale", dim: true, sub: [{ t: t("st.ago", { t: dur(age) }) }] };
    }
    if (!l.resetsAt) return { ...base, sub: [{ t: t("st.idle") }] };
    if (l.pct >= 100) return { ...base, hot: true, sub: [{ t: t("st.limitReset", { t: when(l.resetsAt, now) }), warn: true }] };
    return { ...base, sub: [{ t: t("st.resetAt", { t: when(l.resetsAt, now) }) }] };
  }

  // Where a limit gauge fills to, where the pace line sits and where the second colour starts.
  // The pace line is where the gauge would be at an even pace through the window: used, the
  // part past it is drawn lighter; left, the line marks how much should still be there.
  function limitSpan(v) {
    if (v.state === "none") return { f: 0, notch: null, over: null };
    if (!v.left) return { f: v.pct, notch: v.pace, over: v.pace };
    return { f: v.pct, notch: v.pace == null ? null : 100 - v.pace, over: null };
  }

  // What the service says went wrong with the usage source, in words.
  function errText(code) {
    if (code === "offline") return t("err.offline");
    if (code === "bad reply") return t("err.bad");
    const http = /^http (\d+)$/.exec(code || "");
    return http ? t("err.http", { code: http[1] }) : code;
  }

  // Which limits the layouts draw: those switched on in the settings that the usage source sends.
  // A source that has never answered shows every one switched on, so that its error is seen; with
  // no source there are none, and the layouts give their room to the hardware.
  function shownLimits(limits, on) {
    const ls = Object.values(limits || {}).filter(Boolean);
    const enabled = LIMITS.filter((def) => on.includes(def.key));
    if (ls.some((l) => l.fetchedAt)) return enabled.filter((def) => limits[def.key] && limits[def.key].fetchedAt);
    return ls.some((l) => l.error && l.error !== "unset") ? enabled : [];
  }
  // The limits switched on: a list, or ids separated by commas as in a URL; all of them by default.
  const limitIds = (v) => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : LIMITS.map((def) => def.key));

  // The quiet status line: when the usage source last fetched the limits and how often, or that
  // it can't be reached. `short` leaves the cadence out, for when the cost shares the line.
  // A source that sends costs and no limits counts from when the costs came.
  function metaView(limits, now, interval, costs) {
    const entries = Object.entries(limits || {}).filter(([, l]) => l);
    const failing = entries.find(([, l]) => l.error);
    const last = Math.max(0, ...entries.map(([, l]) => l.fetchedAt || 0)) || (costs && costs.polledAt) || 0;
    if (failing && failing[1].error === "unset") return { state: "stale", none: true, frac: 0, last, text: t("st.noSource"), short: t("st.noSource") };
    if (failing) {
      const e = errText(failing[1].error);
      return { state: "error", frac: 1, last, text: e, short: e };
    }
    if (!last) return { state: "stale", frac: 0, last, text: t("st.waiting"), short: t("st.waiting") };
    // The source's cadence, from when it fetched last and when it fetches next.
    const cadence = Math.max(interval, ...entries.map(([, l]) => (l.fetchedAt && l.nextAt > l.fetchedAt ? l.nextAt - l.fetchedAt : 0)));
    const age = now - last;
    const stale = age > Math.max(STALE_MS, 3 * cadence);
    const text = t("st.synced", { t: hhmmss(last) });
    return { state: stale ? "stale" : "ok", frac: clamp(age / cadence, 0, 1), last, text: `${text} · ${t("st.every", { t: every(cadence) })}`, short: text };
  }

  const money = (v) => (v == null ? "—" : v < 1000 ? `$${v.toFixed(2)}` : `$${Math.round(v).toLocaleString("en-US")}`);
  // null when switched off; dim when the source has nothing or hasn't been reached for a while.
  function costView(costs, id, now) {
    const def = COSTS.find((c) => c.id === id) || COSTS[0];
    if (def.id === "off") return null;
    const v = costs && typeof costs[def.id] === "number" ? costs[def.id] : null;
    return { value: money(v), short: def.short, dim: v == null || !(now - costs.polledAt < 3 * STALE_MS) };
  }
  // The cost as terminal text: amount, then the period, quieter.
  const costSpans = (c) => [[c.dim ? "tm-d" : "", c.value], ["tm-d", ` ${c.short}`]];

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
      show(on) {
        setAttr(outer, "visibility", on ? "visible" : "hidden");
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
    const node = el(p, "text", { x: C, y, "text-anchor": "middle", class: "t-clock" });
    return (d) => setText(node, hhmm(d.now));
  }

  // When the limits were synced, with a pie filling until the next sync, then the cost.
  function meta(p, y, x = C) {
    const line = el(p, "text", { x: x + 10, y, "text-anchor": "middle", class: "t-meta" });
    const pi = pie(p);
    let lastKey = null;
    return (d) => {
      const m = d.meta, c = d.cost;
      // with no usage source there is nothing to report, so the date stands in (in faces; the
      // layouts don't build this line then)
      const none = m.none && !c;
      const key = none ? dateText(d.now, "date") : `${m.text}|${c ? c.value + c.dim : ""}`;
      if (key !== lastKey) {
        setSpans(line, none ? [["", key]] : c ? [["", `${m.short} · `], [c.dim ? "" : "t-cost", c.value], ["", ` ${c.short}`]] : [["", m.text]]);
        line.classList.toggle("is-warn", !none && m.state === "error");
        pi.move(x + 10 - line.getComputedTextLength() / 2 - 14, y - 5.5);
        pi.show(!none);
        lastKey = key;
      }
      if (!none) pi.set(m);
    };
  }

  // The status line when there is a usage source to report on; the date when there isn't.
  function footer(p, y, env) {
    if (env.status) return meta(p, y);
    const line = el(p, "text", { x: C, y, "text-anchor": "middle", class: "t-meta" });
    return (d) => setText(line, dateText(d.now, "date"));
  }

  // "LEFT" or "USED": says which way the limit numbers read.
  function unitHead(p, x, y, anchor = "middle") {
    const node = el(p, "text", { x, y, "text-anchor": anchor, class: "t-head" });
    return (d) => setText(node, d.unitWord);
  }

  function ramLine(p, y) {
    const line = el(p, "text", { x: C, y, "text-anchor": "middle", class: "t-sub" });
    return (d) => {
      const r = d.hw.ram || {};
      setText(line, t("sub.ram", { used: r.used == null ? "—" : dec(r.used / 1024), total: r.total == null ? "—" : Math.round(r.total / 1024) }));
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

  // The line under it is the load and power, or the model when the load is shown elsewhere.
  function tempBlock(p, key, cx, y, size, under = "load") {
    el(p, "text", { x: cx, y: y - size * 0.86, "text-anchor": "middle", class: size > 80 ? "t-lbl" : "t-lbl-s" }, key.toUpperCase());
    const val = num(p, cx + size * 0.09, y, size);
    const sub = el(p, "text", { x: cx, y: y + 34, "text-anchor": "middle", class: "t-sub" });
    return (d) => {
      const h = d.hw[key];
      setNum(val, int(h.temp), "°", size * 0.5, size);
      val.classList.toggle("is-warn", isHot(h, key));
      setText(sub, under === "model" ? fit(model(h.name, ""), 18) : `${h.load == null ? "—" : Math.round(h.load * 100)}% · ${int(h.power)} W`);
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
  // Each gets env.limits, the limits to draw (some of LIMITS, or none), env.cost, whether a cost is
  // shown, and env.status, whether there is a usage source to report on. A layout lays itself out
  // for what it gets: the room of limits it doesn't have goes to the hardware.

  // Where the i-th of n things `step` apart goes, centred on `mid`.
  const spread = (n, i, mid, step) => Math.round(mid + (i - (n - 1) / 2) * step);

  // A limit per row: label + reset on the left, big percentage on the right, pace bar below.
  function sceneLimits(p, layer, env) {
    const up = [clock(p, 96)];
    const x0 = 118, x1 = 522, n = env.limits.length;
    env.limits.forEach((def, i) => {
      const yb = spread(n, i, 332, 128);
      if (!i) up.push(unitHead(p, x1, yb - 76, "end"));
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
    up.push(footer(p, 560, env));
    return up;
  }

  function sceneHardware(p, layer, env) {
    const up = [clock(p, 96), tempArcs(p)];
    up.push(tempBlock(p, "cpu", 226, 270, 106));
    up.push(tempBlock(p, "gpu", 414, 270, 106));
    el(p, "line", { x1: C, x2: C, y1: 160, y2: 300, class: "rule" });
    up.push(statBlock(p, t("lbl.liquid"), 226, 444, 74, readLiquid));
    up.push(statBlock(p, t("lbl.power"), 414, 444, 74, readPower));
    up.push(ramLine(p, 500));
    up.push(footer(p, 552, env));
    return up;
  }

  // Everything at once, in reading order: the limits with pace bars, then the hardware. With no
  // limits the top row is how busy the CPU, the GPU and the memory are, so the temperatures
  // below name the chips instead of repeating the load.
  function sceneCockpit(p, layer, env) {
    const n = env.limits.length;
    const up = [clock(p, 90), tempArcs(p)];
    // [label, bar's fill 0..100, value, unit, line under it, the limit's view]
    const cols = n
      ? env.limits.map((def) => [def.short, (d) => d.views[def.key]])
      : [
          ["CPU", (d) => d.hw.cpu.load, (d) => `${int(d.hw.cpu.power)} W`],
          ["GPU", (d) => d.hw.gpu.load, (d) => `${int(d.hw.gpu.power)} W`],
          [t("lbl.ram"), (d) => memFrac(ram(d.hw)), (d) => ramText(ram(d.hw))],
        ];
    if (n) up.push(unitHead(p, C, 126));
    else el(p, "text", { x: C, y: 126, "text-anchor": "middle", class: "t-head" }, t("lbl.load"));
    // fewer limits get more room each
    const step = cols.length === 3 ? 120 : 150, half = cols.length === 1 ? 80 : cols.length === 2 ? 56 : 46;
    cols.forEach(([label, read, under], i) => {
      const x = spread(cols.length, i, C, step);
      el(p, "text", { x, y: 158, "text-anchor": "middle", class: "t-lbl-xs" }, label);
      const val = num(p, x + 6, 216, 60);
      const bar = barGauge(p, x - half, x + half, 238, 6);
      const sub = el(p, "text", { x, y: 266, "text-anchor": "middle", class: "t-sub-s" });
      up.push((d) => {
        if (n) {
          const v = read(d);
          limitGauge(bar, v);
          setNum(val, v.value, "%", 26, 60);
          val.classList.toggle("is-dim", v.dim);
          setParts(sub, v.sub);
          return;
        }
        const f = read(d);
        bar.set(f == null ? 0 : clamp(f, 0, 1) * 100, null, null);
        setNum(val, f == null ? "—" : `${Math.round(f * 100)}`, "%", 26, 60);
        setText(sub, under(d));
      });
    });
    el(p, "line", { x1: 170, x2: 470, y1: 292, y2: 292, class: "rule" });
    up.push(tempBlock(p, "cpu", 226, 398, 92, n ? "load" : "model"));
    up.push(tempBlock(p, "gpu", 414, 398, 92, n ? "load" : "model"));
    // the RAM is in the top row when there are no limits
    const stats = [[t("lbl.liquid"), readLiquid], [t("lbl.power"), readPower], ...(n ? [[t("lbl.ram"), readRam]] : [])];
    stats.forEach(([label, read], i) => up.push(statBlock(p, label, spread(stats.length, i, C, 120 + 20 * (3 - stats.length)), 500, 38, read, "t-lbl-xs")));
    up.push(footer(p, 554, env));
    return up;
  }

  // A watch: hands for the time, three subdials, the hardware in the window at twelve. The
  // subdials are the limits, then the temperatures where there are fewer than three limits; the
  // window and the line under it show what the subdials don't.
  function sceneChronograph(p, layer, env) {
    const up = [];
    for (let i = 0; i < 12; i++) {
      const [x0, y0] = polar(i % 3 ? 274 : 264, i * 30);
      const [x1, y1] = polar(290, i * 30);
      el(p, "line", { x1: x0, y1: y0, x2: x1, y2: y1, class: "hour" });
    }
    const dials = [
      ...env.limits.map((def) => ({ id: def.key, label: def.short, limit: def.key })),
      { id: "cpu", label: "CPU", temp: "cpu" },
      { id: "gpu", label: "GPU", temp: "gpu" },
      { id: "liquid", label: t("lbl.liquid") },
    ].slice(0, 3);
    dials.forEach((it, i) => {
      const [cx, cy] = [[182, 322], [458, 322], [320, 452]][i];
      el(p, "circle", { cx, cy, r: 82, class: "face" });
      ticks(p, 72, 79, -135, 135, 10, cx, cy, 1.4);
      const g = arcGauge(p, 60, -135, 135, 8, cx, cy);
      if (it.temp) g.notch.classList.add("is-peak");
      el(p, "text", { x: cx, y: cy - 14, "text-anchor": "middle", class: "t-lbl-xxs" }, it.label);
      const val = num(p, cx + 6, cy + 28, 42);
      const sub = el(p, "text", { x: cx, y: cy + 64, "text-anchor": "middle", class: "t-sub-xs" });
      up.push((d) => {
        if (it.limit) {
          const v = d.views[it.limit];
          limitGauge(g, v);
          setNum(val, v.value, "%", 20, 42);
          val.classList.toggle("is-dim", v.dim);
          val.classList.toggle("is-warn", !!v.hot);
          setParts(sub, v.sub);
        } else if (it.temp) {
          const h = d.hw[it.temp];
          tempGauge(g, h, it.temp);
          setNum(val, int(h.temp), "°", 21, 42);
          val.classList.toggle("is-warn", isHot(h, it.temp));
          setText(sub, `${int(h.power)} W`);
        } else {
          g.set(scale(d.hw.liquid, 20, 50), null, null);
          setNum(val, dec(d.hw.liquid), "°", 21, 42);
        }
      });
    });
    const used = dials.map((it) => it.id);
    const win = [["cpu", "CPU", readTemp("cpu")], ["gpu", "GPU", readTemp("gpu")], ["liquid", t("lbl.liquid"), readLiquid], ["power", t("lbl.power"), readPower], ["ram", t("lbl.ram"), readRam]]
      .filter(([id]) => !used.includes(id))
      .slice(0, 3);
    // "21.4 GB" is the widest, so the window grows a little around it
    const ww = win.some(([id]) => id === "ram") ? 268 : 244;
    el(p, "rect", { x: C - ww / 2, y: 128, width: ww, height: 78, rx: 18, class: "window" });
    win.forEach(([, label, read], i) => up.push(statBlock(p, label, spread(win.length, i, C, win.length === 3 ? (ww > 244 ? 84 : 78) : 100) + 3, 192, 32, read, "t-lbl-xxs")));
    const shown = used.concat(win.map(([id]) => id));
    const extras = [
      ["power", (d) => `${int(power(d.hw))} W`],
      ["ram", (d) => `RAM ${ramGb(ram(d.hw))} GB`],
      ["cpu.load", (d) => `CPU ${loadText(d.hw.cpu)}`],
      ["gpu.load", (d) => `GPU ${loadText(d.hw.gpu)}`],
    ].filter(([id]) => !shown.includes(id)).slice(0, 2);
    const extra = el(p, "text", { x: C, y: 232, "text-anchor": "middle", class: "t-sub-s" });
    up.push((d) => setText(extra, extras.map(([, f]) => f(d)).join(" · ")));
    up.push(footer(p, 566, env));
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

  // Columns side by side: the limits, or how busy the CPU, the GPU and the memory are when there
  // are none; then CPU, GPU, liquid and power.
  function sceneColumns(p, layer, env) {
    const up = [clock(p, 96)];
    const pct = (f) => [f == null ? "—" : `${Math.round(f * 100)}`, "%", 13];
    const left = env.limits.length
      ? env.limits.map((def) => ({ label: def.tiny, limit: def.key, claude: def.key.startsWith("claude") }))
      : [
          { label: "CPU", read: (d) => pct(d.hw.cpu.load), f: (d) => (d.hw.cpu.load ?? 0) * 100 },
          { label: "GPU", read: (d) => pct(d.hw.gpu.load), f: (d) => (d.hw.gpu.load ?? 0) * 100 },
          { label: t("lbl.ram"), read: (d) => pct(memFrac(ram(d.hw))), f: (d) => (memFrac(ram(d.hw)) ?? 0) * 100 },
        ];
    const cols = [
      ...left,
      { label: "CPU", temp: "cpu" },
      { label: "GPU", temp: "gpu" },
      { label: t("lbl.liquid"), read: (d) => [int(d.hw.liquid), "°", 14], f: (d) => scale(d.hw.liquid, 20, 50) },
      { label: t("lbl.power"), read: (d) => [int(power(d.hw)), "W", 12], f: (d) => scale(power(d.hw), 0, 600) },
    ];
    // 58 apart, the two groups further apart, all of it centred
    const k = left.length;
    const X = cols.map((_, i) => C + (i - (cols.length - 1) / 2) * 58 + (i < k ? -14 : 14));
    const top = 238, bottom = 436;
    const lx = (X[0] + X[k - 1]) / 2;
    if (env.limits.length) up.push(unitHead(p, lx, 150));
    else el(p, "text", { x: lx, y: 150, "text-anchor": "middle", class: "t-head" }, t("lbl.load"));
    el(p, "text", { x: (X[k + 1] + X[k + 2]) / 2, y: 150, "text-anchor": "middle", class: "t-head" }, t("lbl.hardware"));
    cols.forEach((col, i) => {
      const x = X[i];
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
    // Claude's limits are labelled 5H and 7D, so a bracket under them says whose they are
    const claude = X.filter((_, i) => cols[i].claude);
    if (claude.length) {
      const [a, b] = [claude[0], claude[claude.length - 1]];
      el(p, "path", { d: `M${a - 15} 480V486H${b + 15}V480`, class: "bracket" });
      el(p, "text", { x: (a + b) / 2, y: 506, "text-anchor": "middle", class: "t-head" }, t("lbl.claude"));
    }
    up.push(ramLine(p, 534));
    up.push(footer(p, 568, env));
    return up;
  }

  // ---------- the terminal family ----------
  // Monospace output. Bars are character cells, but they fill to their exact place, partway
  // through a cell when that is where the value is; the pace is the same thin line as on the
  // other layouts, laid over the cells at its exact position too.

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

  // ░░░░░░░░░░ : the empty cells of a bar, part of its line. barFill draws the full ones over them.
  const track = (n, empty = "░") => ["tm-e", empty.repeat(n)];
  let barIds = 0;
  // ███▌░░░░░░ : the full glyphs of the n cells from column col, over the track, coloured by a
  // gradient with hard stops: the fill up to a, the second colour from a to b, clear from b on
  // (fractions of the bar). So a bar ends inside a cell, where the pace line would meet it.
  function barFill(p, x, y, size, col, n, full = "█") {
    const cw = advance(p, size), x0 = x + col * cw, id = `bar${++barIds}`;
    const grad = el(p, "linearGradient", { id, gradientUnits: "userSpaceOnUse", x1: x0.toFixed(1), y1: 0, x2: (x0 + n * cw).toFixed(1), y2: 0 });
    const stops = ["bs-f", "bs-f", "bs-o", "bs-o", "bs-x", "bs-x"].map((c, i) => el(grad, "stop", { offset: i < 5 ? 0 : 1, class: c }));
    el(p, "text", { x: x0.toFixed(1), y, class: "t-term t-bar", style: `font-size:${size}px;fill:url(#${id})` }, full.repeat(n));
    return (a, b = a, second = "bs-o") => {
      const at = [a, a, b, b].map((f) => clamp(f, 0, 1).toFixed(4));
      for (let i = 0; i < 4; i++) setAttr(stops[1 + i], "offset", at[i]);
      setAttr(stops[2], "class", second);
      setAttr(stops[3], "class", second);
    };
  }
  // A limit's bar: what was used past the pace is in the lighter colour (red once the limit is
  // used up), and the pace line lies over it.
  function limitBar(p, x, y, size, col, n, full) {
    const fill = barFill(p, x, y, size, col, n, full);
    const pace = paceLine(p, x, y, size, col, n);
    return (v) => {
      const s = limitSpan(v), end = s.f / 100;
      fill(s.over == null ? end : Math.min(end, s.over / 100), end, v.hot ? "bs-w" : "bs-o");
      pace(v);
    };
  }
  // A bar of a fraction from 0 to 1; empty when there is none.
  function fracBar(p, x, y, size, col, n, full) {
    const fill = barFill(p, x, y, size, col, n, full);
    return (frac) => fill(frac == null ? 0 : frac);
  }
  const fit = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const pctText = (v) => (v.value === "—" ? "   —" : `${v.value.padStart(3)}%`);
  // Time to the reset for narrow columns, or the short status when there is no countdown.
  const resetIn = (v, now) => (v.state === "ok" && v.resetsAt ? dur(v.resetsAt - now) : v.sub.map((x) => x.t).join(" "));
  const subClass = (v) => (v.sub.some((x) => x.warn) ? "tm-w" : "tm-d");
  const ram = (hw) => hw.ram || {};
  const ramGb = (r) => (r.used == null ? "—" : dec(r.used / 1024));
  const ramText = (r) => `${ramGb(r)} / ${r.total == null ? "—" : Math.round(r.total / 1024)} GB`;
  const loadText = (h) => (h.load == null ? "—" : `${Math.round(h.load * 100)}%`);
  // What the CPU and GPU bars of the terminal layouts fill with, as set in the settings: the
  // load, or the temperature on the 20–100° scale of the gauges.
  const hwFrac = (h, d) => (d.bars === "temp" ? (h.temp == null ? null : tempF(h.temp) / 100) : h.load);

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

  // Everything as console output, with a blinking cursor. Lines that have nothing to say are left
  // out, and the rest stay centred; with no limits to list, `date` fills in.
  function sceneTerminal(p, layer, env) {
    // [line, the space above it]
    const lines = [
      ...(env.limits.length ? [["limits", 0], ...env.limits.map((def, i) => [def.key, i ? 36 : 40])] : []),
      ["hw", env.limits.length ? 44 : 0], ["cpu", 36], ["gpu", 36], ["liquid", 36], ["ram", 36],
      ...(env.limits.length ? [] : [["datecmd", 44], ["date", 36]]),
      ...(env.status ? [["meta", 44]] : []),
      ["prompt", 38],
    ];
    let h = 0;
    const at = lines.map(([, dy]) => (h += dy));
    const Y = Object.fromEntries(lines.map(([k], i) => [k, Math.round(319 - h / 2) + at[i]]));
    const L = Object.fromEntries(lines.map(([k]) => [k, term(p, 78, Y[k], 20)]));
    const gauges = env.limits.map((def) => limitBar(p, 78, Y[def.key], 20, 10, 10));
    const bars = { cpu: fracBar(p, 78, Y.cpu, 20, 13, 10), gpu: fracBar(p, 78, Y.gpu, 20, 13, 10) };
    const prompt = (cmd) => [["tm-p", "kraken"], ["tm-d", "@dial ~ $ "], ["", cmd]];
    return [
      (d) => {
        if (L.limits) setSpans(L.limits, prompt(`limits --${d.left ? "left" : "used"}`));
        env.limits.forEach((def, i) => {
          const v = d.views[def.key];
          setSpans(L[def.key], [
            ["tm-k", `${def.cmd} `],
            track(10),
            [v.dim ? "tm-d" : v.hot ? "tm-w" : "", ` ${pctText(v)}`],
            [subClass(v), `  ${fit(v.sub.map((x) => x.t).join(" "), 16)}`],
          ]);
          gauges[i](v);
        });
        setSpans(L.hw, prompt("hw"));
        for (const key of ["cpu", "gpu"]) {
          const h = d.hw[key];
          // the bar's own value follows it
          const temp = [isHot(h, key) ? "tm-w" : "", `${int(h.temp)}°`.padStart(4)], load = ["", loadText(h).padStart(4)];
          const [before, after] = d.bars === "temp" ? [load, temp] : [temp, load];
          setSpans(L[key], [["tm-k", key.padEnd(7)], before, ["", "  "], track(10), ["", " "], after, ["tm-d", `  ${int(h.power).padStart(3)} W`]]);
          bars[key](hwFrac(h, d));
        }
        setSpans(L.liquid, [["tm-k", "liquid "], ["", `${dec(d.hw.liquid)}°`.padEnd(8)], ["tm-k", "power "], ["", `${int(power(d.hw))} W`]]);
        setSpans(L.ram, [["tm-k", "ram    "], ["", ramText(ram(d.hw))], ...(d.cost ? [["tm-k", "   cost "], ...costSpans(d.cost)] : [])]);
        if (L.date) {
          setSpans(L.datecmd, prompt("date"));
          setSpans(L.date, [["", dateText(d.now, "date")]]);
        }
        if (L.meta) setSpans(L.meta, [[d.meta.state === "error" ? "tm-w" : "tm-d", `# ${d.meta.text}`]]);
        setSpans(L.prompt, [["tm-d", `[${hhmmss(d.now)}] `], ["tm-p", "~ $ "], ["tm-c", Math.floor(d.now / 1000) % 2 ? " " : "▌"]]);
      },
    ];
  }

  // htop: meters for the hardware up top, the limits as the process list under an inverse
  // header (the one furthest behind its pace selected), F-keys along the bottom. With no limits
  // the processes are the CPU and the GPU: their model, recent peak and power, the hotter one
  // selected. Fewer rows, or no status line, and the whole screen moves down to stay centred.
  function sceneHtop(p, layer, env) {
    const S = 19, N = 36, cw = advance(p, S), x = C - (N * cw) / 2;
    const n = env.limits.length, count = n || 2;
    const saved = (3 - count) * 32 + (env.status ? 0 : 38), dy = Math.round(saved / 2), up = dy - saved;
    const line = (y) => term(p, x, y, S);
    const band = (col, n, y, cls) =>
      el(p, "rect", { x: (x + col * cw).toFixed(1), y: (y - S * 0.93).toFixed(1), width: (n * cw).toFixed(1), height: (S * 1.17).toFixed(1), class: cls });
    const meters = [136, 166, 196, 226, 256].map((y) => line(y + dy));
    const clockLine = line(290 + dy);
    const sel = band(0, N, 0, "tm-sel");
    band(0, N, 330 + dy, "tm-inv-bg");
    const head = line(330 + dy);
    const ROWS = Array.from({ length: count }, (_, i) => 362 + dy + i * 32);
    const rows = ROWS.map(line);
    const gauges = n ? ROWS.map((y) => limitBar(p, x, y, S, 16, 10, "|")) : [];
    const note = env.status ? line(464 + dy - (3 - count) * 32) : null;
    // F-keys: the number plain, its label inverse
    const keys = [["F1", "Help"], ["F2", "Setup"], ["F3", "Theme"], ["F10", "Quit"]];
    let col = 0;
    for (const [k] of keys) {
      band(col + k.length, 6, 512 + up, "tm-inv-bg");
      col += k.length + 6;
    }
    setSpans(line(512 + up), keys.flatMap(([k, label]) => [["", k], ["tm-inv", label.padEnd(6)]]));
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
          const temp = `${int(h.temp)}°C`, load = loadText(h);
          setSpans(meters[i], meter(label, hwFrac(h, d), d.bars === "temp" ? `${load} ${temp}` : `${temp} ${load}`, isHot(h, key)));
        }
        setSpans(meters[2], meter("Liq", hw.liquid == null ? null : (hw.liquid - 20) / 30, `${dec(hw.liquid)}°C`));
        setSpans(meters[3], meter("Mem", r.used != null && r.total ? r.used / r.total : null, `${r.used == null ? "—" : dec(r.used / 1024)}G/${r.total == null ? "—" : dec(r.total / 1024)}G`));
        setSpans(meters[4], meter("Pwr", pw == null ? null : pw / 600, `${int(pw)}W`));
        setSpans(clockLine, [["tm-k", " Time: "], ["", hhmmss(d.now)], ...(d.cost ? [["tm-k", "  Cost: "], ...costSpans(d.cost)] : [])]);
        let worst = 0, behind = -Infinity;
        if (n) {
          setSpans(head, [["tm-inv", ` ${"LIMIT".padEnd(10)}${(d.left ? "LEFT" : "USED").padStart(4)} ${"PACE".padEnd(10)} ${"RESET".padStart(8)} `]]);
          env.limits.forEach((def, i) => {
            const v = d.views[def.key], s = limitSpan(v);
            setSpans(rows[i], [
              ["tm-k", ` ${def.cmd} `],
              [v.dim ? "tm-d" : v.hot ? "tm-w" : "", pctText(v)],
              ["", " "],
              track(10, " "),
              [subClass(v), ` ${fit(resetIn(v, d.now), 8).padStart(8)}`],
            ]);
            gauges[i](v);
            // how far the limit is behind an even pace
            const gap = s.notch == null || v.dim ? -Infinity : d.left ? s.notch - s.f : s.f - s.notch;
            if (gap > behind) [worst, behind] = [i, gap];
          });
        } else {
          setSpans(head, [["tm-inv", ` ${"DEV".padEnd(4)}${"MODEL".padEnd(18)} ${"PEAK".padStart(4)} ${"POWER".padStart(6)} `]]);
          ["cpu", "gpu"].forEach((key, i) => {
            const h = hw[key];
            setSpans(rows[i], [
              ["tm-k", ` ${key.padEnd(4)}`],
              ["", fit(model(h.name, key.toUpperCase()), 17).padEnd(18)],
              [h.peak != null && h.peak >= HOT[key] ? "tm-w" : "", ` ${`${int(h.peak)}°`.padStart(4)}`],
              ["tm-d", ` ${`${int(h.power)} W`.padStart(6)} `],
            ]);
            // how close it runs to hot
            const heat = h.temp == null ? -Infinity : h.temp / HOT[key];
            if (heat > behind) [worst, behind] = [i, heat];
          });
        }
        setAttr(sel, "y", (ROWS[worst] - S * 0.93).toFixed(1));
        if (note) setSpans(note, [[d.meta.state === "error" ? "tm-w" : "tm-d", ` ${fit(d.meta.text, N - 1)}`]]);
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
  // A graph's range: whole 5° steps around what it holds, never flatter than 15°, so the line
  // uses the height of its box instead of hugging the bottom.
  function tempRange(hist) {
    const v = hist.filter((x) => x != null);
    if (!v.length) return [30, 60];
    const lo = Math.floor((Math.min(...v) - 3) / 5) * 5;
    return [lo, Math.max(lo + 15, Math.ceil((Math.max(...v) + 2) / 5) * 5)];
  }

  // btop: rounded boxes with their titles set into the border, temperature graphs of the last
  // two minutes, the clock in the corner. Boxes are as wide as the round screen allows at their height.
  function sceneBtop(p, layer, env) {
    const S = 20, cw = advance(p, S), n = env.limits.length;
    const f = (v) => v.toFixed(1);
    // A box from x0 to x1: the title gap at the left, an optional label gap of `right` characters at the right.
    function box(x0, x1, y0, y1, num, title, right = 0) {
      const r = 10, ta = x0 + cw - 3, tb = x0 + cw * (1 + num.length + title.length) + 3;
      const ra = x1 - cw * (1 + right) - 3, rb = x1 - cw + 3;
      let d = `M${f(ta)} ${y0}H${f(x0 + r)}Q${f(x0)} ${y0} ${f(x0)} ${y0 + r}V${y1 - r}Q${f(x0)} ${y1} ${f(x0 + r)} ${y1}`;
      d += `H${f(x1 - r)}Q${f(x1)} ${y1} ${f(x1)} ${y1 - r}V${y0 + r}Q${f(x1)} ${y0} ${f(x1 - r)} ${y0}`;
      d += right ? `H${f(rb)}M${f(ra)} ${y0}H${f(tb)}` : `H${f(tb)}`;
      el(p, "path", { d, class: "tm-box" });
      setSpans(term(p, x0 + cw, y0 + S * 0.32, S), [["tm-p", num], ["tm-t", title]]);
      return right ? term(p, x1 - cw * (1 + right), y0 + S * 0.32, S) : null;
    }
    const span = (cols) => [C - (cols * cw) / 2, C + (cols * cw) / 2];
    // The limits box has a row per limit. Without limits it goes, the boxes are numbered from one
    // and the clock moves to the sys box; whatever is saved, the rest moves down by half of it.
    const saved = (n ? (3 - n) * 31 : 130) + (env.status ? 0 : 38), dy = Math.round(saved / 2), below = dy - saved + (env.status ? 0 : 38);
    const nums = (n ? ["¹", "²", "³", "⁴"] : ["", "¹", "²", "³"]);

    let clockText = null, rows = [], gauges = [];
    if (n) {
      const [lx0, lx1] = span(36);
      clockText = box(lx0, lx1, 116 + dy, 228 - (3 - n) * 31 + dy, nums[0], "limits", 8);
      const LY = env.limits.map((_, i) => 150 + dy + i * 31);
      rows = LY.map((y) => term(p, lx0 + cw, y, S));
      gauges = LY.map((y) => limitBar(p, lx0 + cw, y, S, 10, 10, "■"));
    }

    const [gx0, gx1] = span(45);
    const GY = [270, 293, 316, 339].map((y) => y + below);
    const panes = [["cpu", gx0, gx0 + 22 * cw, nums[1]], ["gpu", gx1 - 22 * cw, gx1, nums[2]]].map(([key, x0, x1, num]) => ({
      key,
      range: box(x0, x1, 246 + below, 388 + below, num, key, 6),
      graph: GY.map((y) => term(p, x0 + cw, y, S)),
      text: term(p, x0 + cw, 372 + below, S),
      hist: [],
    }));

    const [sx0, sx1] = span(40);
    // the sys box's label: the cost next to the limits box, the clock without one
    const label = box(sx0, sx1, 408 + below, 490 + below, nums[3], "sys", n ? (env.cost ? 13 : 0) : 8);
    const sys = [442, 474].map((y) => term(p, sx0 + cw, y + below, S));
    const mem = fracBar(p, sx0 + cw, 474 + below, S, 4, 25, "■");
    const note = env.status ? term(p, C, 528 + below, 16, "middle") : null;
    let sampledAt = -Infinity;
    return [
      (d) => {
        if (clockText) setText(clockText, hhmmss(d.now));
        if (!n) setText(label, hhmmss(d.now));
        else if (label) {
          const c = costSpans(d.cost);
          setSpans(label, [["", " ".repeat(Math.max(0, 13 - d.cost.value.length - c[1][1].length))], ...c]);
        }
        env.limits.forEach((def, i) => {
          const v = d.views[def.key];
          setSpans(rows[i], [
            ["tm-k", `${def.cmd} `],
            track(10, "■"),
            [v.dim ? "tm-d" : v.hot ? "tm-w" : "", ` ${pctText(v)}`],
            [subClass(v), `  ${fit(resetIn(v, d.now), 6).padStart(6)}`],
          ]);
          gauges[i](v);
        });
        const sample = d.now - sampledAt >= 3000;
        if (sample) sampledAt = d.now;
        for (const pane of panes) {
          const h = d.hw[pane.key];
          if (sample) {
            pane.hist.push(h.temp ?? null);
            if (pane.hist.length > 40) pane.hist.shift();
          }
          const [lo, hi] = tempRange(pane.hist);
          setText(pane.range, `${lo}-${hi}°`.padStart(6));
          const norm = pane.hist.map((t) => (t == null ? null : (t - lo) / (hi - lo)));
          braille(norm, 20, 4).forEach((s, r) => setSpans(pane.graph[r], [[r ? "tm-f" : "tm-o", s]]));
          setSpans(pane.text, [
            [isHot(h, pane.key) ? "tm-w" : "tm-t", `${int(h.temp)}°C`.padEnd(7)],
            ["", `${h.load == null ? "—" : Math.round(h.load * 100)}%`.padStart(4)],
            ["tm-d", `${int(h.power)} W`.padStart(9)],
          ]);
        }
        const r = ram(d.hw);
        setSpans(sys[0], [["tm-k", "liquid "], ["tm-t", `${dec(d.hw.liquid)}°C`.padEnd(13)], ["tm-k", "power "], ["tm-t", `${int(power(d.hw))} W`]]);
        setSpans(sys[1], [
          ["tm-k", "mem "],
          track(25, "■"),
          ["", ` ${r.used == null ? "—" : dec(r.used / 1024)}/${r.total == null ? "—" : Math.round(r.total / 1024)}G`],
        ]);
        mem(memFrac(r));
        // with no limits box the cost, if there is one, goes on the status line
        if (note) setSpans(note, [[d.meta.state === "error" ? "tm-w" : "tm-d", !n && d.cost ? `${d.meta.short} · ${d.cost.value} ${d.cost.short}` : d.meta.text]]);
      },
    ];
  }

  // ---------- mascots ----------
  // Pixel sprites 16 wide: X body, o highlight, W eye white, K dark. Two frames to walk with;
  // pupils and eyelids are drawn on top, so the eyes can look around and blink.
  const PX = 7;
  const OCTO_HEAD = [
    ".....XXXXXX.....",
    "...XooXXXXXXX...",
    "..XoXXXXXXXXXX..",
    ".XXXXXXXXXXXXXX.",
    ".XXXWWXXXXWWXXX.",
    ".XXXWWXXXXWWXXX.",
    ".XXXXXXXXXXXXXX.",
    "..XXXXXXXXXXXX..",
  ];
  const CRAB_BODY = [
    "XXXX..X..X..XXXX",
    ".XX.XXXXXXXX.XX.",
    "..XXXooooooXXX..",
    ".XXXXXXXXXXXXXX.",
    ".XXXXXXXXXXXXXX.",
    "..XXXXXXXXXXXX..",
  ];
  const GHOST_TOP = [
    ".....XXXXXX.....",
    "...XXXXXXXXXX...",
    "..XXXXXXXXXXXX..",
    ".XXXWWXXXXWWXXX.",
    ".XXXWWXXXXWWXXX.",
    ".XXXXXXXXXXXXXX.",
    ".XXXXXXXXXXXXXX.",
    ".XXXoXoXXoXoXXX.",
    ".XXoXoXooXoXoXX.",
    ".XXXXXXXXXXXXXX.",
  ];
  const CAT_TOP = [
    "...........X...X",
    "...........XX.XX",
    "X..........XXXXX",
    "X..........XWXWX",
    ".X.........XXKXX",
    ".X...XXXXXXXXXX.",
    "..XXXXXXXXXXXXX.",
    "..XXXXXXXXXXXX..",
    "..XXoooooooXXX..",
  ];
  const ROBOT_TOP = [
    ".......oo.......",
    ".......XX.......",
    "..XXXXXXXXXXXX..",
    ".oXXWWXXXXWWXXo.",
    ".oXXWWXXXXWWXXo.",
    "..XXXXXXXXXXXX..",
    "..XXXoKKKKoXXX..",
    "..XXXXXXXXXXXX..",
    "....XXXXXXXX....",
    "..XXoXXXXXXoXX..",
  ];
  const MASCOTS = [
    {
      id: "kraken",
      eyes: [[4, 4, 2, 2], [10, 4, 2, 2]],
      a: [...OCTO_HEAD, "..XX.XX..XX.XX..", ".XX..XX..XX..XX.", ".X..XX....XX..X.", "....X......X...."],
      b: [...OCTO_HEAD, "..XX.XX..XX.XX..", "..XX.XX..XX.XX..", ".XX..X....X..XX.", "XX...XX..XX...XX"],
    },
    {
      id: "crab",
      eyes: [[5, 1, 2, 2], [9, 1, 2, 2]],
      a: ["................", ".XX..WW..WW..XX.", "XX.X.WW..WW.X.XX", ...CRAB_BODY, ".X.X.X....X.X.X.", "X..X..X..X..X..X"],
      b: ["................", ".XX..WW..WW..XX.", "XXXX.WW..WW.XXXX", ...CRAB_BODY, "..X.X.X..X.X.X..", ".X..X..XX..X..X."],
    },
    {
      id: "ghost",
      float: true,
      eyes: [[4, 3, 2, 2], [10, 3, 2, 2]],
      a: [...GHOST_TOP, ".XX.XXX..XXX.XX.", ".X...XX..XX...X."],
      b: [...GHOST_TOP, ".XXX.XX..XX.XXX.", "..X..X....X..X.."],
    },
    {
      id: "cat",
      flip: true,
      eyes: [[12, 3, 1, 1], [14, 3, 1, 1]],
      a: [...CAT_TOP, "..X.X......X.X..", "..X.X......X.X.."],
      b: [...CAT_TOP, "...XX......XX...", "..X..X....X..X.."],
    },
    {
      id: "robot",
      eyes: [[4, 3, 2, 2], [10, 3, 2, 2]],
      a: [...ROBOT_TOP, "....XX....XX....", "....XX....XX...."],
      b: [...ROBOT_TOP, "....XX....XX....", "..........XX...."],
    },
  ];
  for (const m of MASCOTS) Object.defineProperty(m, "name", { get: () => t(`mascot.${m.id}`), enumerable: true });
  const mascotById = (id) => MASCOTS.find((m) => m.id === id) || MASCOTS[0];

  // Draws a mascot into parent, px to a pixel; set() moves it, picks the frame, points the eyes, closes them.
  function sprite(parent, m, px = PX) {
    const sq = (x, y, w = 1, h = 1) => `M${x * px} ${y * px}h${w * px}v${h * px}h${-w * px}z`;
    const g = el(parent, "g", { class: "mascot", "shape-rendering": "crispEdges" });
    const body = el(g, "g");
    const frames = [m.a, m.b].map((rows) => {
      const fr = el(body, "g");
      const paths = {};
      rows.forEach((row, y) => [...row].forEach((c, x) => c !== "." && (paths[c] = (paths[c] || "") + sq(x, y))));
      for (const c in paths) el(fr, "path", { d: paths[c], class: `px-${c}` });
      return fr;
    });
    const pupils = el(body, "path", { class: "px-K" });
    const lids = el(body, "g");
    el(lids, "path", { class: "px-X", d: m.eyes.map(([x, y, w, h]) => sq(x, y, w, h)).join("") });
    el(lids, "path", { class: "px-K", d: m.eyes.map(([x, y, w, h]) => sq(x, y + h - 1, w, 1)).join("") });
    const width = 16 * px;
    let key = null;
    return {
      node: g,
      width,
      height: m.a.length * px,
      step: px,
      set({ x, y, frame = 0, look = 1, blink = false, flip = false }) {
        const k = `${x}|${y}|${frame}|${look}|${blink}|${flip}`;
        if (k === key) return;
        key = k;
        setAttr(g, "transform", `translate(${x} ${y})`);
        setAttr(body, "transform", flip ? `translate(${width} 0) scale(-1 1)` : "");
        frames.forEach((fr, i) => fr.style.display !== (i === frame ? "" : "none") && (fr.style.display = i === frame ? "" : "none"));
        // look is in screen terms; a flipped body mirrors it
        const right = (flip ? -look : look) > 0;
        setAttr(pupils, "d", m.eyes.map(([ex, ey, w, h]) => sq(w > 1 && right ? ex + w - 1 : ex, ey, 1, h)).join(""));
        lids.style.display = blink ? "" : "none";
        pupils.style.display = blink ? "none" : "";
      },
    };
  }

  // The same mascot as ASCII art for a fetch logo: two characters to a pixel keep the pixels square.
  const ASCII_PX = { X: "$$", o: "++", W: "██", K: "██" };
  function asciiSprite(parent, m, size) {
    const cw = advance(parent, size);
    const g = el(parent, "g", { class: "mascot", "font-weight": 700 });
    const rows = m.a.map((_, r) => term(g, 0, ((r + 0.82) * 2 * cw).toFixed(1), size));
    let key = null;
    return {
      node: g,
      width: 32 * cw,
      height: m.a.length * 2 * cw,
      step: 2 * cw,
      set({ x, y, frame = 0, look = 1, blink = false }) {
        const k = `${x}|${y}|${frame}|${look}|${blink}`;
        if (k === key) return;
        key = k;
        setAttr(g, "transform", `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
        // eyes as the pixel sprite draws them: a pupil column on the side it looks to, or a closed lid
        const grid = (frame ? m.b : m.a).map((row) => [...row]);
        for (const [ex, ey, w, h] of m.eyes)
          for (let j = 0; j < h; j++)
            for (let i = 0; i < w; i++)
              grid[ey + j][ex + i] = blink ? (j === h - 1 ? "K" : "X") : i === (w > 1 && look > 0 ? w - 1 : 0) ? "K" : "W";
        grid.forEach((row, r) => {
          const spans = [];
          for (const c of row) {
            const cls = c === "." ? "" : `px-${c}`, last = spans[spans.length - 1];
            if (last && last[0] === cls) last[1] += ASCII_PX[c] || "  ";
            else spans.push([cls, ASCII_PX[c] || "  "]);
          }
          setSpans(rows[r], spans);
        });
      },
    };
  }

  // Wanders along the ground between minX and maxX: walks a stretch, stands, looks around,
  // blinks. Moves at 5 steps a second only while walking, so standing still costs CAM nothing.
  // With no room to walk it stays where it is and shuffles its feet instead.
  function walker(s, m, minX, maxX, ground, animate) {
    const snap = (v) => Math.round(v / s.step) * s.step;
    const still = maxX - minX < s.width;
    const st = { x: snap((minX + maxX) / 2 - s.width / 2), frame: 0, look: 1, blink: false, dir: 1, target: null, shuffle: 0 };
    const show = () =>
      s.set({ x: st.x, y: ground - s.height - (m.float && st.frame ? s.step / 2 : 0), frame: st.frame, look: st.look, blink: st.blink, flip: m.flip && st.dir < 0 });
    show();
    if (!animate) return;
    function step() {
      if (!s.node.isConnected) return;
      let delay;
      if (st.shuffle) {
        st.frame ^= 1;
        st.shuffle--;
        delay = 240;
      } else if (st.target != null) {
        st.x += st.dir * PX;
        st.frame ^= 1;
        if (st.dir * (st.target - st.x) <= 0) [st.target, st.frame] = [null, 0];
        delay = m.float ? 260 : 200;
      } else if (st.blink) {
        st.blink = false;
        delay = 900 + Math.random() * 2400;
      } else {
        const r = Math.random();
        if (r < 0.3) [st.blink, delay] = [true, 150];
        else if (r < 0.62) [st.look, delay] = [-st.look, 700 + Math.random() * 1800];
        else if (still) [st.shuffle, delay] = [6, 240];
        else {
          const lo = minX - s.width / 2, hi = maxX - s.width / 2;
          st.target = snap(clamp(st.x + (Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 180), lo, hi));
          if (Math.abs(st.target - st.x) < PX * 4) st.target = snap(st.x < (lo + hi) / 2 ? hi : lo);
          st.dir = st.target > st.x ? 1 : -1;
          st.look = st.dir;
          delay = 300;
        }
      }
      show();
      setTimeout(step, delay);
    }
    setTimeout(step, 1500);
  }

  // A mascot standing still, for the picker on the settings page.
  function mascotIcon(svg, id) {
    const m = mascotById(id);
    svg.setAttribute("viewBox", `-6 -6 ${16 * PX + 12} ${m.a.length * PX + 12}`);
    sprite(svg, m).set({ x: 0, y: 0 });
  }

  // ---------- the fetch family ----------
  // The system the way neofetch and its descendants print it. The mascot lives in each of them.

  const host = () => [["tm-p", "kraken"], ["", "@"], ["tm-p", "dial"]];
  const limitText = (v) => (v.value === "—" ? "—" : `${v.value}%`);
  const limitClass = (v) => (v.dim ? "tm-d" : v.hot ? "tm-w" : "");
  const memFrac = (r) => (r.used != null && r.total ? r.used / r.total : null);
  const memText = (r) => `${r.used == null ? "—" : dec(r.used / 1024)}/${r.total == null ? "—" : Math.round(r.total / 1024)}G`;
  const noteSpans = (d) => [[d.meta.state === "error" ? "tm-w" : "tm-d", d.meta.text]];
  // "AMD Ryzen 7 5800X3D 8-Core Processor" → "Ryzen 7 5800X3D", "NVIDIA GeForce RTX 4070 SUPER" → "RTX 4070 SUPER"
  const model = (name, fallback) =>
    (name || "")
      .replace(/\((R|TM)\)|[®™]|@.*$/gi, " ")
      .replace(/\b(AMD|Intel|NVIDIA|GeForce|Core|Processor|CPU|Graphics|\d+(st|nd|rd|th) Gen|\d+-Core)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim() || fallback;

  // neofetch: the system as key: value lines, large, and a mascot wandering along the bottom
  // under the text. The limits and the cost follow the hardware when there are any, and the
  // block stays centred above the mascot.
  function sceneNeofetch(p, layer, env) {
    const S = 26, x = 136, n = env.limits.length;
    const note = env.status ? term(p, C, 80, 15, "middle") : null;
    // six lines of hardware, the limits after a gap, then the cost
    const at = [0, 31, 62, 93, 124, 155, ...env.limits.map((_, i) => 192 + i * 31), ...(env.cost ? [n ? 192 + n * 31 : 186] : [])];
    const y0 = Math.round(283 - (at[at.length - 1] - 58) / 2);
    setSpans(term(p, x, y0 - 58, S), host());
    setSpans(term(p, x, y0 - 34, S), [["", "-".repeat(10)]]);
    const L = at.map((dy) => term(p, x, y0 + dy, S));
    const gauges = env.limits.map((_, i) => limitBar(p, x, y0 + at[6 + i], S, 16, 10));
    const cost = env.cost ? L[L.length - 1] : null;
    const m = mascotById(env.mascot);
    walker(sprite(p, m), m, 206, 434, 560, env.animate);
    const kv = (k, v, cls = "") => [["tm-p", `${k}: `], [cls, v]];
    return [
      (d) => {
        const hw = d.hw, r = ram(hw);
        for (const [i, key] of [[0, "cpu"], [1, "gpu"]]) {
          const h = hw[key];
          setSpans(L[i], kv(key.toUpperCase(), `${int(h.temp)}°C · ${h.load == null ? "—" : Math.round(h.load * 100)}% · ${int(h.power)} W`, isHot(h, key) ? "tm-w" : ""));
        }
        setSpans(L[2], kv("Liquid", `${dec(hw.liquid)}°C`));
        setSpans(L[3], kv("Power", `${int(power(hw))} W`));
        setSpans(L[4], kv("Memory", `${r.used == null ? "—" : Math.round(r.used)}MiB / ${r.total == null ? "—" : Math.round(r.total)}MiB`));
        setSpans(L[5], kv("Time", hhmmss(d.now)));
        env.limits.forEach((def, i) => {
          const v = d.views[def.key];
          setSpans(L[6 + i], [["tm-p", `${`${def.name}:`.padEnd(10)} `], [v.dim ? "tm-d" : v.hot ? "tm-w" : "", pctText(v).trim().padEnd(5)], track(10)]);
          gauges[i](v);
        });
        if (cost) setSpans(cost, [["tm-p", "Cost: "], ...costSpans(d.cost)]);
        if (note) setSpans(note, [[d.meta.state === "error" ? "tm-w" : "tm-d", d.meta.text]]);
      },
    ];
  }

  // Aligned key, then a bar: the rows of fastfetch and macchina. rows are [what, y], what being
  // "cpu", "gpu", "liquid", "memory", "power", a limit or "cost".
  function fetchRows(p, x, rows, S, n, full, empty) {
    const key = (k) => ["tm-p", k.padEnd(10)];
    const L = rows.map(([, y]) => term(p, x, y, S));
    const ups = rows.map(([what, y], i) => {
      const line = L[i];
      if (what === "cost") return (d) => setSpans(line, [key("Cost"), ...costSpans(d.cost)]);
      if (typeof what === "object") {
        const gauge = limitBar(p, x, y, S, 10, n, full);
        return (d) => {
          const v = d.views[what.key];
          setSpans(line, [key(what.name), track(n, empty), [limitClass(v), ` ${limitText(v).padStart(4)}`]]);
          gauge(v);
        };
      }
      const bar = fracBar(p, x, y, S, 10, n, full);
      if (what === "cpu" || what === "gpu")
        return (d) => {
          const h = d.hw[what], temp = `${int(h.temp)}°`, hot = isHot(h, what) ? "tm-w" : "";
          // the bar's own value follows it, then the other one
          const values = d.bars === "temp" ? [[hot, ` ${temp.padStart(4)}`], ["", ` ${loadText(h)}`]] : [["", ` ${loadText(h).padStart(4)}`], [hot, ` ${temp}`]];
          setSpans(line, [key(what.toUpperCase()), track(n, empty), ...values]);
          bar(hwFrac(h, d));
        };
      if (what === "liquid")
        return (d) => {
          setSpans(line, [key("Liquid"), track(n, empty), ["", ` ${dec(d.hw.liquid)}°C`]]);
          bar(d.hw.liquid == null ? null : (d.hw.liquid - 20) / 30);
        };
      if (what === "memory")
        return (d) => {
          setSpans(line, [key("Memory"), track(n, empty), ["", ` ${memText(ram(d.hw))}`]]);
          bar(memFrac(ram(d.hw)));
        };
      return (d) => {
        const pw = power(d.hw);
        setSpans(line, [key("Power"), track(n, empty), ["", ` ${int(pw)} W`]]);
        bar(pw == null ? null : pw / 600);
      };
    });
    return (d) => ups.forEach((u) => u(d));
  }
  const HW_ROWS = ["cpu", "gpu", "liquid", "memory", "power"];

  // fastfetch: the mascot as an ASCII-art logo on the left, the system beside it with bars: the
  // hardware, the time after a gap, the limits after another, then the cost, centred.
  function sceneFastfetch(p, layer, env) {
    const S = 20, x = 272, n = env.limits.length;
    const m = mascotById(env.mascot);
    const logo = asciiSprite(p, m, 10);
    walker(logo, m, 164, 164, 314 + logo.height / 2, env.animate);
    const note = env.status ? term(p, C, 92, 15, "middle") : null;
    // more rows sit a little tighter
    const s = 5 + n + (env.cost ? 1 : 0) > 8 ? 30 : 32, g = s === 30 ? 34 : 37;
    const time = 4 * s + g;
    const at = [0, s, 2 * s, 3 * s, 4 * s, ...env.limits.map((_, i) => time + g + i * s)];
    if (env.cost) at.push(n ? at[at.length - 1] + s : time + s);
    const y0 = Math.round(313 - (Math.max(time, at[at.length - 1]) - 60) / 2);
    setSpans(term(p, x, y0 - 60, S), host());
    setSpans(term(p, x, y0 - 36, S), [["", "-".repeat(10)]]);
    const what = [...HW_ROWS, ...env.limits, ...(env.cost ? ["cost"] : [])];
    const rows = fetchRows(p, x, what.map((w, i) => [w, y0 + at[i]]), S, 7, "■", "■");
    const clock = term(p, x, y0 + time, S);
    return [
      (d) => {
        rows(d);
        setSpans(clock, [["tm-p", "Time".padEnd(10)], ["", hhmmss(d.now)]]);
        if (note) setSpans(note, noteSpans(d));
      },
    ];
  }

  // pfetch: short lines, very large, under a mascot sitting by the name and the time.
  // The bars of CPU and GPU are their load or temperature, as set, with its value before the bar
  // and their power after it (with the load, the name turns red when it runs hot); the power
  // line is the whole set, with a bar to 600 W. The limits have the time to their reset in the
  // same place; the lines are 25 characters at most and centred so that 2d13h stays off the rim.
  function scenePfetch(p, layer, env) {
    const S = 32, n = 7, cw = advance(p, S), x = C - 12.5 * cw;
    const m = mascotById(env.mascot);
    walker(sprite(p, m, 6), m, 229, 229, 164, env.animate);
    setSpans(term(p, 295, 124, 26), host());
    const clock = term(p, 295, 162, S);
    // five lines of hardware, a line per limit, the cost; centred below the middle, clear of the header
    const rows = 5 + env.limits.length + (env.cost ? 1 : 0);
    const Y = Array.from({ length: rows }, (_, i) => Math.round(372 - (rows - 1) * 18.5 + i * 37));
    const L = Y.map((y) => term(p, x, y, S));
    const bars = Y.slice(0, 3).map((y) => fracBar(p, x, y, S, 12, n, "■"));
    const gauges = env.limits.map((_, i) => limitBar(p, x, Y[5 + i], S, 12, n, "■"));
    const note = env.status ? term(p, C, Y[rows - 1] + 42, 15, "middle") : null;
    const key = (k) => ["tm-p", k.padEnd(7)];
    return [
      (d) => {
        const hw = d.hw, pw = power(hw);
        for (const [i, k] of [[0, "cpu"], [1, "gpu"]]) {
          const h = hw[k], hot = isHot(h, k) ? "tm-w" : "", temp = d.bars === "temp";
          const value = temp ? [hot, `${int(h.temp)}°`.padEnd(5)] : ["", loadText(h).padEnd(5)];
          setSpans(L[i], [temp || !hot ? key(k) : [hot, k.padEnd(7)], value, track(n, "■"), ["", ` ${int(h.power)}W`]]);
          bars[i](hwFrac(h, d));
        }
        setSpans(L[2], [key("power"), ["", `${int(pw)}W`.padEnd(5)], track(n, "■")]);
        bars[2](pw == null ? null : pw / 600);
        setSpans(L[3], [key("liquid"), ["", `${dec(hw.liquid)}°`]]);
        setSpans(L[4], [key("memory"), ["", memText(ram(hw))]]);
        env.limits.forEach((def, i) => {
          const v = d.views[def.key];
          const until = v.resetsAt > d.now ? ` ${durShort(v.resetsAt - d.now)}` : "";
          setSpans(L[5 + i], [key(def.brief), [limitClass(v), limitText(v).padEnd(5)], track(n, "■"), [limitClass(v), until]]);
          gauges[i](v);
        });
        if (env.cost) setSpans(L[rows - 1], [key("cost"), ...costSpans(d.cost)]);
        setSpans(clock, [["tm-t", hhmmss(d.now)]]);
        if (note) setSpans(note, noteSpans(d));
      },
    ];
  }

  // macchina: dot bars for everything in a rounded frame, its name and the time set into the
  // bottom edge; the mascot walks along the top edge. The limits and the cost go under a rule,
  // when there are any, and the frame is as tall as its rows, centred.
  function sceneMacchina(p, layer, env) {
    const S = 20, cw = advance(p, S), f = (v) => v.toFixed(1);
    const what = [...HW_ROWS, ...env.limits, ...(env.cost ? ["cost"] : [])];
    const at = what.map((_, i) => (i < 5 ? i * 29 : 164 + (i - 5) * 29));
    const Y = at.map((dy) => Math.round(355 - at[at.length - 1] / 2) + dy);
    const x0 = 108, x1 = 532, y0 = Y[0] - 31, y1 = Y[Y.length - 1] + 21, r = 12, gap = (23 * cw) / 2 + 4;
    el(p, "path", {
      class: "tm-box",
      d: `M${f(C - gap)} ${y1}H${x0 + r}Q${x0} ${y1} ${x0} ${y1 - r}V${y0 + r}Q${x0} ${y0} ${x0 + r} ${y0}` +
        `H${x1 - r}Q${x1} ${y0} ${x1} ${y0 + r}V${y1 - r}Q${x1} ${y1} ${x1 - r} ${y1}H${f(C + gap)}`,
    });
    if (what.length > 5) el(p, "path", { class: "tm-box", d: `M${x0} ${Y[5] - 27}H${x1}` });
    const m = mascotById(env.mascot);
    walker(sprite(p, m), m, 190, 450, y0 - 1, env.animate);
    const rows = fetchRows(p, x0 + 1.5 * cw, what.map((w, i) => [w, Y[i]]), S, 12, "●", "○");
    const title = term(p, C, y1 + S * 0.32, S, "middle");
    const note = env.status ? term(p, C, y1 + 44, 15, "middle") : null;
    return [
      (d) => {
        rows(d);
        setSpans(title, [["", " "], ...host(), ["tm-d", ` · ${hhmmss(d.now)} `]]);
        if (note) setSpans(note, noteSpans(d));
      },
    ];
  }

  // cpufetch: CPU and GPU as chips with the temperature on the die and the model, a bar of the
  // load or the temperature (as set) and the power below; the limits under them, and with fewer
  // of them the whole picture moves down to stay centred. The mascot walks across the tips of the pins.
  function sceneCpufetch(p, layer, env) {
    const n = env.limits.length;
    const sysAt = n ? 450 + (n - 1) * 29 + 36 : 444, dy = Math.round((544 - sysAt) / 2);
    const W = 128, H = 118, top = 226 + dy, bottom = top + H, f = (v) => v.toFixed(1);
    const m = mascotById(env.mascot);
    walker(sprite(p, m), m, 196, 444, top - 12, env.animate);
    const note = env.status ? term(p, C, 94, 14, "middle") : null;
    const chips = ["cpu", "gpu"].map((k, i) => {
      const cx = C + (i ? 1 : -1) * (W / 2 + 20), x0 = cx - W / 2, x1 = cx + W / 2;
      let pins = "";
      for (let j = 0; j < 7; j++) {
        const px = f(x0 + 16 + (j * (W - 32)) / 6), py = f(top + 14 + (j * (H - 28)) / 6);
        pins += `M${px} ${top - 12}V${top}M${px} ${bottom}v12M${x0 - 10} ${py}H${x0}M${x1} ${py}h10`;
      }
      el(p, "path", { d: pins, class: "nf-pin" });
      el(p, "rect", { x: x0, y: top, width: W, height: H, rx: 8, class: "nf-chip" });
      const die = el(p, "rect", { x: x0 + 16, y: top + 16, width: W - 32, height: H - 32, rx: 4, class: "nf-die" });
      el(p, "circle", { cx: x0 + 9, cy: top + 9, r: 2.5, class: "nf-dot" });
      setSpans(term(p, cx, top + 37, 14, "middle"), [["tm-k", k.toUpperCase()]]);
      // the load line is 18 characters, centred under the chip
      const lx = cx - 9 * advance(p, 15), load = term(p, lx, bottom + 63, 15);
      return { k, die, temp: term(p, cx, top + 82, 38, "middle"), name: term(p, cx, bottom + 38, 15, "middle"), load, bar: fracBar(p, lx, bottom + 63, 15, 0, 7, "■") };
    });
    const S = 20, x = C - 12.5 * advance(p, S), Y = env.limits.map((_, i) => 450 + dy + i * 29);
    const L = Y.map((y) => term(p, x, y, S));
    const gauges = Y.map((y) => limitBar(p, x, y, S, 10, 10, "■"));
    const sys = term(p, C, sysAt + dy, 15, "middle");
    return [
      (d) => {
        const hw = d.hw;
        for (const c of chips) {
          const h = hw[c.k], hot = isHot(h, c.k);
          c.die.classList.toggle("is-hot", hot);
          setSpans(c.temp, [[hot ? "tm-w" : "tm-t", `${int(h.temp)}°`]]);
          setSpans(c.name, [["tm-k", fit(model(h.name, c.k.toUpperCase()), 17)]]);
          const value = d.bars === "temp" ? [hot ? "tm-w" : "", ` ${`${int(h.temp)}°`.padStart(4)}`] : ["", ` ${loadText(h).padStart(4)}`];
          setSpans(c.load, [track(7, "■"), value, ["tm-d", ` ${int(h.power)} W`.padEnd(6)]]);
          c.bar(hwFrac(h, d));
        }
        env.limits.forEach((def, i) => {
          const v = d.views[def.key];
          setSpans(L[i], [["tm-p", def.name.padEnd(10)], track(10, "■"), [limitClass(v), ` ${limitText(v).padStart(4)}`]]);
          gauges[i](v);
        });
        const last = d.cost ? [["tm-k", `  ${d.cost.short} `], [d.cost.dim ? "tm-d" : "", d.cost.value]] : [["tm-k", "  power "], ["", `${int(power(hw))} W`]];
        setSpans(sys, [["tm-k", "liquid "], ["", `${dec(hw.liquid)}°C`], ["tm-k", "  mem "], ["", memText(ram(hw))], ...last]);
        if (note) setSpans(note, noteSpans(d));
      },
    ];
  }

  // The time, large; limits above it, hardware below, a seconds marker running round the rim.
  // With no limits the time moves up into their room.
  function sceneClock(p, layer, env) {
    const n = env.limits.length, dy = n ? 0 : -40;
    const up = n ? [unitHead(p, C, 102)] : [];
    env.limits.forEach((def, i) => {
      const x = spread(n, i, C, 104);
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
    const time = el(p, "text", { x: C, y: 348 + dy, "text-anchor": "middle", class: "n t-big", "font-size": 164 });
    const date = el(p, "text", { x: C, y: 400 + dy, "text-anchor": "middle", class: "t-date" });
    const sec = el(p, "line", { x1: C, y1: C - 298, x2: C, y2: C - 314, class: "sec-now" });
    up.push((d) => {
      const t = new Date(d.now);
      setText(time, hhmm(d.now));
      setText(date, dateText(d.now, "date"));
      setAttr(sec, "transform", `rotate(${t.getSeconds() * 6} ${C} ${C})`);
    });
    up.push(statBlock(p, "CPU", 194, 492 + dy, 30, readTemp("cpu"), "t-lbl-xs"));
    up.push(statBlock(p, "GPU", 278, 492 + dy, 30, readTemp("gpu"), "t-lbl-xs"));
    up.push(statBlock(p, t("lbl.liquid"), 362, 492 + dy, 30, readLiquid, "t-lbl-xs"));
    up.push(statBlock(p, t("lbl.power"), 446, 492 + dy, 30, readPower, "t-lbl-xs"));
    // the date is already under the time, so without a source there is no footer
    if (env.status) up.push(meta(p, 550));
    return up;
  }

  // One huge value at a time; the rim gauge and the dots follow the carousel. With no limits the
  // memory takes a turn too.
  function sceneOne(p, layer, env) {
    const pct = (f) => [f == null ? "—" : `${Math.round(f * 100)}`, "%", 0.41];
    const items = [
      ...env.limits.map((def) => ({ label: def.label, limit: def.key })),
      { label: "CPU", temp: "cpu" },
      { label: "GPU", temp: "gpu" },
      { label: t("lbl.liquid"), read: readLiquid, gauge: (d) => scale(d.hw.liquid, 20, 50) },
      { label: t("lbl.power"), read: readPower, gauge: (d) => scale(power(d.hw), 0, 600), sub: (d) => `CPU ${int(d.hw.cpu.power)} W · GPU ${int(d.hw.gpu.power)} W` },
      ...(env.limits.length ? [] : [{ label: t("lbl.ram"), read: (d) => pct(memFrac(ram(d.hw))), gauge: (d) => (memFrac(ram(d.hw)) ?? 0) * 100, sub: (d) => ramText(ram(d.hw)) }]),
      ...(env.cost ? [{ label: t("lbl.cost"), cost: true }] : []),
    ];
    const up = [clock(p, 108)];
    const groups = items.map((it) => {
      const g = layer();
      g.classList.add("is-off");
      // the cost has no scale to fill, so no gauge either
      const arc = it.cost ? null : arcGauge(g, 284, -135, 135, 14);
      if (it.temp) arc.notch.classList.add("is-peak");
      const lbl = el(g, "text", { x: C, y: 196, "text-anchor": "middle", class: "t-lbl" }, it.label);
      const unit = it.limit || it.cost ? el(lbl, "tspan", { class: "t-unit" }) : null;
      const val = num(g, it.temp || it.read === readLiquid ? C + 16 : C, it.cost ? 366 : 384, it.cost ? 140 : 196);
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
          setText(sub, t("sub.load", { v: h.load == null ? "—" : Math.round(h.load * 100), w: int(h.power) }));
        } else if (it.cost) {
          // the amount for the chosen period, two of the others under it
          setText(unit, ` · ${d.cost.short.toUpperCase()}`);
          setText(val, d.cost.value);
          val.classList.toggle("is-dim", d.cost.dim);
          const others = COSTS.filter((c) => c.id !== "off" && c.short !== d.cost.short).slice(0, 2);
          setText(sub, others.map((c) => `${c.short} ${money(d.costs && d.costs[c.id])}`).join(" · "));
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
    up.push(footer(p, 552, env));
    return up;
  }

  const SCENES = {
    limits: sceneLimits,
    hardware: sceneHardware,
    cockpit: sceneCockpit,
    chronograph: sceneChronograph,
    columns: sceneColumns,
    terminal: sceneTerminal,
    htop: sceneHtop,
    btop: sceneBtop,
    neofetch: sceneNeofetch,
    fastfetch: sceneFastfetch,
    pfetch: scenePfetch,
    macchina: sceneMacchina,
    cpufetch: sceneCpufetch,
    clock: sceneClock,
    one: sceneOne,
    // a face made in the editor, drawn by faces.js
    face: (p, layer, env) => (window.KrakenFaces ? window.KrakenFaces.build(p, env.face, env) : []),
  };
  // Ids from older versions, which named things in Polish.
  const LEGACY = {
    rotacja: "rotation", adaptacyjny: "adaptive", kokpit: "cockpit", fixed: "cockpit", pierscienie: "cockpit",
    chronograf: "chronograph", slupki: "columns", zegar: "clock", jedna: "one", limity: "limits", work: "limits",
    sprzet: "hardware", game: "hardware",
    porcelana: "porcelain", mroz: "frost", indygo: "indigo", grafit: "graphite",
    ciecz: "liquid", fale: "ripples", babelki: "bubbles", zorza: "aurora", obieg: "flow", mglawica: "nebula",
    gwiazdy: "stars", linie: "silk", topografia: "contours", wir: "vortex", plaster: "honeycomb", siatka: "grid",
    kod: "rain", brak: "none",
  };
  const isFace = (l) => /^face:[a-z0-9-]+$/.test(l || "");
  function normLayout(l, face) {
    if (isFace(l) || l === "face") return face ? "face" : "cockpit";
    const id = LEGACY[l] || l;
    return LAYOUTS.some((x) => x.id === id) ? id : "cockpit";
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

    let layout = null, theme = null, bgType = null, left = true, mascot = null, cost = null, bars = "load";
    let face = null, faceKey = null, builtLang = null;
    // the limits switched on, and what of them and of the cost there is to show; see update()
    let on = limitIds(), shown = { limits: [], cost: false }, shownKey = "";
    let scenes = {}, updaters = [];
    // Every scene is its own <svg>, so switching between them is a composited fade, not a repaint.
    const layer = () => el(root, "svg", { viewBox: "0 0 640 640", class: "scene" });

    function buildLayout() {
      for (const n of root.querySelectorAll("svg.scene")) n.remove();
      const both = layout === "rotation" || layout === "adaptive";
      // the layouts made of limits are the hardware alone while there are none to show
      const names = !shown.limits.length && LAYOUTS.find((x) => x.id === layout)?.needsLimits ? ["hardware"] : both ? ["limits", "hardware"] : [layout];
      const env = { animate, mascot, face, limits: shown.limits, cost: shown.cost, status: shown.limits.length > 0 || shown.cost };
      scenes = {};
      updaters = [];
      for (const name of names) {
        scenes[name] = layer();
        updaters = updaters.concat(SCENES[name](scenes[name], layer, env));
      }
      builtLang = I18N.lang;
    }

    function configure(next) {
      // the page usually sets the language for all its dials; a dial follows it either way
      if (next.lang) I18N.use(next.lang);
      const l = normLayout(next.layout, next.face);
      const th = LEGACY[next.theme] || next.theme;
      const tm = THEMES.some((x) => x.id === th) ? th : "ice";
      const bg = LEGACY[next.bg] || next.bg;
      const b = validBg(bg) ? bg : "liquid";
      left = next.units !== "used";
      bars = next.bars === "temp" ? "temp" : "load";
      back.fps(next.fps);
      back.look(next.look);
      const m = mascotById(next.mascot).id;
      const c = COSTS.some((x) => x.id === next.cost) ? next.cost : COSTS[0].id;
      on = limitIds(next.limits);
      const themed = tm !== theme;
      if (themed) {
        root.className = `kd th-${(theme = tm)}`;
        // pixel art needs to know which way "dark" goes
        const lo = getComputedStyle(root).getPropertyValue("--bg-lo").trim();
        const rgb = lo.length >= 7 ? [1, 3, 5].map((i) => parseInt(lo.slice(i, i + 2), 16)) : [0, 0, 0];
        root.classList.toggle("is-dark", 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2] < 128);
      }
      if (themed || b !== bgType) back.set((bgType = b), animate);
      // untouched media gets a halo behind the text instead of a dimmed picture
      root.classList.toggle("is-raw", next.look === "raw" && /^media:/.test(b));
      // another language lays the layout out again, for the labels, and so does any change to a
      // face; limits and the cost coming or going do too, in update()
      const fk = l === "face" ? JSON.stringify(next.face) : null;
      const withMascot = l === "face" || LAYOUTS.find((x) => x.id === l).mascot;
      if (l !== layout || (m !== mascot && withMascot) || fk !== faceKey || builtLang !== I18N.lang) {
        [layout, mascot, cost, faceKey, face] = [l, m, c, fk, l === "face" ? next.face : null];
        buildLayout();
      }
      [mascot, cost] = [m, c];
    }

    configure(cfg);

    // camless mode: under camless, the background goes to camless once, as a loop it plays
    // itself (bg.js bake()), and the dial is drawn on nothing, so the browser repaints only when
    // the numbers change. Off, or under CAM, the dial draws its own background.
    const bridge = window.nzxt && window.nzxt.v1 && window.nzxt.v1.camless;
    let camless = false, handed = null, failed = null, busy = false, rate = 1, sentRate = NaN;
    function bare(on) {
      root.classList.toggle("is-bare", on);
      if (on) back.pause();
      else if (animate) back.play();
    }
    function sendRate() {
      if (!handed || !back.paced() || Math.abs(rate - sentRate) < 0.05) return;
      sentRate = rate;
      bridge.background.speed(rate).catch(() => {});
    }
    // Brings camless in line with the setting and the background, one bake at a time.
    async function handOver() {
      if (busy || !bridge) return;
      busy = true;
      try {
        for (;;) {
          const want = camless ? back.key() : null;
          if (want === handed || (want && want === failed)) return;
          // the dial's own background shows while a new one bakes
          bare(false);
          handed = null;
          if (!want) return await bridge.background.clear();
          const done = await back.bake(bridge.background, () => camless && back.key() === want).catch((e) => {
            console.warn(`camless mode: ${e.message}`);
            return false;
          });
          if (done) {
            [handed, sentRate] = [want, NaN];
            bare(true);
            sendRate();
          } else {
            if (camless && back.key() === want) failed = want;
            await bridge.background.clear();
          }
        }
      } catch (e) {
        console.warn(`camless mode: ${e.message}`);
      } finally {
        busy = false;
      }
    }

    return {
      configure,
      setActivity(load) {
        rate = 1 + 2.2 * clamp(load || 0, 0, 1);
        back.speed(rate);
        sendRate();
      },
      camless(on) {
        camless = !!on && !!bridge;
        handOver();
      },
      update(data) {
        const now = data.now ?? Date.now();
        const interval = data.interval ?? 60e3;
        const views = {};
        for (const def of LIMITS) views[def.key] = limitView((data.limits || {})[def.key], now, interval, left);
        // which limits, and whether a cost: what is switched on of what the usage source sends
        const lim = shownLimits(data.limits, on);
        const withCost = cost !== "off" && !!data.costs && typeof data.costs === "object";
        const key = `${lim.map((def) => def.key)}|${withCost}`;
        if (key !== shownKey) {
          [shown, shownKey] = [{ limits: lim, cost: withCost }, key];
          buildLayout();
        }
        const cv = withCost ? costView(data.costs, cost, now) : null;
        const d = { now, hw: data.hw || emptyHw(), views, left, bars, unitWord: t(left ? "unit.left" : "unit.used"), meta: metaView(data.limits, now, interval, data.costs), cost: cv, costs: data.costs };
        let active = Object.keys(scenes);
        if (scenes.limits && scenes.hardware) {
          if (layout === "rotation") active = [Math.floor(now / ROTATE_MS) % 2 ? "hardware" : "limits"];
          if (layout === "adaptive") active = [data.mode === "game" ? "hardware" : "limits"];
        }
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

  // The parts the layouts are drawn with, for faces.js to build faces from.
  const kit = {
    C, HOT, el, clamp, polar, arcD, hhmm, hhmmss, dateText, dur, durShort, dec, int, scale, tempF, power, isHot,
    setText, setAttr, setParts, setSpans, setNum, num, gauge, arcGauge, barGauge, columnGauge, limitGauge, tempGauge,
    limitSpan, ticks, pie, meta, term, advance, track, limitBar, fracBar, braille, sprite, asciiSprite, walker,
    mascotById, money, loadText, memFrac, LIMITS, COSTS,
  };

  window.KrakenDial = { create, background, mascotIcon, money, errText, shownLimits, limitIds, LAYOUTS, THEMES, BGS, MASCOTS, LIMITS, COSTS, LEGACY, isFace, emptyHw, kit };
})();
