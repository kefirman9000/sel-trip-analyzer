/* SEL Trip History - the analysis behind the history page.
 *
 * Reads the same files as the trip analyzer (through core.js), keeps one record
 * per real event across every file ever loaded, and works out, per location:
 * issue counts, recurring issues, fault hot spots (repeat faults at the same
 * distance), increasing/decreasing trends and a ranked "problem locations" list.
 * Also builds the historical report (Word blocks, text and CSV).
 *
 *   SELHistory.analyzeFiles([{name, path, bytes, site}]) -> {records, errors, settings}
 *   SELHistory.buildModel(records, cfg)                  -> model (stations, relays, issues, trends, ranking)
 *   SELHistory.reportBlocks(model, opts) / blocksToText(blocks) / eventsCsv(model) / locationsCsv(model)
 *
 * Works in browsers (window.SELHistory) and Node (module.exports). No dependencies besides core.js.
 */
(function (root) {
"use strict";
const isNode = typeof module !== "undefined" && module.exports;
const core = isNode ? require("./core.js") : root.SELCore;
if (isNode) { try { require("./analysis.js"); } catch (e) { /* COMTRADE reader is optional */ } }
const Plain = isNode ? require("./plain.js") : root.SELPlain;

const DAY = 86400e3;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const pad2 = (n) => String(n).padStart(2, "0");
const num = (s) => { const v = parseFloat(String(s === undefined || s === null ? "" : s).trim()); return Number.isFinite(v) ? v : null; };
const fx = (x, d) => (x === null || x === undefined || !Number.isFinite(x) ? "" : x.toFixed(d));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
const upper = (s) => String(s || "").trim().toUpperCase();

// ---------------------------------------------------------------------------
// Issue types
// ---------------------------------------------------------------------------
/** weight: extra points an event gets in the location score for having this issue (a trip is worth 1 by itself). */
const GROUPS = [
  ["faults", "Faults"],
  ["nofault", "Trips without a fault"],
  ["ops", "Outages"],
  ["protection", "Protection and breaker"],
  ["data", "Data gaps"],
];
const ISSUES = [
  { key: "f_slg", short: "Ground faults", group: "faults", label: "Phase-to-ground faults", weight: 0, advice: "Repeat ground faults on one circuit usually share a cause: trees, animals, a failing insulator or arrester. Patrol the line." },
  { key: "f_ll", short: "Phase faults", group: "faults", label: "Phase-to-phase faults", weight: 0, advice: "Repeat phase-to-phase faults point to conductor slap (wind, long spans) or something bridging two phases." },
  { key: "f_llg", short: "2-phase-ground", group: "faults", label: "Two-phase-to-ground faults", weight: 0, advice: "Often a broken crossarm, pole or tree on the line; check structures in the fault zone." },
  { key: "f_3ph", short: "3-phase faults", group: "faults", label: "Three-phase faults", weight: 0.5, advice: "Three-phase faults are usually severe (equipment failure, dig-in, vehicle). Find the cause each time." },
  { key: "trip_nofault", short: "No-fault trips", group: "nofault", label: "Trips with no fault found", weight: 1, advice: "Trips with no fault and no transfer-trip, frequency or voltage reason may be misoperations, manual opens or wiring problems." },
  { key: "transfer", short: "Transfer trips", group: "nofault", label: "Transfer / remote trips", weight: 0.5, advice: "Review each with the remote end's event to confirm a real fault was behind it; repeated ones may be channel noise." },
  { key: "underfreq", short: "Frequency trips", group: "nofault", label: "Underfrequency / frequency trips", weight: 0.5, advice: "Load shedding: correct only if the system frequency really fell. Repeated ones are a system issue, not this feeder." },
  { key: "lockout", short: "Lockouts", group: "ops", label: "Recloser lockouts", weight: 1.5, advice: "Each lockout is a sustained outage. Repeated lockouts on one circuit drive reliability indices." },
  { key: "slow_breaker", short: "Slow breaker", group: "protection", label: "Slow breaker clearing", weight: 2, advice: "The breaker took longer than usual to open. Test the breaker timing and the trip circuit; a worsening trend means it's getting worse." },
  { key: "breaker_status", short: "Breaker status", group: "protection", label: "Breaker status not seen / out of order", weight: 1, advice: "Check the 52A wiring and the breaker auxiliary contacts, or whether something else opened the breaker." },
  { key: "unexplained", short: "Unexplained trip", group: "protection", label: "Trip not explained by a protection element", weight: 1.5, advice: "Possible manual/SCADA open, external trip input or a logic problem. Check the trip equation and wiring." },
  { key: "z1_reach", short: "Zone 1 reach", group: "protection", label: "Zone 1 operated beyond its reach", weight: 1, advice: "Zone 1 overreach can trip for faults on the next section. Check the Zone 1 setting and the line impedance data." },
  { key: "beyond_line", short: "Beyond line end", group: "protection", label: "Fault located beyond the line end", weight: 0.5, advice: "Faults past the remote bus, or a location error: check the line impedance settings and adjacent sections." },
  { key: "reverse", short: "Behind relay", group: "protection", label: "Fault behind the relay (negative location)", weight: 0.5, advice: "Check directional elements and CT polarity if this relay is tripping for reverse faults." },
  { key: "mismatch", short: "Record mismatch", group: "protection", label: "Record disagrees with itself", weight: 0.5, advice: "Targets, event type or currents don't agree. Repeated mismatches can mean CT wiring or phase-rotation problems." },
  { key: "low_current", short: "Low current", group: "protection", label: "Low fault current (possible high-impedance fault)", weight: 1, advice: "Downed conductor or tree contact on a high-impedance path. Patrol carefully: these can be hazardous." },
  { key: "off_freq", short: "Off frequency", group: "protection", label: "Frequency off nominal", weight: 0.5, advice: "System frequency was well off nominal at the time of the event." },
  { key: "no_location", short: "No location", group: "protection", label: "No fault location", weight: 0.25, advice: "Too little fault data, or very fast clearing. Not a problem by itself." },
  { key: "other_check", short: "Other checks", group: "protection", label: "Other items to check", weight: 0.25, advice: "See the CHECK lines on each event." },
  { key: "no_settings", short: "No settings", group: "data", label: "No settings loaded", weight: 0, advice: "Add the relay's .RDB or settings text so trips can be checked against the trip equation and line length." },
  { key: "summary_only", short: "Summary only", group: "data", label: "Summary or history row only", weight: 0, advice: "Load the .CEV for these events to confirm which element tripped." },
];
const ISSUE = Object.fromEntries(ISSUES.map((x) => [x.key, x]));
const FAULT_KEYS = { AG: "f_slg", BG: "f_slg", CG: "f_slg", AB: "f_ll", BC: "f_ll", CA: "f_ll", ABG: "f_llg", BCG: "f_llg", CAG: "f_llg", ABC: "f_3ph", ABCG: "f_3ph" };

/** CHECK / gap text from core.analyzeEvent -> issue key. */
const CHECK_RULES = [
  [/Breaker took ([\d.]+) cycles to open/, "slow_breaker", (m) => `${m[1]} cycles`],
  [/No breaker-open indication|Breaker status dropped before/, "breaker_status"],
  [/No element from the trip equations|No protection element asserted before the trip/, "unexplained"],
  [/beyond typical Zone 1 reach/, "z1_reach"],
  [/beyond the end of the line/, "beyond_line"],
  [/Negative fault location/, "reverse"],
  [/Targets show phase|Targets and event type disagree|Highest fault current is on phase|Ground fault reported, but ground current|Significant ground current|event type shows a trip \(T\), but no TRIP|TRIP asserted in the record, but/, "mismatch"],
  [/barely rose above load/, "low_current"],
  [/couldn't calculate a fault location/, "no_location"],
  [/well off nominal/, "off_freq"],
  [/tripped without identifying a fault type/, null],   // covered by the event type
];
const GAP_RULES = [
  [/No settings for this relay|none match relay/, "no_settings"],
  [/History row only|No relay element data in this file/, "summary_only"],
];

/** Issue keys for one analyzed event (an item from core.prepareView). */
function issuesFor(it) {
  const e = it.e, a = it.a, out = new Map();
  const add = (key, detail) => { if (key && !out.has(key)) out.set(key, detail || ""); };
  const c = core.eventCore(e.event_type);
  const tokens = upper(e.targets).split(/\s+/).filter(Boolean);
  const cause = a.cause.join(" ");
  if (FAULT_KEYS[c]) add(FAULT_KEYS[c], c);
  else if (a.tripped) {
    if (tokens.includes("COMM") || /transfer trip|communications/i.test(cause) || a.primary.some((p) => /PTRX|TRCOMM|DTT|RX|TT/.test(p))) add("transfer");
    else if (tokens.includes("81") || /frequency \(81\)|Frequency element|underfrequency/i.test(cause)) add("underfreq");
    else add("trip_nofault");
  }
  if (tokens.includes("LO") || e.sequence.some(([, el, st]) => st === "asserted" && /^79LO/.test(el))) add("lockout");
  for (const chk of a.checks) {
    let hit = false;
    for (const [re, key, det] of CHECK_RULES) {
      const m = re.exec(chk);
      if (m) { hit = true; if (key) add(key, det ? det(m) : ""); break; }
    }
    if (!hit && !/were assumed to apply|isn't a code this tool|triggered very early/.test(chk)) add("other_check");
  }
  for (const g of a.gaps) for (const [re, key] of GAP_RULES) if (re.test(g)) add(key);
  if (out.has("underfreq")) out.delete("off_freq");
  return [...out].map(([key, detail]) => ({ key, detail }));
}

// ---------------------------------------------------------------------------
// Files -> event records
// ---------------------------------------------------------------------------
const isoDate = (ms) => (ms === null ? "" : new Date(ms).toISOString().slice(0, 10));
const isoTime = (ms) => (ms === null ? "" : new Date(ms).toISOString().slice(11, 23));
const monthKey = (ms) => isoDate(ms).slice(0, 7);
function phasesOf(c) { return FAULT_KEYS[c] ? c.replace("G", "") + (c.includes("G") && c !== "ABC" ? "G" : "") : ""; }

function faultCurrents(e) {
  const out = {};
  for (const [k, v] of e.currents) {
    const p = { IA: "A", IB: "B", IC: "C", IG: "G", IN: "N", "3I2": "Q", "Fault current": "F" }[k];
    if (p && v && Number.isFinite(v[1])) out[p] = Math.round(v[1]);
  }
  return out;
}

/** One record per event, from a core.prepareView item. */
function recordFrom(it, pathOf) {
  const e = it.e, a = it.a, s = it.s;
  const dt = it.dt;
  const ms = dt === null ? null : Math.round(dt / 1000);
  const c = core.eventCore(e.event_type);
  const locNum = e.location && !e.location.includes("$") ? num(e.location) : null;
  const ll = num(s.LL);
  const clear = e.trip_cycle !== null && e.open_cycle !== null && e.open_cycle > e.trip_cycle ? +(e.open_cycle - e.trip_cycle).toFixed(2) : null;
  const src = pathOf(e.source);
  return {
    id: it.id, relay: core.relayKey(e), station: core.strip(e.terminal_id || "") || core.strip(String(s.TID || s.SID || "")),
    stationFrom: e.terminal_id ? "record" : s.TID || s.SID ? "settings" : "", site: src.site || "",
    ms, date: isoDate(ms), time: isoTime(ms), rawDate: e.date, rawTime: e.time,
    et: e.event_type, core: c, group: FAULT_KEYS[c] ? ISSUE[FAULT_KEYS[c]].key : a.tripped ? "trip" : "other",
    phases: phasesOf(c), tripped: !!a.tripped, fault: !!FAULT_KEYS[c],
    primary: a.primary.slice(0, 6), targets: e.targets || "", loc: e.location || "", locNum, ll,
    locPct: locNum !== null && ll ? Math.round(100 * locNum / ll) : null, shot: e.shot || "", freq: e.freq || "",
    amps: faultCurrents(e), clearCyc: clear, kind: e.kind, hasWave: !!(e.wave || e.waveRef),
    issues: issuesFor(it), short: core.shortCause(e, s, a), desc: a.desc || "",
    cause: a.cause.slice(), checks: a.checks.slice(), gaps: a.gaps.slice(),
    evidence: (a.evidence || []).map((x) => x.text), confidence: a.confidence, basis: a.basis,
    seq: e.sequence.filter((x) => x[2] === "asserted").slice(0, 24).map(([cy, el]) => [+cy.toFixed(2), el]),
    waveId: e.waveRef ? e.waveRef.id : e.wave ? it.id : "",
    sources: [{ name: src.name, path: src.path, hash: src.hash || "" }],
    pair: it.pair ? core.relayKey(it.pair.other.e) : "", incident: it.incident ? it.incident.items.length : 0,
  };
}

const RICHNESS = (r) => (r.kind === "event" ? 2 : 0) + (r.seq.length ? 2 : 0) + (r.hasWave ? 1 : 0) + (r.checks.length + r.gaps.length ? 0 : 0.5);
/** Same relay, same fault type, within a second: the same event read from two files. */
function mergeRecords(records) {
  const out = [];
  const byRelay = new Map();
  for (const r of records) {
    const k = upper(r.relay);
    const list = byRelay.get(k) || [];
    const twin = list.find((x) => (x.id === r.id) ||
      (x.ms !== null && r.ms !== null && Math.abs(x.ms - r.ms) <= 1000 && (x.core === r.core || !x.core || !r.core)));
    if (!twin) { list.push(r); byRelay.set(k, list); out.push(r); continue; }
    const [keep, drop] = RICHNESS(r) > RICHNESS(twin) ? [r, twin] : [twin, r];
    const sources = keep.sources.concat(drop.sources.filter((s) => !keep.sources.some((k2) => k2.path === s.path)));
    if (keep === r) { Object.assign(twin, r); }
    twin.sources = sources;
    if (!twin.station && drop.station) { twin.station = drop.station; twin.stationFrom = drop.stationFrom; }
    if (!twin.site && drop.site) twin.site = drop.site;
  }
  return out;
}

/** files: [{name, path, bytes, site, hash}] -> {records, errors, settings: [[label, settings]]} */
async function analyzeFiles(files) {
  const byKey = new Map();
  const input = files.map((f, i) => {
    const key = f.path || f.name;
    const uniq = byKey.has(key) ? `${key}#${i}` : key;
    byKey.set(uniq, f);
    return { name: uniq, bytes: f.bytes };
  });
  const { events, rdb, errors } = await core.loadFiles(input);
  const pathOf = (source) => {
    const f = byKey.get(source);
    if (f) return { name: f.name, path: f.path || f.name, site: f.site || "", hash: f.hash || "" };
    // inside a zip: core uses the inner name; find the zip it came from is not possible, keep the name
    return { name: String(source).split("/").pop(), path: String(source), site: "", hash: "" };
  };
  const view = core.prepareView(events, rdb, {});
  const records = mergeRecords(view.items.filter((it) => it.e.dup_of === null).map((it) => recordFrom(it, pathOf)));
  // history rows that repeat a detailed report: remember the extra source
  for (const it of view.items.filter((x) => x.e.dup_of !== null)) {
    const r = records.find((x) => x.id === it.id);
    const src = pathOf(it.e.source);
    if (r && !r.sources.some((s) => s.path === src.path)) r.sources.push({ name: src.name, path: src.path, hash: src.hash });
  }
  // which settings files describe which relay, so an event can be sent to the Trip Analyzer with its settings
  const settingsFiles = {};
  for (const [name, f] of byKey) {
    const ext = core.extOf(f.name);
    let rids = [];
    try {
      if (core.SETTINGS_EXTS.includes(ext)) rids = [...(await core.parseRdb(f.bytes, f.name))].map(([k, v]) => v.RID || k);
      else if (core.SETTINGS_TEXT_EXTS.includes(ext)) { const st = core.settingsFromText(core.readText(f.bytes), f.name); if (st) rids = [st[1].RID || st[0]]; }
    } catch (e) { /* not readable: already reported */ }
    for (const rid of rids) (settingsFiles[upper(rid)] = settingsFiles[upper(rid)] || []).push({ name: f.name, path: f.path || f.name, hash: f.hash || "" });
  }
  for (const r of records) r.settingsFiles = settingsFiles[upper(r.relay)] || [];
  const settings = [...rdb].map(([label, s]) => [label, { RID: s.RID || "", TID: s.TID || "", SID: s.SID || "", LL: s.LL || "", file: s.__file__ || "" }]);
  return { records, errors: errors.map((x) => x.replace(/#\d+:/, ":")), settings, settingsFiles };
}

// ---------------------------------------------------------------------------
// The model: stations, relays, issues, trends, ranking
// ---------------------------------------------------------------------------
const DEFAULTS = {
  asOf: "",            // YYYY-MM-DD; empty = the latest event in the data
  trendDays: 90,       // compare the last N days with the N days before
  recurDays: 90,       // faults are recurring when they happen recurMin times within recurDays,
  recurDaysOther: 365, // other issues (breaker, protection, trips with no fault...) within recurDaysOther
  recurMin: 3,
  yearDays: 365,       // the longer trend: the last year against the year before
  hotTol: 0.2,         // faults within this many line-length units (or hotTolPct % of the line) are "the same spot"
  hotTolPct: 2,
  hotMin: 3,
  halfLifeDays: 365,   // older events count for less in the score
  sequenceMinutes: 10, // reports on one relay this close together are one occasion (a reclose sequence)
  from: "", to: "",    // limit everything to this date range
  stormWeight: 0.6,    // a trip in a storm counts this much in the score (weather, not the line)
  slowCycles: 5,       // breaker clearing slower than this is "slow"
  slowingPerYear: 0.5, // clearing time rising this many cycles a year (or more) is "slowing"
  weather: {},         // record id -> {text, kinds: ["lightning", "wind", ...] or ["calm"], location}
  reviews: {},         // record id -> PRC-004 review from the Trip Analyzer {outcome: correct|misop|na, category, cause, reviewer, date, ...}
  reviewDays: 120,     // PRC-004-6 R1: decide within 120 days
  today: "",           // YYYY-MM-DD for "overdue"; empty = today
  customers: {},       // relay -> customers served
  sustained: "lockout", // "lockout": a lockout is a sustained interruption, other trips momentary; "all": every trip is sustained
  overrides: {},       // relay -> station
  worklog: {},         // relay -> [{date, text}]
};

/** Up / down / flat between the last `days` and the `days` before, ending at `anchor`. */
function trendOf(times, anchor, days) {
  const w = days * DAY;
  let recent = 0, prev = 0;
  for (const t of times) {
    if (t === null || t > anchor) continue;
    if (t > anchor - w) recent++;
    else if (t > anchor - 2 * w) prev++;
  }
  let dir = "flat", label = "Steady";
  if (recent + prev < 2) { dir = "few"; label = recent ? "Isolated" : "Quiet"; }
  else if (prev === 0 && recent >= 2) { dir = "up"; label = "New"; }
  else if (recent >= 1.5 * prev && recent - prev >= 2) { dir = "up"; label = "Increasing"; }
  else if (prev >= 1.5 * recent && prev - recent >= 2) { dir = "down"; label = recent ? "Decreasing" : "Stopped"; }
  return { dir, label, recent, prev, days, text: `${recent} in the last ${days} days vs ${prev} in the ${days} days before` };
}

/** One verdict from the short (e.g. 90-day) and the year-on-year comparison: a recent rise wins, then the year's direction. */
function combineTrends(short, year) {
  let pick = short;
  if (short.dir !== "up" && (year.dir === "up" || year.dir === "down")) pick = year;
  else if (short.dir === "few" && year.dir === "flat") pick = year;
  return Object.assign({}, pick, { short, year, basis: pick === year ? "year" : "short" });
}

/** Month keys from first to last inclusive (YYYY-MM). */
function monthRange(firstMs, lastMs) {
  const out = [];
  const a = new Date(firstMs), b = new Date(lastMs);
  let y = a.getUTCFullYear(), m = a.getUTCMonth();
  while (y < b.getUTCFullYear() || (y === b.getUTCFullYear() && m <= b.getUTCMonth())) {
    out.push(`${y}-${pad2(m + 1)}`);
    if (++m === 12) { m = 0; y++; }
  }
  return out;
}
function monthly(records, months, pick) {
  const idx = new Map(months.map((k, i) => [k, i]));
  const out = months.map(() => 0);
  for (const r of records) { if (r.ms === null) continue; const i = idx.get(monthKey(r.ms)); if (i !== undefined && (!pick || pick(r))) out[i]++; }
  return out;
}

/** Largest number of times within `days`, and that window. */
function bestWindow(times, days) {
  const t = times.filter((x) => x !== null).sort((a, b) => a - b);
  let best = { n: 0, from: null, to: null };
  for (let i = 0, j = 0; j < t.length; j++) {
    while (t[j] - t[i] > days * DAY) i++;
    if (j - i + 1 > best.n) best = { n: j - i + 1, from: t[i], to: t[j] };
  }
  return best;
}

/** Faults at the same distance on one relay. */
function hotSpots(recs, cfg) {
  const pts = recs.filter((r) => r.fault && r.locNum !== null && r.locNum >= 0).sort((a, b) => a.locNum - b.locNum);
  if (pts.length < cfg.hotMin) return [];
  const ll = pts.find((r) => r.ll)?.ll || null;
  const tol = Math.max(cfg.hotTol, ll ? ll * cfg.hotTolPct / 100 : 0);
  const clusters = [];
  let cur = [];
  for (const r of pts) {
    if (cur.length && (r.locNum - cur[cur.length - 1].locNum > tol || r.locNum - cur[0].locNum > 2 * tol)) { clusters.push(cur); cur = []; }
    cur.push(r);
  }
  if (cur.length) clusters.push(cur);
  return clusters.filter((c) => c.length >= cfg.hotMin).map((c) => {
    const locs = c.map((r) => r.locNum).sort((a, b) => a - b);
    const mid = locs[Math.floor(locs.length / 2)];
    const phases = {};
    for (const r of c) phases[r.phases || "?"] = (phases[r.phases || "?"] || 0) + 1;
    const times = c.map((r) => r.ms).filter((x) => x !== null).sort((a, b) => a - b);
    return { at: mid, from: locs[0], to: locs[locs.length - 1], tol, ll, pct: ll ? Math.round(100 * mid / ll) : null,
             n: c.length, ids: c.map((r) => r.id), phases, first: times[0] ?? null, last: times[times.length - 1] ?? null };
  }).sort((a, b) => b.n - a.n || a.at - b.at);
}

function topEntries(obj, n) { return Object.entries(obj).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n); }

/** records (from analyzeFiles, merged across every load) + cfg -> model */
function buildModel(allRecords, cfgIn) {
  const cfg = Object.assign({}, DEFAULTS, cfgIn || {});
  const fromMs = cfg.from ? Date.parse(cfg.from + "T00:00:00Z") : null, toMs = cfg.to ? Date.parse(cfg.to + "T23:59:59.999Z") : null;
  const inRange = (r) => (fromMs === null || (r.ms !== null && r.ms >= fromMs)) && (toMs === null || (r.ms !== null && r.ms <= toMs));
  const records = allRecords.filter(inRange).slice().sort((a, b) => (a.ms === null) - (b.ms === null) || (a.ms || 0) - (b.ms || 0) || (a.relay < b.relay ? -1 : 1));

  // station for every relay: an override, else what its own records or settings say, else the folder it came from
  const stationOf = new Map();
  for (const r of records) {
    const k = upper(r.relay);
    const cur = stationOf.get(k);
    if (r.station && (!cur || cur.from !== "record")) stationOf.set(k, { name: r.station, from: r.stationFrom || "record" });
    else if (!cur && r.site) stationOf.set(k, { name: r.site, from: "folder" });
  }
  const overrides = Object.fromEntries(Object.entries(cfg.overrides || {}).map(([k, v]) => [upper(k), v]));
  for (const r of records) {
    const k = upper(r.relay);
    const st = overrides[k] ? { name: overrides[k], from: "override" } : stationOf.get(k) || { name: "Unassigned", from: "none" };
    r.stationName = st.name; r.stationFrom2 = st.from;
  }

  const todayMs = Date.parse((cfg.today || new Date().toISOString().slice(0, 10)) + "T00:00:00Z");
  for (const r of records) {
    const w = cfg.weather[r.id] || null;
    r.wx = w; r.storm = w ? !w.kinds.includes("calm") : null;
    const rv = cfg.reviews[r.id] || null;
    r.review = rv && rv.outcome ? rv : null;
    r.reviewDue = r.tripped && r.ms !== null ? isoDate(r.ms + cfg.reviewDays * DAY) : "";
    r.reviewStatus = !r.tripped ? "" : r.review ? r.review.outcome : r.ms !== null && r.ms + cfg.reviewDays * DAY < todayMs ? "overdue" : "open";
  }
  const dated = records.filter((r) => r.ms !== null);
  const latest = dated.length ? dated[dated.length - 1].ms : Date.now();
  const anchor = cfg.asOf ? Date.parse(cfg.asOf + "T23:59:59.999Z") : latest;
  const first = dated.length ? dated[0].ms : anchor;
  const months = dated.length ? monthRange(first, anchor) : [];
  const last12 = months.slice(-12);

  // ---- relays
  const relays = new Map();
  for (const r of records) {
    const k = upper(r.relay);
    if (!relays.has(k)) relays.set(k, { key: k, relay: r.relay, station: r.stationName, stationFrom: r.stationFrom2, records: [] });
    relays.get(k).records.push(r);
  }
  const recurring = [], hot = [];
  for (const L of relays.values()) {
    const recs = L.records;
    // a reclose sequence (or several reports of one disturbance) is one occasion
    const occs = [];
    for (const r of recs) {
      const last = occs[occs.length - 1];
      if (last && r.ms !== null && last.end !== null && r.ms - last.end <= cfg.sequenceMinutes * 60e3) { last.recs.push(r); last.end = r.ms; }
      else occs.push({ ms: r.ms, end: r.ms, recs: [r] });
    }
    occs.forEach((o, i) => {
      o.n = i + 1; o.id = o.recs[0].id; o.tripped = o.recs.some((r) => r.tripped);
      const wx = o.recs.find((r) => r.wx);
      o.storm = wx ? wx.storm : null;
      o.issues = new Map();
      for (const r of o.recs) { r.occ = `${L.key}#${o.n}`; r.occSize = o.recs.length; for (const x of r.issues) if (!o.issues.has(x.key)) o.issues.set(x.key, r); }
    });
    L.occasions = occs.length;
    L.tripTimes = occs.filter((o) => o.tripped).map((o) => o.ms);
    const trips = recs.filter((r) => r.tripped);
    const tripOccs = occs.filter((o) => o.tripped);
    L.events = recs.length; L.trips = trips.length; L.tripOccasions = tripOccs.length; L.faults = recs.filter((r) => r.fault).length;
    L.first = recs.find((r) => r.ms !== null)?.ms ?? null;
    L.last = [...recs].reverse().find((r) => r.ms !== null)?.ms ?? null;
    L.lastTrip = [...trips].reverse().find((r) => r.ms !== null)?.ms ?? null;
    L.review = recs.filter((r) => r.checks.length).length;
    L.ll = recs.find((r) => r.ll)?.ll || null;
    L.station = recs[0].stationName;
    // issue counts (occasions)
    const counts = {};
    const byIssue = new Map();
    for (const o of occs) for (const [key, r] of o.issues) {
      counts[key] = (counts[key] || 0) + 1;
      if (!byIssue.has(key)) byIssue.set(key, []);
      byIssue.get(key).push(r);
    }
    L.counts = counts;
    const phases = { A: 0, B: 0, C: 0, G: 0 };
    for (const o of occs) { const r = o.recs.find((x) => x.fault); if (r) for (const p of r.phases) if (has(phases, p)) phases[p]++; }
    L.phases = phases;
    // trends
    L.trendShort = trendOf(L.tripTimes, anchor, cfg.trendDays);
    L.trendYear = trendOf(L.tripTimes, anchor, cfg.yearDays);
    L.trend = combineTrends(L.trendShort, L.trendYear);
    L.issueTrends = {};
    const both = (times) => combineTrends(trendOf(times, anchor, cfg.trendDays), trendOf(times, anchor, cfg.yearDays));
    for (const [key, list] of byIssue) L.issueTrends[key] = both(list.map((r) => r.ms));
    L.monthly = monthly(trips, months);
    L.spark = monthly(trips, last12);
    // recurring issues
    L.recurring = [];
    for (const [key, list] of byIssue) {
      if (ISSUE[key].group === "data") continue;
      const days = ISSUE[key].group === "faults" ? cfg.recurDays : cfg.recurDaysOther;
      const w = bestWindow(list.map((r) => r.ms), days);
      if (w.n >= cfg.recurMin) {
        const occIds = (r) => recs.filter((x) => x.occ === r.occ).map((x) => x.id);
        const phaseCount = {};
        for (const r of list) if (r.phases) phaseCount[r.phases] = (phaseCount[r.phases] || 0) + 1;
        const det = key === "slow_breaker" ? list.map((r) => r.clearCyc).filter((x) => x !== null) : null;
        const item = { relayKey: L.key, relay: L.relay, station: L.station, key, label: ISSUE[key].label, total: list.length,
                       inWindow: w.n, windowDays: days, from: w.from, to: w.to,
                       ids: list.filter((r) => r.ms !== null && r.ms >= w.from && r.ms <= w.to).flatMap(occIds), allIds: list.flatMap(occIds),
                       last: list[list.length - 1].ms, trend: L.issueTrends[key], phases: phaseCount,
                       clearing: det && det.length ? { first: det[0], last: det[det.length - 1], max: Math.max(...det) } : null,
                       advice: ISSUE[key].advice };
        L.recurring.push(item); recurring.push(item);
      }
    }
    L.recurring.sort((a, b) => b.inWindow - a.inWindow);
    const oneEach = occs.map((o) => o.recs.find((r) => r.fault && r.locNum !== null) || o.recs[0]);
    L.hotspots = hotSpots(oneEach, cfg).map((h) => Object.assign(h, { relayKey: L.key, relay: L.relay, station: L.station,
      ids: recs.filter((r) => h.ids.some((id) => r.occ === recs.find((x) => x.id === id).occ)).map((r) => r.id) }));
    hot.push(...L.hotspots);
    L.worklog = (cfg.worklog[L.relay] || cfg.worklog[L.key] || []).slice().sort((a, b) => (a.date < b.date ? -1 : 1));

    // ---- weather
    const known = occs.filter((o) => o.tripped && o.storm !== null);
    const kinds = {};
    for (const o of known) { const w = o.recs.find((r) => r.wx).wx; for (const k of w.kinds) if (k !== "calm") kinds[k] = (kinds[k] || 0) + 1; }
    L.wx = { known: known.length, storm: known.filter((o) => o.storm).length, calm: known.filter((o) => !o.storm).length, kinds, unknown: L.tripOccasions - known.length };
    for (const x of L.recurring) {
      if (ISSUE[x.key].group !== "faults" && x.key !== "lockout") continue;   // weather explains faults, not breaker or scheme problems
      const os = occs.filter((o) => o.issues.has(x.key) && o.storm !== null);
      if (os.length >= 3) {
        const calm = os.filter((o) => !o.storm).length;
        x.weather = { known: os.length, calm, storm: os.length - calm };
        if (calm / os.length >= 0.7) x.weatherNote = `${calm} of ${os.length} happened in calm weather, so storms don't explain them: look for equipment, animals or vegetation growing into the line.`;
        else if (calm / os.length <= 0.3) x.weatherNote = `${os.length - calm} of ${os.length} happened in storms: the line may be exposed (trees, lightning protection, conductor spacing).`;
      }
    }

    // ---- PRC-004 reviews (made in the Trip Analyzer)
    const tr = recs.filter((r) => r.tripped);
    L.rev = { trips: tr.length, reviewed: tr.filter((r) => r.review).length, misop: tr.filter((r) => r.reviewStatus === "misop").length,
              correct: tr.filter((r) => r.reviewStatus === "correct").length, overdue: tr.filter((r) => r.reviewStatus === "overdue").length,
              open: tr.filter((r) => r.reviewStatus === "open").length };

    // ---- customers: interruptions in the last year (estimate: every trip occasion interrupts the whole circuit)
    const cust = num(cfg.customers[L.relay] ?? cfg.customers[L.key]);
    const yearOccs = occs.filter((o) => o.tripped && o.ms !== null && o.ms > anchor - 365 * DAY && o.ms <= anchor);
    const sus = yearOccs.filter((o) => cfg.sustained === "all" || o.issues.has("lockout")).length;
    L.cust = cust ? { customers: cust, occ: yearOccs.length, sustained: sus, momentary: yearOccs.length - sus, ci: cust * sus, cmi: cust * (yearOccs.length - sus) } : null;

    // ---- breaker health: how fast it clears, and how much current it has interrupted
    L.breaker = breakerHealth(L, occs, cfg, anchor);

    // ---- score
    const why = [];
    let base = 0, extra = 0;
    for (const o of occs) {
      if (o.ms === null) continue;
      const age = Math.max(0, (anchor - o.ms) / DAY);
      const f = Math.pow(0.5, age / cfg.halfLifeDays) * (o.storm ? cfg.stormWeight : 1);
      base += (o.tripped ? 1 : 0.25) * f;
      for (const key of o.issues.keys()) extra += ISSUE[key].weight * f;
    }
    const stormy = occs.filter((o) => o.storm).length;
    if (base) why.push([`${plural(L.tripOccasions, "trip")}${L.trips > L.tripOccasions ? ` (${L.trips} operations counting recloses)` : ""}${L.occasions > L.tripOccasions ? `, ${L.occasions - L.tripOccasions} other events` : ""}; older ones count less${stormy ? `, ${stormy} in storms count ${Math.round(cfg.stormWeight * 100)}%` : ""}`, base]);
    if (extra) why.push(["Severity of the issues found", extra]);
    const rec = 2 * L.recurring.length, hs = 1.5 * L.hotspots.length;
    if (rec) why.push([`${plural(L.recurring.length, "recurring issue")}`, rec]);
    if (hs) why.push([`${plural(L.hotspots.length, "fault hot spot")}`, hs]);
    const bk = L.breaker && L.breaker.slowing ? 2 : 0;
    if (bk) why.push([`Breaker clearing time rising (${L.breaker.slope.toFixed(1)} cycles a year)`, bk]);
    let score = base + extra + rec + hs + bk;
    const mult = L.trend.dir === "up" ? 1.3 : L.trend.dir === "down" ? 0.85 : 1;
    if (mult !== 1) { why.push([`Trend ${L.trend.label.toLowerCase()} (${L.trend.text})`, score * (mult - 1)]); score *= mult; }
    L.score = +score.toFixed(1);
    L.why = why.map(([t, p]) => ({ text: t, points: +p.toFixed(1) }));
    L.top = topEntries(Object.fromEntries(Object.entries(counts).filter(([key]) => ISSUE[key].group !== "data")), 4)
      .map(([key, n]) => ({ key, label: ISSUE[key].label, n, recurring: L.recurring.some((x) => x.key === key) }));
  }

  const ranked = [...relays.values()].sort((a, b) => b.score - a.score || b.trips - a.trips || (a.relay < b.relay ? -1 : 1));
  ranked.forEach((L, i) => { L.rank = i + 1; });

  // ---- stations
  const stations = new Map();
  for (const L of ranked) {
    if (!stations.has(L.station)) stations.set(L.station, { name: L.station, relays: [], score: 0, trips: 0, events: 0, recurring: 0, hotspots: 0, records: [] });
    const S = stations.get(L.station);
    S.relays.push(L); S.score += L.score; S.trips += L.trips; S.events += L.events; S.recurring += L.recurring.length; S.hotspots += L.hotspots.length;
    S.records.push(...L.records);
  }
  for (const S of stations.values()) {
    S.score = +S.score.toFixed(1);
    const st = S.relays.flatMap((L) => L.tripTimes);
    S.trend = combineTrends(trendOf(st, anchor, cfg.trendDays), trendOf(st, anchor, cfg.yearDays));
    S.spark = monthly(S.records.filter((r) => r.tripped), last12);
    S.last = S.records.reduce((m, r) => (r.ms !== null && (m === null || r.ms > m) ? r.ms : m), null);
    delete S.records;
  }
  const stationList = [...stations.values()].sort((a, b) => b.score - a.score);

  // ---- issues across everything
  const issueStats = ISSUES.map((I) => {
    const list = records.filter((r) => r.issues.some((x) => x.key === I.key));
    const where = {};
    for (const r of list) where[r.relay] = (where[r.relay] || 0) + 1;
    return { key: I.key, label: I.label, group: I.group, n: list.length, relays: Object.keys(where).length,
             trend: combineTrends(trendOf(list.map((r) => r.ms), anchor, cfg.trendDays), trendOf(list.map((r) => r.ms), anchor, cfg.yearDays)), monthly: monthly(list, months), where };
  }).filter((x) => x.n);

  // ---- whole system
  const tripsAll = records.filter((r) => r.tripped);
  const byMonth = months.map((m) => ({ month: m, faults: 0, nofault: 0, other: 0 }));
  const mi = new Map(months.map((m, i) => [m, i]));
  for (const r of records) {
    if (r.ms === null) continue;
    const i = mi.get(monthKey(r.ms)); if (i === undefined) continue;
    if (r.fault && r.tripped) byMonth[i].faults++; else if (r.tripped) byMonth[i].nofault++; else byMonth[i].other++;
  }
  recurring.sort((a, b) => b.inWindow - a.inWindow || (b.last || 0) - (a.last || 0));
  hot.sort((a, b) => b.n - a.n);
  const breakers = ranked.filter((L) => L.breaker).map((L) => L.breaker)
    .sort((a, b) => (b.slowing - a.slowing) || (b.latest - a.latest));
  const revAll = { trips: 0, reviewed: 0, misop: 0, correct: 0, overdue: 0, open: 0 };
  for (const L of ranked) for (const k of Object.keys(revAll)) revAll[k] += L.rev[k];
  revAll.overdueList = records.filter((r) => r.reviewStatus === "overdue").sort((a, b) => a.ms - b.ms);
  revAll.misopList = records.filter((r) => r.reviewStatus === "misop");
  const withCust = ranked.filter((L) => L.cust);
  const custAll = withCust.length ? (() => {
    const served = withCust.reduce((a, L) => a + L.cust.customers, 0), ci = withCust.reduce((a, L) => a + L.cust.ci, 0), cmi = withCust.reduce((a, L) => a + L.cust.cmi, 0);
    return { served, ci, cmi, saifi: ci / served, maifi: cmi / served, locations: withCust.length, missing: ranked.length - withCust.length,
             ranked: withCust.slice().sort((a, b) => b.cust.ci + b.cust.cmi * 0.1 - (a.cust.ci + a.cust.cmi * 0.1)) };
  })() : null;
  const wxAll = { known: 0, storm: 0, calm: 0, kinds: {} };
  for (const L of ranked) { wxAll.known += L.wx.known; wxAll.storm += L.wx.storm; wxAll.calm += L.wx.calm; for (const [k, n] of Object.entries(L.wx.kinds)) wxAll.kinds[k] = (wxAll.kinds[k] || 0) + n; }
  return {
    cfg, anchor, first, latest, months, byMonth, records, relays: ranked, stations: stationList, issues: issueStats,
    recurring, hotspots: hot, breakers, wx: wxAll, reviews: revAll, customers: custAll, byId: new Map(records.map((r) => [r.id, r])),
    totals: { events: records.length, trips: tripsAll.length, faults: records.filter((r) => r.fault).length,
              review: records.filter((r) => r.checks.length).length, relays: ranked.length, stations: stationList.length,
              undated: records.filter((r) => r.ms === null).length,
              up: ranked.filter((L) => L.trend.dir === "up").length, down: ranked.filter((L) => L.trend.dir === "down").length },
    trend: combineTrends(trendOf(ranked.flatMap((L) => L.tripTimes), anchor, cfg.trendDays), trendOf(ranked.flatMap((L) => L.tripTimes), anchor, cfg.yearDays)),
  };
}

// ---------------------------------------------------------------------------
// Breaker health
// ---------------------------------------------------------------------------
/** Least-squares slope (per x unit) and intercept. */
function fitLine(pts) {
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  let sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); }
  if (!sxx) return null;
  const slope = sxy / sxx;
  return { slope, at: (x) => my + slope * (x - mx) };
}
/** Clearing times (trip to breaker open, from element data) and fault current interrupted, for one relay's breaker. */
function breakerHealth(L, occs, cfg, anchor) {
  const ops = L.records.filter((r) => r.tripped && r.ms !== null);
  const pts = L.records.filter((r) => r.clearCyc !== null && r.ms !== null).map((r) => ({ ms: r.ms, cyc: r.clearCyc, id: r.id }));
  const amps = (r) => Math.max(0, ...["A", "B", "C"].map((p) => r.amps[p] || 0), r.amps.F || 0);
  let kA = 0, kA2 = 0;
  for (const r of ops) { const a = amps(r) / 1000; kA += a; kA2 += a * a; }
  if (!pts.length && !ops.length) return null;
  const out = { relayKey: L.key, relay: L.relay, station: L.station, ops: ops.length, kA: +kA.toFixed(1), kA2: +kA2.toFixed(1),
                points: pts, n: pts.length, latest: pts.length ? pts[pts.length - 1].cyc : null, first: pts.length ? pts[0].cyc : null,
                max: pts.length ? Math.max(...pts.map((p) => p.cyc)) : null, slow: pts.filter((p) => p.cyc > cfg.slowCycles).length,
                slope: 0, slowing: false, reach: null, fit: null, limit: cfg.slowCycles };
  if (pts.length >= 3) {
    const t0 = pts[0].ms;
    const f = fitLine(pts.map((p) => [(p.ms - t0) / (365.25 * DAY), p.cyc]));
    if (f) {
      out.slope = f.slope;
      out.fit = { from: [pts[0].ms, f.at(0)], to: [pts[pts.length - 1].ms, f.at((pts[pts.length - 1].ms - t0) / (365.25 * DAY))] };
      out.slowing = f.slope >= cfg.slowingPerYear && out.latest - out.first >= 1;
      const nowY = (anchor - t0) / (365.25 * DAY), nowV = f.at(nowY);
      if (out.slowing && nowV < cfg.slowCycles) out.reach = Math.round(anchor + ((cfg.slowCycles - nowV) / f.slope) * 365.25 * DAY);
    }
  }
  out.verdict = !pts.length ? "No clearing times (needs .CEV or COMTRADE with the breaker status)"
    : out.slowing ? (out.latest > cfg.slowCycles ? `Slow and getting slower: ${out.first} → ${out.latest} cycles` : `Getting slower: ${out.first} → ${out.latest} cycles; ${out.reach ? "reaches " + cfg.slowCycles + " cycles around " + isoDate(out.reach) : ""}`)
    : out.slow ? `${plural(out.slow, "slow opening")} (over ${cfg.slowCycles} cycles), not a steady trend` : `Normal: latest ${out.latest} cycles`;
  return out;
}

// ---------------------------------------------------------------------------
// What changed: the model now against the model built from the events seen before
// ---------------------------------------------------------------------------
/** before, after: models; newIds: ids of events added since. -> [{kind, relayKey, relay, station, text, ids, level}] */
function changes(before, after, newIds) {
  const out = [];
  const B = new Map(before.relays.map((L) => [L.key, L])), fresh = new Set(newIds);
  const add = (L, kind, text, ids, level) => out.push({ kind, relayKey: L.key, relay: L.relay, station: L.station, text, ids: ids || [], level: level || 1 });
  for (const L of after.relays) {
    const b = B.get(L.key);
    const mine = L.records.filter((r) => fresh.has(r.id));
    if (!b) { add(L, "new", `New location: ${plural(L.events, "event")}${L.recurring.length ? `, ${plural(L.recurring.length, "recurring issue")} already` : ""}`, mine.map((r) => r.id), 2); }
    else if (mine.length) add(L, "events", `${plural(mine.length, "new event")}${mine.filter((r) => r.tripped).length ? ` (${mine.filter((r) => r.tripped).length} trips)` : ""}, latest ${isoDate(Math.max(...mine.map((r) => r.ms || 0)))}`, mine.map((r) => r.id), 0);
    if (!b) continue;
    for (const x of L.recurring) {
      const was = b.recurring.find((y) => y.key === x.key);
      if (!was) add(L, "recurring", `Now recurring: ${x.label.toLowerCase()} (${x.inWindow} in ${x.windowDays} days)`, x.allIds, 3);
      else if (x.inWindow > was.inWindow) add(L, "recurring", `${x.label} more often: ${was.inWindow} → ${x.inWindow} in ${x.windowDays} days`, x.allIds, 2);
    }
    for (const y of b.recurring) if (!L.recurring.some((x) => x.key === y.key)) add(L, "eased", `No longer recurring: ${y.label.toLowerCase()}`, [], 0);
    for (const h of L.hotspots) {
      const was = b.hotspots.find((g) => Math.abs(g.at - h.at) <= Math.max(h.tol, g.tol));
      if (!was) add(L, "hotspot", `New fault hot spot: ${h.n} faults at ${fx(h.from, 2)} to ${fx(h.to, 2)}`, h.ids, 3);
      else if (h.n > was.n) add(L, "hotspot", `Hot spot at ~${fx(h.at, 2)} grew: ${was.n} → ${h.n} faults`, h.ids, 2);
    }
    if (L.trend.dir !== b.trend.dir && (L.trend.dir === "up" || L.trend.dir === "down"))
      add(L, "trend", `Trips now ${L.trend.label.toLowerCase()} (${trendWords(L.trend)})`, [], L.trend.dir === "up" ? 2 : 0);
    if (L.breaker && L.breaker.slowing && !(b.breaker && b.breaker.slowing)) add(L, "breaker", `Breaker getting slower: ${L.breaker.first} → ${L.breaker.latest} cycles`, L.breaker.points.map((p) => p.id), 3);
    else if (L.breaker && b.breaker && L.breaker.latest !== null && b.breaker.latest !== null && L.breaker.latest > b.breaker.latest + 0.5 && L.breaker.latest > L.limit)
      add(L, "breaker", `Breaker cleared slower: ${b.breaker.latest} → ${L.breaker.latest} cycles`, L.breaker.points.map((p) => p.id), 2);
    if (b.rank - L.rank >= 2 || (L.rank <= 3 && b.rank > 3)) add(L, "rank", `Moved up to #${L.rank} (was #${b.rank})`, [], L.rank <= 3 ? 2 : 1);
  }
  const order = { new: 0, recurring: 1, hotspot: 2, breaker: 3, trend: 4, rank: 5, events: 6, eased: 7 };
  return out.sort((a, b) => b.level - a.level || order[a.kind] - order[b.kind] || (a.relay < b.relay ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Report: Word blocks (docx.js), text and CSV
// ---------------------------------------------------------------------------
const fmtDate = (ms) => (ms === null || ms === undefined ? "-" : isoDate(ms));
const fmtWhen = (r) => (r.ms === null ? `${r.rawDate} ${r.rawTime}`.trim() || "(no date)" : `${r.date} ${r.time.slice(0, 8)}`);
const arrow = (t) => (t.dir === "up" ? "▲ " : t.dir === "down" ? "▼ " : "") + t.label;
/** Issue names, technical or in everyday words. */
const issueLabel = (k, plain) => (plain && Plain ? Plain.issue(k)[1] : ISSUE[k].label);
const issueShort = (k, plain) => (plain && Plain ? Plain.issue(k)[0] : ISSUE[k].short);
const issueList = (r, plain) => r.issues.filter((x) => ISSUE[x.key].group !== "data").map((x) => issueLabel(x.key, plain) + (x.detail && !FAULT_KEYS[x.detail] ? ` (${x.detail})` : "")).join("; ");
/** An event in one line: the analysis's summary, or a plain-English sentence. */
const whatHappened = (r, plain) => (plain && Plain ? Plain.sentence(r, { withChecks: false }) : r.short.replace(/\s+\[\d+ to check\]$/, ""));
const WX_LABEL = { lightning: "thunderstorm", wind: "wind", ice: "ice/snow", rain: "heavy rain", heat: "heat" };
const trendWords = (t) => (t.days >= 360 ? `${t.recent} in the last year vs ${t.prev} the year before` : `${t.recent} in the last ${t.days} days vs ${t.prev} before`);
const whereText = (L) => `${L.relay}${L.station && L.station !== "Unassigned" ? ` (${L.station})` : ""}`;

/** Narrow the model to some stations/relays (report scope). */
function scoped(model, opts) {
  const st = opts.station || "", rl = upper(opts.relay || "");
  const relays = model.relays.filter((L) => (!st || L.station === st) && (!rl || L.key === rl));
  const keys = new Set(relays.map((L) => L.key));
  return { relays, keys, recurring: model.recurring.filter((x) => keys.has(x.relayKey)), hotspots: model.hotspots.filter((h) => keys.has(h.relayKey)),
           records: model.records.filter((r) => keys.has(upper(r.relay))) };
}

/** opts: {station, relay, sections: {overview, ranking, recurring, hotspots, trends, matrix, details, events, worklog}, top, notes} */
function reportBlocks(model, opts) {
  opts = opts || {};
  const PL = !!opts.plain;
  const sec = Object.assign({ overview: true, ranking: true, recurring: true, hotspots: true, trends: true, breakers: true, weather: true, customers: true, reviews: true, matrix: true, details: true, events: true, worklog: true }, opts.sections || {});
  const S = scoped(model, opts);
  const recs = S.records;
  const dated = recs.filter((r) => r.ms !== null);
  const span = dated.length ? `${fmtDate(dated[0].ms)} to ${fmtDate(dated[dated.length - 1].ms)}` : "no dated events";
  const scope = opts.relay ? S.relays.map(whereText).join(", ") || opts.relay : opts.station ? `${opts.station} (${plural(S.relays.length, "relay")})` : `All locations (${plural(model.stations.length, "station")}, ${plural(model.relays.length, "relay")})`;
  const blocks = [["title", "Trip history report"], ["meta", [scope, span, `Trends to ${fmtDate(model.anchor)}`, `Generated ${opts.now || core.nowStamp()}`]]];
  if (opts.notes && opts.notes.trim()) { blocks.push(["h1", "Comments"]); for (const p of opts.notes.trim().split(/\n\s*\n/)) blocks.push(["para", p.replace(/\s*\n\s*/g, " ")]); }
  const trips = recs.filter((r) => r.tripped);
  if (sec.overview) {
    const tt = S.relays.flatMap((L) => L.tripTimes);
    const tr = combineTrends(trendOf(tt, model.anchor, model.cfg.trendDays), trendOf(tt, model.anchor, model.cfg.yearDays));
    blocks.push(["h1", "Overview"]);
    blocks.push(["kv", [
      ["Events", `${recs.length} (${trips.length} trips, ${recs.filter((r) => r.fault).length} faults)`],
      ["Period", span],
      ["Locations", `${plural(new Set(S.relays.map((L) => L.station)).size, "station")}, ${plural(S.relays.length, "relay")}`],
      ["Trend", `${arrow(tr)}: ${trendWords(tr)} (trip occasions; a reclose sequence counts once)`],
      ["Recurring issues", S.recurring.length ? `${S.recurring.length} at ${plural(new Set(S.recurring.map((x) => x.relayKey)).size, "location")}` : "none"],
      ["Fault hot spots", S.hotspots.length ? `${S.hotspots.length}` : "none"],
      ["Needs review", `${recs.filter((r) => r.checks.length).length} events have items to check`],
    ].concat(S.relays.some((L) => L.breaker && L.breaker.slowing) ? [["Breakers", `getting slower at ${S.relays.filter((L) => L.breaker && L.breaker.slowing).map(whereText).join(", ")}`]] : [])
     .concat(model.customers ? [["Customer impact", `SAIFI ~${model.customers.saifi.toFixed(2)}, MAIFI ~${model.customers.maifi.toFixed(2)} over the last 12 months (estimate)`]] : [])
     .concat(model.reviews.reviewed || model.reviews.overdue ? [["PRC-004 reviews", `${model.reviews.reviewed} of ${model.reviews.trips} trips reviewed, ${plural(model.reviews.misop, "misoperation")}, ${model.reviews.overdue} overdue`]] : [])
     .concat(model.wx.known ? [["Weather", `${S.relays.reduce((a, L) => a + L.wx.storm, 0)} of ${S.relays.reduce((a, L) => a + L.wx.known, 0)} trips with weather were in storms`]] : [])]);
    const up = S.relays.filter((L) => L.trend.dir === "up"), down = S.relays.filter((L) => L.trend.dir === "down");
    if (up.length) blocks.push(["para", `Trips are increasing at ${up.map(whereText).join(", ")}.`]);
    if (down.length) blocks.push(["para", `Trips are decreasing at ${down.map(whereText).join(", ")}.`]);
    const img = opts.chart ? opts.chart("all", null) : null;
    if (img) blocks.push(img);
  }
  if (sec.ranking && S.relays.length) {
    blocks.push(["h1", "Problem locations, ranked"]);
    blocks.push(["note", "Score = trips (older ones count less, half-life " + model.cfg.halfLifeDays + " days) + severity of the issues + recurring issues and hot spots, raised 30% when trips are increasing."]);
    blocks.push(["table", ["Rank", "Location", "Trips", "Last trip", "Trend", "Main issues", "Score"],
      S.relays.slice(0, opts.top || 25).map((L) => [String(L.rank), whereText(L), String(L.trips), fmtDate(L.lastTrip), `${arrow(L.trend)} (${L.trend.recent} vs ${L.trend.prev}${L.trend.basis === "year" ? ", yearly" : ""})`,
        L.top.map((t) => `${issueLabel(t.key, PL)} ${t.n}${t.recurring ? " (recurring)" : ""}`).join("; ") || "-", String(L.score)]),
      [7, 20, 7, 12, 16, 30, 8]]);
  }
  if (sec.recurring) {
    blocks.push(["h1", "Recurring issues"]);
    if (!S.recurring.length) blocks.push(["para", `No issue happened ${model.cfg.recurMin} or more times within ${model.cfg.recurDays} days at one location.`]);
    else blocks.push(["table", ["Location", "Issue", "How often", "Most recent", "Trend", "Events"],
      S.recurring.map((x) => [whereText(x), issueLabel(x.key, PL) + (x.clearing ? ` (${x.clearing.first} → ${x.clearing.last} cycles)` : ""),
        `${x.inWindow} in ${x.windowDays} days (${x.total} in all)`, fmtDate(x.last), arrow(x.trend),
        x.allIds.map((id) => fmtDate(model.byId.get(id).ms)).join(", ")]), [18, 22, 15, 11, 10, 24]]);
  }
  if (sec.hotspots) {
    blocks.push(["h1", "Fault hot spots"]);
    if (!S.hotspots.length) blocks.push(["para", `No location had ${model.cfg.hotMin} or more faults at the same distance.`]);
    else {
      blocks.push(["note", "Faults reported at about the same distance from the relay: often one piece of equipment, a tree or an animal path. Distances are in the relay's line-length units."]);
      blocks.push(["table", ["Location", "Distance", "Faults", "Phases", "First", "Latest"],
        S.hotspots.map((h) => [whereText(h), `${fx(h.from, 2)} to ${fx(h.to, 2)}${h.pct !== null ? ` (~${h.pct}% of line)` : ""}`, String(h.n),
          topEntries(h.phases, 4).map(([p, n]) => `${p} ${n}`).join(", "), fmtDate(h.first), fmtDate(h.last)]), [24, 22, 8, 16, 15, 15]]);
    }
  }
  if (sec.trends) {
    blocks.push(["h1", "Trends"]);
    blocks.push(["note", `Trip occasions (a reclose sequence counts once) in the last ${model.cfg.trendDays} days against the ${model.cfg.trendDays} days before, and the last year against the year before, ending ${fmtDate(model.anchor)}. A recent rise is reported first; otherwise the year-on-year change.`]);
    const rows = S.relays.filter((L) => L.trend.dir === "up" || L.trend.dir === "down").map((L) => [whereText(L), arrow(L.trend), trendWords(L.trend)]);
    const issueRows = [];
    for (const L of S.relays) for (const [key, t] of Object.entries(L.issueTrends)) if ((t.dir === "up" || t.dir === "down") && ISSUE[key].group !== "data") issueRows.push([whereText(L), issueLabel(key, PL), arrow(t), trendWords(t)]);
    if (rows.length) blocks.push(["table", ["Location", "Trips", "Compared"], rows, [34, 20, 46]]);
    else blocks.push(["para", "No location's trip count changed much."]);
    if (issueRows.length) { blocks.push(["h2", "By issue"]); blocks.push(["table", ["Location", "Issue", "Trend", "Compared"], issueRows, [24, 30, 16, 30]]); }
  }
  if (sec.breakers !== false) {
    const bks = S.relays.map((L) => L.breaker).filter((b) => b && b.n);
    if (bks.length) {
      blocks.push(["h1", "Breaker health"]);
      blocks.push(["note", `Clearing time = trip to breaker open, from records with element data (.CEV or COMTRADE). Over ${model.cfg.slowCycles} cycles is slow; rising ${model.cfg.slowingPerYear}+ cycles a year is "getting slower".`]);
      blocks.push(["table", ["Location", "Openings timed", "First", "Latest", "Change a year", "Operations", "kA interrupted", "Verdict"],
        bks.sort((a, b) => b.slowing - a.slowing || b.latest - a.latest).map((b) => [whereText(b), String(b.n), `${b.first} cyc`, `${b.latest} cyc`, b.n >= 3 ? `${b.slope >= 0 ? "+" : ""}${b.slope.toFixed(2)} cyc` : "-",
          String(b.ops), String(b.kA), b.verdict]), [16, 8, 8, 8, 10, 10, 10, 30]]);
    }
  }
  if (sec.customers !== false && model.customers) {
    const rows = S.relays.filter((L) => L.cust).sort((a, b) => b.cust.ci - a.cust.ci || b.cust.cmi - a.cust.cmi)
      .map((L) => [whereText(L), L.cust.customers.toLocaleString("en-US"), String(L.cust.occ), String(L.cust.sustained), L.cust.ci.toLocaleString("en-US"), L.cust.cmi.toLocaleString("en-US")]);
    if (rows.length) {
      const c = model.customers;
      blocks.push(["h1", "Customer impact (last 12 months)"]);
      blocks.push(["note", `Estimate: each trip interrupts every customer on the circuit; ${model.cfg.sustained === "all" ? "every trip counts as sustained" : "a recloser lockout is a sustained interruption and other trips are momentary"}. Trips in the 12 months to ${fmtDate(model.anchor)}.`]);
      blocks.push(["kv", [["Customers served", `${c.served.toLocaleString("en-US")} on ${plural(c.locations, "circuit")}${c.missing ? ` (${c.missing} without a customer count)` : ""}`],
        [PL ? "Outages per customer" : "SAIFI (estimate)", `${c.saifi.toFixed(2)} sustained interruptions per customer${PL ? " (SAIFI, estimate)" : ""}`],
        [PL ? "Blinks per customer" : "MAIFI (estimate)", `${c.maifi.toFixed(2)} momentary interruptions per customer${PL ? " (MAIFI, estimate)" : ""}`]]]);
      blocks.push(["table", ["Location", "Customers", "Trips", "Sustained", "Sustained customer interruptions", "Momentary customer interruptions"], rows, [28, 12, 9, 11, 22, 18]]);
    }
  }
  if (sec.reviews !== false && model.reviews.reviewed) {
    const rows = S.relays.filter((L) => L.rev.trips).map((L) => [whereText(L), String(L.rev.trips), String(L.rev.reviewed), String(L.rev.misop), String(L.rev.overdue)]);
    blocks.push(["h1", "PRC-004 reviews"]);
    blocks.push(["note", `From the reviews recorded in the Trip Analyzer. Overdue = not decided within ${model.cfg.reviewDays} days of the trip.`]);
    blocks.push(["table", ["Location", "Trips", "Reviewed", "Misoperations", "Overdue"], rows, [40, 15, 15, 15, 15]]);
    const mis = model.reviews.misopList.filter((r) => S.keys.has(upper(r.relay)));
    if (mis.length) blocks.push(["bullets", mis.map((r) => `${fmtWhen(r)} ${r.relay}: misoperation${r.review.category ? ` (${r.review.category})` : ""}${r.review.cause ? `, cause: ${r.review.cause}` : ""}`)]);
  }
  if (sec.weather !== false && model.wx.known) {
    const rows = S.relays.filter((L) => L.wx.known).map((L) => [whereText(L), String(L.wx.known), String(L.wx.storm), String(L.wx.calm),
      L.wx.known ? `${Math.round(100 * L.wx.storm / L.wx.known)}%` : "-", topEntries(L.wx.kinds, 4).map(([k, n]) => `${WX_LABEL[k] || k} ${n}`).join(", ") || "-"]);
    if (rows.length) {
      blocks.push(["h1", "Weather"]);
      blocks.push(["note", "Weather in the station's area at the hour of each trip (Open-Meteo). A storm makes weather a likely cause; repeat trips in calm weather point to the line itself."]);
      blocks.push(["table", ["Location", "Trips with weather", "In storms", "Calm", "Storm share", "What kind"], rows, [26, 12, 10, 10, 10, 32]]);
      const calmRec = S.recurring.filter((x) => x.weatherNote);
      if (calmRec.length) blocks.push(["bullets", calmRec.map((x) => `${whereText(x)}, ${issueLabel(x.key, PL).toLowerCase()}: ${x.weatherNote}`)]);
    }
  }
  if (sec.matrix && S.relays.length) {
    const keys = ISSUES.filter((I) => I.group !== "data" && S.relays.some((L) => L.counts[I.key])).map((I) => I.key);
    if (keys.length) {
      blocks.push(["h1", "Issue counts by location"]);
      const short = (k) => issueShort(k, PL);
      const show = keys.slice(0, 9);
      blocks.push(["table", ["Location"].concat(show.map(short)), S.relays.map((L) => [whereText(L)].concat(show.map((k) => String(L.counts[k] || "")))),
        [100 - 9 * show.length].concat(show.map(() => 9))]);
      if (keys.length > show.length) blocks.push(["note", `Also found: ${keys.slice(show.length).map((k) => issueLabel(k, PL)).join(", ")}.`]);
    }
  }
  if (sec.details) {
    blocks.push(["h1", "Location details"]);
    for (const L of S.relays.slice(0, opts.detailTop || S.relays.length)) {
      blocks.push(["h2", `${L.rank}. ${whereText(L)}`]);
      blocks.push(["para", `${plural(L.events, "event")}, ${plural(L.tripOccasions, "trip")}${L.trips > L.tripOccasions ? ` (${L.trips} trip operations counting recloses)` : ""} from ${fmtDate(L.first)} to ${fmtDate(L.last)}. Trend ${arrow(L.trend).toLowerCase()}: ${trendWords(L.trend)}. Score ${L.score}.`]);
      const img = opts.chart ? opts.chart("relay", L) : null;
      if (img) blocks.push(img);
      const bl = [];
      for (const x of L.recurring) bl.push(`Recurring: ${issueLabel(x.key, PL)}, ${x.inWindow} times in ${x.windowDays} days (${x.total} in all). ${x.weatherNote ? x.weatherNote + " " : ""}${x.advice}`);
      if (L.breaker && L.breaker.n) bl.push(`Breaker: ${L.breaker.verdict}. ${L.breaker.ops} operations, ${L.breaker.kA} kA interrupted.`);
      if (L.wx.known) bl.push(`Weather: ${L.wx.storm} of ${L.wx.known} trips in storms${Object.keys(L.wx.kinds).length ? ` (${topEntries(L.wx.kinds, 4).map(([k, n]) => `${WX_LABEL[k] || k} ${n}`).join(", ")})` : ""}.`);
      for (const h of L.hotspots) bl.push(`Hot spot: ${h.n} faults at ${fx(h.from, 2)} to ${fx(h.to, 2)}${h.pct !== null ? ` (~${h.pct}% of the line)` : ""}, ${fmtDate(h.first)} to ${fmtDate(h.last)}.`);
      for (const [key, n] of topEntries(L.counts, 12)) if (!L.recurring.some((x) => x.key === key)) bl.push(`${issueLabel(key, PL)}: ${n}`);
      const ph = ["A", "B", "C"].filter((p) => L.phases[p]).map((p) => `phase ${p} ${L.phases[p]}`).concat(L.phases.G ? [`ground ${L.phases.G}`] : []);
      if (ph.length) bl.push(`Faulted phases: ${ph.join(", ")}`);
      if (bl.length) blocks.push(["bullets", bl]);
      if (sec.worklog && L.worklog.length) blocks.push(["bullets", L.worklog.map((w) => `Work done ${w.date}: ${w.text}`)]);
      if (sec.events) blocks.push(["table", ["Date", "Event", "What happened", "Issues"],
        L.records.map((r) => [fmtWhen(r), PL && Plain ? Plain.faultShort(r.core, r.tripped) : r.et || "-", whatHappened(r, PL), issueList(r, PL) || "-"]), [17, 9, 44, 30]]);
    }
  }
  blocks.push(["note", "Automated interpretation of relay records: confirm against the event reports and settings before acting on it."]);
  return blocks;
}

/** The same blocks as plain text. */
function blocksToText(blocks) {
  const out = [];
  const wrapRow = (cells, widths) => cells.map((c, i) => String(c).padEnd(widths[i])).join("  ").trimEnd();
  for (const b of blocks) {
    const k = b[0];
    if (k === "title") { out.push(b[1].toUpperCase(), "=".repeat(60)); }
    else if (k === "meta") out.push(b[1].join("   "), "");
    else if (k === "h1") out.push("", b[1].toUpperCase(), "-".repeat(60));
    else if (k === "h2") out.push("", b[1]);
    else if (k === "sub") out.push(b[1]);
    else if (k === "para") out.push(b[1]);
    else if (k === "note") out.push(`Note: ${b[1]}`);
    else if (k === "bullets") for (const x of b[1]) out.push(`  - ${x}`);
    else if (k === "mono") out.push(...b[1]);
    else if (k === "kv") { const w = Math.max(...b[1].map((x) => x[0].length)); for (const [kk, v] of b[1]) out.push(`  ${kk.padEnd(w)} : ${v}`); }
    else if (k === "table") {
      const [, head, rows] = b;
      const widths = head.map((h, i) => Math.min(48, Math.max(h.length, ...rows.map((r) => String(r[i]).length))));
      out.push("  " + wrapRow(head, widths), "  " + widths.map((w) => "-".repeat(w)).join("  "));
      for (const r of rows) out.push("  " + wrapRow(r.map((c, i) => (String(c).length > widths[i] ? String(c).slice(0, widths[i] - 1) + "…" : c)), widths));
    }
  }
  return out.join("\n") + "\n";
}

const csvField = (v) => { v = v === null || v === undefined ? "" : String(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const csv = (rows) => rows.map((r) => r.map(csvField).join(",")).join("\r\n") + "\r\n";
const EVENT_COLUMNS = ["Date", "Time", "Station", "Relay", "Event type", "Tripped", "Fault", "Phases", "Location", "% of line",
  "Clearing (cycles)", "Issues", "What happened", "In plain English", "Items to check", "Confidence", "Recurring", "Hot spot", "Weather", "Review", "Decide by", "Source files"];
function eventsCsv(model, opts) {
  const S = scoped(model, opts || {});
  const recurIds = new Set(S.recurring.flatMap((x) => x.allIds)), hotIds = new Set(S.hotspots.flatMap((h) => h.ids));
  return csv([EVENT_COLUMNS].concat(S.records.map((r) => [r.date || r.rawDate, r.time || r.rawTime, r.stationName, r.relay, r.et, r.tripped ? "Yes" : "No",
    r.fault ? "Yes" : "No", r.phases, r.loc, r.locPct ?? "", r.clearCyc ?? "", issueList(r), r.short, Plain ? Plain.sentence(r, { withChecks: false }) : "", r.checks.join(" | "), r.confidence,
    recurIds.has(r.id) ? "Yes" : "", hotIds.has(r.id) ? "Yes" : "", r.wx ? r.wx.text : "", r.review ? ({ correct: "Correct operation", misop: "Misoperation", na: "Not applicable" }[r.review.outcome] || r.review.outcome) + (r.review.category ? ` - ${r.review.category}` : "") : r.reviewStatus === "overdue" ? "Overdue" : r.tripped ? "Not reviewed" : "", r.reviewDue, r.sources.map((s) => s.path).join(" | ")])));
}
const LOCATION_COLUMNS = ["Rank", "Station", "Relay", "Score", "Events", "Trips", "Faults", "First event", "Last trip", "Trend",
  "Trips recent", "Trips before", "Recurring issues", "Hot spots", "Needs review", "Main issues", "Trips in storms", "Breaker latest (cycles)", "Breaker change a year", "kA interrupted", "Customers", "Trips last 12 months", "Sustained", "Customer interruptions", "Misoperations", "Reviews overdue"];
function locationsCsv(model, opts) {
  const S = scoped(model, opts || {});
  return csv([LOCATION_COLUMNS].concat(S.relays.map((L) => [L.rank, L.station, L.relay, L.score, L.events, L.trips, L.faults, fmtDate(L.first), fmtDate(L.lastTrip),
    L.trend.label, L.trend.recent, L.trend.prev, L.recurring.map((x) => `${x.label} (${x.inWindow} in ${x.windowDays} d)`).join("; "),
    L.hotspots.map((h) => `${h.n} at ${fx(h.from, 2)}-${fx(h.to, 2)}`).join("; "), L.review, L.top.map((t) => `${t.label} ${t.n}`).join("; "),
    L.wx.known ? `${L.wx.storm} of ${L.wx.known}` : "", L.breaker && L.breaker.latest !== null ? L.breaker.latest : "", L.breaker && L.breaker.n >= 3 ? L.breaker.slope.toFixed(2) : "", L.breaker ? L.breaker.kA : "",
    L.cust ? L.cust.customers : "", L.cust ? L.cust.occ : "", L.cust ? L.cust.sustained : "", L.cust ? L.cust.ci : "", L.rev.misop, L.rev.overdue])));
}

const api = {
  analyzeFiles, buildModel, mergeRecords, combineTrends, changes, breakerHealth, fitLine, WX_LABEL, issuesFor, trendOf, bestWindow, hotSpots, monthRange,
  reportBlocks, blocksToText, eventsCsv, locationsCsv, EVENT_COLUMNS, LOCATION_COLUMNS,
  ISSUES, ISSUE, GROUPS, DEFAULTS, trendWords, issueLabel, issueShort, whatHappened, isoDate, monthKey, fmtWhen, issueList, whereText, arrow,
};
if (isNode) module.exports = api;
else root.SELHistory = api;
})(typeof window !== "undefined" ? window : globalThis);
