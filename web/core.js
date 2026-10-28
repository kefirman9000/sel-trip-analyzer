/* SEL Trip Event Analyzer - analysis core for the browser version.
 *
 * A line-for-line JavaScript port of the parsing and analysis in
 * sel_trip_analyzer.py. tests/web_parity.js checks that both produce the same
 * report for the sample files, so change them together.
 *
 * Works in browsers and Node (module.exports). No dependencies.
 */
(function (root) {
"use strict";

// ---------------------------------------------------------------------------
// Python-compatible regex and string helpers
// ---------------------------------------------------------------------------
const reCache = new Map();

/** Translate a Python regex so '.', '^' and '$' behave exactly like Python's re. */
function R(src, flags) {
  flags = flags || "";
  const key = src + "\u0000" + flags;
  const hit = reCache.get(key);
  if (hit) { hit.lastIndex = 0; return hit; }
  const multi = flags.includes("m");
  let out = "", inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") { out += c + (src[i + 1] || ""); i++; continue; }
    if (inClass) { if (c === "]") inClass = false; out += c; continue; }
    if (c === "[") {
      inClass = true; out += c;
      if (src[i + 1] === "^") { out += "^"; i++; }
      if (src[i + 1] === "]") { out += "\\]"; i++; }
      continue;
    }
    if (c === ".") { out += "[^\\n]"; continue; }
    if (c === "^") { out += multi ? "(?<![^\\n])" : "(?<![\\s\\S])"; continue; }
    if (c === "$") { out += multi ? "(?=\\n|(?![\\s\\S]))" : "(?=\\n?(?![\\s\\S]))"; continue; }
    out += c;
  }
  const re = new RegExp(out, flags.replace("m", ""));
  reCache.set(key, re);
  return re;
}
const g = (re) => new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
const sticky = (re) => new RegExp(re.source, re.flags + "y");

function search(pat, s, flags) { return R(pat, flags).exec(s); }
function pmatch(pat, s, flags) {          // re.match: anchored at the start
  const re = sticky(R(pat, flags)); re.lastIndex = 0; return re.exec(s);
}
function fullmatch(pat, s, flags) {
  const re = new RegExp("(?:" + R(pat, flags).source + ")(?![\\s\\S])", (flags || "").replace("m", "") + "y");
  re.lastIndex = 0; return re.exec(s);
}
function finditer(pat, s, flags) { return [...s.matchAll(g(R(pat, flags)))]; }
function sub(pat, repl, s, flags) { return s.replace(g(R(pat, flags)), repl); }
function resplit(pat, s, flags) { return s.split(R(pat, flags)); }

const WS = " \t\n\r\x0b\x0c\x1c\x1d\x1e\x1f\x85\u00a0";
function strip(s, chars) {
  chars = chars === undefined ? WS : chars;
  let a = 0, b = s.length;
  while (a < b && chars.includes(s[a])) a++;
  while (b > a && chars.includes(s[b - 1])) b--;
  return s.slice(a, b);
}
const splitWS = (s) => s.split(/[ \t\n\r\x0b\x0c\x1c-\x1f\x85\u00a0]+/).filter(Boolean);
function splitlines(s) {
  const parts = s.split(/\r\n|[\n\r\x0b\x0c\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}
function pyFloat(s) {
  const t = strip(String(s));
  if (/^[+-]?(inf|infinity)$/i.test(t)) return t[0] === "-" ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(t)) return NaN;
  if (!/^[+-]?((\d(_?\d)*)(\.(\d(_?\d)*)?)?|\.\d(_?\d)*)([eE][+-]?\d(_?\d)*)?$/.test(t)) return null;
  return Number(t.replace(/_/g, ""));
}
const isNum = (s) => pyFloat(s) !== null;
function fnum(s, dflt) {
  if (s === undefined || s === null) return dflt === undefined ? null : dflt;
  const v = pyFloat(s);
  return v === null ? (dflt === undefined ? null : dflt) : v;
}
function pyInt(s) {
  if (typeof s === "number") return Math.trunc(s);
  const t = strip(String(s));
  if (!/^[+-]?\d(_?\d)*$/.test(t)) throw new Error("invalid literal for int(): '" + s + "'");
  return parseInt(t.replace(/_/g, ""), 10);
}
/** Python round(): half to even. */
function pyRound(x) {
  const f = Math.floor(x), d = x - f;
  if (d === 0.5) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}
/** Python f"{x:.{d}f}" (exact binary ties round half to even). */
function fx(x, d) {
  const m = Math.pow(10, d), y = Math.abs(x) * m, fl = Math.floor(y);
  if (y - fl === 0.5 && fl % 2 === 0) return (x < 0 ? "-" : "") + (fl / m).toFixed(d);
  return x.toFixed(d);
}
/** Python f"{x:,.{d}f}" */
function fc(x, d) {
  const s = fx(x, d), neg = s[0] === "-", body = neg ? s.slice(1) : s;
  const [ip, dp] = body.split(".");
  const grouped = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + grouped + (dp !== undefined ? "." + dp : "");
}
const pad2 = (n) => String(n).padStart(2, "0");
function pyTitle(s) {
  let out = "", prevCased = false;
  for (const ch of s) {
    const lo = ch.toLowerCase(), up = ch.toUpperCase(), cased = lo !== up;
    out += cased ? (prevCased ? lo : up) : ch;
    prevCased = cased;
  }
  return out;
}
function splitMax(s, sep, max) {
  const parts = s.split(sep);
  return parts.length <= max + 1 ? parts : parts.slice(0, max).concat(parts.slice(max).join(sep));
}
const uniq = (arr) => [...new Set(arr)];

// ---------------------------------------------------------------------------
// Bytes -> text
// ---------------------------------------------------------------------------
function latin1(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return s;
}
function readText(bytes) {
  try {
    let t = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
    return t;
  } catch (e) {
    return latin1(bytes);
  }
}
function decodeBlob(data) {
  if ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff) ||
      (data.length > 4 && data[1] === 0 && data[3] === 0)) {
    const be = data[0] === 0xfe && data[1] === 0xff;
    return new TextDecoder(be ? "utf-16be" : "utf-16le").decode(data).replace(/\ufffd/g, "");
  }
  return latin1(data).replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, "\n");
}

// ---------------------------------------------------------------------------
// Settings text
// ---------------------------------------------------------------------------
// setting names can start with a digit (50P1P, 51GTD) but must contain a letter
const SETTING_RE = '\\b((?=[0-9]*[A-Z])[A-Z0-9][A-Z0-9_]{0,11})\\s*:?=\\s*(.*?)(?=\\s{2,}(?=[0-9]*[A-Z])[A-Z0-9][A-Z0-9_]{0,11}\\s*:?=|\\"|$)';
const USEFUL_SETTINGS = new Set(["RID", "TID", "SID", "LL", "CTR", "CTRN", "PTR", "PTRS", "Z1MAG", "Z1ANG", "Z0MAG",
  "TR", "TRCOMM", "TRSOTF", "DTT", "ULTR", "ER", "79RI", "52A", "52AA1", "BFI",
  "Z1P", "Z2P", "Z3P", "Z1MG", "Z2MG", "Z1G", "Z2D", "Z2PD", "Z2GD", "Z3D",
  "50P1P", "50G1P", "50Q1P", "51PP", "51PC", "51PTD", "51GP", "51GC", "51GTD",
  "51QP", "E21P", "E21MG", "E21XG", "E50P", "E50G", "E51S", "E32", "ECOMM", "E81",
  "TOP", "TPA", "TPB", "TPC"]);

function extractSettings(text) {
  const out = {};
  for (const line of splitlines(text)) {
    if (!line.includes("=")) continue;
    for (const m of finditer(SETTING_RE, line)) {
      const key = m[1], val = strip(strip(strip(m[2]), ","));
      if (!val || val.length > 400) continue;
      if (USEFUL_SETTINGS.has(key) || ["TR", "E", "Z", "50", "51", "67", "87"].some((p) => key.startsWith(p)))
        if (!(key in out)) out[key] = val;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Interpretation tables
// ---------------------------------------------------------------------------
const FAULT_TYPES = {
  AG: "Phase A-to-ground fault", BG: "Phase B-to-ground fault", CG: "Phase C-to-ground fault",
  AB: "Phase A-B (phase-to-phase) fault", BC: "Phase B-C (phase-to-phase) fault",
  CA: "Phase C-A (phase-to-phase) fault",
  ABG: "Phase A-B-to-ground fault", BCG: "Phase B-C-to-ground fault", CAG: "Phase C-A-to-ground fault",
  ABC: "Three-phase fault", ABCG: "Three-phase-to-ground fault",
};
const NON_FAULT_TYPES = {
  TRIP: "Trip with no fault type identified (non-fault trip: transfer/remote/manual trip, " +
        "external input, or fault type undetermined)",
  ER: "Event triggered by the ER (event report trigger) equation - no trip",
  TRIG: "Manually triggered event (TRI command) - no trip",
  PULSE: "Output pulsed by command (PUL)",
  OPEN: "Breaker open command", CLOSE: "Breaker close command",
  BCW: "Breaker contact wear alarm", LOP: "Loss of potential",
  OST: "Out-of-step trip", OSB: "Out-of-step blocking",
  SOTF: "Switch-onto-fault",
};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const TARGET_WORDS = [
  ["\\bINST\\b", "instantaneous element"],
  ["\\bCOMM\\b", "communications-assisted scheme (POTT/DCB/DCUB/DTT)"],
  ["\\bSOTF\\b", "switch-onto-fault logic"],
  ["\\bTIME\\b", "time-delayed element"],
  ["\\bZ(?:ONE)?\\s*1\\b|\\bZONE1\\b|\\bZ1\\b", "Zone 1 distance"],
  ["\\bZ(?:ONE)?\\s*2\\b|\\bZONE2\\b|\\bZ2\\b", "Zone 2 distance"],
  ["\\bZ(?:ONE)?\\s*3\\b|\\bZONE3\\b|\\bZ3\\b", "Zone 3 distance"],
  ["\\bZ(?:ONE)?\\s*4\\b|\\bZONE4\\b|\\bZ4\\b", "Zone 4 distance"],
  ["\\b87\\w*\\b", "differential (87)"],
  ["\\b51\\w*\\b", "time-overcurrent (51)"],
  ["\\b50\\w*\\b", "instantaneous overcurrent (50)"],
  ["\\b67\\w*\\b", "directional overcurrent (67)"],
  ["\\b81\\w*\\b|\\bFREQ\\b", "frequency (81)"],
  ["\\b27\\w*\\b", "undervoltage (27)"],
  ["\\b59\\w*\\b", "overvoltage (59)"],
  ["\\bBF\\w*\\b|\\b50BF\\b", "breaker failure"],
  ["\\bCY\\b", "recloser cycling (reclose in progress)"],
  ["\\bRS\\b", "recloser reset (ready)"],
  ["\\b79\\w*\\b|\\bRCLS\\b", "reclosing"],
  ["\\bLO\\b", "recloser locked out"],
];

const ELEMENT_RULES = [
  ["^(Z|M)\\d+(P|G|MG|XG)?T$|^Z\\d+(P|G)?D$", "distance (time-delayed)"],
  ["^(Z|M)\\d+(P|G|MG|XG|AB|BC|CA|AG|BG|CG)?$|^MAB\\d|^MBC\\d|^MCA\\d|^MAG\\d|^MBG\\d|^MCG\\d|^XAG\\d|^XBG\\d|^XCG\\d", "distance"],
  ["^87", "differential"],
  ["^51\\w*T$", "time-overcurrent trip"],
  ["^51", "time-overcurrent pickup"],
  ["^67", "directional overcurrent"],
  ["^50BF|^BFT|^FBF", "breaker failure"],
  ["^50", "instantaneous overcurrent"],
  ["^32|^F32|^R32", "directional"],
  ["^81", "frequency"],
  ["^27", "undervoltage"],
  ["^59", "overvoltage"],
  ["^24", "volts/hertz"],
  ["^46", "negative-sequence"],
  ["^49", "thermal"],
  ["^OST|^OSB", "out-of-step"],
  ["^SOTF|^SOTFT", "switch-onto-fault"],
  ["^(DTT|DTA|DTB|DTC|PTRX|PT\\d?|RX|KEY|TRCOMM|ECTT|DCB|POTT|Z2PGS|RB\\d|ROK|RBADA?)", "communications / transfer trip"],
  ["^IN\\d+$", "contact input"],
  ["^(TRIP|TR|TRIP\\d|3PT|TPA\\d?|TPB\\d?|TPC\\d?|TRP\\w*)$", "TRIP"],
  ["^OUT\\d+$", "output contact"],
  ["^(52A\\w*|52B\\w*)$", "breaker status"],
  ["^79", "reclosing"],
  ["^LOP|^ILOP", "loss of potential"],
  ["^(SV|PSV|PLT|PCT|LT|LV|PCV)\\d+", "SELogic variable"],
];
const TRIP_NAMES = new Set(["TRIP", "TR", "TRIP1", "3PT", "TPA", "TPB", "TPC", "TRIP3", "TRP", "TPA1", "TRIPA"]);
const BREAKER_NAMES = ["52A", "52AA1", "52AB1", "52AC1", "52A1", "IN101"];

// Other makers' channel names (GE "PH TOC1 OP", ABB "ZM01-TRIP", IEC 61850 "PTOC1.Op", "Dist Z1 Trip"...):
// used only when no SEL rule matches. Protection functions first, so "DIST Z1 TRIP" is distance, not just TRIP.
const GENERIC_RULES = [
  ["BRE?A?KE?R\\s*FAIL|\\bBF\\b|RBRF|50BF", "breaker failure"],
  ["XCBR|\\bBKR\\b|BREAKER|\\bCB\\b|(^|[^0-9])52\\s*[AB]\\b", "breaker status"],
  ["RREC|RECLOS|(^|[^0-9])79([^0-9]|$)", "reclosing"],
  ["PDIF|DIFF|(^|[^0-9])87", "differential"],
  ["PDIS|DIST|\\bZ(ONE)?\\s*-?\\d|\\bZM\\d|(^|[^0-9])21([^0-9]|$)", "distance"],
  ["PSCH|POTT|\\bDCB\\b|\\bDTT\\b|TRANSFER|PERMISSIVE|CARRIER|\\bRX\\b|RECEIVE", "communications / transfer trip"],
  ["PTUF|PTOF|FREQ|\\bU?F\\s*<|(^|[^0-9])81", "frequency"],
  ["PTUV|UNDER\\s*VOLT|\\bU\\s*<|(^|[^0-9])27([^0-9]|$)", "undervoltage"],
  ["PTOV|OVER\\s*VOLT|\\bU\\s*>|(^|[^0-9])59([^0-9]|$)", "overvoltage"],
  ["PTOC|\\bTOC|I\\w*>\\s*(?!>)|(^|[^0-9])51", "time-overcurrent trip"],
  ["PIOC|\\bIOC|I\\w*>>|(^|[^0-9])50", "instantaneous overcurrent"],
  ["PTRC|TRIP|\\bTRP\\b|(^|[^0-9])86([^0-9]|$)", "TRIP"],
];
function elementClass(name) {
  const n = name.toUpperCase();
  for (const [pat, cls] of ELEMENT_RULES) if (pmatch(pat, n)) return cls;
  if (/[^A-Z0-9_]/.test(n) || /^(P|R|X)[A-Z]{3}\d/.test(n))
    for (const [pat, cls] of GENERIC_RULES) if (search(pat, n))
      return cls === "time-overcurrent trip" && /PKP|PICKUP|\bPU\b|START|\bSTR\b/.test(n) ? "time-overcurrent pickup" : cls;
  return "";
}

function interpretEventType(et) {
  et = strip((et || "")).toUpperCase();
  if (!et) return ["", false];
  let tripped = !!search("\\bT$|\\bTRIP\\b", et) || et.endsWith(" T");
  let core = strip(sub("\\s+T$", "", et), " *");
  core = sub("\\s+", "", core);
  let desc;
  if (has(FAULT_TYPES, core)) desc = FAULT_TYPES[core];
  else if (has(NON_FAULT_TYPES, core)) { desc = NON_FAULT_TYPES[core]; if (core === "TRIP") tripped = true; }
  else desc = "Event type '" + et + "'";
  return [desc, tripped];
}

function interpretTargets(t) {
  if (!t) return [];
  const found = [];
  for (const [pat, desc] of TARGET_WORDS)
    if (search(pat, t.toUpperCase()) && !found.includes(desc)) found.push(desc);
  return found;
}

function fmtLoc(loc, settings) {
  if (!loc) return "";
  if (loc.includes("$")) return loc + " (not calculated - relay could not determine distance)";
  const v = fnum(loc);
  const ll = settings ? fnum(settings.LL !== undefined ? settings.LL : "") : null;
  if (v !== null && v < 0) return loc + " (negative: fault was likely behind the relay)";
  if (v !== null && ll) return `${loc} line-length units (~${fx(100 * v / ll, 0)}% of LL=${settings.LL})`;
  return loc + " (in the relay's line-length units)";
}

// ---------------------------------------------------------------------------
// Event records
// ---------------------------------------------------------------------------
function newRec(source, kind) {
  return {
    source, kind: kind || "event", relay_id: "", terminal_id: "", fid: "", date: "", time: "",
    event_type: "", location: "", shot: "", freq: "", targets: "",
    currents: new Map(), voltages: new Map(), sequence: [], trip_cycle: null, open_cycle: null,
    settings: {}, ser_lines: [], extra: [], dup_of: null, trigger_cycle: null, prefault_short: false, notes: [], wave: null,
  };
}

// ---------------------------------------------------------------------------
// CEV
// ---------------------------------------------------------------------------
function csvLine(line) {
  const fields = []; let cur = "", inQ = false, atStart = true;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
      continue;
    }
    if (ch === ",") { fields.push(cur); cur = ""; atStart = true; continue; }
    if (ch === '"' && atStart) { inQ = true; atStart = false; continue; }
    cur += ch; atStart = false;
  }
  fields.push(cur);
  return fields;
}

function parseCev(text, source) {
  const rows = [];
  for (let line of splitlines(text)) {
    line = strip(line);
    if (!line) continue;
    const hasCk = !!search(',\\s*"[0-9A-Fa-f]{4}"\\s*$', line);
    let fields = csvLine(line).map((f) => strip(f));
    if (hasCk && fields.length > 1) fields = fields.slice(0, -1);
    rows.push(fields);
  }
  const rec = newRec(source);
  const kv = new Map();
  let tableHdr = null, table = [];
  let i = 0;
  while (i < rows.length) {
    const r = rows[i];
    if (r.length && r[0].toUpperCase() === "FID") {
      rec.fid = r.length > 1 ? r[1].split("FID=").join("") : "";
      i++; continue;
    }
    if (r.length >= 2 && !r.some(isNum)) {
      const block = []; let j = i + 1;
      while (j < rows.length && rows[j].length === r.length && rows[j].some(isNum)) { block.push(rows[j]); j++; }
      if (block.length === 1) r.forEach((k, idx) => kv.set(k.toUpperCase(), block[0][idx]));
      else if (block.length > table.length) { tableHdr = r; table = block; }
      i = block.length ? j : i + 1;
      continue;
    }
    i++;
  }
  const get = (k, d) => (kv.has(k) ? kv.get(k) : d);
  rec.event_type = get("EVENT", "");
  rec.location = get("LOCATION", get("LOC", ""));
  rec.shot = get("SHOT", get("SHOT_1P", ""));
  rec.freq = get("FREQ", "");
  rec.targets = get("TARGETS", "");
  try {  // same order as Python: a missing time field still leaves the date set
    const need = (k) => { if (!kv.has(k)) throw new Error("missing " + k); return kv.get(k); };
    const y = pyInt(need("YEAR")), mo = pyInt(need("MONTH")), d = pyInt(need("DAY"));
    rec.date = `${pad2(mo)}/${pad2(d)}/${y}`;
    rec.time = `${pad2(pyInt(need("HOUR")))}:${pad2(pyInt(need("MIN")))}:${pad2(pyInt(need("SEC")))}.` +
               String(pyInt(get("MSEC", 0))).padStart(3, "0");
  } catch (e) { /* date/time not available */ }
  rec.settings = extractSettings(text);
  rec.relay_id = rec.settings.RID || "";
  rec.terminal_id = rec.settings.TID || "";
  if (tableHdr && table.length) analyzeTable(rec, tableHdr, table, fnum(kv.get("SAM/CYC_A"), 4) || 4);
  return [rec];
}

function hexBits(h) { let b = ""; for (const ch of h) b += parseInt(ch, 16).toString(2).padStart(4, "0"); return b; }

function analyzeTable(rec, hdr, table, sam) {
  sam = sam && sam > 0 ? Math.trunc(sam) : 4;
  const lag = Math.max(1, pyRound(sam / 4));
  let trig = table.findIndex((row) => row.includes(">"));
  if (trig < 0) trig = null;
  const startFault = trig !== null ? trig : 0;
  rec.trigger_cycle = trig !== null ? startFault / sam : null;
  rec.prefault_short = trig !== null && trig < sam + lag;
  const analog = [];

  hdr.forEach((name, c) => {
    const n = strip(name.toUpperCase().split("(")[0]);
    if (name.includes(" ") || !n) return;
    const vals = table.map((row) => fnum(row[c]));
    if (vals.some((v) => v === null)) return;
    const mags = [];
    for (let k = lag; k < vals.length; k++) mags.push(Math.hypot(vals[k], vals[k - lag]) / Math.sqrt(2));
    if (!mags.length) return;
    const preEnd = trig !== null ? Math.max(sam, startFault - lag) : sam;
    let preWin = mags.slice(Math.max(0, preEnd - sam), preEnd);
    if (!preWin.length) preWin = mags.slice(0, sam);
    const pre = preWin.reduce((a, b) => a + b, 0) / preWin.length;
    analog.push([name, n, pre, mags, vals]);
  });

  const firstOn = new Map(), preOn = new Set(), digital = new Map();
  hdr.forEach((name, c) => {
    if (!strip(name).includes(" ")) return;
    const names = splitWS(name);
    table.forEach((row, k) => {
      const h = c < row.length ? strip(row[c]) : "";
      if (!h || !/^[0-9A-Fa-f]+$/.test(h)) return;
      const bits = hexBits(h);
      for (let b = 0; b < Math.min(bits.length, names.length); b++) {
        const el = names[b];
        if (el !== "*") {
          if (!digital.has(el)) digital.set(el, new Uint8Array(table.length));
          digital.get(el)[k] = bits[b] === "1" ? 1 : 0;
        }
        if (el === "*" || bits[b] !== "1") continue;
        if (k === 0) preOn.add(el);
        else if (!firstOn.has(el) && !preOn.has(el)) firstOn.set(el, k);
      }
    });
    table.forEach((row, k) => {
      const h = c < row.length ? strip(row[c]) : "";
      if (!/^[0-9A-Fa-f]+$/.test(h || "-")) return;
      const bits = hexBits(h), state = new Map();
      for (let b = 0; b < Math.min(bits.length, names.length); b++) state.set(names[b], bits[b]);
      for (const bn of BREAKER_NAMES.slice(0, 5))
        if (preOn.has(bn) && state.get(bn) === "0" && rec.open_cycle === null) rec.open_cycle = k / sam;
    });
  });

  const end = rec.open_cycle !== null ? Math.trunc(rec.open_cycle * sam) : table.length;
  const waveChannels = [];
  for (const [name, n, pre, mags, vals] of analog) {
    let win = mags.slice(Math.max(0, startFault - lag), Math.max(startFault - lag + 1, end - lag));
    if (!win.length) win = mags;
    if (pmatch("^(I[ABCNGRSPQ]|IA|IB|IC|IN|IG|3I0|3I2|I1|I2|IP)\\w*$", n)) {
      rec.currents.set(name, [pre, Math.max(...win)]);
      waveChannels.push({ name, kind: "I", values: vals });
    } else if (pmatch("^V(A|B|C|AB|BC|CA|S|P|1|2)\\w*$", n)) {
      rec.voltages.set(name, [pre, Math.min(...win)]);
      waveChannels.push({ name, kind: "V", values: vals });
    }
  }

  const ordered = [...firstOn.entries()].map((e, idx) => [e[0], e[1], idx])
    .sort((a, b) => a[1] - b[1] || a[2] - b[2]);
  for (const [el, k] of ordered) rec.sequence.push([k / sam, el, "asserted"]);
  for (const el of [...preOn].sort())
    if (elementClass(el) && !["breaker status", "SELogic variable"].includes(elementClass(el)))
      rec.sequence.push([0.0, el, "pre"]);
  const trips = [...firstOn.entries()].filter(([el]) => TRIP_NAMES.has(el.toUpperCase())).map(([, k]) => k);
  if (trips.length) rec.trip_cycle = Math.min(...trips) / sam;
  // raw samples for the waveform chart
  rec.wave = waveChannels.length ? {
    sam, trigger: trig, trip: trips.length ? Math.min(...trips) : null,
    open: rec.open_cycle !== null ? Math.round(rec.open_cycle * sam) : null, channels: waveChannels,
    digitals: [...digital].map(([name, values]) => ({ name, values })),
  } : null;
}

// ---------------------------------------------------------------------------
// Text reports (EVE / SUM / HIS / SER / HDR / TXT)
// ---------------------------------------------------------------------------
const EVENT_LINE_RE = "^\\s*Event\\s*(?:Type)?\\s*:\\s*(.+?)(?:\\s{2,}|$)";
function grab(pat, text, flags) {
  const m = search(pat, text, flags === undefined ? "im" : flags);
  return m ? strip(m[1]) : "";
}

function parseText(text, source) {
  if (text.includes('"FID"') || search('^"MONTH","DAY"', text, "m")) return parseCev(text, source);
  const recs = [];
  const settings = extractSettings(text);
  if (search("\\bEVENT\\b.*\\bLOCAT", text, "i")) recs.push(...parseHis(text, source, settings));

  const ser = finditer("^\\s*\\d*\\s*(\\d{1,2}/\\d{1,2}/\\d{2,4})\\s+(\\d{1,2}:\\d{2}:\\d{2}(?:\\.\\d+)?)\\s+(\\S+)\\s+(Asserted|Deasserted)\\b", text, "im");
  if (ser.length) {
    const r = newRec(source, "ser");
    r.ser_lines = ser.map((m) => `${m[1]} ${m[2]}  ${m[3].padEnd(12)} ${m[4]}`);
    recs.push(r);
  }

  const matches = finditer(EVENT_LINE_RE, text, "im");
  const HEADER = "^[ \\t]*(\\S.*?)\\s{2,}Date\\s*:\\s*(\\S+)\\s+Time\\s*:\\s*(\\S+)[^\\n]*\\n((?:[ \\t]*\\n)*)([^\\n]*)";
  matches.forEach((m, idx) => {
    const prevEnd = idx ? matches[idx - 1].index + matches[idx - 1][0].length : 0;
    const end = idx + 1 < matches.length ? matches[idx + 1].index : text.length;
    const back = text.slice(prevEnd, m.index);
    const chunk = text.slice(m.index, end);
    const r = newRec(source);
    let heads = finditer(HEADER, back, "m");
    if (!heads.length) heads = finditer(HEADER, chunk, "m");
    if (heads.length) {
      const h = heads[heads.length - 1];
      r.date = h[2]; r.time = h[3];
      if (!settings.RID) {
        r.relay_id = strip(h[1]);
        const second = strip(h[5]);
        if (second && !pmatch("^(Event|FID|#|=>|\\[)", second, "i")) r.terminal_id = strip(resplit("\\s{2,}", second)[0]);
      }
    }
    r.event_type = strip(resplit("\\s{2,}|Location|Shot|Freq", m[1], "i")[0]);
    r.location = grab("(?:Fault\\s+)?Location\\s*:\\s*([-$\\d.]+)", chunk);
    r.shot = grab("Shot\\s*:\\s*(\\S+)", chunk);
    r.freq = grab("Freq(?:uency)?\\s*:\\s*([\\d.]+)", chunk);
    r.targets = grab("Targets?\\s*:\\s*(.+)$", chunk);
    if (!r.date) {
      r.date = grab("Date\\s*:\\s*(\\S+)", chunk);
      r.time = grab("\\bTime\\s*:\\s*(\\d\\S*)", chunk);
    }
    if (settings.RID) { r.relay_id = settings.RID || ""; r.terminal_id = settings.TID || ""; }
    r.fid = grab("FID\\s*=\\s*(\\S+)", back) || grab("FID\\s*=\\s*(\\S+)", chunk);
    for (const lbl of ["Trip Time", "Event Time", "Breaker\\s*\\d*\\s*\\w*", "Fault Type", "Group", "Recloser"]) {
      const v = grab("^\\s*(" + lbl + "\\s*:.+)$", chunk);
      if (v) r.extra.push(sub("\\s+", " ", v));
    }
    const cur = search("Currents?\\s*\\(([^)]*)\\)\\s*,?\\s*([A-Z]+)\\s*:\\s*([-\\d.\\s]+)", chunk, "i");
    if (cur) {
      const labels = cur[2], nums = splitWS(cur[3]);
      for (let k = 0; k < Math.min(labels.length, nums.length); k++) {
        const fv = fnum(nums[k]);
        if (fv !== null) r.currents.set(labels[k].toUpperCase() === "Q" ? "3I2" : "I" + labels[k].toUpperCase(), [null, fv]);
      }
    }
    r.settings = settings;
    recs.push(r);
  });
  return recs;
}

function parseHis(text, source, settings) {
  const recs = [];
  const head = pmatch("\\s*(.+?)\\s{2,}Date\\s*:", text);
  const rid = settings.RID || (head ? strip(head[1]) : "");
  for (const line of splitlines(text)) {
    const m = pmatch("^\\s*(\\d+)\\s+(\\d{1,2}/\\d{1,2}/\\d{2,4})\\s+(\\d{1,2}:\\d{2}:\\d{2}(?:\\.\\d+)?)\\s+(.*)$", line);
    if (!m) continue;
    const toks = splitWS(m[4]);
    const et = [];
    while (toks.length && !(isNum(toks[0]) || toks[0].includes("$"))) et.push(toks.shift());
    const r = newRec(source, "history");
    r.date = m[2]; r.time = m[3]; r.event_type = et.join(" ");
    const nums = [];
    while (toks.length && (isNum(toks[0]) || toks[0].includes("$"))) nums.push(toks.shift());
    if (nums.length) r.location = nums[0];
    if (nums.length > 1) r.currents.set("Fault current", [null, fnum(nums[1], 0)]);
    if (nums.length > 2) r.freq = nums[2];
    if (nums.length > 4) r.shot = nums[4];
    r.targets = toks.join(" ");
    r.settings = settings;
    r.relay_id = rid;
    recs.push(r);
  }
  return recs;
}

// ---------------------------------------------------------------------------
// RDB: OLE compound file / zip / raw scan
// ---------------------------------------------------------------------------
function readOle(buf) {
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (buf.length < 512 || sig.some((b, i) => buf[i] !== b)) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u16 = (o) => dv.getUint16(o, true), u32 = (o) => dv.getUint32(o, true);
  const ss = 1 << u16(0x1e), mss = 1 << u16(0x20);
  const nFat = u32(0x2c), dirStart = u32(0x30), cutoff = u32(0x38);
  const miniFatStart = u32(0x3c), difStart = u32(0x44), nDif = u32(0x48);
  const END = 0xfffffffe, FREE = 0xffffffff;
  const secOff = (sid) => (sid + 1) * ss;
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) { const s = u32(0x4c + i * 4); if (s !== FREE) fatSecs.push(s); }
  let dif = difStart;
  for (let n = 0; n < nDif && dif < END && fatSecs.length < nFat; n++) {
    const o = secOff(dif);
    for (let i = 0; i < ss / 4 - 1 && fatSecs.length < nFat; i++) fatSecs.push(u32(o + i * 4));
    dif = u32(o + ss - 4);
  }
  const fat = [];
  for (const s of fatSecs) { const o = secOff(s); for (let i = 0; i < ss / 4; i++) fat.push(o + i * 4 + 4 <= buf.length ? u32(o + i * 4) : FREE); }
  const chain = (start, table) => {
    const out = [], seen = new Set();
    for (let s = start; s < END && s < table.length && !seen.has(s); s = table[s]) { seen.add(s); out.push(s); }
    return out;
  };
  const readChain = (start) => {
    const parts = chain(start, fat).map((s) => buf.subarray(secOff(s), Math.min(secOff(s) + ss, buf.length)));
    const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const dir = readChain(dirStart), entries = [];
  const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nl = ddv.getUint16(o + 0x40, true);
    const name = new TextDecoder("utf-16le").decode(dir.subarray(o, o + Math.max(0, Math.min(64, nl) - 2)));
    entries.push({ name, type: dir[o + 0x42], left: ddv.getUint32(o + 0x44, true), right: ddv.getUint32(o + 0x48, true),
                   child: ddv.getUint32(o + 0x4c, true), start: ddv.getUint32(o + 0x74, true), size: ddv.getUint32(o + 0x78, true) });
  }
  if (!entries.length) return null;
  const rootE = entries[0];
  const miniStream = readChain(rootE.start).subarray(0, rootE.size);
  const miniFatBytes = miniFatStart < END ? readChain(miniFatStart) : new Uint8Array(0);
  const mdv = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
  const miniFat = []; for (let o = 0; o + 4 <= miniFatBytes.length; o += 4) miniFat.push(mdv.getUint32(o, true));
  const readStream = (e) => {
    if (e.size < cutoff) {
      const parts = chain(e.start, miniFat).map((s) => miniStream.subarray(s * mss, s * mss + mss));
      const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
      let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
      return out.subarray(0, e.size);
    }
    return readChain(e.start).subarray(0, e.size);
  };
  const kidsOf = (sid) => {
    const out = [], seen = new Set();
    const walk = (s) => {
      if (s === FREE || s >= entries.length || seen.has(s)) return;
      seen.add(s); walk(entries[s].left); out.push(s); walk(entries[s].right);
    };
    walk(sid);
    return out.sort((a, b) => (entries[a].name < entries[b].name ? -1 : entries[a].name > entries[b].name ? 1 : 0));
  };
  const files = [];
  const list = (sid, prefix) => {
    for (const k of kidsOf(entries[sid].child)) {
      const e = entries[k];
      if (e.type === 1) list(k, prefix.concat(e.name));
      else if (e.type === 2) files.push([prefix.concat(e.name).join("/"), e]);
    }
  };
  list(0, []);
  return files.map(([name, e]) => { try { return [name, readStream(e)]; } catch (x) { return null; } }).filter(Boolean);
}

async function readZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let o = buf.length - 22; o >= Math.max(0, buf.length - 65557); o--)
    if (dv.getUint32(o, true) === 0x06054b50) { eocd = o; break; }
  if (eocd < 0) return null;
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    try {
      const ds = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const raw = buf.subarray(ds, ds + csize);
      let data;
      if (method === 0) data = raw;
      else if (method === 8 && typeof DecompressionStream !== "undefined") {
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        data = new Uint8Array(await new Response(stream).arrayBuffer());
      } else continue;
      out.push([name, data]);
    } catch (e) { /* skip unreadable member */ }
  }
  return out;
}

async function parseRdb(bytes, fileName) {
  let texts = [];
  let ole = null;
  try { ole = readOle(bytes); } catch (e) { ole = null; }
  if (ole) texts = ole.map(([n, d]) => [n, decodeBlob(d)]);
  if (!texts.length) {
    const z = await readZip(bytes).catch(() => null);
    if (z) texts = z.map(([n, d]) => [n, decodeBlob(d)]);
  }
  let method = texts.length ? (ole && ole.length ? "ole" : "zip") : null;
  if (!texts.length) { texts.push(["raw", decodeBlob(bytes)]); method = "scan"; }

  const combined = {}, perRelay = new Map();
  for (const [name, t] of texts) {
    const s = extractSettings(t);
    if (!Object.keys(s).length) continue;
    const top = name.split("/")[0];
    if (!perRelay.has(top)) perRelay.set(top, {});
    const tgt = perRelay.get(top);
    for (const [k, v] of Object.entries(s)) if (!(k in tgt)) tgt[k] = v;
    for (const [k, v] of Object.entries(s)) if (!(k in combined)) combined[k] = v;
  }
  const out = new Map();
  if (perRelay.size <= 1) {
    if (!Object.keys(combined).length) return out;
    combined.__method__ = method;
    out.set(combined.RID || fileName, combined);
    return out;
  }
  for (const [top, s] of perRelay) { s.__method__ = method; out.set(s.RID || top, s); }
  return out;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------
const EVENT_EXTS = [".cev", ".eve", ".txt", ".sum", ".his", ".ser", ".hdr", ".log", ".chi"];
const SETTINGS_EXTS = [".rdb"];
const SETTINGS_TEXT_EXTS = [".set"];                // settings saved as text (SHO command output); .txt works too
const ARCHIVE_EXTS = [".zip"];
const COMTRADE_EXTS = [".cfg", ".dat", ".cff"];   // waveform records, read by analysis.js
const ALL_EXTS = EVENT_EXTS.concat(SETTINGS_EXTS, SETTINGS_TEXT_EXTS, COMTRADE_EXTS, ARCHIVE_EXTS);

/** Files inside a .zip (stored or deflated), sorted by path; folders and Mac metadata skipped. */
async function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("damaged zip file");
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen)).replace(/\\/g, "/");
    p += 46 + nlen + xlen + clen;
    if (name.endsWith("/") || name.startsWith("__MACOSX/") || /(^|\/)\./.test(name)) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + csize);
    let content;
    if (method === 0) content = data.slice();
    else if (method === 8) {
      if (typeof DecompressionStream === "undefined") throw new Error("this browser can't open compressed zip files; unzip it first");
      const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      content = new Uint8Array(await new Response(ds).arrayBuffer());
    } else throw new Error(`${name}: unsupported zip compression`);
    out.push({ name: name.split("/").pop(), path: name, bytes: content });
  }
  return out.sort((a, b) => cmp(a.path, b.path));
}

/** Settings from a text file (SHO output, QuickSet text export) when it holds no event. */
function settingsFromText(text, name) {
  const s = extractSettings(text);
  const keys = Object.keys(s);
  if (!(s.RID || s.TID) || keys.length < 3) return null;
  return [String(s.RID || s.TID || name), Object.assign(s, { __method__: "text", __file__: name })];
}
const extOf = (name) => { const m = /(\.[^.\\/]*)$/.exec(name); return m ? m[1].toLowerCase() : ""; };

/** analysis.js registers how to turn COMTRADE records into events (any relay maker). */
let comtradeReader = null;
function useComtradeReader(fn) { comtradeReader = fn; }

/** files: [{name, bytes: Uint8Array}] in load order. */
async function loadFiles(files) {
  const events = [], rdb = new Map(), errors = [], comtrade = [];
  const queue = files.slice();
  while (queue.length) {
    const f = queue.shift();
    const ext = extOf(f.name);
    try {
      if (ARCHIVE_EXTS.includes(ext)) {
        const inner = (await unzip(f.bytes)).filter((x) => ALL_EXTS.includes(extOf(x.name)) && !x.name.toUpperCase().startsWith("README"));
        if (!inner.length) errors.push(`${f.name}: no SEL or COMTRADE files inside`);
        queue.unshift(...inner);
      } else if (COMTRADE_EXTS.includes(ext)) comtrade.push(f);
      else if (SETTINGS_EXTS.includes(ext)) for (const [k, v] of await parseRdb(f.bytes, f.name)) rdb.set(k, v);
      else if (ext === ".cev") events.push(...parseCev(readText(f.bytes), f.name));
      else {
        const text = readText(f.bytes);
        let evs = [], err = null;
        if (!SETTINGS_TEXT_EXTS.includes(ext)) { try { evs = parseText(text, f.name); } catch (e) { err = e; } }
        if (evs.length) { events.push(...evs); continue; }
        const st = settingsFromText(text, f.name);
        if (st) rdb.set(st[0], st[1]);
        else if (err) throw err;
        else throw new Error("no event data or settings recognized");
      }
    } catch (e) {
      errors.push(`${f.name}: ${e && e.message ? e.message : e}`);
    }
  }
  if (!comtradeReader && typeof require === "function") { try { require("./analysis.js"); } catch (e) { /* page loads it itself */ } }
  if (comtradeReader && comtrade.length) {
    // a COMTRADE record that matches an SEL report already loaded (same relay, within 2 s) adds nothing new
    const sel = events.filter((e) => e.kind === "event").map((e) => [relayKey(e).toUpperCase(), eventDatetime(e)]);
    const r = comtradeReader(comtrade);
    for (const e of r.events) {
      const k = relayKey(e).toUpperCase(), dt = eventDatetime(e);
      if (dt !== null && sel.some(([sk, sdt]) => sk === k && sdt !== null && Math.abs(sdt - dt) <= 2e6)) continue;
      events.push(e);
    }
    errors.push(...r.errors);
  }
  return { events, rdb, errors, comtrade };
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------
function matchSettings(rec, rdb) {
  if (!rdb.size) return [{}, "", "none"];
  const rid = strip(rec.relay_id || "").toUpperCase();
  for (const [label, s] of rdb)
    if (rid && (rid === strip(String(label)).toUpperCase() || rid === strip(String(s.RID || "")).toUpperCase()))
      return [s, label, "rid"];
  if (!rid && rdb.size === 1) { const label = rdb.keys().next().value; return [rdb.get(label), label, "assumed"]; }
  return [{}, "", "mismatch"];
}

const eventCore = (et) => strip(sub("\\s+T$", "", strip(et || "").toUpperCase()), " *").split(" ").join("");
function eventPhases(et) { const core = eventCore(et); return has(FAULT_TYPES, core) ? new Set(core) : null; }
function targetPhases(targets) {
  const toks = new Set(splitWS((targets || "").toUpperCase()));
  const ph = new Set([..."ABC"].filter((p) => toks.has(p)));
  if (toks.has("G") || toks.has("N")) ph.add("G");
  return ph;
}
function phaseCurrents(rec) {
  const ph = new Map(), grounds = new Map();
  for (const [name, val] of rec.currents) {
    const n = strip(name.toUpperCase().split("(")[0]);
    const m = pmatch("^I([ABC])(?:W\\d+|_PRI|_SEC)?$", n);
    if (m) ph.set(m[1], val);
    else { const gm = pmatch("^(IG|3I0|IN)", n); if (gm && !grounds.has(gm[1])) grounds.set(gm[1], val); }
  }
  const gnd = grounds.get("IG") || grounds.get("3I0") || grounds.get("IN") || null;
  return [ph, gnd];
}
function equationHits(equation, elements) {
  const eq = sub("(\\bNOT\\s+|!)\\(?\\s*[A-Z0-9_]+", " ", equation.toUpperCase());
  const tokens = new Set(finditer("[A-Z0-9_]+", eq).map((m) => m[0]));
  return uniq(elements.filter((el) => tokens.has(el.toUpperCase())));
}

const NON_PROTECTION = ["", "TRIP", "output contact", "breaker status", "SELogic variable", "reclosing"];
const TRIP_EQUATIONS = [["TR", "trip equation"], ["TRCOMM", "communications-assisted trip equation"],
  ["TRSOTF", "switch-onto-fault trip equation"], ["DTT", "direct transfer trip equation"]];
const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

function analyzeEvent(rec, settings, how, label) {
  how = how || "none"; label = label || "";
  const [desc, trippedByType] = interpretEventType(rec.event_type);
  const core = eventCore(rec.event_type);
  const isFault = has(FAULT_TYPES, core);
  const tc = rec.trip_cycle;
  const tripped = trippedByType || tc !== null;
  const tdesc = interpretTargets(rec.targets);
  const cause = [], checks = [], gaps = [];

  const asserted = rec.sequence.filter((x) => x[2] === "asserted").map((x) => [x[0], x[1]]);
  const before = asserted.filter(([c]) => tc === null || c <= tc + 0.01);
  const prot = before.map(([c, el]) => [c, el, elementClass(el)]).filter((x) => !NON_PROTECTION.includes(x[2]));
  const initiators = prot.filter((x) => tc !== null && tc - x[0] <= 0.5);
  const pickups = prot.filter((x) => !initiators.includes(x));

  const eqHits = new Map();
  for (const [key] of TRIP_EQUATIONS)
    if (settings[key]) { const hits = equationHits(settings[key], before.map((x) => x[1])); if (hits.length) eqHits.set(key, hits); }

  if (tripped) cause.push(`Relay TRIPPED. ${desc || "Event"}.`);
  else cause.push(desc ? `No trip recorded. ${desc}.` : "No trip recorded for this event.");
  if (tdesc.length) cause.push("Front-panel targets indicate: " + tdesc.join(", ") + `  [${strip(rec.targets)}]`);

  let primary = [];
  if (eqHits.has("TR")) {
    primary = eqHits.get("TR");
    cause.push("Trip equation (TR) elements that asserted before the trip: " + primary.join(", ") + " -> these caused the trip.");
  }
  const commBits = before.map((x) => x[1]).filter((el) => elementClass(el) === "communications / transfer trip");
  for (const [key, what] of TRIP_EQUATIONS.slice(1)) {
    if (!eqHits.has(key)) continue;
    primary = primary.length ? primary : eqHits.get(key);
    let line = `Elements in the ${what} (${key}) asserted before the trip: ` + eqHits.get(key).join(", ");
    if (key === "TRCOMM" && commBits.length) {
      line += `, with ${commBits.join(", ")} from the communications scheme -> communications-assisted trip (e.g. POTT/DCUB)`;
      primary = primary.concat(commBits.filter((b) => !primary.includes(b) && b !== "KEY"));
    }
    cause.push(line + ".");
  }
  if (!primary.length && initiators.length) {
    primary = initiators.map((x) => x[1]);
    cause.push("Element(s) that asserted with the trip: " +
      initiators.map(([c, el, cls]) => `${el} (${cls}, ${fx(c, 2)} cyc)`).join(", ") + " -> most likely tripping element(s).");
  }
  if (pickups.length)
    cause.push("Earlier pickups before the trip: " + pickups.slice(0, 10).map(([c, el, cls]) => `${el} (${cls}, ${fx(c, 2)} cyc)`).join(", "));

  const classes = new Set(initiators.map((x) => x[2]).concat(primary.map(elementClass)));
  if (tripped && !isFault) {
    if (classes.has("communications / transfer trip") || classes.has("contact input"))
      cause.push("No fault type was identified and a communications/input bit asserted with the trip: " +
                 "most likely a direct/remote transfer trip or an external trip input, not a local fault.");
    else if (classes.has("frequency"))
      cause.push("Frequency element tripped: likely underfrequency load shedding or a system disturbance.");
    else if (classes.has("undervoltage") || classes.has("overvoltage"))
      cause.push("Voltage element tripped: check system voltage conditions or loss of source.");
    else if (classes.has("breaker failure"))
      cause.push("Breaker-failure logic operated: a breaker failed to clear a fault.");
    else if (classes.has("out-of-step"))
      cause.push("Out-of-step logic operated: power swing / loss of synchronism.");
    else if (splitWS((rec.targets || "").toUpperCase()).includes("COMM"))
      cause.push("COMM target with no fault type: most likely a transfer trip received from the remote end.");
    else if (search("\\b81\\b", rec.targets || ""))
      cause.push("Frequency (81) target: likely underfrequency load shedding or a system disturbance.");
  }

  if (tc !== null && rec.open_cycle !== null && rec.open_cycle > tc)
    cause.push(`Breaker opened ~${fx(rec.open_cycle - tc, 2)} cycles after trip (trip at ${fx(tc, 2)} cyc, ${rec.waveRef ? "breaker status changed" : "52A dropped"} at ${fx(rec.open_cycle, 2)} cyc).`);
  if (rec.shot && rec.shot !== "0") cause.push(`Reclose shot counter = ${rec.shot} (event occurred during a reclose sequence).`);
  cause.push(...rec.notes);

  if (rec.kind === "history" && tripped && !rec.dup_of)
    gaps.push("History row only, so the cause is read from the targets. Load this event's .CEV report to confirm which element tripped.");
  else if (rec.kind !== "history" && !rec.sequence.length && tripped)
    gaps.push("No relay element data in this file, so the tripping element is inferred from the front-panel targets. " +
              "Load the .CEV report for this event to confirm.");
  if (tripped && !settings.TR && rec.waveRef) {
    gaps.push("Read from a COMTRADE record: the tripping element is taken from its digital channels, with no relay settings or fault location. " +
              "Confirm against the relay's own event report.");
  } else if (tripped && !settings.TR) {
    if (how === "mismatch")
      gaps.push(`Settings files are loaded, but none match relay '${rec.relay_id}', so no settings were applied. Add this relay's .RDB.`);
    else
      gaps.push("No settings for this relay, so the trip equation (TR) and line length couldn't be checked. " +
                "Add the relay's .RDB (or use a CEV that includes settings).");
  }
  if (settings.__method__ === "scan")
    gaps.push("Settings were read with a best-effort scan of the .RDB file; some values may be missing.");

  if (how === "assumed")
    checks.push(`This event has no relay ID, so settings from the only loaded RDB (${label}) were assumed to apply. Confirm it's the same relay.`);
  if (rec.event_type && !has(FAULT_TYPES, core) && !has(NON_FAULT_TYPES, core))
    checks.push(`Event type '${rec.event_type}' isn't a code this tool recognizes; interpret it manually.`);
  if (core === "TRIP")
    checks.push("The relay tripped without identifying a fault type. Confirm whether this was a transfer trip, " +
                "a manual/SCADA open, or an external trip input.");

  const ep = eventPhases(rec.event_type), tp = targetPhases(rec.targets);
  if (ep && ep.size && tp.size) {
    const eAbc = new Set([...ep].filter((x) => x !== "G")), tAbc = new Set([...tp].filter((x) => x !== "G"));
    if (tAbc.size && !setEq(eAbc, tAbc))
      checks.push(`Targets show phase(s) ${[...tAbc].sort().join("")} but the event type says ${[...eAbc].sort().join("")}.`);
    if (tAbc.size && ep.has("G") !== tp.has("G"))
      checks.push("Targets and event type disagree on whether ground was involved.");
  }

  const [ph, gnd] = phaseCurrents(rec);
  if (ep && ep.size && ph.size >= 2) {
    let top = null;
    for (const [k, v] of ph) if (top === null || v[1] > ph.get(top)[1]) top = k;
    const [topPre, topFault] = ph.get(top);
    const eAbc = new Set([...ep].filter((x) => x !== "G"));
    const first = splitWS(rec.event_type)[0];
    if (!eAbc.has(top))
      checks.push(`Highest fault current is on phase ${top} (${fc(topFault, 0)} A), but the event type says ${first}.`);
    if (topPre && topFault < 1.5 * topPre)
      checks.push(`Fault current barely rose above load (${fc(topFault, 0)} A vs ${fc(topPre, 0)} A prefault). ` +
                  "Could be a high-impedance fault, a weak source, or a misclassified event.");
    if (gnd !== null && topFault > 0) {
      const gv = gnd[1];
      if (ep.has("G") && gv < 0.1 * topFault)
        checks.push(`Ground fault reported, but ground current (${fc(gv, 0)} A) is small next to phase current (${fc(topFault, 0)} A).`);
      if (!ep.has("G") && gv > 0.3 * topFault)
        checks.push(`Significant ground current (${fc(gv, 0)} A) for a fault classified without ground (${first}).`);
    }
  }

  const loc = strip(rec.location || "");
  const v = fnum(loc);
  const ll = fnum(settings.LL !== undefined ? settings.LL : "");
  if (isFault) {
    if (!loc) gaps.push("No fault location in this file.");
    else if (loc.includes("$"))
      checks.push("The relay couldn't calculate a fault location ($$$$$). This usually means too little fault data or a very fast clearing.");
  }
  if (v !== null && isFault) {
    if (v < 0)
      checks.push(`Negative fault location (${loc}) usually means the fault was behind the relay (reverse direction). ` +
                  "Check the directional elements and CT polarity.");
    else if (ll) {
      const pct = 100 * v / ll;
      if (v > ll * 1.02)
        checks.push(`Fault location ${loc} is beyond the end of the line (LL = ${settings.LL}). Possible fault on the adjacent section, or a location error.`);
      const zone1 = tdesc.includes("Zone 1 distance") || primary.some((el) => pmatch("^(Z|M)1", el));
      if (zone1 && pct > 90)
        checks.push(`Zone 1 operated for a fault at ~${fx(pct, 0)}% of the line, beyond typical Zone 1 reach (80-90%). ` +
                    "Check for overreach or a location error.");
    } else if (settings.TR || !tripped)
      gaps.push("Line length (LL) isn't known, so the fault location can't be checked against the line. Load the relay's .RDB.");
  }

  const f = fnum(rec.freq);
  if (f) {
    const nominal = Math.abs(f - 50) < Math.abs(f - 60) ? 50.0 : 60.0;
    if (Math.abs(f - nominal) > 0.5) checks.push(`Frequency was ${fx(f, 2)} Hz, well off nominal ${fx(nominal, 0)} Hz.`);
  }

  if (rec.sequence.length) {
    if (trippedByType && tc === null) checks.push("The event type shows a trip (T), but no TRIP bit asserted in this record.");
    if (tc !== null && rec.event_type && !trippedByType) checks.push("TRIP asserted in the record, but the event type doesn't show a trip.");
    if (tripped && settings.TR && !eqHits.size)
      checks.push("No element from the trip equations asserted before the trip. It may have come from a manual/SCADA command, " +
                  "another logic path, or an element not in this record.");
    if (tripped && !prot.length && !eqHits.size) checks.push("No protection element asserted before the trip in this record.");
    if (tc !== null) {
      if (rec.open_cycle === null)
        checks.push("No breaker-open indication in the record. Confirm the breaker opened (the record may end too soon, or 52A isn't in this report).");
      else if (rec.open_cycle < tc)
        checks.push("Breaker status dropped before the trip asserted. The breaker may have been opened by another relay or manually.");
      else if (rec.open_cycle - tc > 5)
        checks.push(`Breaker took ${fx(rec.open_cycle - tc, 1)} cycles to open after the trip (typical is 2-5). Check the breaker and trip circuit.`);
    }
    if (rec.prefault_short) checks.push("The record triggered very early, so 'prefault' values may include fault data.");
  }

  // what each conclusion rests on, with the sample to look at in the record (for "Show on graph")
  const sam = rec.wave ? rec.wave.sam : rec.waveRef ? rec.waveRef.sam : null;
  const at = (c) => (sam && c !== null && c !== undefined ? Math.round(c * sam) : null);
  const firstAt = (el) => { const hit = asserted.find((x) => x[1] === el); return hit ? hit[0] : null; };
  const evidence = [];
  if (rec.event_type && rec.waveRef) evidence.push({ text: `The waveforms show a ${desc ? desc.charAt(0).toLowerCase() + desc.slice(1) : strip(rec.event_type)}`, idx: rec.trigger_cycle !== null ? at(rec.trigger_cycle) : null, elements: [] });
  else if (rec.event_type) evidence.push({ text: `The relay recorded event type ${strip(rec.event_type)}` + (desc ? ` (${desc})` : ""), idx: null, elements: [] });
  if (tdesc.length) evidence.push({ text: `Front-panel targets ${strip(rec.targets)}: ${tdesc.join(", ")}`, idx: null, elements: [] });
  for (const [key, hits] of eqHits) {
    const c = Math.min(...hits.map(firstAt).filter((x) => x !== null));
    evidence.push({ text: `${key} = ${strip(settings[key])}: ${hits.join(", ")} asserted before the trip`, idx: Number.isFinite(c) ? at(c) : null, elements: hits.slice() });
  }
  const inEq = new Set([...eqHits.values()].flat());
  for (const el of primary) {
    const c = firstAt(el);
    if (inEq.has(el)) continue;
    if (c !== null) evidence.push({ text: `${el} (${elementClass(el) || "relay element"}) asserted at ${fx(c, 2)} cyc`, idx: at(c), elements: [el] });
  }
  if (tc !== null) {
    const trips = asserted.filter((x) => (TRIP_NAMES.has(x[1].toUpperCase()) || elementClass(x[1]) === "TRIP") && Math.abs(x[0] - tc) < 1e-9).map((x) => x[1]);
    evidence.push({ text: `TRIP asserted at ${fx(tc, 2)} cyc`, idx: at(tc), elements: trips });
  }
  if (rec.open_cycle !== null) {
    const bk = BREAKER_NAMES.filter((b) => rec.wave && rec.wave.digitals.some((d) => d.name === b));
    if (rec.waveRef && rec.waveRef.breaker) bk.unshift(rec.waveRef.breaker);
    evidence.push({ text: `Breaker status (${bk[0] || "52A"}) ${rec.waveRef ? "changed" : "dropped"} at ${fx(rec.open_cycle, 2)} cyc` +
                    (tc !== null && rec.open_cycle > tc ? `: cleared ${fx(rec.open_cycle - tc, 2)} cyc after the trip` : ""), idx: at(rec.open_cycle), elements: bk.slice(0, 1) });
  }
  if (loc && v !== null) evidence.push({ text: `Fault location ${loc}` + (ll ? ` on a ${settings.LL} line (${fx(100 * v / ll, 0)}%)` : ""), idx: null, elements: [] });
  if (settings.TR && !eqHits.size && tripped && rec.sequence.length) evidence.push({ text: `TR = ${strip(settings.TR)}: none of these asserted before the trip`, idx: null, elements: [] });

  let level;
  if (rec.kind === "history") level = 1;
  else if (rec.sequence.length && settings.TR) level = 3;
  else if (rec.sequence.length || rec.targets) level = 2;
  else level = 1;
  if (checks.length) level -= checks.length >= 3 ? 2 : 1;
  level = Math.max(1, level);
  let basis = rec.kind === "history" ? "history row" : rec.waveRef ? "COMTRADE waveforms and channels" : rec.sequence.length ? "element data" : rec.targets ? "targets only" : "event type only";
  if (settings.TR) basis += ", settings" + (label ? ` from ${label}` : " in event file");
  return { tripped, desc, cause, checks, gaps, confidence: { 3: "High", 2: "Medium", 1: "Low" }[level], basis, primary, evidence };
}

function shortCause(rec, settings, a) {
  a = a || analyzeEvent(rec, settings);
  const parts = [];
  if (a.desc) {
    const d = sub("\\s*\\((?:non-fault|phase-to-phase|event report)[^)]*\\)", "", a.desc).split(" (")[0];
    parts.push(sub(" - no trip$", "", d));
  }
  if (a.primary.length) parts.push("via " + a.primary.slice(0, 3).join(", "));
  else { const td = interpretTargets(rec.targets); if (td.length) parts.push("via " + td.slice(0, 3).join("/")); }
  const loc = rec.location && !rec.location.includes("$") ? rec.location : "";
  if (loc) parts.push("@ " + loc);
  const n = a.checks.length + a.gaps.length;
  return (a.tripped ? "TRIP - " : "No trip - ") + parts.join(" ") + (n ? `  [${n} to check]` : "");
}

// ---- dates (mirrors datetime.strptime for the formats used)
function daysIn(y, m) { return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
function parseDate(d) {
  const fmts = [
    [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (m) => [+m[3], +m[1], +m[2]]],
    [/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, (m) => [+m[3] <= 68 ? 2000 + +m[3] : 1900 + +m[3], +m[1], +m[2]]],
    [/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, (m) => [+m[1], +m[2], +m[3]]],
    [/^(\d{4})-(\d{1,2})-(\d{1,2})$/, (m) => [+m[1], +m[2], +m[3]]],
    [/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (m) => [+m[3], +m[2], +m[1]]],
  ];
  for (const [re, f] of fmts) {
    const m = re.exec(d);
    if (!m) continue;
    const [y, mo, day] = f(m);
    if (y >= 1 && mo >= 1 && mo <= 12 && day >= 1 && day <= daysIn(y, mo)) return [y, mo, day];
  }
  return null;
}
/** Microseconds since epoch (naive), or null. */
function eventDatetime(rec) {
  const ymd = parseDate(strip(rec.date || ""));
  if (!ymd) return null;
  let h = 0, mi = 0, s = 0, us = 0;
  const m = pmatch("(\\d{1,2}):(\\d{2}):(\\d{2})(?:\\.(\\d+))?", strip(rec.time || ""));
  if (m) { h = +m[1]; mi = +m[2]; s = +m[3]; us = m[4] ? Math.trunc(parseFloat("0." + m[4]) * 1e6) : 0; }
  const d = new Date(0); d.setUTCFullYear(ymd[0], ymd[1] - 1, ymd[2]); d.setUTCHours(h, mi, s, 0);
  return d.getTime() * 1000 + us;
}

function linkDuplicates(events) {
  const detailed = events.filter((e) => e.kind === "event").map((e) => [e, eventDatetime(e)]);
  for (const e of events) {
    if (e.kind !== "history") continue;
    const dt = eventDatetime(e);
    if (dt === null) continue;
    for (const [d, ddt] of detailed) {
      if (ddt !== null && Math.abs(ddt - dt) / 1e6 <= 1.0 &&
          (!e.relay_id || !d.relay_id || e.relay_id.toUpperCase() === d.relay_id.toUpperCase())) {
        e.dup_of = d;
        break;
      }
    }
  }
}

function nowStamp(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// View options: filter, sort and detail level
// ---------------------------------------------------------------------------
const SHOW_OPTIONS = [["all", "All events"], ["trips", "Trips only"], ["review", "Needs review"],
  ["faults", "Faults only"], ["notrip", "No-trip events"]];
const SORT_OPTIONS = [["time", "Oldest first"], ["newest", "Newest first"], ["relay", "By relay"],
  ["review", "Needs review first"]];
const DETAIL_OPTIONS = [["summary", "Summary only"], ["standard", "Standard"], ["full", "Full"]];
const FAULT_GROUPS = [
  [["single phase-to-ground", "single phase-to-ground"], ["AG", "BG", "CG"]],
  [["phase-to-phase", "phase-to-phase"], ["AB", "BC", "CA"]],
  [["two-phase-to-ground", "two-phase-to-ground"], ["ABG", "BCG", "CAG"]],
  [["three-phase", "three-phase"], ["ABC", "ABCG"]],
  [["trip without a fault type", "trips without a fault type"], ["TRIP"]],
];
const optLabel = (opts, key) => opts.find((o) => o[0] === key)[1];
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const relayKey = (e) => e.relay_id || e.terminal_id || e.source;
function showMatches(e, a, show) {
  if (show === "trips") return a.tripped;
  if (show === "review") return !!(a.checks.length || a.gaps.length);
  if (show === "faults") return has(FAULT_TYPES, eventCore(e.event_type));
  if (show === "notrip") return !a.tripped;
  return true;
}
function searchText(e, a, note) {
  return [e.relay_id, e.terminal_id, e.source, e.event_type, e.targets, e.date, e.time, e.location, a.desc, note]
    .concat(a.cause, a.checks, a.gaps, a.primary).filter(Boolean).join(" ").toUpperCase();
}

/** Stable id for an event (a history row that repeats a detailed report shares its id). */
function eventId(e) {
  const t = e.dup_of || e;
  const dt = eventDatetime(t);
  return [relayKey(t).toUpperCase(), dt !== null ? String(dt) : `${t.date} ${t.time}`, eventCore(t.event_type)].join("|");
}

const COMM_CLASS = "communications / transfer trip";
function usesComms(it) {
  if (splitWS((it.e.targets || "").toUpperCase()).includes("COMM")) return true;
  return it.e.sequence.some(([, el, st]) => st === "asserted" && elementClass(el) === COMM_CLASS);
}
const abc = (et) => { const p = eventPhases(et); return p ? [...p].filter((x) => x !== "G").sort().join("") : ""; };
const PAIR_WINDOW_US = 1e6;             // both ends within 1 second
const INCIDENT_GAP_US = 300e6;          // events within 5 minutes of each other
const REPEAT_WINDOW_US = 30 * 86400e6;  // 3+ trips on a relay within 30 days
const REPEAT_MIN = 3;

/** Same fault seen by the relays at both ends of a line. */
function findPairs(items) {
  const cand = items.filter((it) => it.e.dup_of === null && it.dt !== null && has(FAULT_TYPES, eventCore(it.e.event_type)));
  const options = [];
  for (let i = 0; i < cand.length; i++) {
    for (let j = i + 1; j < cand.length; j++) {
      const a = cand[i], b = cand[j];
      if (relayKey(a.e).toUpperCase() === relayKey(b.e).toUpperCase()) continue;
      const diff = Math.abs(a.dt - b.dt);
      if (diff > PAIR_WINDOW_US || abc(a.e.event_type) !== abc(b.e.event_type)) continue;
      const la = fnum(strip(a.e.location || "")), lb = fnum(strip(b.e.location || ""));
      const ll = fnum(a.s.LL !== undefined ? a.s.LL : "") || fnum(b.s.LL !== undefined ? b.s.LL : "");
      const adds = la !== null && lb !== null && la >= 0 && lb >= 0 && ll ? Math.abs(la + lb - ll) <= 0.15 * ll : false;
      const comms = usesComms(a) || usesComms(b);
      if (!adds && !comms) continue;
      const llText = a.s.LL !== undefined && fnum(a.s.LL) ? a.s.LL : b.s.LL;
      options.push({ a, b, adds, comms, diff, la, lb, ll, llText });
    }
  }
  options.sort((x, y) => (y.adds - x.adds) || (y.comms - x.comms) || (x.diff - y.diff) || (x.a.order - y.a.order));
  const used = new Set(), pairs = [];
  for (const o of options) {
    if (used.has(o.a) || used.has(o.b)) continue;
    used.add(o.a); used.add(o.b);
    const [first, second] = o.a.order <= o.b.order ? [o.a, o.b] : [o.b, o.a];
    const p = { first, second, likely: o.adds, comms: o.comms, diffMs: o.diff / 1000, ll: o.ll, llText: o.llText,
                locs: [strip(first.e.location || ""), strip(second.e.location || "")], sum: o.la + o.lb };
    first.pair = { other: second, info: p }; second.pair = { other: first, info: p };
    pairs.push(p);
  }
  return pairs.sort((x, y) => x.first.order - y.first.order);
}

/** Groups of events close together in time (e.g. a storm). */
function findIncidents(items) {
  const dated = items.filter((it) => it.e.dup_of === null && it.dt !== null).sort((a, b) => a.dt - b.dt || a.order - b.order);
  const chains = [];
  for (const it of dated) {
    const last = chains.length ? chains[chains.length - 1] : null;
    if (last && it.dt - last[last.length - 1].dt <= INCIDENT_GAP_US) last.push(it);
    else chains.push([it]);
  }
  const incidents = chains.filter((c) => c.length >= 2 && !(c.length === 2 && c[0].pair && c[0].pair.other === c[1]));
  incidents.forEach((c, i) => {
    const info = { n: i + 1, items: c, relays: [...new Set(c.map((it) => relayKey(it.e)))], spanUs: c[c.length - 1].dt - c[0].dt };
    for (const it of c) it.incident = info;
  });
  return incidents.map((c) => c[0].incident);
}

/** Relays that tripped REPEAT_MIN or more times within REPEAT_WINDOW_US. */
function findRepeats(items) {
  const byRelay = new Map();
  for (const it of items) {
    if (!it.a.tripped || it.e.dup_of !== null || it.dt === null) continue;
    const k = relayKey(it.e);
    if (!byRelay.has(k)) byRelay.set(k, []);
    byRelay.get(k).push(it);
  }
  const out = [];
  for (const [relay, list] of byRelay) {
    list.sort((a, b) => a.dt - b.dt || a.order - b.order);
    let best = null;
    for (let i = 0, j = 0; j < list.length; j++) {
      while (list[j].dt - list[i].dt > REPEAT_WINDOW_US) i++;
      if (!best || j - i + 1 > best.length) best = list.slice(i, j + 1);
    }
    if (best && best.length >= REPEAT_MIN) {
      const phases = { A: 0, B: 0, C: 0, G: 0 };
      for (const it of best) for (const p of eventPhases(it.e.event_type) || []) phases[p]++;
      out.push({ relay, items: best, spanUs: best[best.length - 1].dt - best[0].dt, phases });
    }
  }
  return out.sort((a, b) => b.items.length - a.items.length || cmp(a.relay.toUpperCase(), b.relay.toUpperCase()));
}

function fmtSpan(us) {
  const sec = us / 1e6;
  if (sec < 90) return `${fx(sec, sec < 10 ? 1 : 0)} seconds`;
  if (sec < 5400) return `${fx(sec / 60, 1)} minutes`;
  if (sec < 172800) return `${fx(sec / 3600, 1)} hours`;
  return `${pyRound(sec / 86400)} days`;
}
const daysText = (us) => { const d = pyRound(us / 86400e6); return d < 1 ? "within one day" : `in ${d} day${d === 1 ? "" : "s"}`; };
const phaseText = (ph) => ["A", "B", "C"].filter((p) => ph[p]).map((p) => `phase ${p} ${ph[p]}x`).concat(ph.G ? [`ground ${ph.G}x`] : []).join(", ");
const elementsText = (it) => (it.a.primary.length ? it.a.primary.join(", ") : interpretTargets(it.e.targets).slice(0, 2).join("/") || "element not identified");
const clearText = (e) => (e.trip_cycle !== null && e.open_cycle !== null && e.open_cycle > e.trip_cycle
  ? `breaker opened ${fx(e.open_cycle - e.trip_cycle, 2)} cycles after trip` : "");
const station = (e) => (e.terminal_id && e.terminal_id !== relayKey(e) ? ` (${e.terminal_id})` : "");

function prepareView(events, rdb, opts) {
  opts = opts || {};
  const ev = events.filter((e) => e.kind === "event" || e.kind === "history")
    .map((e, i) => [e, eventDatetime(e), i])
    .sort((a, b) => ((a[1] === null) - (b[1] === null)) || ((a[1] === null ? -Infinity : a[1]) - (b[1] === null ? -Infinity : b[1])) || (a[2] - b[2]))
    .map((x) => x[0]);
  for (const e of ev) { e.notes = e.notes.filter((n) => !n.startsWith("Same event as")); e.dup_of = null; }
  linkDuplicates(ev);
  const items = ev.map((e, i) => {
    const [sRdb, lbl, how] = matchSettings(e, rdb);
    const s = Object.assign({}, e.settings, sRdb);
    return { e, s, label: lbl, how, a: analyzeEvent(e, s, how, lbl), order: i, dt: eventDatetime(e),
             pair: null, incident: null };
  });
  const notes = opts.notes || {};
  const weather = opts.weather || {};
  for (const it of items) { it.id = eventId(it.e); it.note = notes[it.id] || ""; it.weather = weather[it.id] || null; }
  const pairs = findPairs(items), incidents = findIncidents(items), repeats = findRepeats(items);
  const show = opts.show || "all";
  const relay = strip(opts.relay || "").toUpperCase();
  const search = strip(opts.search || "").toUpperCase();
  const hideDups = !!opts.hide_duplicates;
  let shown = [], nDups = 0;
  for (const it of items) {
    if (!showMatches(it.e, it.a, show)) continue;
    if (relay && strip(relayKey(it.e)).toUpperCase() !== relay) continue;
    if (search && !searchText(it.e, it.a, [it.note, it.weather ? it.weather.text : ""].join(" ")).includes(search)) continue;
    if (hideDups && it.e.dup_of !== null) { nDups++; continue; }
    shown.push(it);
  }
  const sort = opts.sort || "time";
  if (sort === "newest") {
    const dated = shown.filter((it) => eventDatetime(it.e) !== null);
    shown = dated.reverse().concat(shown.filter((it) => eventDatetime(it.e) === null));
  } else if (sort === "relay") {
    shown.sort((x, y) => cmp(relayKey(x.e).toUpperCase(), relayKey(y.e).toUpperCase()) || x.order - y.order);
  } else if (sort === "review") {
    const n = (it) => it.a.checks.length + it.a.gaps.length;
    shown.sort((x, y) => n(y) - n(x) || x.order - y.order);
  }
  return { items, shown, nDups, pairs, incidents, repeats };
}

/** Counts for the Show options and the relays present, for labelling the view controls. */
function viewChoices(events, rdb) {
  const { items } = prepareView(events, rdb);
  const counts = {};
  for (const [key] of SHOW_OPTIONS) counts[key] = items.filter((it) => showMatches(it.e, it.a, key)).length;
  const relays = new Map();
  for (const it of items) { const k = relayKey(it.e); relays.set(k, (relays.get(k) || 0) + 1); }
  return { counts, relays: [...relays].sort((a, b) => cmp(a[0].toUpperCase(), b[0].toUpperCase())) };
}

function describeView(opts, nDups) {
  opts = opts || {};
  const parts = [];
  const show = opts.show || "all";
  if (show !== "all") parts.push(optLabel(SHOW_OPTIONS, show).toLowerCase());
  if (strip(opts.relay || "")) parts.push(`relay ${strip(opts.relay)}`);
  const sort = opts.sort || "time";
  if (sort !== "time") parts.push(optLabel(SORT_OPTIONS, sort).toLowerCase());
  if (strip(opts.search || "")) parts.push(`matching "${strip(opts.search)}"`);
  if (nDups) parts.push(`${nDups} duplicate history row${nDups !== 1 ? "s" : ""} hidden`);
  return parts.join("; ");
}

function overviewLines(shown, extra) {
  const trips = shown.filter((it) => it.a.tripped).length;
  const lines = [`  Events      : ${shown.length} - ${trips} trip${trips !== 1 ? "s" : ""}, ${shown.length - trips} no trip`];
  const cats = [], known = new Set();
  for (const [[one, many], codes] of FAULT_GROUPS) {
    const n = shown.filter((it) => codes.includes(eventCore(it.e.event_type))).length;
    codes.forEach((c) => known.add(c));
    if (n) cats.push(`${n} ${n === 1 ? one : many}`);
  }
  const other = shown.filter((it) => !known.has(eventCore(it.e.event_type))).length;
  if (other) cats.push(`${other} other event${other !== 1 ? "s" : ""} (no fault)`);
  lines.push("  Fault types : " + cats.join(", "));
  const relays = new Map();
  for (const it of shown) { const k = relayKey(it.e); relays.set(k, (relays.get(k) || 0) + 1); }
  const ordered = [...relays].sort((a, b) => (b[1] - a[1]) || cmp(a[0].toUpperCase(), b[0].toUpperCase()));
  lines.push("  Relays      : " + ordered.map(([k, n]) => `${k} (${n})`).join(", "));
  if (extra) {
    const shownSet = new Set(shown);
    const pairs = extra.pairs.filter((p) => shownSet.has(p.first) || shownSet.has(p.second));
    const inc = extra.incidents.filter((x) => x.items.some((it) => shownSet.has(it)));
    const rep = extra.repeats.filter((r) => r.items.some((it) => shownSet.has(it)));
    if (pairs.length) lines.push(`  Two-ended   : ${pairs.length} fault${pairs.length === 1 ? "" : "s"} seen from both ends of a line`);
    if (inc.length) lines.push(`  Incidents   : ${inc.length} group${inc.length === 1 ? "" : "s"} of events close together in time`);
    if (rep.length) lines.push("  Repeat trips: " + rep.map((r) => `${r.relay} (${r.items.length} ${daysText(r.spanUs)})`).join(", "));
    const wx = shown.filter((it) => it.weather);
    if (wx.length) {
      const kinds = new Map();
      for (const it of wx) for (const h of it.weather.hints || []) if (h.kind !== "calm") kinds.set(h.label, (kinds.get(h.label) || 0) + 1);
      lines.push(`  Weather     : looked up for ${wx.length} event${wx.length === 1 ? "" : "s"}` +
                 (kinds.size ? "; " + [...kinds].map(([k, n]) => `${k} ${n}`).join(", ") : "; no severe weather found"));
    }
  }
  lines.push("  Confidence  : " + ["High", "Medium", "Low"]
    .map((c) => [c, shown.filter((it) => it.a.confidence === c).length]).filter(([, n]) => n).map(([c, n]) => `${n} ${c}`).join(", "));
  return lines;
}

function buildReport(events, rdb, errors, nFiles, comments, opts) {
  opts = opts || {};
  comments = comments || "";
  const detail = opts.detail || "full";
  const showSeq = detail === "full" && opts.sequence !== false;
  const showSettings = detail === "full" && opts.settings !== false;
  const showSer = detail === "full" && opts.ser !== false;
  const now = opts.now || nowStamp();
  const view = prepareView(events, rdb, opts);
  const { items, shown, nDups } = view;
  const ser = events.filter((e) => e.kind === "ser");
  const nItems = shown.reduce((t, it) => t + it.a.checks.length + it.a.gaps.length, 0);
  const nEv = shown.filter((it) => it.a.checks.length || it.a.gaps.length).length;
  const number = new Map(shown.map((it, i) => [it.e, i + 1]));
  const dupNote = (e) => {
    const d = e.dup_of;
    if (d === null) return [];
    if (number.has(d)) return [`Same event as #${number.get(d)} (${d.source}), which has more detail.`];
    return [`Same event as the detailed report in ${d.source} (not shown in this view).`];
  };

  const out = [];
  out.push("SEL TRIP EVENT SUMMARY", "=".repeat(60), `Generated: ${now}`,
           `Files analyzed: ${nFiles}   Events found: ${items.length}   Settings databases: ${rdb.size}`);
  const viewText = describeView(opts, nDups);
  if (items.length && (viewText || shown.length !== items.length))
    out.push(`Showing: ${shown.length} of ${items.length} events` + (viewText ? ` (${viewText})` : ""));
  if (shown.length)
    out.push(`Needs review: ${nItems} item(s) to check across ${nEv} of ${shown.length} event(s)` + (nItems ? " - see the CHECK lines" : ""));
  out.push("");
  if (strip(comments)) out.push("ANALYST COMMENTS / NOTES", "-".repeat(60), ...splitlines(strip(comments)), "");

  if (!items.length && !ser.length) out.push("No event data recognized in the loaded files.");
  else {
    if (shown.length >= 2) out.push("OVERVIEW", "-".repeat(60), ...overviewLines(shown, view), "");
    out.push("QUICK SUMMARY", "-".repeat(60));
    if (items.length && !shown.length) out.push("No events match the current Show / Relay / Search options.");
    shown.forEach((it, idx) => {
      const e = it.e;
      const when = strip(`${e.date} ${e.time}`) || "date n/a";
      out.push(`${String(idx + 1).padStart(2)}. ${when} | ${relayKey(e)} | ${e.event_type || "?"} | ${shortCause(e, it.s, it.a)}`);
    });
    out.push("");
    out.push(...relationSections(view, number));
    if (opts.reviews) {
      const rows = reviewRows(shown, opts.reviews);
      if (rows.length) {
        const done = rows.filter((r) => r.outcome).length, mis = rows.filter((r) => r.outcome === "misop").length;
        out.push("OPERATION REVIEW (NERC PRC-004)", "-".repeat(60));
        out.push(`  ${done} of ${rows.length} trip${rows.length === 1 ? "" : "s"} reviewed` + (mis ? `, ${mis} misoperation${mis === 1 ? "" : "s"}` : "") + ".");
        for (const row of rows) out.push(`  ${ref(number, row.it)} ${relayKey(row.it.e)} ${row.it.e.event_type || "?"} ${strip(row.it.e.date)}: ${reviewLine(row)}`);
        out.push("");
      }
    }
    if (detail !== "summary" && !(items.length && !shown.length)) {
      out.push("EVENT DETAILS", "-".repeat(60));
      const shownSettings = new Map();
      shown.forEach((it, idx) => {
        const n = idx + 1, e = it.e, s = it.s, a = it.a, lbl = it.label;
        out.push(`Event ${n} of ${shown.length}  (${e.kind === "history" ? "history row" : "event report"})`);
        out.push(`  Source file : ${e.source}`);
        const relay = [e.relay_id, e.terminal_id].filter(Boolean).join(" / ");
        if (relay) out.push(`  Relay       : ${relay}`);
        if (e.fid) out.push(`  Firmware    : ${e.fid}`);
        if (e.date || e.time) out.push(`  Date / Time : ${e.date} ${e.time}`);
        if (e.event_type) out.push(`  Event type  : ${e.event_type}  (${a.desc})`);
        if (e.location) out.push(`  Fault loc.  : ${fmtLoc(e.location, s)}`);
        if (e.targets) out.push(`  Targets     : ${e.targets}`);
        if (e.freq) out.push(`  Frequency   : ${e.freq} Hz`);
        if (e.shot) out.push(`  Shot        : ${e.shot}`);
        for (const x of e.extra) out.push(`  ${x}`);
        if (e.currents.size) {
          const parts = [...e.currents].map(([k, [pre, post]]) => `${k} ${fc(post, 0)}` + (pre !== null ? ` (pre ${fc(pre, 0)})` : ""));
          const est = e.sequence.length || [...e.currents.values()].some(([p]) => p !== null) ? ", estimated from samples" : "";
          out.push("  Currents    : " + parts.join("; ") + `  [A, max during fault${est}]`);
        }
        if (e.voltages.size) {
          const parts = [...e.voltages].map(([k, [pre, post]]) => `${k} ${fc(pre, 2)} -> ${fc(post, 2)}`);
          out.push("  Voltages    : " + parts.join("; ") + "  [prefault -> min during fault]");
        }
        const nChk = a.checks.length + a.gaps.length;
        out.push(`  Confidence  : ${a.confidence} (${a.basis})` + (nChk ? ` - ${nChk} item(s) to check` : ""));
        if (it.note) out.push(`  Notes       : ${splitlines(strip(it.note)).map((x) => strip(x)).filter(Boolean).join(" / ")}`);
        if (it.weather) out.push(`  Weather     : ${it.weather.text}`);
        if (opts.reviews && (a.tripped || opts.reviews[it.id]) && e.dup_of === null) {
          const rr = reviewRows([it], opts.reviews)[0];
          if (rr) out.push(`  Review      : ${reviewLine(rr)}`);
        }
        out.push("  Probable cause:");
        for (const c of a.cause.concat(dupNote(e), relationNotes(it, number), weatherNotes(it))) out.push(`    - ${c}`);
        if (nChk) { out.push("  Check before relying on this:"); for (const c of a.checks.concat(a.gaps)) out.push(`    - CHECK: ${c}`); }
        if (showSeq && e.sequence.length) {
          out.push("  Element sequence (cycles from start of record):");
          const rel = e.sequence.filter((x) => elementClass(x[1]));
          const rest = e.sequence.length - rel.length;
          for (const [cyc, el, st] of rel.slice(0, 40))
            out.push(`    ${fx(cyc, 2).padStart(6)}  ${el.padEnd(10)} ${st === "pre" ? "already asserted at start" : "asserted"}  (${elementClass(el)})`);
          if (rel.length > 40) out.push(`    ... ${rel.length - 40} more`);
          if (rest) out.push(`    (${rest} other relay word bits changed - not listed)`);
        }
        if (showSettings && Object.keys(s).length) {
          const keys = ["TR", "TRCOMM", "TRSOTF", "DTT", "LL", "CTR", "PTR", "Z1MAG", "Z1P", "Z1MG", "50P1P", "50G1P", "51PP", "51GP", "ER"]
            .filter((k) => k in s);
          if (keys.length) {
            const src = lbl ? (s.__method__ === "text" ? `settings file ${s.__file__ || lbl}` : `RDB: ${lbl}`) : "event file";
            const sig = JSON.stringify([src, keys.map((k) => [k, s[k]])]);
            if (shownSettings.has(sig)) out.push(`  Settings    : same as Event ${shownSettings.get(sig)} (${src})`);
            else {
              shownSettings.set(sig, n);
              out.push(`  Settings context (${src}):`);
              for (const k of keys) out.push(`    ${k} := ${s[k]}`);
            }
          }
        }
        out.push("");
      });
    }
  }
  if (showSer && ser.length) {
    out.push("SEQUENTIAL EVENTS RECORDER (trip-related lines)", "-".repeat(60));
    for (const r of ser) {
      out.push(`  From ${r.source}:`);
      let lines = r.ser_lines.filter((ln) => elementClass(splitWS(ln)[2]));
      if (!lines.length) lines = r.ser_lines;
      for (const ln of lines.slice(0, 80)) out.push(`    ${ln}`);
    }
    out.push("");
  }
  if (rdb.size && !items.length) {
    out.push("SETTINGS LOADED", "-".repeat(60));
    for (const [lbl, s] of rdb) out.push(`  ${lbl}: TR := ${s.TR !== undefined ? s.TR : "n/a"}`);
    out.push("");
  }
  if (errors.length) out.push("FILES THAT COULD NOT BE READ", "-".repeat(60), ...errors.map((e) => "  " + e), "");
  out.push("Note: automated interpretation - verify against the relay oscillography and settings.");
  return out.join("\n");
}

const ref = (number, it) => (number.has(it.e) ? `#${number.get(it.e)}` : "an event not shown in this view");

function pairVerdict(p) {
  if (p.likely) return `locations ${p.locs[0]} + ${p.locs[1]} = ${fx(p.sum, 2)}, line length ${p.llText}: likely the same fault seen from both ends`;
  return "communications-assisted trip within " + fx(p.diffMs, 0) + " ms: possibly the same fault seen from both ends";
}

/** Cause hints from the weather at the time of the event (only when it looks relevant). */
function weatherNotes(it) {
  if (!it.weather || !it.weather.hints) return [];
  return it.weather.hints.filter((h) => h.kind !== "calm" || it.a.tripped).map((h) => `Weather: ${h.text}`);
}

function relationNotes(it, number) {
  const out = [];
  if (it.pair) {
    const o = it.pair.other;
    out.push(`Other end of the line: ${ref(number, o)} ${relayKey(o.e)}${station(o.e)} tripped by ${elementsText(o)}` +
             (o.e.location ? ` at ${o.e.location}` : "") + ` - ${pairVerdict(it.pair.info)}.`);
  }
  if (it.incident) {
    const x = it.incident;
    out.push(`Part of incident ${x.n}: ${x.items.length} events on ${x.relays.length} relay${x.relays.length === 1 ? "" : "s"} within ${fmtSpan(x.spanUs)}.`);
  }
  return out;
}

function relationSections(view, number) {
  const out = [];
  const isShown = (it) => number.has(it.e);
  const line = (it) => `${ref(number, it)} ${relayKey(it.e)} ${it.e.event_type || "?"}: ${shortCause(it.e, it.s, it.a)}`;
  const pairs = view.pairs.filter((p) => isShown(p.first) || isShown(p.second));
  if (pairs.length) {
    out.push("TWO-ENDED EVENTS", "-".repeat(60));
    for (const p of pairs) {
      out.push(`  ${relayKey(p.first.e)} and ${relayKey(p.second.e)} at ${strip(`${p.first.e.date} ${p.first.e.time}`)}:`);
      out.push(`    - ${p.first.a.desc}; ${pairVerdict(p)}.`);
      for (const it of [p.first, p.second]) {
        const c = clearText(it.e);
        out.push(`    - ${ref(number, it)} ${relayKey(it.e)}${station(it.e)}: ${elementsText(it)}` + (it.e.location ? ` at ${it.e.location}` : "") + (c ? `, ${c}` : "") + ".");
      }
    }
    out.push("");
  }
  const inc = view.incidents.filter((x) => x.items.some(isShown));
  if (inc.length) {
    out.push("INCIDENTS", "-".repeat(60));
    for (const x of inc) {
      const f = x.items[0].e, l = x.items[x.items.length - 1].e;
      out.push(`  Incident ${x.n}, ${strip(`${f.date} ${f.time}`)} to ${l.time || l.date} (${x.items.length} events on ${x.relays.length} relay${x.relays.length === 1 ? "" : "s"} within ${fmtSpan(x.spanUs)}):`);
      for (const it of x.items) out.push(`    - ${line(it)}`);
    }
    out.push("");
  }
  const rep = view.repeats.filter((r) => r.items.some(isShown));
  if (rep.length) {
    out.push("REPEAT TRIPS", "-".repeat(60));
    for (const r of rep) {
      const f = r.items[0].e, l = r.items[r.items.length - 1].e;
      out.push(`    - ${r.relay}: ${r.items.length} trips ${daysText(r.spanUs)} (${f.date} to ${l.date}) - ${phaseText(r.phases)}. ` +
               `Repeated trips often point to one cause (equipment, vegetation, animals); worth a patrol. Events ${r.items.map((it) => ref(number, it)).join(", ")}.`);
    }
    out.push("");
  }
  return out;
}

const CSV_COLUMNS = ["#", "Date", "Time", "Relay", "Station", "Event type", "Description", "Tripped",
  "Tripping elements", "Fault location", "% of line", "Targets", "Max phase current (A)",
  "Ground current (A)", "Breaker clearing (cycles)", "Confidence", "Items to check",
  "Check details", "Other end", "Incident", "Notes", "Weather", "Source file"];
const csvField = (v) => (/[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);

/** One row per event (same filter and order as the summary) for Excel. */
function reportCsv(events, rdb, opts) {
  const { shown } = prepareView(events, rdb, opts);
  const keep = opts && opts.columns ? CSV_COLUMNS.map((c) => opts.columns.includes(c)) : null;
  const number = new Map(shown.map((it, i) => [it.e, i + 1]));
  const rows = [CSV_COLUMNS];
  shown.forEach((it, idx) => {
    const e = it.e, s = it.s, a = it.a;
    const [ph, gnd] = phaseCurrents(e);
    let peaks = [...ph.values()].map((v) => v[1]);
    if (!peaks.length) peaks = [...e.currents].filter(([k]) => k === "Fault current").map(([, v]) => v[1]);
    const loc = strip(e.location || "");
    const v = fnum(loc), ll = fnum(s.LL !== undefined ? s.LL : "");
    const clearing = e.trip_cycle !== null && e.open_cycle !== null && e.open_cycle > e.trip_cycle ? fx(e.open_cycle - e.trip_cycle, 2) : "";
    rows.push([String(idx + 1), e.date, e.time, e.relay_id, e.terminal_id, e.event_type, a.desc,
      a.tripped ? "Yes" : "No", a.primary.join(", "), loc, v !== null && ll ? fx(100 * v / ll, 0) : "", e.targets,
      peaks.length ? fx(Math.max(...peaks), 0) : "", gnd !== null ? fx(gnd[1], 0) : "",
      clearing, a.confidence, String(a.checks.length + a.gaps.length), a.checks.concat(a.gaps).join(" | "),
      it.pair ? `${number.has(it.pair.other.e) ? "#" + number.get(it.pair.other.e) + " " : ""}${relayKey(it.pair.other.e)}` : "",
      it.incident ? String(it.incident.n) : "", strip(it.note || ""), it.weather ? it.weather.text : "", e.source]);
  });
  return rows.map((r) => (keep ? r.filter((f, j) => keep[j]) : r).map((f) => csvField(String(f))).join(",")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Report text -> blocks (for the formatted Word / print view)
// ---------------------------------------------------------------------------
const KV_RE = "^ {2}([A-Za-z][A-Za-z ./\\-]{1,14}?)\\s*:\\s?(.*)$";
const SUB_RE = "^ {2}(\\S.*?):\\s*$";
const SEQ_RE = "^\\s{3,}([\\d.]+)\\s+(\\S+)\\s+(already asserted at start|asserted)\\s+\\((.*)\\)\\s*$";
const QS_RE = "^\\s*(\\d+)\\.\\s+(.*)$";

function parseReportText(text) {
  const blocks = [], para = [];
  let section = "", subh = "";
  const lines = text.split("\r\n").join("\n").split("\n");
  const flush = () => { if (para.length) { blocks.push(["para", para.join("\n")]); para.length = 0; } };
  const add = (kind, ...payload) => {
    flush();
    const last = blocks[blocks.length - 1];
    if (last && last[0] === kind && ["kv", "bullets", "mono", "meta"].includes(kind)) last[1].push(...payload[0]);
    else if (last && kind === "table" && last[0] === "table" && JSON.stringify(last[1]) === JSON.stringify(payload[0])) last[2].push(...payload[1]);
    else blocks.push([kind, ...payload.map((p) => (Array.isArray(p) ? p.slice() : p))]);
  };
  for (const ln of lines) {
    const s = strip(ln);
    if (!s) { flush(); continue; }
    if (fullmatch("[=\\-]{6,}", s)) continue;
    if (!blocks.length && !para.length && s.toUpperCase().startsWith("SEL TRIP")) { blocks.push(["title", pyTitle(s).split("Sel ").join("SEL ")]); continue; }
    if (!section && pmatch("^(Generated|Files analyzed|Showing|Needs review)\\b", s)) { add("meta", [s]); continue; }
    if (ln === s && fullmatch("[A-Z][A-Z /&\\-]{3,}(\\s*\\(.*\\))?", s)) {
      section = s; subh = "";
      add("h1", pyTitle(s).split("Ser").join("SER").split("Rdb").join("RDB"));
      continue;
    }
    if (s.startsWith("Note:") && ln === s) { add("note", s); continue; }
    if (section === "QUICK SUMMARY") {
      const m = pmatch(QS_RE, ln);
      if (m && m[2].split("|").length - 1 >= 3) {
        const parts = splitMax(m[2], "|", 3).map((p) => strip(p));
        add("table", ["#", "Date / time", "Relay", "Type", "Cause"], [[m[1]].concat(parts)]);
        continue;
      }
    }
    if (pmatch("^Event \\d+ of \\d+", ln)) { subh = ""; add("h2", s); continue; }
    let m = pmatch(SUB_RE, ln);
    if ((m && !pmatch(KV_RE, ln)) || (m && ["Probable", "Element", "Settings", "From"].some((p) => m[1].startsWith(p)))) {
      subh = m[1]; add("sub", subh); continue;
    }
    if (ln.startsWith("    ")) {
      if (s.startsWith("- ")) { add("bullets", [s.slice(2)]); continue; }
      m = pmatch(SEQ_RE, ln);
      if (m) { add("table", ["Cycle", "Element", "State", "Function"], [[m[1], m[2], m[3], m[4]]]); continue; }
      m = pmatch("^\\s+([A-Z0-9_]+) := (.*)$", ln);
      if (m) { add("kv", [[m[1], m[2], true]]); continue; }
      if (subh.startsWith("From") || section.startsWith("SEQUENTIAL")) { add("mono", [s]); continue; }
      add("note", s); continue;
    }
    m = pmatch(KV_RE, ln);
    if (m && (section === "EVENT DETAILS" || section === "OVERVIEW")) { add("kv", [[strip(m[1]), strip(m[2]), false]]); continue; }
    if (section.startsWith("FILES THAT") && ln.startsWith("  ")) { add("bullets", [s]); continue; }
    para.push(s);
  }
  flush();
  return blocks;
}

/**
 * Leave parts out of a (possibly hand-edited) report before exporting it.
 * inc: {comments, overview, quick, relations, details, checks, notes, weather, sequence, ser, settings, errors}
 * (missing keys count as true).
 */
const SECTION_KEYS = [["ANALYST COMMENTS", "comments"], ["OVERVIEW", "overview"], ["QUICK SUMMARY", "quick"], ["TWO-ENDED EVENTS", "relations"],
  ["INCIDENTS", "relations"], ["REPEAT TRIPS", "relations"], ["OPERATION REVIEW", "review"], ["EVENT DETAILS", "details"], ["SEQUENTIAL EVENTS RECORDER", "ser"],
  ["SETTINGS LOADED", "settings"], ["FILES THAT COULD NOT BE READ", "errors"]];
function filterReportText(text, inc) {
  inc = inc || {};
  const on = (k) => inc[k] !== false;
  const lines = text.split("\r\n").join("\n").split("\n");
  const out = [];
  let dropSection = false, dropSub = false, inDetails = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i], s = strip(ln);
    const isHeader = ln === s && /^[A-Z]{3}/.test(s) && /^[=\-]{6,}$/.test(strip(lines[i + 1] || ""));
    if (isHeader) {
      const hit = SECTION_KEYS.find(([h]) => s.startsWith(h));
      dropSection = hit ? !on(hit[1]) : false;
      inDetails = s.startsWith("EVENT DETAILS");
      dropSub = false;
      if (dropSection) continue;
      out.push(ln); continue;
    }
    if (dropSection) continue;
    if (/^Needs review:/.test(s) && !on("checks")) continue;
    if (!on("checks") && /\[\d+ to check\]\s*$/.test(ln)) { out.push(ln.replace(/\s*\[\d+ to check\]\s*$/, "")); continue; }
    if (inDetails) {
      if (/^Event \d+ of \d+/.test(ln)) { dropSub = false; out.push(ln); continue; }
      const sub = /^ {2}(\S.*?):\s*$/.exec(ln);
      if (sub) {
        const name = sub[1];
        dropSub = (name.startsWith("Check before") && !on("checks")) || ((name.startsWith("Element sequence") || name.startsWith("Settings context")) && !on("sequence"));
        if (dropSub) continue;
      } else if (dropSub && (ln.startsWith("   ") || !s)) { if (!s) dropSub = false; else continue; }
      else if (/^ {2}\S/.test(ln)) dropSub = false;
      if (/^ {2}Notes {7}:/.test(ln) && !on("notes")) continue;
      if (/^ {2}Review {6}:/.test(ln) && !on("review")) continue;
      if ((/^ {2}Weather {5}:/.test(ln) || /^ {4}- Weather: /.test(ln)) && !on("weather")) continue;
      if (/^ {4}- CHECK: /.test(ln) && !on("checks")) continue;
    }
    out.push(ln);
  }
  // no double blank lines left behind
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Split a cause string so TRIP / No trip / CHECK prefixes and [n to check] can be coloured. */
function tripRuns(text) {
  let runs = [[text, null]];
  for (const [word, color] of [["Relay TRIPPED", "trip"], ["TRIP", "trip"], ["No trip recorded", "ok"], ["No trip", "ok"], ["CHECK:", "warn"]]) {
    if (text.startsWith(word)) { runs = [[word, color], [text.slice(word.length), null]]; break; }
  }
  const lastText = runs[runs.length - 1][0];
  const m = /\s*\[\d+ to check\]$/.exec(lastText);
  if (m) {
    runs[runs.length - 1] = [lastText.slice(0, m.index), runs[runs.length - 1][1]];
    runs.push([lastText.slice(m.index), "warn"]);
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Operation review (NERC PRC-004): was each trip a correct operation or a misoperation?
// ---------------------------------------------------------------------------
const MISOP_CATEGORIES = ["Failure to Trip - During Fault", "Failure to Trip - Other Than Fault", "Slow Trip - During Fault",
  "Slow Trip - Other Than Fault", "Unnecessary Trip - During Fault", "Unnecessary Trip - Other Than Fault"];
const MISOP_CAUSES = ["Incorrect Settings", "Logic Errors", "Design Errors", "As-left Personnel Errors", "Relay Failures/Malfunctions",
  "Communication Failures", "AC System", "DC System", "Unknown/Unexplainable", "Other/Explainable"];
const REVIEW_OUTCOMES = [["", "Not reviewed"], ["correct", "Correct operation"], ["misop", "Misoperation"],
  ["na", "Not applicable"]];
const REVIEW_DAYS = 120, CAP_DAYS = 60;   // PRC-004-6 R1 (decide) and R5 (corrective action plan)
const isoDay = (us) => new Date(us / 1000).toISOString().slice(0, 10);
const addDays = (iso, d) => { const t = Date.parse(iso + "T00:00:00Z"); return Number.isFinite(t) ? isoDay((t + d * 86400e3) * 1000) : ""; };
const reviewLabel = (k) => (REVIEW_OUTCOMES.find((o) => o[0] === k) || REVIEW_OUTCOMES[0])[1];

/** When the decision is due: 120 calendar days after the breaker operation. */
function reviewDue(e) { const dt = eventDatetime(e); return dt === null ? "" : isoDay(dt + REVIEW_DAYS * 86400e6); }

/** A starting point for the reviewer, with the reason. Never a verdict: the protection design decides. */
function suggestReview(it) {
  const e = it.e, a = it.a, isFault = has(FAULT_TYPES, eventCore(e.event_type));
  const chk = a.checks.join("\n"), causeText = a.cause.join("\n");
  if (!a.tripped) {
    if (isFault) return { outcome: "", category: "Failure to Trip - During Fault", text: "The relay saw a fault but didn't trip. Correct if another device was meant to clear it; " +
                          "a Failure to Trip if this relay should have." };
    return { outcome: "na", category: "", text: "No trip, so there's usually nothing to review unless this relay should have tripped." };
  }
  if (/beyond typical Zone 1 reach/.test(chk))
    return { outcome: "misop", category: "Unnecessary Trip - During Fault", cause: "Incorrect Settings",
             text: "Zone 1 tripped for a fault beyond its usual reach: if the fault was outside this line, Zone 1 overreached." };
  if (/beyond the end of the line/.test(chk) && /instantaneous|Zone 1/i.test(causeText))
    return { outcome: "misop", category: "Unnecessary Trip - During Fault",
             text: "An instantaneous element tripped for a fault located beyond the end of the line: check whether this relay should have cleared it." };
  if (/No element from the trip equations asserted|No protection element asserted/.test(chk))
    return { outcome: "", category: "Unnecessary Trip - Other Than Fault",
             text: "No protection element explains the trip. A manual or SCADA open is not a protection operation (Not applicable); otherwise it may be an Unnecessary Trip." };
  if (!isFault && eventCore(e.event_type) === "TRIP" && !/transfer trip|Frequency|Voltage element|Breaker-failure|Out-of-step/.test(causeText))
    return { outcome: "", category: "Unnecessary Trip - Other Than Fault",
             text: "A trip with no fault and no transfer-trip, frequency or voltage reason found." };
  if (!isFault && /underfrequency|Frequency element tripped/i.test(causeText))
    return { outcome: "correct", category: "", text: "Underfrequency load shedding: a correct operation if the frequency really fell below the setting for the set time." };
  if (!isFault && /transfer trip/i.test(causeText))
    return { outcome: "", category: "", text: "A trip received from the remote end: correct if the remote end sent it for a real fault. Review it together with the remote end's event." };
  if (/took [\d.]+ cycles to open/.test(chk))
    return { outcome: "", category: "", text: "The breaker was slow to open. A slow breaker isn't a Protection System misoperation by itself, but check the trip circuit (DC System)." };
  if (isFault && a.primary.length && !a.checks.length)
    return { outcome: "correct", category: "", text: `The expected kind of element (${a.primary.join(", ")}) tripped for a fault, with nothing flagged.` };
  return { outcome: "", category: "", text: isFault ? "Confirm the right element tripped, in the expected time, for this fault." : "Confirm what caused this trip and whether the relay should have operated." };
}

/** One review line per trip (and per reviewed event), oldest first. */
function reviewRows(items, reviews) {
  reviews = reviews || {};
  return items.filter((it) => it.e.dup_of === null && (it.a.tripped || reviews[it.id])).map((it) => {
    const r = reviews[it.id] || {}, due = reviewDue(it.e);
    const capDue = r.outcome === "misop" && r.cause && r.causeFound ? addDays(r.causeFound, CAP_DAYS) : "";
    return { it, r, due, capDue, outcome: r.outcome || "", label: reviewLabel(r.outcome || "") };
  });
}

function reviewLine(row) {
  const { it, r } = row;
  if (!r.outcome) return `not reviewed yet - decide by ${row.due || "(no date in the file)"}`;
  let t = row.label;
  if (r.outcome === "misop") t += (r.category ? ` - ${r.category}` : "") + (r.cause ? `; cause: ${r.cause}` : "") + (row.capDue ? `; corrective action plan due ${row.capDue}` : "");
  const who = [r.reviewer, r.date].filter(Boolean).join(", ");
  return t + (who ? ` (${who})` : "") + (r.notes ? `. ${splitlines(strip(r.notes)).map((x) => strip(x)).filter(Boolean).join(" / ")}` : "") +
         (r.cap ? `. Corrective action: ${strip(r.cap)}` : "");
}

const REVIEW_COLUMNS = ["Date", "Time", "Relay", "Station", "Event type", "What happened", "Review", "Category", "Cause", "Reviewer",
  "Reviewed on", "Decide by", "Cause found on", "Corrective action plan due", "Notes", "Corrective action"];
/** The review log as CSV (one row per trip), for a compliance spreadsheet. */
function reviewCsv(events, rdb, reviews) {
  const v = prepareView(events, rdb, {});
  const rows = [REVIEW_COLUMNS.join(",")];
  for (const row of reviewRows(v.items, reviews)) {
    const { it, r } = row, e = it.e;
    rows.push([e.date, e.time, relayKey(e), e.terminal_id, e.event_type, shortCause(e, it.s, it.a), row.label,
               r.outcome === "misop" ? r.category || "" : "", r.outcome === "misop" ? r.cause || "" : "", r.reviewer || "", r.date || "",
               row.due, r.causeFound || "", row.capDue, r.notes || "", r.cap || ""].map((x) => csvField(String(x || ""))).join(","));
  }
  return rows.join("\r\n") + "\r\n";
}

const api = {
  loadFiles, buildReport, reportCsv, viewChoices, prepareView, eventId, relayKey, shortCause, equationHits, CSV_COLUMNS, filterReportText, SHOW_OPTIONS, SORT_OPTIONS, DETAIL_OPTIONS, parseReportText, tripRuns, analyzeEvent, matchSettings, parseCev, parseText,
  parseRdb, readText, extOf, ALL_EXTS, EVENT_EXTS, SETTINGS_EXTS, COMTRADE_EXTS, ARCHIVE_EXTS, SETTINGS_TEXT_EXTS, unzip, settingsFromText, nowStamp, eventDatetime, eventCore,
  interpretEventType, interpretTargets, extractSettings, splitWS, strip, splitlines, csvLine, latin1, FAULT_TYPES, fx, fc, pyTitle, elementClass,
  newRec, useComtradeReader, BREAKER_NAMES, TRIP_NAMES, MISOP_CATEGORIES, MISOP_CAUSES, REVIEW_OUTCOMES, REVIEW_COLUMNS, REVIEW_DAYS, CAP_DAYS, reviewDue, suggestReview, reviewRows, reviewLine, reviewCsv, addDays,
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.SELCore = api;
})(typeof window !== "undefined" ? window : globalThis);
