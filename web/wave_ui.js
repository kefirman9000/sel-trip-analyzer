/* SEL Trip Event Analyzer - Waveform analysis page (browser UI).
 *
 * Uses SELAnalysis (signal maths), SELReference (reference library) and SELDocx.
 * The app page creates it with SELWaveUI.create(ctx); see app.html.
 */
(function (root) {
"use strict";
const A = root.SELAnalysis, REF = root.SELReference, DOCX = root.SELDocx;

// Phase colours (validated for colour-blind separation, light and dark); neutral/other use ink + dashes
const PHASE = {
  light: { A: "#d0392b", B: "#0e8a74", C: "#3a5fd9" },
  dark: { A: "#e8604f", B: "#1fa385", C: "#6f8cf5" },
};
const LIGHT = { bg: "#ffffff", ink: "#1b1b1b", muted: "#616161", grid: "#e6e6e6", axis: "#c9c9c9", accent: "#005fb8",
                trip: "#c42b1c", warn: "#9a5800", shade: "rgba(0,95,184,0.06)", zoom: "rgba(0,95,184,0.14)", pin: "#9a5800" };
const DARK = { bg: "#252525", ink: "#e9e9e9", muted: "#9e9e9e", grid: "#333333", axis: "#474747", accent: "#4cc2ff",
               trip: "#ff8f85", warn: "#ffb74d", shade: "rgba(76,194,255,0.07)", zoom: "rgba(76,194,255,0.18)", pin: "#ffb74d" };
const FONT = '"Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,Arial,sans-serif';

// Plain-English meaning of each fault type, for the verdict card
const MEANS = {
  AG: "One phase touched ground: a tree limb, failed insulator, animal or lightning flashover.", BG: null, CG: null,
  AB: "Two phases touched each other without ground: wind, conductor slap, a branch across two phases.", BC: null, CA: null,
  ABG: "Two phases faulted together to ground: broken crossarm, conductor down across another.", BCG: null, CAG: null,
  ABC: "All three phases faulted: rare on lines; often grounds left on after work, or a fault near the station.",
  NONE: "No fault current: the currents never rose much above load.",
  INRUSH: "A transformer being energized, not a fault. The relay should restrain on the 2nd harmonic.",
};
const meaningOf = (code) => MEANS[code] || (/^[ABC]G$/.test(code) ? MEANS.AG : /^(AB|BC|CA)$/.test(code) ? MEANS.AB : /^(AB|BC|CA)G$/.test(code) ? MEANS.ABG : "");

const SEQ_WORDS = {
  pos: ["Positive sequence", "The normal, balanced part of the current/voltage. Large for load and three-phase faults."],
  neg: ["Negative sequence", "Unbalance. Appears for any fault that isn't three-phase, or for an open phase."],
  zero: ["Zero sequence", "Flows only when the fault involves ground (voltage: appears when ground is involved)."],
  residual: ["Residual (3I0)", "What a ground relay measures: IA + IB + IC."],
};

const fmt = (x, d) => (x === null || x === undefined || !isFinite(x) ? "-" : x.toLocaleString("en-US", { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }));
const fmtMag = (x, unit) => (unit === "kV" ? `${fmt(x, x < 10 ? 2 : 1)} kV` : `${fmt(x, x < 10 ? 1 : 0)} ${unit || "A"}`);
const fmtAng = (d) => `${d >= 0 ? "" : "-"}${Math.abs(d).toFixed(1)}°`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function niceStep(span, target) {
  const raw = span / Math.max(1, target), p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}
const GROUP_ORDER = ["Trip & outputs", "Distance", "Overcurrent", "Directional", "Communications", "Breaker & inputs", "Reclosing", "Voltage & frequency", "Custom logic", "Other"];

/** One-cycle sliding fundamental (filtered) waveform. */
function fundamental(values, spc) {
  const n = values.length, out = new Float64Array(n);
  const cs = new Float64Array(spc), sn = new Float64Array(spc);
  for (let k = 0; k < spc; k++) { cs[k] = Math.cos((2 * Math.PI * k) / spc); sn[k] = Math.sin((2 * Math.PI * k) / spc); }
  let re = 0, im = 0;
  for (let k = 0; k < n; k++) {
    const j = k % spc;
    re += values[k] * cs[j]; im -= values[k] * sn[j];
    if (k >= spc) { re -= values[k - spc] * cs[j]; im += values[k - spc] * sn[j]; }
    // value of the fundamental at sample k: Re(2/N * S * e^{j theta_k})
    out[k] = k >= spc - 1 ? (2 / spc) * (re * cs[j] - im * sn[j]) : NaN;
  }
  return out;
}

/** Markers from relay elements: trip, breaker open. */
function eventMarks(rec) {
  const marks = [{ t: 0, label: "Trigger", kind: "trig" }];
  const find = (re) => rec.digitals.find((d) => re.test(d.name.toUpperCase()));
  const tripD = find(/^TRIP\d?$/) || find(/^3PT$/);
  if (tripD) for (let k = Math.max(1, rec.trigger || 0); k < rec.n; k++) if (tripD.values[k] && !tripD.values[k - 1]) { marks.push({ t: rec.t[k], label: "Trip", kind: "trip" }); break; }
  const a = find(/^52A\d?$/), b = find(/^52B\d?$/);
  if (a) { for (let k = Math.max(1, rec.trigger || 0); k < rec.n; k++) if (!a.values[k] && a.values[k - 1]) { marks.push({ t: rec.t[k], label: "Breaker open", kind: "open" }); break; } }
  else if (b) { for (let k = Math.max(1, rec.trigger || 0); k < rec.n; k++) if (b.values[k] && !b.values[k - 1]) { marks.push({ t: rec.t[k], label: "Breaker open", kind: "open" }); break; } }
  return marks;
}

function idxAt(rec, t) {
  const tt = rec.t;
  let lo = 0, hi = rec.n - 1;
  if (t <= tt[0]) return 0;
  if (t >= tt[hi]) return hi;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tt[mid] <= t) lo = mid; else hi = mid; }
  return t - tt[lo] < tt[hi] - t ? lo : hi;
}

// ---------------------------------------------------------------------------
// Chart model + renderer (shared by the screen and by exports)
// ---------------------------------------------------------------------------
const L = 74, R = 58, AXIS_H = 34, TITLE_H = 20;
function layout(m, W) {
  const panels = [];
  let y = 6;
  const kinds = [["I", "Currents", m.curH || 190], ["V", "Voltages", m.volH || 150], ["other", "Other analogs", 120]];
  for (const [kind, title, h] of kinds) {
    const chans = m.channels.filter((c) => c.on && c.kind === kind);
    if (!chans.length) continue;
    const unit = chans[0].unit;
    panels.push({ kind, title: `${title} (${unit}${m.mode === "rms" ? " rms" : ""})`, chans, y: y + TITLE_H, h });
    y += TITLE_H + h + 10;
  }
  if (m.digRows.length) {
    const h = m.digRows.length * 17 + 6;
    panels.push({ kind: "D", title: "Relay elements (on = bar)", rows: m.digRows, y: y + TITLE_H, h });
    y += TITLE_H + h + 4;
  }
  return { panels, H: y + AXIS_H, W, plotW: W - L - R };
}

function seriesFor(rec, ch, mode, cacheObj) {
  if (mode === "raw") return ch.values;
  const key = mode + ":" + ch.name;
  if (!cacheObj[key]) cacheObj[key] = mode === "fund" ? fundamental(ch.values, rec.spc) : A.rmsTrend(ch.values, rec.spc);
  return cacheObj[key];
}

function draw(ctx, m, W, theme, opts) {
  opts = opts || {};
  const P = theme === "dark" ? DARK : LIGHT, PH = PHASE[theme === "dark" ? "dark" : "light"];
  const lay = layout(m, W), rec = m.rec;
  const { t0, t1 } = m.view, plotW = lay.plotW;
  const X = (t) => L + ((t - t0) / (t1 - t0)) * plotW;
  ctx.save();
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, lay.H);
  ctx.font = `11px ${FONT}`; ctx.textBaseline = "middle";
  const i0 = Math.max(0, idxAt(rec, t0) - 1), i1 = Math.min(rec.n - 1, idxAt(rec, t1) + 1);
  const cyc = (t) => t * rec.freq;
  // x grid step
  const unitMs = m.xunit === "ms";
  const span = unitMs ? (t1 - t0) * 1000 : cyc(t1 - t0);
  const step = niceStep(span, Math.max(4, Math.floor(plotW / 90)));
  const xticks = [];
  const conv = (t) => (unitMs ? t * 1000 : cyc(t));
  for (let v = Math.ceil(conv(t0) / step) * step; v <= conv(t1) + 1e-9; v += step) xticks.push(v);
  const tOf = (v) => (unitMs ? v / 1000 : v / rec.freq);
  const marks = m.marks || [];
  const tripT = (marks.find((x) => x.kind === "trip") || {}).t, openT = (marks.find((x) => x.kind === "open") || {}).t;
  const faultEnd = openT !== undefined ? openT : tripT;

  for (const p of lay.panels) {
    // title
    ctx.fillStyle = P.muted; ctx.font = `600 11px ${FONT}`; ctx.textAlign = "left";
    ctx.fillText(p.title, 8, p.y - 10);
    ctx.font = `11px ${FONT}`;
    // fault shading
    if (faultEnd !== undefined && faultEnd > 0) {
      const a = clamp(X(0), L, L + plotW), b = clamp(X(faultEnd), L, L + plotW);
      if (b > a) { ctx.fillStyle = P.shade; ctx.fillRect(a, p.y, b - a, p.h); }
    }
    // vertical grid
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
    for (const v of xticks) { const x = Math.round(X(tOf(v))) + 0.5; ctx.beginPath(); ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); ctx.stroke(); }
    if (p.kind === "D") { drawDigital(ctx, m, p, X, P, i0, i1, plotW); continue; }
    // y scale
    let mx = 0;
    const series = p.chans.map((c) => ({ c, v: seriesFor(rec, c, m.mode, m.cache) }));
    for (const { v } of series) for (let k = i0; k <= i1; k++) { const a = Math.abs(v[k]); if (a > mx && isFinite(a)) mx = a; }
    if (m.locked && m.locked[p.kind]) mx = m.locked[p.kind];
    mx = mx > 0 ? mx * 1.08 : 1;
    const rmsMode = m.mode === "rms";
    const yMin = rmsMode ? 0 : -mx, yMax = mx;
    const Y = (v) => p.y + p.h - ((v - yMin) / (yMax - yMin)) * p.h;
    p.Y = Y; p.yMin = yMin; p.yMax = yMax;
    const ys = niceStep(yMax - yMin, 4);
    ctx.textAlign = "right";
    for (let v = Math.ceil(yMin / ys) * ys; v <= yMax + 1e-9; v += ys) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = Math.abs(v) < 1e-9 ? P.axis : P.grid;
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + plotW, y); ctx.stroke();
      ctx.fillStyle = P.muted;
      ctx.fillText(Math.abs(v) >= 10000 ? `${fmt(v / 1000, 0)}k` : fmt(v, ys < 1 ? 1 : 0), L - 6, y);
    }
    // lines
    ctx.save();
    ctx.beginPath(); ctx.rect(L, p.y - 1, plotW, p.h + 2); ctx.clip();
    const used = new Set();
    const labels = [];
    for (const { c, v } of series) {
      const color = /^[ABC]$/.test(c.phase) && !used.has(c.phase) ? PH[c.phase] : P.ink;
      const dashed = color === P.ink;
      if (/^[ABC]$/.test(c.phase)) used.add(c.phase);
      ctx.strokeStyle = color; ctx.lineWidth = opts.lineWidth || 1.6; ctx.lineJoin = "round";
      ctx.setLineDash(dashed ? [5, 3] : []);
      ctx.beginPath();
      const perPx = (i1 - i0) / plotW;
      if (perPx > 2) {
        // min/max per pixel column
        let col = -1, lo = 0, hi = 0, first = true;
        const flush = () => {
          if (col < 0) return;
          const x = L + col + 0.5;
          if (first) { ctx.moveTo(x, Y(lo)); first = false; } else ctx.lineTo(x, Y(lo));
          ctx.lineTo(x, Y(hi));
        };
        for (let k = i0; k <= i1; k++) {
          const val = v[k]; if (!isFinite(val)) continue;
          const cx = Math.floor(X(rec.t[k]) - L);
          if (cx !== col) { flush(); col = cx; lo = hi = val; } else { if (val < lo) lo = val; if (val > hi) hi = val; }
        }
        flush();
      } else {
        let started = false;
        for (let k = i0; k <= i1; k++) {
          const val = v[k];
          if (!isFinite(val)) { started = false; continue; }
          const x = X(rec.t[k]), y = Y(val);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      // direct label at the right edge
      let last = NaN;
      for (let k = i1; k >= i0; k--) if (isFinite(v[k])) { last = v[k]; break; }
      labels.push({ name: c.label || c.name, color, dashed, y: isFinite(last) ? Y(last) : p.y + p.h / 2 });
    }
    ctx.restore();
    ctx.setLineDash([]);
    // spread labels so they don't collide
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
    const over = labels.length ? labels[labels.length - 1].y - (p.y + p.h - 4) : 0;
    if (over > 0) for (const lb of labels) lb.y -= over;
    for (const lb of labels) {
      lb.y = Math.max(p.y + 5, lb.y);
      ctx.strokeStyle = lb.color; ctx.lineWidth = 2.5; ctx.setLineDash(lb.dashed ? [3, 2] : []);
      ctx.beginPath(); ctx.moveTo(L + plotW + 5, lb.y); ctx.lineTo(L + plotW + 15, lb.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = P.ink; ctx.textAlign = "left"; ctx.fillText(lb.name, L + plotW + 18, lb.y);
    }
    // frame
    ctx.strokeStyle = P.axis; ctx.lineWidth = 1;
    ctx.strokeRect(L + 0.5, p.y + 0.5, plotW - 1, p.h - 1);
  }
  const top = lay.panels.length ? lay.panels[0].y : 0;
  const bottom = lay.panels.length ? lay.panels[lay.panels.length - 1].y + lay.panels[lay.panels.length - 1].h : 0;
  // event markers
  ctx.save(); ctx.beginPath(); ctx.rect(L, 0, plotW, lay.H); ctx.clip();
  for (const mk of marks) {
    const x = Math.round(X(mk.t)) + 0.5;
    if (x < L || x > L + plotW) continue;
    ctx.strokeStyle = mk.kind === "trip" ? P.trip : P.muted; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (const p of lay.panels) { ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
  // marker labels along the axis
  ctx.textAlign = "center";
  let lastRight = -1e9;
  for (const mk of marks.slice().sort((a, b) => a.t - b.t)) {
    const x = X(mk.t);
    if (x < L || x > L + plotW) continue;
    ctx.font = `600 10.5px ${FONT}`;
    const w = ctx.measureText(mk.label).width + 10;
    const cx = clamp(Math.max(x, lastRight + w / 2), L + w / 2, L + plotW - w / 2);
    ctx.fillStyle = mk.kind === "trip" ? P.trip : P.muted;
    ctx.fillText(mk.label, cx, bottom + 25);
    lastRight = cx + w / 2;
  }
  ctx.font = `11px ${FONT}`;
  // x axis labels
  ctx.fillStyle = P.muted; ctx.textAlign = "center";
  for (const v of xticks) ctx.fillText(fmt(Math.abs(v) < step / 1000 ? 0 : v, step < 1 ? (step < 0.1 ? 2 : 1) : 0), X(tOf(v)), bottom + 10);
  ctx.textAlign = "right";
  ctx.fillText(unitMs ? "ms" : "cycles", L - 6, bottom + 10);
  // graph notes (pins)
  (m.pins || []).forEach((pin, i) => {
    const x = Math.round(X(pin.t)) + 0.5;
    if (x < L || x > L + plotW) return;
    ctx.strokeStyle = P.pin; ctx.lineWidth = 1.2; ctx.setLineDash([2, 2]);
    ctx.beginPath();
    for (const p of lay.panels) { ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); }
    ctx.stroke(); ctx.setLineDash([]);
    const label = `${i + 1}${opts.pinText !== false ? "  " + (pin.text.length > 34 ? pin.text.slice(0, 33) + "…" : pin.text) : ""}`;
    ctx.font = `600 11px ${FONT}`;
    const w = ctx.measureText(label).width + 12;
    const bx = x + w + 4 > L + plotW ? x - w - 2 : x + 2, by = top + 4 + (i % 3) * 22;
    ctx.fillStyle = P.bg; ctx.strokeStyle = P.pin; ctx.lineWidth = 1.2;
    roundRect(ctx, bx, by, w, 18, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = P.ink; ctx.textAlign = "left"; ctx.fillText(label, bx + 6, by + 9.5);
    ctx.font = `11px ${FONT}`;
  });
  // cursor
  if (opts.cursor !== false && m.cursorIdx !== null && m.cursorIdx !== undefined) {
    const x = Math.round(X(rec.t[m.cursorIdx])) + 0.5;
    if (x >= L && x <= L + plotW) {
      ctx.strokeStyle = P.accent; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const p of lay.panels) { ctx.moveTo(x, p.y); ctx.lineTo(x, p.y + p.h); }
      ctx.stroke();
      // the analysis window (one cycle ending at the cursor)
      const xa = X(rec.t[Math.max(0, m.cursorIdx - rec.spc * (m.hCycles || 1) + 1)]);
      ctx.fillStyle = P.zoom; ctx.globalAlpha = 0.5;
      ctx.fillRect(Math.max(L, xa), bottom - 4, x - Math.max(L, xa), 4); ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
  return lay;
}

function drawDigital(ctx, m, p, X, P, i0, i1, plotW) {
  const rec = m.rec;
  p.rows.forEach((row, r) => {
    const y = p.y + 4 + r * 17;
    ctx.fillStyle = P.ink; ctx.textAlign = "right"; ctx.font = `11px ${FONT}`;
    ctx.fillText(row.name.length > 10 ? row.name.slice(0, 9) + "…" : row.name, L - 6, y + 7);
    const color = row.group === "Trip & outputs" ? P.trip : P.accent;
    ctx.fillStyle = color;
    for (const [a, b] of row.intervals) {
      const xa = clamp(X(rec.t[a]), L, L + plotW), xb = clamp(X(rec.t[b]), L, L + plotW);
      if (xb - xa <= 0) continue;
      roundRect(ctx, xa, y + 2, Math.max(2, xb - xa), 10, 2); ctx.fill();
    }
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, y + 15.5); ctx.lineTo(L + plotW, y + 15.5); ctx.stroke();
  });
  ctx.strokeStyle = P.axis; ctx.strokeRect(L + 0.5, p.y + 0.5, plotW - 1, p.h - 1);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

/** Phasor diagram. items: [{name, kind, phase, ph (complex), unit}] */
function drawPhasors(ctx, S, snap, rec, theme, show) {
  const P = theme === "dark" ? DARK : LIGHT, PH = PHASE[theme === "dark" ? "dark" : "light"];
  const cx = S / 2, cy = S / 2, Rr = S / 2 - 30;
  ctx.save();
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
  for (const f of [0.5, 1]) { ctx.beginPath(); ctx.arc(cx, cy, Rr * f, 0, Math.PI * 2); ctx.stroke(); }
  for (let a = 0; a < 360; a += 30) {
    const r = (a * Math.PI) / 180;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Rr * Math.cos(r), cy - Rr * Math.sin(r)); ctx.stroke();
  }
  ctx.fillStyle = P.muted; ctx.font = `10px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const a of [0, 90, 180, -90]) {
    const r = (a * Math.PI) / 180;
    ctx.fillText(`${a}°`, cx + (Rr + 15) * Math.cos(r), cy - (Rr + 15) * Math.sin(r));
  }
  const items = [];
  for (const ch of rec.analogs) {
    if (!/^[ABCN]$/.test(ch.phase) || (ch.kind !== "I" && ch.kind !== "V")) continue;
    if ((ch.kind === "I" && !show.I) || (ch.kind === "V" && !show.V)) continue;
    const z = snap.phasors[ch.name];
    if (z) items.push({ name: ch.name, kind: ch.kind, phase: ch.phase, z });
  }
  const maxOf = (kind) => Math.max(1e-9, ...items.filter((i) => i.kind === kind).map((i) => A.cabs(i.z)));
  const mI = maxOf("I"), mV = maxOf("V");
  const used = new Set();
  // voltages first (thinner, behind), then currents
  for (const it of items.sort((a, b) => (a.kind === "V" ? -1 : 1) - (b.kind === "V" ? -1 : 1))) {
    const scale = (it.kind === "I" ? mI : mV);
    const r = (A.cabs(it.z) / scale) * Rr * (it.kind === "V" ? 1 : 0.9);
    const ang = Math.atan2(it.z.im, it.z.re);
    const x = cx + r * Math.cos(ang), y = cy - r * Math.sin(ang);
    const key = it.kind + it.phase;
    const color = /^[ABC]$/.test(it.phase) && !used.has(key) ? PH[it.phase] : P.ink;
    used.add(key);
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = it.kind === "I" ? 2.6 : 1.4;
    ctx.setLineDash(it.kind === "V" ? [6, 3] : it.phase === "N" ? [3, 2] : []);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
    if (r > 8) {
      const ah = it.kind === "I" ? 9 : 7;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.lineTo(x - ah * Math.cos(ang - 0.4), y + ah * Math.sin(ang - 0.4));
      ctx.lineTo(x - ah * Math.cos(ang + 0.4), y + ah * Math.sin(ang + 0.4)); ctx.closePath();
      if (it.kind === "I") ctx.fill(); else { ctx.lineWidth = 1.2; ctx.stroke(); }
    }
    ctx.fillStyle = P.ink; ctx.font = `600 11px ${FONT}`;
    const lr = Math.max(r, 14) + 10;
    ctx.fillText(it.name, clamp(cx + lr * Math.cos(ang), 12, S - 12), clamp(cy - lr * Math.sin(ang), 8, S - 8));
  }
  ctx.restore();
}

function pngBytes(canvas) {
  const b64 = canvas.toDataURL("image/png").split(",")[1], bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
function create(ctx) {
  const $ = (id) => document.getElementById(id);
  const core = ctx.core;
  const st = {
    list: [], idx: -1, rec: null, an: null, cache: {}, view: null, cursor: null, mode: ctx.store.get("w.mode", "raw"),
    xunit: ctx.store.get("w.xunit", "cyc"), adv: ctx.store.get("w.adv", false), channels: [], digSel: null, noteMode: false,
    drag: null, hCycles: 1, hChan: "", settingsChoice: "auto", showPh: { I: true, V: true }, elFilter: { q: "", group: "", changed: true },
    built: new Map(), recKey: "",
  };
  const canvas = $("wCanvas"), overlay = $("wOverlay"), tip = $("wTip");
  const themeNow = () => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

  // ---------------- records
  function buildList() {
    const cache = ctx.getCache();
    const items = [];
    if (cache) {
      const evs = cache.events.filter((e) => e.wave && e.kind === "event")
        .map((e) => [e, core.eventDatetime(e)]).sort((a, b) => (a[1] || 0) - (b[1] || 0)).map((x) => x[0]);
      for (const e of evs) {
        items.push({ id: core.eventId(e), group: "file", label: `${e.date} ${e.time}  ${e.relay_id || "?"}  ${e.event_type || ""}  (${e.source})`,
                     make: () => A.recordFromEvent(e), event: e });
      }
      if (cache.comtrade && cache.comtrade.length) {
        const key = cache.comtrade.map((f) => f.name).join("|");
        if (!st.built.has("ct:" + key)) st.built.set("ct:" + key, A.comtradeRecords(cache.comtrade));
        const { records, errors } = st.built.get("ct:" + key);
        for (const r of records) items.push({ id: r.id, group: "file", label: `${r.date} ${(r.time || "").slice(0, 12)}  ${r.relay || r.station || "?"}  (COMTRADE ${r.source})`, make: () => r, rec0: r });
        st.ctErrors = errors;
      }
    }
    const when = (it) => { const d = it.event ? core.eventDatetime(it.event) : it.rec0 ? core.eventDatetime({ date: it.rec0.date, time: it.rec0.time }) : null; return d === null ? Infinity : d; };
    items.sort((a, b) => when(a) - when(b));
    for (const r of REF.referenceList()) items.push({ id: "ref:" + r.key, group: "ref", label: r.title, make: () => REF.referenceRecord(r.key), refInfo: r });
    return items;
  }
  function fillSelect() {
    const sel = $("wRec");
    sel.textContent = "";
    for (const [g, label] of [["file", "Your records"], ["ref", "Reference waveforms (built in)"]]) {
      const its = st.list.filter((x) => x.group === g);
      if (!its.length) continue;
      const og = document.createElement("optgroup"); og.label = label;
      for (const it of its) { const o = document.createElement("option"); o.value = it.id; o.textContent = it.label; og.appendChild(o); }
      sel.appendChild(og);
    }
    if (st.idx >= 0) sel.value = st.list[st.idx].id;
    const nFile = st.list.filter((x) => x.group === "file").length;
    $("wCount").textContent = nFile ? `${nFile} record${nFile === 1 ? "" : "s"} from your files + ${st.list.length - nFile} reference` : "No CEV or COMTRADE files loaded: showing the reference library";
  }
  function refresh(selectId) {
    const prevId = selectId || (st.idx >= 0 ? st.list[st.idx].id : null);
    st.list = buildList();
    let i = prevId ? st.list.findIndex((x) => x.id === prevId) : -1;
    if (i < 0) i = 0;
    fillSelect();
    if (st.list[i] && (st.list[i].id !== st.recKey)) select(i);
    else if (st.list[i]) { st.idx = i; $("wRec").value = st.list[i].id; }
  }

  function settingsFor(item, rec) {
    const cache = ctx.getCache(), rdb = cache ? cache.rdb : new Map();
    if (st.settingsChoice === "none") return { s: {}, label: "No settings" };
    if (st.settingsChoice !== "auto" && rdb.has(st.settingsChoice)) return { s: Object.assign({}, rdb.get(st.settingsChoice)), label: `${st.settingsChoice} (chosen)` };
    if (item.group === "ref") return { s: {}, label: "Reference settings (built in)" };
    const [s, label] = core.matchSettings({ relay_id: rec.relay || "" }, rdb);
    const base = rec.settings && Object.keys(rec.settings).length ? "settings inside the record" : "";
    if (label) return { s, label: `${label}${base ? " + " + base : ""}` };
    return { s: {}, label: base || "No settings matched" };
  }

  function select(i) {
    if (i < 0 || i >= st.list.length) return;
    st.idx = i;
    const item = st.list[i];
    $("wRec").value = item.id;
    let rec;
    try { rec = item.make(); } catch (e) { ctx.setStatus("Couldn't open that record: " + (e.message || e)); return; }
    if (!rec || !rec.n) { ctx.setStatus("That record has no samples"); return; }
    st.rec = rec; st.item = item; st.recKey = item.id; st.cache = {};
    const sset = settingsFor(item, rec);
    st.settingsLabel = sset.label;
    st.an = A.analyze(rec, sset.s);
    // channels
    st.channels = rec.analogs.map((c) => ({ ...c, on: c.kind === "I" || c.kind === "V" || c.kind === "other" }));
    const ch = A.channels(rec);
    if (ch.IA && ch.IB && ch.IC && !ch.IN) {
      const v = new Float64Array(rec.n);
      for (let k = 0; k < rec.n; k++) v[k] = ch.IA.values[k] + ch.IB.values[k] + ch.IC.values[k];
      st.channels.push({ name: "3I0", label: "3I0 (calc)", phase: "N", kind: "I", unit: ch.IA.unit, values: v, on: false, calc: true });
    }
    // relay element rows: changed elements by group, then first-on time
    const els = st.an.elements.slice();
    els.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || (a.firstOn === null) - (b.firstOn === null) || (a.firstOn || 0) - (b.firstOn || 0));
    st.digSel = new Set(els.filter((e) => e.changed).slice(0, st.adv ? 24 : 12).map((e) => e.name));
    st.marks = eventMarks(rec);
    st.hChan = (ch["I" + ((st.an.cls.at && st.an.cls.at.faulted && st.an.cls.at.faulted[0]) || "A")] || rec.analogs[0]).name;
    st.cursor = st.an.cls.faultIdx !== null ? st.an.cls.faultIdx : Math.min(rec.n - 1, (rec.trigger || 0) + rec.spc);
    fitFault();
    renderStatic();
    redraw();
    renderCursorPanels();
    ctx.store.set("w.last", item.id);
  }

  // ---------------- view
  function fitAll() { st.view = { t0: st.rec.t[0], t1: st.rec.t[st.rec.n - 1] }; }
  function fitFault() {
    const rec = st.rec, f = rec.freq;
    const open = (st.marks.find((x) => x.kind === "open") || st.marks.find((x) => x.kind === "trip") || {}).t;
    const end = open !== undefined ? open + 3 / f : rec.t[Math.min(rec.n - 1, (st.an.cls.faultIdx || rec.trigger || 0) + 6 * rec.spc)];
    st.view = { t0: Math.max(rec.t[0], -2 / f), t1: Math.min(rec.t[rec.n - 1], Math.max(end, 6 / f)) };
    if (st.view.t1 - st.view.t0 < 4 / f) fitAll();
  }
  function zoom(factor, center) {
    const rec = st.rec, v = st.view;
    const c = center !== undefined ? center : rec.t[st.cursor] !== undefined && rec.t[st.cursor] >= v.t0 && rec.t[st.cursor] <= v.t1 ? rec.t[st.cursor] : (v.t0 + v.t1) / 2;
    const full = rec.t[rec.n - 1] - rec.t[0];
    let span = clamp((v.t1 - v.t0) * factor, 0.5 / rec.freq, full);
    let t0 = c - (c - v.t0) * (span / (v.t1 - v.t0));
    t0 = clamp(t0, rec.t[0], rec.t[rec.n - 1] - span);
    st.view = { t0, t1: t0 + span };
    redraw();
  }
  function pan(dt) {
    const rec = st.rec, span = st.view.t1 - st.view.t0;
    const t0 = clamp(st.view.t0 + dt, rec.t[0], rec.t[rec.n - 1] - span);
    st.view = { t0, t1: t0 + span };
    redraw();
  }

  function model() {
    return {
      rec: st.rec, view: st.view, mode: st.mode, xunit: st.xunit, channels: st.channels, cache: st.cache,
      digRows: st.an.elements.filter((e) => st.digSel.has(e.name)).sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || (a.firstOn === null) - (b.firstOn === null) || (a.firstOn || 0) - (b.firstOn || 0)),
      marks: st.marks, pins: pins(), cursorIdx: st.cursor, hCycles: st.hCycles,
    };
  }

  let lay = null;
  function redraw() {
    if (!st.rec) return;
    const W = Math.max(240, canvas.parentElement.clientWidth);
    const m = model();
    const l = layout(m, W);
    const dpr = window.devicePixelRatio || 1;
    for (const c of [canvas, overlay]) {
      c.width = Math.round(W * dpr); c.height = Math.round(l.H * dpr);
      c.style.width = W + "px"; c.style.height = l.H + "px";
    }
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    lay = draw(g, m, W, themeNow());
    clearOverlay();
    // scrollbar
    const rec = st.rec, full = rec.t[rec.n - 1] - rec.t[0], span = st.view.t1 - st.view.t0;
    const sc = $("wScroll");
    sc.disabled = span >= full - 1e-9;
    sc.value = sc.disabled ? 0 : Math.round(((st.view.t0 - rec.t[0]) / (full - span)) * 1000);
    $("wSpan").textContent = `Showing ${fmt((st.view.t0) * rec.freq, 1)} to ${fmt(st.view.t1 * rec.freq, 1)} cycles (${fmt(span * 1000, 0)} ms of ${fmt(full * 1000, 0)} ms)`;
  }
  function clearOverlay() {
    const g = overlay.getContext("2d"); const dpr = window.devicePixelRatio || 1;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, overlay.width, overlay.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return g;
  }

  // ---------------- pointer interaction
  const tAtX = (x) => st.view.t0 + ((x - L) / lay.plotW) * (st.view.t1 - st.view.t0);
  const xAtT = (t) => L + ((t - st.view.t0) / (st.view.t1 - st.view.t0)) * lay.plotW;
  function localXY(e) { const r = overlay.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  overlay.addEventListener("pointerdown", (e) => {
    if (!st.rec || e.button > 1) return;
    const [x] = localXY(e);
    overlay.setPointerCapture(e.pointerId);
    st.drag = { x0: x, x, pan: e.shiftKey || e.button === 1, t0: st.view.t0, moved: false };
  });
  overlay.addEventListener("pointermove", (e) => {
    if (!st.rec || !lay) return;
    const [x, y] = localXY(e);
    if (st.drag) {
      st.drag.x = x;
      if (Math.abs(x - st.drag.x0) > 4) st.drag.moved = true;
      if (st.drag.pan && st.drag.moved) {
        const dt = -((x - st.drag.x0) / lay.plotW) * (st.view.t1 - st.view.t0);
        const span = st.view.t1 - st.view.t0, rec = st.rec;
        const t0 = clamp(st.drag.t0 + dt, rec.t[0], rec.t[rec.n - 1] - span);
        st.view = { t0, t1: t0 + span }; redraw();
        return;
      }
      if (st.drag.moved) {
        const g = clearOverlay();
        const a = clamp(Math.min(st.drag.x0, x), L, L + lay.plotW), b = clamp(Math.max(st.drag.x0, x), L, L + lay.plotW);
        g.fillStyle = (themeNow() === "dark" ? DARK : LIGHT).zoom; g.fillRect(a, 0, b - a, lay.H - AXIS_H);
        return;
      }
    }
    hover(x, y, e);
  });
  overlay.addEventListener("pointerup", (e) => {
    if (!st.drag) return;
    const d = st.drag; st.drag = null;
    const [x] = localXY(e);
    if (d.moved && !d.pan) {
      const a = tAtX(clamp(Math.min(d.x0, x), L, L + lay.plotW)), b = tAtX(clamp(Math.max(d.x0, x), L, L + lay.plotW));
      if (b - a > 0.25 / st.rec.freq) { st.view = { t0: a, t1: b }; redraw(); }
      else clearOverlay();
      return;
    }
    if (d.moved) return;
    if (x < L || x > L + lay.plotW) return;
    const idx = idxAt(st.rec, tAtX(x));
    if (st.noteMode) { askNote(idx, e); return; }
    setCursor(idx);
  });
  overlay.addEventListener("pointerleave", () => { if (!st.drag) { clearOverlay(); tip.hidden = true; } });
  overlay.addEventListener("dblclick", () => { fitFault(); redraw(); });
  overlay.addEventListener("wheel", (e) => {
    if (!st.rec) return;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom(e.deltaY > 0 ? 1.25 : 0.8, tAtX(localXY(e)[0])); }
    else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { e.preventDefault(); pan(((e.deltaX || e.deltaY) / 600) * (st.view.t1 - st.view.t0)); }
  }, { passive: false });
  overlay.addEventListener("keydown", (e) => {
    if (!st.rec) return;
    const step = e.shiftKey ? st.rec.spc : 1;
    if (e.key === "ArrowRight") { e.preventDefault(); setCursor(Math.min(st.rec.n - 1, st.cursor + step), true); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setCursor(Math.max(0, st.cursor - step), true); }
    else if (e.key === "+" || e.key === "=") zoom(0.7);
    else if (e.key === "-") zoom(1.4);
    else if (e.key === "0") { fitAll(); redraw(); }
    else if (e.key === "f" || e.key === "F") { fitFault(); redraw(); }
    else if (e.key === "n" || e.key === "N") { e.preventDefault(); askNote(st.cursor, null); }
  });

  function hover(x, y) {
    const g = clearOverlay();
    if (x < L || x > L + lay.plotW) { tip.hidden = true; return; }
    const P = themeNow() === "dark" ? DARK : LIGHT;
    const idx = idxAt(st.rec, tAtX(x)), rec = st.rec;
    const xs = Math.round(xAtT(rec.t[idx])) + 0.5;
    const top = lay.panels[0].y, bottom = lay.panels[lay.panels.length - 1].y + lay.panels[lay.panels.length - 1].h;
    g.strokeStyle = P.muted; g.lineWidth = 1; g.setLineDash([2, 2]);
    g.beginPath(); g.moveTo(xs, top); g.lineTo(xs, bottom); g.stroke(); g.setLineDash([]);
    const t = rec.t[idx];
    let html = `<b>${fmt(t * rec.freq, 2)} cyc</b> <span class="muted">(${fmt(t * 1000, 1)} ms)</span>`;
    const panel = lay.panels.find((p) => y >= p.y - 4 && y <= p.y + p.h + 4);
    if (panel && panel.kind === "D") {
      const r = Math.floor((y - panel.y - 4) / 17), row = panel.rows[r];
      if (row) {
        const on = row.intervals.some(([a, b]) => idx >= a && idx < b);
        html += `<br><b>${esc(row.name)}</b> ${on ? "ON" : "off"}<br><span class="muted">${esc(row.meaning)}</span>`;
      }
    } else {
      const chans = (panel ? panel.chans : lay.panels.filter((p) => p.chans).flatMap((p) => p.chans));
      for (const c of chans || []) {
        const v = seriesFor(rec, c, st.mode, st.cache)[idx];
        const rms = A.cabs(A.phasorAt(c.values, idx, rec.spc));
        html += `<br>${esc(c.label || c.name)}: ${isFinite(v) ? fmt(v, c.unit === "kV" ? 2 : 0) : "-"} <span class="muted">· ${fmtMag(rms, c.unit)} rms</span>`;
        if (panel && panel.Y && isFinite(v)) { g.fillStyle = P.ink; g.beginPath(); g.arc(xs, panel.Y(v), 3, 0, Math.PI * 2); g.fill(); }
      }
    }
    if (st.noteMode) html += `<br><span class="muted">Click to pin a note here</span>`;
    tip.innerHTML = html; tip.hidden = false;
    const wrapR = overlay.parentElement.getBoundingClientRect();
    const tw = tip.offsetWidth, left = x + 14 + tw > wrapR.width ? x - tw - 14 : x + 14;
    tip.style.left = left + "px"; tip.style.top = Math.max(0, Math.min(y + 10, overlay.clientHeight - tip.offsetHeight - 4)) + "px";
  }

  function setCursor(idx, keepVisible) {
    st.cursor = clamp(idx, 0, st.rec.n - 1);
    if (keepVisible) {
      const t = st.rec.t[st.cursor], v = st.view;
      if (t < v.t0 || t > v.t1) { const span = v.t1 - v.t0; st.view = { t0: t - span / 2, t1: t + span / 2 }; }
    }
    redraw();
    renderCursorPanels();
  }

  // ---------------- notes on the graph
  const pinsAll = () => ctx.store.get("pins", {});
  function pins() { return (pinsAll()[st.recKey] || []).slice().sort((a, b) => a.t - b.t); }
  function savePins(list) { const all = pinsAll(); if (list.length) all[st.recKey] = list; else delete all[st.recKey]; ctx.store.set("pins", all); }
  function askNote(idx, e) {
    const box = $("wNoteAsk"), t = st.rec.t[idx];
    box.hidden = false;
    $("wNoteAt").textContent = `Note at ${fmt(t * st.rec.freq, 2)} cycles`;
    $("wNoteText").value = "";
    box.dataset.t = String(t);
    const x = xAtT(t);
    box.style.left = clamp(x - 140, 0, Math.max(0, overlay.clientWidth - 300)) + "px";
    box.style.top = "40px";
    $("wNoteText").focus();
  }
  function addPin() {
    const box = $("wNoteAsk"), text = $("wNoteText").value.trim();
    box.hidden = true;
    if (!text) return;
    const list = pins(); list.push({ t: parseFloat(box.dataset.t), text });
    savePins(list); setNoteMode(false); redraw(); renderPins();
    ctx.setStatus("Note pinned to the graph. It's saved in this browser and included when you export.");
  }
  $("wNoteSave").addEventListener("click", addPin);
  $("wNoteCancel").addEventListener("click", () => { $("wNoteAsk").hidden = true; });
  $("wNoteText").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addPin(); } else if (e.key === "Escape") $("wNoteAsk").hidden = true; });
  function setNoteMode(on) {
    st.noteMode = on; $("wNoteMode").setAttribute("aria-pressed", String(on));
    overlay.style.cursor = on ? "copy" : "crosshair";
    if (on) ctx.setStatus("Click on the graph where the note should go (Esc to cancel)");
  }
  $("wNoteMode").addEventListener("click", () => setNoteMode(!st.noteMode));
  function renderPins() {
    const ul = $("wPins"), list = pins();
    ul.textContent = "";
    if (!list.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = "No notes yet. Use “Add note” and click on the graph."; ul.appendChild(li); }
    list.forEach((p, i) => {
      const li = document.createElement("li");
      const n = document.createElement("span"); n.className = "pin-n"; n.textContent = i + 1;
      const at = document.createElement("button"); at.className = "linkish"; at.textContent = `${fmt(p.t * st.rec.freq, 2)} cyc`; at.title = "Move the cursor here";
      at.addEventListener("click", () => setCursor(idxAt(st.rec, p.t), true));
      const tx = document.createElement("input"); tx.value = p.text; tx.setAttribute("aria-label", `Note ${i + 1}`);
      tx.addEventListener("change", () => { const l = pins(); const k = l.findIndex((q) => q.t === p.t && q.text === p.text); if (k >= 0) { l[k].text = tx.value.trim() || l[k].text; savePins(l); redraw(); } });
      const x = document.createElement("button"); x.className = "x"; x.textContent = "×"; x.title = "Delete note"; x.setAttribute("aria-label", `Delete note ${i + 1}`);
      x.addEventListener("click", () => { savePins(pins().filter((q) => !(q.t === p.t && q.text === p.text))); redraw(); renderPins(); });
      li.append(n, at, tx, x); ul.appendChild(li);
    });
    $("wPinCount").textContent = list.length ? `${list.length} note${list.length === 1 ? "" : "s"}` : "";
  }

  // ---------------- static panels (per record)
  function renderStatic() {
    const rec = st.rec, an = st.an, cls = an.cls, item = st.item;
    // reference card
    const rc = $("wRefCard");
    if (item.refInfo) {
      const i = st.list.filter((x) => x.group === "ref").indexOf(item) + 1, n = st.list.filter((x) => x.group === "ref").length;
      rc.hidden = false;
      rc.innerHTML = `<div class="cap">Reference ${i} of ${n}</div><h3>${esc(item.refInfo.title)}</h3><p>${esc(item.refInfo.what)}</p>` +
        `<div class="cap">What to look for</div><ul>${item.refInfo.lookFor.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    } else rc.hidden = true;
    // header
    const when = [rec.date, rec.time].filter(Boolean).join(" ");
    $("wTitle").textContent = item.refInfo ? item.refInfo.title : `${rec.relay || rec.station || rec.source}`;
    $("wMeta").textContent = [item.refInfo ? "Built-in example" : rec.source, when, `${rec.freq} Hz`, `${rec.spc} samples/cycle`,
      `${fmt((rec.t[rec.n - 1] - rec.t[0]) * rec.freq, 1)} cycles`, `${rec.analogs.length} analog, ${rec.digitals.length} element channels`,
      `Settings: ${st.settingsLabel}`].filter(Boolean).join("  ·  ");
    // verdict
    $("wCode").textContent = cls.code === "NONE" ? "—" : cls.code;
    $("wCode").className = "code " + (cls.code === "NONE" ? "ok" : cls.code === "INRUSH" ? "warn" : "trip");
    $("wName").textContent = cls.name;
    $("wMeans").textContent = meaningOf(cls.code);
    const ev = cls.evidence.slice();
    const relaySaid = item.event && item.event.event_type ? core.eventCore(item.event.event_type) : "";
    let agree = "";
    if (relaySaid) {
      const same = relaySaid === cls.code || (relaySaid === "ABCG" && cls.code === "ABC");
      agree = same ? `<li class="good">The relay also reported <b>${esc(item.event.event_type)}</b>.</li>`
        : `<li class="warnli"><b>CHECK:</b> the relay reported <b>${esc(item.event.event_type)}</b>, the waveforms look like <b>${esc(cls.code)}</b>. Compare the currents below.</li>`;
    }
    const wx = item.event ? (ctx.store.get("wxResults", {})[st.recKey] || null) : null;
    const wxLine = wx ? `<li>Weather: ${esc(wx.text)}${(wx.hints || []).filter((h) => h.kind !== "calm").map((h) => `<div class="hint">${esc(h.text)}</div>`).join("")}</li>` : "";
    $("wEvidence").innerHTML = ev.map((x) => `<li>${esc(x)}</li>`).join("") + agree + wxLine;
    $("wFlags").innerHTML = cls.notes.map((x) => `<li>${esc(x)}</li>`).join("");
    $("wFlags").hidden = !cls.notes.length;
    // channel chips
    const chips = $("wChips");
    chips.textContent = "";
    const PH = PHASE[themeNow()];
    for (const c of st.channels) {
      const b = document.createElement("button");
      b.className = "chip"; b.setAttribute("aria-pressed", String(c.on));
      const sw = document.createElement("span"); sw.className = "sw" + (/^[ABC]$/.test(c.phase) ? "" : " dash");
      sw.style.background = /^[ABC]$/.test(c.phase) ? PH[c.phase] : "";
      b.append(sw, document.createTextNode(c.label || c.name));
      b.title = `${c.kind === "I" ? "Current" : c.kind === "V" ? "Voltage" : "Analog"} ${c.name}${c.calc ? " (calculated: IA + IB + IC)" : ""}: click to show/hide`;
      b.addEventListener("click", () => { c.on = !c.on; b.setAttribute("aria-pressed", String(c.on)); redraw(); });
      chips.appendChild(b);
    }
    // settings choice
    const ss = $("wSettings"), cache = ctx.getCache();
    ss.textContent = "";
    for (const [v, t] of [["auto", "Settings: matched automatically"], ...[...(cache ? cache.rdb.keys() : [])].map((k) => [k, `Settings: ${k}`]), ["none", "Settings: none"]]) {
      const o = document.createElement("option"); o.value = v; o.textContent = t; ss.appendChild(o);
    }
    ss.value = st.settingsChoice;
    // harmonic channel select
    const hs = $("wHChan"); hs.textContent = "";
    for (const c of rec.analogs) { const o = document.createElement("option"); o.value = c.name; o.textContent = c.name; hs.appendChild(o); }
    hs.value = st.hChan;
    renderOC(); renderElements(); renderPins();
    $("wEventNote").value = (ctx.store.get("notes", {})[st.recKey]) || "";
    $("wEventNoteHint").textContent = item.event ? "Also shown in the trip summary for this event" : item.group === "ref" ? "Saved with this reference example" : "Saved with this record";
    $("wPrev").disabled = st.idx <= 0; $("wNext").disabled = st.idx >= st.list.length - 1;
  }

  function renderOC() {
    const oc = st.an.oc, box = $("wOC"), adv = st.adv;
    if (!oc.rows.length) {
      box.innerHTML = `<p class="hint">No 50/51 overcurrent pickups found in the settings${st.settingsLabel.startsWith("No") ? " (no settings for this record: load the relay's .RDB, or pick one in the Settings list above)" : ""}.</p>`;
      return;
    }
    const ctr = oc.ctr;
    const head = ["Element", "Watches", "Pickup", "Measured", "Result", "Expected", "Actual", ""].concat(adv ? ["Pickup (sec)", "Measured (sec)", "Multiple", "Curve"] : []);
    const rows = oc.rows.map((r) => {
      const verdict = r.agrees === true ? `<span class="good">✓ Agrees</span>` : r.agrees === false ? `<span class="warnb">⚠ Differs</span>` : "";
      const cells = [
        `<b title="${esc(A.translateElement(r.element))}">${esc(r.element)}</b>`, esc(r.qty),
        ctr ? `${fmt(r.pickup * ctr, 0)} A` : `${fmt(r.pickup, 2)} A sec`, `${fmt(r.measuredPrimary, 0)} A`,
        esc(r.verdict), esc(r.expected || "-"), esc(r.actual) + (r.note ? `<div class="hint">${esc(r.note)}</div>` : ""), verdict,
      ];
      if (adv) cells.push(`${fmt(r.pickup, 2)} A`, r.measuredSecondary !== null ? `${fmt(r.measuredSecondary, 2)} A` : "-", r.M !== null ? `${fmt(r.M, 2)}×` : "-",
                         r.kind === "51" ? `${esc(r.curve)} ${esc(r.curveName)}, TD ${fmt(r.td, 2)}` : "Instantaneous");
      return `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
    });
    box.innerHTML = `<div class="tablewrap"><table class="grid-t"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>` +
      `<p class="hint">Pickups and currents in primary amps${ctr ? ` (CTR ${fmt(ctr, 0)})` : ""}. "Measured" is the largest fundamental value during the record. Expected time comes from the relay's own curve and time dial.</p>`;
  }

  function renderElements() {
    const f = st.elFilter, adv = st.adv, rec = st.rec;
    const q = f.q.trim().toUpperCase();
    const els = st.an.elements.filter((e) => (!f.changed || e.changed || (adv && e.everOn)) && (!f.group || e.group === f.group) &&
      (!q || e.name.toUpperCase().includes(q) || e.meaning.toUpperCase().includes(q)));
    els.sort((a, b) => (a.firstOn === null) - (b.firstOn === null) || (a.firstOn || 0) - (b.firstOn || 0) || a.name.localeCompare(b.name));
    const gs = $("wElGroup");
    if (!gs.options.length || gs.dataset.rec !== st.recKey) {
      gs.dataset.rec = st.recKey;
      const groups = [...new Set(st.an.elements.map((e) => e.group))].sort((a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b));
      gs.innerHTML = `<option value="">All groups</option>` + groups.map((g) => `<option>${esc(g)}</option>`).join("");
      gs.value = groups.includes(f.group) ? f.group : "";
    }
    const cy = (k) => fmt(rec.t[k] * rec.freq, 2);
    const rows = els.map((e) => {
      const on = e.intervals.filter(([a]) => !(a === 0 && e.initial)).map(([a]) => cy(a)).join(", "), off = e.intervals.map(([, b]) => (b >= rec.n - 1 ? "end" : cy(b))).join(", ");
      const dur = e.intervals.reduce((t, [a, b]) => t + (rec.t[b] - rec.t[a]), 0) * rec.freq;
      return `<tr><td><input type="checkbox" data-el="${esc(e.name)}" ${st.digSel.has(e.name) ? "checked" : ""} aria-label="Show ${esc(e.name)} on the graph"></td>` +
        `<td><b>${esc(e.name)}</b></td><td>${esc(e.meaning)}</td>` + (adv ? `<td>${esc(e.group)}</td>` : "") +
        `<td>${e.initial ? "on at start" + (on ? ", " : "") : ""}${on || (e.initial ? "" : "-")}</td><td>${off || "-"}</td>` +
        (adv ? `<td>${fmt(dur, 2)}</td><td>${e.intervals.length}</td>` : "") + `</tr>`;
    });
    const head = ["Graph", "Element", "What it means"].concat(adv ? ["Group"] : []).concat(["On (cyc)", "Off (cyc)"]).concat(adv ? ["Time on (cyc)", "Times on"] : []);
    $("wEls").innerHTML = rows.length ? `<div class="tablewrap"><table class="grid-t"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
      : `<p class="hint">No elements match.${f.changed ? " Untick “Only elements that changed” to see all of them." : ""}</p>`;
    $("wElCount").textContent = `${els.length} of ${st.an.elements.length}`;
  }
  $("wEls").addEventListener("change", (e) => {
    const cb = e.target.closest("[data-el]"); if (!cb) return;
    if (cb.checked) st.digSel.add(cb.dataset.el); else st.digSel.delete(cb.dataset.el);
    redraw();
  });
  $("wElSearch").addEventListener("input", () => { st.elFilter.q = $("wElSearch").value; renderElements(); });
  $("wElGroup").addEventListener("change", () => { st.elFilter.group = $("wElGroup").value; renderElements(); });
  $("wElChanged").addEventListener("change", () => { st.elFilter.changed = $("wElChanged").checked; renderElements(); });
  $("wElAll").addEventListener("click", () => {
    const vis = st.an.elements.filter((e) => e.changed);
    const allOn = vis.every((e) => st.digSel.has(e.name));
    for (const e of vis) if (allOn) st.digSel.delete(e.name); else st.digSel.add(e.name);
    renderElements(); redraw();
  });

  // ---------------- cursor-dependent panels
  function renderCursorPanels() {
    const rec = st.rec, adv = st.adv, idx = st.cursor;
    const snap = A.snapshot(rec, idx);
    st.snap = snap;
    const t = rec.t[idx];
    $("wCursorAt").textContent = `${fmt(t * rec.freq, 2)} cycles (${fmt(t * 1000, 1)} ms) after trigger`;
    // phasors
    const S = Math.min(300, Math.max(220, $("wPhasor").parentElement.clientWidth));
    const pc = $("wPhasor"), dpr = window.devicePixelRatio || 1;
    pc.width = S * dpr; pc.height = S * dpr; pc.style.width = S + "px"; pc.style.height = S + "px";
    const g = pc.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPhasors(g, S, snap, rec, themeNow(), st.showPh);
    $("wPhRef").textContent = snap.ref ? `Angles relative to ${snap.ref}. One-cycle window ending at the cursor.` : "";
    // phasor table
    const rows = rec.analogs.filter((c) => c.kind === "I" || c.kind === "V").map((c) => {
      const z = snap.phasors[c.name];
      return `<tr><td><b>${esc(c.name)}</b></td><td>${fmtMag(A.cabs(z), c.unit)}</td>${adv ? `<td>${fmtAng(A.cang(z))}</td>` : ""}</tr>`;
    });
    $("wPhTable").innerHTML = `<table class="grid-t compact"><thead><tr><th>Channel</th><th>Magnitude (rms)</th>${adv ? "<th>Angle</th>" : ""}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
    // sequence components
    const seqRows = [];
    const addSeq = (kind, s, unit) => {
      if (!s) return;
      for (const k of ["pos", "neg", "zero"].concat(kind === "I" ? ["residual"] : [])) {
        const sym = kind === "I" ? { pos: "I1", neg: "I2", zero: "I0", residual: "3I0" }[k] : { pos: "V1", neg: "V2", zero: "V0" }[k];
        if (!adv && k === "zero" && kind === "I") continue;   // simple view: show 3I0 instead of I0
        seqRows.push(`<tr><td><b>${sym}</b></td><td>${fmtMag(A.cabs(s[k]), unit)}</td>${adv ? `<td>${fmtAng(A.cang(s[k]))}</td>` : ""}` +
          `<td>${esc(SEQ_WORDS[k][0])}${adv || kind === "V" ? "" : `<div class="hint">${esc(SEQ_WORDS[k][1])}</div>`}</td></tr>`);
      }
    };
    const ch = A.channels(rec);
    addSeq("I", snap.seq.I, ch.IA ? ch.IA.unit : "A");
    addSeq("V", snap.seq.V, ch.VA ? ch.VA.unit : "kV");
    let ratio = "";
    if (snap.seq.I) {
      const i1 = A.cabs(snap.seq.I.pos), i2 = A.cabs(snap.seq.I.neg), i0 = A.cabs(snap.seq.I.zero);
      if (i1 > 1e-6) ratio = `<p class="hint">I2/I1 = ${fmt((100 * i2) / i1, 0)}%, I0/I1 = ${fmt((100 * i0) / i1, 0)}%. ` +
        (i2 / i1 < 0.1 && i0 / i1 < 0.1 ? "Balanced: load or a three-phase event." : i0 / i1 > 0.25 ? "Ground is involved." : "Unbalanced without much ground: phase-to-phase.") + `</p>`;
    }
    $("wSeq").innerHTML = seqRows.length ? `<table class="grid-t compact"><thead><tr><th></th><th>Magnitude</th>${adv ? "<th>Angle</th>" : ""}<th>Meaning</th></tr></thead><tbody>${seqRows.join("")}</tbody></table>${ratio}`
      : `<p class="hint">Needs all three phase currents or voltages.</p>`;
    renderHarmonics();
  }

  function renderHarmonics() {
    const rec = st.rec, adv = st.adv;
    const c = rec.analogs.find((x) => x.name === st.hChan) || rec.analogs[0];
    const cycles = st.hCycles;
    const h = A.harmonics(c.values, st.cursor - rec.spc * cycles + 1, rec.spc, cycles, adv ? 15 : 7);
    if (!h) { $("wHarm").innerHTML = `<p class="hint">Not enough samples.</p>`; return; }
    const show = adv ? h.list.slice(1) : h.list.filter((x) => [2, 3, 5].includes(x.h));
    const max = Math.max(20, ...show.map((x) => x.pct));
    const words = { 2: "inrush / energizing", 3: "arcing, ground faults, saturation", 5: "transformers, drives (normal in small amounts)" };
    const bar = (label, pct, extra, title) => `<div class="hbar" title="${esc(title || "")}"><span class="hl">${label}</span><span class="track"><span class="fill" style="width:${clamp((pct / max) * 100, 0, 100)}%"></span></span><span class="hv">${fmt(pct, 1)}%</span>${extra || ""}</div>`;
    let html = `<div class="hsum"><span>Fundamental <b>${fmtMag(h.list[0].rms, c.unit)}</b></span><span>THD <b>${fmt(h.thd, 1)}%</b></span><span>DC offset <b>${fmt(h.dcPct, 0)}%</b></span></div>`;
    html += show.map((x) => bar(`${x.h}${x.h === 2 ? "nd" : x.h === 3 ? "rd" : "th"}`, x.pct, adv ? `<span class="hv muted">${fmtMag(x.rms, c.unit)}</span>` : "", words[x.h] || "")).join("");
    const notes = [];
    if (h.list[1] && h.list[1].pct > 15) notes.push("2nd harmonic above 15%: typical of transformer inrush.");
    if (h.dcPct > 30) notes.push("Large DC offset: normal at the start of a fault; it decays in a few cycles.");
    if (h.thd > 20 && !(h.list[1].pct > 15)) notes.push("High distortion: arcing, CT saturation or a non-linear load.");
    if (!adv) notes.push("Percent of the fundamental, over " + (cycles === 1 ? "the cycle" : cycles + " cycles") + " ending at the cursor.");
    html += notes.map((n) => `<p class="hint">${esc(n)}</p>`).join("");
    $("wHarm").innerHTML = html;
  }

  // ---------------- controls
  $("wRec").addEventListener("change", () => select(st.list.findIndex((x) => x.id === $("wRec").value)));
  $("wPrev").addEventListener("click", () => select(st.idx - 1));
  $("wNext").addEventListener("click", () => select(st.idx + 1));
  $("wZoomIn").addEventListener("click", () => zoom(0.6));
  $("wZoomOut").addEventListener("click", () => zoom(1.6));
  $("wFit").addEventListener("click", () => { fitAll(); redraw(); });
  $("wFault").addEventListener("click", () => { fitFault(); redraw(); });
  $("wScroll").addEventListener("input", () => {
    const rec = st.rec, full = rec.t[rec.n - 1] - rec.t[0], span = st.view.t1 - st.view.t0;
    const t0 = rec.t[0] + (parseInt($("wScroll").value, 10) / 1000) * (full - span);
    st.view = { t0, t1: t0 + span }; redraw();
  });
  $("wMode").value = st.mode;
  $("wMode").addEventListener("change", () => { st.mode = $("wMode").value; ctx.store.set("w.mode", st.mode); redraw(); });
  $("wXUnit").value = st.xunit;
  $("wXUnit").addEventListener("change", () => { st.xunit = $("wXUnit").value; ctx.store.set("w.xunit", st.xunit); redraw(); });
  $("wHChan").addEventListener("change", () => { st.hChan = $("wHChan").value; renderHarmonics(); });
  $("wHCycles").addEventListener("change", () => { st.hCycles = parseInt($("wHCycles").value, 10) || 1; renderHarmonics(); redraw(); });
  $("wSettings").addEventListener("change", () => { st.settingsChoice = $("wSettings").value; const i = st.idx; st.recKey = ""; select(i); });
  $("wShowI").addEventListener("change", () => { st.showPh.I = $("wShowI").checked; renderCursorPanels(); });
  $("wShowV").addEventListener("change", () => { st.showPh.V = $("wShowV").checked; renderCursorPanels(); });
  $("wToFault").addEventListener("click", () => { if (st.an.cls.faultIdx !== null) setCursor(st.an.cls.faultIdx, true); });
  $("wToPre").addEventListener("click", () => { if (st.an.cls.preIdx !== null) setCursor(st.an.cls.preIdx, true); });
  function setAdv(on) {
    st.adv = on; ctx.store.set("w.adv", on);
    $("pageWave").classList.toggle("adv", on);
    $("wSimple").setAttribute("aria-pressed", String(!on)); $("wAdv").setAttribute("aria-pressed", String(on));
    if (st.rec) { renderOC(); renderElements(); renderCursorPanels(); }
  }
  $("wSimple").addEventListener("click", () => setAdv(false));
  $("wAdv").addEventListener("click", () => setAdv(true));
  let noteTimer = null;
  $("wEventNote").addEventListener("input", () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      const all = ctx.store.get("notes", {}), v = $("wEventNote").value.trim();
      if (v) all[st.recKey] = v; else delete all[st.recKey];
      ctx.store.set("notes", all);
      if (st.item && st.item.event) ctx.onNotesChanged();
    }, 400);
  });
  window.addEventListener("resize", () => { if (!$("pageWave").hidden && st.rec) { redraw(); renderCursorPanels(); } });
  document.addEventListener("keydown", (e) => {
    if ($("pageWave").hidden) return;
    if (e.key === "Escape" && st.noteMode) setNoteMode(false);
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (e.key === "PageDown" || (e.altKey && e.key === "ArrowRight")) { e.preventDefault(); select(st.idx + 1); }
    else if (e.key === "PageUp" || (e.altKey && e.key === "ArrowLeft")) { e.preventDefault(); select(st.idx - 1); }
  });

  // ---------------- exports
  function figure(rec, an, opts) {
    opts = opts || {};
    const W = opts.width || 1400;
    const chans = (opts.channels || st.channels).map((c) => ({ ...c }));
    const m = {
      rec, view: opts.view, mode: opts.mode || "raw", xunit: opts.xunit || "cyc", channels: chans, cache: {},
      digRows: opts.digRows || [], marks: eventMarks(rec), pins: opts.pins || [], cursorIdx: opts.cursorIdx === undefined ? null : opts.cursorIdx,
      curH: opts.curH, volH: opts.volH,
    };
    const l = layout(m, W);
    const head = opts.title ? 30 : 0;
    const c = document.createElement("canvas");
    c.width = W * 2; c.height = (l.H + head) * 2;
    const g = c.getContext("2d"); g.scale(2, 2);
    g.fillStyle = "#fff"; g.fillRect(0, 0, W, l.H + head);
    if (opts.title) { g.fillStyle = LIGHT.ink; g.font = `600 15px ${FONT}`; g.textBaseline = "middle"; g.fillText(opts.title, 8, 16); }
    g.translate(0, head);
    draw(g, m, W, "light", { lineWidth: 1.5, cursor: opts.cursorIdx !== undefined });
    return { canvas: c, width: W, height: l.H + head };
  }
  function viewFor(range) {
    if (range === "all") return { t0: st.rec.t[0], t1: st.rec.t[st.rec.n - 1] };
    if (range === "fault") { const keep = st.view; fitFault(); const v = st.view; st.view = keep; return v; }
    return st.view;
  }
  function currentFigure(v) {
    v = v || {};
    return figure(st.rec, st.an, { view: viewFor(v.range), mode: st.mode, xunit: st.xunit, channels: st.channels,
                                   digRows: v.graphElements === false ? [] : model().digRows, pins: v.pins === false ? [] : pins(),
                                   cursorIdx: v.cursor === false ? undefined : st.cursor, title: titleText(), width: parseInt(v.width, 10) || 1400 });
  }
  function titleText() {
    const rec = st.rec;
    return st.item.refInfo ? `Reference: ${st.item.refInfo.title}` : `${rec.relay || rec.station || rec.source}  ${[rec.date, rec.time].filter(Boolean).join(" ")}`;
  }
  /** Compact picture of one record for the trip summary export. */
  function summaryFigure(e, fo) {
    fo = fo || {};
    const large = fo.size === "large";
    const rec = A.recordFromEvent(e);
    if (!rec) return null;
    const an = A.analyze(rec, {});
    const marks = eventMarks(rec), f = rec.freq;
    const open = (marks.find((x) => x.kind === "open") || marks.find((x) => x.kind === "trip") || {}).t;
    const view = { t0: Math.max(rec.t[0], -2 / f), t1: Math.min(rec.t[rec.n - 1], open !== undefined ? open + 3 / f : rec.t[rec.n - 1]) };
    const els = an.elements.filter((x) => x.changed);
    els.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || (a.firstOn || 0) - (b.firstOn || 0));
    const id = core.eventId(e);
    const list = fo.pins === false ? [] : (ctx.store.get("pins", {})[id] || []).slice().sort((a, b) => a.t - b.t);
    const fig = figure(rec, an, { view, channels: rec.analogs.map((c) => ({ ...c, on: true })), digRows: els.slice(0, large ? 16 : 8), pins: list,
                                  width: large ? 1400 : 1200, curH: large ? 210 : 150, volH: large ? 160 : 110 });
    return { png: pngBytes(fig.canvas), dataUrl: fig.canvas.toDataURL("image/png"), width: fig.width, height: fig.height,
             caption: `Waveforms: ${A.FAULT_NAMES[an.cls.code] || an.cls.code} (shaded: trigger to breaker open)` + (list.length ? `. Notes: ${list.map((p, i) => `${i + 1}) ${p.text}`).join("  ")}` : "") };
  }

  function exportPng(v) {
    const fig = currentFigure(v);
    fig.canvas.toBlob((b) => { ctx.download(`${(v && v.fileName) || fileNameFor("png")}.png`, b); ctx.setStatus("Saved the graph picture (with your notes)"); }, "image/png");
  }
  const fileSafe = (s) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
  /** e.g. "FEEDER 3 2026-10-21 14-22-05 CG" or "Reference - CT saturation during a ground fault" */
  function baseName() {
    const rec = st.rec;
    if (st.item.refInfo) return fileSafe(`Reference - ${st.item.refInfo.title}`);
    const dt = core.eventDatetime({ date: rec.date || "", time: rec.time || "" });
    let when = "";
    if (dt !== null) {
      const d = new Date(dt / 1000), p2 = (x) => String(x).padStart(2, "0");
      when = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}-${p2(d.getUTCMinutes())}-${p2(d.getUTCSeconds())}`;
    }
    const code = st.an.cls.code === "NONE" ? "no fault" : st.an.cls.code;
    return fileSafe(`${rec.relay || rec.station || rec.source} ${when} ${code}`);
  }
  const fileNameFor = (f) => `${baseName()} ${f === "docx" ? "waveform analysis" : f === "png" ? "graph" : "samples"}`;
  function exportCsv(v) {
    const rec = st.rec;
    const vw = v && v.csvRange === "view" ? st.view : null;
    const head = ["Time (s)", "Cycles"].concat(rec.analogs.map((c) => `${c.name} (${c.unit})`)).concat(!v || v.csvDigitals !== false ? rec.digitals.map((d) => d.name) : []);
    const lines = [head.map((x) => (/[",]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(",")];
    for (let k = 0; k < rec.n; k++) {
      if (vw && (rec.t[k] < vw.t0 || rec.t[k] > vw.t1)) continue;
      const row = [rec.t[k].toFixed(6), (rec.t[k] * rec.freq).toFixed(4)];
      for (const c of rec.analogs) row.push(c.values[k].toFixed(c.unit === "kV" ? 4 : 2));
      if (!v || v.csvDigitals !== false) for (const d of rec.digitals) row.push(d.values[k]);
      lines.push(row.join(","));
    }
    ctx.download(`${(v && v.fileName) || fileNameFor("csv")}.csv`, new Blob([lines.join("\r\n")], { type: "text/csv" }));
    ctx.setStatus("Saved the samples as a spreadsheet (primary units)");
  }
  function exportDocx(v) {
    v = Object.assign({ classification: true, graph: true, pins: true, phasors: true, sequence: true, harmonics: true, oc: true, elements: true, eventNote: true }, v || {});
    const rec = st.rec, an = st.an, cls = an.cls, adv = st.adv;
    const blocks = [];
    blocks.push(["title", "Waveform Analysis"]);
    blocks.push(["meta", [titleText(), `Generated ${core.nowStamp()}`, $("wMeta").textContent]]);
    const note = $("wEventNote").value.trim();
    if (note && v.eventNote) { blocks.push(["h1", "Notes"]); blocks.push(["para", note]); }
    if (v.classification) {
    blocks.push(["h1", "Classification"]);
    blocks.push(["kv", [["Fault type", `${cls.code === "NONE" ? "None" : cls.code}: ${cls.name}`], ["Meaning", meaningOf(cls.code) || "-"]]]);
    if (st.item.event && st.item.event.event_type) blocks[blocks.length - 1][1].push(["Relay reported", st.item.event.event_type]);
    if (cls.evidence.length) blocks.push(["bullets", cls.evidence.slice()]);
    if (cls.notes.length) blocks.push(["bullets", cls.notes.map((n) => "CHECK: " + n)]);
    }
    if (v.graph) {
    const fig = currentFigure(v);
    blocks.push(["h1", "Waveforms"]);
    blocks.push(["image", { png: pngBytes(fig.canvas), width: fig.width, height: fig.height,
      caption: `${$("wSpan").textContent}. Shaded: trigger to breaker open. Blue line: analysis cursor at ${$("wCursorAt").textContent}.` }]);
    }
    const list = pins();
    if (list.length && v.pins) blocks.push(["table", ["#", "Time (cyc)", "Note"], list.map((p, i) => [String(i + 1), fmt(p.t * rec.freq, 2), p.text]), [6, 16, 78]]);
    if (v.phasors) {
    blocks.push(["h1", `Phasors at ${$("wCursorAt").textContent}`]);
    const pc = document.createElement("canvas"); pc.width = 640; pc.height = 640;
    const g = pc.getContext("2d"); g.scale(2, 2); drawPhasors(g, 320, st.snap, rec, "light", { I: true, V: true });
    blocks.push(["image", { png: pngBytes(pc), width: 320, height: 320, maxInches: 3.2, caption: st.snap.ref ? `Angles relative to ${st.snap.ref}` : "" }]);
    blocks.push(["table", ["Channel", "Magnitude (rms)", "Angle"], rec.analogs.filter((c) => c.kind === "I" || c.kind === "V").map((c) => {
      const z = st.snap.phasors[c.name]; return [c.name, fmtMag(A.cabs(z), c.unit), fmtAng(A.cang(z))];
    }), [25, 40, 35]]);
    }
    const seq = [];
    const ch = A.channels(rec);
    for (const [kind, s, unit] of [["I", st.snap.seq.I, ch.IA ? ch.IA.unit : "A"], ["V", st.snap.seq.V, "kV"]]) {
      if (!s) continue;
      for (const k of ["pos", "neg", "zero"].concat(kind === "I" ? ["residual"] : [])) {
        const sym = kind === "I" ? { pos: "I1", neg: "I2", zero: "I0", residual: "3I0" }[k] : { pos: "V1", neg: "V2", zero: "V0" }[k];
        seq.push([sym, fmtMag(A.cabs(s[k]), unit), fmtAng(A.cang(s[k])), SEQ_WORDS[k][1]]);
      }
    }
    if (seq.length && v.sequence) { blocks.push(["h2", "Sequence components"]); blocks.push(["table", ["", "Magnitude", "Angle", "Meaning"], seq, [8, 18, 14, 60]]); }
    const c = rec.analogs.find((x) => x.name === st.hChan) || rec.analogs[0];
    const h = A.harmonics(c.values, st.cursor - rec.spc * st.hCycles + 1, rec.spc, st.hCycles, 15);
    if (h && v.harmonics) {
      blocks.push(["h2", `Harmonics of ${c.name}`]);
      blocks.push(["kv", [["Fundamental", fmtMag(h.list[0].rms, c.unit)], ["THD", `${fmt(h.thd, 1)}%`], ["DC offset", `${fmt(h.dcPct, 0)}%`]]]);
      blocks.push(["table", ["Harmonic", "% of fundamental", "Magnitude"], h.list.slice(1, adv ? 15 : 7).map((x) => [String(x.h), `${fmt(x.pct, 1)}%`, fmtMag(x.rms, c.unit)]), [20, 40, 40]]);
    }
    if (an.oc.rows.length && v.oc) {
      blocks.push(["h1", "Overcurrent Elements vs. Settings"]);
      blocks.push(["table", ["Element", "Pickup", "Measured", "Result", "Expected", "Actual"], an.oc.rows.map((r) => [
        r.element, an.oc.ctr ? `${fmt(r.pickup * an.oc.ctr, 0)} A` : `${fmt(r.pickup, 2)} A sec`, `${fmt(r.measuredPrimary, 0)} A`, r.verdict,
        r.expected || "-", r.actual + (r.note ? ` (${r.note})` : "") + (r.agrees === false ? " - CHECK" : "")]), [10, 13, 13, 20, 18, 26]]);
      blocks.push(["note", `Settings: ${st.settingsLabel}. Primary amps${an.oc.ctr ? `, CTR ${fmt(an.oc.ctr, 0)}` : ""}.`]);
    }
    const els = an.elements.filter((e) => e.changed);
    if (els.length && v.elements) {
      blocks.push(["h1", "Relay Elements That Changed"]);
      blocks.push(["table", ["Element", "Meaning", "On (cyc)", "Off (cyc)"], els.map((e) => [e.name, e.meaning,
        (e.initial ? ["on at start"] : []).concat(e.intervals.filter(([a]) => !(a === 0 && e.initial)).map(([a]) => fmt(rec.t[a] * rec.freq, 2))).join(", "), e.intervals.map(([, b]) => (b >= rec.n - 1 ? "end" : fmt(rec.t[b] * rec.freq, 2))).join(", ")]), [14, 54, 16, 16]]);
    }
    blocks.push(["note", "Automated analysis from the recorded waveforms. Confirm against the relay's own event report and settings."]);
    const bytes = DOCX.build(blocks, { title: "Waveform analysis", footer: `SEL Trip Event Analyzer v${ctx.version}`, runs: core.tripRuns, paper: v.paper });
    ctx.download(`${v.fileName || fileNameFor("docx")}.docx`, new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    ctx.setStatus("Saved the waveform analysis as a Word document");
  }
  const WAVE_EXPORT = {
    title: "Export this waveform analysis", storeKey: "exp.wave",
    formats: [["docx", "Word report (.docx)"], ["png", "Picture of the graph (.png)"], ["csv", "Samples (.csv)"]],
    groups: [
      { title: "Include", only: ["docx"], items: [
        { key: "eventNote", label: "Event notes", def: true }, { key: "classification", label: "Fault type and evidence", def: true },
        { key: "graph", label: "Graph", def: true }, { key: "pins", label: "Notes pinned on the graph", def: true },
        { key: "phasors", label: "Phasors at the cursor", def: true }, { key: "sequence", label: "Sequence components", def: true },
        { key: "harmonics", label: "Harmonics", def: true }, { key: "oc", label: "Overcurrent check vs. settings", def: true },
        { key: "elements", label: "Relay elements that changed", def: true }] },
      { title: "Graph", only: ["docx", "png"], items: [
        { key: "range", label: "Time range", def: "view", options: [["view", "What's on screen now"], ["fault", "The fault (trigger to breaker open)"], ["all", "Whole record"]] },
        { key: "width", label: "Picture width", def: "1400", only: ["png"], options: [["1000", "Small (1000 px)"], ["1400", "Medium (1400 px)"], ["2000", "Large (2000 px)"]] },
        { key: "graphElements", label: "Relay elements under the graph", def: true, only: ["png"] }, { key: "pins", label: "Notes pinned on the graph", def: true, only: ["png"] },
        { key: "cursor", label: "Show the cursor line", def: true }] },
      { title: "Page", only: ["docx"], items: [{ key: "paper", label: "Paper", def: "letter", options: [["letter", "Letter (8.5 × 11 in)"], ["a4", "A4"]] }] },
      { title: "Samples", only: ["csv"], items: [
        { key: "csvRange", label: "Rows", def: "all", options: [["all", "Whole record"], ["view", "Only the time range on screen"]] },
        { key: "csvDigitals", label: "Relay element columns (0/1)", def: true }] },
    ],
    hint: (f) => (f === "csv" ? "Primary amps and kV, one row per sample." : "Uses the channels, mode and notes you have on screen."),
    fileName: (f) => fileNameFor(f),
    go: (f, v) => ({ docx: exportDocx, png: exportPng, csv: exportCsv })[f](v),
  };
  $("wExportMenu").addEventListener("click", (e) => {
    const b = e.target.closest("[data-wexp]"); if (!b || !st.rec) return;
    $("wExportMenu").classList.remove("open");
    if (ctx.openExport) ctx.openExport(Object.assign({}, WAVE_EXPORT, { format: b.dataset.wexp }));
    else ({ docx: exportDocx, png: exportPng, csv: exportCsv })[b.dataset.wexp]();
  });
  $("wExportBtn").addEventListener("click", (e) => { e.stopPropagation(); const o = $("wExportMenu").classList.toggle("open"); $("wExportBtn").setAttribute("aria-expanded", String(o)); });
  document.addEventListener("click", (e) => { if (!e.target.closest("#wExportWrap")) $("wExportMenu").classList.remove("open"); });

  setAdv(st.adv);
  return {
    show(id) { refresh(id || (st.idx < 0 ? ctx.store.get("w.last", null) : null)); if (st.rec) { redraw(); renderCursorPanels(); } },
    refresh() {
      if (st.idx < 0) return;
      const before = new Set(st.list.filter((x) => x.group === "file").map((x) => x.id));
      const cur = st.list[st.idx];
      st.list = buildList();
      const fresh = st.list.find((x) => x.group === "file" && !before.has(x.id));
      let id = cur.id;
      if (fresh && (cur.group === "ref" || !$("pageWave").hidden)) id = fresh.id;     // jump to newly opened records
      if (!st.list.some((x) => x.id === id)) id = (st.list[0] || {}).id;
      st.recKey = "";             // files changed (maybe new settings): analyze again
      refresh(id);
    },
    theme() { if (st.rec && !$("pageWave").hidden) { renderStatic(); redraw(); renderCursorPanels(); } },
    summaryFigure, state: st, exportDocx, exportPng, exportCsv,
  };
}

const api = { create, fundamental, layout, eventMarks, PHASE };
root.SELWaveUI = api;
})(typeof window !== "undefined" ? window : globalThis);
