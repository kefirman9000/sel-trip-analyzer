/* Waveform analysis, COMTRADE, reference library, Word writer and weather (web/*.js).
 *   node --test tests/*.test.js */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path");
const core = require("../web/core.js");
const A = require("../web/analysis.js");
const REF = require("../web/reference.js");
const DOCX = require("../web/docx.js");
const WX = require("../web/weather.js");

const SAMPLES = path.join(__dirname, "..", "sample_files");
const bytes = (n) => new Uint8Array(fs.readFileSync(path.join(SAMPLES, n)));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} ${a} vs ${b}`);

test("every reference waveform is classified as labelled", () => {
  const list = REF.referenceList();
  assert.equal(list.length, 9);
  for (const r of list) {
    const c = A.classify(REF.referenceRecord(r.key));
    assert.equal(c.code, r.code, r.key);
    assert.ok(r.lookFor.length >= 3 && r.what, r.key);
  }
  const notes = (k) => A.classify(REF.referenceRecord(k)).notes.join(" ");
  assert.match(notes("ctsat"), /CT saturation/);
  assert.match(notes("hiz"), /high-impedance/);
  assert.match(notes("evolving"), /Evolving fault/);
  assert.doesNotMatch(notes("slg"), /saturation/);
});

test("phasors and sequence components of a known record", () => {
  const rec = REF.referenceRecord("load");
  const snap = A.snapshot(rec, 3 * rec.spc);
  near(A.cabs(snap.phasors.IA), 300, 0.5, "IA rms");
  near(A.cang(snap.phasors.VA), 0, 1e-6, "reference angle");
  near(A.cang(snap.phasors.IA), -20, 0.2, "IA angle");
  near(A.cabs(snap.seq.I.pos), 300, 0.5, "I1");
  near(A.cabs(snap.seq.I.neg), 0, 0.5, "I2");
  near(A.cabs(snap.seq.I.residual), 0, 0.5, "3I0");
  const ll = REF.referenceRecord("ll"), s2 = A.snapshot(ll, 8 * ll.spc);
  near(A.cabs(s2.seq.I.zero), 100, 2, "only the phase A load (300 A / 3) shows as I0 in a B-C fault");
  assert.ok(A.cabs(s2.seq.I.neg) > 1500);
});

test("harmonics: inrush 2nd harmonic, clean sine has no THD", () => {
  const rec = REF.referenceRecord("inrush");
  const h = A.harmonics(rec.analogs[0].values, 7 * rec.spc, rec.spc, 1, 7);
  assert.ok(h.list[1].pct > 15, `2nd ${h.list[1].pct}`);
  const load = REF.referenceRecord("load");
  const h2 = A.harmonics(load.analogs[0].values, 2 * load.spc, load.spc, 2, 15);
  assert.ok(h2.thd < 0.5 && h2.dcPct < 0.5);
});

test("CEV samples become records; classification matches the files", async () => {
  const want = { "Feeder12_AG_Zone1.cev": "AG", "Line5_BC_Zone2_POTT.cev": "BC", "Line5_Hill_BC_Zone1.cev": "BC", "Feeder9_AG_needs_review.cev": "BG" };
  for (const [n, code] of Object.entries(want)) {
    const { events } = await core.loadFiles([{ name: n, bytes: bytes(n) }]);
    const rec = A.recordFromEvent(events[0]);
    assert.ok(rec.n > 100 && rec.analogs.length >= 6, n);
    assert.equal(A.classify(rec).code, code, n);
    assert.doesNotMatch(A.classify(rec).notes.join(" "), /saturation/, n);
  }
});

test("COMTRADE sample: CG fault, 51G timing against the relay curve", async () => {
  const files = ["Feeder3_CG_51G.cfg", "Feeder3_CG_51G.dat", "Feeder3_settings.rdb"].map((n) => ({ name: n, bytes: bytes(n) }));
  const loaded = await core.loadFiles(files);
  const { records, errors } = A.comtradeRecords(loaded.comtrade);
  assert.deepEqual(errors, []);
  const rec = records[0];
  assert.equal(rec.relay, "FEEDER 3");
  assert.equal(rec.spc, 32);
  const [s] = core.matchSettings({ relay_id: rec.relay }, loaded.rdb);
  const an = A.analyze(rec, s);
  assert.equal(an.cls.code, "CG");
  const g = an.oc.rows.find((r) => r.element === "51G");
  near(g.expectedSec * 60, 19.0, 0.3, "curve time (cycles)");
  assert.equal(g.agrees, true);
  assert.equal(an.oc.rows.find((r) => r.element === "50G1").verdict, "Below pickup");
  near(A.curveTime("U3", 2, 5), 2 * (0.0963 + 3.88 / 24), 1e-9);
  assert.equal(A.curveTime("U3", 2, 0.9), null);
});

function comtradeFiles(ft) {
  // 2 analogs (IA in A, VA in V), 2 digitals, 16 samples per cycle at 60 Hz
  const n = 64, spc = 16, nA = 2, nD = 2;
  const ia = (k) => 1000 * Math.SQRT2 * Math.cos((2 * Math.PI * k) / spc);
  const va = (k) => 67000 * Math.SQRT2 * Math.cos((2 * Math.PI * k) / spc + 0.5);
  const scale = ft === "BINARY" ? [0.5, 5] : ft === "BINARY32" ? [0.01, 0.1] : [1, 1];
  const cfg = ["SUB,RELAY 1,1999", `4,${nA}A,${nD}D`,
    `1,IA,A,,A,${scale[0]},0,0,-32767,32767,1200,5,P`, `2,VA,A,,V,${scale[1]},0,0,-32767,32767,600,1,P`,
    "1,TRIP,,,0", "2,52A,,,1", "60", "1", `960,${n}`, "21/10/2026,14:22:05.000000", "21/10/2026,14:22:05.016667", ft, "1"].join("\r\n");
  let dat;
  if (ft === "ASCII") {
    dat = new TextEncoder().encode([...Array(n).keys()].map((k) => `${k + 1},${Math.round(k * 1041.667)},${(ia(k) / scale[0]).toFixed(0)},${(va(k) / scale[1]).toFixed(0)},${k > 40 ? 1 : 0},${k < 50 ? 1 : 0}`).join("\r\n"));
  } else {
    const aw = ft === "BINARY" ? 2 : 4, size = 8 + nA * aw + 2;
    const buf = new DataView(new ArrayBuffer(n * size));
    for (let k = 0; k < n; k++) {
      const o = k * size;
      buf.setUint32(o, k + 1, true); buf.setUint32(o + 4, Math.round(k * 1041.667), true);
      [ia(k) / scale[0], va(k) / scale[1]].forEach((v, j) => {
        const q = o + 8 + j * aw;
        if (ft === "BINARY") buf.setInt16(q, Math.round(v), true); else if (ft === "FLOAT32") buf.setFloat32(q, v, true); else buf.setInt32(q, Math.round(v), true);
      });
      buf.setUint16(o + 8 + nA * aw, (k > 40 ? 1 : 0) | (k < 50 ? 2 : 0), true);
    }
    dat = new Uint8Array(buf.buffer);
  }
  return [{ name: "t.cfg", bytes: new TextEncoder().encode(cfg) }, { name: "t.dat", bytes: dat }];
}

for (const ft of ["ASCII", "BINARY", "BINARY32", "FLOAT32"]) {
  test(`COMTRADE ${ft} data files`, () => {
    const { records, errors } = A.comtradeRecords(comtradeFiles(ft));
    assert.deepEqual(errors, []);
    const r = records[0];
    assert.equal(r.n, 64); assert.equal(r.trigger, 16); assert.equal(r.spc, 16);
    const snap = A.snapshot(r, 40);
    near(A.cabs(snap.phasors.IA), 1000, ft === "BINARY" ? 2 : 0.5, "IA");
    near(A.cabs(snap.phasors.VA), 67, 0.1, "VA in kV");
    assert.equal(r.analogs[1].unit, "kV");
    assert.deepEqual([r.digitals[0].values[41], r.digitals[0].values[10], r.digitals[1].values[10], r.digitals[1].values[60]], [1, 0, 1, 0]);
  });
}

test("COMTRADE .cff (2013 single file) and a missing .dat", () => {
  const [cfg, dat] = comtradeFiles("ASCII");
  const cff = `--- file type: CFG ---\n${new TextDecoder().decode(cfg.bytes)}\n--- file type: DAT ASCII ---\n${new TextDecoder().decode(dat.bytes)}\n`;
  const { records } = A.comtradeRecords([{ name: "t.cff", bytes: new TextEncoder().encode(cff) }]);
  assert.equal(records[0].n, 64);
  assert.match(A.comtradeRecords([cfg]).errors[0], /needs both/);
});

test("relay elements in plain English", () => {
  assert.match(A.translateElement("Z1G"), /Zone 1 ground distance/);
  assert.match(A.translateElement("51GT"), /timed out/);
  assert.match(A.translateElement("PTRX"), /received/);
  assert.match(A.translateElement("79LO"), /locked out/);
  assert.equal(A.elementGroup("OUT101"), "Trip & outputs");
  const tl = A.elementTimeline(REF.referenceRecord("slg"));
  const trip = tl.find((e) => e.name === "TRIP");
  assert.ok(trip.changed && trip.intervals.length === 1);
});

test("Word writer makes a valid .docx zip with pictures", () => {
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64"));
  const blocks = [["title", "T"], ["meta", ["a", "b"]], ["h1", "H & <x>"], ["para", "line1\nline2"], ["bullets", ["CHECK: x", "TRIP - y"]],
                  ["kv", [["k", "v", false]]], ["table", ["#", "Date / time", "Relay", "Type", "Cause"], [["1", "d", "r", "AG T", "TRIP - z [1 to check]"]]],
                  ["image", { png, width: 10, height: 10, caption: "c" }], ["mono", ["x"]], ["note", "n"]];
  const z = DOCX.build(blocks, { runs: core.tripRuns });
  assert.equal(String.fromCharCode(z[0], z[1]), "PK");
  const s = Buffer.from(z).toString("latin1");
  for (const part of ["[Content_Types].xml", "word/document.xml", "word/styles.xml", "word/footer1.xml", "word/media/image1.png", "word/_rels/document.xml.rels"])
    assert.ok(s.includes(part), part);
  assert.ok(s.includes("H &amp; &lt;x&gt;"));
  assert.equal(DOCX.crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("weather: hints from the hours around the event", () => {
  const hours = [...Array(24).keys()].map((h) => ({ hour: h, temp: 80, precip: h === 14 ? 0.5 : 0, snow: 0, code: h === 14 ? 95 : 1, wind: 10, gust: h === 14 ? 45 : 15 }));
  const a = WX.assess(hours, 14, "us");
  assert.deepEqual(a.hints.map((h) => h.kind), ["lightning", "wind"]);
  assert.match(a.text, /thunderstorm, 80°F/);
  const calm = WX.assess(hours, 3, "us");
  assert.deepEqual(calm.hints.map((h) => h.kind), ["calm"]);
  const ice = WX.assess(hours.map((h) => ({ ...h, temp: 30, snow: h.hour === 8 ? 1 : 0, code: 73, gust: 10 })), 8, "us");
  assert.ok(ice.hints.some((h) => h.kind === "ice"));
  assert.deepEqual(WX.parseLatLon("29.18, -82.14"), { lat: 29.18, lon: -82.14, label: "29.1800, -82.1400" });
  assert.equal(WX.parseLatLon("Ocala, FL"), null);
  assert.match(WX.urlFor({ lat: 1, lon: 2 }, "2020-01-01", "us", "2026-10-28"), /^https:\/\/archive-api\.open-meteo\.com/);
  assert.match(WX.urlFor({ lat: 1, lon: 2 }, "2026-10-20", "us", "2026-10-28"), /^https:\/\/api\.open-meteo\.com\/v1\/forecast/);
  const w = WX.eventWhen({ date: "10/21/2026", time: "14:22:05.118" }, core);
  assert.deepEqual(w, { date: "2026-10-21", hour: 14, minute: 22 });
});

test("weather lookup uses the service and caches by day", async () => {
  let calls = 0;
  const fake = async (url) => { calls++; return { ok: true, json: async () => ({ hourly: { time: [...Array(24).keys()].map((h) => `2026-10-21T${String(h).padStart(2, "0")}:00`),
    temperature_2m: Array(24).fill(70), precipitation: Array(24).fill(0), snowfall: Array(24).fill(0), weather_code: Array(24).fill(2),
    wind_speed_10m: Array(24).fill(8), wind_gusts_10m: Array(24).fill(12) } }) }; };
  const cache = {};
  const r1 = await WX.lookup({ lat: 29, lon: -82 }, "2026-10-21", 14, { fetch: fake, cache });
  await WX.lookup({ lat: 29, lon: -82 }, "2026-10-21", 9, { fetch: fake, cache });
  assert.equal(calls, 1);
  assert.match(r1.text, /partly cloudy/);
  const g = await WX.geocode("29.5, -82", fake);
  assert.equal(g[0].lat, 29.5);
});
