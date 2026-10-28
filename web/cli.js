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
  const args = process.argv.slice(2);
  let comments = "", now;
  for (const flag of ["--comments", "--now"]) {
    const i = args.indexOf(flag);
    if (i >= 0) { if (flag === "--comments") comments = args[i + 1]; else now = args[i + 1]; args.splice(i, 2); }
  }
  const paths = expand(args);
  const files = paths.map((p) => ({ name: path.basename(p), bytes: new Uint8Array(fs.readFileSync(p)) }));
  const { events, rdb, errors } = await core.loadFiles(files);
  process.stdout.write(core.buildReport(events, rdb, errors, paths.length, comments, { now }) + "\n");
})();
