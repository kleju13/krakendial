// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 kleju13 and KrakenDial contributors
// Moving backgrounds for the Kraken dial, painted on one canvas a few times a second.
// CAM captures and ships every frame that changes, at a real CPU cost per frame, so the frame
// rate is a setting (10/20/30) and between frames the page stays idle. Soft light is painted
// at 256 px (the upscale is invisible), line work at 384–512 px, the user's own media at 640 px.
//   const back = KrakenBg.backdrop(canvas, root);  // root carries the theme's custom properties
//   back.set("aurora", animate);                   // or "media:<file>" from the media folder
//   back.play(); back.pause(); back.speed(1.6); back.fps(10);
//   back.look("ascii");                            // own media: "plain" (tinted), "raw" or "ascii"
//   await back.bake(link, wanted);                 // camless mode: the background as a loop for camless
(function () {
  // The drawn backgrounds; their names are in i18n.js under bg.<id>.
  const LIST = [
    { id: "liquid" },
    { id: "ripples" },
    { id: "bubbles" },
    { id: "aurora" },
    { id: "flow" },
    { id: "nebula" },
    { id: "stars" },
    { id: "bokeh" },
    { id: "silk" },
    { id: "contours" },
    { id: "vortex" },
    { id: "honeycomb" },
    { id: "grid" },
    { id: "rain" },
    { id: "donut" },
    { id: "fire" },
    { id: "life" },
    { id: "pipes" },
    { id: "none" },
  ];

  const TAU = 2 * Math.PI;
  const ease = (x) => (1 - Math.cos(Math.PI * x)) / 2;
  const pingPong = (t, period) => {
    const q = (t / period) % 2;
    return ease(q < 1 ? q : 2 - q);
  };
  const rgba = (c, k = 1) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] * k).toFixed(3)})`;
  const solid = (c) => [c[0], c[1], c[2], 1];
  // Seeded, so every dial shows the same sky.
  function seeded(seed, n, make) {
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: n }, () => make(rnd));
  }
  function ihash(n) {
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    return (n ^ (n >>> 16)) >>> 0;
  }
  const hash = (n) => ihash(n) / 4294967296;

  function parseColor(v) {
    v = v.trim();
    if (v[0] === "#") {
      const h = v.length === 4 ? [...v.slice(1)].map((c) => c + c).join("") : v.slice(1, 7);
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
    }
    const n = (v.match(/[\d.]+/g) || []).map(Number);
    return [n[0] || 0, n[1] || 0, n[2] || 0, n.length > 3 ? n[3] : 1];
  }
  function palette(root) {
    const cs = getComputedStyle(root);
    const get = (k) => parseColor(cs.getPropertyValue(k));
    const lo = get("--bg-lo");
    return {
      a: get("--glow-a"),
      b: get("--glow-b"),
      line: solid(get("--fill")),
      line2: solid(get("--fill-2")),
      ink: solid(get("--ink")),
      lo,
      hi: get("--bg-hi"),
      dark: 0.3 * lo[0] + 0.59 * lo[1] + 0.11 * lo[2] < 128,
    };
  }
  function glow(ctx, x, y, r, c) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(c));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }

  // Ken Perlin's improved noise, roughly -1..1.
  const PERM = (() => {
    const order = seeded(3, 256, (r) => r())
      .map((v, i) => [v, i])
      .sort((a, b) => a[0] - b[0])
      .map((x) => x[1]);
    return Uint8Array.from(order.concat(order));
  })();
  const fade = (x) => x * x * x * (x * (x * 6 - 15) + 10);
  const lerp = (a, b, k) => a + (b - a) * k;
  function grad(h, x, y, z) {
    h &= 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return (h & 1 ? -u : u) + (h & 2 ? -v : v);
  }
  function noise(x, y, z) {
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    x -= fx;
    y -= fy;
    z -= fz;
    const u = fade(x), v = fade(y), w = fade(z);
    const P = PERM;
    const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z;
    const B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
    return lerp(
      lerp(lerp(grad(P[AA], x, y, z), grad(P[BA], x - 1, y, z), u), lerp(grad(P[AB], x, y - 1, z), grad(P[BB], x - 1, y - 1, z), u), v),
      lerp(
        lerp(grad(P[AA + 1], x, y, z - 1), grad(P[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(P[AB + 1], x, y - 1, z - 1), grad(P[BB + 1], x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    );
  }

  // A cloud of one colour, computed once per theme and then only rotated.
  const clouds = new Map();
  function cloud(c, seed) {
    const key = `${c}|${seed}`;
    if (clouds.has(key)) return clouds.get(key);
    const n = 128;
    const cv = document.createElement("canvas");
    cv.width = cv.height = n;
    const g = cv.getContext("2d");
    const img = g.createImageData(n, n);
    const alpha = Math.min(1, c[3] * 2.2);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let v = 0;
        for (let o = 0, amp = 1, f = 2.4 / n; o < 5; o++, amp *= 0.5, f *= 2) v += amp * noise(x * f, y * f, seed + o * 1.7);
        const d = Math.max(0, Math.min(1, (v + 0.1) * 1.5)) ** 2;
        const i = (y * n + x) * 4;
        img.data[i] = c[0];
        img.data[i + 1] = c[1];
        img.data[i + 2] = c[2];
        img.data[i + 3] = Math.round(255 * alpha * d);
      }
    }
    g.putImageData(img, 0, 0);
    clouds.set(key, cv);
    return cv;
  }

  const BUBBLES = seeded(7, 14, (rnd) => {
    const x = 0.06 + rnd() * 0.86, w = 0.013 + rnd() * 0.024, dur = 16 + rnd() * 18;
    return { x, w, dur, delay: rnd() * dur, sway: 3 + rnd() * 4 };
  });
  const STARS = seeded(11, 240, (r) => ({
    a: r() * TAU,
    d: Math.sqrt(r()) * 1.02,
    size: 0.55 + r() ** 4 * 2,
    tw: 0.4 + r() * 1.8,
    ph: r() * TAU,
    far: r() < 0.65,
  }));
  const BOKEH = seeded(5, 17, (r) => ({
    x: 0.1 + r() * 0.8,
    y: 0.1 + r() * 0.8,
    rad: 0.04 + r() ** 2 * 0.12,
    px: 30 + r() * 40,
    py: 40 + r() * 50,
    ph: r() * TAU,
    second: r() < 0.5,
    k: 0.5 + r() * 0.5,
  }));
  const DROPS = seeded(17, 26, (r) => ({ v: 1.4 + r() * 2.4, len: 6 + Math.floor(r() * 10), gap: 6 + r() * 22, ph: r() * 60 }));
  const GLYPHS = "01ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜ<>{}[]/=+*";
  const WHIRL = seeded(23, 120, (r) => ({ a: r() * TAU, life: 16 + r() * 22, ph: r(), w: 0.6 + r() * 1.5, second: r() < 0.4 }));
  // Marching squares: which cell edges (0 top, 1 right, 2 bottom, 3 left) each corner pattern joins.
  const CONTOUR = [[], [3, 2], [2, 1], [3, 1], [0, 1], [3, 0, 2, 1], [0, 2], [3, 0], [3, 0], [0, 2], [0, 1, 3, 2], [0, 1], [3, 1], [2, 1], [3, 2], []];
  let field = null;

  // Character cells like a terminal's: w wide, 1.7 w tall.
  const grid = (s, cols) => {
    const w = s / cols, h = w * 1.7;
    return { w, h, cols, rows: Math.ceil(s / h) };
  };
  const RAMP = " .:-=+*#%@";
  const SHADE = ".,-~:;=!*#$@";
  // Glyphs pre-rendered in one colour, so a screen of characters costs drawImage calls, not text layout.
  const atlases = new Map();
  function atlas(chars, c, g) {
    const key = `${chars}|${c}|${g.w}`;
    if (atlases.has(key)) return atlases.get(key);
    const cw = Math.ceil(g.w), ch = Math.ceil(g.h);
    const cv = document.createElement("canvas");
    cv.width = cw * chars.length;
    cv.height = ch;
    const x = cv.getContext("2d");
    x.font = `${Math.round(g.h * 0.82)}px "Cascadia Mono", Consolas, monospace`;
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillStyle = rgba(c);
    [...chars].forEach((k, i) => x.fillText(k, i * cw + cw / 2, ch / 2));
    const a = { cv, cw, ch };
    atlases.set(key, a);
    return a;
  }
  const stamp = (ctx, a, i, x, y, g) => ctx.drawImage(a.cv, i * a.cw, 0, a.cw, a.ch, x, y, g.w, g.h);
  const TRIG = Array.from({ length: 315 }, (_, i) => [Math.sin(i * 0.02), Math.cos(i * 0.02)]);

  function stars(ctx, t, s, p, n, scale, keep = () => true) {
    ctx.fillStyle = rgba(p.dark ? p.ink : p.line);
    const c = s / 2;
    for (let i = 0; i < n; i++) {
      const st = STARS[i];
      const a = st.a + t * (st.far ? 0.004 : 0.009);
      const x = c + st.d * c * Math.cos(a), y = c + st.d * c * Math.sin(a);
      if (!keep(x, y)) continue;
      const k = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * st.tw + st.ph)) ** 2;
      ctx.globalAlpha = k * (st.far ? 0.55 : 0.95) * (p.dark ? 1 : 0.55);
      ctx.beginPath();
      ctx.arc(x, y, st.size * scale, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Each painter draws the moment t (seconds) on an s×s canvas already clipped to the dial.
  const PAINT = {
    // liquid: soft pools of light orbiting slowly, like coolant swirling in the pump
    liquid: {
      paint(ctx, t, s, p) {
        for (const [period, ox, oy, r, c] of [[48, 0.19, -0.08, 0.35, p.a], [-66, -0.21, 0.11, 0.34, p.b], [84, 0.05, 0.24, 0.26, p.a]]) {
          const a = (TAU * t) / period;
          glow(ctx, s * (0.5 + ox * Math.cos(a) - oy * Math.sin(a)), s * (0.5 + ox * Math.sin(a) + oy * Math.cos(a)), s * r, c);
        }
      },
    },
    // ripples: slow ripples spreading from the centre
    ripples: {
      paint(ctx, t, s, p) {
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
    },
    // bubbles: a few bubbles drifting up
    bubbles: {
      paint(ctx, t, s, p) {
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
    },
    // aurora: two broad bands of light breathing across the dial
    aurora: {
      paint(ctx, t, s, p) {
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
    },
    // flow: light circulating around the rim, the flow through the pump
    flow: {
      paint(ctx, t, s, p) {
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
    },
    // nebula: two clouds turning against each other, a handful of stars in front
    nebula: {
      res: 320,
      paint(ctx, t, s, p) {
        const c = s / 2;
        if (p.dark) ctx.globalCompositeOperation = "lighter";
        for (const [tex, turn, k, from] of [[cloud(p.a, 0.3), 0.011, 1.45, 0], [cloud(p.b, 5.1), -0.016, 1.2, 2]]) {
          ctx.save();
          ctx.translate(c, c);
          ctx.rotate(from + t * turn);
          ctx.scale(k, k);
          ctx.drawImage(tex, -c, -c, s, s);
          ctx.restore();
        }
        ctx.globalCompositeOperation = "source-over";
        stars(ctx, t, s, p, 70, s / 640);
      },
    },
    // stars: a slowly turning sky, twinkling, with a meteor now and then
    stars: {
      res: 512,
      paint(ctx, t, s, p) {
        const c = s / 2;
        glow(ctx, c * 1.3, c * 0.7, s * 0.5, p.a);
        glow(ctx, c * 0.6, c * 1.4, s * 0.38, p.b);
        stars(ctx, t, s, p, STARS.length, s / 512);
        const cycle = Math.floor(t / 19), q = t - cycle * 19;
        if (q > 1.3) return;
        const k = q / 1.3, star = p.dark ? p.ink : p.line;
        const dir = hash(cycle * 7 + 1) < 0.5 ? 1 : -1;
        const ang = 0.45 + hash(cycle * 7 + 2) * 0.5;
        const dx = Math.cos(ang) * dir, dy = Math.sin(ang);
        const sx = s * (0.5 - dir * (0.05 + 0.2 * hash(cycle * 7 + 3))), sy = s * (0.1 + 0.22 * hash(cycle * 7 + 4));
        const hx = sx + dx * s * 0.5 * k, hy = sy + dy * s * 0.5 * k, len = s * 0.16;
        const g = ctx.createLinearGradient(hx - dx * len, hy - dy * len, hx, hy);
        g.addColorStop(0, rgba(star, 0));
        g.addColorStop(1, rgba(star, 0.9 * Math.sin(Math.PI * k)));
        ctx.strokeStyle = g;
        ctx.lineWidth = s / 300;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(hx - dx * len, hy - dy * len);
        ctx.lineTo(hx, hy);
        ctx.stroke();
      },
    },
    // bokeh: out-of-focus lights drifting and breathing
    bokeh: {
      paint(ctx, t, s, p) {
        for (const b of BOKEH) {
          const x = s * (b.x + 0.06 * Math.sin((TAU * t) / b.px + b.ph));
          const y = s * (b.y + 0.06 * Math.cos((TAU * t) / b.py + b.ph));
          const r = s * b.rad;
          const c = b.second ? p.b : p.a;
          const k = b.k * (0.7 + 0.3 * Math.sin((TAU * t) / (b.px * 0.6) + b.ph)) * 1.6;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, rgba(c, 0.5 * k));
          g.addColorStop(0.82, rgba(c, 0.75 * k));
          g.addColorStop(0.93, rgba(c, k));
          g.addColorStop(1, rgba(c, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TAU);
          ctx.fill();
        }
      },
    },
    // silk: two ribbons of fine threads twisting slowly across the dial
    silk: {
      res: 512,
      paint(ctx, t, s, p) {
        ctx.lineWidth = s / 400;
        const N = 48;
        for (const [cy, amp, wid, w1, w2, ph, col] of [[0.43, 0.15, 0.3, 0.17, 0.23, 0, p.line], [0.6, 0.12, 0.24, -0.13, 0.19, 2.1, p.line2]]) {
          for (let i = 0; i < 16; i++) {
            const f = i / 15 - 0.5;
            ctx.beginPath();
            for (let j = 0; j <= N; j++) {
              const u = j / N, env = Math.sin(Math.PI * u);
              const mid = cy + env * amp * Math.sin(TAU * u * 0.8 + t * w1 + ph);
              const width = env * wid * Math.sin(TAU * u * 0.9 + t * w2 + ph * 1.7);
              const y = (mid + f * width) * s;
              if (j) ctx.lineTo(u * s, y);
              else ctx.moveTo(u * s, y);
            }
            ctx.strokeStyle = rgba(col, (0.1 + 0.26 * (1 - Math.abs(f) * 2)) * (p.dark ? 1 : 0.85));
            ctx.stroke();
          }
        }
      },
    },
    // contours: contour lines of a landscape that slowly reshapes itself
    contours: {
      res: 512,
      paint(ctx, t, s, p) {
        const G = 44, W = G + 1, cs = s / G, z = t * 0.035, c = s / 2;
        if (!field) field = new Float32Array(W * W);
        for (let j = 0; j <= G; j++) {
          for (let i = 0; i <= G; i++) {
            const x = (i / G) * 2.6, y = (j / G) * 2.6;
            field[j * W + i] = noise(x, y, z) + 0.45 * noise(x * 2.1 + 5.3, y * 2.1 + 1.7, z * 1.4 + 3);
          }
        }
        for (let li = 0; li < 12; li++) {
          const lv = -0.66 + li * 0.12;
          ctx.beginPath();
          for (let j = 0; j < G; j++) {
            for (let i = 0; i < G; i++) {
              const x0 = i * cs, y0 = j * cs;
              if ((x0 + cs / 2 - c) ** 2 + (y0 + cs / 2 - c) ** 2 > (c + cs) ** 2) continue;
              const k = j * W + i;
              const a = field[k], b = field[k + 1], cc = field[k + W + 1], d = field[k + W];
              const segs = CONTOUR[(a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (cc > lv ? 2 : 0) | (d > lv ? 1 : 0)];
              for (let m = 0; m < segs.length; m++) {
                const e = segs[m];
                const px = e === 0 ? x0 + (cs * (lv - a)) / (b - a) : e === 1 ? x0 + cs : e === 2 ? x0 + (cs * (lv - d)) / (cc - d) : x0;
                const py = e === 0 ? y0 : e === 1 ? y0 + (cs * (lv - b)) / (cc - b) : e === 2 ? y0 + cs : y0 + (cs * (lv - a)) / (d - a);
                if (m % 2) ctx.lineTo(px, py);
                else ctx.moveTo(px, py);
              }
            }
          }
          const major = li % 4 === 1;
          ctx.strokeStyle = rgba(p.line, (major ? 0.42 : 0.2) * (p.dark ? 1 : 0.85));
          ctx.lineWidth = ((major ? 1.7 : 1) * s) / 512;
          ctx.stroke();
        }
      },
    },
    // vortex: streaks of light spiralling into the centre, faster as they sink
    vortex: {
      res: 384,
      paint(ctx, t, s, p) {
        const c = s / 2;
        glow(ctx, c, c, s * 0.36, p.a);
        glow(ctx, c, c, s * 0.14, p.b);
        ctx.lineCap = "round";
        for (const m of WHIRL) {
          const q = (t / m.life + m.ph) % 1;
          const r = c * (1.02 - 0.92 * q ** 0.8);
          const a = m.a + 2.2 * -Math.log(1 - 0.94 * q) + t * 0.05;
          const rate = (2.2 * 0.94) / (1 - 0.94 * q) / m.life + 0.05;
          const len = Math.min(1.3, rate * 1.7);
          const k = Math.min(1, q * 8, (1 - q) * 4);
          ctx.strokeStyle = rgba(m.second ? p.line2 : p.line, 0.5 * k * (p.dark ? 1 : 0.8));
          ctx.lineWidth = (m.w * s) / 384;
          ctx.beginPath();
          ctx.arc(c, c, r, a - len, a);
          ctx.stroke();
        }
      },
    },
    // honeycomb: a honeycomb with pulses rippling out from the pump, and the odd cell lighting up
    honeycomb: {
      res: 512,
      paint(ctx, t, s, p) {
        const R = s / 21, w = Math.sqrt(3) * R, h = 1.5 * R, c = s / 2;
        const lit = Array.from({ length: 6 }, () => []);
        ctx.beginPath();
        for (let row = 0; row * h < s + R; row++) {
          for (let col = -1; col * w < s + w; col++) {
            const x = col * w + (row & 1 ? w / 2 : 0), y = row * h;
            const d = Math.hypot(x - c, y - c) / c;
            if (d > 1.1) continue;
            hex(ctx, x, y, R * 0.94);
            let k = Math.max(0, Math.sin(d * 5.5 - t * 1.1)) ** 6 * (1 - 0.45 * d);
            const id = row * 97 + col + 1000, slot = Math.floor(t / 3.5 + hash(id) * 9);
            if (hash(id * 31 + slot) < 0.05) k = Math.max(k, 0.8 * Math.sin((Math.PI * ((t / 3.5 + hash(id) * 9) % 1))));
            if (k > 0.06) lit[Math.min(5, Math.floor(k * 6))].push([x, y]);
          }
        }
        ctx.strokeStyle = rgba(p.line, p.dark ? 0.16 : 0.13);
        ctx.lineWidth = s / 512;
        ctx.stroke();
        lit.forEach((cells, i) => {
          if (!cells.length) return;
          ctx.beginPath();
          for (const [x, y] of cells) hex(ctx, x, y, R * 0.8);
          ctx.fillStyle = rgba(p.line, ((i + 1) / 6) * (p.dark ? 0.3 : 0.2));
          ctx.fill();
        });
      },
    },
    // grid: a grid floor running towards a glowing horizon
    grid: {
      res: 512,
      paint(ctx, t, s, p) {
        const hz = s * 0.6, vx = s / 2, f = s * 0.5, zn = f / (s - hz);
        stars(ctx, t, s, p, 90, s / 512, (x, y) => y < hz - 6);
        ctx.save();
        ctx.translate(vx, hz);
        ctx.scale(1, 0.3);
        glow(ctx, 0, 0, s * 0.64, p.a);
        ctx.restore();
        glow(ctx, vx, hz, s * 0.2, p.b);
        const g = ctx.createLinearGradient(0, hz, 0, s);
        g.addColorStop(0, rgba(p.line, 0));
        g.addColorStop(0.3, rgba(p.line, 0.2));
        g.addColorStop(1, rgba(p.line, p.dark ? 0.5 : 0.38));
        ctx.strokeStyle = g;
        ctx.lineWidth = s / 400;
        ctx.beginPath();
        for (let k = -16; k <= 16; k++) {
          ctx.moveTo(vx + (f * k * 0.5) / zn, s);
          ctx.lineTo(vx, hz);
        }
        const step = 0.5, off = (t * 0.45) % step;
        for (let Z = step - off; Z < 24; Z += step) {
          if (Z < zn) continue;
          const y = hz + f / Z;
          ctx.moveTo(0, y);
          ctx.lineTo(s, y);
        }
        ctx.stroke();
      },
    },
    // rain: columns of glyphs falling, quietly
    rain: {
      res: 384,
      paint(ctx, t, s, p) {
        const n = DROPS.length, cw = s / n, rows = Math.ceil(s / cw);
        ctx.font = `${Math.round(cw * 0.9)}px "Cascadia Mono", Consolas, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const dim = p.dark ? 1 : 0.7;
        DROPS.forEach((d, i) => {
          const head = Math.floor((t * d.v + d.ph) % (rows + d.len + d.gap));
          for (let k = 0; k < d.len; k++) {
            const row = head - k;
            if (row < 0 || row >= rows) continue;
            const tick = Math.floor(t * 1.3 + i * 7 + row * 3);
            const g = GLYPHS[ihash(i * 131 + row * 17 + (k === 0 ? tick : Math.floor(tick / 5)) * 7919) % GLYPHS.length];
            ctx.fillStyle = rgba(k === 0 ? p.ink : p.line, (k === 0 ? 0.7 : 0.45 * (1 - k / d.len)) * dim);
            ctx.fillText(g, (i + 0.5) * cw, row * cw);
          }
        });
      },
    },
    // donut: the spinning ASCII torus of donut.c, shaded with its .,-~:;=!*#$@
    donut: {
      res: 512,
      paint(ctx, t, s, p) {
        const g = grid(s, 56), A = t * 0.5, B = t * 0.23;
        const n = g.cols * g.rows, z = new Float32Array(n), lum = new Int8Array(n).fill(-1);
        const sA = Math.sin(A), cA = Math.cos(A), sB = Math.sin(B), cB = Math.cos(B);
        const kx = g.cols * 0.44, ky = (kx * g.w) / g.h, cx = g.cols / 2, cy = g.rows / 2;
        for (let j = 0; j < 6.28; j += 0.07) {
          const sj = Math.sin(j), cj = Math.cos(j), h = cj + 2;
          for (const [si, ci] of TRIG) {
            const D = 1 / (si * h * sA + sj * cA + 5), q = si * h * cA - sj * sA;
            const x = Math.floor(cx + kx * D * (ci * h * cB - q * sB));
            const y = Math.floor(cy + ky * D * (ci * h * sB + q * cB));
            const o = x + g.cols * y;
            if (x < 0 || x >= g.cols || y < 0 || y >= g.rows || D <= z[o]) continue;
            z[o] = D;
            lum[o] = Math.max(0, Math.floor(8 * ((sj * sA - si * cj * cA) * cB - si * cj * sA - sj * cA - ci * cj * sB)));
          }
        }
        const a = atlas(SHADE, p.dark ? p.line2 : p.line, g);
        for (let o = 0; o < n; o++) {
          if (lum[o] < 0) continue;
          ctx.globalAlpha = (0.2 + 0.035 * lum[o]) * (p.dark ? 0.8 : 0.65);
          stamp(ctx, a, Math.min(11, lum[o]), (o % g.cols) * g.w, Math.floor(o / g.cols) * g.h, g);
        }
        ctx.globalAlpha = 1;
      },
    },
    // fire: a gas flame in characters, licking up from the bottom of the dial
    fire: {
      res: 448,
      paint(ctx, t, s, p, st) {
        const g = grid(s, 52), W = g.cols, H = g.rows;
        if (!st.heat) {
          st.heat = new Float32Array(W * (H + 2));
          st.t = t;
          for (let i = 0; i < 80; i++) fireStep(st.heat, W, H, t - (80 - i) / 16);
        }
        const steps = Math.min(16, Math.floor((t - st.t) * 16));
        for (let i = 0; i < steps; i++) fireStep(st.heat, W, H, st.t + i / 16);
        st.t += steps / 16;
        const layers = [atlas(RAMP, p.line2, g), atlas(RAMP, p.line, g), atlas(RAMP, p.dark ? p.ink : p.line, g)];
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const v = Math.min(1, st.heat[y * W + x] * 1.3);
            if (v < 0.1) continue;
            ctx.globalAlpha = (0.2 + 0.8 * v) * (p.dark ? 0.6 : 0.5);
            stamp(ctx, layers[v > 0.7 ? 2 : v > 0.35 ? 1 : 0], Math.min(9, Math.floor(v * 10)), x * g.w, y * g.h, g);
          }
        }
        ctx.globalAlpha = 1;
      },
    },
    // life: Conway's Game of Life with fading afterglow; it reseeds itself when it settles down
    life: {
      res: 512,
      idle: (t, st) => st.cells && t - st.t < LIFE_STEP,
      paint(ctx, t, s, p, st) {
        const N = 56, c = s / N;
        if (!st.cells || t - st.born > 90) {
          st.cells = lifeSeed(N);
          st.born = st.t = t;
        }
        const steps = Math.min(8, Math.floor((t - st.t) / LIFE_STEP));
        for (let i = 0; i < steps; i++) st.cells = lifeStep(st.cells, N);
        st.t += steps * LIFE_STEP;
        if (st.cells.reseeded) st.born = t;
        ctx.fillStyle = rgba(p.line);
        for (const [lo, hi, k] of [[1, 2, 1], [0.3, 1, 0.42], [0.1, 0.3, 0.22], [0.03, 0.1, 0.1]]) {
          ctx.globalAlpha = k * (p.dark ? 0.36 : 0.26);
          ctx.beginPath();
          for (let i = 0; i < N * N; i++) {
            const v = st.cells[i];
            if (v >= lo && v < hi) ctx.rect((i % N) * c + c * 0.1, Math.floor(i / N) * c + c * 0.1, c * 0.8, c * 0.8);
          }
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      },
    },
    // pipes: the pipes.sh screensaver, three pipes wandering until the screen is full, then again
    pipes: {
      res: 512,
      paint(ctx, t, s, p, st) {
        const g = grid(s, 34), key = `${p.line}|${p.line2}|${p.dark}`;
        if (!st.cv || st.key !== key || st.placed > g.cols * g.rows * 1.3) {
          st.cv = st.cv || document.createElement("canvas");
          st.cv.width = st.cv.height = s;
          st.key = key;
          st.placed = 0;
          st.t = t;
          const r = (n) => Math.floor(Math.random() * n);
          st.heads = [p.line, p.line2, p.dark ? p.ink : p.line].map((c) => ({ x: r(g.cols), y: r(g.rows), d: r(4), c }));
          for (let i = 0; i < 30; i++) pipeStep(st, g);
        }
        const steps = Math.min(20, Math.floor((t - st.t) * 9));
        for (let i = 0; i < steps; i++) pipeStep(st, g);
        st.t += steps / 9;
        ctx.globalAlpha = p.dark ? 0.42 : 0.36;
        ctx.drawImage(st.cv, 0, 0);
        ctx.globalAlpha = 1;
      },
    },
  };

  function fireStep(heat, W, H, t) {
    for (let x = 0; x < W; x++) {
      // the burner, under the visible rows: hottest in the middle, flickering
      const mid = Math.max(0, 1 - Math.abs(x / W - 0.5) * 1.6);
      const v = mid * (0.7 + 0.5 * (0.5 + 0.5 * noise(x * 0.3, t * 1.8, 7.7)));
      heat[(H + 1) * W + x] = v;
      heat[H * W + x] = v * (0.75 + 0.35 * Math.random());
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const below = (y + 1) * W, side = Math.min(W - 1, Math.max(0, x + ((Math.random() * 3) | 0) - 1));
        const v = (heat[below + side] * 2 + heat[below + x] + heat[(y + 2) * W + x]) / 4;
        heat[y * W + x] = Math.max(0, v - 0.016 - Math.random() * 0.04);
      }
    }
  }

  const LIFE_STEP = 0.4;
  function lifeSeed(N) {
    const cells = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) cells[i] = Math.random() < 0.3 ? 1 : 0;
    return cells;
  }
  // Live cells are exactly 1; dead ones keep a fading afterglow below that.
  function lifeStep(cells, N) {
    const next = new Float32Array(N * N);
    let alive = 0, changed = 0;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let n = 0;
        for (let dy = N - 1; dy <= N + 1; dy++)
          for (let dx = N - 1; dx <= N + 1; dx++) n += cells[((y + dy) % N) * N + ((x + dx) % N)] === 1;
        const i = y * N + x, was = cells[i] === 1;
        n -= was;
        const on = was ? n === 2 || n === 3 : n === 3;
        next[i] = on ? 1 : cells[i] * 0.6;
        alive += on;
        changed += on !== was;
      }
    }
    // Settled into a few blinkers and still blocks: start over.
    if (alive < N * N * 0.04 || changed < N * 0.5) {
      const fresh = lifeSeed(N);
      fresh.reseeded = true;
      return fresh;
    }
    return next;
  }

  // One step of each pipe: draw the segment through its cell, maybe turn, move on.
  function pipeStep(st, g) {
    const c = st.cv.getContext("2d");
    const mid = (h, d) => [(h.x + 0.5 + [0, 0.5, 0, -0.5][d]) * g.w, (h.y + 0.5 + [-0.5, 0, 0.5, 0][d]) * g.h];
    c.lineWidth = g.w * 0.26;
    c.lineCap = "butt";
    c.lineJoin = "miter";
    for (const h of st.heads) {
      const d = Math.random() < 0.16 ? (h.d + (Math.random() < 0.5 ? 1 : 3)) % 4 : h.d;
      c.clearRect(h.x * g.w, h.y * g.h, g.w, g.h);
      c.strokeStyle = rgba(h.c);
      c.beginPath();
      c.moveTo(...mid(h, (h.d + 2) % 4));
      c.lineTo((h.x + 0.5) * g.w, (h.y + 0.5) * g.h);
      c.lineTo(...mid(h, d));
      c.stroke();
      h.d = d;
      h.x = (h.x + [0, 1, 0, -1][d] + g.cols) % g.cols;
      h.y = (h.y + [-1, 0, 1, 0][d] + g.rows) % g.rows;
      st.placed++;
    }
  }

  function hex(ctx, x, y, r) {
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  // ---------- the user's own media ----------
  // Fetched whole into a blob: the service doesn't do range requests, and a blob loops cleanly.

  const blobs = new Map();
  function mediaUrl(name) {
    if (!blobs.has(name)) {
      const p = fetch(`/media/${encodeURIComponent(name)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.status))))
        .then((b) => URL.createObjectURL(b));
      p.catch(() => blobs.delete(name));
      blobs.set(name, p);
    }
    return blobs.get(name);
  }

  function mediaSource(name, onReady) {
    const video = /\.(mp4|webm)$/i.test(name);
    const node = video ? document.createElement("video") : new Image();
    if (video) Object.assign(node, { muted: true, loop: true, playsInline: true, preload: "auto" });
    let alive = true, wanted = false;
    node.addEventListener(video ? "loadeddata" : "load", () => alive && onReady());
    const start = () => video && node.src && node.paused && node.play().catch(() => {});
    mediaUrl(name)
      .then((url) => {
        if (!alive) return;
        node.src = url;
        if (wanted) start();
      })
      .catch(() => {});
    return {
      video,
      node,
      play() {
        wanted = true;
        start();
      },
      pause() {
        wanted = false;
        if (video) node.pause();
      },
      stop() {
        alive = false;
        if (video) {
          node.pause();
          node.removeAttribute("src");
          node.load();
        }
      },
    };
  }

  // How bright the clip is right now (0..1), from a 16 px copy taken about once a second.
  const probe = document.createElement("canvas");
  probe.width = probe.height = 16;
  const probeCtx = probe.getContext("2d", { willReadFrequently: true });
  function brightness(m, now) {
    if (m.lumaAt && now - m.lumaAt < 1000) return m.luma;
    m.lumaAt = now;
    try {
      probeCtx.drawImage(m.node, 0, 0, 16, 16);
      const d = probeCtx.getImageData(0, 0, 16, 16).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
      const y = sum / (256 * 255);
      m.luma = m.luma == null ? y : m.luma + (y - m.luma) * 0.3;
    } catch (_) {
      m.luma = 0.5;
    }
    return m.luma;
  }

  // Cover-fit, then washed towards the theme's background so the numbers stay readable; the
  // brighter the clip, the stronger the wash. A light theme first turns the picture into a
  // blue-and-white duotone, since washing a dark clip towards white otherwise leaves grey fog.
  function paintMedia(ctx, m, s, p) {
    if (!paintRaw(ctx, m, s)) return;
    const y = brightness(m, performance.now());
    if (!p.dark) {
      ctx.fillStyle = rgba(p.line);
      ctx.globalCompositeOperation = "color";
      ctx.fillRect(0, 0, s, s);
      ctx.globalCompositeOperation = "screen";
      ctx.fillRect(0, 0, s, s);
      ctx.globalCompositeOperation = "source-over";
    }
    const wash = Math.min(0.8, p.dark ? 0.3 + 0.6 * y : 0.45 + 0.3 * (1 - y));
    const c = s / 2, base = p.dark ? p.lo : p.hi;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, rgba(base, wash));
    g.addColorStop(0.72, rgba(base, wash + 0.06));
    g.addColorStop(1, rgba(base, 0.9));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  }

  // The picture as it is, cover-fit; false while there is nothing to draw yet.
  function paintRaw(ctx, m, s) {
    const n = m.node;
    const w = n.videoWidth || n.naturalWidth, h = n.videoHeight || n.naturalHeight;
    if (!w || !h) return false;
    const k = Math.max(s / w, s / h);
    ctx.drawImage(n, (s - w * k) / 2, (s - h * k) / 2, w * k, h * k);
    return true;
  }

  // The clip as characters: one probe pixel per cell, its brightness picks a glyph from the ramp.
  // Levels follow the clip, so a dark scene still uses the whole ramp.
  const cellProbe = document.createElement("canvas");
  const cellCtx = cellProbe.getContext("2d", { willReadFrequently: true });
  function paintAscii(ctx, m, s, p) {
    const n = m.node;
    const w = n.videoWidth || n.naturalWidth, h = n.videoHeight || n.naturalHeight;
    if (!w || !h || (m.video && n.readyState < 2)) return;
    const g = grid(s, 72);
    if (cellProbe.width !== g.cols || cellProbe.height !== g.rows) {
      cellProbe.width = g.cols;
      cellProbe.height = g.rows;
    }
    const k = Math.max(s / w, s / h);
    cellCtx.drawImage(n, (s - w * k) / 2 / g.w, (s - h * k) / 2 / g.h, (w * k) / g.w, (h * k) / g.h);
    let d;
    try {
      d = cellCtx.getImageData(0, 0, g.cols, g.rows).data;
    } catch (_) {
      return;
    }
    const y = new Float32Array(g.cols * g.rows);
    let lo = 1, hi = 0;
    for (let i = 0; i < y.length; i++) {
      y[i] = (0.3 * d[i * 4] + 0.59 * d[i * 4 + 1] + 0.11 * d[i * 4 + 2]) / 255;
      lo = Math.min(lo, y[i]);
      hi = Math.max(hi, y[i]);
    }
    m.lo = m.lo == null ? lo : m.lo + (lo - m.lo) * 0.2;
    m.hi = m.hi == null ? hi : m.hi + (hi - m.hi) * 0.2;
    const span = Math.max(0.15, m.hi - m.lo);
    const ink = atlas(RAMP, p.line, g), bright = atlas(RAMP, p.dark ? p.ink : p.line, g);
    for (let i = 0; i < y.length; i++) {
      // Light parts get the dense glyphs on every theme: clips are mostly dark, and an empty
      // background keeps the numbers readable.
      const v = clamp01((y[i] - m.lo) / span);
      const gi = Math.floor(v * 9.99);
      if (!gi) continue;
      ctx.globalAlpha = (0.12 + 0.5 * v * v) * (p.dark ? 1 : 0.8);
      stamp(ctx, v > 0.82 && p.dark ? bright : ink, gi, (i % g.cols) * g.w, Math.floor(i / g.cols) * g.h, g);
    }
    ctx.globalAlpha = 1;
  }
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  // plain: tinted towards the theme; raw: untouched; ascii: as characters
  const LOOKS = { plain: paintMedia, raw: paintRaw, ascii: paintAscii };

  // ---------- camless mode ----------
  // camless (github.com/kleju13/camless) can play the background itself, under a dial drawn on
  // nothing: baked once into a loop of frames, it costs the browser nothing, which then repaints
  // only when the numbers change. A drawn background loops over 20 s with its end crossfaded into
  // its start, a clip over its own length (cut and crossfaded when longer), a still one is a frame.

  const LOOP_S = 20, MAX_FRAMES = 300, MAX_FADE = 10;

  // The user's media for baking, once it can be drawn.
  function openMedia(name) {
    return new Promise((done, fail) => {
      const m = mediaSource(name, () => {
        clearTimeout(late);
        done(m);
      });
      const late = setTimeout(() => {
        m.stop();
        fail(new Error(`${name} did not load`));
      }, 20e3);
    });
  }

  // Plays a clip up to `at` seconds and holds it there.
  async function reach(node, at) {
    if (node.currentTime < at) {
      await node.play();
      await new Promise((done) => {
        const check = () => (node.currentTime >= at || node.ended ? done() : setTimeout(check, 4));
        check();
      });
      node.pause();
    }
    if (node.currentTime < at) throw new Error("the clip ended early");
  }

  // Sends the loop through `link` (window.nzxt.v1.camless.background) as PNGs of the whole
  // screen, the dial's gradient under the background as dial.css draws it; stops when `wanted()`
  // turns false. True once camless plays it.
  async function bake({ link, wanted, root, canvas, painter, type, look, fps, pal: p }) {
    const W = innerWidth, H = innerHeight, box = root.getBoundingClientRect();
    const out = document.createElement("canvas");
    [out.width, out.height] = [W, H];
    const o = out.getContext("2d");
    const work = document.createElement("canvas");
    work.width = work.height = canvas.width;
    const w = work.getContext("2d");
    // .kd: radial-gradient(circle at 50% 40%, --bg-hi 0%, --bg-hi 38%, --bg-lo 100%), out to the
    // farthest corner, inside a circle
    const cx = box.left + box.width / 2, cy = box.top + box.height * 0.4;
    const under = o.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(box.width / 2, box.height * 0.6));
    under.addColorStop(0, rgba(p.hi));
    under.addColorStop(0.38, rgba(p.hi));
    under.addColorStop(1, rgba(p.lo));
    // One frame on `out`; without `paint`, the background is as it was.
    function shoot(paint) {
      if (paint) {
        const s = work.width;
        w.clearRect(0, 0, s, s);
        w.save();
        w.beginPath();
        w.arc(s / 2, s / 2, s / 2, 0, TAU);
        w.clip();
        paint(w, s);
        w.restore();
      }
      o.fillStyle = "#000";
      o.fillRect(0, 0, W, H);
      o.save();
      o.beginPath();
      o.arc(box.left + box.width / 2, box.top + box.height / 2, box.width / 2, 0, TAU);
      o.clip();
      o.fillStyle = under;
      o.fillRect(box.left, box.top, box.width, box.height);
      o.restore();
      o.drawImage(work, box.left, box.top, box.width, box.height);
    }

    const src = /^media:/.test(type) ? await openMedia(type.slice(6)) : null;
    try {
      let n = 1, fade = 0, frameAt = () => shoot(src ? (c, s) => LOOKS[look](c, src, s, p) : () => {});
      if (painter) {
        [n, fade] = [Math.min(MAX_FRAMES, fps * LOOP_S), Math.min(fps, MAX_FADE)];
        const st = {};
        frameAt = (i) => {
          const t = 7 + i / fps;
          shoot(painter.idle && painter.idle(t, st) ? null : (c, s) => painter.paint(c, t, s, p, st));
        };
      } else if (src && src.video) {
        src.node.loop = false;
        const d = src.node.duration;
        const whole = Number.isFinite(d) ? Math.floor(d * fps) : Infinity;
        n = Math.max(1, Math.min(MAX_FRAMES, whole));
        fade = Math.max(0, Math.min(fps, MAX_FADE, whole - n));
        frameAt = async (i) => {
          await reach(src.node, i / fps);
          shoot((c, s) => LOOKS[look](c, src, s, p));
        };
      }
      // The first `fade` frames wait, to be crossfaded under the frames after the last.
      const heads = [];
      await link.begin(fps, n);
      for (let i = 0; i < n + fade; i++) {
        if (!wanted()) return false;
        await frameAt(i);
        if (i < fade) {
          const c = document.createElement("canvas");
          [c.width, c.height] = [W, H];
          c.getContext("2d").drawImage(out, 0, 0);
          heads.push(c);
          continue;
        }
        let at = i;
        if (i >= n) {
          at = i - n;
          o.globalAlpha = at / fade;
          o.drawImage(heads[at], 0, 0);
          o.globalAlpha = 1;
          heads[at] = null;
        }
        await link.frame(at, out.toDataURL("image/png"));
      }
      if (!wanted()) return false;
      await link.end();
      return true;
    } finally {
      if (src) src.stop();
    }
  }

  // ---------- the backdrop ----------

  function backdrop(canvas, root) {
    const ctx = canvas.getContext("2d");
    let type = null, painter = null, media = null, pal = null, state = {}, look = "plain";
    let t = 7, last = null, speed = 1, fps = 10, timer = null;
    function draw() {
      const s = canvas.width;
      ctx.clearRect(0, 0, s, s);
      if (!painter && !media) return;
      ctx.save();
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s / 2, 0, TAU);
      ctx.clip();
      if (media) LOOKS[look](ctx, media, s, pal);
      else painter.paint(ctx, t, s, pal, state);
      ctx.restore();
    }
    const moving = () => !!painter || !!(media && media.video);
    function frame() {
      timer = null;
      if (!canvas.isConnected) return self.pause();
      const now = performance.now();
      if (last != null) t += ((now - last) / 1e3) * speed;
      last = now;
      // A painter that changes less often than the frame rate skips the frame: an unchanged
      // canvas costs CAM nothing.
      if (!(painter && painter.idle && painter.idle(t, state))) draw();
      timer = setTimeout(frame, 1000 / fps);
    }
    const self = {
      // Re-reads the theme colours, so call it after a theme change too.
      set(next, animate = true) {
        if (next !== type) {
          if (media) media.stop();
          type = next;
          painter = PAINT[next] || null;
          state = {};
          media = /^media:/.test(next) ? mediaSource(next.slice(6), () => draw()) : null;
          const res = media ? 640 : painter ? painter.res || 256 : 16;
          if (canvas.width !== res) canvas.width = canvas.height = res;
        }
        pal = palette(root);
        draw();
        if (animate) self.play();
        else self.pause();
      },
      play() {
        if (media) media.play();
        // A still background must not keep a frame loop: every redraw costs CAM a capture.
        if (!moving()) {
          clearTimeout(timer);
          timer = null;
          return;
        }
        if (timer) return;
        last = null;
        timer = setTimeout(frame, 0);
      },
      pause() {
        if (media) media.pause();
        clearTimeout(timer);
        timer = null;
      },
      speed(r) {
        speed = r;
      },
      fps(n) {
        fps = n > 0 ? n : 10;
      },
      look(l) {
        l = LOOKS[l] ? l : "plain";
        if (l === look) return;
        look = l;
        if (media) draw();
      },
      // What the frames depend on: camless mode bakes them again when this changes.
      key() {
        return JSON.stringify([type, look, fps, pal, canvas.width]);
      },
      // Whether speed() moves it: a drawn background, not a clip.
      paced() {
        return !!painter;
      },
      // The background as a loop for camless; see bake() above.
      bake(link, wanted) {
        return bake({ link, wanted, root, canvas, painter, type, look, fps, pal });
      },
    };
    return self;
  }

  window.KrakenBg = { LIST, backdrop };
})();
