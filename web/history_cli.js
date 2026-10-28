#!/usr/bin/env node
/* Trip History from the command line (the same code the History page runs):
 *   node web/history_cli.js [--format text|events-csv|locations-csv|json] [--as-of YYYY-MM-DD]
 *                           [--from DATE] [--to DATE] [--station NAME] [--relay NAME] <files or folders>
 * Folders are read with their subfolders; a station folder name (…SUB, …STATION) is used when a file doesn't name its station. */
"use strict";
const fs = require("fs"), path = require("path");
const core = require("./core.js");
const H = require("./history.js");

function expand(paths) {
  const out = [];
  const walk = (dir, rel) => {
    const ents = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of ents) {
      const full = path.join(dir, e.name), r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) walk(full, r);
      else if (!e.name.toUpperCase().startsWith("README") && core.ALL_EXTS.includes(core.extOf(e.name))) out.push({ full, rel: r });
    }
  };
  for (const p of paths) {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) walk(p, path.basename(path.resolve(p)));
    else if (fs.existsSync(p)) out.push({ full: p, rel: path.basename(p) });
  }
  return out;
}
const site = (rel) => {
  const parts = rel.split("/").slice(0, -1).reverse();
  const hit = parts.find((p) => /\b(sub|substation|station|stn|switchyard|plant)\b/i.test(p.replace(/[_-]/g, " ")));
  return hit ? hit.replace(/_+/g, " ").trim().toUpperCase() : "";
};

(async () => {
  const args = process.argv.slice(2), opt = { format: "text" };
  for (const flag of ["--format", "--as-of", "--from", "--to", "--station", "--relay"]) {
    const i = args.indexOf(flag);
    if (i >= 0) { opt[flag.slice(2)] = args[i + 1]; args.splice(i, 2); }
  }
  const files = expand(args).map((f) => ({ name: path.basename(f.full), path: f.rel, site: site(f.rel), bytes: new Uint8Array(fs.readFileSync(f.full)) }));
  const { records, errors } = await H.analyzeFiles(files);
  const model = H.buildModel(records, { asOf: opt["as-of"] || "", from: opt.from || "", to: opt.to || "" });
  const scope = { station: opt.station || "", relay: opt.relay || "" };
  if (opt.format === "events-csv") process.stdout.write(H.eventsCsv(model, scope));
  else if (opt.format === "locations-csv") process.stdout.write(H.locationsCsv(model, scope));
  else if (opt.format === "json") process.stdout.write(JSON.stringify({ totals: model.totals, ranking: model.relays.map((L) => ({ rank: L.rank, relay: L.relay, station: L.station, score: L.score, trend: L.trend.label, recurring: L.recurring.map((x) => x.key), hotspots: L.hotspots.map((h) => [h.from, h.to, h.n]) })), errors }, null, 2) + "\n");
  else process.stdout.write(H.blocksToText(H.reportBlocks(model, Object.assign({ now: opt["as-of"] || undefined }, scope))) + (errors.length ? "\nCouldn't read:\n" + errors.map((e) => "  " + e).join("\n") + "\n" : ""));
})();
