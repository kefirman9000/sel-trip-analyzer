/* Trip History: run with  node --test "tests/*.test.js"  (expects sample_history/ from make_history_samples.py) */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const H = require("../web/history.js");

const ROOT = path.join(__dirname, "..");
function load(dir) {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const full = path.join(d, e.name);
    if (e.isDirectory()) walk(full); else if (!/^README/i.test(e.name)) out.push({ name: e.name, path: path.relative(ROOT, full).replace(/\\/g, "/"), bytes: new Uint8Array(fs.readFileSync(full)) });
  } };
  walk(dir);
  return out;
}
let cached;
async function model() {
  if (!cached) { const r = await H.analyzeFiles(load(path.join(ROOT, "sample_history"))); cached = { r, m: H.buildModel(r.records, {}) }; }
  return cached;
}
const relay = (m, name) => m.relays.find((L) => L.relay === name);

test("every sample file is read and history rows aren't double counted", async () => {
  const { r } = await model();
  assert.deepEqual(r.errors, []);
  assert.equal(r.records.length, 89);
  const withHis = r.records.filter((x) => x.sources.some((s) => s.name.endsWith(".his")));
  assert.ok(withHis.length >= 20, "history rows merged into the .sum events");
  assert.ok(withHis.every((x) => x.sources.length === 2));
});

test("the same files twice add nothing", async () => {
  const files = load(path.join(ROOT, "sample_history", "Apex Sub"));
  const once = await H.analyzeFiles(files);
  const twice = await H.analyzeFiles(files.concat(files.map((f) => Object.assign({}, f, { path: "copy/" + f.path }))));
  assert.equal(twice.records.length, once.records.length);
});

test("Feeder 12 is the top problem: recurring ground faults, a hot spot near 42%, increasing", async () => {
  const { m } = await model();
  const L = relay(m, "FEEDER 12");
  assert.equal(L.rank, 1);
  assert.equal(L.station, "APEX SUB");
  assert.equal(L.trend.dir, "up");
  assert.ok(L.recurring.some((x) => x.key === "f_slg"));
  assert.equal(L.hotspots.length, 1);
  assert.ok(L.hotspots[0].at > 4 && L.hotspots[0].at < 4.4 && L.hotspots[0].n >= 6);
  assert.ok(L.trips > L.tripOccasions, "reclose sequences count once");
});

test("Feeder 8 is decreasing year on year, with recurring lockouts in 2025", async () => {
  const { m } = await model();
  const L = relay(m, "FEEDER 8");
  assert.equal(L.trend.dir, "down");
  assert.equal(L.trend.basis, "year");
  assert.ok(L.recurring.some((x) => x.key === "lockout"));
});

test("Line 5's breaker gets slower; the other recurring issues are found", async () => {
  const { m } = await model();
  const sb = relay(m, "LINE 5").recurring.find((x) => x.key === "slow_breaker");
  assert.ok(sb && sb.clearing.last > sb.clearing.first);
  assert.ok(relay(m, "FEEDER 7").recurring.some((x) => x.key === "transfer"));
  assert.ok(relay(m, "FEEDER 9").recurring.some((x) => x.key === "trip_nofault"));
  assert.ok(relay(m, "FEEDER 11").recurring.some((x) => x.key === "reverse"));
  assert.ok(!relay(m, "FEEDER 3").recurring.length && !relay(m, "FEEDER 14").recurring.length);
});

test("trend rules", () => {
  const D = 864e5, a = 1000 * D;
  assert.equal(H.trendOf([a - 1 * D, a - 2 * D, a - 3 * D, a - 100 * D], a, 90).dir, "up");
  assert.equal(H.trendOf([a - 100 * D, a - 110 * D, a - 120 * D, a - 5 * D], a, 90).dir, "down");
  assert.equal(H.trendOf([a - 1 * D, a - 100 * D], a, 90).dir, "flat");
  assert.equal(H.trendOf([a - 1 * D], a, 90).dir, "few");
  assert.equal(H.bestWindow([0, 10 * D, 20 * D, 200 * D], 90).n, 3);
});

test("date range, scope and exports", async () => {
  const { r } = await model();
  const m = H.buildModel(r.records, { from: "2026-01-01" });
  assert.ok(m.records.every((x) => x.date >= "2026-01-01"));
  const full = (await model()).m;
  const csv = H.eventsCsv(full, { station: "RIVER SUB" }).trim().split("\r\n");
  assert.equal(csv[0], H.EVENT_COLUMNS.join(","));
  assert.equal(csv.length - 1, 6);
  const loc = H.locationsCsv(full).trim().split("\r\n");
  assert.equal(loc.length - 1, full.relays.length);
  const text = H.blocksToText(H.reportBlocks(full, { now: "2026-10-28 00:00" }));
  for (const h of ["OVERVIEW", "PROBLEM LOCATIONS, RANKED", "RECURRING ISSUES", "FAULT HOT SPOTS", "TRENDS", "LOCATION DETAILS"]) assert.ok(text.includes(h), h);
  const docx = require("../web/docx.js").build(H.reportBlocks(full, {}), {});
  assert.ok(docx.length > 10000);
});

test("station overrides and the existing samples still work", async () => {
  const { r } = await model();
  const m = H.buildModel(r.records, { overrides: { "FEEDER 3": "NEW SUB" } });
  assert.equal(relay(m, "FEEDER 3").station, "NEW SUB");
  const old = await H.analyzeFiles(load(path.join(ROOT, "sample_files")));
  assert.deepEqual(old.errors, []);
  assert.equal(old.records.length, 14);
});
