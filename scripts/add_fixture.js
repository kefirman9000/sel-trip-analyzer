#!/usr/bin/env node
/* Turn real relay files into a scrubbed test case under tests/fixtures/.
 *
 *   node scripts/add_fixture.js <case-name> <files or folders...> [--replace "OLD=NEW"]... [--out DIR] [--force]
 *
 * What it does:
 *   1. Reads the files the same way the app does and collects every relay ID, terminal ID,
 *      station ID and COMTRADE station/device name it finds (plus anything you pass with --replace).
 *   2. Replaces each one, in every file, with a neutral name of the SAME LENGTH (RELAY 1, STATION A...)
 *      so fixed-width event reports keep their columns. Binary .RDB files are patched byte for byte
 *      (plain and UTF-16 text).
 *   3. Renames the files (case1.cev, case2.cfg/.dat ...) because file names often carry station names.
 *   4. Searches the result for every original name. If any is left, nothing is written.
 *   5. Writes expected.json from what the program says today. Fill in "cause_contains" with what
 *      really caused the trip (from the field report) so the test checks the right answer.
 *
 * The repo is public: read the scrubbed files once yourself before committing them.
 */
"use strict";
const fs = require("fs"), path = require("path");
const core = require("../web/core.js");
const analysis = require("../web/analysis.js");

function usage(msg) {
  if (msg) console.error("Error: " + msg + "\n");
  console.error('Usage: node scripts/add_fixture.js <case-name> <files or folders...> [--replace "OLD=NEW"]... [--out DIR] [--force]');
  process.exit(2);
}

function expand(paths) {
  const out = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) usage(`${p} not found`);
    if (fs.statSync(p).isDirectory()) {
      for (const n of fs.readdirSync(p).sort())
        if (!n.toUpperCase().startsWith("README") && core.ALL_EXTS.includes(core.extOf(n))) out.push(path.join(p, n));
    } else out.push(p);
  }
  return out;
}

/** Fit a neutral label into exactly `len` characters (keeps fixed-width columns lined up). */
function fit(label, short, len) {
  const s = label.length <= len ? label : short.length <= len ? short : short.slice(0, len);
  return s.padEnd(len, " ");
}

const latin1Bytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const utf16Bytes = (s) => { const b = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { b[2 * i] = s.charCodeAt(i) & 0xff; b[2 * i + 1] = s.charCodeAt(i) >> 8; } return b; };
const lower = (b) => (b >= 65 && b <= 90 ? b + 32 : b);

/** Replace every case-insensitive occurrence of `from` (bytes) with `to` (same length), in place. Returns the count. */
function patch(buf, from, to) {
  let n = 0;
  outer: for (let i = 0; i + from.length <= buf.length; i++) {
    for (let j = 0; j < from.length; j++) if (lower(buf[i + j]) !== lower(from[j])) continue outer;
    buf.set(to, i); n++; i += from.length - 1;
  }
  return n;
}
function contains(buf, from) {
  outer: for (let i = 0; i + from.length <= buf.length; i++) {
    for (let j = 0; j < from.length; j++) if (lower(buf[i + j]) !== lower(from[j])) continue outer;
    return true;
  }
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const replaces = [];
  let outRoot = path.join(__dirname, "..", "tests", "fixtures"), force = false;
  for (let i = 0; i < args.length; ) {
    if (args[i] === "--replace") {
      const v = args[i + 1] || "", k = v.indexOf("=");
      if (k <= 0) usage('--replace needs "OLD=NEW"');
      replaces.push([v.slice(0, k), v.slice(k + 1)]); args.splice(i, 2);
    } else if (args[i] === "--out") { outRoot = args[i + 1]; args.splice(i, 2); }
    else if (args[i] === "--force") { force = true; args.splice(i, 1); }
    else i++;
  }
  const [name, ...inputs] = args;
  if (!name || !inputs.length) usage();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) usage("case name: lower-case letters, digits and dashes only (e.g. feeder-slg-zone1)");
  const files = expand(inputs);
  if (files.some((f) => core.extOf(f) === ".zip")) usage("unzip .zip files first, so each file inside can be scrubbed");
  const dest = path.join(outRoot, name);
  if (fs.existsSync(dest) && !force) usage(`${dest} already exists (use --force to replace it)`);

  // 1. collect identifiers
  const raw = files.map((f) => ({ name: path.basename(f), bytes: new Uint8Array(fs.readFileSync(f)) }));
  const loaded = await core.loadFiles(raw.map((f) => ({ name: f.name, bytes: f.bytes })));
  const relays = new Set(), stations = new Set();
  const addId = (set, v) => { v = String(v || "").trim(); if (v.length >= 2 && !/^\d+$/.test(v)) set.add(v); };
  for (const e of loaded.events) {
    addId(relays, e.relay_id); addId(stations, e.terminal_id);
    addId(relays, e.settings.RID); addId(stations, e.settings.TID); addId(stations, e.settings.SID);
  }
  for (const [label, s] of loaded.rdb) { addId(relays, label); addId(relays, s.RID); addId(stations, s.TID); addId(stations, s.SID); }
  for (const r of analysis.comtradeRecords(loaded.comtrade).records) { addId(stations, r.station); addId(relays, r.relay); }
  for (const s of stations) relays.delete(s);

  // 2. same-length neutral names, longest first so "LINE 5 HILL" goes before "LINE 5"
  const plan = [];
  [...replaces].forEach(([from, to]) => plan.push([from, to.padEnd(from.length, " ").slice(0, from.length), "you"]));
  const taken = new Set(plan.map((p) => p[0].toUpperCase()));
  let r = 0, s = 0;
  for (const id of [...relays].sort()) if (!taken.has(id.toUpperCase())) { r++; plan.push([id, fit(`RELAY ${r}`, `R${r}`, id.length), "relay"]); }
  for (const id of [...stations].sort()) if (!taken.has(id.toUpperCase())) { s++; const L = String.fromCharCode(64 + s); plan.push([id, fit(`STATION ${L}`, `SITE ${L}`.length <= id.length ? `SITE ${L}` : `S${L}`, id.length), "station"]); }
  plan.sort((a, b) => b[0].length - a[0].length);
  if (!plan.length) console.warn("No relay or station names found. Check the files by hand before committing them.");

  // 3. patch bytes and rename files (COMTRADE .cfg/.dat pairs keep a shared base name)
  const bases = new Map();
  let k = 0;
  const out = raw.map((f) => {
    const ext = core.extOf(f.name), base = f.name.slice(0, f.name.length - ext.length).toLowerCase();
    if (!bases.has(base)) bases.set(base, `${name}-${++k}`);
    const buf = f.bytes.slice();
    let hits = 0;
    for (const [from, to] of plan) {
      hits += patch(buf, latin1Bytes(from), latin1Bytes(to));
      hits += patch(buf, utf16Bytes(from), utf16Bytes(to));
    }
    return { from: f.name, name: bases.get(base) + ext, bytes: buf, hits };
  });

  // 4. leak check: no original name may remain anywhere
  const leaks = [];
  for (const f of out)
    for (const [from] of plan)
      if (contains(f.bytes, latin1Bytes(from)) || contains(f.bytes, utf16Bytes(from))) leaks.push(`${f.from}: still contains "${from}"`);
  if (leaks.length) { console.error("Not written, names still present:\n  " + leaks.join("\n  ")); process.exit(1); }

  // 5. expected.json from today's answers, on the scrubbed copies
  const after = await core.loadFiles(out.map((f) => ({ name: f.name, bytes: f.bytes })));
  if (after.errors.length) console.warn("Files the program couldn't read (the test expects none):\n  " + after.errors.join("\n  "));
  const evs = after.events.filter((e) => e.kind === "event" || e.kind === "history");
  const expected = {
    _how_to_finish: "Put what really caused each trip (from the field report) in cause_contains, e.g. [\"Phase A-to-ground fault\", \"Z1G\"]. " +
                    "Delete any line below that isn't certain. Then run: node --test \"tests/*.test.js\"",
    event_count: evs.length,
    events: evs.map((e) => {
      const [st, label, how] = core.matchSettings(e, after.rdb);
      const a = core.analyzeEvent(e, Object.assign({}, e.settings, st), how, label);
      const o = { file: e.source };
      for (const key of ["event_type", "location", "targets", "relay_id"]) if (e[key]) o[key] = e[key];
      o.program_says_today = core.shortCause(e, Object.assign({}, e.settings, st), a);
      o.cause_contains = [];
      return o;
    }),
  };

  fs.mkdirSync(dest, { recursive: true });
  for (const f of out) fs.writeFileSync(path.join(dest, f.name), f.bytes);
  fs.writeFileSync(path.join(dest, "expected.json"), JSON.stringify(expected, null, 2) + "\n");

  console.log(`Wrote ${out.length} file(s) and expected.json to ${dest}`);
  for (const [from, to, why] of plan) console.log(`  "${from}" -> "${to.trimEnd()}"${why === "you" ? " (--replace)" : ""}`);
  for (const f of out) console.log(`  ${f.from} -> ${f.name} (${f.hits} replacement${f.hits === 1 ? "" : "s"})`);
  console.log("\nNext: open the files and check nothing identifying is left (comments, line names, people), " +
              "fill in cause_contains in expected.json, then run: node --test \"tests/*.test.js\"");
}

main().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
