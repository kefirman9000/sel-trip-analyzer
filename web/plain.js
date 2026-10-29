/* Relay Trip Analyzer - plain-English wording for people who don't read relay codes.
 *
 * Used when "Plain English" is switched on (the Analyzer header, the History page). It only rewords
 * what the record shows; the codes stay available (in the details and on hover), and causes stay
 * "possible" exactly as the analysis says.
 *
 *   SELPlain.sentence({core, tripped, primary, targets, locNum, locPct, loc, shot}) -> "Tripped: phase A touched ground..."
 *   SELPlain.faultShort("AG") -> "A to ground"      SELPlain.element("Z1G") -> "Zone 1 distance protection..."
 *   SELPlain.issue(key) -> [short, long]            SELPlain.cycles(7.75) -> "7.75 cycles (0.13 s)"
 * Works in browsers (window.SELPlain) and Node.
 */
(function (root) {
"use strict";
const isNode = typeof module !== "undefined" && module.exports;
const core = isNode ? require("./core.js") : root.SELCore;

const FAULT_SHORT = { AG: "A to ground", BG: "B to ground", CG: "C to ground", AB: "A and B", BC: "B and C", CA: "C and A",
  ABG: "A, B to ground", BCG: "B, C to ground", CAG: "C, A to ground", ABC: "All 3 phases", ABCG: "All 3 phases",
  TRIP: "No fault found", ER: "Record only", TRIG: "Manual record" };
const FAULT_SENTENCE = {
  AG: "phase A touched ground", BG: "phase B touched ground", CG: "phase C touched ground",
  AB: "phases A and B touched each other", BC: "phases B and C touched each other", CA: "phases C and A touched each other",
  ABG: "phases A and B touched ground", BCG: "phases B and C touched ground", CAG: "phases C and A touched ground",
  ABC: "all three phases faulted together", ABCG: "all three phases faulted to ground",
};

/** What kind of protection, in words: from the tripping elements, else from the front-panel targets. */
const KINDS = [
  ["comm", "a trip signal from the relay at the other end of the line"],
  ["dist", null],                          // zone-specific, below
  ["87", "differential protection (the current going in and out didn't match)"],
  ["50", "instant overcurrent protection (the current was very high)"],
  ["51", "timed overcurrent protection (the current stayed too high for too long)"],
  ["67", "directional overcurrent protection"],
  ["81", "low-frequency load shedding (the power system's frequency dropped)"],
  ["27", "low-voltage protection"],
  ["59", "high-voltage protection"],
  ["bf", "breaker-failure protection (another breaker didn't open)"],
  ["sotf", "switch-onto-fault protection (it closed onto a fault)"],
];
const zoneText = (z) => (z === "1" ? "Zone 1 distance protection (fast: the fault was close, on this line)"
  : z === "2" ? "Zone 2 distance protection (slower backup: the fault was near the far end of the line)"
  : `Zone ${z} distance protection (backup for faults further away)`);
function kindsOf(primary, targets) {
  const kinds = new Map();               // kind -> text
  const add = (k, text) => { if (!kinds.has(k)) kinds.set(k, text); };
  for (const el of primary || []) {
    const n = String(el).toUpperCase(), cls = core.elementClass(n);
    const z = /^(?:Z|M)(\d)/.exec(n) || /\bZ(?:ONE)?\s*-?(\d)/.exec(n) || /ZM0?(\d)/.exec(n);
    if (/distance/.test(cls)) add("dist" + (z ? z[1] : ""), z ? zoneText(z[1]) : "distance protection");
    else if (/communications/.test(cls)) add("comm", KINDS[0][1]);
    else if (/differential/.test(cls)) add("87", KINDS[2][1]);
    else if (/instantaneous overcurrent/.test(cls)) add("50", KINDS[3][1]);
    else if (/time-overcurrent/.test(cls)) add("51", KINDS[4][1]);
    else if (/directional overcurrent/.test(cls)) add("67", KINDS[5][1]);
    else if (/frequency/.test(cls)) add("81", KINDS[6][1]);
    else if (/undervoltage/.test(cls)) add("27", KINDS[7][1]);
    else if (/overvoltage/.test(cls)) add("59", KINDS[8][1]);
    else if (/breaker failure/.test(cls)) add("bf", KINDS[9][1]);
    else if (/switch-onto-fault/.test(cls)) add("sotf", KINDS[10][1]);
  }
  if (!kinds.size && targets) {
    const t = ` ${String(targets).toUpperCase()} `;
    const z = /\bZ(?:ONE)?\s*(\d)\b/.exec(t);
    if (/\bCOMM\b/.test(t)) add("comm", KINDS[0][1]);
    if (z) add("dist" + z[1], zoneText(z[1]));
    if (/\b87/.test(t)) add("87", KINDS[2][1]);
    if (/\b51/.test(t) || (/\bTIME\b/.test(t) && !z)) add("51", KINDS[4][1]);
    if (/\b50(?!BF)/.test(t) || (/\bINST\b/.test(t) && !z)) add("50", KINDS[3][1]);
    if (/\b67/.test(t)) add("67", KINDS[5][1]);
    if (/\b81|\bFREQ\b/.test(t)) add("81", KINDS[6][1]);
    if (/\b27/.test(t)) add("27", KINDS[7][1]);
    if (/\b59/.test(t)) add("59", KINDS[8][1]);
    if (/\bBF\b|50BF/.test(t)) add("bf", KINDS[9][1]);
    if (/\bSOTF\b/.test(t)) add("sotf", KINDS[10][1]);
  }
  return [...kinds.values()];
}
const shortKind = (text) => text.replace(/ \(.*\)$/, "");

function where(r) {
  if (r.locNum === null || r.locNum === undefined || !Number.isFinite(r.locNum)) return "";
  if (r.locNum < 0) return "behind the relay (in the other direction from the line)";
  if (r.locPct !== null && r.locPct !== undefined) {
    if (r.locPct > 105) return `beyond the end of the line (${r.loc || r.locNum} from the relay)`;
    return `about ${r.locPct}% of the way along the line (${r.loc || r.locNum} from the relay)`;
  }
  return `${r.loc || r.locNum} from the relay (in the relay's distance units)`;
}

/** One sentence for an event. r: {core, tripped, primary, targets, locNum, locPct, loc, shot, checks} */
function sentence(r, opts) {
  opts = opts || {};
  const c = r.core || core.eventCore(r.et || r.event_type || "");
  const tokens = String(r.targets || "").toUpperCase().split(/\s+/);
  const lockout = tokens.includes("LO") || (r.seq || []).some(([, el]) => /^79LO/.test(el));
  const kinds = kindsOf(r.primary, r.targets);
  const by = kinds.length ? kinds.map(opts.long ? (x) => x : shortKind).join(" and ") : "";
  const w = where(r);
  let s;
  if (FAULT_SENTENCE[c]) {
    s = `${r.tripped ? "Tripped" : "No trip"}: ${FAULT_SENTENCE[c]}${w ? " " + w : ""}`;
    if (r.tripped) s += by ? `; ${by} opened the breaker` : "; the breaker opened";
    else s += "; the relay recorded it but didn't trip";
  } else if (c === "TRIP" || (r.tripped && !FAULT_SENTENCE[c])) {
    s = `Tripped: no fault was found${by ? `; it came from ${by}` : "; the reason isn't in the record (possibly a manual or remote open)"}`;
  } else if (c === "ER" || c === "TRIG") {
    s = c === "TRIG" ? "No trip: someone took a manual recording" : "No trip: the relay saw something worth recording, but nothing tripped";
  } else s = `${r.tripped ? "Tripped" : "No trip"}: event type ${r.et || c || "unknown"}`;
  if (lockout) s += ". The recloser tried again and then gave up, so the circuit stayed off (lockout)";
  else if (r.tripped && Number(r.shot) > 0) s += ` (after ${r.shot} reclose${Number(r.shot) === 1 ? "" : "s"})`;
  s += ".";
  const n = opts.checks === undefined ? (r.checks || []).length + (r.gaps || []).length : opts.checks;
  return n && opts.withChecks !== false ? `${s}  [${n} to check]` : s;
}
function faultShort(c, tripped) { return FAULT_SHORT[c] || (tripped ? "Tripped" : c || "?"); }

/** A relay element in everyday words (the technical explanation is on the Waveforms page). */
function element(name) {
  const n = String(name).toUpperCase();
  if (/^TRIP\d?$|^3PT$|^TP[ABC]/.test(n)) return "the relay's trip signal";
  if (/^OUT\d+/.test(n)) return "an output to the breaker or alarms";
  if (/^IN\d+/.test(n)) return "a wired input (often the breaker position or an outside trip)";
  if (/^52A/.test(n)) return "breaker closed";
  if (/^52B/.test(n)) return "breaker open";
  if (/^79LO/.test(n)) return "recloser gave up (lockout)";
  if (/^79RS/.test(n)) return "recloser ready";
  if (/^79CY/.test(n)) return "recloser trying again";
  if (/^KEY$/.test(n)) return "trip permission sent to the other end";
  const k = kindsOf([n], "");
  return k.length ? shortKind(k[0]) : core.elementClass(n) || "a relay logic bit";
}

/** Issue types in everyday words: [short, long]. */
const ISSUES = {
  f_slg: ["Touched ground", "Faults where a phase touched ground"],
  f_ll: ["Phases touched", "Faults where two phases touched each other"],
  f_llg: ["Two phases to ground", "Faults where two phases touched ground"],
  f_3ph: ["All three phases", "Faults on all three phases"],
  trip_nofault: ["Tripped, no fault", "Trips with no fault and no reason found"],
  transfer: ["Tripped by other end", "Trips sent from the other end of the line"],
  underfreq: ["Load shedding", "Load shedding because the system frequency dropped"],
  lockout: ["Stayed off", "Recloser gave up and the circuit stayed off (lockouts)"],
  slow_breaker: ["Slow breaker", "Breaker slow to open"],
  breaker_status: ["Breaker position unclear", "Breaker position not seen, or seen in the wrong order"],
  unexplained: ["Unexplained trip", "Trips no protection explains"],
  z1_reach: ["Reached too far", "Fast protection tripped for a fault too far away"],
  beyond_line: ["Past the line end", "Faults located past the end of the line"],
  reverse: ["Behind the relay", "Faults behind the relay (the other direction)"],
  mismatch: ["Record contradicts itself", "Records that contradict themselves"],
  low_current: ["Weak fault", "Weak faults (possibly a wire on the ground)"],
  off_freq: ["Frequency off normal", "System frequency off normal"],
  no_location: ["Distance unknown", "No distance to the fault"],
  other_check: ["Other checks", "Other things to check"],
  no_settings: ["No settings", "No relay settings loaded"],
  summary_only: ["Summary only", "Only a summary of the event (no detailed record)"],
};
const issue = (key) => ISSUES[key] || [key, key];
const cycles = (c, hz) => (c === null || c === undefined ? "" : `${c} cycles (${(c / (hz || 60)).toFixed(2)} s)`);

/** Plain sentence for an Analyzer event item ({e, s, a} from core.prepareView). */
function itemSentence(it) {
  const e = it.e, s = it.s || {}, a = it.a;
  const locNum = e.location && !e.location.includes("$") ? parseFloat(e.location) : null;
  const ll = parseFloat(s.LL);
  return sentence({ core: core.eventCore(e.event_type), tripped: a.tripped, primary: a.primary, targets: e.targets, loc: e.location,
    locNum: Number.isFinite(locNum) ? locNum : null, locPct: Number.isFinite(locNum) && ll ? Math.round(100 * locNum / ll) : null,
    shot: e.shot, seq: e.sequence.filter((x) => x[2] === "asserted").map(([cy, el]) => [cy, el]), checks: a.checks, gaps: a.gaps });
}

const api = { sentence, itemSentence, faultShort, element, issue, cycles, kindsOf, where, ISSUES, FAULT_SHORT };
if (core && core.usePlain) core.usePlain(api);
if (isNode) module.exports = api;
else root.SELPlain = api;
})(typeof window !== "undefined" ? window : globalThis);
