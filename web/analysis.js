/* SEL Trip Event Analyzer - waveform analysis.
 *
 * Turns SEL CEV event reports and COMTRADE records into a common "record"
 * (sampled analog channels + relay element channels), and computes what the
 * Waveform analysis page shows: fundamental phasors, sequence components,
 * harmonic spectrum, fault classification, 50/51 overcurrent evaluation
 * against the relay's settings, and plain-English names for relay elements.
 *
 * Works in browsers (window.SELAnalysis) and Node (module.exports). No dependencies
 * besides core.js.
 */
(function (root) {
"use strict";
const core = typeof module !== "undefined" && module.exports ? require("./core.js") : root.SELCore;

// ---------------------------------------------------------------------------
// Complex numbers (phasors)
// ---------------------------------------------------------------------------
const C = (re, im) => ({ re, im });
const cadd = (a, b) => C(a.re + b.re, a.im + b.im);
const cmul = (a, b) => C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cscale = (a, k) => C(a.re * k, a.im * k);
const cabs = (a) => Math.hypot(a.re, a.im);
const cang = (a) => (Math.atan2(a.im, a.re) * 180) / Math.PI;
const polar = (mag, deg) => C(mag * Math.cos((deg * Math.PI) / 180), mag * Math.sin((deg * Math.PI) / 180));
const A1 = polar(1, 120), A2 = polar(1, 240);
const ZERO = C(0, 0);
/** Wrap an angle to (-180, 180]. */
const wrap = (d) => { let x = ((d + 180) % 360 + 360) % 360 - 180; return x === -180 ? 180 : x; };

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------
function channelInfo(name) {
  const n = name.toUpperCase().replace(/\(.*\)/, "").trim();
  let kind = "other", phase = "";
  let m = /^I([ABC])(\b|W\d|_|$)/.exec(n);
  if (m) { kind = "I"; phase = m[1]; }
  else if (/^(IG|IN|3I0|IR|I0)\b/.test(n)) { kind = "I"; phase = "N"; }
  else if ((m = /^V([ABC])(\b|_|$)/.exec(n)) && !/^V(AB|BC|CA)/.test(n)) { kind = "V"; phase = m[1]; }
  else if (/^V(AB|BC|CA|S|P)/.test(n)) { kind = "V"; phase = ""; }
  else if (/^I/.test(n)) kind = "I";
  else if (/^V/.test(n)) kind = "V";
  return { kind, phase };
}

function unitOf(name, kind) {
  const m = /\(([^)]+)\)/.exec(name);
  if (m) return m[1];
  return kind === "I" ? "A" : kind === "V" ? "kV" : "";
}

/** Build a record from a parsed CEV event (core.parseCev result with .wave). */
function recordFromEvent(e) {
  const w = e.wave;
  if (!w) return null;
  const freq = core.fnumSafe ? 60 : 60;
  const f = parseFloat(e.freq) > 40 ? (Math.abs(parseFloat(e.freq) - 50) < 5 ? 50 : 60) : 60;
  const n = w.channels[0].values.length;
  const spc = w.sam;
  const t0 = w.trigger !== null ? w.trigger : 0;
  const t = new Float64Array(n);
  for (let k = 0; k < n; k++) t[k] = (k - t0) / (spc * f);
  return {
    id: "cev:" + e.source + ":" + e.date + e.time, kind: "cev", source: e.source,
    title: `${e.relay_id || e.source} - ${e.event_type || "event"}`, relay: e.relay_id, station: e.terminal_id,
    date: e.date, time: e.time, freq: f, spc, sps: spc * f, n, t, trigger: t0,
    analogs: w.channels.map((ch) => {
      const info = channelInfo(ch.name);
      return { name: ch.name.replace(/\(.*\)/, ""), phase: info.phase, kind: info.kind, unit: unitOf(ch.name, info.kind),
               values: Float64Array.from(ch.values), primary: true };
    }),
    digitals: (w.digitals || []).map((d) => ({ name: d.name, values: d.values })),
    settings: Object.assign({}, e.settings), event: e,
  };
}

// ---------------------------------------------------------------------------
// COMTRADE (IEEE C37.111 1991 / 1999 / 2013): .cfg + .dat, or .cff
// ---------------------------------------------------------------------------
function parseComtradeDate(d, t) {
  // 1999+: dd/mm/yyyy ; 1991: mm/dd/yy
  const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(core.strip(d || ""));
  const tm = /^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(core.strip(t || ""));
  if (!dm) return { date: d || "", time: t || "", ms: null };
  let day = +dm[1], mon = +dm[2], yr = +dm[3];
  if (dm[3].length === 2) { yr += yr < 70 ? 2000 : 1900; const x = day; day = mon; mon = x; }
  const date = `${String(mon).padStart(2, "0")}/${String(day).padStart(2, "0")}/${yr}`;
  let ms = null, time = core.strip(t || "");
  if (tm) {
    const sec = parseFloat(tm[3]);
    ms = Date.UTC(yr, mon - 1, day, +tm[1], +tm[2], 0) + sec * 1000;
    time = `${tm[1].padStart(2, "0")}:${tm[2]}:${sec.toFixed(3).padStart(6, "0")}`;
  }
  return { date, time, ms };
}

function parseCfg(text) {
  const lines = core.splitlines(text).map((l) => l.replace(/\s+$/, ""));
  let i = 0;
  const next = () => (i < lines.length ? lines[i++] : "");
  const f = (l) => core.csvLine(l).map((x) => core.strip(x));
  const head = f(next());
  const station = head[0] || "", device = head[1] || "", rev = parseInt(head[2], 10) || 1991;
  const counts = f(next());
  const nA = parseInt((counts[1] || "0").replace(/A/i, ""), 10) || 0;
  const nD = parseInt((counts[2] || "0").replace(/D/i, ""), 10) || 0;
  const analogs = [], digitals = [];
  for (let k = 0; k < nA; k++) {
    const p = f(next());
    analogs.push({ name: p[1] || `A${k + 1}`, ph: p[2] || "", ccbm: p[3] || "", unit: p[4] || "",
                   a: parseFloat(p[5]) || 1, b: parseFloat(p[6]) || 0, skew: parseFloat(p[7]) || 0,
                   primary: parseFloat(p[10]) || 1, secondary: parseFloat(p[11]) || 1, ps: (p[12] || "P").toUpperCase() });
  }
  for (let k = 0; k < nD; k++) {
    const p = f(next());
    digitals.push(rev >= 1999 ? { name: p[1] || `D${k + 1}`, normal: parseInt(p[4], 10) || 0 }
                              : { name: p[1] || `D${k + 1}`, normal: parseInt(p[2], 10) || 0 });
  }
  const lf = parseFloat(next()) || 60;
  const nrates = parseInt(next(), 10) || 0;
  const rates = [];
  for (let k = 0; k < Math.max(1, nrates); k++) { const p = f(next()); rates.push({ samp: parseFloat(p[0]) || 0, end: parseInt(p[1], 10) || 0 }); }
  const st = f(next()), tr = f(next());
  const ft = (next() || "ASCII").toUpperCase().trim();
  const timemult = parseFloat(next()) || 1;
  return { station, device, rev, analogs, digitals, lf, rates, start: parseComtradeDate(st[0], st[1]),
           trig: parseComtradeDate(tr[0], tr[1]), ft, timemult };
}

function parseDat(cfg, bytes, asText) {
  const nA = cfg.analogs.length, nD = cfg.digitals.length;
  const total = cfg.rates.length ? cfg.rates[cfg.rates.length - 1].end : 0;
  const rows = [];
  if (cfg.ft === "ASCII" || asText !== undefined) {
    const text = asText !== undefined ? asText : core.latin1(bytes);
    for (const line of core.splitlines(text)) {
      if (!line.trim()) continue;
      const p = line.split(",");
      if (p.length < 2 + nA) continue;
      rows.push({ ts: parseFloat(p[1]), a: p.slice(2, 2 + nA).map((x) => parseFloat(x)), d: p.slice(2 + nA, 2 + nA + nD).map((x) => parseInt(x, 10) || 0) });
    }
  } else {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const aw = cfg.ft === "BINARY" ? 2 : 4, dWords = Math.ceil(nD / 16);
    const size = 8 + nA * aw + dWords * 2;
    const n = Math.floor(bytes.length / size);
    for (let k = 0; k < n; k++) {
      const o = k * size, a = [], d = [];
      const ts = dv.getUint32(o + 4, true);
      for (let j = 0; j < nA; j++) {
        const q = o + 8 + j * aw;
        a.push(cfg.ft === "BINARY" ? dv.getInt16(q, true) : cfg.ft === "FLOAT32" ? dv.getFloat32(q, true) : dv.getInt32(q, true));
      }
      for (let j = 0; j < nD; j++) d.push((dv.getUint16(o + 8 + nA * aw + Math.floor(j / 16) * 2, true) >> (j % 16)) & 1);
      rows.push({ ts, a, d });
    }
  }
  return total && rows.length > total ? rows.slice(0, total) : rows;
}

/** Parse COMTRADE. files: {cfg: text, dat: Uint8Array} or {cff: text}. */
function parseComtrade(files, name) {
  let cfgText = files.cfg, datBytes = files.dat, datText;
  if (files.cff) {
    const parts = files.cff.split(/^---\s*file type:\s*/im);
    for (const part of parts) {
      const head = part.split("\n")[0];
      const body = part.slice(head.length + 1);
      if (/^CFG/i.test(head)) cfgText = body;
      else if (/^DAT\s+ASCII/i.test(head)) datText = body;
    }
  }
  const cfg = parseCfg(cfgText);
  const rows = parseDat(cfg, datBytes, datText);
  const n = rows.length;
  const samp = cfg.rates.length && cfg.rates[0].samp ? cfg.rates[0].samp : null;
  const t = new Float64Array(n);
  for (let k = 0; k < n; k++) t[k] = samp ? k / samp : (rows[k].ts * cfg.timemult) / 1e6;
  // trigger index from the trigger time
  let trigger = 0;
  if (cfg.start.ms !== null && cfg.trig.ms !== null) {
    const dt = (cfg.trig.ms - cfg.start.ms) / 1000;
    trigger = Math.max(0, Math.min(n - 1, Math.round(samp ? dt * samp : t.findIndex((x) => x >= dt))));
  }
  const t0 = t[trigger] || 0;
  for (let k = 0; k < n; k++) t[k] -= t0;
  const sps = samp || (n > 1 ? 1 / (t[1] - t[0]) : 1);
  const analogs = cfg.analogs.map((ch, j) => {
    const info = channelInfo(ch.name);
    const phase = /^[ABC]$/i.test(ch.ph) ? ch.ph.toUpperCase() : /^N$/i.test(ch.ph) ? "N" : info.phase;
    const kind = /^(k?V)$/i.test(ch.unit) ? "V" : /^(k?A)$/i.test(ch.unit) ? "I" : info.kind;
    const toPrimary = ch.ps === "S" ? ch.primary / ch.secondary : 1;
    const values = new Float64Array(n);
    for (let k = 0; k < n; k++) values[k] = (ch.a * rows[k].a[j] + ch.b) * toPrimary;
    let unit = ch.unit || (kind === "V" ? "V" : "A");
    if (kind === "V" && /^V$/i.test(unit)) { for (let k = 0; k < n; k++) values[k] /= 1000; unit = "kV"; }
    if (kind === "I" && /^kA$/i.test(unit)) { for (let k = 0; k < n; k++) values[k] *= 1000; unit = "A"; }
    return { name: ch.name, phase, kind, unit, values, ratio: ch.primary / (ch.secondary || 1), primary: true };
  });
  const digitals = cfg.digitals.map((ch, j) => {
    const values = new Uint8Array(n);
    for (let k = 0; k < n; k++) values[k] = rows[k].d[j] ? 1 : 0;
    return { name: ch.name, values };
  });
  return {
    id: "comtrade:" + name, kind: "comtrade", source: name, title: `${cfg.device || name} - COMTRADE`,
    relay: cfg.device, station: cfg.station, date: cfg.trig.date || cfg.start.date, time: cfg.trig.time || cfg.start.time,
    freq: cfg.lf, sps, spc: Math.round(sps / cfg.lf), n, t, trigger, analogs, digitals, settings: {}, revision: cfg.rev,
    format: cfg.ft,
  };
}

/** Group uploaded files into COMTRADE records: [{name, bytes}] -> records (+ errors). */
function comtradeRecords(files) {
  const byBase = new Map();
  for (const f of files) {
    const ext = core.extOf(f.name), base = f.name.slice(0, f.name.length - ext.length);
    const key = base.toLowerCase();
    if (!byBase.has(key)) byBase.set(key, { base });
    byBase.get(key)[ext.slice(1)] = f;
  }
  const records = [], errors = [];
  for (const g of byBase.values()) {
    try {
      if (g.cff) records.push(parseComtrade({ cff: core.readText(g.cff.bytes) }, g.cff.name));
      else if (g.cfg && g.dat) records.push(parseComtrade({ cfg: core.readText(g.cfg.bytes), dat: g.dat.bytes }, g.base + ".cfg"));
      else errors.push(`${g.base}: COMTRADE needs both the .cfg and the .dat file`);
    } catch (e) {
      errors.push(`${g.base}: couldn't read COMTRADE (${e.message || e})`);
    }
  }
  return { records, errors };
}

// ---------------------------------------------------------------------------
// Signal processing
// ---------------------------------------------------------------------------
/** Fundamental phasor (rms magnitude, angle in degrees) of the one-cycle window ending at idx. */
function phasorAt(values, idx, spc) {
  const N = spc, end = Math.max(N - 1, Math.min(values.length - 1, idx));
  let re = 0, im = 0;
  for (let k = end - N + 1; k <= end; k++) {
    const th = (2 * Math.PI * k) / N;
    re += values[k] * Math.cos(th);
    im -= values[k] * Math.sin(th);
  }
  const s = Math.SQRT2 / N;
  return C(re * s, im * s);  // rms phasor
}

/** Harmonic spectrum of the window [start, start + cycles*spc). */
function harmonics(values, start, spc, cycles, maxH) {
  cycles = Math.max(1, cycles || 1);
  const N = spc * cycles;
  start = Math.max(0, Math.min(values.length - N, start));
  if (start < 0) return null;
  maxH = Math.min(maxH || 15, Math.floor(spc / 2) - 1);
  let dc = 0;
  for (let k = 0; k < N; k++) dc += values[start + k];
  dc /= N;
  const out = [];
  for (let h = 1; h <= maxH; h++) {
    let re = 0, im = 0;
    for (let k = 0; k < N; k++) {
      const th = (2 * Math.PI * h * k) / spc;
      re += values[start + k] * Math.cos(th);
      im -= values[start + k] * Math.sin(th);
    }
    out.push({ h, rms: (Math.SQRT2 / N) * Math.hypot(re, im) });
  }
  const f1 = out[0].rms || 1e-12;
  let sq = 0;
  for (const x of out) { x.pct = (100 * x.rms) / f1; if (x.h > 1) sq += x.rms * x.rms; }
  return { dc, dcPct: (100 * Math.abs(dc)) / (f1 * Math.SQRT2), thd: (100 * Math.sqrt(sq)) / f1, list: out, start, N };
}

/** True one-cycle RMS ending at each sample. */
function rmsTrend(values, spc) {
  const out = new Float64Array(values.length);
  let acc = 0;
  for (let k = 0; k < values.length; k++) {
    acc += values[k] * values[k];
    if (k >= spc) acc -= values[k - spc] * values[k - spc];
    out[k] = Math.sqrt(Math.max(0, acc) / Math.min(k + 1, spc));
  }
  return out;
}

function sequence(a, b, c) {
  return {
    zero: cscale(cadd(cadd(a, b), c), 1 / 3),
    pos: cscale(cadd(cadd(a, cmul(A1, b)), cmul(A2, c)), 1 / 3),
    neg: cscale(cadd(cadd(a, cmul(A2, b)), cmul(A1, c)), 1 / 3),
  };
}

function channels(rec) {
  const pick = (kind, ph) => rec.analogs.find((ch) => ch.kind === kind && ch.phase === ph) || null;
  return { IA: pick("I", "A"), IB: pick("I", "B"), IC: pick("I", "C"), IN: pick("I", "N"),
           VA: pick("V", "A"), VB: pick("V", "B"), VC: pick("V", "C") };
}

/** Everything the page shows at one sample: phasors (angle referenced), sequence components. */
function snapshot(rec, idx, refName) {
  const ch = channels(rec);
  const ph = {};
  for (const a of rec.analogs) ph[a.name] = phasorAt(a.values, idx, rec.spc);
  const ref = (refName && ph[refName]) || (ch.VA && ph[ch.VA.name]) || (ch.IA && ph[ch.IA.name]) || null;
  const rot = ref && cabs(ref) > 1e-9 ? -cang(ref) : 0;
  const rotated = {};
  for (const [k, v] of Object.entries(ph)) rotated[k] = polar(cabs(v), wrap(cang(v) + rot));
  const seq = {};
  if (ch.IA && ch.IB && ch.IC) {
    const s = sequence(rotated[ch.IA.name], rotated[ch.IB.name], rotated[ch.IC.name]);
    seq.I = { zero: s.zero, pos: s.pos, neg: s.neg, residual: cscale(s.zero, 3) };
  }
  if (ch.VA && ch.VB && ch.VC) {
    const s = sequence(rotated[ch.VA.name], rotated[ch.VB.name], rotated[ch.VC.name]);
    seq.V = { zero: s.zero, pos: s.pos, neg: s.neg };
  }
  return { idx, t: rec.t[idx], phasors: rotated, seq, ref: ref ? (refName && ph[refName] ? refName : (ch.VA ? ch.VA.name : ch.IA.name)) : null };
}

// ---------------------------------------------------------------------------
// Fault classification
// ---------------------------------------------------------------------------
const FAULT_NAMES = {
  AG: "Single phase-to-ground fault (phase A)", BG: "Single phase-to-ground fault (phase B)", CG: "Single phase-to-ground fault (phase C)",
  AB: "Phase-to-phase fault (A-B)", BC: "Phase-to-phase fault (B-C)", CA: "Phase-to-phase fault (C-A)",
  ABG: "Two phases to ground (A-B-G)", BCG: "Two phases to ground (B-C-G)", CAG: "Two phases to ground (C-A-G)",
  ABC: "Three-phase fault", NONE: "No fault", INRUSH: "Transformer inrush (not a fault)",
};

function mag(rec, ch, idx) { return ch ? cabs(phasorAt(ch.values, idx, rec.spc)) : 0; }

function classifyAt(rec, idx, pre) {
  const ch = channels(rec);
  const phases = ["A", "B", "C"].filter((p) => ch["I" + p]);
  const I = {}, Ipre = {};
  for (const p of phases) { I[p] = mag(rec, ch["I" + p], idx); Ipre[p] = mag(rec, ch["I" + p], pre); }
  const maxI = Math.max(...phases.map((p) => I[p]), 1e-9);
  let i0 = 0, i0pre = 0;
  if (ch.IA && ch.IB && ch.IC) {
    const s = sequence(phasorAt(ch.IA.values, idx, rec.spc), phasorAt(ch.IB.values, idx, rec.spc), phasorAt(ch.IC.values, idx, rec.spc));
    i0 = 3 * cabs(s.zero);
    const sp = sequence(phasorAt(ch.IA.values, pre, rec.spc), phasorAt(ch.IB.values, pre, rec.spc), phasorAt(ch.IC.values, pre, rec.spc));
    i0pre = 3 * cabs(sp.zero);
  } else if (ch.IN) { i0 = mag(rec, ch.IN, idx); i0pre = mag(rec, ch.IN, pre); }
  const faulted = phases.filter((p) => I[p] >= 0.5 * maxI && I[p] >= 1.4 * Math.max(Ipre[p], 1e-9) && I[p] - Ipre[p] > 0.05 * maxI);
  const ground = i0 > 0.15 * maxI && i0 > 2 * Math.max(i0pre, 1e-9);
  const V = {}, Vpre = {};
  for (const p of ["A", "B", "C"]) if (ch["V" + p]) { V[p] = mag(rec, ch["V" + p], idx); Vpre[p] = mag(rec, ch["V" + p], pre); }
  return { I, Ipre, i0, i0pre, faulted, ground, V, Vpre, maxI };
}

function codeOf(faulted, ground) {
  if (!faulted.length) return "NONE";
  if (faulted.length === 3) return "ABC";
  let s = faulted.join("");
  if (s === "AC") s = "CA";
  return s + (ground ? "G" : "") === "ABCG" ? "ABC" : s + (ground || faulted.length === 1 ? "G" : "");
}

/** Find the fault and classify it. Returns code, plain-English name, evidence and notes. */
function classify(rec) {
  const spc = rec.spc, n = rec.n;
  const ch = channels(rec);
  const phases = ["A", "B", "C"].filter((p) => ch["I" + p]);
  if (!phases.length) return { code: "NONE", name: "No phase currents in this record", evidence: [], notes: [], faultIdx: null, preIdx: null };
  // prefault: the cycle ending just before the trigger (or the first cycle)
  const preIdx = Math.max(spc - 1, Math.min(n - 1, (rec.trigger || spc) - Math.round(spc / 4)));
  // fault point: where the summed fundamental current is largest (after the prefault cycle)
  const step = Math.max(1, Math.round(spc / 8));
  let best = preIdx, bestSum = -1;
  const sumAt = (k) => phases.reduce((t, p) => t + mag(rec, ch["I" + p], k), 0);
  for (let k = preIdx + spc; k < n; k += step) { const sm = sumAt(k); if (sm > bestSum) { bestSum = sm; best = k; } }
  const faultIdx = best;
  const at = classifyAt(rec, faultIdx, preIdx);
  const evidence = [], notes = [];
  const fmtA = (x) => `${Math.round(x).toLocaleString("en-US")} A`;
  let code = codeOf(at.faulted, at.ground);

  // inrush: strong 2nd harmonic in the current, voltages hold up
  const h = ch.IA ? harmonics((ch[`I${phases[0]}`]).values, Math.max(0, faultIdx - spc + 1), spc, 1, 7) : null;
  const h2 = phases.map((p) => { const hh = harmonics(ch["I" + p].values, Math.max(0, faultIdx - spc + 1), spc, 1, 5); return hh ? hh.list[1].pct : 0; });
  const maxH2 = Math.max(...h2);
  const vSag = Object.keys(at.V).filter((p) => at.Vpre[p] > 0 && at.V[p] < 0.85 * at.Vpre[p]);
  if (code !== "NONE" && maxH2 > 15 && !vSag.length) {
    code = "INRUSH";
    evidence.push(`Second harmonic is ${maxH2.toFixed(0)}% of the fundamental (above ~15% is typical of transformer inrush) and the voltages didn't sag.`);
  }

  // high-impedance ground: residual current rises but phases barely change and voltages hold
  const maxRise = Math.max(...phases.map((p) => at.I[p] / Math.max(at.Ipre[p], 1e-9)));
  let hiz = false;
  if (code === "NONE" && at.i0 > 3 * Math.max(at.i0pre, 1) && at.i0 > 10 && !vSag.length) {
    hiz = true;
    const ph = phases.reduce((a, p) => (at.I[p] - at.Ipre[p] > at.I[a] - at.Ipre[a] ? p : a), phases[0]);
    code = ph + "G";
    notes.push("Possible high-impedance ground fault: ground current rose to " + fmtA(at.i0) +
               " but phase currents barely changed and voltages held up. These faults (e.g. a conductor on dry ground) often don't trip overcurrent elements.");
  }

  if (code !== "NONE" && code !== "INRUSH" && !hiz) {
    for (const p of phases) {
      if (at.faulted.includes(p)) evidence.push(`Phase ${p} current rose from ${fmtA(at.Ipre[p])} to ${fmtA(at.I[p])} (${(at.I[p] / Math.max(at.Ipre[p], 1e-9)).toFixed(1)}x).`);
    }
    const unf = phases.filter((p) => !at.faulted.includes(p));
    if (unf.length) evidence.push(`Phase${unf.length > 1 ? "s" : ""} ${unf.join(", ")} stayed near load current.`);
    if (at.ground) evidence.push(`Ground (residual 3I0) current of ${fmtA(at.i0)} flowed, so the fault involves ground.`);
    else if (at.faulted.length >= 2) evidence.push(`Little ground current (${fmtA(at.i0)}), so the fault doesn't involve ground.`);
    if (vSag.length) evidence.push(`Voltage sagged on phase${vSag.length > 1 ? "s" : ""} ${vSag.join(", ")} (` +
      vSag.map((p) => `${p}: ${(100 * at.V[p] / at.Vpre[p]).toFixed(0)}%`).join(", ") + " of prefault).");
  } else if (code === "NONE") {
    evidence.push(`Largest phase current change was ${maxRise.toFixed(2)}x prefault, which isn't a fault.`);
  }

  // evolving fault: classification early in the fault differs from the peak
  if (code !== "NONE" && code !== "INRUSH" && !hiz) {
    const early = Math.min(n - 1, (rec.trigger || preIdx) + Math.round(spc * 1.25));
    if (early < faultIdx - spc) {
      const e = codeOf(classifyAt(rec, early, preIdx).faulted, classifyAt(rec, early, preIdx).ground);
      if (e !== "NONE" && e !== code) notes.push(`Evolving fault: it started as ${e} and became ${code}.`);
    }
  }

  // DC offset and distortion over the first cycles of the fault
  if (code !== "NONE" && code !== "INRUSH") {
    const p = at.faulted[0] || phases[0];
    const start = Math.min(n - spc, Math.max(0, (rec.trigger || preIdx) + 1));
    const first = harmonics(ch["I" + p].values, start, spc, 1, Math.min(15, spc / 2 - 1));
    if (first && first.dcPct > 30)
      notes.push(`Strong DC offset at inception (${first.dcPct.toFixed(0)}% on phase ${p}); it decays over a few cycles. Normal for faults that start near a voltage zero.`);
    // CT saturation: during a heavy fault the secondary current collapses toward zero for a large
    // part of each cycle (a sine, even with DC offset, spends little time near zero)
    const vals = ch["I" + p].values, prePeak = Math.SQRT2 * Math.max(at.Ipre[p], 1);
    // only look at cycles before the breaker opens (current back near load)
    const rms = rmsTrend(vals, spc);
    let faultEnd = n;
    for (let k = start + spc; k < n; k++) if (rms[k] < 3 * Math.max(at.Ipre[p], 1)) { faultEnd = k - spc; break; }
    let worst = 0;
    for (let c = 0; c < 4; c++) {
      const st = start + c * spc;
      if (st + spc > Math.min(n, faultEnd)) break;
      let peak = 0;
      for (let k = st; k < st + spc; k++) peak = Math.max(peak, Math.abs(vals[k]));
      if (peak < 4 * prePeak) continue;
      let low = 0;
      for (let k = st; k < st + spc; k++) if (Math.abs(vals[k]) < 0.12 * peak) low++;
      worst = Math.max(worst, low / spc);
    }
    if (worst > 0.35)
      notes.push(`Phase ${p} current collapses toward zero for ${Math.round(worst * 100)}% of a cycle early in the fault: likely CT saturation. Distance and differential elements can be slowed or misled.`);
  }
  if (code === "INRUSH") notes.push("Relays block or restrain on the 2nd harmonic during inrush so they don't trip when a transformer is energized.");
  const name = FAULT_NAMES[code] || code;
  return { code, name, evidence, notes, faultIdx, preIdx, at, maxH2 };
}

// ---------------------------------------------------------------------------
// Overcurrent evaluation (50 / 51) against the relay's settings
// ---------------------------------------------------------------------------
// SEL time-overcurrent curves: t = TD * (A + B / (M^p - 1)) seconds
const CURVES = {
  U1: { name: "U.S. Moderately Inverse", A: 0.0226, B: 0.0104, p: 0.02 },
  U2: { name: "U.S. Inverse", A: 0.180, B: 5.95, p: 2 },
  U3: { name: "U.S. Very Inverse", A: 0.0963, B: 3.88, p: 2 },
  U4: { name: "U.S. Extremely Inverse", A: 0.02434, B: 5.64, p: 2 },
  U5: { name: "U.S. Short-Time Inverse", A: 0.00262, B: 0.00342, p: 0.02 },
  C1: { name: "IEC Standard Inverse", A: 0, B: 0.14, p: 0.02 },
  C2: { name: "IEC Very Inverse", A: 0, B: 13.5, p: 1 },
  C3: { name: "IEC Extremely Inverse", A: 0, B: 80, p: 2 },
  C4: { name: "IEC Long-Time Inverse", A: 0, B: 120, p: 1 },
  C5: { name: "IEC Short-Time Inverse", A: 0, B: 0.05, p: 0.04 },
};
function curveTime(curve, td, M) {
  const c = CURVES[(curve || "").toUpperCase()];
  if (!c || !(M > 1)) return null;
  return td * (c.A + c.B / (Math.pow(M, c.p) - 1));
}
const QTY = {
  P: "highest phase current", G: "ground current (residual 3I0)", N: "neutral current", Q: "negative-sequence current (3I2)",
};

/** Measured fundamental quantities (primary amps) over the fault, for each overcurrent type. */
function measured(rec, cls) {
  const ch = channels(rec), spc = rec.spc;
  const from = cls && cls.faultIdx !== null ? Math.max(spc - 1, (rec.trigger || 0)) : spc - 1;
  const out = { P: 0, G: 0, N: 0, Q: 0 };
  for (let k = from; k < rec.n; k += Math.max(1, Math.round(spc / 8))) {
    for (const p of ["A", "B", "C"]) if (ch["I" + p]) out.P = Math.max(out.P, cabs(phasorAt(ch["I" + p].values, k, spc)));
    if (ch.IA && ch.IB && ch.IC) {
      const s = sequence(phasorAt(ch.IA.values, k, spc), phasorAt(ch.IB.values, k, spc), phasorAt(ch.IC.values, k, spc));
      out.G = Math.max(out.G, 3 * cabs(s.zero));
      out.Q = Math.max(out.Q, 3 * cabs(s.neg));
    }
    if (ch.IN) out.N = Math.max(out.N, cabs(phasorAt(ch.IN.values, k, spc)));
  }
  if (!ch.IA && ch.IN) out.G = out.N;
  return out;
}

/** When a relay element first turned on after the trigger (seconds, relative to trigger), or null. */
function firstOn(rec, name, after) {
  const d = rec.digitals.find((x) => x.name.toUpperCase() === name.toUpperCase());
  if (!d) return null;
  for (let k = Math.max(1, after || 0); k < rec.n; k++) if (d.values[k] && !d.values[k - 1]) return rec.t[k];
  return null;
}

function evaluateOvercurrent(rec, settings, cls) {
  settings = settings || {};
  const ctr = parseFloat(settings.CTR) || null;
  const meas = measured(rec, cls);
  const rows = [];
  const keys = Object.keys(settings);
  const inception = rec.t[Math.max(0, rec.trigger || 0)];
  // 50 elements (instantaneous / definite time)
  for (const k of keys) {
    const m = /^50([PGNQ])(\d)P$/.exec(k);
    if (!m) continue;
    const pickup = parseFloat(settings[k]);
    if (!(pickup > 0)) continue;
    const prim = meas[m[1]];
    const sec = ctr ? prim / ctr : null;
    const M = sec !== null ? sec / pickup : null;
    const el = `50${m[1]}${m[2]}`;
    const on = firstOn(rec, el, rec.trigger);
    rows.push({
      element: el, kind: "50", qty: QTY[m[1]], pickup, measuredPrimary: prim, measuredSecondary: sec, M,
      verdict: M === null ? "CTR unknown" : M >= 1 ? "Would pick up" : "Below pickup",
      expected: M !== null && M >= 1 ? "Instantaneous" : "",
      actual: on !== null ? `${((on - inception) * rec.freq).toFixed(2)} cyc after inception` : (rec.digitals.some((d) => d.name === el) ? "Didn't assert" : "Not in record"),
      agrees: on === null ? (M !== null && M < 1) || !rec.digitals.some((d) => d.name === el) : M !== null && M >= 1,
    });
  }
  // 51 elements (time-overcurrent)
  for (const k of keys) {
    const m = /^51([PGNQ])P$/.exec(k);
    if (!m) continue;
    const pickup = parseFloat(settings[k]);
    if (!(pickup > 0)) continue;
    const t = m[1], curve = settings[`51${t}C`], td = parseFloat(settings[`51${t}TD`]);
    const prim = meas[t], sec = ctr ? prim / ctr : null, M = sec !== null ? sec / pickup : null;
    const tsec = M !== null && curve && td > 0 ? curveTime(curve, td, M) : null;
    const el = `51${t}`, elT = `51${t}T`;
    const pu = firstOn(rec, el, rec.trigger), op = firstOn(rec, elT, rec.trigger);
    const startT = pu !== null ? pu : inception;
    const actual = op !== null ? (op - startT) : null;
    let agrees = null, note = "";
    if (tsec !== null && actual !== null) {
      const err = Math.abs(actual - tsec) / tsec;
      agrees = err <= 0.1;
      note = agrees ? `Within ${Math.max(1, Math.round(err * 100))}% of the curve` : `${Math.round(err * 100)}% ${actual > tsec ? "slower" : "faster"} than the curve`;
    } else if (tsec !== null && op === null) {
      const trip = firstOn(rec, "TRIP", rec.trigger);
      const recEnd = rec.t[rec.n - 1] - startT;
      if (trip !== null && trip - startT < tsec)
        note = `Another element tripped first (TRIP at ${((trip - inception) * rec.freq).toFixed(1)} cyc), so ${el} never needed to time out`;
      else note = recEnd < tsec ? "The record ends before the curve time" : "Didn't time out (check the setting or the record)";
    }
    rows.push({
      element: el, kind: "51", qty: QTY[t], pickup, curve: curve || "", curveName: CURVES[(curve || "").toUpperCase()] ? CURVES[curve.toUpperCase()].name : (curve ? "unknown curve" : ""),
      td: td || null, measuredPrimary: prim, measuredSecondary: sec, M,
      verdict: M === null ? "CTR unknown" : M > 1 ? "Would pick up and time out" : "Below pickup",
      expectedSec: tsec, expected: tsec !== null ? `${(tsec * rec.freq).toFixed(1)} cyc (${tsec.toFixed(3)} s)` : "",
      actualSec: actual, actual: actual !== null ? `${(actual * rec.freq).toFixed(1)} cyc (${actual.toFixed(3)} s)` : (rec.digitals.some((d) => d.name === elT) ? "Didn't time out" : "Not in record"),
      agrees, note,
    });
  }
  return { ctr, rows, measured: meas };
}

// ---------------------------------------------------------------------------
// Relay elements in plain English
// ---------------------------------------------------------------------------
const ZONE = (n) => `Zone ${n}`;
const ELEMENT_WORDS = [
  [/^Z(\d)G$/, (m) => `${ZONE(m[1])} ground distance (quadrilateral/mho) picked up`],
  [/^Z(\d)GT$/, (m) => `${ZONE(m[1])} ground distance timer expired (trip)`],
  [/^Z(\d)P$/, (m) => `${ZONE(m[1])} phase distance picked up`],
  [/^Z(\d)PT$/, (m) => `${ZONE(m[1])} phase distance timer expired (trip)`],
  [/^M(\d)P$/, (m) => `${ZONE(m[1])} phase distance (mho) picked up`],
  [/^M(\d)PT$/, (m) => `${ZONE(m[1])} phase distance timer expired (trip)`],
  [/^(M|X)(AB|BC|CA|AG|BG|CG)(\d)$/, (m) => `${ZONE(m[3])} distance, ${m[2]} loop`],
  [/^50P(\d)$/, (m) => `Phase instantaneous overcurrent, level ${m[1]}, picked up`],
  [/^50G(\d)$/, (m) => `Ground (residual) instantaneous overcurrent, level ${m[1]}, picked up`],
  [/^50N(\d)$/, (m) => `Neutral instantaneous overcurrent, level ${m[1]}, picked up`],
  [/^50Q(\d)$/, (m) => `Negative-sequence instantaneous overcurrent, level ${m[1]}, picked up`],
  [/^50(P|G|N|Q)(\d)T$/, (m) => `${{ P: "Phase", G: "Ground", N: "Neutral", Q: "Negative-sequence" }[m[1]]} definite-time overcurrent ${m[2]} timed out (trip)`],
  [/^51P$/, () => "Phase time-overcurrent picked up (timing)"],
  [/^51PT$/, () => "Phase time-overcurrent timed out (trip)"],
  [/^51G$/, () => "Ground time-overcurrent picked up (timing)"],
  [/^51GT$/, () => "Ground time-overcurrent timed out (trip)"],
  [/^51N$/, () => "Neutral time-overcurrent picked up (timing)"],
  [/^51NT$/, () => "Neutral time-overcurrent timed out (trip)"],
  [/^51Q$/, () => "Negative-sequence time-overcurrent picked up"],
  [/^51QT$/, () => "Negative-sequence time-overcurrent timed out (trip)"],
  [/^51(P|G|N|Q)R$/, () => "Time-overcurrent reset (dropped out)"],
  [/^67(P|G|N|Q)(\d)T?$/, (m) => `Directional ${{ P: "phase", G: "ground", N: "neutral", Q: "negative-sequence" }[m[1]]} overcurrent, level ${m[2]}`],
  [/^32(G|Q|P)F$/, (m) => `Forward-direction ${{ G: "ground", Q: "negative-sequence", P: "phase" }[m[1]]} directional decision`],
  [/^32(G|Q|P)R$/, (m) => `Reverse-direction ${{ G: "ground", Q: "negative-sequence", P: "phase" }[m[1]]} directional decision`],
  [/^F32(P|Q|G)$/, () => "Forward directional element"],
  [/^R32(P|Q|G)$/, () => "Reverse directional element"],
  [/^87/, () => "Differential element"],
  [/^TRIP\d?$/, () => "Trip logic asserted (the relay is tripping)"],
  [/^3PT$/, () => "Three-pole trip"],
  [/^TP([ABC])\d?$/, (m) => `Single-pole trip, phase ${m[1]}`],
  [/^OUT(\d)(\d+)$/, (m) => `Output contact ${m[1]}${m[2]} (often wired to the breaker trip coil)`],
  [/^IN(\d)(\d+)$/, (m) => `Contact input ${m[1]}${m[2]} (often breaker status or an external trip)`],
  [/^52A$/, () => "Breaker closed (52a status contact)"],
  [/^52B$/, () => "Breaker open (52b status contact)"],
  [/^52A(A|B|C)?(\d)$/, (m) => `Breaker ${m[2]} closed${m[1] ? ", phase " + m[1] : ""}`],
  [/^79RS$/, () => "Recloser reset: ready to reclose"],
  [/^79CY$/, () => "Recloser cycling: reclose in progress"],
  [/^79LO$/, () => "Recloser locked out: no more recloses"],
  [/^79/, () => "Reclosing logic"],
  [/^KEY$/, () => "Permissive trip sent to the other end (communications)"],
  [/^PTRX\d?$/, () => "Permissive trip received from the other end"],
  [/^DTT|^DTA|^DTB|^DTC/, () => "Direct transfer trip (from the other end)"],
  [/^Z2PGS$/, () => "Zone 2 used for the communications scheme"],
  [/^(DCB|POTT|DCUB)/, (m) => `${m[1]} communications scheme logic`],
  [/^RB(\d+)$/, (m) => `MIRRORED BITS received bit ${m[1]} (relay-to-relay communications)`],
  [/^TB(\d+)$/, (m) => `MIRRORED BITS transmitted bit ${m[1]}`],
  [/^SOTFT?$/, () => "Switch-onto-fault logic (closing onto a fault)"],
  [/^LOP$/, () => "Loss of potential (blown PT fuse / no voltage)"],
  [/^81D(\d)T$/, (m) => `Frequency element ${m[1]} timed out (under/over-frequency trip)`],
  [/^81D(\d)$/, (m) => `Frequency element ${m[1]} picked up`],
  [/^27(P|S|B)?(\d)/, () => "Undervoltage element"],
  [/^59(P|G|Q|N)?(\d)/, () => "Overvoltage element"],
  [/^50BF|^BFT|^FBF/, () => "Breaker failure logic"],
  [/^(PSV|SV)(\d+)T?$/, (m) => `SELogic variable ${m[2]} (custom logic)`],
  [/^(PLT|LT)(\d+)$/, (m) => `Latch ${m[2]} (custom logic)`],
  [/^ER$/, () => "Event report trigger"],
  [/^OST|^OSB/, () => "Out-of-step (power swing) logic"],
  [/^TRGTR$/, () => "Target reset"],
];
function translateElement(name) {
  const n = name.toUpperCase();
  for (const [re, fn] of ELEMENT_WORDS) { const m = re.exec(n); if (m) return fn(m); }
  const cls = core.elementClass(n);
  return cls ? cls.charAt(0).toUpperCase() + cls.slice(1) : "Relay word bit (see the relay manual)";
}
const GROUPS = [
  ["Trip & outputs", /^(TRIP|3PT|TP[ABC]|OUT|51.T$|50..T$|Z.(G|P)T$|M.PT$)/],
  ["Distance", /^(Z\d|M\d|MAB|MBC|MCA|MAG|MBG|MCG|XAG|XBG|XCG)/],
  ["Overcurrent", /^(50|51|67)/],
  ["Directional", /^(32|F32|R32)/],
  ["Communications", /^(KEY|PTRX|DTT|DTA|DTB|DTC|Z2PGS|DCB|POTT|DCUB|RB|TB|ROK)/],
  ["Breaker & inputs", /^(52|IN\d)/],
  ["Reclosing", /^79/],
  ["Voltage & frequency", /^(27|59|81|LOP)/],
  ["Custom logic", /^(SV|PSV|PLT|LT|PCT)/],
];
function elementGroup(name) {
  const n = name.toUpperCase();
  for (const [g, re] of GROUPS) if (re.test(n)) return g;
  return "Other";
}

/** Every relay element in the record with its on/off intervals (seconds from trigger). */
function elementTimeline(rec) {
  return rec.digitals.map((d) => {
    const iv = [];
    let on = d.values[0] ? 0 : -1;
    for (let k = 1; k < rec.n; k++) {
      if (d.values[k] && !d.values[k - 1]) on = k;
      if (!d.values[k] && d.values[k - 1] && on >= 0) { iv.push([on, k]); on = -1; }
    }
    if (on >= 0) iv.push([on, rec.n - 1]);
    const changed = d.values.some((v, k) => k > 0 && v !== d.values[k - 1]);
    return {
      name: d.name, meaning: translateElement(d.name), group: elementGroup(d.name), intervals: iv, changed,
      initial: d.values[0], firstOn: iv.length ? rec.t[iv[0][0]] : null, everOn: iv.length > 0,
    };
  });
}

/** Full analysis bundle for the page. */
function analyze(rec, settings) {
  const cls = classify(rec);
  const s = Object.assign({}, rec.settings || {}, settings || {});
  return { cls, oc: evaluateOvercurrent(rec, s, cls), elements: elementTimeline(rec), settings: s };
}

// ---------------------------------------------------------------------------
// COMTRADE records as events (any relay maker): fault type from the waveforms,
// trip, breaker and elements from the digital channels
// ---------------------------------------------------------------------------
const isTripCh = (name) => core.elementClass(name) === "TRIP";
const breakerSense = (name) => {          // +1: on while closed (52A); -1: on while open (52B)
  const n = name.toUpperCase();
  if (core.elementClass(name) !== "breaker status") return 0;
  if (/52\s*B|OPEN/.test(n)) return -1;
  return 1;
};

function eventFromRecord(r) {
  const e = core.newRec(r.source, "event");
  e.relay_id = core.strip(r.relay || r.station || "");
  e.terminal_id = core.strip(r.station || "") === e.relay_id ? "" : core.strip(r.station || "");
  e.date = r.date || ""; e.time = r.time || "";
  e.freq = String(r.freq || "");
  const spc = r.spc;
  // digital channels: first change after the start, in cycles from the start (like SEL element data)
  let trip = null, open = null, breaker = null;
  const seq = [];
  r.digitals.forEach((d, j) => {
    const v = d.values;
    let first = -1;
    for (let k = 1; k < r.n; k++) if (v[k] && !v[k - 1]) { first = k; break; }
    const sense = breakerSense(d.name);
    if (sense) {
      if (open === null) for (let k = 1; k < r.n; k++) {
        if ((sense > 0 && v[k - 1] && !v[k]) || (sense < 0 && !v[k - 1] && v[k])) { open = k; breaker = d.name; break; }
      }
      return;
    }
    if (v[0]) { if (core.elementClass(d.name) && !["breaker status", "SELogic variable"].includes(core.elementClass(d.name))) seq.push([0, d.name, "pre", j]); return; }
    if (first < 0) return;
    seq.push([first / spc, d.name, "asserted", j]);
    if (isTripCh(d.name) && (trip === null || first < trip)) trip = first;
  });
  seq.sort((a, b) => (a[2] === "pre") - (b[2] === "pre") || a[0] - b[0] || a[3] - b[3]);
  e.sequence = seq.map(([c, n, st]) => [c, n, st]);
  e.trip_cycle = trip !== null ? trip / spc : null;
  e.open_cycle = open !== null ? open / spc : null;
  e.trigger_cycle = (r.trigger || 0) / spc;
  // fault type from the currents
  const cls = classify(r);
  const isFault = cls.code !== "NONE" && cls.code !== "INRUSH" && core.FAULT_TYPES[cls.code];
  e.event_type = isFault ? cls.code + (trip !== null ? " T" : "") : trip !== null ? "TRIP" : "ER";
  // prefault and fault magnitudes (largest during the fault, up to the breaker opening)
  const ch = channels(r);
  const pre = cls.preIdx !== null ? cls.preIdx : Math.min(r.n - 1, spc);
  const end = Math.min(r.n - 1, open !== null ? open : (cls.faultIdx || r.trigger || 0) + 10 * spc);
  const from = Math.min(r.n - 1, Math.max(pre + spc, r.trigger || 0));
  const peak = (c, pick) => { let best = null; for (let k = from; k <= Math.max(from, end); k += Math.max(1, Math.round(spc / 8))) { const m = mag(r, c, k); best = best === null ? m : pick(best, m); } return best; };
  for (const p of ["A", "B", "C", "N"]) {
    const c = ch["I" + p]; if (!c) continue;
    e.currents.set(p === "N" ? "IN" : "I" + p, [mag(r, c, pre), peak(c, Math.max)]);
  }
  for (const p of ["A", "B", "C"]) {
    const c = ch["V" + p]; if (!c) continue;
    e.voltages.set("V" + p, [mag(r, c, pre), peak(c, Math.min)]);
  }
  e.notes.push(`Fault type from the waveforms: ${cls.name}.`);
  for (const n of cls.notes) e.notes.push(n);
  e.waveRef = { id: r.id, sam: spc, breaker };
  e.extra.push(`Record      : COMTRADE ${r.revision || ""} from ${r.relay || "?"}${r.station ? " at " + r.station : ""}, ${Math.round(r.sps)} samples/s`);
  return e;
}

/** files: the COMTRADE files from core.loadFiles -> {events, errors}. */
function eventsFromComtrade(files) {
  const { records, errors } = comtradeRecords(files);
  const events = [];
  for (const r of records) {
    try { events.push(eventFromRecord(r)); } catch (err) { errors.push(`${r.source}: couldn't summarize the COMTRADE record (${err.message || err})`); }
  }
  return { events, errors };
}

const api = {
  recordFromEvent, parseComtrade, comtradeRecords, phasorAt, harmonics, rmsTrend, sequence, snapshot, channels,
  classify, evaluateOvercurrent, curveTime, CURVES, translateElement, elementGroup, elementTimeline, analyze,
  FAULT_NAMES, cabs, cang, polar, wrap, eventsFromComtrade, eventFromRecord,
};
if (core && core.useComtradeReader) core.useComtradeReader(eventsFromComtrade);
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.SELAnalysis = api;
})(typeof window !== "undefined" ? window : globalThis);
