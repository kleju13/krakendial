// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 kleju13 and KrakenDial contributors
// The face editor. The dial in the middle is drawn by the same code as on the cooler, with the
// selection on top of it; widgets to add and the layers are on the left, the selected widget's
// properties on the right. Every change is saved half a second later; when the face is on the
// cooler, the cooler shows it within a few seconds.
(() => {
  const K = KrakenDial, F = KrakenFaces, I = KrakenI18n, t = I.t;
  const byId = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const stage = byId("stage"), dialHost = byId("dial"), overlay = byId("overlay");
  const NS = "http://www.w3.org/2000/svg";

  let state = { limits: {}, costs: null, interval: 60e3, config: null, hw: null };
  let faces = [], media = [];
  let face = null; // the face being edited, always normalized
  let sel = null; // the selected widget's id
  let undo = [], redo = [], group = null;
  let drag = null, guides = [];
  const cfg = () => ({ theme: "ice", bg: "liquid", fps: 10, units: "left", look: "plain", mascot: "kraken", cost: "last24h", bars: "load", lang: "auto", ...(state.config || {}) });
  const widgetById = (id) => (face ? face.widgets.find((w) => w.id === id) : null);
  const typeName = (type) => t(`w.${type}`);
  // The editor's address for a face; a preview size (screen=240) stays in it.
  function editorUrl(id) {
    const q = new URLSearchParams();
    if (id) q.set("face", id);
    if (params.get("screen")) q.set("screen", params.get("screen"));
    const s = q.toString();
    return s ? `/editor?${s}` : "/editor";
  }

  // ---------- data for the preview ----------
  // The cooler's own numbers when CAM sends them, otherwise sample ones that move a little.

  function sampleHw(now) {
    const s = Math.sin(now / 9000);
    return {
      cpu: { name: "AMD Ryzen 7 5800X3D", temp: 54 + 4 * s, load: 0.18 + 0.06 * s, power: 46 + 6 * s, peak: 61 },
      gpu: { name: "NVIDIA GeForce RTX 4070 SUPER", temp: 47 + 3 * s, load: 0.55 + 0.1 * s, power: 170 + 20 * s, peak: 55 },
      liquid: 31.2, ram: { used: 19.1 * 1024, total: 32768 },
    };
  }
  function sampleLimits(now) {
    const H = 3600e3;
    const l = (pct, reset, win) => ({ pct, resetsAt: now + reset * H, windowMs: win * H, fetchedAt: now - 30e3, nextAt: now + 270e3 });
    return { claude5h: l(38, 2.8, 5), claude7d: l(64, 61, 168), codex7d: l(22, 128, 168) };
  }
  const SAMPLE_COSTS = { last24h: 14.29, today: 6.12, last7d: 80.24, month: 211.9 };
  function data() {
    const now = Date.now();
    const live = !!(state.hw && state.hw.at && now - state.hw.at < 15e3);
    const real = Object.values(state.limits || {}).some((l) => l && l.pct != null);
    const costs = state.costs && typeof state.costs.last24h === "number" ? state.costs : { ...SAMPLE_COSTS, polledAt: now };
    return { live, now, hw: live ? state.hw : sampleHw(now), limits: real ? state.limits : sampleLimits(now), costs, interval: state.interval, mode: "work" };
  }

  // ---------- the dial ----------

  const dial = K.create(dialHost, { ...cfg(), layout: "face", face: { widgets: [] } });
  const groupOf = (id) => dialHost.querySelector(`[data-w="${id}"]`);
  function draw() {
    dial.configure({ ...cfg(), layout: "face", face: face || { widgets: [] } });
    drawActual();
    tick();
  }
  function tick() {
    const d = data();
    dial.update(d);
    if (actual) actual.update(d);
    byId("caption").textContent = t(d.live ? "ed.preview" : "ed.previewMock");
    if (!drag) drawOverlay();
  }

  // The face on a Kraken screen smaller than the stage, as many pixels across as it has (as the
  // LCD page last reported it; screen=240 shows another size): what reads here reads on the cooler.
  const actualHost = byId("actual-dial");
  let actual = null;
  function screenPx() {
    const forced = Number(params.get("screen")) || 0;
    const s = forced ? { w: forced, h: forced } : state.config && state.config.screen;
    return s ? Math.min(s.w, s.h) : 0;
  }
  function drawActual() {
    const px = screenPx();
    const show = K.sizeOf(px) !== "large";
    byId("actual").hidden = !show;
    if (!show) {
      // a dial off the page stops drawing its background
      if (actual) actualHost.replaceChildren();
      actual = null;
      return;
    }
    actualHost.style.width = `${px / devicePixelRatio}px`;
    byId("actual-hint").textContent = t("ed.actualHint", { px });
    const c = { ...cfg(), layout: "face", face: face || { widgets: [] }, screen: px };
    if (actual) actual.configure(c);
    else actual = K.create(actualHost, c);
  }
  // the browser's zoom changes how many pixels a CSS pixel is
  addEventListener("resize", () => actual && drawActual());

  // Where a widget is on the dial, in its own 640×640 units.
  function boxOf(id) {
    const g = groupOf(id), w = widgetById(id);
    if (!g || !w) return null;
    let b;
    try {
      b = g.getBBox();
    } catch (_) {
      b = null;
    }
    if (!b || (!b.width && !b.height)) return { x: w.x - 12, y: w.y - 12, width: 24, height: 24 };
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  // A pointer event in dial units.
  function toDial(e) {
    const r = dialHost.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 640, y: ((e.clientY - r.top) / r.height) * 640 };
  }
  const unitsPerPx = () => 640 / dialHost.getBoundingClientRect().width;

  function svg(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    overlay.appendChild(n);
    return n;
  }
  function drawOverlay(offset) {
    overlay.replaceChildren();
    svg("circle", { cx: 320, cy: 320, r: 320, class: "rim" });
    for (const gd of guides) svg("line", gd.x != null ? { x1: gd.x, x2: gd.x, y1: -40, y2: 680, class: "guide" } : { y1: gd.y, y2: gd.y, x1: -40, x2: 680, class: "guide" });
    const b = sel && boxOf(sel);
    if (!b) return;
    const o = offset || { dx: 0, dy: 0, k: 1, ax: 0, ay: 0 };
    // the box follows a drag in progress: moved by dx/dy, or scaled k times around the anchor
    const x0 = o.ax + (b.x - o.ax) * o.k + o.dx, y0 = o.ay + (b.y - o.ay) * o.k + o.dy;
    const pad = 6 * unitsPerPx();
    svg("rect", { x: x0 - pad, y: y0 - pad, width: b.width * o.k + 2 * pad, height: b.height * o.k + 2 * pad, rx: 4, class: "box" });
    const w = widgetById(sel);
    if (w && F.WIDGETS[w.type].resize) {
      const h = 7 * unitsPerPx();
      const handle = svg("rect", { x: x0 + b.width * o.k + pad - h, y: y0 + b.height * o.k + pad - h, width: 2 * h, height: 2 * h, rx: h / 3, class: "handle" });
      handle.dataset.handle = "1";
    }
  }

  // ---------- changes, undo, saving ----------

  // Applies fn to the face as one step to undo; steps with the same group (a slider being
  // dragged, a run of nudges) merge into one.
  function change(fn, g = null, opts = {}) {
    if (!face) return;
    const before = JSON.stringify(face);
    fn(face);
    face = F.normalize(face);
    if (JSON.stringify(face) === before) return;
    if (!g || g !== group) {
      undo.push(before);
      if (undo.length > 200) undo.shift();
    }
    group = g;
    redo = [];
    changed(opts);
  }
  const endGroup = () => (group = null);
  function changed(opts = {}) {
    if (sel && !widgetById(sel)) sel = null;
    draw();
    renderLayers();
    if (!opts.fromProps) renderProps();
    renderHeader();
    scheduleSave();
  }
  function step(from, to) {
    if (!from.length || !face) return;
    to.push(JSON.stringify(face));
    face = F.normalize(JSON.parse(from.pop()));
    group = null;
    changed();
  }

  let saveTimer = null, saving = Promise.resolve(), saveState = "saved", saveError = "";
  function setSaved(s, err = "") {
    saveState = s;
    saveError = err;
    const n = byId("saved");
    n.textContent = s === "saving" ? t("ed.saving") : s === "error" ? t("ed.saveFailed", { msg: err }) : face && face.id ? t("ed.saved") : "";
    n.className = s === "error" ? "bad" : "";
  }
  function scheduleSave() {
    setSaved("saving");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 500);
  }
  // Saves in order; each save sends the face as it is by then, so a new face gets its id from the
  // first save before the next one goes out.
  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    saving = saving.then(async () => {
      if (!face) return;
      const sent = face;
      try {
        const r = await fetch("/api/faces", { method: "POST", body: JSON.stringify(sent) });
        if (!r.ok) throw new Error((await r.text()) || r.status);
        const saved = await r.json();
        if (face === sent || (face && !face.id)) {
          face.id = saved.id;
          face.name = saved.name;
        }
        if (face && face.id) history.replaceState(null, "", editorUrl(face.id));
        if (!saveTimer) setSaved("saved");
        await loadFaces();
      } catch (e) {
        setSaved("error", e.message || String(e));
      }
    });
    return saving;
  }
  async function flush() {
    if (saveTimer) saveNow();
    await saving;
  }

  // ---------- faces ----------

  async function loadFaces() {
    try {
      const r = await fetch("/api/faces", { cache: "no-store" });
      if (r.ok) faces = await r.json();
    } catch (_) {}
    renderHeader();
  }
  function open(f) {
    face = F.normalize(f);
    sel = null;
    undo = [];
    redo = [];
    group = null;
    if (face.id) history.replaceState(null, "", editorUrl(face.id));
    setSaved("saved");
    changedView();
  }
  // Everything shown again, without saving: for a face just opened.
  function changedView() {
    draw();
    renderLayers();
    renderProps();
    renderHeader();
  }
  async function createFace(widgets, name) {
    await flush();
    open({ name: name || t("ed.untitled"), widgets });
    face.id = "";
    await saveNow();
  }
  async function switchTo(id) {
    await flush();
    const f = faces.find((x) => x.id === id);
    if (f) open(f);
  }

  // ---------- header ----------

  function renderHeader() {
    const list = byId("faces");
    const want = JSON.stringify([faces.map((f) => [f.id, f.name]), face && face.id]);
    if (list.dataset.key !== want) {
      list.dataset.key = want;
      list.replaceChildren();
      const shown = faces.some((f) => face && f.id === face.id) || !face ? faces : [...faces, face];
      for (const f of shown) {
        const o = document.createElement("option");
        o.value = f.id;
        o.textContent = f.name;
        list.appendChild(o);
      }
      list.value = face ? face.id : "";
    }
    const name = byId("name");
    if (document.activeElement !== name && face) name.value = face.name;
    for (const id of ["name", "duplicate", "export", "delete", "show"]) byId(id).disabled = !face;
    byId("undo").disabled = !undo.length;
    byId("redo").disabled = !redo.length;
    const on = face && face.id && cfg().layout === `face:${face.id}`;
    const show = byId("show");
    show.textContent = t(on ? "ed.showing" : "ed.show");
    show.classList.toggle("on", !!on);
  }

  byId("faces").onchange = (e) => switchTo(e.target.value);
  byId("name").oninput = (e) => change((f) => (f.name = e.target.value), "name");
  byId("name").onchange = endGroup;
  byId("undo").onclick = () => step(undo, redo);
  byId("redo").onclick = () => step(redo, undo);
  byId("duplicate").onclick = () => face && createFace(face.widgets.map((w) => ({ ...w })), `${face.name} 2`);
  byId("show").onclick = async () => {
    if (!face) return;
    await flush();
    if (!face.id) return;
    const r = await fetch("/api/config", { method: "POST", body: JSON.stringify({ layout: `face:${face.id}` }) }).catch(() => null);
    if (r && r.ok) state.config = await r.json();
    renderHeader();
  };
  let deleteArmed = null;
  byId("delete").onclick = async () => {
    const b = byId("delete");
    if (!face) return;
    if (!deleteArmed) {
      b.textContent = t("ed.deleteSure");
      b.classList.add("bad");
      deleteArmed = setTimeout(() => {
        deleteArmed = null;
        b.textContent = t("ed.delete");
        b.classList.remove("bad");
      }, 4000);
      return;
    }
    clearTimeout(deleteArmed);
    deleteArmed = null;
    b.textContent = t("ed.delete");
    b.classList.remove("bad");
    clearTimeout(saveTimer);
    saveTimer = null;
    await saving;
    if (face.id) await fetch(`/api/faces?id=${encodeURIComponent(face.id)}`, { method: "DELETE" }).catch(() => {});
    face = null;
    await loadFaces();
    if (faces.length) open(faces[0]);
    else {
      history.replaceState(null, "", editorUrl());
      changedView();
      showTemplates(true);
    }
  };
  byId("export").onclick = () => {
    if (!face) return;
    const out = { version: 1, name: face.name, widgets: face.widgets };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
    a.download = `${face.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "face"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  byId("import").onclick = () => byId("import-file").click();
  byId("import-file").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const f = JSON.parse(await file.text());
      if (!f || !Array.isArray(f.widgets)) throw new Error("no widgets");
      await createFace(f.widgets, f.name);
    } catch (_) {
      setSaved("error", t("ed.importFailed"));
    }
  };

  // ---------- templates ----------

  const pop = byId("templates");
  let popForced = false;
  function showTemplates(forced = false) {
    popForced = forced;
    pop.replaceChildren();
    const d = data();
    for (const tpl of F.TEMPLATES) {
      const b = document.createElement("button");
      b.className = "tpl";
      b.innerHTML = `<div class="thumb"></div><span></span>`;
      b.querySelector("span").textContent = t(`tpl.${tpl.id}`);
      b.onclick = () => {
        pop.hidden = true;
        createFace(tpl.widgets(), t("ed.untitled"));
      };
      pop.appendChild(b);
      const mini = K.create(b.querySelector(".thumb"), { ...cfg(), bg: "none", layout: "face", face: { widgets: tpl.widgets() }, animate: false });
      mini.update(d);
    }
    const r = byId("new").getBoundingClientRect();
    pop.style.left = `${Math.max(10, r.left)}px`;
    pop.style.top = `${r.bottom + 8}px`;
    pop.hidden = false;
    pop.querySelector("button").focus();
  }
  function hideTemplates() {
    if (pop.hidden) return;
    pop.hidden = true;
    // with nothing to edit, closing the choice still leaves something to work on
    if (popForced && !face) createFace([], t("ed.untitled"));
  }
  byId("new").onclick = (e) => {
    e.stopPropagation();
    if (pop.hidden) showTemplates();
    else hideTemplates();
  };
  document.addEventListener("pointerdown", (e) => {
    if (!pop.hidden && !pop.contains(e.target) && e.target !== byId("new")) hideTemplates();
  });

  // ---------- adding, layers ----------

  function renderPalette() {
    const host = byId("palette");
    host.replaceChildren();
    for (const [type, def] of Object.entries(F.WIDGETS)) {
      const b = document.createElement("button");
      b.className = "tool";
      b.innerHTML = `<i></i><span></span>`;
      b.querySelector("i").textContent = def.icon;
      b.querySelector("span").textContent = typeName(type);
      b.onclick = () => add(type);
      host.appendChild(b);
    }
  }
  function add(type) {
    if (!face) return;
    const w = F.widget(type, { x: 320, y: 320 });
    change((f) => f.widgets.push(w));
    select(w.id);
  }

  function layerName(w) {
    if (w.name) return w.name;
    if (w.type === "text") return `${typeName(w.type)} · ${w.text.split("\n")[0].slice(0, 32)}`;
    if (w.source) return `${typeName(w.type)} · ${t(`src.${w.source}`)}`;
    if (w.type === "mascot" && w.mascot !== "auto") return `${typeName(w.type)} · ${t(`mascot.${w.mascot}`)}`;
    return typeName(w.type);
  }
  function renderLayers() {
    const host = byId("layers");
    host.replaceChildren();
    if (!face) return;
    if (!face.widgets.length) {
      const p = document.createElement("div");
      p.className = "empty";
      p.textContent = t("ed.empty");
      host.appendChild(p);
      return;
    }
    // the top of the list is drawn last, on top of the rest
    for (const w of [...face.widgets].reverse()) {
      const row = document.createElement("div");
      row.className = `layer${w.id === sel ? " sel" : ""}${w.hidden ? " off" : ""}`;
      row.innerHTML = `<i></i><span></span><button></button>`;
      row.querySelector("i").textContent = F.WIDGETS[w.type].icon;
      row.querySelector("span").textContent = layerName(w);
      const eye = row.querySelector("button");
      eye.textContent = w.hidden ? "◌" : "●";
      eye.title = t("ed.hide");
      eye.onclick = (e) => {
        e.stopPropagation();
        change((f) => (f.widgets.find((x) => x.id === w.id).hidden = !w.hidden));
      };
      row.onclick = () => select(w.id);
      host.appendChild(row);
    }
  }

  function select(id) {
    if (sel === id) return;
    sel = id;
    endGroup();
    renderLayers();
    renderProps();
    drawOverlay();
  }

  // ---------- properties ----------

  const SOURCE_GROUPS = [
    ["CPU · GPU", (k) => /^(cpu|gpu)\./.test(k)],
    ["", (k) => ["liquid", "power", "ram", "ram.pct"].includes(k)],
    ["Claude · Codex", (k) => k.startsWith("limit.")],
    ["$", (k) => k.startsWith("cost")],
    ["", (k) => k.startsWith("time") || k === "date"],
  ];
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function prop(label, control, hint) {
    const box = el("div", "prop");
    if (label) box.appendChild(el("label", null, label));
    box.appendChild(control);
    if (hint) box.appendChild(el("div", "hint", hint));
    return box;
  }
  // Sets one property of the selected widget; slider moves merge into one undo step.
  const setProp = (w, key, v, merge) => change((f) => (f.widgets.find((x) => x.id === w.id)[key] = v), merge ? `${w.id}.${key}` : null, { fromProps: true });

  function numberControl(w, key, spec) {
    const box = el("div", "num");
    const range = el("input");
    range.type = "range";
    Object.assign(range, { min: spec.min, max: spec.max, step: spec.step || (spec.max - spec.min > 40 ? 1 : 0.05), value: w[key] });
    const input = el("input");
    input.type = "number";
    Object.assign(input, { min: spec.min, max: spec.max, step: spec.step || "any", value: w[key] });
    range.oninput = () => {
      input.value = range.value;
      setProp(w, key, Number(range.value), true);
    };
    range.onchange = endGroup;
    input.onchange = () => {
      if (input.value === "") return;
      endGroup();
      setProp(w, key, Number(input.value));
      range.value = widgetById(w.id)[key];
      input.value = widgetById(w.id)[key];
    };
    box.append(range, input);
    return box;
  }
  function selectControl(w, key, options) {
    const box = el("div", "seg");
    for (const [v, label] of options) {
      const b = el("button", `btn${w[key] === v ? " on" : ""}`, t(label));
      b.onclick = () => {
        setProp(w, key, v);
        renderProps();
      };
      box.appendChild(b);
    }
    return box;
  }
  function sourceControl(w, key, spec) {
    const s = el("select", "field");
    for (const [label, test] of SOURCE_GROUPS) {
      const ids = Object.keys(F.SOURCES).filter((k) => test(k) && (!spec.gauged || F.GAUGED.includes(k)));
      if (!ids.length) continue;
      const g = label ? el("optgroup") : s;
      if (label) {
        g.label = label;
        s.appendChild(g);
      }
      for (const id of ids) {
        const o = el("option", null, t(`src.${id}`));
        o.value = id;
        g.appendChild(o);
      }
    }
    s.value = w[key];
    s.onchange = () => {
      setProp(w, key, s.value);
      renderLayers();
    };
    return s;
  }
  function colorControl(w, key) {
    const box = el("div", "swatches");
    const root = dialHost.firstElementChild;
    const css = root ? getComputedStyle(root) : null;
    for (const [role, v] of Object.entries(F.ROLES)) {
      const b = el("button", `sw${w[key] === role ? " on" : ""}`);
      b.title = t(`c.${role}`);
      b.style.background = css ? css.getPropertyValue(v).trim() : "";
      b.onclick = () => {
        setProp(w, key, role);
        renderProps();
      };
      box.appendChild(b);
    }
    const pick = el("input");
    pick.type = "color";
    pick.value = /^#[0-9a-f]{6}$/i.test(w[key]) ? w[key] : "#5b9cff";
    pick.oninput = () => setProp(w, key, pick.value, true);
    pick.onchange = () => {
      endGroup();
      renderProps();
    };
    box.appendChild(pick);
    return box;
  }
  function textControl(w, key, spec) {
    if (spec.kind === "text") {
      const input = el("input", "field");
      input.value = w[key];
      input.placeholder = key === "label" ? F.SOURCES[w.source]?.label() || "" : "";
      input.oninput = () => {
        setProp(w, key, input.value, true);
        renderLayers();
      };
      input.onchange = endGroup;
      return input;
    }
    const box = el("div", "prop");
    const area = el("textarea", "field");
    area.value = w[key];
    area.spellcheck = false;
    area.oninput = () => {
      setProp(w, key, area.value, true);
      renderLayers();
    };
    area.onchange = endGroup;
    // values to put in, at the cursor
    const ins = el("select", "field");
    ins.appendChild(el("option", null, "{ … }"));
    for (const id of Object.keys(F.SOURCES)) {
      const o = el("option", null, `${t(`src.${id}`)} — {${id}}`);
      o.value = id;
      ins.appendChild(o);
    }
    ins.onchange = () => {
      if (!F.SOURCES[ins.value]) return;
      const at = area.selectionStart ?? area.value.length;
      area.value = `${area.value.slice(0, at)}{${ins.value}}${area.value.slice(area.selectionEnd ?? at)}`;
      ins.selectedIndex = 0;
      endGroup();
      setProp(w, key, area.value);
      renderLayers();
      area.focus();
    };
    box.append(area, ins);
    return box;
  }
  function boolControl(w, key, label) {
    const lab = el("label", "check");
    const box = el("input");
    box.type = "checkbox";
    box.checked = !!w[key];
    box.onchange = () => {
      setProp(w, key, box.checked);
      renderProps();
    };
    lab.append(box, el("span", null, label));
    return lab;
  }
  function mediaControl(w, key) {
    const s = el("select", "field");
    s.appendChild(el("option", null, "—")).value = "";
    for (const m of media.filter((m) => m.kind !== "video")) {
      const o = el("option", null, m.name);
      o.value = `media:${m.name}`;
      s.appendChild(o);
    }
    s.value = w[key];
    s.onchange = () => setProp(w, key, s.value);
    return s;
  }
  function mascotControl(w, key) {
    const s = el("select", "field");
    s.appendChild(el("option", null, t("p.mascotAuto"))).value = "auto";
    for (const m of K.MASCOTS) s.appendChild(el("option", null, m.name)).value = m.id;
    s.value = w[key];
    s.onchange = () => {
      setProp(w, key, s.value);
      renderLayers();
    };
    return s;
  }

  function renderProps() {
    const host = byId("props");
    host.replaceChildren();
    const w = widgetById(sel);
    if (!w) {
      host.appendChild(el("div", "empty", face ? t("ed.nothing") : ""));
      return;
    }
    const def = F.WIDGETS[w.type];
    host.appendChild(el("div", null, typeName(w.type))).style.cssText = "font-size:16px;font-weight:600;letter-spacing:.04em";
    const actions = el("div", "actions");
    const action = (label, fn) => {
      const b = el("button", "btn", label);
      b.onclick = fn;
      actions.appendChild(b);
    };
    action(t("ed.dup"), duplicate);
    action(t("ed.up"), () => reorder(1));
    action(t("ed.down"), () => reorder(-1));
    action(t("ed.center"), () => change((f) => (f.widgets.find((x) => x.id === w.id).x = 320)));
    action(t("ed.remove"), removeSelected);
    host.appendChild(actions);
    // the dial is where things are moved; the numbers are for exact places
    const xy = el("div", "xy");
    for (const key of ["x", "y"]) {
      const input = el("input");
      Object.assign(input, { type: "number", min: -320, max: 960, step: 1, value: w[key] });
      input.onchange = () => {
        if (input.value === "") return;
        endGroup();
        setProp(w, key, Number(input.value));
        input.value = widgetById(w.id)[key];
      };
      xy.appendChild(prop(t(`p.${key}`), input));
    }
    host.appendChild(xy);
    for (const [key, spec] of Object.entries(def.props)) {
      if (spec.when && !spec.when(w)) continue;
      const label = t(spec.label || `p.${key}`);
      const hint = spec.hint ? t(spec.hint) : key === "src" && !media.some((m) => m.kind !== "video") ? t("p.srcNone") : null;
      let control;
      switch (spec.kind) {
        case "number":
          control = numberControl(w, key, spec);
          break;
        case "select":
          control = selectControl(w, key, spec.options);
          break;
        case "source":
          control = sourceControl(w, key, spec);
          break;
        case "color":
          control = colorControl(w, key);
          break;
        case "text":
        case "longtext":
          control = textControl(w, key, spec);
          break;
        case "bool":
          host.appendChild(prop(null, boolControl(w, key, label), hint));
          continue;
        case "media":
          control = mediaControl(w, key);
          break;
        case "mascot":
          control = mascotControl(w, key);
          break;
        default:
          continue;
      }
      host.appendChild(prop(label, control, hint));
    }
  }

  // ---------- editing the selection ----------

  function duplicate() {
    const w = widgetById(sel);
    if (!w) return;
    const copy = { ...w, id: F.newId(), x: w.x + 16, y: w.y + 16 };
    change((f) => f.widgets.splice(f.widgets.findIndex((x) => x.id === w.id) + 1, 0, copy));
    select(copy.id);
  }
  function removeSelected() {
    if (!widgetById(sel)) return;
    const id = sel;
    change((f) => (f.widgets = f.widgets.filter((x) => x.id !== id)));
  }
  // +1 brings the selected widget forward (drawn later), -1 sends it back.
  function reorder(dir) {
    const i = face ? face.widgets.findIndex((x) => x.id === sel) : -1;
    const j = i + dir;
    if (i < 0 || j < 0 || j >= face.widgets.length) return;
    change((f) => ([f.widgets[i], f.widgets[j]] = [f.widgets[j], f.widgets[i]]));
  }
  function nudge(dx, dy) {
    const w = widgetById(sel);
    if (!w) return;
    change((f) => {
      const x = f.widgets.find((v) => v.id === w.id);
      x.x += dx;
      x.y += dy;
    }, `nudge.${w.id}`);
  }

  // ---------- pointer: select, move, resize ----------

  // The widget under the pointer: whatever is drawn there, else the smallest box around it.
  function hit(e, p) {
    for (const n of document.elementsFromPoint(e.clientX, e.clientY)) {
      const g = n.closest && n.closest("[data-w]");
      if (g && dialHost.contains(g)) return g.dataset.w;
    }
    let best = null, area = Infinity;
    const pad = 6 * unitsPerPx();
    for (const w of face.widgets) {
      const b = !w.hidden && boxOf(w.id);
      if (!b || p.x < b.x - pad || p.x > b.x + b.width + pad || p.y < b.y - pad || p.y > b.y + b.height + pad) continue;
      if (b.width * b.height < area) [best, area] = [w.id, b.width * b.height];
    }
    return best;
  }

  // Snaps a moved widget to the centre lines and to the other widgets, unless Alt is held.
  function snap(w, b, nx, ny, free) {
    guides = [];
    if (free) return [nx, ny];
    const tol = 7 * unitsPerPx();
    const xs = [320], ys = [320];
    for (const o of face.widgets) if (o.id !== w.id && !o.hidden) xs.push(o.x), ys.push(o.y);
    // the widget's anchor, or the middle of its box, whichever lands closer to a line
    const fit = (v, offsets, lines) => {
      let best = null;
      for (const off of offsets) for (const l of lines) {
        const d = l - (v + off);
        if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, l };
      }
      return best;
    };
    const fx = fit(nx, [0, b.x + b.width / 2 - w.x], xs), fy = fit(ny, [0, b.y + b.height / 2 - w.y], ys);
    if (fx) {
      nx += fx.d;
      guides.push({ x: fx.l });
    }
    if (fy) {
      ny += fy.d;
      guides.push({ y: fy.l });
    }
    return [nx, ny];
  }

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !face) return;
    const p = toDial(e);
    const w0 = widgetById(sel);
    if (e.target.dataset && e.target.dataset.handle && w0) {
      drag = { kind: "size", id: w0.id, w0: { ...w0 }, d0: Math.max(4, Math.hypot(p.x - w0.x, p.y - w0.y)), k: 1 };
    } else {
      const id = hit(e, p);
      select(id);
      if (!id) return;
      const w = widgetById(id);
      drag = { kind: "move", id, w0: { ...w }, start: p, box: boxOf(id), moved: false, nx: w.x, ny: w.y };
    }
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = toDial(e), g = groupOf(drag.id), w0 = drag.w0;
    if (drag.kind === "move") {
      if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < 3 * unitsPerPx()) return;
      drag.moved = true;
      stage.classList.add("dragging");
      [drag.nx, drag.ny] = snap(w0, drag.box || { x: w0.x, y: w0.y, width: 0, height: 0 }, w0.x + p.x - drag.start.x, w0.y + p.y - drag.start.y, e.altKey);
      const dx = drag.nx - w0.x, dy = drag.ny - w0.y;
      if (g) g.setAttribute("transform", `translate(${dx.toFixed(1)} ${dy.toFixed(1)})`);
      drawOverlay({ dx, dy, k: 1, ax: 0, ay: 0 });
    } else {
      drag.k = Math.min(8, Math.max(0.1, Math.hypot(p.x - w0.x, p.y - w0.y) / drag.d0));
      if (g) g.setAttribute("transform", `translate(${w0.x} ${w0.y}) scale(${drag.k.toFixed(3)}) translate(${-w0.x} ${-w0.y})`);
      drawOverlay({ dx: 0, dy: 0, k: drag.k, ax: w0.x, ay: w0.y });
    }
  });
  function endDrag() {
    if (!drag) return;
    const d = drag;
    drag = null;
    guides = [];
    stage.classList.remove("dragging");
    const g = groupOf(d.id);
    if (g) g.removeAttribute("transform");
    endGroup();
    if (d.kind === "move" && d.moved) {
      change((f) => {
        const w = f.widgets.find((x) => x.id === d.id);
        w.x = Math.round(d.nx);
        w.y = Math.round(d.ny);
      });
    } else if (d.kind === "size" && Math.abs(d.k - 1) > 0.01) {
      change((f) => {
        const w = f.widgets.find((x) => x.id === d.id);
        Object.assign(w, F.WIDGETS[w.type].resize(w, d.k));
      });
    } else drawOverlay();
  }
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("dblclick", (e) => {
    // a double click on text goes straight to its text
    const w = widgetById(sel);
    if (!w || w.type !== "text") return;
    const area = byId("props").querySelector("textarea");
    if (area) area.focus();
    e.preventDefault();
  });

  // ---------- keys ----------

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== "range" && e.target.type !== "checkbox";
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") {
      if (!pop.hidden) return hideTemplates();
      if (typing) return e.target.blur();
      return select(null);
    }
    if (mod && e.key.toLowerCase() === "z" && !typing) {
      e.preventDefault();
      return e.shiftKey ? step(redo, undo) : step(undo, redo);
    }
    if (mod && e.key.toLowerCase() === "y" && !typing) {
      e.preventDefault();
      return step(redo, undo);
    }
    if (typing || !face) return;
    if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      return duplicate();
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      return removeSelected();
    }
    const by = e.shiftKey ? 10 : 1;
    const arrows = { ArrowLeft: [-by, 0], ArrowRight: [by, 0], ArrowUp: [0, -by], ArrowDown: [0, by] };
    if (arrows[e.key] && sel) {
      e.preventDefault();
      return nudge(...arrows[e.key]);
    }
    if (e.key === "]") return reorder(1);
    if (e.key === "[") return reorder(-1);
  });
  document.addEventListener("keyup", (e) => {
    if (e.key.startsWith("Arrow")) endGroup();
  });

  // ---------- the service ----------

  let builtLang = null, serviceBuild = null;
  function translate() {
    builtLang = I.lang;
    document.documentElement.lang = I.lang;
    for (const n of document.querySelectorAll("[data-t]")) n.textContent = t(n.dataset.t);
    byId("undo").title = t("ed.undo");
    byId("redo").title = t("ed.redo");
    renderPalette();
    renderLayers();
    renderProps();
    renderHeader();
    setSaved(saveState, saveError);
  }
  async function poll() {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (r.ok) {
        const next = await r.json();
        if (serviceBuild && next.build !== serviceBuild) {
          // the service restarted, perhaps with a new version: save, then load it
          await flush();
          return location.reload();
        }
        serviceBuild = next.build;
        const restyle =
          !state.config ||
          ["theme", "bg", "look", "mascot", "units", "cost", "bars", "lang"].some((k) => state.config[k] !== next.config[k]) ||
          JSON.stringify(state.config.screen) !== JSON.stringify(next.config.screen);
        state = next;
        if (I.resolve(state.config.lang) !== builtLang) {
          I.use(state.config.lang);
          translate();
        }
        if (restyle) draw();
        renderHeader();
      }
    } catch (_) {}
  }
  async function loadMedia() {
    try {
      const r = await fetch("/api/media", { cache: "no-store" });
      if (r.ok) media = await r.json();
    } catch (_) {}
  }

  window.addEventListener("beforeunload", (e) => {
    if (saveTimer || saveState === "saving") {
      saveNow();
      e.preventDefault();
    }
  });

  (async () => {
    I.use("auto");
    translate();
    await Promise.all([poll(), loadFaces(), loadMedia()]);
    const want = params.get("face");
    const f = faces.find((x) => x.id === want);
    if (f) open(f);
    else if (!params.has("new") && faces.length) open(faces[0]);
    else {
      changedView();
      showTemplates(true);
    }
    setInterval(poll, 2000);
    setInterval(tick, 1000);
    setInterval(loadMedia, 10000);
  })();
})();
