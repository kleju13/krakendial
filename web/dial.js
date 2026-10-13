// Kraken Elite LCD dial (640×640, round). Pure SVG + CSS, no dependencies.
//   const dial = KrakenDial.create(container, { layout, theme, bg });
//   dial.update({ now, hw, limits, interval, mode });  // call about once a second
//   dial.configure({ layout, theme, bg });             // switch variant live
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
  function div(parent, cls) {
    const d = document.createElement("div");
    if (cls) d.className = cls;
    parent.appendChild(d);
    return d;
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

  function setParts(textEl, parts) {
    textEl.replaceChildren();
    for (const p of parts) el(textEl, "tspan", p.warn ? { class: "is-warn" } : {}, p.t);
  }
  // Number with a lighter unit; a degree sign is lifted to cap height.
  function setNum(textEl, num, unit, unitSize, fontSize) {
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
        ? `rotate(${geo.a0 + ((geo.a1 - geo.a0) * f) / 100}deg)`
        : `translate(${geo.x0 + ((geo.x1 - geo.x0) * f) / 100}px, 0px)`;
    notch.style.transform = place(0);
    return {
      g,
      notch,
      set(f, notchF, overFrom, state = {}) {
        const cut = overFrom == null ? f : Math.min(f, overFrom);
        fill.setAttribute("stroke-dasharray", `${cut.toFixed(2)} 200`);
        const ov = overFrom != null && f > overFrom ? f - overFrom : 0;
        over.setAttribute("stroke-dasharray", `0 ${(overFrom ?? 0).toFixed(2)} ${ov.toFixed(2)} 200`);
        notch.style.display = notchF == null ? "none" : "";
        if (notchF != null) notch.style.transform = place(notchF);
        g.classList.toggle("is-hot", !!state.hot);
        g.classList.toggle("is-dashed", !!state.dashed);
      },
    };
  }
  const arcGauge = (p, r, a0, a1, w, notchStyle) => gauge(p, { kind: "arc", d: arcD(r, a0, a1), r, a0, a1 }, w, notchStyle);
  const barGauge = (p, x0, x1, y, w) => gauge(p, { kind: "bar", d: `M${x0} ${y}H${x1}`, x0, x1, y }, w);
  const limitGauge = (gg, v) => gg.set(v.pct, v.pace, v.pace, { hot: v.hot, dashed: v.state === "reset" || v.state === "none" });

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
        g.setAttribute("class", `pie is-${m.state}`);
        const ri = r - 2.4;
        const f = m.state === "ok" ? Math.max(0.04, m.frac) : m.state === "error" ? 1 : 0;
        if (f >= 0.999) wedge.setAttribute("d", `M0 ${-ri}A${ri} ${ri} 0 1 1 -0.01 ${-ri}Z`);
        else {
          const a = f * 2 * Math.PI;
          wedge.setAttribute("d", `M0 0L0 ${-ri}A${ri} ${ri} 0 ${f > 0.5 ? 1 : 0} 1 ${(ri * Math.sin(a)).toFixed(2)} ${(-ri * Math.cos(a)).toFixed(2)}Z`);
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
    return (d) => (t.textContent = hhmm(d.now));
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
      t.textContent = `RAM  ${r.used == null ? "—" : dec(r.used / 1024)} / ${r.total == null ? "—" : Math.round(r.total / 1024)} GB`;
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
      if (sub) sub.textContent = `${h.load == null ? "—" : Math.round(h.load * 100)}% · ${int(h.power)} W`;
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
  function sceneJedna(p) {
    const items = [
      ...LIMITS.map((def) => ({ label: def.label, limit: def.key })),
      { label: "CPU", temp: "cpu" },
      { label: "GPU", temp: "gpu" },
      { label: "CIECZ", read: readLiquid, gauge: (d) => scale(d.hw.liquid, 20, 50) },
      { label: "MOC", read: readPower, gauge: (d) => scale(power(d.hw), 0, 600), sub: (d) => `CPU ${int(d.hw.cpu.power)} W · GPU ${int(d.hw.gpu.power)} W` },
    ];
    const up = [clock(p, 108)];
    const groups = items.map((it) => {
      const g = el(p, "g", { class: "scene is-off" });
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
          sub.textContent = `obciążenie ${h.load == null ? "—" : Math.round(h.load * 100)}% · ${int(h.power)} W`;
        } else {
          const [n, u, us] = it.read(d);
          arc.set(it.gauge(d), null, null);
          setNum(val, n, u, 196 * us, 196);
          sub.textContent = it.sub ? it.sub(d) : "";
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

  function buildBg(layer, type) {
    layer.replaceChildren();
    layer.className = `kd-bg bg-${type}`;
    if (type === "ciecz") for (let i = 0; i < 3; i++) div(div(layer, "orbit"), "blob");
    if (type === "fale") for (let i = 0; i < 3; i++) div(layer, "ring");
    if (type === "zorza") for (let i = 0; i < 2; i++) div(layer, "band");
    if (type === "obieg") for (let i = 0; i < 2; i++) div(layer, "sweep");
    if (type === "babelki") {
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 14; i++) {
        const col = div(layer, "col");
        const d = 16 + rnd() * 18;
        col.style.cssText = `left:${6 + rnd() * 86}%;width:${1.3 + rnd() * 2.4}%;animation-duration:${d.toFixed(1)}s;animation-delay:${(-rnd() * d).toFixed(1)}s;--sway:${(3 + rnd() * 4).toFixed(1)}s`;
      }
    }
  }

  // ---------- dial ----------

  function create(container, cfg = {}) {
    const root = document.createElement("div");
    const bg = div(root, "kd-bg");
    const svg = el(root, "svg", { viewBox: "0 0 640 640" });
    container.replaceChildren(root);

    let layout = null, theme = null, bgType = null, rate = 1;
    let scenes = {}, updaters = [];

    function buildLayout() {
      svg.replaceChildren();
      const rim = el(svg, "g");
      for (let i = 0; i < 60; i++) {
        const major = i % 5 === 0;
        const [x0, y0] = polar(major ? 302 : 307, i * 6);
        const [x1, y1] = polar(313, i * 6);
        el(rim, "line", { x1: x0, y1: y0, x2: x1, y2: y1, class: "tick", "stroke-width": major ? 2.2 : 1.1 });
      }
      const names = layout === "rotacja" || layout === "adaptacyjny" ? ["limity", "sprzet"] : [layout];
      scenes = {};
      updaters = [];
      for (const name of names) {
        const g = el(svg, "g", { class: "scene" });
        scenes[name] = g;
        updaters = updaters.concat(SCENES[name](g));
      }
    }

    function applyRate(force) {
      if (!bg.getAnimations) return;
      for (const a of bg.getAnimations({ subtree: true })) {
        if (force || a.playbackRate !== rate) a.updatePlaybackRate(rate);
      }
    }

    function configure(next) {
      const l = normLayout(next.layout);
      const t = THEMES.some((x) => x.id === next.theme) ? next.theme : "ice";
      const b = BGS.some((x) => x.id === next.bg) ? next.bg : "ciecz";
      if (t !== theme) root.className = `kd th-${(theme = t)}`;
      if (b !== bgType) {
        buildBg(bg, (bgType = b));
        applyRate(true);
      }
      if (l !== layout) {
        layout = l;
        buildLayout();
      }
    }

    configure(cfg);

    return {
      configure,
      setActivity(load) {
        const r = Math.round((1 + 2.2 * clamp(load || 0, 0, 1)) * 10) / 10;
        if (r !== rate) {
          rate = r;
          applyRate(false);
        }
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

  // A bare animated background in a theme, for swatches.
  function background(container, { theme, bg }) {
    const root = document.createElement("div");
    root.className = `kd th-${theme}`;
    buildBg(div(root, "kd-bg"), bg);
    container.replaceChildren(root);
  }

  window.KrakenDial = { create, background, LAYOUTS, THEMES, BGS, emptyHw };
})();
