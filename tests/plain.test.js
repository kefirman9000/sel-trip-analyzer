/* Plain-English wording: node --test "tests/*.test.js" */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const core = require("../web/core.js");
const P = require("../web/plain.js");
require("../web/analysis.js");

const ROOT = path.join(__dirname, "..");
async function samples() {
  const dir = path.join(ROOT, "sample_files");
  const files = fs.readdirSync(dir).filter((n) => !n.startsWith("README")).map((n) => ({ name: n, bytes: new Uint8Array(fs.readFileSync(path.join(dir, n))) }));
  return core.loadFiles(files);
}

test("events in everyday words", async () => {
  const r = await samples();
  const v = core.prepareView(r.events, r.rdb, {});
  const say = (src) => P.itemSentence(v.items.find((it) => it.e.source === src));
  assert.match(say("Feeder12_AG_Zone1.cev"), /^Tripped: phase A touched ground about 42% of the way along the line .*Zone 1 distance protection opened the breaker\.$/);
  assert.match(say("Line5_BC_Zone2_POTT.cev"), /phases B and C touched each other.*Zone 2 distance protection and a trip signal from the relay at the other end/);
  assert.match(say("Feeder14_underfrequency.txt"), /no fault was found; it came from low-frequency load shedding/);
  const lo = v.items.find((it) => / LO\b/.test(it.e.targets));
  assert.match(P.itemSentence(lo), /stayed off \(lockout\)/);
  for (const it of v.items) assert.doesNotMatch(P.itemSentence(it), /undefined|NaN/);
});

test("the summary in plain English keeps the technical details", async () => {
  const r = await samples();
  const plain = core.buildReport(r.events, r.rdb, r.errors, 17, "", { plain: true, now: "x" });
  const tech = core.buildReport(r.events, r.rdb, r.errors, 17, "", { now: "x" });
  assert.match(plain, /\| A to ground \| Tripped: phase A touched ground/);
  assert.match(plain, /^ {2}Plain English: /m);
  assert.match(plain, /Targets {5}: INST ZONE1 A G/, "codes still in the details");
  assert.doesNotMatch(tech, /Plain English:/);
  const blocks = core.parseReportText(plain);
  assert.ok(JSON.stringify(blocks).includes("Plain English"), "Word export reads it");
});

test("elements, issues and times", () => {
  assert.equal(P.element("Z1G"), "Zone 1 distance protection");
  assert.equal(P.element("PTRX"), "a trip signal from the relay at the other end of the line");
  assert.equal(P.element("79LO"), "recloser gave up (lockout)");
  assert.equal(P.cycles(7.75), "7.75 cycles (0.13 s)");
  assert.deepEqual(P.issue("lockout"), ["Stayed off", "Recloser gave up and the circuit stayed off (lockouts)"]);
  const H = require("../web/history.js");
  for (const I of H.ISSUES) assert.ok(P.ISSUES[I.key], `plain words for ${I.key}`);
});
