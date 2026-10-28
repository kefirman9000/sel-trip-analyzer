/* SEL Trip Event Analyzer - reference waveform library.
 *
 * Synthetic but realistic records of the events you meet in the field, built on
 * demand in the same "record" format as CEV / COMTRADE files, so the Waveform
 * analysis page can step through them and analyze them exactly like real ones.
 * 60 Hz, 32 samples per cycle, primary amps and kV. CTR 240 (1200:5).
 */
(function (root) {
"use strict";

const F = 60, SPC = 32, CYCLES = 22, INCEPTION = 5;
const SETTINGS = {
  RID: "REFERENCE FEEDER", CTR: "240", PTR: "600", LL: "10.00",
  "50P1P": "12.00", "50G1P": "6.00", "51PP": "2.50", "51PC": "U3", "51PTD": "2.00",
  "51GP": "1.20", "51GC": "U3", "51GTD": "3.00", TR: "Z1G + M1P + 50P1 + 51PT + 51GT",
};

// small deterministic PRNG for arcing noise
function rng(seed) { let x = seed >>> 0; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) / 4294967296) - 0.5; }; }
const rad = (d) => (d * Math.PI) / 180;

/**
 * Build a record. spec.segments: [{from, to, I: {A:[mag,deg],..}, V: {A:[mag,deg],..}}] (cycles, rms primary).
 * spec.dc: fraction of offset at the fault segment start; spec.extra(k, t, ph, kind, base) can modify values.
 */
function build(spec) {
  const n = CYCLES * SPC;
  const t = new Float64Array(n);
  for (let k = 0; k < n; k++) t[k] = (k - INCEPTION * SPC) / (SPC * F);
  const seg = (c) => spec.segments.find((s) => c >= s.from && c < s.to) || spec.segments[spec.segments.length - 1];
  const mk = (kind, ph) => {
    const v = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const c = k / SPC, s = seg(c), th = 2 * Math.PI * c;
      const z = (kind === "I" ? s.I : s.V)[ph];
      let x = z ? Math.SQRT2 * z[0] * Math.cos(th + rad(z[1])) : 0;
      if (kind === "I" && s.dc && z && c >= s.from) {
        const th0 = 2 * Math.PI * s.from;
        x -= Math.SQRT2 * z[0] * Math.cos(th0 + rad(z[1])) * s.dc * Math.exp(-(c - s.from) / (s.tau || 2.5));
      }
      if (spec.extra) x = spec.extra(k, c, ph, kind, x, s);
      v[k] = x;
    }
    return v;
  };
  const analogs = [];
  for (const ph of ["A", "B", "C"]) analogs.push({ name: "I" + ph, phase: ph, kind: "I", unit: "A", values: mk("I", ph), primary: true });
  const ig = new Float64Array(n);
  for (let k = 0; k < n; k++) ig[k] = analogs[0].values[k] + analogs[1].values[k] + analogs[2].values[k];
  analogs.push({ name: "IG", phase: "N", kind: "I", unit: "A", values: ig, primary: true });
  for (const ph of ["A", "B", "C"]) analogs.push({ name: "V" + ph, phase: ph, kind: "V", unit: "kV", values: mk("V", ph), primary: true });
  const digitals = Object.entries(spec.digitals || {}).map(([name, ivs]) => {
    const v = new Uint8Array(n);
    for (const [a, b] of ivs) for (let k = Math.round(a * SPC); k < Math.min(n, Math.round(b * SPC)); k++) v[k] = 1;
    return { name, values: v };
  });
  return {
    id: "ref:" + spec.key, kind: "reference", source: "Reference library", title: spec.title, relay: "REFERENCE FEEDER",
    station: "", date: "", time: "", freq: F, sps: F * SPC, spc: SPC, n, t, trigger: INCEPTION * SPC,
    analogs, digitals, settings: Object.assign({}, SETTINGS), reference: spec,
  };
}

const LOAD = { A: [300, -20], B: [300, -140], C: [300, 100] };
const VN = { A: [67, 0], B: [67, -120], C: [67, 120] };
const pre = { from: 0, to: INCEPTION, I: LOAD, V: VN };
const opened = (at) => ({ from: at, to: CYCLES, I: {}, V: VN });
const BRK = (open) => ({ "52A": [[0, open]] });

const LIBRARY = [
  {
    key: "load", title: "Normal load (no fault)", code: "NONE",
    what: "Balanced three-phase load: equal currents 120 degrees apart, steady voltages, no ground current.",
    lookFor: ["All three currents the same size and evenly spaced", "Ground current near zero", "Voltages steady at nominal",
              "Use this as the 'healthy' picture to compare faults against"],
    segments: [{ from: 0, to: CYCLES, I: LOAD, V: VN }],
    digitals: { "52A": [[0, CYCLES]], "79RS": [[0, CYCLES]] },
  },
  {
    key: "slg", title: "Single phase-to-ground (A-G)", code: "AG",
    what: "The most common fault on overhead lines (lightning, a tree or animal on one phase). Phase A current jumps and ground current flows; phase A voltage sags.",
    lookFor: ["Only phase A current jumps", "Ground current (IG) about equal to the faulted phase current", "Phase A voltage sags; B and C hold",
              "Zero-sequence (I0) and negative-sequence (I2) both appear", "DC offset on the first cycles, decaying"],
    segments: [pre, { from: INCEPTION, to: 9.25, I: { A: [2400, -80], B: LOAD.B, C: LOAD.C }, V: { A: [18, -5], B: [66, -121], C: [65.5, 121] }, dc: 0.7 },
               opened(9.25)],
    digitals: { ...BRK(9.25), "Z1G": [[5.25, 9.5]], "50G1": [[5.1, 9.4]], "51G": [[5.1, 9.4]], "TRIP": [[6.25, 10.5]], "OUT101": [[6.25, 10.5]], "79RS": [[0, 6.25]], "79CY": [[6.25, CYCLES]] },
  },
  {
    key: "ll", title: "Phase-to-phase (B-C)", code: "BC",
    what: "Two conductors touching (wind, galloping, a branch across two phases). Currents in B and C are equal and opposite; no ground current.",
    lookFor: ["IB and IC large and about 180 degrees apart", "No ground current", "VB and VC collapse toward each other",
              "Negative-sequence (I2) large, zero-sequence (I0) near zero"],
    segments: [pre, { from: INCEPTION, to: 9, I: { A: LOAD.A, B: [3500, -170], C: [3500, 10] }, V: { A: [66.5, 0], B: [40, -165], C: [40, 165] }, dc: 0.5 }, opened(9)],
    digitals: { ...BRK(9), "M1P": [[5.25, 9.3]], "50P1": [[5.1, 9.2]], "51P": [[5.1, 9.2]], "TRIP": [[6, 10.5]], "OUT101": [[6, 10.5]] },
  },
  {
    key: "llg", title: "Two phases to ground (B-C-G)", code: "BCG",
    what: "Two phases faulted together to ground, e.g. a crossarm failure or a conductor falling across another onto the ground.",
    lookFor: ["IB and IC large but not exactly opposite", "Significant ground current", "VB and VC both sag",
              "Both I2 and I0 present"],
    segments: [pre, { from: INCEPTION, to: 9, I: { A: LOAD.A, B: [3300, -150], C: [3100, 45] }, V: { A: [66, 0], B: [22, -130], C: [24, 140] }, dc: 0.5 }, opened(9)],
    digitals: { ...BRK(9), "Z1G": [[5.3, 9.3]], "M1P": [[5.3, 9.3]], "50G1": [[5.1, 9.2]], "50P1": [[5.1, 9.2]], "TRIP": [[6, 10.5]], "OUT101": [[6, 10.5]] },
  },
  {
    key: "3ph", title: "Three-phase fault", code: "ABC",
    what: "All three phases faulted together; rare on lines (often left grounds after maintenance, or a fault close to a substation). Balanced but very large currents.",
    lookFor: ["All three currents large, still balanced and 120 degrees apart", "All three voltages sag equally", "No I0 and almost no I2: it is still a balanced (positive-sequence) event",
              "Ground elements don't pick up; phase elements do"],
    segments: [pre, { from: INCEPTION, to: 8.75, I: { A: [5200, -82], B: [5200, -202], C: [5200, 38] }, V: { A: [12, 0], B: [12, -120], C: [12, 120] }, dc: 0.45 }, opened(8.75)],
    digitals: { ...BRK(8.75), "M1P": [[5.25, 9]], "50P1": [[5.1, 9]], "TRIP": [[5.75, 10]], "OUT101": [[5.75, 10]] },
  },
  {
    key: "hiz", title: "High-impedance ground fault", code: "AG",
    what: "A downed conductor on dry ground, asphalt or a tree limb: very little fault current, often less than load. Overcurrent relays frequently can't see it.",
    lookFor: ["Phase A barely changes", "Small, irregular ground current with harmonics (arcing)", "Voltages normal",
              "Usually no trip: these faults are found by patrol or by special high-impedance detection"],
    segments: [pre, { from: INCEPTION, to: CYCLES, I: { A: [335, -24], B: LOAD.B, C: LOAD.C }, V: VN }],
    extra: (() => { const r = rng(7); return (k, c, ph, kind, x) => (kind === "I" && ph === "A" && c >= INCEPTION
      ? x + 55 * Math.SQRT2 * (Math.cos(2 * Math.PI * c - 0.4) * (0.75 + 0.5 * r()) + 0.35 * Math.cos(6 * Math.PI * c)) : x); })(),
    digitals: { "52A": [[0, CYCLES]], "79RS": [[0, CYCLES]] },
  },
  {
    key: "inrush", title: "Transformer inrush (energizing)", code: "INRUSH",
    what: "Closing a breaker onto transformers draws a large, lopsided magnetizing current for a few cycles. It looks like a fault to a plain overcurrent element but it isn't one.",
    lookFor: ["Peaky, one-sided current pulses that decay over several cycles", "Large 2nd harmonic (above ~15% of the fundamental)",
              "Voltages stay normal", "Relays use 2nd-harmonic restraint or blocking to avoid tripping"],
    segments: [{ from: 0, to: INCEPTION, I: {}, V: VN }, { from: INCEPTION, to: CYCLES, I: {}, V: VN }],
    extra: (k, c, ph, kind, x) => {
      if (kind !== "I" || c < INCEPTION) return x;
      const off = { A: 0, B: -120, C: 120 }[ph], sign = { A: 1, B: -0.55, C: -0.45 }[ph];
      const th = 2 * Math.PI * c + rad(off);
      const pulse = Math.max(0, Math.cos(th) - 0.25) / 0.75;
      return x + sign * 1900 * Math.exp(-(c - INCEPTION) / 6) * Math.pow(pulse, 1.6) + 40 * Math.SQRT2 * Math.cos(th - 0.3);
    },
    digitals: { "52A": [[INCEPTION, CYCLES]], "IN101": [[INCEPTION, CYCLES]], "51P": [[5.1, 8]] },
  },
  {
    key: "ctsat", title: "CT saturation during a ground fault", code: "AG",
    what: "A heavy fault with a large DC offset pushes the CT core into saturation, so the relay sees a chopped, shrunken current for a few cycles.",
    lookFor: ["Phase A current looks clipped or chopped right after the fault starts", "Big DC offset at inception",
              "High total harmonic distortion during the fault", "Distance and differential elements may be slow or misoperate"],
    segments: [pre, { from: INCEPTION, to: 10, I: { A: [9000, 0], B: LOAD.B, C: LOAD.C }, V: { A: [8, 80], B: [66, -121], C: [65.5, 121] }, dc: 0.95, tau: 4 }, opened(10)],
    extra: (() => {
      let flux = 0;
      return (k, c, ph, kind, x) => {
        if (kind !== "I" || ph !== "A") return x;
        if (k === 0) flux = 0;
        // the core saturates once the flux driven by the secondary current reaches the limit; while saturated
        // (and the current keeps pushing the same way) almost nothing reaches the relay, then it recovers
        const lim = 4000;
        const out = Math.abs(flux) >= lim && Math.sign(x) === Math.sign(flux) ? x * 0.04 : x;
        flux = flux * 0.998 + out / SPC;
        return out;
      };
    })(),
    digitals: { ...BRK(10), "Z1G": [[5.5, 10.2]], "50G1": [[5.1, 10.1]], "TRIP": [[6.5, 11]], "OUT101": [[6.5, 11]] },
  },
  {
    key: "evolving", title: "Evolving fault (A-G becomes A-B-G)", code: "ABG",
    what: "A fault that spreads: it starts on one phase and, a few cycles later, flashes over to a second phase (e.g. arc products drifting between conductors).",
    lookFor: ["First cycles: only phase A high", "Then phase B jumps too", "Ground current throughout",
              "Relays may change from a ground element to a phase element mid-fault"],
    segments: [pre, { from: INCEPTION, to: 8, I: { A: [2300, -80], B: LOAD.B, C: LOAD.C }, V: { A: [20, -5], B: [66, -121], C: [65.5, 121] }, dc: 0.6 },
               { from: 8, to: 11, I: { A: [3600, -70], B: [3400, -175], C: LOAD.C }, V: { A: [14, -10], B: [16, -110], C: [64, 121] }, dc: 0 }, opened(11)],
    digitals: { ...BRK(11), "Z1G": [[5.3, 11.3]], "M1P": [[8.3, 11.3]], "50G1": [[5.1, 11.2]], "TRIP": [[9.25, 12]], "OUT101": [[9.25, 12]] },
  },
];

function referenceRecord(key) {
  const spec = LIBRARY.find((x) => x.key === key);
  return spec ? build(spec) : null;
}
const referenceList = () => LIBRARY.map(({ key, title, code, what, lookFor }) => ({ key, title, code, what, lookFor }));

const api = { referenceRecord, referenceList, LIBRARY };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.SELReference = api;
})(typeof window !== "undefined" ? window : globalThis);
