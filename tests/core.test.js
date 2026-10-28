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
