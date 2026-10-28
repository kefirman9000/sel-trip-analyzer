#!/usr/bin/env node
/* Command-line runner for the browser core, used by the parity tests:
 *   node web/cli.js [--comments TEXT] [--now STAMP] <files or folders>
 * Folders are expanded the same way as the Python version (sorted, README skipped). */
"use strict";
const fs = require("fs"), path = require("path");
const core = require("./core.js");

function expand(paths) {
  const out = [];
  const walk = (dir) => {
    const ents = fs.readdirSync(dir, { withFileTypes: true });
    const files = ents.filter((e) => e.isFile()).map((e) => e.name).sort();
    for (const fn of files) {
      if (fn.toUpperCase().startsWith("README")) continue;
      if (core.ALL_EXTS.includes(core.extOf(fn))) out.push(path.join(dir, fn));
    }
    for (const d of ents.filter((e) => e.isDirectory()).map((e) => e.name).sort()) walk(path.join(dir, d));
  };
  for (const p of paths) {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) walk(p);
    else if (fs.existsSync(p)) out.push(p);
  }
  const seen = new Set();
  return out.filter((p) => { const k = path.resolve(p); if (seen.has(k)) return false; seen.add(k); return true; });
}

(async () => {
  // same flags as `python sel_trip_analyzer.py --cli`, plus --now for repeatable output
  const args = process.argv.slice(2);
  let comments = "", format = "text";
  const opts = {};
  for (const [flag, key] of [["--comments", "comments"], ["--now", "now"], ["--show", "show"], ["--relay", "relay"],
                             ["--sort", "sort"], ["--detail", "detail"], ["--search", "search"], ["--format", "format"]]) {
    const i = args.indexOf(flag);
    if (i < 0) continue;
    const v = args[i + 1];
    args.splice(i, 2);
    if (key === "comments") comments = v; else if (key === "format") format = v; else opts[key] = v;
  }
  const hd = args.indexOf("--hide-duplicates");
  if (hd >= 0) { args.splice(hd, 1); opts.hide_duplicates = true; }
  const paths = expand(args);
  const files = paths.map((p) => ({ name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) }));
  const { events, rdb, errors } = await core.loadFiles(files);
  if (format === "csv") process.stdout.write(core.reportCsv(events, rdb, opts));
  else process.stdout.write(core.buildReport(events, rdb, errors, paths.length, comments, opts) + "\n");
})();
