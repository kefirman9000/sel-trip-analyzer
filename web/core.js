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
const SETTING_RE = '\\b([A-Z][A-Z0-9_]{0,11})\\s*:?=\\s*(.*?)(?=\\s{2,}[A-Z][A-Z0-9_]{0,11}\\s*:?=|\\"|$)';
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

function elementClass(name) {
  const n = name.toUpperCase();
  for (const [pat, cls] of ELEMENT_RULES) if (pmatch(pat, n)) return cls;
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
    settings: {}, ser_lines: [], extra: [], dup_of: null, trigger_cycle: null, prefault_short: false, notes: [],
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
    analog.push([name, n, pre, mags]);
  });

  const firstOn = new Map(), preOn = new Set();
  hdr.forEach((name, c) => {
    if (!strip(name).includes(" ")) return;
    const names = splitWS(name);
    table.forEach((row, k) => {
      const h = c < row.length ? strip(row[c]) : "";
      if (!h || !/^[0-9A-Fa-f]+$/.test(h)) return;
      const bits = hexBits(h);
      for (let b = 0; b < Math.min(bits.length, names.length); b++) {
        const el = names[b];
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
  for (const [name, n, pre, mags] of analog) {
    let win = mags.slice(Math.max(0, startFault - lag), Math.max(startFault - lag + 1, end - lag));
    if (!win.length) win = mags;
    if (pmatch("^(I[ABCNGRSPQ]|IA|IB|IC|IN|IG|3I0|3I2|I1|I2|IP)\\w*$", n)) rec.currents.set(name, [pre, Math.max(...win)]);
    else if (pmatch("^V(A|B|C|AB|BC|CA|S|P|1|2)\\w*$", n)) rec.voltages.set(name, [pre, Math.min(...win)]);
  }

  const ordered = [...firstOn.entries()].map((e, idx) => [e[0], e[1], idx])
    .sort((a, b) => a[1] - b[1] || a[2] - b[2]);
  for (const [el, k] of ordered) rec.sequence.push([k / sam, el, "asserted"]);
  for (const el of [...preOn].sort())
    if (elementClass(el) && !["breaker status", "SELogic variable"].includes(elementClass(el)))
      rec.sequence.push([0.0, el, "pre"]);
  const trips = [...firstOn.entries()].filter(([el]) => TRIP_NAMES.has(el.toUpperCase())).map(([, k]) => k);
  if (trips.length) rec.trip_cycle = Math.min(...trips) / sam;
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
const ALL_EXTS = EVENT_EXTS.concat(SETTINGS_EXTS);
const extOf = (name) => { const m = /(\.[^.\\/]*)$/.exec(name); return m ? m[1].toLowerCase() : ""; };

/** files: [{name, bytes: Uint8Array}] in load order. */
async function loadFiles(files) {
  const events = [], rdb = new Map(), errors = [];
  for (const f of files) {
    const ext = extOf(f.name);
    try {
      if (SETTINGS_EXTS.includes(ext)) for (const [k, v] of await parseRdb(f.bytes, f.name)) rdb.set(k, v);
      else if (ext === ".cev") events.push(...parseCev(readText(f.bytes), f.name));
      else events.push(...parseText(readText(f.bytes), f.name));
    } catch (e) {
      errors.push(`${f.name}: ${e && e.message ? e.message : e}`);
    }
  }
  return { events, rdb, errors };
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
    cause.push(`Breaker opened ~${fx(rec.open_cycle - tc, 2)} cycles after trip (trip at ${fx(tc, 2)} cyc, 52A dropped at ${fx(rec.open_cycle, 2)} cyc).`);
  if (rec.shot && rec.shot !== "0") cause.push(`Reclose shot counter = ${rec.shot} (event occurred during a reclose sequence).`);
  cause.push(...rec.notes);

  if (rec.kind === "history" && tripped && !rec.dup_of)
    gaps.push("History row only, so the cause is read from the targets. Load this event's .CEV report to confirm which element tripped.");
  else if (rec.kind !== "history" && !rec.sequence.length && tripped)
    gaps.push("No relay element data in this file, so the tripping element is inferred from the front-panel targets. " +
              "Load the .CEV report for this event to confirm.");
  if (tripped && !settings.TR) {
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

  let level;
  if (rec.kind === "history") level = 1;
  else if (rec.sequence.length && settings.TR) level = 3;
  else if (rec.sequence.length || rec.targets) level = 2;
  else level = 1;
  if (checks.length) level -= checks.length >= 3 ? 2 : 1;
  level = Math.max(1, level);
  let basis = rec.kind === "history" ? "history row" : rec.sequence.length ? "element data" : rec.targets ? "targets only" : "event type only";
  if (settings.TR) basis += ", settings" + (label ? ` from ${label}` : " in event file");
  return { tripped, desc, cause, checks, gaps, confidence: { 3: "High", 2: "Medium", 1: "Low" }[level], basis, primary };
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
  const detailed = events.map((e, i) => [i + 1, e, eventDatetime(e)]).filter(([, e]) => e.kind === "event");
  for (const e of events) {
    if (e.kind !== "history") continue;
    const dt = eventDatetime(e);
    if (dt === null) continue;
    for (const [i, d, ddt] of detailed) {
      if (ddt !== null && Math.abs(ddt - dt) / 1e6 <= 1.0 &&
          (!e.relay_id || !d.relay_id || e.relay_id.toUpperCase() === d.relay_id.toUpperCase())) {
        e.notes.push(`Same event as #${i} (${d.source}), which has more detail.`);
        e.dup_of = i;
        break;
      }
    }
  }
}

function nowStamp(date) {
  const d = date || new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function buildReport(events, rdb, errors, nFiles, comments, opts) {
  opts = opts || {};
  comments = comments || "";
  const showSeq = opts.sequence !== false, showSettings = opts.settings !== false, showSer = opts.ser !== false;
  const now = opts.now || nowStamp();
  const ev = events.filter((e) => e.kind === "event" || e.kind === "history")
    .map((e, i) => [e, eventDatetime(e), i])
    .sort((a, b) => ((a[1] === null) - (b[1] === null)) || ((a[1] === null ? -Infinity : a[1]) - (b[1] === null ? -Infinity : b[1])) || (a[2] - b[2]))
    .map((x) => x[0]);
  for (const e of ev) { e.notes = e.notes.filter((n) => !n.startsWith("Same event as")); e.dup_of = null; }
  linkDuplicates(ev);
  const ser = events.filter((e) => e.kind === "ser");

  const analyses = ev.map((e) => {
    const [sRdb, label, how] = matchSettings(e, rdb);
    const s = Object.assign({}, e.settings, sRdb);
    return [e, s, label, how, analyzeEvent(e, s, how, label)];
  });
  const nItems = analyses.reduce((t, x) => t + x[4].checks.length + x[4].gaps.length, 0);
  const nEv = analyses.filter((x) => x[4].checks.length || x[4].gaps.length).length;

  const out = [];
  out.push("SEL TRIP EVENT SUMMARY", "=".repeat(60), `Generated: ${now}`,
           `Files analyzed: ${nFiles}   Events found: ${ev.length}   Settings databases: ${rdb.size}`);
  if (ev.length)
    out.push(`Needs review: ${nItems} item(s) to check across ${nEv} of ${ev.length} event(s)` + (nItems ? " - see the CHECK lines" : ""));
  out.push("");
  if (strip(comments)) { out.push("ANALYST COMMENTS / NOTES", "-".repeat(60), ...splitlines(strip(comments)), ""); }

  if (!ev.length && !ser.length) out.push("No event data recognized in the loaded files.");
  else {
    out.push("QUICK SUMMARY", "-".repeat(60));
    analyses.forEach(([e, s, , , a], idx) => {
      const when = strip(`${e.date} ${e.time}`) || "date n/a";
      const who = e.relay_id || e.terminal_id || e.source;
      out.push(`${String(idx + 1).padStart(2)}. ${when} | ${who} | ${e.event_type || "?"} | ${shortCause(e, s, a)}`);
    });
    out.push("", "EVENT DETAILS", "-".repeat(60));
    const shown = new Map();
    analyses.forEach(([e, s, label, , a], idx) => {
      const n = idx + 1;
      out.push(`Event ${n} of ${ev.length}  (${e.kind === "history" ? "history row" : "event report"})`);
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
      out.push("  Probable cause:");
      for (const c of a.cause) out.push(`    - ${c}`);
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
          const src = label ? `RDB: ${label}` : "event file";
          const sig = JSON.stringify([src, keys.map((k) => [k, s[k]])]);
          if (shown.has(sig)) out.push(`  Settings    : same as Event ${shown.get(sig)} (${src})`);
          else {
            shown.set(sig, n);
            out.push(`  Settings context (${src}):`);
            for (const k of keys) out.push(`    ${k} := ${s[k]}`);
          }
        }
      }
      out.push("");
    });
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
  if (rdb.size && !ev.length) {
    out.push("SETTINGS LOADED", "-".repeat(60));
    for (const [label, s] of rdb) out.push(`  ${label}: TR := ${s.TR !== undefined ? s.TR : "n/a"}`);
    out.push("");
  }
  if (errors.length) { out.push("FILES THAT COULD NOT BE READ", "-".repeat(60), ...errors.map((e) => "  " + e), ""); }
  out.push("Note: automated interpretation - verify against the relay oscillography and settings.");
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Report text -> blocks (for the formatted Word / print view)
// ---------------------------------------------------------------------------
const KV_RE = "^ {2}([A-Za-z][A-Za-z ./]{1,14}?)\\s*:\\s?(.*)$";
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
    if (!section && pmatch("^(Generated|Files analyzed|Needs review)\\b", s)) { add("meta", [s]); continue; }
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
    if (m && section === "EVENT DETAILS") { add("kv", [[strip(m[1]), strip(m[2]), false]]); continue; }
    if (section.startsWith("FILES THAT") && ln.startsWith("  ")) { add("bullets", [s]); continue; }
    para.push(s);
  }
  flush();
  return blocks;
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

const api = {
  loadFiles, buildReport, parseReportText, tripRuns, analyzeEvent, matchSettings, parseCev, parseText,
  parseRdb, readText, extOf, ALL_EXTS, EVENT_EXTS, SETTINGS_EXTS, nowStamp, fx, fc, pyTitle, elementClass,
};
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.SELCore = api;
})(typeof window !== "undefined" ? window : globalThis);
