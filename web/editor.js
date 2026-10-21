// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 kleju13 and KrakenDial contributors
// The face editor. The dial in the middle is drawn by the same code as on the cooler, with the
// selection on top of it; ready blocks and widgets to add are on the left, and on the right the
// face's look (theme, background), the selected widgets' properties and the layers. Every change
// is saved half a second later; when the face is on the cooler, the cooler shows it within a few
// seconds, and a new look goes to the settings at once.
(() => {
  const K = KrakenDial, F = KrakenFaces, I = KrakenI18n, t = I.t;
  const byId = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const stage = byId("stage"), dialHost = byId("dial"), overlay = byId("overlay");
  const NS = "http://www.w3.org/2000/svg";

  let state = { limits: {}, costs: null, interval: 60e3, config: null, hw: null };
  let faces = [], media = [], gallery = [];
  let face = null; // the face being edited, always normalized
  let sel = []; // the selected widgets' ids; the properties shown are the last one's
  let undo = [], redo = [], group = null;
  let drag = null, guides = [];
  const cfg = () => ({ theme: "ice", bg: "liquid", fps: 10, units: "left", look: "plain", mascot: "kraken", cost: "last24h", bars: "load", lang: "auto", ...(state.config || {}) });
  const widgetById = (id) => (face ? face.widgets.find((w) => w.id === id) : null);
  const selected = () => sel.map(widgetById).filter(Boolean);
  const typeName = (type) => t(`w.${type}`);
  // A gallery face's name in the page's language; the file's own name otherwise.
  const galleryName = (g) => (t(`gal.${g.id}`) === `gal.${g.id}` ? g.name : t(`gal.${g.id}`));

  // The look the face is drawn in: its own where it has one, the settings' for the rest.
  function lookNow() {
    const c = cfg();
    const bg = (face && face.bg) || c.bg;
    return { theme: (face && face.theme) || c.theme, bg, look: /^media:/.test(bg) ? (face && face.look) || c.look : "plain" };
  }
  // Only what the face sets itself, for the settings.
  const ownLook = (f) => Object.fromEntries(["theme", "bg", "look"].filter((k) => f && f[k]).map((k) => [k, f[k]]));
  const onCooler = () => !!(face && face.id && cfg().layout === `face:${face.id}`);

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
    dial.configure({ ...cfg(), ...lookNow(), layout: "face", face: face || { widgets: [] } });
    tick();
  }
  function tick() {
    const d = data();
    dial.update(d);
    byId("caption").textContent = t(d.live ? "ed.preview" : "ed.previewMock");
    byId("hello").hidden = !face || face.widgets.length > 0 || !byId("templates").hidden;
    if (!drag) drawOverlay();
  }

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
  function union(boxes) {
    const bs = boxes.filter(Boolean);
    if (!bs.length) return null;
    const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
    return { x, y, width: Math.max(...bs.map((b) => b.x + b.width)) - x, height: Math.max(...bs.map((b) => b.y + b.height)) - y };
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
    if (drag && drag.kind === "marquee") {
      const { a, b } = drag;
      svg("rect", { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y), class: "marquee" });
    }
    const o = offset || { dx: 0, dy: 0, k: 1, ax: 0, ay: 0 };
    const pad = 6 * unitsPerPx();
    // a box follows a drag in progress: moved by dx/dy, or scaled k times around the anchor
    const frame = (b, cls) => {
      const x0 = o.ax + (b.x - o.ax) * o.k + o.dx, y0 = o.ay + (b.y - o.ay) * o.k + o.dy;
      svg("rect", { x: x0 - pad, y: y0 - pad, width: b.width * o.k + 2 * pad, height: b.height * o.k + 2 * pad, rx: 4, class: cls });
      return [x0 + b.width * o.k + pad, y0 + b.height * o.k + pad];
    };
    const ids = drag && drag.kind === "marquee" ? drag.hits : sel;
    const boxes = ids.map(boxOf).filter(Boolean);
    if (!boxes.length) return;
    if (boxes.length > 1) {
      for (const b of boxes) frame(b, "box more");
      frame(union(boxes), "box");
      return;
    }
    const [hx, hy] = frame(boxes[0], "box");
    const w = widgetById(ids[0]);
    if (w && F.WIDGETS[w.type].resize && !(drag && drag.kind === "marquee")) {
      const h = 7 * unitsPerPx();
      const handle = svg("rect", { x: hx - h, y: hy - h, width: 2 * h, height: 2 * h, rx: h / 3, class: "handle" });
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
    sel = sel.filter((id) => widgetById(id));
    draw();
    renderLayers();
    if (!opts.fromProps) renderProps();
    renderLook();
    renderBlocks();
    renderHeader();
    scheduleSave();
    pushLook();
  }
  function step(from, to) {
    if (!from.length || !face) return;
    to.push(JSON.stringify(face));
    face = F.normalize(JSON.parse(from.pop()));
    group = null;
    changed();
  }

  // The face on the cooler wears its look through the settings, which the dial follows; a new
  // look goes there at once, as when the face was put on.
  let pushedLook = null;
  function pushLook() {
    const own = ownLook(face);
    const key = JSON.stringify(own);
    if (!onCooler() || key === pushedLook) return;
    pushedLook = key;
    if (Object.keys(own).length) postConfig(own);
  }
  async function postConfig(patch) {
    const r = await fetch("/api/config", { method: "POST", body: JSON.stringify(patch) }).catch(() => null);
    if (r && r.ok) state.config = await r.json();
    renderHeader();
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
        if (face && face.id) history.replaceState(null, "", `/editor?face=${encodeURIComponent(face.id)}`);
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
  async function loadGallery() {
    try {
      const r = await fetch("/api/gallery", { cache: "no-store" });
      if (r.ok) gallery = await r.json();
    } catch (_) {}
  }
  function open(f) {
    face = F.normalize(f);
    sel = [];
    undo = [];
    redo = [];
    group = null;
    pushedLook = onCooler() ? JSON.stringify(ownLook(face)) : null;
    if (face.id) history.replaceState(null, "", `/editor?face=${encodeURIComponent(face.id)}`);
    setSaved("saved");
    setTab("look");
    changedView();
  }
  // Everything shown again, without saving: for a face just opened.
  function changedView() {
    draw();
    renderLayers();
    renderProps();
    renderLook();
    renderBlocks();
    renderHeader();
  }
  // A new face from another one (a copy, the gallery, an import), saved under a new id.
  async function createFace(from) {
    await flush();
    open({ ...from, id: "", name: from.name || t("ed.untitled") });
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
    const on = onCooler();
    const show = byId("show");
    show.textContent = t(on ? "ed.showing" : "ed.show");
    show.classList.toggle("on", on);
  }

  byId("faces").onchange = (e) => switchTo(e.target.value);
  byId("name").oninput = (e) => change((f) => (f.name = e.target.value), "name");
  byId("name").onchange = endGroup;
  byId("undo").onclick = () => step(undo, redo);
  byId("redo").onclick = () => step(redo, undo);
  byId("duplicate").onclick = () => face && createFace({ ...face, name: `${face.name} 2` });
  byId("show").onclick = async () => {
    if (!face) return;
    await flush();
    if (!face.id) return;
    pushedLook = JSON.stringify(ownLook(face));
    await postConfig({ layout: `face:${face.id}`, ...ownLook(face) });
  };
  const menu = byId("menu");
  byId("more").onclick = (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  };
  document.addEventListener("pointerdown", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== byId("more")) menu.hidden = true;
  });
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
    menu.hidden = true;
    clearTimeout(saveTimer);
    saveTimer = null;
    await saving;
    if (face.id) await fetch(`/api/faces?id=${encodeURIComponent(face.id)}`, { method: "DELETE" }).catch(() => {});
    face = null;
    await loadFaces();
    if (faces.length) open(faces[0]);
    else {
      history.replaceState(null, "", "/editor");
      changedView();
      showNew(true);
    }
  };
  byId("export").onclick = () => {
    if (!face) return;
    menu.hidden = true;
    // an own background is a file on this computer only, so it stays behind
    const { bg, look, ...rest } = ownLook(face);
    const out = { version: 1, name: face.name, ...rest, ...(bg && !bg.startsWith("media:") ? { bg } : {}), widgets: face.widgets };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
    a.download = `${face.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "face"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  byId("import").onclick = () => {
    menu.hidden = true;
    byId("import-file").click();
  };
  byId("import-file").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const f = JSON.parse(await file.text());
      if (!f || !Array.isArray(f.widgets)) throw new Error("no widgets");
      await createFace(f);
    } catch (_) {
      setSaved("error", t("ed.importFailed"));
    }
  };

  // ---------- a new face: the gallery ----------

  const GROUPS = ["clock", "gauge", "retro", "minimal", "ai"];
  const pop = byId("templates");
  let popForced = false;
  // A small dial showing a face in its own look; still, so a sheet of them costs nothing.
  function mini(host, f, theme) {
    const c = cfg();
    const d = K.create(host, { ...c, theme: f.theme || theme || c.theme, bg: f.bg || "none", look: f.look || c.look, layout: "face", face: f, animate: false });
    // a few minutes of samples first, so graphs have something to show
    const now = Date.now();
    for (let i = 40; i >= 0; i--) d.update({ ...data(), now: now - i * 3000, hw: sampleHw(now - i * 9000) });
    return d;
  }
  function showNew(forced = false) {
    popForced = forced;
    const list = byId("tpl-list");
    list.replaceChildren();
    const card = (host, title, onPick) => {
      const b = el("button", "tpl");
      b.append(el("div", "thumb"), el("span", null, title));
      b.onclick = onPick;
      host.appendChild(b);
      return b;
    };
    const top = el("div", "tpls");
    list.appendChild(top);
    const blank = card(top, t("ed.blank"), () => pick({ name: t("ed.untitled"), widgets: [] }));
    blank.classList.add("blank");
    blank.firstChild.textContent = "+";
    // faces of limits and costs only once there is a usage source to show them
    const sourced = !!cfg().usage;
    for (const g of GROUPS) {
      const items = gallery.filter((f) => (GROUPS.includes(f.group) ? f.group : "minimal") === g && (sourced || !F.usesSource(f)));
      if (!items.length) continue;
      list.appendChild(el("h3", null, t(`galg.${g}`).toUpperCase()));
      const grid = el("div", "tpls");
      list.appendChild(grid);
      for (const f of items) {
        const b = card(grid, galleryName(f), () => pick({ ...f, name: galleryName(f) }));
        mini(b.firstChild, f);
      }
    }
    pop.hidden = false;
    byId("hello").hidden = true;
    blank.focus();
  }
  function pick(f) {
    pop.hidden = true;
    createFace(f);
  }
  function hideNew() {
    if (pop.hidden) return;
    pop.hidden = true;
    // with nothing to edit, closing the choice still leaves something to work on
    if (popForced && !face) createFace({ name: t("ed.untitled"), widgets: [] });
    tick();
  }
  byId("new").onclick = () => showNew();
  byId("hello-new").onclick = () => showNew();
  byId("templates-close").onclick = hideNew;
  pop.addEventListener("pointerdown", (e) => {
    if (e.target === pop) hideNew();
  });

  // ---------- adding: blocks and widgets ----------

  const PALETTE = ["text", "gauge", "clock", "decor"];
  function renderPalette() {
    const host = byId("palette");
    host.replaceChildren();
    for (const g of PALETTE) {
      const types = Object.keys(F.WIDGETS).filter((type) => F.WIDGETS[type].group === g);
      if (!types.length) continue;
      host.appendChild(el("h3", null, t(`grp.${g}`)));
      const grid = el("div", "palette");
      host.appendChild(grid);
      for (const type of types) {
        const b = el("button", "tool");
        b.append(el("i", null, F.WIDGETS[type].icon), el("span", null, typeName(type)));
        b.title = t(`wd.${type}`);
        draggable(b, typeName(type), () => [F.widget(type, { x: 320, y: 320 })]);
        grid.appendChild(b);
      }
    }
  }
  let blocksKey = "";
  function renderBlocks() {
    const theme = lookNow().theme;
    const key = `${I.lang}|${theme}`;
    if (key === blocksKey) return;
    blocksKey = key;
    const host = byId("blocks");
    host.replaceChildren();
    for (const blk of F.BLOCKS) {
      const b = el("button", "block");
      b.append(el("div", "thumb"), el("span", null, t(`blk.${blk.id}`)));
      draggable(b, t(`blk.${blk.id}`), blk.widgets);
      host.appendChild(b);
      mini(b.firstChild, { widgets: blk.widgets() }, theme);
    }
  }

  // Adds widgets laid out round the middle of the dial, moved to `at`; selects them.
  function add(widgets, at) {
    if (!face || !widgets.length) return;
    let dx = at ? Math.round(at.x - 320) : 0, dy = at ? Math.round(at.y - 320) : 0;
    // added with a click, one lands beside the last instead of on it
    if (!at) while (face.widgets.some((w) => w.x === widgets[0].x + dx && w.y === widgets[0].y + dy && w.type === widgets[0].type)) [dx, dy] = [dx + 16, dy + 16];
    const fresh = widgets.map((w) => ({ ...w, id: F.newId(), x: w.x + dx, y: w.y + dy }));
    change((f) => f.widgets.push(...fresh));
    select(fresh.map((w) => w.id));
    setTab("widget");
  }

  // A palette button: a click adds in the middle, a drag drops where it is let go.
  function draggable(b, label, make) {
    b.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const x0 = e.clientX, y0 = e.clientY;
      let ghost = null;
      const over = (ev) => {
        const r = dialHost.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      };
      const move = (ev) => {
        if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        if (!ghost) {
          ghost = el("div", "ghost", label);
          document.body.appendChild(ghost);
        }
        ghost.style.left = `${ev.clientX}px`;
        ghost.style.top = `${ev.clientY}px`;
        stage.classList.toggle("drop", over(ev));
      };
      const up = (ev) => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
        stage.classList.remove("drop");
        if (!ghost) return add(make());
        ghost.remove();
        if (ev.type === "pointerup" && over(ev)) add(make(), toDial(ev));
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    });
    // Enter or Space on a focused button
    b.addEventListener("click", (e) => e.detail === 0 && add(make()));
  }

  // ---------- layers ----------

  function layerName(w) {
    if (w.name) return w.name;
    if (w.type === "text" || w.type === "arctext") return `${typeName(w.type)} · ${w.text.split("\n")[0].slice(0, 32)}`;
    if (w.source) return `${typeName(w.type)} · ${t(`src.${w.source}`)}`;
    if (w.type === "mascot" && w.mascot !== "auto") return `${typeName(w.type)} · ${t(`mascot.${w.mascot}`)}`;
    return typeName(w.type);
  }
  function renderLayers() {
    const host = byId("layers");
    host.replaceChildren();
    if (!face) return;
    if (!face.widgets.length) {
      host.appendChild(el("div", "empty", t("ed.empty")));
      return;
    }
    // the top of the list is drawn last, on top of the rest
    for (const w of [...face.widgets].reverse()) {
      const row = el("div", `layer${sel.includes(w.id) ? " sel" : ""}${w.hidden ? " off" : ""}`);
      row.append(el("i", null, F.WIDGETS[w.type].icon), el("span", null, layerName(w)));
      const eye = el("button", null, w.hidden ? "◌" : "●");
      eye.title = t("ed.hide");
      eye.onclick = (e) => {
        e.stopPropagation();
        change((f) => (f.widgets.find((x) => x.id === w.id).hidden = !w.hidden));
      };
      row.appendChild(eye);
      row.onclick = (e) => (e.shiftKey || e.ctrlKey || e.metaKey ? toggle(w.id) : select([w.id]));
      host.appendChild(row);
    }
  }

  function select(ids) {
    const next = (ids || []).filter((id) => widgetById(id));
    if (JSON.stringify(next) === JSON.stringify(sel)) return;
    sel = next;
    endGroup();
    renderLayers();
    renderProps();
    drawOverlay();
  }
  const toggle = (id) => select(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);

  // ---------- tabs ----------

  function setTab(name) {
    for (const [id, pane] of [["look", "look"], ["widget", "props"], ["layers", "layers-pane"]]) {
      byId(`tab-${id}`).classList.toggle("on", id === name);
      byId(pane).hidden = id !== name;
    }
  }
  for (const id of ["look", "widget", "layers"]) byId(`tab-${id}`).onclick = () => setTab(id);

  // ---------- the look: theme and background ----------

  const LOOKS = [["plain", "cfg.lookPlain"], ["raw", "cfg.lookRaw"], ["ascii", "cfg.lookAscii"]];
  let lookKey = "", lookOpts = [], uploading = null, pendingMedia = null, uploadError = "";
  // Sets the face's own theme, background or look; null hands it back to the settings.
  function setLook(patch) {
    change((f) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v == null) delete f[k];
        else f[k] = v;
      }
      // the look is for pictures; with another background it goes too
      if (!/^media:/.test(f.bg || "")) delete f.look;
    });
  }
  function renderLook() {
    const host = byId("look");
    const now = lookNow();
    const key = JSON.stringify([I.lang, !!face, now.theme, media.map((m) => m.name), uploading, pendingMedia, uploadError]);
    if (key !== lookKey) {
      lookKey = key;
      buildLook(host, now);
    }
    if (!face) return;
    const c = cfg();
    for (const o of lookOpts) o.b.setAttribute("aria-pressed", String(o.on()));
    const theme = K.THEMES.find((x) => x.id === now.theme), bg = K.BGS.find((x) => x.id === now.bg);
    const named = (n, own) => [el("b", null, n), own ? "" : ` · ${t("ed.follow").toLowerCase()}`];
    host.querySelector(".chosen.theme").replaceChildren(...named(theme ? theme.name : now.theme, face && face.theme));
    host.querySelector(".chosen.bg").replaceChildren(...named(bg ? bg.name : now.bg.replace(/^media:/, "").replace(/\.[^.]+$/, ""), face && face.bg));
    host.querySelector(".media-looks").hidden = !/^media:/.test(now.bg);
    // the follow buttons say what the settings have now
    host.querySelector(".follow.theme small").textContent = t("ed.followNow", { name: (K.THEMES.find((x) => x.id === c.theme) || {}).name || c.theme });
    host.querySelector(".follow.bg small").textContent = t("ed.followNow", { name: (K.BGS.find((x) => x.id === c.bg) || {}).name || c.bg.replace(/^media:/, "") });
  }
  function buildLook(host, now) {
    host.replaceChildren();
    lookOpts = [];
    if (!face) return;
    const opt = (b, on) => (lookOpts.push({ b, on }), b);
    const follow = (cls, key) => {
      const b = el("button", `btn follow ${cls}`);
      b.append(el("span", null, t("ed.follow")), " ", el("small"));
      b.onclick = () => setLook({ [key]: null });
      host.appendChild(opt(b, () => !face[key]));
    };

    host.appendChild(el("h2", null, t("ed.theme")));
    host.appendChild(el("div", "chosen theme"));
    follow("theme", "theme");
    const themes = el("div", "looks");
    host.appendChild(themes);
    for (const th of K.THEMES) {
      const b = el("button", `pick th th-${th.id}`);
      b.style.background = "radial-gradient(circle at 50% 40%, var(--bg-hi), var(--bg-lo))";
      b.appendChild(el("i"));
      b.title = th.name;
      b.onclick = () => setLook({ theme: th.id });
      themes.appendChild(opt(b, () => face.theme === th.id));
    }

    host.appendChild(el("h2", null, t("ed.bg")));
    host.appendChild(el("div", "chosen bg"));
    follow("bg", "bg");
    const bgs = el("div", "looks bgs");
    host.appendChild(bgs);
    const swatch = (parent, id, title) => {
      const b = el("button", "pick");
      const thumb = el("div", "thumb");
      b.appendChild(thumb);
      b.title = title;
      b.onclick = () => setLook({ bg: id, look: /^media:/.test(id) ? face.look || cfg().look : null });
      parent.appendChild(opt(b, () => face.bg === id));
      // still until hovered, like on the settings page
      const back = K.background(thumb, { theme: now.theme, bg: id, look: "plain" });
      b.onmouseenter = () => back.play();
      b.onmouseleave = () => back.pause();
    };
    for (const g of K.BGS) swatch(bgs, g.id, g.name);

    host.appendChild(el("h2", null, t("ed.media")));
    const own = el("div", "looks bgs");
    host.appendChild(own);
    for (const m of media) swatch(own, `media:${m.name}`, m.name);
    for (const busy of [uploading, pendingMedia].filter(Boolean)) {
      const b = el("div", "pick busy", "…");
      b.title = `${busy} · ${t(uploading === busy ? "cfg.uploading" : "cfg.converting")}`;
      own.appendChild(b);
    }
    const addB = el("label", "pick add", "+");
    addB.title = t("ed.mediaAdd");
    const file = el("input");
    Object.assign(file, { type: "file", accept: "video/*,image/*", hidden: true });
    file.onchange = (e) => e.target.files[0] && upload(e.target.files[0]);
    addB.appendChild(file);
    own.appendChild(addB);
    const looks = el("div", "seg media-looks");
    looks.style.marginTop = "12px";
    for (const [key, label] of LOOKS) {
      const b = el("button", "btn", t(label));
      b.onclick = () => setLook({ look: key });
      looks.appendChild(opt(b, () => lookNow().look === key));
    }
    host.appendChild(looks);
    const hint = el("div", "hint", uploadError || `${t("ed.mediaHint")} ${t("ed.lookHint")}`);
    hint.style.marginTop = "14px";
    if (uploadError) hint.style.color = "var(--warn)";
    host.appendChild(hint);
  }
  async function upload(f) {
    const name = f.name.replace(/[^\p{L}\p{N} ._()-]/gu, "-").replace(/^\.+/, "").slice(-120);
    uploading = name;
    uploadError = "";
    renderLook();
    try {
      const r = await fetch(`/api/media?name=${encodeURIComponent(name)}`, { method: "POST", body: f });
      if (!r.ok) throw new Error(await r.text());
      pendingMedia = (await r.json()).name;
    } catch (e) {
      uploadError = t("cfg.addFailed", { name, msg: e.message });
    }
    uploading = null;
    await loadMedia();
  }
  async function loadMedia() {
    try {
      const r = await fetch("/api/media", { cache: "no-store" });
      if (r.ok) media = await r.json();
    } catch (_) {}
    // a converted upload shows up under its final name once ffmpeg is done; then it goes on
    if (pendingMedia && media.some((m) => m.name === pendingMedia)) {
      const id = `media:${pendingMedia}`;
      pendingMedia = null;
      if (face) setLook({ bg: id, look: face.look || cfg().look });
    }
    renderLook();
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
  // Sets one property of a widget; slider moves merge into one undo step.
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
      const ids = Object.keys(F.SOURCES).filter((k) => test(k) && (!spec.gauged || F.GAUGED.includes(k)) && (!spec.digits || F.DIGITAL.includes(k)));
      if (!ids.length) continue;
      const g = label ? el("optgroup") : s;
      if (label) {
        g.label = label;
        s.appendChild(g);
      }
      for (const id of ids) g.appendChild(el("option", null, t(`src.${id}`))).value = id;
    }
    s.value = w[key];
    s.onchange = () => {
      setProp(w, key, s.value);
      renderLayers();
    };
    return s;
  }
  // Swatches of the theme's colours and a picker for any other; `set` gets the colour picked.
  function colorControl(current, set, merge) {
    const box = el("div", "swatches");
    const root = dialHost.firstElementChild;
    const css = root ? getComputedStyle(root) : null;
    for (const [role, v] of Object.entries(F.ROLES)) {
      const b = el("button", `sw${current === role ? " on" : ""}`);
      b.title = t(`c.${role}`);
      b.style.background = css ? css.getPropertyValue(v).trim() : "";
      b.onclick = () => {
        set(role);
        renderProps();
      };
      box.appendChild(b);
    }
    const pick = el("input");
    pick.type = "color";
    pick.value = /^#[0-9a-f]{6}$/i.test(current || "") ? current : "#5b9cff";
    pick.oninput = () => set(pick.value, merge);
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
    for (const id of Object.keys(F.SOURCES)) ins.appendChild(el("option", null, `${t(`src.${id}`)} — {${id}}`)).value = id;
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
    for (const m of media.filter((m) => m.kind !== "video")) s.appendChild(el("option", null, m.name)).value = `media:${m.name}`;
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

  const ALIGN = [["left", "⇤"], ["center", "↔"], ["right", "⇥"], ["top", "⤒"], ["middle", "↕"], ["bottom", "⤓"]];
  function alignRow() {
    const box = el("div", "actions");
    for (const [how, icon] of ALIGN) {
      const b = el("button", "btn icon", icon);
      b.title = t(`ed.align${how[0].toUpperCase()}${how.slice(1)}`);
      b.onclick = () => align(how);
      box.appendChild(b);
    }
    return prop(t("ed.align"), box, t("ed.alignHint"));
  }
  function actionRow(list) {
    const box = el("div", "actions");
    for (const [label, fn] of list) {
      const b = el("button", "btn", label);
      b.onclick = fn;
      box.appendChild(b);
    }
    return box;
  }

  function renderProps() {
    const host = byId("props");
    host.replaceChildren();
    const ws = selected();
    if (!ws.length) {
      host.appendChild(el("div", "empty", face ? t("ed.nothing") : ""));
      return;
    }
    if (ws.length > 1) {
      host.appendChild(el("div", "what", t("ed.selected", { n: ws.length })));
      host.appendChild(actionRow([[t("ed.dup"), duplicate], [t("ed.copy"), copy], [t("ed.remove"), removeSelected]]));
      host.appendChild(alignRow());
      // one colour for all that have one
      const coloured = ws.filter((w) => F.WIDGETS[w.type].props.color);
      if (coloured.length) {
        const same = coloured.every((w) => w.color === coloured[0].color) ? coloured[0].color : null;
        const set = (v, merge) => change((f) => f.widgets.forEach((x) => coloured.some((c) => c.id === x.id) && (x.color = v)), merge ? "colorAll" : null, { fromProps: true });
        host.appendChild(prop(t("ed.colorAll"), colorControl(same, set, true)));
      }
      return;
    }
    const w = ws[0];
    const def = F.WIDGETS[w.type];
    host.appendChild(el("div", "what", typeName(w.type)));
    host.appendChild(actionRow([[t("ed.dup"), duplicate], [t("ed.up"), () => reorder(1)], [t("ed.down"), () => reorder(-1)], [t("ed.remove"), removeSelected]]));
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
          control = colorControl(w[key], (v, merge) => setProp(w, key, v, merge), true);
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
    host.appendChild(alignRow());
  }

  // ---------- editing the selection ----------

  // Copies of widgets with new ids, moved by d; they go in after the last of the originals.
  function insertCopies(ws, d) {
    const copies = ws.map((w) => ({ ...w, id: F.newId(), x: w.x + d, y: w.y + d }));
    change((f) => {
      const at = Math.max(-1, ...ws.map((w) => f.widgets.findIndex((x) => x.id === w.id)));
      f.widgets.splice(at < 0 ? f.widgets.length : at + 1, 0, ...copies);
    });
    select(copies.map((w) => w.id));
  }
  const duplicate = () => selected().length && insertCopies(selected(), 16);
  function removeSelected() {
    const ids = sel.slice();
    if (!ids.length) return;
    change((f) => (f.widgets = f.widgets.filter((x) => !ids.includes(x.id))));
  }
  // Copied widgets live in the browser, so they can be pasted into another face too.
  const CLIP = "krakendial.clipboard";
  function copy() {
    const ws = selected();
    if (ws.length) localStorage.setItem(CLIP, JSON.stringify(ws));
  }
  function paste() {
    let ws;
    try {
      ws = JSON.parse(localStorage.getItem(CLIP) || "[]").map(F.normalizeWidget).filter(Boolean);
    } catch (_) {
      return;
    }
    if (!face || !ws.length) return;
    // into the face they came from, beside the originals; into another, where they were
    const same = ws.some((w) => face.widgets.some((x) => x.id === w.id));
    const copies = ws.map((w) => ({ ...w, id: F.newId(), x: w.x + (same ? 16 : 0), y: w.y + (same ? 16 : 0) }));
    change((f) => f.widgets.push(...copies));
    select(copies.map((w) => w.id));
    setTab("widget");
  }
  // +1 brings the selected widget forward (drawn later), -1 sends it back.
  function reorder(dir) {
    const i = face && sel.length === 1 ? face.widgets.findIndex((x) => x.id === sel[0]) : -1;
    const j = i + dir;
    if (i < 0 || j < 0 || j >= face.widgets.length) return;
    change((f) => ([f.widgets[i], f.widgets[j]] = [f.widgets[j], f.widgets[i]]));
  }
  function nudge(dx, dy) {
    if (!sel.length) return;
    const ids = sel.slice();
    change((f) => f.widgets.forEach((w) => ids.includes(w.id) && ((w.x += dx), (w.y += dy))), `nudge.${ids.join()}`);
  }
  // Lines up the selection: one widget with the dial, several with the box round them all.
  function align(how) {
    const ids = sel.filter((id) => boxOf(id));
    if (!ids.length) return;
    const boxes = Object.fromEntries(ids.map((id) => [id, boxOf(id)]));
    const ref = ids.length > 1 ? union(Object.values(boxes)) : { x: 0, y: 0, width: 640, height: 640 };
    const to = {
      left: (b) => [ref.x - b.x, 0],
      center: (b) => [ref.x + ref.width / 2 - (b.x + b.width / 2), 0],
      right: (b) => [ref.x + ref.width - (b.x + b.width), 0],
      top: (b) => [0, ref.y - b.y],
      middle: (b) => [0, ref.y + ref.height / 2 - (b.y + b.height / 2)],
      bottom: (b) => [0, ref.y + ref.height - (b.y + b.height)],
    }[how];
    change((f) => {
      for (const w of f.widgets) {
        if (!boxes[w.id]) continue;
        const [dx, dy] = to(boxes[w.id]);
        w.x = Math.round(w.x + dx);
        w.y = Math.round(w.y + dy);
      }
    });
  }

  // ---------- pointer: select, move, resize ----------

  // The widget under the pointer: whatever is drawn there or a few pixels off it (thin ticks and
  // lines), else the smallest box round a small widget. Big ones (rings, scales) leave the space
  // inside them free for a marquee.
  function hit(e, p) {
    const near = [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5], [4, 4], [-4, 4], [4, -4], [-4, -4]];
    for (const [dx, dy] of near) {
      for (const n of document.elementsFromPoint(e.clientX + dx, e.clientY + dy)) {
        const g = n.closest && n.closest("[data-w]");
        if (g && dialHost.contains(g)) return g.dataset.w;
      }
    }
    let best = null, area = 160 * 160;
    const pad = 6 * unitsPerPx();
    for (const w of face.widgets) {
      const b = !w.hidden && boxOf(w.id);
      if (!b || p.x < b.x - pad || p.x > b.x + b.width + pad || p.y < b.y - pad || p.y > b.y + b.height + pad) continue;
      if (b.width * b.height < area) [best, area] = [w.id, b.width * b.height];
    }
    return best;
  }
  // The widgets wholly inside the marquee, so a ring round everything stays out of it.
  function inMarquee(a, b) {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    return face.widgets.filter((w) => {
      const bx = !w.hidden && boxOf(w.id);
      return bx && bx.x >= x0 && bx.x + bx.width <= x1 && bx.y >= y0 && bx.y + bx.height <= y1;
    }).map((w) => w.id);
  }

  // Snaps a moved widget (or the box round several) to the centre lines and to the other
  // widgets, unless Alt is held.
  function snap(anchor, b, moving, nx, ny, free) {
    guides = [];
    if (free) return [nx, ny];
    const tol = 7 * unitsPerPx();
    const xs = [320], ys = [320];
    for (const o of face.widgets) if (!moving.includes(o.id) && !o.hidden) xs.push(o.x), ys.push(o.y);
    // the widget's anchor, or the middle of its box, whichever lands closer to a line
    const fit = (v, offsets, lines) => {
      let best = null;
      for (const off of offsets) for (const l of lines) {
        const d = l - (v + off);
        if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, l };
      }
      return best;
    };
    const fx = fit(nx, [0, b.x + b.width / 2 - anchor.x], xs), fy = fit(ny, [0, b.y + b.height / 2 - anchor.y], ys);
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
    if (e.button !== 0 || !face || e.target.closest(".hello")) return;
    const p = toDial(e);
    const one = sel.length === 1 ? widgetById(sel[0]) : null;
    if (e.target.dataset && e.target.dataset.handle && one) {
      drag = { kind: "size", ids: [one.id], w0: { ...one }, d0: Math.max(4, Math.hypot(p.x - one.x, p.y - one.y)), k: 1 };
    } else {
      const id = hit(e, p);
      const more = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!id) {
        // empty space: a marquee, adding to the selection with Shift
        drag = { kind: "marquee", a: p, b: p, keep: more ? sel.slice() : [], hits: more ? sel.slice() : [] };
        if (!more) select([]);
      } else if (more) {
        toggle(id);
        return;
      } else {
        if (!sel.includes(id)) select([id]);
        setTab("widget");
        const anchor = widgetById(id);
        drag = { kind: "move", ids: sel.slice(), anchor: { x: anchor.x, y: anchor.y }, start: p, box: union(sel.map(boxOf)), moved: false, dx: 0, dy: 0 };
      }
    }
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  stage.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = toDial(e);
    if (drag.kind === "marquee") {
      drag.b = p;
      drag.hits = [...new Set([...drag.keep, ...inMarquee(drag.a, drag.b)])];
      drawOverlay();
    } else if (drag.kind === "move") {
      if (!drag.moved && Math.hypot(p.x - drag.start.x, p.y - drag.start.y) < 3 * unitsPerPx()) return;
      drag.moved = true;
      stage.classList.add("dragging");
      const a = drag.anchor;
      const [nx, ny] = snap(a, drag.box || { x: a.x, y: a.y, width: 0, height: 0 }, drag.ids, a.x + p.x - drag.start.x, a.y + p.y - drag.start.y, e.altKey);
      [drag.dx, drag.dy] = [nx - a.x, ny - a.y];
      for (const id of drag.ids) {
        const g = groupOf(id);
        if (g) g.setAttribute("transform", `translate(${drag.dx.toFixed(1)} ${drag.dy.toFixed(1)})`);
      }
      drawOverlay({ dx: drag.dx, dy: drag.dy, k: 1, ax: 0, ay: 0 });
    } else {
      const w0 = drag.w0, g = groupOf(w0.id);
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
    for (const id of d.ids || []) {
      const g = groupOf(id);
      if (g) g.removeAttribute("transform");
    }
    endGroup();
    if (d.kind === "marquee") {
      select(d.hits);
      if (d.hits.length) setTab("widget");
      drawOverlay();
    } else if (d.kind === "move" && d.moved) {
      change((f) => {
        for (const w of f.widgets) {
          if (!d.ids.includes(w.id)) continue;
          w.x = Math.round(w.x + d.dx);
          w.y = Math.round(w.y + d.dy);
        }
      });
    } else if (d.kind === "size" && Math.abs(d.k - 1) > 0.01) {
      change((f) => {
        const w = f.widgets.find((x) => x.id === d.w0.id);
        Object.assign(w, F.WIDGETS[w.type].resize(w, d.k));
      });
    } else drawOverlay();
  }
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("dblclick", (e) => {
    // a double click on text goes straight to its text
    const w = sel.length === 1 && widgetById(sel[0]);
    if (!w || (w.type !== "text" && w.type !== "arctext")) return;
    setTab("widget");
    const field = byId("props").querySelector("textarea, input.field");
    if (field) field.focus();
    e.preventDefault();
  });

  // ---------- keys ----------

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== "range" && e.target.type !== "checkbox";
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
    if (e.key === "Escape") {
      if (!pop.hidden) return hideNew();
      if (!menu.hidden) return (menu.hidden = true);
      if (typing) return e.target.blur();
      return select([]);
    }
    if (mod && key === "z" && !typing) {
      e.preventDefault();
      return e.shiftKey ? step(redo, undo) : step(undo, redo);
    }
    if (mod && key === "y" && !typing) {
      e.preventDefault();
      return step(redo, undo);
    }
    if (typing || !face || !pop.hidden) return;
    if (mod && key === "a") {
      e.preventDefault();
      select(face.widgets.filter((w) => !w.hidden).map((w) => w.id));
      return setTab("widget");
    }
    if (mod && key === "c") return copy();
    if (mod && key === "x") return copy(), removeSelected();
    if (mod && key === "v") {
      e.preventDefault();
      return paste();
    }
    if (mod && key === "d") {
      e.preventDefault();
      return duplicate();
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      return removeSelected();
    }
    const by = e.shiftKey ? 10 : 1;
    const arrows = { ArrowLeft: [-by, 0], ArrowRight: [by, 0], ArrowUp: [0, -by], ArrowDown: [0, by] };
    if (arrows[e.key] && sel.length) {
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
    renderBlocks();
    renderLayers();
    renderProps();
    renderLook();
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
        const restyle = !state.config || ["theme", "bg", "look", "mascot", "units", "cost", "bars", "lang"].some((k) => state.config[k] !== next.config[k]);
        state = next;
        if (I.resolve(state.config.lang) !== builtLang) {
          I.use(state.config.lang);
          translate();
        }
        if (restyle) {
          draw();
          renderBlocks();
          renderLook();
        }
        renderHeader();
      }
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
    setTab("look");
    translate();
    await Promise.all([poll(), loadFaces(), loadMedia(), loadGallery()]);
    // /editor?from=gallery:<id> starts a copy of a gallery face
    const from = /^gallery:(.+)$/.exec(params.get("from") || "");
    const g = from && gallery.find((x) => x.id === from[1]);
    const want = faces.find((x) => x.id === params.get("face"));
    if (g) await createFace({ ...g, name: galleryName(g) });
    else if (want) open(want);
    else if (!params.has("new") && faces.length) open(faces[0]);
    else {
      changedView();
      showNew(true);
    }
    setInterval(poll, 2000);
    setInterval(tick, 1000);
    setInterval(loadMedia, 5000);
  })();
})();
