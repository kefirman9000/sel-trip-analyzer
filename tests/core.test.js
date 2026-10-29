/* Parsing, cause analysis, review flags, view options and report text (web/core.js).
 *   node --test tests/        (Node 20+)
 * The sample files (sample_files/, made by scripts/make_samples.py) are made-up
 * events with known answers. Real relay files: see tests/fixtures/README.md. */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const core = require("../web/core.js");

const SAMPLES = path.join(__dirname, "..", "sample_files");
const FIXTURES = path.join(__dirname, "fixtures");
const read = (dir, names) => (names && names.length ? names : fs.readdirSync(dir).sort())
  .filter((n) => !n.toUpperCase().startsWith("README") && core.ALL_EXTS.includes(core.extOf(n)))
  .map((n) => ({ name: n, bytes: new Uint8Array(fs.readFileSync(path.join(dir, n))) }));
const load = (...names) => core.loadFiles(read(SAMPLES, names));
async function analyze(...names) {
  const { events, rdb } = await load(...names);
  const e = events.find((x) => x.kind === "event" || x.kind === "history");
  const [s, label, how] = core.matchSettings(e, rdb);
  return [e, core.analyzeEvent(e, Object.assign({}, e.settings, s), how, label)];
}
const text = (a) => a.cause.concat(a.checks, a.gaps).join("\n");

test("CEV header fields and element sequence", async () => {
  const { events } = await load("Feeder12_AG_Zone1.cev");
  const e = events[0];
  assert.equal(e.event_type, "AG T");
  assert.equal(e.location, "4.21");
  assert.equal(e.targets, "INST ZONE1 A G");
  assert.deepEqual([e.date, e.time], ["10/27/2026", "14:03:22.417"]);
  assert.ok(e.fid.startsWith("SEL-351"));
  assert.deepEqual([e.relay_id, e.terminal_id], ["FEEDER 12", "APEX SUB"]);
  assert.ok(Math.abs(e.trip_cycle - 4.25) < 1e-9);
  assert.ok(Math.abs(e.open_cycle - 7.5) < 1e-9);
  const first = {};
  for (const [cyc, el, st] of e.sequence) if (st === "asserted" && !(el in first)) first[el] = cyc;
  assert.ok(first["51G"] < first.Z1G);
  assert.equal(first.Z1G, first.TRIP);
  const [pre, fault] = e.currents.get("IA");
  assert.ok(Math.abs(pre - 200) < 10, String(pre));
  assert.ok(fault > 2300 && fault < 3100, String(fault));   // 2,400 A fault + load, peak-estimated with DC offset
  assert.ok(e.wave && e.wave.channels.length >= 6 && e.wave.digitals.length >= 5);
});

test("text reports, history, SER", async () => {
  let e = (await load("Feeder7_transfer_trip.sum")).events[0];
  assert.deepEqual([e.event_type, e.targets, e.relay_id], ["TRIP", "COMM", "FEEDER 7"]);
  e = (await load("Feeder3_CG_51G.eve")).events[0];
  assert.deepEqual([e.relay_id, e.terminal_id, e.date, e.time], ["FEEDER 3", "OAK HILL SUB", "10/21/26", "14:22:05.118"]);
  assert.equal(e.currents.get("IG")[1], 1859);
  e = (await load("Feeder14_underfrequency.txt")).events[0];
  assert.equal(e.relay_id, "FEEDER 14");
  e = (await load("Line5_ABC_Zone1.hdr")).events[0];
  assert.deepEqual([e.relay_id, e.event_type, e.location], ["LINE 5", "ABC T", "1.90"]);
  const his = (await load("Feeder12_history.his")).events;
  assert.deepEqual(his.map((x) => x.event_type), ["AG T", "ABC T", "CG T", "ER"]);
  assert.equal(his[2].location, "-1.30");
  const ser = (await load("Feeder12.ser")).events.find((x) => x.kind === "ser");
  assert.equal(ser.ser_lines.length, 9);
});

test("event types, targets, element classes", () => {
  for (const [code, want, trip] of [["AG T", "Phase A-to-ground fault", true], ["ABC", "Three-phase fault", false], ["BCG T", "Phase B-C-to-ground fault", true]]) {
    const [desc, tripped] = core.interpretEventType(code);
    assert.ok(desc.includes(want), code); assert.equal(tripped, trip, code);
  }
  assert.equal(core.elementClass("Z2PT"), "distance (time-delayed)");
  assert.equal(core.elementClass("51GT"), "time-overcurrent trip");
  assert.equal(core.elementClass("PTRX"), "communications / transfer trip");
  assert.ok(core.interpretTargets("RS").includes("recloser reset (ready)"));
});

test("settings databases", async () => {
  const { rdb } = await load("Feeder12_settings.rdb");
  const s = rdb.get("FEEDER 12");
  assert.equal(s.LL, "10.00");
  assert.ok(s.TR.includes("Z1G"));
  const junk = new TextEncoder().encode("\x00\x01junk RID     =FEEDER 12\nTR      =M1P + Z1G\nLL      =10.00\n");
  const r2 = (await core.loadFiles([{ name: "x.rdb", bytes: junk }])).rdb.get("FEEDER 12");
  assert.deepEqual([r2.TR, r2.LL], ["M1P + Z1G", "10.00"]);
  const m = new Map([["FEEDER 12", { RID: "FEEDER 12", TR: "Z1G" }]]);
  assert.equal(core.matchSettings({ relay_id: "LINE 5" }, m)[2], "mismatch");
  assert.equal(core.matchSettings({ relay_id: "" }, m)[2], "assumed");
  assert.deepEqual(core.equationHits("Z1G AND NOT 50P1 + !51G", ["50P1", "51G", "Z1G"]), ["Z1G"]);
  // settings whose names start with a digit (50P1P, 51GP ...) are read
  const f3 = (await load("Feeder3_settings.rdb")).rdb.get("FEEDER 3");
  assert.deepEqual([f3["51GP"], f3["51GC"], f3["51GTD"], f3.CTR], ["1.00", "U3", "2.00", "240"]);
});

test("causes and review flags", async () => {
  let [, a] = await analyze("Feeder12_AG_Zone1.cev", "Feeder12_settings.rdb");
  assert.ok(a.tripped); assert.deepEqual(a.primary, ["Z1G"]); assert.deepEqual([a.checks, a.gaps], [[], []]); assert.equal(a.confidence, "High");
  [, a] = await analyze("Line5_BC_Zone2_POTT.cev");
  assert.ok(a.primary.includes("M2P") && a.primary.includes("PTRX"));
  assert.ok(text(a).includes("communications-assisted trip"));
  [, a] = await analyze("Feeder9_AG_needs_review.cev");
  for (const want of ["Targets show phase(s) B but the event type says A", "Highest fault current is on phase B", "beyond the end of the line", "cycles to open after the trip"])
    assert.ok(text(a).includes(want), want);
  assert.equal(a.confidence, "Low");
  [, a] = await analyze("Feeder7_transfer_trip.sum");
  assert.ok(text(a).includes("transfer trip"));
  [, a] = await analyze("Feeder14_underfrequency.txt", "Feeder12_settings.rdb");
  assert.ok(text(a).includes("58.85 Hz, well off nominal 60 Hz"));
  assert.ok(text(a).includes("none match relay 'FEEDER 14'"));
  [, a] = await analyze("Feeder3_CG_51G.eve");
  assert.ok(!a.checks.some((c) => c.includes("ground current")));
});

test("report sections, ordering and blocks", async () => {
  const { events, rdb, errors } = await load();
  const t = core.buildReport(events, rdb, errors, 16, "Crew found a cracked insulator.", { now: "X" });
  for (const h of ["QUICK SUMMARY", "EVENT DETAILS", "ANALYST COMMENTS / NOTES", "Crew found", "Needs review:", "CHECK:", "Confidence  :",
                   "SEQUENTIAL EVENTS RECORDER", "TWO-ENDED EVENTS", "INCIDENTS", "REPEAT TRIPS"]) assert.ok(t.includes(h), h);
  const qs = t.split("\n").filter((l) => /^\s*\d+\. /.test(l) && l.includes(" | "));
  assert.ok(qs[0].includes("09/30/26")); assert.ok(qs[qs.length - 1].includes("10/27"));
  const blocks = core.parseReportText(t);
  assert.equal(blocks[0][0], "title");
  const q = blocks.find((b) => b[0] === "table" && b[1][0] === "#");
  assert.equal(q[2].length, qs.length);
  assert.ok(blocks.find((b) => b[0] === "table" && b[1][0] === "Cycle")[2].some((r) => r[1] === "TRIP"));
  const ov = blocks.find((b) => b[0] === "kv" && b[1].some(([k]) => k === "Two-ended"));
  assert.ok(ov, "Two-ended line is part of the overview table");
});

test("two-ended pairs, incidents, repeat trips", async () => {
  const { events, rdb } = await load();
  const v = core.prepareView(events, rdb, {});
  assert.equal(v.pairs.length, 1);
  const p = v.pairs[0];
  assert.deepEqual([core.relayKey(p.first.e), core.relayKey(p.second.e)].sort(), ["LINE 5", "LINE 5 HILL"]);
  assert.ok(p.likely);
  assert.equal(v.incidents.length, 1);
  assert.equal(v.incidents[0].items.length, 3);
  assert.equal(v.repeats.length, 1);
  assert.equal(v.repeats[0].relay, "FEEDER 12");
});

test("view options", async () => {
  const { events, rdb, errors } = await load();
  const view = (o) => core.prepareView(events, rdb, o || {});
  const all = view().shown;
  assert.ok(view({ show: "trips" }).shown.every((it) => it.a.tripped));
  assert.deepEqual(view({ show: "notrip" }).shown.map((it) => it.e.event_type), ["ER"]);
  const review = view({ show: "review" }).shown;
  assert.ok(review.length && review.every((it) => it.a.checks.length || it.a.gaps.length));
  assert.ok(view({ relay: "feeder 12" }).shown.every((it) => core.relayKey(it.e) === "FEEDER 12"));
  assert.deepEqual(view({ search: "ptrx" }).shown.map((it) => it.e.source), ["Line5_BC_Zone2_POTT.cev"]);
  const d = view({ hide_duplicates: true });
  assert.equal(d.nDups, 1); assert.equal(d.shown.length, all.length - 1);
  const newest = view({ sort: "newest" }).shown.map((it) => it.order);
  assert.deepEqual(newest, all.map((it) => it.order).sort((a, b) => b - a));
  const counts = view({ sort: "review" }).shown.map((it) => it.a.checks.length + it.a.gaps.length);
  assert.deepEqual(counts, counts.slice().sort((a, b) => b - a));
  const t = core.buildReport(events, rdb, errors, 16, "", { show: "trips", relay: "FEEDER 12", hide_duplicates: true, detail: "summary" });
  assert.match(t, /Showing: \d+ of \d+ events \(trips only; relay FEEDER 12; 1 duplicate history row hidden\)/);
  assert.ok(!t.includes("EVENT DETAILS"));
  assert.ok(core.buildReport(events, rdb, errors, 16, "", { search: "zzz" }).includes("No events match"));
  const std = core.buildReport(events, rdb, errors, 16, "", { detail: "standard" });
  assert.ok(!std.includes("Element sequence") && !std.includes("SEQUENTIAL EVENTS RECORDER"));
});

test("notes and weather go into the report and CSV", async () => {
  const { events, rdb, errors } = await load("Feeder12_AG_Zone1.cev", "Feeder12_settings.rdb");
  const id = core.eventId(events[0]);
  const weather = { [id]: { text: "thunderstorm, 78°F", hints: [{ kind: "lightning", label: "thunderstorm", text: "Thunderstorm in the area." }] } };
  const t = core.buildReport(events, rdb, errors, 2, "", { notes: { [id]: "Crew found a flashed insulator" }, weather, detail: "standard" });
  assert.ok(t.includes("  Notes       : Crew found a flashed insulator"));
  assert.ok(t.includes("  Weather     : thunderstorm, 78°F"));
  assert.ok(t.includes("    - Weather: Thunderstorm in the area."));
  const csv = core.reportCsv(events, rdb, { notes: { [id]: "n1" }, weather }).split("\r\n");
  const head = csv[0].split(",");
  assert.deepEqual(head, core.CSV_COLUMNS);
  const row = csv[1].split(",");
  assert.equal(row[head.indexOf("Notes")], "n1");
  assert.ok(row[head.indexOf("Weather")].includes("thunderstorm"));
  assert.equal(core.prepareView(events, rdb, { search: "flashed", notes: { [id]: "flashed" } }).shown.length, 1);
});

test("real-file fixtures (tests/fixtures/<case>/expected.json)", async (t) => {
  const cases = fs.existsSync(FIXTURES) ? fs.readdirSync(FIXTURES).filter((d) => fs.existsSync(path.join(FIXTURES, d, "expected.json"))).sort() : [];
  if (!cases.length) { t.skip("no real-file fixtures yet"); return; }
  for (const c of cases) {
    const folder = path.join(FIXTURES, c), exp = JSON.parse(fs.readFileSync(path.join(folder, "expected.json"), "utf8"));
    const { events, rdb, errors } = await core.loadFiles(read(folder));
    assert.deepEqual(errors, [], c);
    const evs = events.filter((e) => e.kind === "event" || e.kind === "history");
    if ("event_count" in exp) assert.equal(evs.length, exp.event_count, c);
    const report = core.buildReport(events, rdb, errors, 0, "", {});
    for (const w of exp.report_contains || []) assert.ok(report.includes(w), `${c}: ${w}`);
    (exp.events || []).forEach((ee, i) => {
      const e = "file" in ee ? evs.find((x) => x.source === ee.file) : evs[i];
      assert.ok(e, JSON.stringify(ee));
      for (const k of ["event_type", "location", "targets", "relay_id"]) if (k in ee) assert.equal(e[k], ee[k], `${c} ${k}`);
      const [s, label, how] = core.matchSettings(e, rdb);
      const cause = text(core.analyzeEvent(e, Object.assign({}, e.settings, s), how, label));
      for (const w of ee.cause_contains || []) assert.ok(cause.includes(w), `${c}: summary should mention ${w}`);
    });
  }
});

test("export options: leave sections and lines out, choose CSV columns", async () => {
  const { events, rdb, errors } = await load();
  const t = core.buildReport(events, rdb, errors, 16, "hello", { detail: "full", now: "X" });
  assert.equal(core.filterReportText(t, {}), t.replace(/\n{3,}/g, "\n\n"));
  const f = core.filterReportText(t, { checks: false, sequence: false, overview: false, relations: false, ser: false, comments: false, quick: false });
  for (const gone of ["CHECK:", "[2 to check]", "Needs review:", "Element sequence", "Settings context", "OVERVIEW", "TWO-ENDED", "INCIDENTS",
                      "REPEAT TRIPS", "SEQUENTIAL EVENTS", "ANALYST COMMENTS", "QUICK SUMMARY"]) assert.ok(!f.includes(gone), gone);
  for (const kept of ["RELAY TRIP EVENT SUMMARY", "EVENT DETAILS", "Probable cause:", "Event 3 of"]) assert.ok(f.includes(kept), kept);
  const edited = t.replace("EVENT DETAILS", "EVENT DETAILS\n------------------------------------------------------------\nMy own line").replace(/(EVENT DETAILS\n-+\n)My own line\n-+\n/, "$1");
  assert.ok(core.filterReportText(edited, { checks: false }).includes("EVENT DETAILS"));
  const csv = core.reportCsv(events, rdb, { columns: ["Relay", "Weather"] }).split("\r\n");
  assert.equal(csv[0], "Relay,Weather");
  assert.equal(csv[1].split(",").length, 2);
});

test("zip archives and settings saved as text", async () => {
  const { execFileSync } = require("child_process"), os = require("os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "selzip-"));
  for (const n of ["Feeder12_AG_Zone1.cev", "Feeder3_CG_51G.cfg", "Feeder3_CG_51G.dat"]) fs.copyFileSync(path.join(SAMPLES, n), path.join(dir, n));
  let zipBytes;
  try { execFileSync("python3", ["-c", `import shutil,sys; shutil.make_archive(sys.argv[1], "zip", sys.argv[2])`, path.join(dir, "out"), dir]); zipBytes = fs.readFileSync(path.join(dir, "out.zip")); }
  catch (e) { zipBytes = null; }
  if (zipBytes) {
    const r = await core.loadFiles([{ name: "events.zip", bytes: new Uint8Array(zipBytes) }]);
    assert.deepEqual(r.events.map((e) => e.source), ["Feeder12_AG_Zone1.cev", "Feeder3_CG_51G.cfg"], "the COMTRADE record becomes an event too");
    assert.deepEqual(r.comtrade.map((f) => f.name).sort(), ["Feeder3_CG_51G.cfg", "Feeder3_CG_51G.dat"]);
  }
  const sho = "SHO\r\nRID     =FEEDER 3          TID     =OAK HILL SUB\r\nCTR     =240       LL      =8.00\r\n51GP    =1.00      51GC    =U3        51GTD   =2.00\r\n";
  const r2 = await core.loadFiles([{ name: "settings.set", bytes: new TextEncoder().encode(sho) }, { name: "Feeder3_CG_51G.eve", bytes: new Uint8Array(fs.readFileSync(path.join(SAMPLES, "Feeder3_CG_51G.eve"))) }]);
  assert.equal(r2.rdb.get("FEEDER 3")["51GC"], "U3");
  assert.deepEqual(r2.errors, []);
  assert.match(core.buildReport(r2.events, r2.rdb, r2.errors, 2, "", { detail: "full" }), /settings file settings\.set/);
  const bad = await core.loadFiles([{ name: "x.zip", bytes: new Uint8Array([1, 2, 3]) }]);
  assert.match(bad.errors[0], /not a zip file/);
});

test("add_fixture.js scrubs names, keeps the analysis and writes expected.json", async () => {
  const { execFileSync } = require("child_process"), os = require("os");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "fixture-"));
  const files = ["Feeder3_CG_51G.eve", "Feeder3_settings.rdb", "Feeder3_CG_51G.cfg", "Feeder3_CG_51G.dat", "Line5_Hill_BC_Zone1.cev"].map((n) => path.join(SAMPLES, n));
  execFileSync("node", [path.join(__dirname, "..", "scripts", "add_fixture.js"), "scrub-test", ...files, "--out", out, "--replace", "Ocala=Townx"], { stdio: "pipe" });
  const dir = path.join(out, "scrub-test"), names = fs.readdirSync(dir).sort();
  assert.ok(names.every((n) => n === "expected.json" || n.startsWith("scrub-test-")), names.join());
  for (const n of names) {
    const body = fs.readFileSync(path.join(dir, n), "latin1").toUpperCase();
    for (const secret of ["FEEDER 3", "OAK HILL", "LINE 5 HILL", "HILL SUB"]) assert.ok(!body.includes(secret), `${n} still has ${secret}`);
  }
  const before = await core.loadFiles(read(SAMPLES, files.map((f) => path.basename(f))));
  const after = await core.loadFiles(read(dir));
  assert.deepEqual(after.errors, []);
  assert.deepEqual(after.events.map((e) => [e.event_type, e.location, e.targets]), before.events.map((e) => [e.event_type, e.location, e.targets]));
  assert.ok(after.events[0].relay_id.startsWith("RELAY"));
  const [s] = core.matchSettings(after.events.find((e) => e.source.endsWith(".eve")), after.rdb);
  assert.ok(s.TR, "settings still match the scrubbed relay");
  const exp = JSON.parse(fs.readFileSync(path.join(dir, "expected.json"), "utf8"));
  assert.equal(exp.event_count, 2);
  assert.deepEqual(exp.events[0].cause_contains, []);
});

test("operation review (PRC-004): suggestions, due dates, report section, CSV log", async () => {
  const { events, rdb, errors } = await load();
  const items = core.prepareView(events, rdb, {}).items.filter((it) => it.e.dup_of === null);
  const by = (src) => items.find((it) => it.e.source === src);
  assert.equal(core.suggestReview(by("Feeder12_AG_Zone1.cev")).outcome, "correct");
  assert.equal(core.suggestReview(by("Feeder9_AG_needs_review.cev")).category, "Unnecessary Trip - During Fault");
  assert.equal(core.suggestReview(by("Feeder14_underfrequency.txt")).outcome, "correct");
  assert.match(core.suggestReview(by("Feeder7_transfer_trip.sum")).text, /remote end/);
  assert.equal(core.MISOP_CATEGORIES.length, 6);
  assert.equal(core.MISOP_CAUSES.length, 10);
  assert.equal(core.reviewDue(by("Line5_Hill_BC_Zone1.cev").e), "2027-02-19");
  const id = by("Line5_Hill_BC_Zone1.cev").id;
  const reviews = { [id]: { outcome: "misop", category: "Unnecessary Trip - During Fault", cause: "Incorrect Settings", causeFound: "2026-10-28", reviewer: "J", date: "2026-10-28" } };
  const plain = core.buildReport(events, rdb, errors, 16, "", { now: "X" });
  assert.ok(!plain.includes("OPERATION REVIEW") && !plain.includes("Review      :"), "no review section until reviews exist");
  const t = core.buildReport(events, rdb, errors, 16, "", { now: "X", reviews });
  assert.match(t, /OPERATION REVIEW \(NERC PRC-004\)\n-+\n {2}1 of \d+ trips reviewed, 1 misoperation\./);
  assert.match(t, /Review {6}: Misoperation - Unnecessary Trip - During Fault; cause: Incorrect Settings; corrective action plan due 2026-12-27 \(J, 2026-10-28\)/);
  assert.ok(!core.filterReportText(t, { review: false }).includes("OPERATION REVIEW"));
  assert.ok(!core.filterReportText(t, { review: false }).includes("Review      :"));
  const csv = core.reviewCsv(events, rdb, reviews).split("\r\n");
  assert.equal(csv[0], core.REVIEW_COLUMNS.join(","));
  assert.ok(csv.some((l) => l.startsWith("10/22/2026,09:41:17.506,LINE 5 HILL,HILL SUB,BC T,") && l.includes(",Misoperation,Unnecessary Trip - During Fault,Incorrect Settings,J,2026-10-28,2027-02-19,2026-10-28,2026-12-27,")));
  assert.equal(csv.filter(Boolean).length - 1, items.filter((it) => it.a.tripped).length);
});


/** A made-up COMTRADE record from a non-SEL relay: BG fault, ground IOC trips at 1.5 cyc, breaker opens 3 cyc later. */
function otherMakerComtrade() {
  const f = 60, spc = 32, n = 12 * spc, trig = 2 * spc;
  const cfg = ["NORTH STN,LINE 22 (OTHER MAKER),1999", "8,5A,3D",
    "1,Line Ia,A,,A,0.1,0,0,-32767,32767,600,5,P", "2,Line Ib,B,,A,0.1,0,0,-32767,32767,600,5,P", "3,Line Ic,C,,A,0.1,0,0,-32767,32767,600,5,P",
    "4,Line Va,A,,kV,0.001,0,0,-32767,32767,1,1,P", "5,Line Vb,B,,kV,0.001,0,0,-32767,32767,1,1,P",
    "1,GND IOC1 OP,,,0", "2,TRIP BUS 1 OP,,,0", "3,BKR 1 CLOSED,,,1",
    "60", "1", `${f * spc},${n}`, "05/03/2026,08:15:30.000000", "05/03/2026,08:15:30.033333", "ASCII", "1"].join("\r\n") + "\r\n";
  const rows = [];
  for (let k = 0; k < n; k++) {
    const w = 2 * Math.PI * k / spc, faulted = k >= trig && k < trig + 4.5 * spc;
    const ib = faulted ? 3000 : 300;
    const va = 67 * Math.SQRT2 * Math.sin(w), vb = (faulted ? 20 : 67) * Math.SQRT2 * Math.sin(w - 2.094);
    const a = [300 * Math.SQRT2 * Math.sin(w - 0.5), ib * Math.SQRT2 * Math.sin(w - 2.6 - (faulted ? 1.0 : 0)), 300 * Math.SQRT2 * Math.sin(w + 1.6)].map((x) => Math.round(x / 0.1))
      .concat([va, vb].map((x) => Math.round(x / 0.001)));
    const ioc = k >= trig + 1.5 * spc && k < trig + 5 * spc ? 1 : 0, tr = k >= trig + 1.5 * spc && k < trig + 6 * spc ? 1 : 0, bkr = k < trig + 4.5 * spc ? 1 : 0;
    rows.push([k + 1, Math.round(k * 1e6 / (f * spc)), ...a, ioc, tr, bkr].join(","));
  }
  return [{ name: "L22_fault.cfg", bytes: new TextEncoder().encode(cfg) }, { name: "L22_fault.dat", bytes: new TextEncoder().encode(rows.join("\r\n") + "\r\n") }];
}

test("COMTRADE from another maker becomes a summarized event", async () => {
  assert.equal(core.elementClass("GND IOC1 OP"), "instantaneous overcurrent");
  assert.equal(core.elementClass("PH TOC1 OP"), "time-overcurrent trip");
  assert.equal(core.elementClass("TRIP BUS 1 OP"), "TRIP");
  assert.equal(core.elementClass("BKR 1 CLOSED"), "breaker status");
  assert.equal(core.elementClass("PDIS1.Op"), "distance");
  assert.equal(core.elementClass("DIST Z1 TRIP"), "distance");
  assert.equal(core.elementClass("Z1G"), "distance", "SEL names unchanged");
  const { events, rdb, errors } = await core.loadFiles(otherMakerComtrade());
  assert.deepEqual(errors, []);
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.relay_id, "LINE 22 (OTHER MAKER)");
  assert.equal(e.terminal_id, "NORTH STN");
  assert.equal(e.event_type, "BG T");
  assert.equal(e.date, "03/05/2026");
  const a = core.analyzeEvent(e, {}, "none", "");
  assert.ok(a.tripped);
  assert.deepEqual(a.primary, ["GND IOC1 OP"]);
  assert.match(core.shortCause(e, {}, a), /Phase B-to-ground fault via GND IOC1 OP/);
  assert.match(a.cause.join("\n"), /Breaker opened ~3\.00 cycles after trip/);
  assert.ok(a.gaps.some((g) => g.startsWith("Read from a COMTRADE record")));
  const ev = a.evidence.find((x) => x.elements.includes("GND IOC1 OP"));
  assert.ok(ev && ev.idx === 112, JSON.stringify(ev));
  assert.equal(e.waveRef.id, "comtrade:L22_fault.cfg");
  const [cur] = [...e.currents].filter(([k]) => k === "IB").map(([, v]) => v);
  assert.ok(cur[1] > 2500 && cur[0] < 400, String(cur));
  // with an SEL report for the same relay and time, the COMTRADE copy isn't added twice
  const both = await core.loadFiles(read(SAMPLES, ["Feeder3_CG_51G.eve", "Feeder3_CG_51G.cfg", "Feeder3_CG_51G.dat"]));
  assert.deepEqual(both.events.map((x) => x.source), ["Feeder3_CG_51G.eve"]);
});
