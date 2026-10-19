// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 kleju13 and KrakenDial contributors
// node tests/web.js
// Builds every layout, face template and widget variant in every language on a fake DOM, and
// checks that translations exist and that bad faces are cleaned up instead of thrown on. It
// catches crashes and missing text, not looks: check those in a browser.
const fs = require("fs");
const path = require("path");

// ---------- a DOM just big enough for the dial ----------

const noop = () => {};
const ctx = new Proxy({}, {
  get: (o, k) => {
    if (k in o) return o[k];
    if (/^create(Radial|Linear|Conic)Gradient$/.test(k)) return () => ({ addColorStop: noop });
    if (k === "createImageData") return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (k === "getImageData") return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (k === "measureText") return () => ({ width: 10 });
    return noop;
  },
  set: (o, k, v) => ((o[k] = v), true),
});
class Node {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.textContent = "";
    this.isConnected = true;
    this.style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } };
    const set = new Set();
    this.classList = {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      toggle: (c, on) => ((on ?? !set.has(c)) ? set.add(c) : set.delete(c)),
      contains: (c) => set.has(c),
    };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(c) { this.children.push(c); return c; }
  append(...c) { this.children.push(...c); }
  insertBefore(c) { this.children.unshift(c); return c; }
  replaceChildren(...c) { this.children = c; }
  remove() {}
  get firstChild() { return this.children[0] || null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  getComputedTextLength() { return 100; }
  getBBox() { return { x: 0, y: 0, width: 10, height: 10 }; }
  getContext() { return ctx; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 640 }; }
  toDataURL() { return "data:image/png;base64,"; }
  addEventListener() {}
  load() {}
  pause() {}
  play() { return Promise.resolve(); }
}
global.window = global;
[global.innerWidth, global.innerHeight] = [640, 640];
Object.defineProperty(global, "navigator", { value: { languages: ["en-GB"], language: "en-GB" }, configurable: true });
global.document = { createElementNS: (ns, t) => new Node(t), createElement: (t) => new Node(t), createTextNode: () => new Node("#text") };
global.getComputedStyle = () => ({ getPropertyValue: (k) => (k.includes("glow") ? "rgba(37, 99, 235, 0.16)" : "#2563eb") });
global.Image = Node;
global.fetch = () => Promise.reject(new Error("offline"));

const errors = [];
console.error = (...a) => errors.push(a.map(String).join(" "));
const web = path.join(__dirname, "..", "web");
for (const f of ["bg.js", "i18n.js", "dial.js", "faces.js"]) eval(fs.readFileSync(path.join(web, f), "utf8"));
const K = window.KrakenDial, F = window.KrakenFaces, I = window.KrakenI18n;

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log("FAIL", msg);
};

// ---------- data ----------

const now = Date.now();
const H = 3600e3;
const hw = { cpu: { name: "CPU", temp: 60, load: 0.3, power: 80, peak: 70 }, gpu: { name: "GPU", temp: 50, load: 0.5, power: 200, peak: 60 }, liquid: 31.2, ram: { used: 20000, total: 32768 } };
const limits = {
  claude5h: { pct: 40, fetchedAt: now - 1000, resetsAt: now + H, windowMs: 5 * H, nextAt: now + 60e3 },
  claude7d: { pct: 100, fetchedAt: now, resetsAt: now + 24 * H, windowMs: 168 * H },
  codex7d: { pct: null, error: "offline", fetchedAt: now - 10 * H },
};
const unset = Object.fromEntries(["claude5h", "claude7d", "codex7d"].map((k) => [k, { pct: null, error: "unset" }]));
// a source that only knows Claude
const claude = { claude5h: limits.claude5h, claude7d: limits.claude7d, codex7d: { pct: null } };
const costs = { last24h: 14.29, today: 0.77, last7d: 1018.66, month: 1418.32, polledAt: now };
const div = () => new Node("div");
let built = 0;

// ---------- translations ----------

const languages = I.LANGS.map((l) => l.id);
const need = (k) => I.t(k) !== k || fail(`${I.lang}: no text for ${k}`);
for (const lang of languages) {
  I.use(lang);
  for (const l of K.LAYOUTS) need(`layout.${l.id}`), need(`layout.${l.id}.desc`), l.hwDesc && need(`layout.${l.id}.descHw`);
  for (const x of K.THEMES) need(`theme.${x.id}`);
  for (const x of K.BGS) need(`bg.${x.id}`);
  for (const x of K.MASCOTS) need(`mascot.${x.id}`);
  for (const x of K.COSTS) need(`cost.${x.id}`);
  for (const id of Object.keys(F.SOURCES)) need(`src.${id}`);
  for (const id of Object.keys(F.ROLES)) need(`c.${id}`);
  for (const tpl of F.TEMPLATES) need(`tpl.${tpl.id}`);
  for (const [type, def] of Object.entries(F.WIDGETS)) {
    need(`w.${type}`);
    for (const [k, spec] of Object.entries(def.props)) {
      need(spec.label || `p.${k}`);
      if (spec.hint) need(spec.hint);
    }
  }
}
// every key used in the pages exists in English
I.use("en");
for (const f of fs.readdirSync(web).filter((f) => /\.(js|html)$/.test(f))) {
  const src = fs.readFileSync(path.join(web, f), "utf8");
  const keys = [...src.matchAll(/\bt\("([a-zA-Z0-9_.]+)"/g), ...src.matchAll(/data-t="([^"]+)"/g)].map((m) => m[1]);
  for (const k of new Set(keys)) if (I.t(k) === k) fail(`${f}: no English text for ${k}`);
}

// ---------- layouts, templates, widgets ----------

for (const lang of languages) {
  for (const l of K.LAYOUTS) {
    const sets = [["left", "last24h", limits], ["used", "off", unset], ["left", "month", {}], ["used", "today", claude], ["left", "last7d", limits, ["codex7d"]], ["left", "off", limits, "none"]];
    for (const [units, cost, lim, on] of sets) {
      const d = K.create(div(), { layout: l.id, theme: "ice", bg: "none", animate: false, units, cost, lang, limits: on });
      d.update({ now, hw, limits: lim, costs, interval: 60e3 });
      d.update({ now, hw: K.emptyHw(), limits: lim, costs: null, interval: 60e3 });
      d.configure({ layout: l.id, theme: "deep", bg: "none", units, cost: cost === "off" ? "today" : "off", lang, limits: on ? undefined : ["claude7d"] });
      for (let i = 1; i < 10; i++) d.update({ now: now + i * 7000, hw, limits: lim, costs, interval: 60e3, mode: i > 5 ? "game" : "work" });
      if (d.layout !== l.id) fail(`layout ${l.id} came out as ${d.layout}`);
      built++;
    }
  }
  // ids from older versions
  const old = K.create(div(), { layout: "zegar", theme: "grafit", bg: "ciecz", animate: false, lang });
  if (old.layout !== "clock") fail(`old id zegar came out as ${old.layout}`);

  for (const tpl of F.TEMPLATES) {
    const face = F.normalize({ id: "t", widgets: tpl.widgets() });
    if (!face.widgets.length && tpl.id !== "blank") fail(`template ${tpl.id} is empty`);
    const d = K.create(div(), { layout: "face:t", face, theme: "ice", bg: "none", animate: false, lang });
    if (d.layout !== "face") fail(`template ${tpl.id} came out as ${d.layout}`);
    for (let i = 0; i < 30; i++) d.update({ now: now + i * 2000, hw, limits, costs, interval: 60e3 });
    d.update({ now, hw: K.emptyHw(), limits: unset, costs: null, interval: 60e3 });
    built++;
  }

  // each widget with its defaults, then each option, source, switch and extreme on its own
  for (const [type, def] of Object.entries(F.WIDGETS)) {
    const variants = [{}];
    for (const [k, spec] of Object.entries(def.props)) {
      if (spec.kind === "select") for (const [v] of spec.options) variants.push({ [k]: v });
      if (spec.kind === "source") for (const s of Object.keys(F.SOURCES)) if (!spec.gauged || F.GAUGED.includes(s)) variants.push({ [k]: s });
      if (spec.kind === "bool") variants.push({ [k]: !spec.default });
      if (spec.kind === "number") variants.push({ [k]: spec.min }, { [k]: spec.max });
      if (spec.kind === "color") variants.push({ [k]: "#ff00aa" }, { [k]: "warn" });
      if (spec.kind === "longtext") variants.push({ [k]: "{cpu.temp} {nope} {date}\nline two {cost}" });
    }
    for (const v of variants) {
      const w = F.widget(type, { x: 320, y: 320, ...v });
      const d = K.create(div(), { layout: "face:w", face: { id: "w", widgets: [w] }, theme: "deep", bg: "none", animate: false, lang, mascot: "crab" });
      d.update({ now, hw, limits, costs, interval: 60e3 });
      d.update({ now: now + 61e3, hw: K.emptyHw(), limits: unset, costs: null, interval: 60e3 });
      if (def.resize) {
        const r = def.resize(w, 1.5);
        if (!r || typeof r !== "object") fail(`${type}: resize returned ${r}`);
      }
      built++;
    }
  }
}

// ---------- what the built-in layouts show ----------

// Without a usage source no layout mentions AI or a missing source, and a limit switched off or
// not sent is left out. Only text written as text is seen, which is all the labels.
const textOf = (n) => [n.textContent, ...n.children.map(textOf)].join(" ");
I.use("en");
const shown = (layout, lim, on, withCosts) => {
  const box = div();
  K.create(box, { layout, theme: "ice", bg: "none", animate: false, lang: "en", limits: on }).update({ now, hw, limits: lim, costs: withCosts ? costs : null, interval: 60e3 });
  return textOf(box);
};
const dead = [I.t("st.noSource"), I.t("unit.left"), I.t("unit.used"), I.t("lbl.cost")];
for (const l of K.LAYOUTS) {
  // the same walk does see the limits where they are shown (pfetch names them 5h, 7d, codex)
  if (!["hardware", "one"].includes(l.id) && !/claude|codex/i.test(shown(l.id, limits))) fail(`${l.id}: no limits with limits on`);
  const none = shown(l.id, unset);
  if (/claude|codex/i.test(none)) fail(`${l.id}: mentions AI with no usage source`);
  for (const s of dead) if (none.includes(s)) fail(`${l.id}: shows "${s}" with no usage source`);
  if (/claude|codex/i.test(shown(l.id, limits, "none", true))) fail(`${l.id}: shows limits switched off`);
  if (/codex/i.test(shown(l.id, claude, undefined, true))) fail(`${l.id}: shows Codex the source doesn't send`);
  if (/codex/i.test(shown(l.id, limits, ["claude5h", "claude7d"]))) fail(`${l.id}: shows Codex switched off`);
}
// the templates other than the limits one are hardware only, and a face's status line gives way
// to the date when there is no usage source
for (const tpl of F.TEMPLATES.filter((x) => x.id !== "limits")) {
  const box = div();
  const face = F.normalize({ id: "t", widgets: tpl.widgets() });
  K.create(box, { layout: "face:t", face, theme: "ice", bg: "none", animate: false, lang: "en" }).update({ now, hw, limits: unset, costs: null, interval: 60e3 });
  const s = textOf(box);
  if (/claude|codex/i.test(s) || s.includes(I.t("st.noSource"))) fail(`template ${tpl.id}: mentions AI with no usage source`);
}

// ---------- bad faces ----------

const junk = [
  null, 5, "x", {}, { widgets: "no" },
  { widgets: [null, 1, { type: "nope" }, { type: "value", x: "a", size: 1e9, source: "evil", color: "red;}" }] },
  { id: "../etc", name: "<b>x</b>", widgets: Array(500).fill({ type: "text", text: "a" }) },
  { widgets: [{ type: "image", src: "javascript:alert(1)" }, { type: "image", src: "media:../../x" }] },
];
for (const j of junk) {
  const n = F.normalize(j);
  if (!Array.isArray(n.widgets)) fail("normalize: widgets is not a list");
  if (n.widgets.length > 200) fail("normalize: more than 200 widgets");
  if (n.id && !/^[a-z0-9-]{1,40}$/.test(n.id)) fail(`normalize: id ${n.id}`);
  const ids = n.widgets.map((w) => w.id);
  if (new Set(ids).size !== ids.length) fail("normalize: duplicate widget ids");
  for (const w of n.widgets) {
    if (!F.WIDGETS[w.type]) fail(`normalize: type ${w.type}`);
    if (w.color && !F.ROLES[w.color] && !/^#[0-9a-f]{6}$/i.test(w.color)) fail(`normalize: colour ${w.color}`);
    if (w.source && !F.SOURCES[w.source]) fail(`normalize: source ${w.source}`);
    if (w.src && !/^media:[^/\\]+$/.test(w.src)) fail(`normalize: picture ${w.src}`);
  }
  K.create(div(), { layout: "face:x", face: n, theme: "ice", bg: "none", animate: false }).update({ now, hw, limits, costs });
}
const big = F.normalize({ widgets: [{ type: "value", size: 1e9 }] }).widgets[0];
if (big.size !== F.WIDGETS.value.props.size.max) fail(`normalize: size ${big.size} not clamped`);
for (const tpl of F.TEMPLATES) {
  const a = F.normalize({ id: "x", name: "n", widgets: tpl.widgets() });
  if (JSON.stringify(F.normalize(JSON.parse(JSON.stringify(a)))) !== JSON.stringify(a)) fail(`normalize: template ${tpl.id} changes on a second pass`);
}

// ---------- camless mode ----------
// A background goes to camless as a whole loop, every frame once, and the dial goes bare; off
// again, camless gets the screen back. Without camless the setting does nothing.

async function camlessMode() {
  const calls = [];
  const background = Object.fromEntries(["begin", "frame", "end", "clear", "speed"].map((op) => [op, async (...a) => {
    calls.push([op, ...a.filter((x) => typeof x !== "string")]);
  }]));
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const cfg = { layout: "cockpit", theme: "deep", bg: "liquid", fps: 10, animate: false };

  const alone = K.create(div(), cfg);
  alone.camless(true);
  await settle();
  if (calls.length) fail("camless: messages without camless");

  global.nzxt = { v1: { camless: { background } } };
  const host = div();
  const d = K.create(host, cfg);
  const bare = () => host.children[0].classList.contains("is-bare");
  d.camless(true);
  await settle();
  const frames = calls.filter((c) => c[0] === "frame").map((c) => c[1]).sort((a, b) => a - b);
  if (JSON.stringify(calls[0]) !== JSON.stringify(["begin", 10, 200])) fail(`camless: began with ${JSON.stringify(calls[0])}`);
  if (frames.join() !== [...Array(200).keys()].join()) fail("camless: not every frame of the loop went once");
  if (!calls.some((c) => c[0] === "end") || !bare()) fail("camless: the loop did not start");
  d.setActivity(1);
  if (JSON.stringify(calls.at(-1)) !== JSON.stringify(["speed", 3.2])) fail(`camless: speed went as ${JSON.stringify(calls.at(-1))}`);

  // nothing changed: nothing is sent; a still background is one frame
  const before = calls.length;
  d.configure(cfg);
  d.camless(true);
  await settle();
  if (calls.length !== before) fail("camless: an unchanged background was sent again");
  d.configure({ ...cfg, bg: "none" });
  d.camless(true);
  await settle();
  const still = calls.slice(before).map((c) => c[0]).join();
  if (still !== "begin,frame,end" || !bare()) fail(`camless: a still background went as ${still}`);

  d.camless(false);
  await settle();
  if (calls.at(-1)[0] !== "clear" || bare()) fail("camless: switching it off did not give the screen back");
  delete global.nzxt;
}

camlessMode().then(() => {
  for (const e of errors) fail(`console.error: ${e}`);
  console.log(`${built} dials built in ${languages.join(", ")}; ${failures ? `${failures} failures` : "all good"}`);
  process.exit(failures ? 1 : 0);
});
