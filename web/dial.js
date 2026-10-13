// Kraken Elite LCD dial (640×640, round). SVG + a small canvas, no dependencies.
// CAM renders web integrations without a GPU, so everything here keeps the CPU idle: the
// background is a low-res canvas drawn at a modest frame rate, scenes are separate layers so
// fades are composited, and the DOM is only touched when a value really changes.
//   const dial = KrakenDial.create(container, { layout, theme, bg });
//   dial.update({ now, hw, limits, interval, mode });  // call about once a second
//   dial.configure({ layout, theme, bg, fps });        // switch variant live
//   dial.setActivity(gpuLoad);                         // 0..1, speeds the background up under load
(function () {
  const NS = "http://www.w3.org/2000/svg";
  const C = 320;
  const STALE_MS = 5 * 60e3;
  const ROTATE_MS = 12e3;
  const CAROUSEL_MS = 6e3;
  const HOT = { cpu: 85, gpu: 80 };
  const DAYS = ["nd", "pn", "wt", "śr", "cz", "pt", "sb"];

  const LAYOUTS = [
    { id: "rotacja", name: "Rotacja", desc: "Limity i sprzęt na zmianę co 12 s." },
    { id: "adaptacyjny", name: "Adaptacyjny", desc: "Limity, a gdy grasz, sprzęt." },
    { id: "pierscienie", name: "Pierścienie", desc: "Wszystko naraz: limity jako pierścienie." },
    { id: "jedna", name: "Jedna liczba", desc: "Jedna wielka wartość, kolejna co 6 s." },
    { id: "limity", name: "Tylko limity", desc: "Claude 5h, Claude 7d i Codex." },
    { id: "sprzet", name: "Tylko sprzęt", desc: "CPU, GPU, ciecz i moc." },
  ];
  const THEMES = [
    { id: "ice", name: "Lód" },
    { id: "deep", name: "Głębia" },
    { id: "blue", name: "Błękit" },
    { id: "night", name: "Noc" },
  ];
  const BGS = [
    { id: "ciecz", name: "Ciecz" },
    { id: "fale", name: "Fale" },
    { id: "babelki", name: "Bąbelki" },
    { id: "zorza", name: "Zorza" },
    { id: "obieg", name: "Obieg" },
    { id: "brak", name: "Bez tła" },
  ];
  const LIMITS = [
    { key: "claude5h", label: "CLAUDE · 5H", short: "CLAUDE 5H", tiny: "5H" },
    { key: "claude7d", label: "CLAUDE · 7D", short: "CLAUDE 7D", tiny: "7D" },
    { key: "codex7d", label: "CODEX · 7D", short: "CODEX 7D", tiny: "CODEX" },
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
  const dec = (v, d = 1) => (v == null ? "—" : v.toFixed(d).replace(".", ","));
  const int = (v) => (v == null ? "—" : `${Math.round(v)}`);
  const scale = (v, lo, hi) => clamp(((v ?? lo) - lo) / (hi - lo), 0, 1) * 100;
  const tempF = (t) => scale(t, 20, 100);
  const power = (hw) => (hw.cpu.power == null && hw.gpu.power == null ? null : (hw.cpu.power ?? 0) + (hw.gpu.power ?? 0));

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

  function limitView(l, now, interval) {
    const staleAfter = Math.max(STALE_MS, 3 * interval);
    if (!l || l.pct == null) {
      const sub = l && l.error ? [{ t: l.error, warn: true }] : [{ t: "czekam na dane" }];
      return { state: l && l.error ? "error" : "none", pct: 0, pace: null, value: "—", dim: true, sub };
    }
    const age = now - l.fetchedAt;
    const pace = l.windowMs && l.resetsAt ? clamp(100 * (1 - (l.resetsAt - now) / l.windowMs), 0, 100) : null;
    const base = { pct: clamp(l.pct, 0, 100), pace, value: `${Math.round(l.pct)}`, dim: false, state: "ok" };
    if (l.resetsAt && now >= l.resetsAt) {
      return { ...base, state: "reset", pct: 0, pace: 0, value: "0", dim: true, sub: [{ t: "po resecie" }] };
    }
    if (age > staleAfter) {
      return { ...base, state: l.error ? "error" : "stale", dim: true, sub: [{ t: `sprzed ${dur(age)}` }] };
    }
    if (!l.resetsAt) return { ...base, sub: [{ t: "okno nie ruszyło" }] };
    if (l.pct >= 100) return { ...base, hot: true, sub: [{ t: `limit · reset ${when(l.resetsAt, now)}`, warn: true }] };
    if (l.burnAt && l.burnAt < l.resetsAt) return { ...base, hot: true, sub: [{ t: `koniec za ${dur(l.burnAt - now)}`, warn: true }] };
    return { ...base, sub: [{ t: `reset ${when(l.resetsAt, now)}` }] };
  }

  // The quiet status line: when limits were last fetched and how often, or what is failing.
  function metaView(limits, now, interval) {
    const entries = Object.entries(limits || {}).filter(([, l]) => l);
    const failing = entries.find(([, l]) => l.error);
    const last = Math.max(0, ...entries.map(([, l]) => l.fetchedAt || 0));
    if (failing) {
      const who = failing[0].startsWith("claude") ? "Claude" : "Codex";
      const retry = failing[1].nextAt > now ? ` · próba ${hhmm(failing[1].nextAt)}` : "";
      return { state: "error", frac: 1, last, text: `${who}: ${failing[1].error}${retry}` };
    }
    if (!last) return { state: "stale", frac: 0, last, text: "czekam na dane" };
    // The real cadence: the service stretches it when a provider asks us to slow down.
    const cadence = Math.max(interval, ...entries.map(([, l]) => (l.fetchedAt && l.nextAt > l.fetchedAt ? l.nextAt - l.fetchedAt : 0)));
    const age = now - last;
    const stale = age > Math.max(STALE_MS, 3 * cadence);
    return { state: stale ? "stale" : "ok", frac: clamp(age / cadence, 0, 1), last, text: `dane ${hhmmss(last)} · co ${every(cadence)}` };
  }

  // ---------- primitives ----------

  // Any path drawn with pathLength=100 (arc or bar). fill covers [0, min(f, overFrom)],
  // the second colour covers [overFrom, f], the notch marks a reference such as the pace.
  function gauge(parent, geo, width, notchStyle = "full") {
    const g = el(parent, "g", { class: "gauge" });
    const common = { d: geo.d, "stroke-width": width, pathLength: 100 };
    el(g, "path", { ...common, class: "g-track" });
    const fill = el(g, "path", { ...common, class: "g-fill", "stroke-dasharray": "0 200" });
    const over = el(g, "path", { ...common, class: "g-over", "stroke-dasharray": "0 0 0 200" });
    const notch = el(g, "g", { class: "notch" });
    const h = width / 2;
    const t = Math.max(6, width * 0.6);
    if (geo.kind === "arc") {
      const r = geo.r;
      if (notchStyle === "full") el(notch, "path", { d: `M${C - t} ${C - (r + h + 4 + t * 1.3)}L${C + t} ${C - (r + h + 4 + t * 1.3)}L${C} ${C - (r + h + 3)}Z` });
      el(notch, "line", { x1: C, x2: C, y1: C - (r - h - 2), y2: C - (r + h + 2) });
    } else {
      el(notch, "path", { d: `M${-t} ${geo.y - h - 4 - t * 1.3}L${t} ${geo.y - h - 4 - t * 1.3}L0 ${geo.y - h - 3}Z` });
      el(notch, "line", { x1: 0, x2: 0, y1: geo.y - h - 2, y2: geo.y + h + 2 });
    }
    const place = (f) =>
      geo.kind === "arc"
        ? `rotate(${(geo.a0 + ((geo.a1 - geo.a0) * f) / 100).toFixed(2)}deg)`
        : `translate(${(geo.x0 + ((geo.x1 - geo.x0) * f) / 100).toFixed(1)}px, 0px)`;
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
  const arcGauge = (p, r, a0, a1, w, notchStyle) => gauge(p, { kind: "arc", d: arcD(r, a0, a1), r, a0, a1 }, w, notchStyle);
  const barGauge = (p, x0, x1, y, w) => gauge(p, { kind: "bar", d: `M${x0} ${y}H${x1}`, x0, x1, y }, w);
  // Limits change once per fetch, so they may glide; hardware gauges tick every second and jump.
  const limitGauge = (gg, v) => gg.g.classList.add("smooth") || gg.set(v.pct, v.pace, v.pace, { hot: v.hot, dashed: v.state === "reset" || v.state === "none" });

  function ticks(parent, r0, r1, a0, a1, n) {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      const [x0, y0] = polar(r0, a);
      const [x1, y1] = polar(r1, a);
      el(parent, "line", { x1: x0, y1: y0, x2: x1, y2: y1, class: "tick", "stroke-width": 2 });
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
    const set = (gg, h, hot) => gg.set(tempF(h.temp), h.peak != null ? tempF(h.peak) : null, tempF(hot), { hot: true });
    return (d) => {
      set(cpu, d.hw.cpu, HOT.cpu);
      set(gpu, d.hw.gpu, HOT.gpu);
    };
  }

  function tempBlock(p, key, cx, y, size, withSub) {
    el(p, "text", { x: cx, y: y - size * 0.86, "text-anchor": "middle", class: size > 80 ? "t-lbl" : "t-lbl-s" }, key.toUpperCase());
    const val = num(p, cx + size * 0.09, y, size);
    const sub = withSub ? el(p, "text", { x: cx, y: y + 34, "text-anchor": "middle", class: "t-sub" }) : null;
    return (d) => {
      const h = d.hw[key];
      setNum(val, int(h.temp), "°", size * 0.5, size);
      val.classList.toggle("is-warn", h.temp != null && h.temp >= HOT[key]);
      if (sub) setText(sub, `${h.load == null ? "—" : Math.round(h.load * 100)}% · ${int(h.power)} W`);
    };
  }

  function statBlock(p, label, cx, y, size, read, lblClass = "t-lbl") {
    el(p, "text", { x: cx, y: y - size * 0.92, "text-anchor": "middle", class: lblClass }, label);
    const val = num(p, cx, y, size);
    return (d) => {
      const [n, u, us] = read(d);
      setNum(val, n, u, size * (us || 0.42), size);
    };
  }
  const readLiquid = (d) => [dec(d.hw.liquid), "°", 0.5];
  const readPower = (d) => [int(power(d.hw)), " W", 0.38];

  // ---------- scenes ----------

  // Three limits, one per row: label + reset/burn on the left, big percentage on the right, pace bar below.
  function sceneLimity(p) {
    const up = [clock(p, 96)];
    const x0 = 118, x1 = 522;
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
    up.push(statBlock(p, "CIECZ", 226, 444, 74, readLiquid));
    up.push(statBlock(p, "MOC", 414, 444, 74, readPower));
    up.push(ramLine(p, 500));
    up.push(meta(p, 552));
    return up;
  }

  // Everything at once: limits as three rim rings (outer 5H, 7D, inner Codex), hardware in the middle.
  function scenePierscienie(p) {
    const R = [288, 262, 236];
    const up = [];
    LIMITS.forEach((def, i) => {
      const ring = arcGauge(p, R[i], -135, 135, 14, "line");
      const [lx, ly] = polar(R[i], -142);
      el(p, "text", { x: lx, y: ly + 5, "text-anchor": "middle", class: "t-meta" }, def.tiny === "CODEX" ? "CX" : def.tiny);
      up.push((d) => limitGauge(ring, d.views[def.key]));
    });
    LIMITS.forEach((def, i) => {
      const x = 226 + i * 94;
      el(p, "text", { x, y: 150, "text-anchor": "middle", class: "t-lbl-s" }, def.tiny);
      const val = num(p, x + 4, 202, 54);
      up.push((d) => {
        const v = d.views[def.key];
        setNum(val, v.value, "%", 24, 54);
        val.classList.toggle("is-dim", v.dim);
        val.classList.toggle("is-warn", !!v.hot);
      });
    });
    el(p, "line", { x1: 196, x2: 444, y1: 230, y2: 230, class: "rule" });
    up.push(tempBlock(p, "cpu", 250, 340, 78, false));
    up.push(tempBlock(p, "gpu", 390, 340, 78, false));
    up.push(statBlock(p, "CIECZ", 250, 444, 54, readLiquid, "t-lbl-s"));
    up.push(statBlock(p, "MOC", 390, 444, 54, readPower, "t-lbl-s"));
    up.push(clock(p, 548));
    up.push(meta(p, 588));
    return up;
  }

  // One huge value at a time; the rim gauge and the dots follow the carousel.
  function sceneJedna(p, layer) {
    const items = [
      ...LIMITS.map((def) => ({ label: def.label, limit: def.key })),
      { label: "CPU", temp: "cpu" },
      { label: "GPU", temp: "gpu" },
      { label: "CIECZ", read: readLiquid, gauge: (d) => scale(d.hw.liquid, 20, 50) },
      { label: "MOC", read: readPower, gauge: (d) => scale(power(d.hw), 0, 600), sub: (d) => `CPU ${int(d.hw.cpu.power)} W · GPU ${int(d.hw.gpu.power)} W` },
    ];
    const up = [clock(p, 108)];
    const groups = items.map((it) => {
      const g = layer();
      g.classList.add("is-off");
      const arc = arcGauge(g, 284, -135, 135, 14);
      if (it.temp) arc.notch.classList.add("is-peak");
      el(g, "text", { x: C, y: 196, "text-anchor": "middle", class: "t-lbl" }, it.label);
      const val = num(g, it.temp || it.read === readLiquid ? C + 16 : C, 384, 196);
      const sub = el(g, "text", { x: C, y: 438, "text-anchor": "middle", class: "t-sub" });
      up.push((d) => {
        if (it.limit) {
          const v = d.views[it.limit];
          limitGauge(arc, v);
          setNum(val, v.value, "%", 80, 196);
          val.classList.toggle("is-dim", v.dim);
          setParts(sub, v.sub);
        } else if (it.temp) {
          const h = d.hw[it.temp];
          arc.set(tempF(h.temp), h.peak != null ? tempF(h.peak) : null, tempF(HOT[it.temp]), { hot: true });
          setNum(val, int(h.temp), "°", 98, 196);
          val.classList.toggle("is-warn", h.temp != null && h.temp >= HOT[it.temp]);
          setText(sub, `obciążenie ${h.load == null ? "—" : Math.round(h.load * 100)}% · ${int(h.power)} W`);
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

  const SCENES = { limity: sceneLimity, sprzet: sceneSprzet, pierscienie: scenePierscienie, jedna: sceneJedna };
  const LEGACY = { adaptive: "adaptacyjny", fixed: "pierscienie", work: "limity", game: "sprzet" };
  function normLayout(l) {
    const id = LEGACY[l] || l;
    return LAYOUTS.some((x) => x.id === id) ? id : "rotacja";
  }

  // ---------- backgrounds ----------
  // A 256 px canvas (the light is soft, so the upscale is invisible) redrawn a few times a
  // second. CAM captures and ships every frame that changes, at a real CPU cost per frame,
  // so the rate is a setting (10/20/30) and between frames the page stays idle.

  const BG_RES = 256;
  const TAU = 2 * Math.PI;
  const ease = (x) => (1 - Math.cos(Math.PI * x)) / 2;
  const pingPong = (t, period) => {
    const q = (t / period) % 2;
    return ease(q < 1 ? q : 2 - q);
  };
  const rgba = (c, k = 1) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] * k).toFixed(3)})`;
  function palette(root) {
    const cs = getComputedStyle(root);
    const parse = (v) => {
      const n = (v.match(/[\d.]+/g) || []).map(Number);
      return [n[0] || 0, n[1] || 0, n[2] || 0, n.length > 3 ? n[3] : 1];
    };
    return { a: parse(cs.getPropertyValue("--glow-a")), b: parse(cs.getPropertyValue("--glow-b")) };
  }
  function glow(ctx, x, y, r, c) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(c));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const BUBBLES = (() => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: 14 }, () => {
      const x = 0.06 + rnd() * 0.86, w = 0.013 + rnd() * 0.024, dur = 16 + rnd() * 18;
      return { x, w, dur, delay: rnd() * dur, sway: 3 + rnd() * 4 };
    });
  })();

  // Each painter draws the moment t (seconds) on an s×s canvas already clipped to the dial.
  const PAINT = {
    // ciecz: soft pools of light orbiting slowly, like coolant swirling in the pump
    ciecz(ctx, t, s, p) {
      for (const [period, ox, oy, r, c] of [[48, 0.19, -0.08, 0.35, p.a], [-66, -0.21, 0.11, 0.34, p.b], [84, 0.05, 0.24, 0.26, p.a]]) {
        const a = (TAU * t) / period;
        glow(ctx, s * (0.5 + ox * Math.cos(a) - oy * Math.sin(a)), s * (0.5 + ox * Math.sin(a) + oy * Math.cos(a)), s * r, c);
      }
    },
    // fale: slow ripples spreading from the centre
    fale(ctx, t, s, p) {
      const c = s / 2;
      for (let i = 0; i < 3; i++) {
        const q = ((t + i * 4) / 12) % 1;
        const r = c * (0.12 + 0.92 * (1 - (1 - q) ** 2.4));
        const k = q < 0.18 ? ease(q / 0.18) : 1 - ease((q - 0.18) / 0.82);
        const g = ctx.createRadialGradient(c, c, r * 0.91, c, c, r);
        g.addColorStop(0, rgba(p.a, 0));
        g.addColorStop(1, rgba(p.a, k));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(c, c, r, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = rgba(p.b, k);
        ctx.lineWidth = Math.max(0.6, r / 160);
        ctx.stroke();
      }
    },
    // bąbelki: a few bubbles drifting up, as in the loop
    babelki(ctx, t, s, p) {
      for (const b of BUBBLES) {
        const w = b.w * s;
        const x = b.x * s + (pingPong(t, b.sway) * 2.4 - 1.2) * w;
        const y = s * (1 - 1.12 * (((t + b.delay) / b.dur) % 1));
        const g = ctx.createRadialGradient(x + w * 0.34, y + w * 0.32, 0, x + w * 0.34, y + w * 0.32, w * 0.68);
        g.addColorStop(0, rgba(p.b));
        g.addColorStop(0.76, rgba(p.a));
        g.addColorStop(1, rgba(p.a, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x + w / 2, y + w / 2, w / 2, 0, TAU);
        ctx.fill();
      }
    },
    // zorza: two broad bands of light breathing across the dial
    zorza(ctx, t, s, p) {
      for (const [period, delay, rx, ry, c] of [[26, 0, 0.75, 0.24, p.a], [34, 12, 0.7, 0.23, p.b]]) {
        const k = pingPong(t + delay, period);
        ctx.save();
        ctx.translate(s / 2, s * (0.386 + 0.25 * k));
        ctx.rotate(((-14 + 26 * k) * Math.PI) / 180);
        ctx.scale(1, ((0.7 + 0.4 * k) * ry) / rx);
        glow(ctx, 0, 0, s * rx, c);
        ctx.restore();
      }
    },
    // obieg: light circulating around the rim, the flow through the pump
    obieg(ctx, t, s, p) {
      const c = s / 2;
      const sweeps = [
        [10, 0, [[0, p.a, 0], [70, p.a, 1], [100, p.b, 1], [140, p.b, 0]]],
        [15, 180, [[0, p.a, 0], [60, p.a, 1], [120, p.a, 0]]],
      ];
      for (const [period, from, stops] of sweeps) {
        const g = ctx.createConicGradient(((from - 90) * Math.PI) / 180 + (TAU * t) / period, c, c);
        for (const [deg, col, k] of stops) g.addColorStop(deg / 360, rgba(col, k));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      }
      // keep only a soft band along the rim
      const m = ctx.createRadialGradient(c, c, 0, c, c, c);
      m.addColorStop(0.7, "rgba(0,0,0,0)");
      m.addColorStop(0.84, "#000");
      m.addColorStop(0.97, "#000");
      m.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = m;
      ctx.fillRect(0, 0, s, s);
      ctx.globalCompositeOperation = "source-over";
    },
  };

  function backdrop(canvas, root) {
    canvas.width = canvas.height = BG_RES;
    const ctx = canvas.getContext("2d");
    let type = "brak", pal = null, t = 7, last = null, speed = 1, fps = 10, timer = null;
    function draw() {
      ctx.clearRect(0, 0, BG_RES, BG_RES);
      if (!PAINT[type]) return;
      ctx.save();
      ctx.beginPath();
      ctx.arc(BG_RES / 2, BG_RES / 2, BG_RES / 2, 0, TAU);
      ctx.clip();
      PAINT[type](ctx, t, BG_RES, pal);
      ctx.restore();
    }
    function frame() {
      if (!canvas.isConnected) return self.pause();
      const now = performance.now();
      if (last != null) t += ((now - last) / 1e3) * speed;
      last = now;
      draw();
      timer = setTimeout(frame, 1000 / fps);
    }
    const self = {
      // Re-reads the theme colours, so call it after a theme change too.
      set(next, animate = true) {
        type = next;
        pal = palette(root);
        draw();
        if (animate) self.play();
        else self.pause();
      },
      play() {
        if (!PAINT[type]) return self.pause();
        if (timer) return;
        last = null;
        timer = setTimeout(frame, 0);
      },
      pause() {
        clearTimeout(timer);
        timer = null;
      },
      speed(r) {
        speed = r;
      },
      fps(n) {
        fps = n > 0 ? n : 10;
      },
    };
    return self;
  }

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
    const back = backdrop(canvas, root);
    const animate = cfg.animate !== false;

    let layout = null, theme = null, bgType = null;
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
      const b = BGS.some((x) => x.id === next.bg) ? next.bg : "ciecz";
      back.fps(next.fps);
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
        for (const def of LIMITS) views[def.key] = limitView((data.limits || {})[def.key], now, interval);
        const d = { now, hw: data.hw || emptyHw(), views, meta: metaView(data.limits, now, interval) };
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
  function background(container, { theme, bg }) {
    const root = document.createElement("div");
    root.className = `kd th-${theme}`;
    const canvas = document.createElement("canvas");
    canvas.className = "kd-bg";
    root.appendChild(canvas);
    container.replaceChildren(root);
    const back = backdrop(canvas, root);
    back.set(bg, false);
    return back;
  }

  window.KrakenDial = { create, background, LAYOUTS, THEMES, BGS, emptyHw };
})();
