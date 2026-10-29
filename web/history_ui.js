/* SEL Trip History - the History screen (overview, locations, issues, events, files & settings, the event
 * panel and the export dialog), as a module that mounts into any element. Used by the standalone page
 * (history.html) and by the Trip Analyzer's History tab.
 *
 *   const h = SELHistoryUI.mount(element, { version, repo, embedded, isActive, openEvent, download, printRoot, samples, onChange });
 *   await h.ready;  h.addFiles([{name, path, bytes}], label);  h.render();
 *
 * Needs SELCore, SELHistory, SELDocx and SELWeather, and the page's colour tokens. Styles: history_ui.css (scoped to .hx).
 */
(function (root0) {
"use strict";

function mount(root, opts) {
opts = opts || {};
root.classList.add("hx");
root.innerHTML = `<div class="toolbar">
  <span class="hint" id="hx-snapLabel" hidden></span>
  <span class="field nosnap"><label for="hx-histSel" class="hint">History</label><select id="hx-histSel" title="Switch between histories, or make a new one"></select></span>
  <button id="hx-addFiles" class="nosnap" title="Add event files to this history (Ctrl+O)">Add files</button>
  <button id="hx-addFolder" class="nosnap" title="Add a folder (and its subfolders)">Add folder</button>
  <button class="nosnap" id="hx-watchBtn" title="Keep a folder watched: new relay files are added as they arrive (Chrome / Edge)" hidden>Watch a folder</button>
  <span class="grow"></span>
  <button id="hx-analyzerBtn" title="Open the SEL Trip Analyzer (one event at a time, with waveforms)">Trip Analyzer ↗</button>
  <button id="hx-exportBtn" class="accent" title="Export a historical report (Ctrl+S)" disabled>Export report</button>
</div>
  <input type="file" id="hx-pickFiles" multiple hidden>
  <input type="file" id="hx-pickFolder" webkitdirectory multiple hidden>

  <!-- empty state -->
  <section id="hx-emptyView">
    <div class="drop" id="hx-drop" tabindex="0" role="button" aria-label="Add files">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10v6M9 13l3-3 3 3"/></svg>
      <div class="big">Drop relay files or whole folders here</div>
      <div>Any number of stations and dates, all at once or a few at a time. Everything you add is kept in this browser.</div>
      <div class="formats mono">.CEV .EVE .SUM .HDR .HIS .CHI .SER .TXT .LOG · .CFG/.DAT/.CFF · .RDB .SET · .ZIP</div>
    </div>
    <div class="row" style="display:flex;gap:8px;justify-content:center;margin-top:12px">
      <button id="hx-samples">Try samples (2 years, 5 stations)</button>
      <button id="hx-emptyImport" title="A backup or an “all histories” file from this program">Open a backup…</button>
      <input type="file" id="hx-pickEmpty" accept=".json,application/json" hidden>
      <button id="hx-watchBtn2" hidden>Watch a folder</button>
    </div>
    <div class="empty-grid">
      <div class="card"><h3>Builds up over time</h3><p>Add this month's downloads next month: events already in the history are recognized and counted once, even when they come from a .CEV, a .SUM and a .HIS.</p></div>
      <div class="card"><h3>Finds what keeps happening</h3><p>Recurring issues, faults at the same spot on a line, breakers getting slower, trips that are increasing or decreasing at each location.</p></div>
      <div class="card"><h3>Ranks where to look first</h3><p>Locations ranked by how much and how recently they trip and how serious the issues are, with every event one click away.</p></div>
    </div>
  </section>

  <!-- main -->
  <section id="hx-mainView" hidden>
    <div class="strip">
      <span id="hx-stripText"></span>
      <span class="watchbar" id="hx-watchBar" hidden><span class="pulse"></span><span id="hx-watchText"></span><button class="small" id="hx-watchStop">Stop</button></span>
      <span class="grow"></span>
      <span class="field"><label for="hx-fFrom" class="hint">From</label><input type="date" id="hx-fFrom"></span>
      <span class="field"><label for="hx-fTo" class="hint">To</label><input type="date" id="hx-fTo"></span>
      <span class="field" title="Trends are measured up to this date. Blank = the latest event."><label for="hx-fAsOf" class="hint">Trends to</label><input type="date" id="hx-fAsOf"></span>
      <button class="small" id="hx-fReset" hidden>Reset dates</button>
    </div>
    <nav class="tabs" role="tablist" aria-label="Pages">
      <button role="tab" data-tab="overview" aria-selected="true" title="Alt+1">Overview</button>
      <button role="tab" data-tab="locations" aria-selected="false" title="Alt+2">Locations<span class="badge" id="hx-bLoc"></span></button>
      <button role="tab" data-tab="issues" aria-selected="false" title="Alt+3">Issues<span class="badge" id="hx-bIss"></span></button>
      <button role="tab" data-tab="events" aria-selected="false" title="Alt+4">Events<span class="badge" id="hx-bEv"></span></button>
      <button role="tab" data-tab="data" aria-selected="false" title="Alt+5">Files &amp; settings<span class="badge" id="hx-bFiles"></span></button>
    </nav>

    <div id="hx-page-overview" role="tabpanel"></div>
    <div id="hx-page-locations" role="tabpanel" hidden></div>
    <div id="hx-page-issues" role="tabpanel" hidden></div>
    <div id="hx-page-events" role="tabpanel" hidden></div>
    <div id="hx-page-data" role="tabpanel" hidden></div>
  </section>

<aside id="hx-drawer" aria-label="Event details" aria-hidden="true">
  <div class="dh">
    <div class="grow"><div id="hx-dTitle" style="font-weight:600"></div><div id="hx-dSub" class="hint"></div></div>
    <button class="small" id="hx-dPrev" title="Previous event (←)">◀</button>
    <button class="small" id="hx-dNext" title="Next event (→)">▶</button>
    <button class="small" id="hx-dClose" title="Close (Esc)" aria-label="Close">✕</button>
  </div>
  <div class="db" id="hx-dBody"></div>
</aside>

<dialog id="hx-expDlg" aria-labelledby="hx-expTitle">
  <div class="dlg-h"><h2 id="hx-expTitle">Export historical report</h2><button class="small" data-close aria-label="Close">✕</button></div>
  <div class="dlg-b">
    <div class="cap" style="margin-bottom:6px">Format</div>
    <div class="fmt" id="hx-expFmt">
      <label><input type="radio" name="fmt" value="docx" checked> Word (.docx)</label>
      <label><input type="radio" name="fmt" value="pdf"> PDF (print)</label>
      <label><input type="radio" name="fmt" value="txt"> Text</label>
      <label><input type="radio" name="fmt" value="csv-ev"> Events (.csv)</label>
      <label><input type="radio" name="fmt" value="csv-loc"> Locations (.csv)</label>
      <label title="One web page with this history built in, read-only, for someone without the program's data"><input type="radio" name="fmt" value="snap"> Snapshot to share (.html)</label>
    </div>
    <div class="cap" style="margin-bottom:6px">Which locations</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <select id="hx-expStation"></select>
      <select id="hx-expRelay"></select>
    </div>
    <div id="hx-expSections">
      <div class="cap">Sections</div>
      <div class="opts">
        <label class="check"><input type="checkbox" data-s="overview" checked> Overview and trip chart</label>
        <label class="check"><input type="checkbox" data-s="ranking" checked> Problem locations, ranked</label>
        <label class="check"><input type="checkbox" data-s="recurring" checked> Recurring issues</label>
        <label class="check"><input type="checkbox" data-s="hotspots" checked> Fault hot spots</label>
        <label class="check"><input type="checkbox" data-s="trends" checked> Trends</label>
        <label class="check"><input type="checkbox" data-s="breakers" checked> Breaker health</label>
        <label class="check"><input type="checkbox" data-s="weather" checked> Weather</label>
        <label class="check"><input type="checkbox" data-s="customers" checked> Customer impact</label>
        <label class="check"><input type="checkbox" data-s="reviews" checked> PRC-004 reviews</label>
        <label class="check"><input type="checkbox" data-s="matrix" checked> Issue counts by location</label>
        <label class="check"><input type="checkbox" data-s="details" checked> Details for each location</label>
        <label class="check"><input type="checkbox" data-s="events" checked> Event list in each location</label>
        <label class="check"><input type="checkbox" data-s="charts" checked> Charts (Word and PDF)</label>
        <label class="check"><input type="checkbox" data-s="worklog" checked> Work log</label>
      </div>
      <label for="hx-expNotes" class="cap">Comments at the top (optional)</label>
      <textarea id="hx-expNotes" rows="3" placeholder="e.g. Prepared for the October reliability review."></textarea>
    </div>
    <div class="field" style="margin-top:10px;width:100%"><label for="hx-expName" class="hint">File name</label><input type="text" id="hx-expName" style="flex:1"></div>
    <p class="hint" id="hx-expHint"></p>
  </div>
  <div class="dlg-f"><button data-close>Cancel</button><button class="accent" id="hx-expGo">Export</button></div>
</dialog>

<dialog id="hx-stDlg" aria-labelledby="hx-stTitle">
  <div class="dlg-h"><h2 id="hx-stTitle">Station for this relay</h2><button class="small" data-close aria-label="Close">✕</button></div>
  <div class="dlg-b">
    <p class="hint" id="hx-stHint"></p>
    <input type="text" id="hx-stName" list="hx-stList" style="width:100%" placeholder="Station name">
    <datalist id="hx-stList"></datalist>
  </div>
  <div class="dlg-f"><button id="hx-stAuto">Use what the files say</button><button data-close>Cancel</button><button class="accent" id="hx-stSave">Save</button></div>
</dialog>

<div id="hx-tip" hidden></div>
<div id="hx-toast" hidden></div>
<div id="hx-busy" hidden><div><span id="hx-busyText">Reading files…</span></div></div>`;

const VERSION = opts.version || "", REPO = opts.repo || "kefirman9000/sel-trip-analyzer";
const EMBED = !!opts.embedded;
const active = () => !opts.isActive || opts.isActive();
const core = window.SELCore, H = window.SELHistory, Docx = window.SELDocx, WX = window.SELWeather;
const $ = (id) => document.getElementById("hx-" + id);
const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (k) => `${MONTHS[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
const fmtDate = (ms) => (ms === null || ms === undefined ? "–" : H.isoDate(ms));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
const upper = (s) => String(s || "").trim().toUpperCase();
const ALLOWED = new Set(core.ALL_EXTS);

const state = {
  files: [], batches: [], records: [], model: null, cfg: Object.assign({}, H.DEFAULTS), notes: {}, worklog: {}, overrides: {},
  tab: "overview", relay: "", evFilter: { q: "", station: "", relay: "", issue: "", show: "all", month: "", sort: "newest" },
  drawer: { id: null, list: [] }, locGroup: "rank", errors: [],
  weather: {}, locations: {}, baseline: null, changes: [], colorBy: "type", settingsFiles: {},
};

// ---------------------------------------------------------------- storage (IndexedDB): one database per history
const prefs = {
  get(k, d) { try { const v = localStorage.getItem("sel-history:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("sel-history:" + k, JSON.stringify(v)); } catch (e) { /* unavailable */ } },
};
/** What the Trip Analyzer keeps (same browser storage): notes and PRC-004 reviews, keyed by the same event ids. */
const shared = {
  get(k, d) { try { const v = localStorage.getItem("sel-trip:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("sel-trip:" + k, JSON.stringify(v)); } catch (e) { /* unavailable */ } },
};
const SNAP = opts.snapshot || null;          // a read-only snapshot: the data comes with the page
const reviewsMap = () => (SNAP ? SNAP.reviews || {} : shared.get("reviews", {}));
/** Plain English or engineering wording: one switch, shared with the Trip Analyzer. */
const plainOn = () => shared.get("plain", SNAP && SNAP.plain !== undefined ? !!SNAP.plain : false);
const PL = window.SELPlain;
const IL = (k) => H.issueLabel(k, state.plain), IS = (k) => H.issueShort(k, state.plain);
const noteOf = (id) => (state.sharedNotes && state.sharedNotes[id]) || state.notes[id] || "";
if (SNAP) root.classList.add("hx-snap");
const MAIN = { id: "main", name: "Main history" };
function histList() { const l = prefs.get("list", null); return Array.isArray(l) && l.length ? l : [MAIN]; }
function saveList(l) { prefs.set("list", l); }
const dbNameOf = (id) => (id === "main" ? "sel-trip-history" : "sel-trip-history:" + id);
let current = histList().some((h) => h.id === prefs.get("current", "main")) ? prefs.get("current", "main") : histList()[0].id;
const currentName = () => (histList().find((h) => h.id === current) || MAIN).name;
let dbp = null;
function openDb(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore("files", { keyPath: "hash" });
      d.createObjectStore("batches", { keyPath: "id" });
      d.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function db() { if (!dbp) dbp = openDb(dbNameOf(current)); return dbp; }
async function txOn(dbPromise, store, mode, fn) {
  const d = await dbPromise;
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r && "onsuccess" in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("storage aborted (the disk may be full)"));
  });
}
const tx = (store, mode, fn) => txOn(db(), store, mode, fn);
const kvGet = (k) => tx("kv", "readonly", (s) => s.get(k)).catch(() => undefined);
const kvSet = (k, v) => (SNAP ? Promise.resolve() : tx("kv", "readwrite", (s) => s.put(v, k)).catch((e) => toast("Couldn't save: " + (e.message || e))));
const allOf = (store) => tx(store, "readonly", (s) => s.getAll()).catch(() => []);

// ---------------------------------------------------------------- hashing
async function hashBytes(bytes) {
  try {
    if (window.crypto && crypto.subtle) {
      const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch (e) { /* fall back */ }
  let h1 = 0x811c9dc5, h2 = 0x01000193;                 // FNV-1a, two lanes
  for (let i = 0; i < bytes.length; i++) { h1 = Math.imul(h1 ^ bytes[i], 16777619) >>> 0; h2 = Math.imul(h2 ^ bytes[i], 2246822519) >>> 0; }
  return "f" + h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0") + bytes.length.toString(16);
}

// ---------------------------------------------------------------- UI helpers
function toast(t, ms) {
  const el = $("toast"); el.textContent = t; el.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, ms || 4200);
}
function busy(on, text) { $("busy").hidden = !on; if (text) $("busyText").textContent = text; }
const tip = $("tip");
document.addEventListener("mouseover", (e) => {
  const el = e.target.closest("[data-tip]");
  if (!el || !root.contains(el)) { tip.hidden = true; return; }
  tip.textContent = el.getAttribute("data-tip"); tip.hidden = false;
});
document.addEventListener("mousemove", (e) => {
  if (tip.hidden) return;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(window.innerWidth - w - 8, e.clientX + 14) + "px";
  tip.style.top = (e.clientY + h + 24 > window.innerHeight ? e.clientY - h - 10 : e.clientY + 16) + "px";
});
const trendHtml = (t, short) => `<span class="tr ${t.dir}" data-tip="${esc(H.trendWords(t))}${t.short && t.basis === "year" ? `\nLast ${t.short.days} days: ${t.short.recent} vs ${t.short.prev}` : ""}">${t.dir === "up" ? "▲" : t.dir === "down" ? "▼" : "–"}${short ? "" : " " + esc(t.label)}</span>`;
const where = (L) => `${esc(L.relay)}${L.station && L.station !== "Unassigned" ? ` <span class="muted">· ${esc(L.station)}</span>` : ""}`;
function issueChips(r, max) {
  const m = state.model;
  const rec = new Set(m.recurring.filter((x) => x.allIds.includes(r.id)).map((x) => x.key));
  const hot = m.hotspots.some((h) => h.ids.includes(r.id));
  const list = r.issues.filter((x) => H.ISSUE[x.key].group !== "data");
  const chips = list.slice(0, max || 9).map((x) => `<span class="chip${rec.has(x.key) ? " rec" : ""}" ${rec.has(x.key) ? 'data-tip="Recurring at this location"' : ""}>${esc(IS(x.key))}${x.detail && !/^[ABC]+G?$/.test(x.detail) ? " " + esc(x.detail) : ""}</span>`);
  if (hot) chips.push(`<span class="chip hot" data-tip="Part of a fault hot spot (same distance as other faults)">${state.plain ? "same spot again" : "hot spot"}</span>`);
  if (r.pair) chips.push(`<span class="chip pair" data-tip="Same fault seen from the other end">${state.plain ? "also seen at " : "↔ "}${esc(r.pair)}</span>`);
  if (r.reviewStatus === "misop") chips.push(`<span class="chip rec" data-tip="${esc("PRC-004 review: misoperation" + (r.review.category ? "\n" + r.review.category : "") + (r.review.cause ? "\nCause: " + r.review.cause : ""))}">misoperation</span>`);
  else if (r.reviewStatus === "overdue") chips.push(`<span class="chip hot" data-tip="${esc(`Not reviewed: the decision was due ${r.reviewDue}`)}">review overdue</span>`);
  if (r.occSize > 1) chips.push(`<span class="chip" data-tip="Part of a sequence of ${r.occSize} reports (recloses) on this relay">${state.plain ? `${r.occSize} tries` : `seq ×${r.occSize}`}</span>`);
  return chips.join("");
}

// ---------------------------------------------------------------- charts (SVG)
function sparkSvg(values, w, h) {
  w = w || 90; h = h || 24;
  const max = Math.max(1, ...values), bw = w / values.length;
  const bars = values.map((v, i) => v ? `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(h - (h - 2) * v / max).toFixed(1)}" width="${(bw - 1.5).toFixed(1)}" height="${((h - 2) * v / max).toFixed(1)}" rx="1" fill="var(--c-fault)"/>`
                                     : `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${h - 1}" width="${(bw - 1.5).toFixed(1)}" height="1" fill="var(--border)"/>`).join("");
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Trips per month, last ${values.length} months">${bars}</svg>`;
}
/** Stacked monthly bars. series: [{label, color, values}], markers: [{month, text}]. */
function barChart(months, series, opts) {
  opts = opts || {};
  const W = 1000, Hh = opts.height || 220, padL = 34, padB = 26, padT = 18, padR = 8;
  const n = months.length || 1, iw = W - padL - padR, ih = Hh - padB - padT, bw = iw / n;
  const tot = months.map((_, i) => series.reduce((a, s) => a + s.values[i], 0));
  const max = Math.max(1, ...tot);
  const step = max <= 5 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : Math.ceil(max / 6 / 5) * 5;
  const top = Math.ceil(max / step) * step;
  const y = (v) => padT + ih - ih * v / top;
  let g = "";
  for (let v = 0; v <= top; v += step) g += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/><text x="${padL - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`;
  const every = n <= 14 ? 1 : n <= 26 ? 2 : n <= 40 ? 3 : 6;
  months.forEach((m, i) => {
    let acc = 0;
    const x = padL + i * bw + bw * 0.12, w = Math.max(1, bw * 0.76);
    const lines = series.filter((s) => s.values[i]).map((s) => `${s.label}: ${s.values[i]}`);
    for (const s of series) {
      const v = s.values[i]; if (!v) continue;
      g += `<rect x="${x.toFixed(1)}" y="${y(acc + v).toFixed(1)}" width="${w.toFixed(1)}" height="${(y(acc) - y(acc + v)).toFixed(1)}" fill="${s.color}"/>`;
      acc += v;
    }
    g += `<rect class="bar" data-month="${m}" data-tip="${esc(monthLabel(m))}\n${esc(lines.join("\n") || "nothing")}${opts.clickHint ? "\n" + opts.clickHint : ""}" x="${(padL + i * bw).toFixed(1)}" y="${padT}" width="${bw.toFixed(1)}" height="${ih}" fill="transparent"/>`;
    if (i % every === 0 || i === n - 1 && n < 30) {
      const lbl = m.endsWith("-01") || i === 0 ? `${MONTHS[+m.slice(5) - 1]} ${m.slice(2, 4)}` : MONTHS[+m.slice(5) - 1];
      g += `<text x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${Hh - 8}" text-anchor="middle">${lbl}</text>`;
    }
  });
  for (const mk of opts.markers || []) {
    const i = months.indexOf(mk.month);
    if (i < 0) continue;
    const day = +mk.date.slice(8, 10) || 1;
    const x = padL + (i + (day - 1) / 31) * bw;
    g += `<line class="mark" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${padT - 6}" y2="${padT + ih}"/><text class="marklbl" x="${(x + 4).toFixed(1)}" y="${padT - 6}" data-tip="${esc(mk.date + ": " + mk.text)}">✓ ${esc(mk.text.length > 26 ? mk.text.slice(0, 25) + "…" : mk.text)}</text>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${esc(opts.label || "Monthly chart")}">${g}</svg>`;
}
/** Faults along the line: one dot per fault occasion at its distance; hot spots shaded. */
function lineStrip(L) {
  const pts = [];
  const seen = new Set();
  for (const r of L.records) {
    if (!r.fault || r.locNum === null || seen.has(r.occ)) continue;
    seen.add(r.occ); pts.push(r);
  }
  if (!pts.length) return '<p class="hint">No fault locations in these records.</p>';
  const W = 1000, Hh = 110, padL = 20, padR = 20, yLine = 66;
  const ll = L.ll || Math.max(...pts.map((r) => r.locNum)) * 1.05 || 1;
  const lo = Math.min(0, ...pts.map((r) => r.locNum)), hi = Math.max(ll, ...pts.map((r) => r.locNum));
  const x = (v) => padL + (W - padL - padR) * (v - lo) / (hi - lo || 1);
  let g = "";
  for (const h of L.hotspots) g += `<rect x="${(x(h.from - h.tol / 2)).toFixed(1)}" y="8" width="${Math.max(6, x(h.to + h.tol / 2) - x(h.from - h.tol / 2)).toFixed(1)}" height="${yLine + 10}" rx="4" fill="var(--warn)" opacity=".16" data-tip="${esc(`Hot spot: ${h.n} faults at ${h.from.toFixed(2)} to ${h.to.toFixed(2)}`)}"/>`;
  g += `<line x1="${x(0).toFixed(1)}" x2="${x(ll).toFixed(1)}" y1="${yLine}" y2="${yLine}" stroke="var(--text)" stroke-width="2.5"/>`;
  g += `<rect x="${(x(0) - 5).toFixed(1)}" y="${yLine - 9}" width="10" height="18" fill="var(--text)"/><text x="${x(0).toFixed(1)}" y="${yLine + 26}" text-anchor="${lo < 0 ? "middle" : "start"}">relay · 0</text>`;
  g += `<text x="${x(ll).toFixed(1)}" y="${yLine + 26}" text-anchor="end">${L.ll ? `line end · ${L.ll}` : `${ll.toFixed(1)} (line length unknown)`}</text>`;
  const ticks = 10;
  for (let i = 1; i < ticks; i++) { const v = ll * i / ticks; g += `<line x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="${yLine - 3}" y2="${yLine + 3}" stroke="var(--muted)"/>`; }
  // stack dots that land close together
  const col = (r) => (r.phases.includes("A") ? "var(--pA)" : r.phases.includes("B") ? "var(--pB)" : r.phases.includes("C") ? "var(--pC)" : "var(--pX)");
  const stacks = [];
  pts.sort((a, b) => a.locNum - b.locNum).forEach((r) => {
    const px = x(r.locNum);
    let level = 0;
    while (stacks.some((s) => s.level === level && Math.abs(s.px - px) < 11)) level++;
    stacks.push({ px, level });
    const cy = yLine - 12 - level * 11;
    const recent = state.model.anchor - r.ms < 365 * 864e5;
    g += `<circle data-id="${esc(r.id)}" class="bar" cx="${px.toFixed(1)}" cy="${Math.max(6, cy).toFixed(1)}" r="5" fill="${recent ? col(r) : "transparent"}" stroke="${col(r)}" stroke-width="1.6" data-tip="${esc(`${r.date} ${r.et}\nat ${r.loc}${r.locPct !== null ? ` (${r.locPct}% of line)` : ""}\nClick for details`)}"/>`;
  });
  const legend = `<div class="legend" style="margin-top:4px"><span><i style="background:var(--pA)"></i>A</span><span><i style="background:var(--pB)"></i>B</span><span><i style="background:var(--pC)"></i>C</span><span><i style="background:var(--pX)"></i>other</span><span>● last 12 months · ○ older</span>${L.hotspots.length ? '<span><i style="background:var(--warn);opacity:.4"></i>hot spot</span>' : ""}</div>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Fault locations along the line">${g}</svg>${legend}`;
}
function chartSeries(m, recs) {
  const idx = new Map(m.months.map((k, i) => [k, i]));
  if (state.colorBy === "weather") {
    const st = m.months.map(() => 0), ca = m.months.map(() => 0), un = m.months.map(() => 0);
    for (const r of recs) {
      if (r.ms === null || !r.tripped) continue;
      const i = idx.get(H.monthKey(r.ms)); if (i === undefined) continue;
      if (r.storm === true) st[i]++; else if (r.storm === false) ca[i]++; else un[i]++;
    }
    const s = [{ label: "Trips in storms", color: "var(--c-nofault)", values: st }, { label: "Trips in calm weather", color: "var(--c-fault)", values: ca }];
    if (un.some(Boolean)) s.push({ label: "Weather not looked up", color: "var(--c-other)", values: un });
    return s;
  }
  const f = m.months.map(() => 0), nf = m.months.map(() => 0), o = m.months.map(() => 0);
  for (const r of recs) {
    if (r.ms === null) continue;
    const i = idx.get(H.monthKey(r.ms)); if (i === undefined) continue;
    if (r.fault && r.tripped) f[i]++; else if (r.tripped) nf[i]++; else o[i]++;
  }
  const s = [{ label: "Fault trips", color: "var(--c-fault)", values: f }, { label: "Trips with no fault", color: "var(--c-nofault)", values: nf }];
  if (o.some(Boolean)) s.push({ label: "No trip", color: "var(--c-other)", values: o });
  return s;
}
const legendHtml = (series) => `<div class="legend" style="align-items:center">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join("")}
  <span class="seg" role="group" aria-label="Colour by"><button data-colorby="type" aria-pressed="${state.colorBy === "type"}">Type</button><button data-colorby="weather" aria-pressed="${state.colorBy === "weather"}" title="${Object.keys(state.weather).length ? "Storm or calm at the time of each trip" : "Look up the weather first (Files & settings)"}">Weather</button></span></div>`;
root.addEventListener("click", (e) => {
  const b = e.target.closest("[data-colorby]"); if (!b) return;
  state.colorBy = b.dataset.colorby; prefs.set("colorBy", state.colorBy);
  if (state.colorBy === "weather" && !Object.keys(state.weather).length) toast("No weather yet: set the station locations and click Look up weather on the Files & settings page.");
  render();
});
const wxTag = (r) => (r.wx ? `<span class="wxtag ${r.storm ? "storm" : "calm"}" data-tip="${esc(r.wx.text + (r.wx.hints ? "\n" + r.wx.hints.join("\n") : ""))}">${r.storm ? esc(r.wx.kinds.map((k) => H.WX_LABEL[k] || k).join(", ")) : "calm"}</span>` : "");
/** Clearing time of each breaker opening over time, with the slow limit and the trend line. */
function breakerChart(b) {
  const m = state.model;
  const W = 1000, Hh = 200, padL = 40, padR = 14, padT = 14, padB = 26;
  const x0 = Math.min(m.first, b.points[0].ms), x1 = Math.max(m.anchor, b.points[b.points.length - 1].ms);
  const top = Math.ceil(Math.max(b.limit + 2, b.max + 1));
  const X = (ms) => padL + (W - padL - padR) * (ms - x0) / (x1 - x0 || 1), Y = (v) => padT + (Hh - padT - padB) * (1 - v / top);
  let g = "";
  for (let v = 0; v <= top; v += top > 10 ? 2 : 1) g += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${padL - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`;
  g += `<line x1="${padL}" x2="${W - padR}" y1="${Y(b.limit).toFixed(1)}" y2="${Y(b.limit).toFixed(1)}" stroke="var(--trip)" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${W - padR}" y="${(Y(b.limit) - 5).toFixed(1)}" text-anchor="end" style="fill:var(--trip)">slow: over ${b.limit} cycles</text>`;
  for (const k of m.months) if (k.endsWith("-01") || k === m.months[0]) { const ms = Date.parse(k + "-01T00:00:00Z"); if (ms >= x0) g += `<text x="${X(ms).toFixed(1)}" y="${Hh - 6}" text-anchor="middle">${MONTHS[+k.slice(5) - 1]} ${k.slice(2, 4)}</text>`; }
  if (b.fit) g += `<line x1="${X(b.fit.from[0]).toFixed(1)}" y1="${Y(b.fit.from[1]).toFixed(1)}" x2="${X(b.fit.to[0]).toFixed(1)}" y2="${Y(b.fit.to[1]).toFixed(1)}" stroke="${b.slowing ? "var(--trip)" : "var(--muted)"}" stroke-width="2" opacity=".7"/>`;
  for (const p of b.points) g += `<circle class="bar" data-id="${esc(p.id)}" cx="${X(p.ms).toFixed(1)}" cy="${Y(p.cyc).toFixed(1)}" r="6" fill="${p.cyc > b.limit ? "var(--trip)" : "var(--c-fault)"}" data-tip="${esc(`${H.isoDate(p.ms)}: opened ${p.cyc} cycles after the trip\nClick for the event`)}"/>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Breaker clearing time over time">${g}</svg>`;
}

// ---------------------------------------------------------------- analysis
async function rebuild(reanalyze) {
  if (SNAP) reanalyze = false;
  if (reanalyze) {
    const sig = state.files.map((f) => f.hash).sort().join(",");
    const cache = await kvGet("cache");
    if (cache && cache.sig === sig && cache.v === VERSION) { state.records = cache.records; state.errors = cache.errors || []; }
    else {
      busy(true, `Analyzing ${plural(state.files.length, "file")}…`);
      await new Promise((r) => setTimeout(r, 30));
      const t0 = performance.now();
      const res = await H.analyzeFiles(state.files.map((f) => ({ name: f.name, path: f.path, bytes: f.bytes, site: f.site, hash: f.hash })));
      state.records = res.records; state.errors = res.errors;
      await kvSet("cache", { sig, v: VERSION, records: res.records, errors: res.errors });
      busy(false);
      console.info(`analyzed ${state.files.length} files in ${Math.round(performance.now() - t0)} ms`);
    }
  }
  state.sharedNotes = SNAP ? SNAP.notes || {} : shared.get("notes", {});
  const cfg = Object.assign({}, state.cfg, { overrides: state.overrides, worklog: state.worklog, weather: state.weather, reviews: reviewsMap(), customers: state.customers || {} });
  state.model = H.buildModel(state.records, cfg);
  // what changed since the user last marked the changes as seen (or since the first files were added)
  if (!SNAP && !state.baseline && state.records.length) { state.baseline = { ids: state.records.map((r) => r.id), at: new Date().toISOString() }; kvSet("baseline", state.baseline); }
  state.changes = [];
  if (state.baseline) {
    const seen = new Set(state.baseline.ids), newIds = state.records.filter((r) => !seen.has(r.id)).map((r) => r.id);
    if (newIds.length) state.changes = H.changes(H.buildModel(state.records.filter((r) => seen.has(r.id)), cfg), state.model, newIds);
    state.newIds = newIds;
  }
  if (state.relay && !state.model.relays.some((L) => L.key === state.relay)) state.relay = "";
  render();
}

// ---------------------------------------------------------------- adding files
function siteFromPath(path) {
  const parts = String(path || "").split("/").slice(0, -1);
  if (!parts.length) return "";
  const named = [...parts].reverse().find((p) => /\b(sub|substation|station|stn|switchyard|plant)\b/i.test(p.replace(/[_-]/g, " ")));
  if (named) return named.replace(/[_]+/g, " ").trim().toUpperCase();
  return "";
}
async function addFiles(list, label, quiet) {
  list = list.filter((x) => ALLOWED.has(core.extOf(x.name)) && !x.name.toUpperCase().startsWith("README"));
  if (!list.length) { if (!quiet) toast("No relay files found in what was added."); return 0; }
  busy(true, `Reading ${plural(list.length, "file")}…`);
  const known = new Set(state.files.map((f) => f.hash));
  const batch = { id: "b" + Date.now().toString(36), label: label || "", added: new Date().toISOString(), nFiles: 0, nDup: 0 };
  const fresh = [];
  for (const x of list) {
    const bytes = x.bytes || new Uint8Array(await x.file.arrayBuffer());
    const hash = await hashBytes(bytes);
    if (known.has(hash)) { batch.nDup++; continue; }
    known.add(hash);
    fresh.push({ hash, name: x.name, path: x.path || x.name, site: siteFromPath(x.path), size: bytes.length, batch: batch.id, added: batch.added, bytes });
  }
  batch.nFiles = fresh.length;
  if (!fresh.length) { busy(false); if (!quiet) toast(`Nothing new: all ${plural(batch.nDup, "file")} are already in the history.`); return 0; }
  const before = new Set(state.records.map((r) => r.id));
  try {
    await tx("files", "readwrite", (s) => { for (const f of fresh) s.put(f); });
    await tx("batches", "readwrite", (s) => s.put(batch));
  } catch (e) { toast("Couldn't keep the files in this browser (" + (e.message || e) + "). They're analyzed for now but won't be remembered."); }
  state.files.push(...fresh); state.batches.push(batch);
  busy(false);
  await rebuild(true);
  const added = state.records.filter((r) => !before.has(r.id)).length;
  batch.nEvents = added;
  tx("batches", "readwrite", (s) => s.put(batch)).catch(() => {});
  const big = state.changes.filter((c) => c.level >= 2).length;
  toast(`${label && label.startsWith("Watched") ? "Picked up" : "Added"} ${plural(fresh.length, "file")}${batch.nDup ? ` (${batch.nDup} already in the history)` : ""}: ${plural(added, "new event")}.` +
        (big ? ` ${plural(big, "notable change")}: see What changed on the Overview.` : "") +
        (state.errors.length ? ` ${plural(state.errors.length, "file")} couldn't be read: see Files & settings.` : ""), 7000);
  if (added && Object.keys(state.locations).length && state.cfg.autoWeather !== false) lookupWeather(true);
  return fresh.length;
}
function walkEntry(entry, prefix, out) {
  return new Promise((resolve) => {
    if (entry.isFile) entry.file((f) => { out.push({ file: f, name: f.name, path: prefix + f.name }); resolve(); }, () => resolve());
    else if (entry.isDirectory) {
      const reader = entry.createReader(), all = [];
      const more = () => reader.readEntries(async (ents) => {
        if (!ents.length) { for (const en of all) await walkEntry(en, prefix + entry.name + "/", out); resolve(); return; }
        all.push(...ents); more();
      }, () => resolve());
      more();
    } else resolve();
  });
}
let dragDepth = 0;
document.addEventListener("dragenter", (e) => { if (!active()) return; e.preventDefault(); if (++dragDepth === 1) root.classList.add("dragging"); });
document.addEventListener("dragleave", () => { if (!active()) return; if (--dragDepth <= 0) { dragDepth = 0; root.classList.remove("dragging"); } });
document.addEventListener("dragover", (e) => { if (!active()) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; });
document.addEventListener("drop", async (e) => {
  if (!active()) return;
  e.preventDefault(); dragDepth = 0; root.classList.remove("dragging");
  const dt = e.dataTransfer; if (!dt) return;
  const entries = dt.items ? [...dt.items].filter((i) => i.kind === "file").map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)) : [];
  const list = [];
  if (entries.length && entries.every(Boolean)) for (const en of entries) await walkEntry(en, "", list);
  else for (const f of dt.files) list.push({ file: f, name: f.name, path: f.name });
  addFiles(list);
});
$("pickFiles").addEventListener("change", (e) => { addFiles([...e.target.files].map((f) => ({ file: f, name: f.name, path: f.name }))); e.target.value = ""; });
$("pickFolder").addEventListener("change", (e) => { addFiles([...e.target.files].map((f) => ({ file: f, name: f.name, path: f.webkitRelativePath || f.name }))); e.target.value = ""; });
$("addFiles").onclick = () => $("pickFiles").click();
$("addFolder").onclick = () => $("pickFolder").click();
$("drop").onclick = () => $("pickFiles").click();
$("drop").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("pickFiles").click(); } };
async function loadSamples() {
  const data = typeof opts.samples === "function" ? opts.samples() : opts.samples || [];
  if (!data.length) { toast("The samples aren't included in this copy."); return; }
  const list = data.map((s) => { const bin = atob(s.b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return { name: s.name, path: s.path, bytes }; });
  if (!state.worklog["FEEDER 8"]) { state.worklog["FEEDER 8"] = [{ date: "2025-12-10", text: "Tree trimming, whole feeder (sample)" }]; await kvSet("worklog", state.worklog); }
  // made-up stations, put in real towns so the weather lookup has somewhere to look
  const SAMPLE_LOCS = { "APEX SUB": ["Apex, North Carolina, US", 35.7327, -78.8503], "OAK HILL SUB": ["Holly Springs, North Carolina, US", 35.6513, -78.8336],
    "RIVER SUB": ["Fuquay-Varina, North Carolina, US", 35.5843, -78.8000], "HILL SUB": ["Cary, North Carolina, US", 35.7915, -78.7811], "MILL ROAD SUB": ["Garner, North Carolina, US", 35.7113, -78.6142] };
  for (const [st, [label, lat, lon]] of Object.entries(SAMPLE_LOCS)) if (!state.locations[st]) state.locations[st] = { label, lat, lon, typed: label + " (sample)" };
  await kvSet("locations", state.locations);
  await addFiles(list, "Samples (made-up events)");
}
$("samples").onclick = loadSamples;

// ---------------------------------------------------------------- top-level render
function render() {
  state.plain = plainOn();
  root.classList.toggle("hx-plain", !!state.plain);
  watchStatus();
  const m = state.model;
  const has = !!(m && m.records.length) || state.files.length;
  $("emptyView").hidden = !!has; $("mainView").hidden = !has; $("exportBtn").disabled = !(m && m.records.length);
  renderHistSel();
  if (opts.onChange) opts.onChange({ name: currentName(), events: m ? m.records.length : 0, files: state.files.length });
  if (!has) return;
  const t = m.totals;
  const dated = m.records.filter((r) => r.ms !== null);
  $("stripText").innerHTML = `<b>${t.events}</b> events · <b>${t.trips}</b> trips · <b>${t.relays}</b> relays at <b>${t.stations}</b> stations · ` +
    (dated.length ? `${fmtDate(dated[0].ms)} to ${fmtDate(dated[dated.length - 1].ms)}` : "no dated events") +
    (SNAP ? ` <span class="hint">· read-only snapshot</span>` : ` <span class="hint">· kept in this browser</span>`);
  if (SNAP) { $("snapLabel").hidden = false; $("snapLabel").innerHTML = `Snapshot of <b>${esc(SNAP.name || "a history")}</b>${SNAP.scope ? ` (${esc(SNAP.scope)})` : ""}, made ${esc((SNAP.made || "").slice(0, 10))} · read-only`; }
  $("bLoc").textContent = t.relays; $("bIss").textContent = m.recurring.length ? `${m.recurring.length} recurring` : ""; $("bEv").textContent = t.events; $("bFiles").textContent = state.files.length;
  $("fFrom").value = state.cfg.from || ""; $("fTo").value = state.cfg.to || ""; $("fAsOf").value = state.cfg.asOf || "";
  $("fReset").hidden = !(state.cfg.from || state.cfg.to || state.cfg.asOf);
  for (const b of root.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === state.tab));
  for (const p of ["overview", "locations", "issues", "events", "data"]) $("page-" + p).hidden = p !== state.tab;
  ({ overview: renderOverview, locations: renderLocations, issues: renderIssues, events: renderEvents, data: renderData })[state.tab]();
}
function go(tab, opts) {
  state.tab = tab;
  if (opts && opts.relay !== undefined) state.relay = opts.relay;
  if (opts && opts.ev) Object.assign(state.evFilter, { q: "", station: "", relay: "", issue: "", show: "all", month: "" }, opts.ev);
  render(); if (!EMBED) window.scrollTo({ top: 0 }); else root.scrollIntoView({ block: "start" });
}
for (const b of root.querySelectorAll(".tabs button")) b.onclick = () => go(b.dataset.tab);
for (const [id, key] of [["fFrom", "from"], ["fTo", "to"], ["fAsOf", "asOf"]]) $(id).addEventListener("change", (e) => { state.cfg[key] = e.target.value; kvSet("cfg", state.cfg); rebuild(false); });
$("fReset").onclick = () => { state.cfg.from = state.cfg.to = state.cfg.asOf = ""; kvSet("cfg", state.cfg); rebuild(false); };

// ---------------------------------------------------------------- overview
function renderOverview() {
  const m = state.model, t = m.totals, el = $("page-overview");
  const series = chartSeries(m, m.records);
  const maxScore = Math.max(1, ...m.relays.map((L) => L.score));
  const worse = m.relays.filter((L) => L.trend.dir === "up"), better = m.relays.filter((L) => L.trend.dir === "down");
  const ch = state.changes || [];
  const bks = m.breakers.filter((b) => b.n);
  el.innerHTML = `
  ${ch.length ? `<div class="card changes" style="margin-bottom:16px">
    <div class="card-head"><h2>What changed</h2><span class="hint">since ${esc((state.baseline.at || "").slice(0, 10))}: ${plural((state.newIds || []).length, "new event")}${ch.length > 8 ? ` · <button class="link" id="hx-chgAll">all ${ch.length}</button>` : ""} · <button class="link" id="hx-chgSeen">mark as seen</button></span></div>
    ${ch.slice(0, state.chgAll ? ch.length : 8).map((c, i) => `<div class="chg l${c.level}" data-chg="${i}" tabindex="0"><span class="dot"></span><span class="who">${esc(c.relay)}</span><span>${esc(c.text)}</span></div>`).join("")}
  </div>` : ""}
  <div class="kpis">
    <button class="kpi" data-go="events"><div class="v">${t.trips}</div><div class="l">trips of ${t.events} events</div></button>
    <button class="kpi" data-go="locations"><div class="v">${t.relays}</div><div class="l">relays at ${plural(t.stations, "station")}</div></button>
    <button class="kpi" data-go="locations" data-tip="${esc(H.trendWords(m.trend))}"><div class="v ${m.trend.dir}">${m.trend.dir === "up" ? "▲" : m.trend.dir === "down" ? "▼" : "–"} ${m.trend.recent}</div><div class="l">trips ${m.trend.days >= 360 ? "in the last year" : `last ${m.trend.days} days`} (${m.trend.prev} before)</div></button>
    <button class="kpi" data-go="issues"><div class="v ${m.recurring.length ? "up" : ""}">${m.recurring.length}</div><div class="l">recurring issues</div></button>
    <button class="kpi" data-go="issues"><div class="v">${m.hotspots.length}</div><div class="l">fault hot spots</div></button>
    <button class="kpi" data-go="events" data-show="review"><div class="v">${t.review}</div><div class="l">events to review</div></button>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="card-head"><h2>Trips per month</h2>${legendHtml(series)}</div>
    ${barChart(m.months, series, { label: "Trips per month, all locations", clickHint: "Click to list them" })}
  </div>
  <div class="grid2">
    <div class="card">
      <div class="card-head"><h2>Where to look first</h2><button class="link" data-go="locations">All ${t.relays} locations →</button></div>
      <ul class="rl">${m.relays.slice(0, 8).map((L) => `
        <li data-relay="${esc(L.key)}" tabindex="0">
          <span class="rank${L.rank === 1 ? " r1" : ""}">${L.rank}</span>
          <span style="min-width:0;display:block;overflow:hidden"><span class="name">${where(L)}</span>
            <span class="meta">${L.recurring.length ? `<span class="trip">${L.recurring.map((x) => esc(IS(x.key).toLowerCase())).join(", ")} recurring</span> · ` : ""}${plural(L.tripOccasions, "trip")} · last ${fmtDate(L.lastTrip)}</span>
            <span class="scorebar" data-tip="Score ${L.score}"><i style="width:${(100 * L.score / maxScore).toFixed(0)}%"></i></span></span>
          <span class="sp" data-tip="Trips per month, last 12 months">${sparkSvg(L.spark)}</span>
          <span style="text-align:right">${trendHtml(L.trend)}</span>
        </li>`).join("")}</ul>
    </div>
    <div class="card">
      <div class="card-head"><h2>Recurring issues</h2><button class="link" data-go="issues">Issues →</button></div>
      ${m.recurring.length ? m.recurring.slice(0, 7).map((x, i) => `
        <div class="recur" data-recur="${i}" tabindex="0">
          <div class="top"><span class="what">${esc(IL(x.key))}</span><span>${trendHtml(x.trend)}</span></div>
          <div class="where">${where(x)} · ${x.inWindow} times in ${x.windowDays} days${x.total > x.inWindow ? ` (${x.total} in all)` : ""} · last ${fmtDate(x.last)}${x.clearing ? ` · ${x.clearing.first} → ${x.clearing.last} cycles` : ""}</div>
        </div>`).join("") : `<p class="hint">Nothing happened ${state.cfg.recurMin} or more times within the recurrence window at one location.</p>`}
    </div>
  </div>
  ${bks.length || m.wx.known ? `<div class="grid2 even">
    <div class="card"><div class="card-head"><h2>Breakers</h2><span class="hint">trip to breaker open, from .CEV / COMTRADE</span></div>
      ${bks.length ? `<table class="t"><thead><tr><th>Location</th><th class="r">Timed</th><th class="r">Latest</th><th>Verdict</th></tr></thead><tbody>${bks.map((b) => `<tr class="click" data-relay="${esc(b.relayKey)}"><td>${where(b)}</td><td class="r num">${b.n}</td><td class="r num">${b.latest} cyc</td><td class="bk-verdict${b.slowing || b.latest > b.limit ? " bad" : ""}">${esc(b.verdict)}</td></tr>`).join("")}</tbody></table>` : '<p class="hint">No clearing times yet: they come from .CEV or COMTRADE records that include the breaker status.</p>'}</div>
    <div class="card"><div class="card-head"><h2>Weather</h2><span class="hint">${m.wx.known ? `${m.wx.known} trips with weather` : ""}</span></div>
      ${m.wx.known ? `<p style="margin:0 0 8px"><b>${m.wx.storm}</b> of ${m.wx.known} trips (${Math.round(100 * m.wx.storm / m.wx.known)}%) happened in storms${Object.keys(m.wx.kinds).length ? `: ${Object.entries(m.wx.kinds).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(H.WX_LABEL[k] || k)} ${n}`).join(", ")}` : ""}.</p>
        <table class="t"><tbody>${m.relays.filter((L) => L.wx.known).sort((a, b) => b.wx.known - a.wx.known).slice(0, 8).map((L) => `<tr class="click" data-relay="${esc(L.key)}"><td>${where(L)}</td><td class="num">${L.wx.calm} calm · ${L.wx.storm} storm</td><td style="width:40%"><span class="scorebar" style="margin:0"><i style="width:${Math.round(100 * L.wx.storm / L.wx.known)}%;background:var(--c-nofault)"></i></span></td></tr>`).join("")}</tbody></table>
        ${m.recurring.filter((x) => x.weatherNote).map((x) => `<p class="hint" style="margin:6px 0 0"><b>${esc(x.relay)}</b>, ${esc(IL(x.key).toLowerCase())}: ${esc(x.weatherNote)}</p>`).join("")}`
        : `<p class="hint">Set where each station is and look up the weather at each trip: storms explain some trips; repeat trips in calm weather point to the line itself.</p><button id="hx-ovWx" class="nosnap">Set up weather</button>`}</div>
  </div>` : ""}
  ${m.customers || m.reviews.reviewed ? `<div class="grid2 even">
    ${m.customers ? `<div class="card"><div class="card-head"><h2>Customer impact</h2><span class="hint">last 12 months · estimate</span></div>
      <div class="stats" style="margin:0 0 10px"><div class="stat"><div class="v">${m.customers.saifi.toFixed(2)}</div><div class="l">${state.plain ? "outages per customer (SAIFI)" : "SAIFI: sustained interruptions per customer"}</div></div>
        <div class="stat"><div class="v">${m.customers.maifi.toFixed(2)}</div><div class="l">${state.plain ? "blinks per customer (MAIFI)" : "MAIFI: momentary per customer"}</div></div>
        <div class="stat"><div class="v">${m.customers.served.toLocaleString()}</div><div class="l">customers on ${plural(m.customers.locations, "circuit")}</div></div></div>
      <table class="t"><thead><tr><th>Location</th><th class="r">Customers</th><th class="r">${state.plain ? "Customer outages" : "Sustained"}</th><th class="r">${state.plain ? "Blinks" : "Momentary"}</th></tr></thead><tbody>${m.customers.ranked.slice(0, 6).map((L) => `<tr class="click" data-relay="${esc(L.key)}"><td>${where(L)}</td><td class="r num">${L.cust.customers.toLocaleString()}</td><td class="r num">${L.cust.ci.toLocaleString()}</td><td class="r num">${L.cust.cmi.toLocaleString()}</td></tr>`).join("")}</tbody></table>
      <p class="hint" style="margin:6px 0 0">Customer interruptions = customers × trips${state.cfg.sustained === "all" ? "" : " (a lockout is sustained, other trips momentary)"}.${m.customers.missing ? ` ${plural(m.customers.missing, "location")} have no customer count (Files & settings).` : ""}</p></div>` : ""}
    ${m.reviews.reviewed ? `<div class="card"><div class="card-head"><h2>PRC-004 reviews</h2><span class="hint">from the Trip Analyzer</span></div>
      <div class="stats" style="margin:0 0 10px"><div class="stat"><div class="v">${m.reviews.reviewed}/${m.reviews.trips}</div><div class="l">trips reviewed</div></div>
        <div class="stat"><div class="v${m.reviews.misop ? " trip" : ""}">${m.reviews.misop}</div><div class="l">misoperations</div></div>
        <div class="stat"><div class="v${m.reviews.overdue ? " trip" : ""}">${m.reviews.overdue}</div><div class="l">overdue (over ${state.cfg.reviewDays} days)</div></div></div>
      ${m.reviews.misopList.length ? `<table class="t"><tbody>${m.reviews.misopList.slice(0, 5).map((r) => `<tr class="click" data-id="${esc(r.id)}"><td class="num">${esc(r.date)}</td><td>${esc(r.relay)}</td><td><span class="trip">Misoperation</span> <span class="hint">${esc(r.review.category || "")}</span></td></tr>`).join("")}</tbody></table>` : ""}
      ${m.reviews.overdue ? `<p style="margin:8px 0 0"><button class="link" data-go="events" data-show="overdue">${plural(m.reviews.overdue, "trip")} past the review deadline →</button></p>` : ""}</div>` : ""}
  </div>` : ""}
  <div class="grid2 even">
    <div class="card"><div class="card-head"><h2>Getting worse</h2></div>${changeList(worse, "No location's trips are increasing.")}</div>
    <div class="card"><div class="card-head"><h2>Getting better</h2></div>${changeList(better, "No location's trips are decreasing.")}</div>
  </div>
  ${m.hotspots.length ? `<div class="card section"><div class="card-head"><h2>Fault hot spots</h2><span class="hint">Faults at about the same distance from the relay: often one tree, insulator or animal path</span></div>
    <div class="tablewrap"><table class="t"><thead><tr><th>Location</th><th>Distance</th><th class="r">Faults</th><th>Phases</th><th>First</th><th>Latest</th></tr></thead><tbody>
    ${m.hotspots.map((h) => `<tr class="click" data-relay="${esc(h.relayKey)}"><td>${where(h)}</td><td class="num">${h.from.toFixed(2)} – ${h.to.toFixed(2)}${h.pct !== null ? ` <span class="muted">(~${h.pct}% of line)</span>` : ""}</td><td class="r num">${h.n}</td><td>${Object.entries(h.phases).map(([p, n]) => `${esc(p)} ${n}`).join(", ")}</td><td class="num">${fmtDate(h.first)}</td><td class="num">${fmtDate(h.last)}</td></tr>`).join("")}
    </tbody></table></div></div>` : ""}`;
  el.querySelectorAll("[data-go]").forEach((b) => { b.onclick = () => go(b.dataset.go, b.dataset.show ? { ev: { show: b.dataset.show } } : undefined); });
  el.querySelectorAll("[data-relay]").forEach((b) => { b.onclick = () => go("locations", { relay: b.dataset.relay }); b.onkeydown = (e) => { if (e.key === "Enter") b.click(); }; });
  el.querySelectorAll("[data-recur]").forEach((b) => { const x = m.recurring[+b.dataset.recur]; b.onclick = () => openDrawer(x.allIds[x.allIds.length - 1], x.allIds); b.onkeydown = (e) => { if (e.key === "Enter") b.click(); }; });
  el.querySelectorAll(".chart .bar[data-month]").forEach((b) => { b.onclick = () => go("events", { ev: { month: b.dataset.month } }); });
  el.querySelectorAll("[data-chg]").forEach((b) => { const c = ch[+b.dataset.chg]; b.onclick = () => { if (c.ids.length) openDrawer(c.ids[c.ids.length - 1], c.ids); else go("locations", { relay: c.relayKey }); }; b.onkeydown = (e) => { if (e.key === "Enter") b.click(); }; });
  if ($("chgSeen")) $("chgSeen").onclick = () => { state.baseline = { ids: state.records.map((r) => r.id), at: new Date().toISOString() }; kvSet("baseline", state.baseline); state.chgAll = false; rebuild(false); };
  if ($("chgAll")) $("chgAll").onclick = () => { state.chgAll = true; renderOverview(); };
  el.querySelectorAll("tr[data-id]").forEach((b) => { b.onclick = () => openDrawer(b.dataset.id, m.reviews.misopList.map((r) => r.id)); });
  if ($("ovWx")) $("ovWx").onclick = () => { go("data"); setTimeout(() => { const el2 = $("wxCard"); if (el2) el2.scrollIntoView({ behavior: "smooth" }); }, 50); };
}
function changeList(list, none) {
  if (!list.length) return `<p class="hint">${none}</p>`;
  return `<table class="t"><tbody>${list.map((L) => `<tr class="click" data-relay="${esc(L.key)}"><td>${where(L)}</td><td>${trendHtml(L.trend)}</td><td class="muted">${esc(H.trendWords(L.trend))}</td></tr>`).join("")}</tbody></table>`;
}

// ---------------------------------------------------------------- locations
function renderLocations() {
  const m = state.model, el = $("page-locations");
  if (!state.relay) state.relay = m.relays[0] ? m.relays[0].key : "";
  const L = m.relays.find((x) => x.key === state.relay);
  const maxScore = Math.max(1, ...m.relays.map((x) => x.score));
  const item = (x) => `<button class="item${x.key === state.relay ? " on" : ""}" data-relay="${esc(x.key)}">
      <span class="rank${x.rank === 1 ? " r1" : ""}">${x.rank}</span>
      <span style="min-width:0"><span class="nm">${esc(x.relay)}</span><span class="sm">${state.locGroup === "rank" ? esc(x.station) + " · " : ""}${plural(x.tripOccasions, "trip")}${x.recurring.length ? ` · <span class="trip">${x.recurring.length} recurring</span>` : ""}</span>
        <span class="scorebar"><i style="width:${(100 * x.score / maxScore).toFixed(0)}%"></i></span></span>
      ${trendHtml(x.trend, true)}</button>`;
  let list;
  if (state.locGroup === "impact") list = m.relays.slice().sort((a, b) => (b.cust ? b.cust.ci + b.cust.cmi / 1000 : -1) - (a.cust ? a.cust.ci + a.cust.cmi / 1000 : -1)).map(item).join("");
  else if (state.locGroup === "station") list = m.stations.map((S) => `<div class="st"><span>${esc(S.name)}</span><span>${trendHtml(S.trend, true)} ${S.score.toFixed(0)}</span></div>` + S.relays.map(item).join("")).join("");
  else list = m.relays.map(item).join("");
  el.innerHTML = `<div class="loc-layout">
    <div class="card loc-list">
      <div style="display:flex;gap:6px;padding:4px 4px 8px"><select id="hx-locGroup" aria-label="Arrange"><option value="rank">Ranked</option><option value="station">By station</option><option value="impact">By customer impact</option></select></div>
      ${list}
    </div>
    <div>${L ? locationDetail(L) : '<p class="hint">Pick a location.</p>'}</div>
  </div>`;
  $("locGroup").value = state.locGroup;
  $("locGroup").onchange = (e) => { state.locGroup = e.target.value; prefs.set("locGroup", state.locGroup); renderLocations(); };
  el.querySelectorAll(".loc-list [data-relay]").forEach((b) => { b.onclick = () => { state.relay = b.dataset.relay; renderLocations(); } });
  if (!L) return;
  el.querySelectorAll("[data-id]").forEach((b) => { b.onclick = () => openDrawer(b.dataset.id, L.records.map((r) => r.id).reverse()); });
  el.querySelectorAll(".chart .bar[data-month]").forEach((b) => { b.onclick = () => go("events", { ev: { relay: L.key, month: b.dataset.month } }); });
  el.querySelectorAll("[data-recur-ids]").forEach((b) => { const ids = b.dataset.recurIds.split("\n"); b.onclick = () => openDrawer(ids[ids.length - 1], ids); });
  $("chgStation").onclick = () => openStation(L);
  $("custIn").onchange = async (e) => {
    const v = parseInt(e.target.value, 10);
    if (Number.isFinite(v) && v > 0) state.customers[L.relay] = v; else delete state.customers[L.relay];
    await kvSet("customers", state.customers); rebuild(false);
  };
  $("wlAdd").onclick = async () => {
    const d = $("wlDate").value, t = $("wlText").value.trim();
    if (!d || !t) { toast("Enter a date and what was done."); return; }
    (state.worklog[L.relay] = state.worklog[L.relay] || []).push({ date: d, text: t });
    await kvSet("worklog", state.worklog); rebuild(false);
  };
  el.querySelectorAll("[data-wl-del]").forEach((b) => { b.onclick = async () => {
    const list = state.worklog[L.relay] || []; const i = list.findIndex((w) => w.date + "|" + w.text === b.dataset.wlDel);
    if (i >= 0) list.splice(i, 1); if (!list.length) delete state.worklog[L.relay];
    await kvSet("worklog", state.worklog); rebuild(false);
  }; });
  $("locReport").onclick = () => openExport({ relay: L.key });
}
function locationDetail(L) {
  const m = state.model;
  const series = chartSeries(m, L.records);
  const markers = L.worklog.map((w) => ({ month: w.date.slice(0, 7), date: w.date, text: w.text }));
  const issueRows = Object.entries(L.counts).filter(([key]) => H.ISSUE[key].group !== "data").sort((a, b) => b[1] - a[1]).map(([key, n]) => {
    const t = L.issueTrends[key], rec = L.recurring.find((x) => x.key === key);
    const ids = L.records.filter((r) => r.issues.some((x) => x.key === key)).map((r) => r.id);
    return `<tr class="click" data-recur-ids="${esc(ids.join("\n"))}"><td>${esc(IL(key))}${rec ? ' <span class="chip rec">recurring</span>' : ""}</td><td class="r num">${n}</td><td>${trendHtml(t)}</td><td class="muted">${esc(H.trendWords(t))}</td></tr>`;
  }).join("");
  const stFrom = { record: "from the event files", settings: "from the settings", folder: "from the folder name", override: "set by you", none: "not in the files" }[L.stationFrom] || "";
  return `
  <div class="card">
    <div class="card-head">
      <div><h2 style="font-size:20px">${esc(L.relay)}</h2>
        <div class="hint">${esc(L.station)} <span title="Where the station name came from">(${stFrom})</span> · <span class="nosnap"><button class="link" id="hx-chgStation">change</button></span>${L.ll ? ` · line length ${L.ll}` : ""}
          · <label for="hx-custIn">customers</label> <input type="number" id="hx-custIn" min="0" step="1" style="width:96px;min-height:26px;padding:1px 6px" value="${L.cust ? L.cust.customers : ""}" placeholder="how many?"${SNAP ? " disabled" : ""}></div></div>
      <div style="text-align:right"><div class="cap">Rank ${L.rank} of ${m.relays.length}</div><div style="font-size:22px;font-weight:600">${L.score}</div><div class="hint">score</div></div>
    </div>
    <div class="stats">
      <div class="stat"><div class="v">${L.tripOccasions}</div><div class="l">trips${L.trips > L.tripOccasions ? ` (${L.trips} with recloses)` : ""}</div></div>
      <div class="stat"><div class="v">${L.faults}</div><div class="l">fault reports</div></div>
      <div class="stat"><div class="v">${fmtDate(L.lastTrip)}</div><div class="l">last trip</div></div>
      <div class="stat"><div class="v">${trendHtml(L.trend)}</div><div class="l">${esc(H.trendWords(L.trend))}</div></div>
      <div class="stat"><div class="v">${L.recurring.length}</div><div class="l">recurring issues</div></div>
      <div class="stat"><div class="v">${L.review}</div><div class="l">with items to check</div></div>
      <div class="stat"><div class="v${L.rev.misop ? " trip" : ""}">${L.rev.misop}</div><div class="l">misoperations${L.rev.overdue ? ` · <span class="trip">${L.rev.overdue} reviews overdue</span>` : L.rev.reviewed ? ` · ${L.rev.reviewed} reviewed` : ""}</div></div>
      <div class="stat"><div class="v">${L.cust ? L.cust.ci.toLocaleString() : "–"}</div><div class="l">${L.cust ? `customer interruptions, 12 months (+${L.cust.cmi.toLocaleString()} momentary)` : "customer interruptions: set the customers"}</div></div>
    </div>
    <details><summary class="hint" style="cursor:pointer">Why this score</summary><ul class="why">${L.why.map((w) => `<li><span>${esc(w.text)}</span><b>+${w.points}</b></li>`).join("")}<li><span><b>Score</b></span><b>${L.score}</b></li></ul></details>
    <div style="margin-top:8px"><button class="small" id="hx-locReport">Export this location's report</button></div>
  </div>
  ${L.recurring.length ? `<div class="card section"><div class="card-head"><h2>Recurring here</h2></div>${L.recurring.map((x) => `
    <div class="recur" data-recur-ids="${esc(x.allIds.join("\n"))}" tabindex="0">
      <div class="top"><span class="what">${esc(IL(x.key))}${x.clearing ? ` <span class="trip">${x.clearing.first} → ${x.clearing.last} cycles</span>` : ""}</span><span>${trendHtml(x.trend)}</span></div>
      <div class="where">${x.inWindow} times in ${x.windowDays} days (${fmtDate(x.from)} to ${fmtDate(x.to)}) · ${x.total} in all · last ${fmtDate(x.last)}${Object.keys(x.phases).length ? " · " + Object.entries(x.phases).map(([p, n]) => `${esc(p)} ${n}`).join(", ") : ""}</div>
      ${x.weatherNote ? `<div class="advice"><b>Weather:</b> ${esc(x.weatherNote)}</div>` : ""}
      <div class="advice">${esc(x.advice)}</div>
    </div>`).join("")}</div>` : ""}
  <div class="card section">
    <div class="card-head"><h2>Trips per month</h2>${legendHtml(series)}</div>
    ${barChart(m.months, series, { markers, label: `Trips per month at ${L.relay}`, height: 190, clickHint: "Click to list them" })}
  </div>
  <div class="card section">
    <div class="card-head"><h2>Where the faults were</h2><span class="hint">Distance from the relay, in its line-length units${L.hotspots.length ? ` · <b class="warn">${plural(L.hotspots.length, "hot spot")}</b>` : ""}</span></div>
    ${lineStrip(L)}
    ${L.hotspots.map((h) => `<p style="margin:6px 0 0"><b class="warn">Hot spot:</b> ${h.n} faults between ${h.from.toFixed(2)} and ${h.to.toFixed(2)}${h.pct !== null ? ` (~${h.pct}% of the line)` : ""}, ${fmtDate(h.first)} to ${fmtDate(h.last)}. Patrol this section.</p>`).join("")}
  </div>
  ${L.breaker && L.breaker.n ? `<div class="card section">
    <div class="card-head"><h2>Breaker</h2><span class="bk-verdict${L.breaker.slowing || L.breaker.latest > L.breaker.limit ? " bad" : ""}">${esc(L.breaker.verdict)}</span></div>
    ${breakerChart(L.breaker)}
    <p class="hint" style="margin:6px 0 0">${plural(L.breaker.n, "opening")} timed${L.breaker.n >= 3 ? ` · trend ${L.breaker.slope >= 0 ? "+" : ""}${L.breaker.slope.toFixed(2)} cycles a year` : ""} · ${L.breaker.ops} trip operations · ${L.breaker.kA} kA interrupted in all (Σ kA² ${L.breaker.kA2}, for contact wear)${L.breaker.slowing ? " · Test the breaker timing and the trip circuit before it gets worse." : ""}</p>
  </div>` : ""}
  <div class="grid2 even">
    <div class="card"><div class="card-head"><h2>Issues</h2><span class="hint">click to see the events</span></div>
      <table class="t"><thead><tr><th>Issue</th><th class="r">Times</th><th colspan="2">Trend</th></tr></thead><tbody>${issueRows || '<tr><td colspan="4" class="hint">None</td></tr>'}</tbody></table>
      <p class="hint">Faulted phases: ${["A", "B", "C"].map((p) => `${p} ${L.phases[p]}`).join(" · ")} · ground ${L.phases.G}</p>
      <p class="hint">Weather: ${L.wx.known ? `${L.wx.storm} of ${L.wx.known} trips in storms${Object.keys(L.wx.kinds).length ? ` (${Object.entries(L.wx.kinds).map(([k, n]) => `${esc(H.WX_LABEL[k] || k)} ${n}`).join(", ")})` : ""}, ${L.wx.calm} in calm weather` : "not looked up (Files & settings)"}</p></div>
    <div class="card"><div class="card-head"><h2>Work log</h2><span class="hint">Shown on the chart, so you can see if it helped</span></div>
      <ul class="wl-list">${L.worklog.map((w) => `<li><span>${esc(w.date)}</span><span class="grow">${esc(w.text)}</span><button class="small link danger nosnap" data-wl-del="${esc(w.date + "|" + w.text)}" aria-label="Delete">✕</button></li>`).join("") || '<li class="hint">Nothing yet: add tree trimming, breaker maintenance, settings changes…</li>'}</ul>
      <div class="wl nosnap"><input type="date" id="hx-wlDate" aria-label="Date"><input type="text" id="hx-wlText" placeholder="What was done (e.g. Breaker timing test, contacts replaced)"><button id="hx-wlAdd">Add</button></div></div>
  </div>
  <div class="card section">
    <div class="card-head"><h2>Events</h2><span class="hint">${plural(L.records.length, "event")}, newest first · click for the evidence</span></div>
    <div class="tablewrap"><table class="t"><thead><tr><th>Date</th><th>Event</th><th>What happened</th><th>Issues</th></tr></thead><tbody>
    ${[...L.records].reverse().map((r) => evRow(r, false)).join("")}</tbody></table></div>
  </div>`;
}
function evType(r) {
  const t = state.plain ? PL.faultShort(r.core, r.tripped) : r.et || (r.tripped ? "TRIP" : "–");
  return r.tripped ? `<span class="trip">${esc(t)}</span>` : esc(t);
}
function evRow(r, withWhere) {
  return `<tr class="click" data-id="${esc(r.id)}"><td class="num" style="white-space:nowrap">${esc(H.fmtWhen(r))}</td>${withWhere ? `<td>${esc(r.relay)}<div class="hint">${esc(r.stationName)}</div></td>` : ""}<td style="white-space:nowrap" data-tip="${esc([r.et, r.targets].filter(Boolean).join(" · "))}">${evType(r)}</td><td>${esc(state.plain ? H.whatHappened(r, true).replace(/^(Tripped|No trip): /, "") : r.short.replace(/^(TRIP|No trip) - /, "").replace(/\s+\[\d+ to check\]$/, ""))}${r.checks.length ? ` <span class="warn" data-tip="${esc(r.checks.join("\n"))}">· ${plural(r.checks.length, "item")} to check</span>` : ""}</td><td>${issueChips(r)}${wxTag(r)}</td></tr>`;
}
function openStation(L) {
  $("stHint").textContent = `${L.relay} is at ${L.station}. Set it if the files don't say, or to group relays differently. Applies to every event from this relay.`;
  $("stName").value = L.station === "Unassigned" ? "" : L.station;
  $("stList").innerHTML = state.model.stations.map((S) => `<option value="${esc(S.name)}">`).join("");
  $("stSave").onclick = async () => { const v = $("stName").value.trim(); if (v) state.overrides[L.relay] = v; else delete state.overrides[L.relay]; await kvSet("overrides", state.overrides); $("stDlg").close(); rebuild(false); };
  $("stAuto").onclick = async () => { delete state.overrides[L.relay]; await kvSet("overrides", state.overrides); $("stDlg").close(); rebuild(false); };
  $("stDlg").showModal();
}

// ---------------------------------------------------------------- issues
function renderIssues() {
  const m = state.model, el = $("page-issues");
  const keys = H.ISSUES.filter((I) => I.group !== "data" && m.relays.some((L) => L.counts[I.key])).map((I) => I.key);
  const max = Math.max(1, ...m.relays.flatMap((L) => keys.map((k) => L.counts[k] || 0)));
  const shade = (n) => (n ? `background: rgba(var(--heat), ${(0.1 + 0.6 * n / max).toFixed(2)})` : "");
  el.innerHTML = `
  <div class="card">
    <div class="card-head"><h2>Issues at each location</h2><span class="hint">Times each issue happened (a reclose sequence counts once). <u>Underlined</u> = recurring. Click a cell to see the events.</span></div>
    <div class="tablewrap"><table class="t heat"><thead><tr><th>Location</th>${keys.map((k) => `<th class="v" data-tip="${esc(IL(k) + "\n" + H.ISSUE[k].advice)}">${esc(IS(k))}</th>`).join("")}</tr></thead><tbody>
    ${m.relays.map((L) => `<tr><td style="white-space:nowrap"><button class="link" data-relay="${esc(L.key)}">${esc(L.relay)}</button><div class="hint">${esc(L.station)}</div></td>${keys.map((k) => { const n = L.counts[k] || 0; const rec = L.recurring.some((x) => x.key === k); return `<td class="h${rec ? " rec" : ""}" style="${shade(n)}" data-cell="${esc(L.key)}|${k}" ${n ? `data-tip="${esc(`${L.relay}: ${IL(k)} ${n}×${rec ? " (recurring)" : ""}\n${H.trendWords(L.issueTrends[k])}`)}"` : ""}>${n || ""}</td>`; }).join("")}</tr>`).join("")}
    <tr><td><b>All</b></td>${keys.map((k) => `<td class="h num" style="font-weight:600" data-cell="|${k}">${m.relays.reduce((a, L) => a + (L.counts[k] || 0), 0)}</td>`).join("")}</tr>
    </tbody></table></div>
  </div>
  <div class="card section">
    <div class="card-head"><h2>Recurring issues</h2><span class="hint">Faults ${state.cfg.recurMin}+ times in ${state.cfg.recurDays} days; anything else ${state.cfg.recurMin}+ times in ${state.cfg.recurDaysOther} days, at one location. Change this in Files &amp; settings.</span></div>
    ${m.recurring.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Location</th><th>Issue</th><th>How often</th><th>Latest</th><th>Trend</th><th>What to do</th></tr></thead><tbody>
    ${m.recurring.map((x, i) => `<tr class="click" data-recur="${i}"><td>${where(x)}</td><td><b>${esc(IL(x.key))}</b>${x.clearing ? `<div class="trip">${x.clearing.first} → ${x.clearing.last} cycles</div>` : ""}</td><td class="num">${x.inWindow} in ${x.windowDays} d<div class="hint">${x.total} in all</div></td><td class="num">${fmtDate(x.last)}</td><td>${trendHtml(x.trend)}</td><td class="hint" style="max-width:340px">${esc(x.advice)}</td></tr>`).join("")}
    </tbody></table></div>` : '<p class="hint">None found.</p>'}
  </div>
  <div class="card section">
    <div class="card-head"><h2>Issue trends, all locations</h2></div>
    <div class="tablewrap"><table class="t"><thead><tr><th>Issue</th><th class="r">Times</th><th class="r">Locations</th><th>Trend</th><th></th><th>Last 12 months</th></tr></thead><tbody>
    ${m.issues.filter((x) => x.group !== "data").map((x) => `<tr class="click" data-issue="${x.key}"><td>${esc(IL(x.key))}</td><td class="r num">${x.n}</td><td class="r num">${x.relays}</td><td>${trendHtml(x.trend)}</td><td class="muted">${esc(H.trendWords(x.trend))}</td><td>${sparkSvg(x.monthly.slice(-12), 110, 22)}</td></tr>`).join("")}
    </tbody></table></div>
    ${m.issues.some((x) => x.group === "data") ? `<p class="hint">Data gaps: ${m.issues.filter((x) => x.group === "data").map((x) => `${esc(IL(x.key).toLowerCase())} (${x.n})`).join(", ")}. Adding the .CEV and settings for those relays makes the checks more reliable.</p>` : ""}
  </div>`;
  el.querySelectorAll("[data-relay]").forEach((b) => { b.onclick = () => go("locations", { relay: b.dataset.relay }); });
  el.querySelectorAll("[data-cell]").forEach((c) => { c.onclick = () => { const [relay, issue] = c.dataset.cell.split("|"); if (relay && !state.model.relays.find((L) => L.key === relay).counts[issue]) return; go("events", { ev: { relay, issue } }); }; });
  el.querySelectorAll("[data-recur]").forEach((b) => { const x = m.recurring[+b.dataset.recur]; b.onclick = () => openDrawer(x.allIds[x.allIds.length - 1], x.allIds); });
  el.querySelectorAll("[data-issue]").forEach((b) => { b.onclick = () => go("events", { ev: { issue: b.dataset.issue } }); });
}

// ---------------------------------------------------------------- events
function filteredEvents() {
  const m = state.model, f = state.evFilter, q = f.q.trim().toUpperCase();
  let list = m.records.filter((r) =>
    (!f.station || r.stationName === f.station) && (!f.relay || upper(r.relay) === f.relay) &&
    (!f.issue || r.issues.some((x) => x.key === f.issue)) && (!f.month || (r.ms !== null && H.monthKey(r.ms) === f.month)) &&
    (f.show === "all" || (f.show === "trips" && r.tripped) || (f.show === "review" && r.checks.length) || (f.show === "faults" && r.fault) ||
     (f.show === "recurring" && m.recurring.some((x) => x.allIds.includes(r.id))) || (f.show === "hot" && m.hotspots.some((h) => h.ids.includes(r.id))) ||
     (f.show === "storm" && r.tripped && r.storm === true) || (f.show === "calm" && r.tripped && r.storm === false) || (f.show === "breaker" && r.clearCyc !== null) ||
     (f.show === "misop" && r.reviewStatus === "misop") || (f.show === "overdue" && r.reviewStatus === "overdue") || (f.show === "unreviewed" && (r.reviewStatus === "overdue" || r.reviewStatus === "open"))) &&
    (!q || [r.relay, r.stationName, r.et, r.targets, r.short, r.date, r.loc, noteOf(r.id), ...r.checks, ...r.cause, ...r.sources.map((s) => s.path), ...r.issues.map((x) => IL(x.key)), PL ? PL.sentence(r, { withChecks: false }) : ""].join(" ").toUpperCase().includes(q)));
  if (f.sort === "newest") list = list.slice().reverse();
  else if (f.sort === "relay") list = list.slice().sort((a, b) => (a.stationName + a.relay < b.stationName + b.relay ? -1 : a.stationName + a.relay > b.stationName + b.relay ? 1 : (a.ms || 0) - (b.ms || 0)));
  return list;
}
function renderEvents() {
  const m = state.model, el = $("page-events"), f = state.evFilter;
  const opt = (v, t, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(t)}</option>`;
  const issueKeys = H.ISSUES.filter((I) => m.issues.some((x) => x.key === I.key));
  if (!el.querySelector("#hx-evList")) {
    el.innerHTML = `<div class="filters">
      <input type="search" id="hx-evQ" placeholder="Search events, notes, files…" aria-label="Search">
      <select id="hx-evStation" aria-label="Station"></select><select id="hx-evRelay" aria-label="Relay"></select><select id="hx-evIssue" aria-label="Issue"></select>
      <select id="hx-evShow" aria-label="Show"></select><select id="hx-evMonth" aria-label="Month"></select>
      <select id="hx-evSort" aria-label="Sort">${opt("newest", "Newest first")}${opt("time", "Oldest first")}${opt("relay", "By location")}</select>
      <span class="grow"></span><span class="hint" id="hx-evCount"></span><button class="small" id="hx-evClear">Clear filters</button></div>
      <div class="card" style="padding:4px 8px"><div class="tablewrap"><table class="t"><thead><tr><th>Date</th><th>Location</th><th>Event</th><th>What happened</th><th>Issues</th></tr></thead><tbody id="hx-evList"></tbody></table></div></div>`;
    for (const [id, key] of [["evStation", "station"], ["evRelay", "relay"], ["evIssue", "issue"], ["evShow", "show"], ["evMonth", "month"], ["evSort", "sort"]])
      $(id).onchange = (e) => { f[key] = e.target.value; if (key === "station") f.relay = ""; renderEvents(); };
    $("evQ").oninput = (e) => { f.q = e.target.value; clearTimeout(renderEvents.t); renderEvents.t = setTimeout(renderEvents, 120); };
    $("evClear").onclick = () => go("events", { ev: {} });
  }
  $("evQ").value = f.q;
  $("evStation").innerHTML = opt("", "All stations", f.station) + m.stations.map((S) => opt(S.name, S.name, f.station)).join("");
  $("evRelay").innerHTML = opt("", "All relays", f.relay) + m.relays.filter((L) => !f.station || L.station === f.station).map((L) => opt(L.key, L.relay, f.relay)).join("");
  $("evIssue").innerHTML = opt("", "Any issue", f.issue) + issueKeys.map((I) => opt(I.key, IL(I.key), f.issue)).join("");
  $("evShow").innerHTML = [["all", "All events"], ["trips", "Trips"], ["faults", "Faults"], ["review", "Needs review"], ["recurring", "Part of a recurring issue"], ["hot", "In a hot spot"], ["storm", "Trips in storms"], ["calm", "Trips in calm weather"], ["breaker", "Breaker timed"], ["misop", "Misoperations"], ["overdue", "Reviews overdue"], ["unreviewed", "Trips not reviewed"]].map(([v, t]) => opt(v, t, f.show)).join("");
  $("evMonth").innerHTML = opt("", "Any month", f.month) + [...m.months].reverse().map((k) => opt(k, monthLabel(k), f.month)).join("");
  $("evSort").value = f.sort;
  const list = filteredEvents();
  $("evCount").textContent = `${list.length} of ${m.records.length}`;
  const shown = list.slice(0, 600);
  $("evList").innerHTML = shown.map((r) => evRow(r, true)).join("") + (list.length > shown.length ? `<tr><td colspan="5" class="hint">${list.length - shown.length} more: narrow the filters to see them.</td></tr>` : "") +
    (list.length ? "" : '<tr><td colspan="5" class="hint">No events match.</td></tr>');
  $("evList").querySelectorAll("[data-id]").forEach((tr) => { tr.onclick = () => openDrawer(tr.dataset.id, list.map((r) => r.id)); });
}

// ---------------------------------------------------------------- files & settings
function renderData() {
  const el = $("page-data"), m = state.model;
  if (SNAP) {
    el.innerHTML = `<div class="card"><div class="card-head"><h2>About this snapshot</h2></div>
      <p style="margin:0">A read-only copy of <b>${esc(SNAP.name || "a history")}</b>${SNAP.scope ? ` (${esc(SNAP.scope)})` : ""}, made ${esc((SNAP.made || "").slice(0, 16).replace("T", " "))}: ${plural(m.records.length, "event")} at ${plural(m.relays.length, "location")}.
      Everything here can be explored and exported, but nothing is saved and the original relay files aren't included.</p>
      <p class="hint">To keep your own history, use the Trip Analyzer's History tab and load your relay files there.</p></div>`;
    return;
  }
  const size = state.files.reduce((a, f) => a + f.size, 0);
  const batches = state.batches.slice().sort((a, b) => (a.added < b.added ? 1 : -1));
  const used = new Map();
  for (const r of m.records) for (const s of r.sources) used.set(s.hash, (used.get(s.hash) || 0) + 1);
  const cfg = state.cfg;
  const num = (id, key, label, step, hint) => `<label for="hx-${id}">${label}</label><span><input type="number" id="hx-${id}" data-key="${key}" value="${cfg[key]}" min="0" step="${step || 1}"> <span class="hint">${hint || ""}</span></span>`;
  el.innerHTML = histCardHtml() + `
  <div class="grid2">
    <div class="card">
      <div class="card-head"><h2>What's been added</h2><span class="hint">${plural(state.files.length, "file")}, ${(size / 1048576).toFixed(1)} MB, kept in this browser on this computer</span></div>
      <table class="t"><thead><tr><th>Added</th><th>What</th><th class="r">Files</th><th class="r">New events</th><th></th></tr></thead><tbody>
      ${batches.map((b) => `<tr><td class="num">${esc(b.added.slice(0, 16).replace("T", " "))}</td><td>${esc(b.label || "Files")}${b.nDup ? ` <span class="hint">(${b.nDup} already there)</span>` : ""}<details><summary class="hint" style="cursor:pointer">list</summary><div class="hint mono" style="font-size:11.5px">${state.files.filter((f) => f.batch === b.id).map((f) => `${esc(f.path)}${used.has(f.hash) ? "" : core.SETTINGS_EXTS.includes(core.extOf(f.name)) || core.SETTINGS_TEXT_EXTS.includes(core.extOf(f.name)) ? " · settings" : " · <span class='warn'>no events</span>"}`).join("<br>")}</div></details></td><td class="r num">${b.nFiles}</td><td class="r num">${b.nEvents ?? ""}</td><td><button class="small link danger" data-del-batch="${esc(b.id)}">Remove</button></td></tr>`).join("") || '<tr><td colspan="5" class="hint">Nothing yet.</td></tr>'}
      </tbody></table>
      ${state.errors.length ? `<h3 style="margin-top:14px" class="warn">Couldn't read</h3><ul class="hint">${state.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
      <div class="row" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
        <button id="hx-backup">Back up this history (.json)</button>
        <button id="hx-restore">Restore or merge a backup into it</button>
        <button id="hx-samples2">Add the samples</button>
        <button id="hx-clearAll" class="danger">Clear everything</button>
      </div>
      <p class="hint">“${esc(currentName())}” lives in this browser's storage. Back it up to move it to another computer or share it; restoring merges it with what's here. Clearing the browser's site data deletes it.</p>
      <input type="file" id="hx-pickBackup" accept=".json,application/json" hidden>
    </div>
    <div class="card">
      <div class="card-head"><h2>Settings</h2><button class="small" id="hx-cfgReset">Defaults</button></div>
      <div class="settings-grid">
        ${num("cTrend", "trendDays", "Short-term trend", 1, "days: the last N days vs the N before")}
        ${num("cYear", "yearDays", "Long-term trend", 1, "days (365 = year on year)")}
        ${num("cMin", "recurMin", "Recurring after", 1, "times at one location")}
        ${num("cRec", "recurDays", "…for faults, within", 1, "days")}
        ${num("cRecO", "recurDaysOther", "…for other issues, within", 1, "days")}
        ${num("cSeq", "sequenceMinutes", "One occasion", 1, "minutes: reports closer than this are one sequence")}
        ${num("cHotMin", "hotMin", "Hot spot after", 1, "faults at the same distance")}
        ${num("cHot", "hotTol", "Same distance means within", 0.05, "line-length units")}
        ${num("cHotP", "hotTolPct", "…or within", 0.5, "% of the line length")}
        ${num("cHalf", "halfLifeDays", "Score half-life", 1, "days: older events count half as much")}
      </div>
      <h3 style="margin-top:16px">Breakers and weather</h3>
      <div class="settings-grid">
        ${num("cSlow", "slowCycles", "Breaker is slow over", 0.5, "cycles, trip to open")}
        ${num("cSlowing", "slowingPerYear", "Getting slower at", 0.1, "cycles a year or more")}
        ${num("cStorm", "stormWeight", "A trip in a storm counts", 0.1, "× in the score (1 = the same as calm)")}
      </div>
      <h3 style="margin-top:16px">Trip Analyzer</h3>
      <p class="hint" style="margin:4px 0">Where “Open in Trip Analyzer” goes. Leave blank for ${esc(defaultAnalyzerUrl())}.</p>
      <input type="text" id="hx-cAnalyzer" style="width:100%" placeholder="${esc(defaultAnalyzerUrl())}" value="${esc(state.cfg.analyzerUrl || "")}">
      <h3 style="margin-top:16px">Station overrides</h3>
      ${Object.keys(state.overrides).length ? `<ul class="hint">${Object.entries(state.overrides).map(([k, v]) => `<li>${esc(k)} → ${esc(v)}</li>`).join("")}</ul>` : '<p class="hint">None. Set one from a location\'s page (“change” next to its station).</p>'}
      <h3 style="margin-top:16px">How it works</h3>
      <ul class="hint" style="padding-left:18px">
        <li>Every file is read with the same analysis as the Trip Analyzer. One event read from several files (.CEV, .SUM, .HIS) counts once.</li>
        <li>A location is a relay; its station comes from the files (TID / settings), the folder name, or what you set.</li>
        <li>Reports on one relay within ${cfg.sequenceMinutes} minutes (a reclose sequence) count as one occasion for trends, recurrence and hot spots.</li>
        <li>Trend: a recent rise (short-term) is reported first; otherwise the long-term direction. It needs a change of at least 2 and 50%.</li>
        <li>Score: trips and other events (older ones count less) + the severity of their issues + 2 per recurring issue + 1.5 per hot spot, ×1.3 when increasing or ×0.85 when decreasing.</li>
      </ul>
    </div>
  </div>`;
  $("histCard").insertAdjacentHTML("afterend", wxCardHtml() + custCardHtml());
  wireCustCard();
  wireWxCard();
  $("cAnalyzer").onchange = (e) => { state.cfg.analyzerUrl = e.target.value.trim(); kvSet("cfg", state.cfg); };
  el.querySelectorAll("input[data-key]").forEach((inp) => { inp.onchange = () => { const v = parseFloat(inp.value); if (Number.isFinite(v) && v >= 0) { state.cfg[inp.dataset.key] = v; kvSet("cfg", state.cfg); rebuild(false); } }; });
  $("cfgReset").onclick = () => { for (const k of ["trendDays", "yearDays", "recurMin", "recurDays", "recurDaysOther", "sequenceMinutes", "hotMin", "hotTol", "hotTolPct", "halfLifeDays", "slowCycles", "slowingPerYear", "stormWeight"]) state.cfg[k] = H.DEFAULTS[k]; kvSet("cfg", state.cfg); rebuild(false); };
  wireHistCard();
  el.querySelectorAll("[data-del-batch]").forEach((b) => { b.onclick = () => removeBatch(b.dataset.delBatch); });
  $("backup").onclick = backup;
  $("restore").onclick = () => $("pickBackup").click();
  $("pickBackup").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) restore(f); };
  $("samples2").onclick = loadSamples;
  $("clearAll").onclick = async () => {
    if (!confirm(`Delete every file, event, note and setting in "${currentName()}"? Back it up first if you might need it.`)) return;
    await tx("files", "readwrite", (s) => s.clear()); await tx("batches", "readwrite", (s) => s.clear()); await tx("kv", "readwrite", (s) => s.clear());
    stopWatch(false);
    Object.assign(state, { files: [], batches: [], records: [], notes: {}, worklog: {}, overrides: {}, cfg: Object.assign({}, H.DEFAULTS), relay: "", weather: {}, locations: {}, customers: {}, baseline: null, changes: [] });
    state.model = H.buildModel([], state.cfg); render(); toast("Cleared.");
  };
}
async function removeBatch(id) {
  const b = state.batches.find((x) => x.id === id);
  const files = state.files.filter((f) => f.batch === id);
  if (!confirm(`Remove ${plural(files.length, "file")} added ${b.added.slice(0, 10)}${b.label ? ` (${b.label})` : ""} and the events found only in them?`)) return;
  await tx("files", "readwrite", (s) => { for (const f of files) s.delete(f.hash); });
  await tx("batches", "readwrite", (s) => s.delete(id));
  state.files = state.files.filter((f) => f.batch !== id); state.batches = state.batches.filter((x) => x.id !== id);
  await rebuild(true); toast(`Removed ${plural(files.length, "file")}.`);
}
function b64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
function unb64(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
const KV_KEYS = ["cfg", "notes", "worklog", "overrides", "locations", "weather", "customers"];
/** Everything in one history (any, not just the open one), in backup form. */
async function readData(id) {
  const p = id === current ? db() : openDb(dbNameOf(id));
  const get = (st) => txOn(p, st, "readonly", (s) => s.getAll()).catch(() => []);
  const [files, batches] = await Promise.all([get("files"), get("batches")]);
  const kv = {};
  for (const k of KV_KEYS) kv[k] = await txOn(p, "kv", "readonly", (s) => s.get(k)).catch(() => undefined);
  if (id !== current) (await p).close();
  return Object.assign({ app: "sel-trip-history", version: VERSION, name: (histList().find((h) => h.id === id) || {}).name || "", exported: new Date().toISOString(), batches,
    files: files.map((f) => ({ hash: f.hash, name: f.name, path: f.path, site: f.site, size: f.size, batch: f.batch, added: f.added, b64: b64(f.bytes) })) },
    Object.fromEntries(KV_KEYS.map((k) => [k, kv[k] || {}])), { sharedNotes: shared.get("notes", {}), reviews: shared.get("reviews", {}) });
}
/** Merge backup data into a history: files already there (same contents) are skipped; notes, work log, locations and weather are added. */
async function mergeInto(id, data, label) {
  const p = id === current ? db() : openDb(dbNameOf(id));
  const have = new Set(await txOn(p, "files", "readonly", (s) => s.getAllKeys()).catch(() => []));
  const haveB = new Set(await txOn(p, "batches", "readonly", (s) => s.getAllKeys()).catch(() => []));
  const fresh = (data.files || []).filter((f) => !have.has(f.hash))
    .map((f) => ({ hash: f.hash, name: f.name, path: f.path, site: f.site || "", size: f.size, batch: f.batch, added: f.added, bytes: unb64(f.b64) }));
  const batches = (data.batches || []).filter((b) => !haveB.has(b.id) && fresh.some((f) => f.batch === b.id))
    .map((b) => Object.assign({}, b, { label: label ? `${label}: ${b.label || "Files"}` : b.label }));
  const kvGetP = (k) => txOn(p, "kv", "readonly", (s) => s.get(k)).catch(() => undefined);
  const kvSetP = (k, v) => txOn(p, "kv", "readwrite", (s) => s.put(v, k));
  const notes = Object.assign({}, data.notes || {}, (await kvGetP("notes")) || {});
  const worklog = (await kvGetP("worklog")) || {};
  for (const [k, v] of Object.entries(data.worklog || {})) { const cur = worklog[k] || []; for (const w of v) if (!cur.some((x) => x.date === w.date && x.text === w.text)) cur.push(w); worklog[k] = cur; }
  const overrides = Object.assign({}, data.overrides || {}, (await kvGetP("overrides")) || {});
  const locations = Object.assign({}, data.locations || {}, (await kvGetP("locations")) || {});
  const weather = Object.assign({}, data.weather || {}, (await kvGetP("weather")) || {});
  const customers = Object.assign({}, data.customers || {}, (await kvGetP("customers")) || {});
  // the Trip Analyzer's notes and reviews: add the ones this browser doesn't have
  if (data.sharedNotes) shared.set("notes", Object.assign({}, data.sharedNotes, shared.get("notes", {})));
  if (data.reviews) shared.set("reviews", Object.assign({}, data.reviews, shared.get("reviews", {})));
  const cfg = (await kvGetP("cfg")) || (data.cfg && Object.keys(data.cfg).length ? data.cfg : null);
  await txOn(p, "files", "readwrite", (s) => { for (const f of fresh) s.put(f); });
  await txOn(p, "batches", "readwrite", (s) => { for (const b of batches) s.put(b); });
  await kvSetP("notes", notes); await kvSetP("worklog", worklog); await kvSetP("overrides", overrides);
  await kvSetP("locations", locations); await kvSetP("weather", weather); await kvSetP("customers", customers);
  if (cfg) await kvSetP("cfg", cfg);
  if (id !== current) (await p).close();
  return { added: fresh.length, skipped: (data.files || []).length - fresh.length };
}
async function reloadCurrent() {
  closeDrawer();
  Object.assign(state, { files: [], batches: [], records: [], notes: {}, worklog: {}, overrides: {}, weather: {}, locations: {}, customers: {}, baseline: null, changes: [], relay: "", errors: [] });
  await load();
}
async function backup() {
  busy(true, "Packing…");
  let data;
  try { data = await readData(current); } finally { busy(false); }
  download(`${currentName()} backup ${new Date().toISOString().slice(0, 10)} (${data.files.length} files).json`.replace(/[\\/:*?"<>|]+/g, "-"),
    new Blob([JSON.stringify(data)], { type: "application/json" }));
}
/** A backup file -> {histories: [...]}, whether it holds one history or several. */
async function readBackupFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { return null; }
  if (data && data.app === "sel-trip-history-bundle" && Array.isArray(data.histories)) return data;
  if (data && data.app === "sel-trip-history" && Array.isArray(data.files)) return { app: "sel-trip-history-bundle", histories: [data] };
  return null;
}
/** Restore a backup (one history, or a file with several) into the open history. */
async function restore(file) {
  const bundle = await readBackupFile(file);
  if (!bundle) { toast("That isn't a Trip History backup."); return; }
  busy(true, "Restoring…");
  let added = 0, skipped = 0;
  try { for (const h of bundle.histories) { const r = await mergeInto(current, h, bundle.histories.length > 1 ? h.name : ""); added += r.added; skipped += r.skipped; } }
  finally { busy(false); }
  await reloadCurrent();
  toast(`Restored ${plural(added, "file")} into “${currentName()}”${skipped ? ` (${skipped} were already here)` : ""}.`);
}

// ---------------------------------------------------------------- several histories
function renderHistSel() {
  const sel = $("histSel"); if (!sel) return;
  sel.innerHTML = histList().map((h) => `<option value="${esc(h.id)}"${h.id === current ? " selected" : ""}>${esc(h.name)}</option>`).join("") +
    '<option value="__new">＋ New history…</option><option value="__manage">Manage histories…</option>';
}
async function switchTo(id) {
  if (id === current) return;
  stopWatch(true);
  if (dbp) { try { (await dbp).close(); } catch (e) { /* already closed */ } }
  dbp = null; current = id; prefs.set("current", id);
  state.tab = "overview";
  busy(true, `Opening ${currentName()}…`);
  try { await reloadCurrent(); } finally { busy(false); }
  toast(`Now showing “${currentName()}”.`);
}
function uniqueName(name) {
  const names = new Set(histList().map((h) => h.name.toLowerCase()));
  const base = String(name || "").trim() || "History";
  let n = base, k = 2;
  while (names.has(n.toLowerCase())) n = `${base} (${k++})`;
  return n;
}
function createHistory(name) {
  const h = { id: "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: uniqueName(name) };
  saveList(histList().concat([h]));
  return h;
}
$("histSel").onchange = async (e) => {
  const v = e.target.value;
  if (v === "__new") {
    renderHistSel();
    const name = prompt("Name for the new history (e.g. North region, Transmission, 2025 storms):");
    if (name && name.trim()) await switchTo(createHistory(name).id);
    return;
  }
  if (v === "__manage") { renderHistSel(); go("data"); return; }
  await switchTo(v);
};
function histCardHtml() {
  const list = histList();
  return `<div class="card" id="hx-histCard" style="margin-bottom:16px">
    <div class="card-head"><h2>Histories</h2><span class="hint">Keep separate histories (by region, team, voltage…) and switch with the list at the top. Each has its own files, notes, weather and settings.</span></div>
    <div class="tablewrap"><table class="t"><thead><tr><th style="width:34px" title="Tick histories to combine or export">✓</th><th>History</th><th></th></tr></thead><tbody>
    ${list.map((h) => `<tr><td><input type="checkbox" data-hpick="${esc(h.id)}" aria-label="Pick ${esc(h.name)}"></td><td>${h.id === current ? `<b>${esc(h.name)}</b> <span class="chip pair">open</span>` : esc(h.name)}</td>
      <td style="text-align:right;white-space:nowrap">${h.id === current ? "" : `<button class="small" data-hopen="${esc(h.id)}">Open</button> `}<button class="small" data-hren="${esc(h.id)}">Rename</button>${list.length > 1 ? ` <button class="small danger" data-hdel="${esc(h.id)}">Delete</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px">
      <button id="hx-hNew">New history</button>
      <span class="field"><button id="hx-hCombine">Combine the ticked into</button><select id="hx-hTarget" aria-label="Combine into"><option value="__new">a new history</option>${list.map((h) => `<option value="${esc(h.id)}">${esc(h.name)}</option>`).join("")}</select></span>
      <button id="hx-hExport">Export all histories as one file</button>
      <button id="hx-hImport">Import histories from a file</button>
      <input type="file" id="hx-pickBundle" accept=".json,application/json" hidden>
    </div>
    <p class="hint">Combining copies the events into the target, and each event still counts once; the originals stay until you delete them. “Export all” makes one .json with every history (or only the ticked ones). Importing it, here or on another computer, brings each back as its own history.</p>
  </div>`;
}
function wireHistCard() {
  const picked = () => [...root.querySelectorAll("[data-hpick]:checked")].map((c) => c.dataset.hpick);
  const nameOf = (id) => (histList().find((h) => h.id === id) || {}).name || "";
  $("hNew").onclick = async () => { const name = prompt("Name for the new history:"); if (name && name.trim()) await switchTo(createHistory(name).id); };
  root.querySelectorAll("[data-hopen]").forEach((b) => { b.onclick = () => switchTo(b.dataset.hopen); });
  root.querySelectorAll("[data-hren]").forEach((b) => { b.onclick = () => {
    const l = histList(), h = l.find((x) => x.id === b.dataset.hren);
    const name = prompt("New name:", h.name);
    if (!name || !name.trim() || name.trim() === h.name) return;
    h.name = uniqueName(name); saveList(l); render();
  }; });
  root.querySelectorAll("[data-hdel]").forEach((b) => { b.onclick = async () => {
    const h = histList().find((x) => x.id === b.dataset.hdel);
    if (!confirm(`Delete the history “${h.name}” and everything in it? Export it first if you might need it.`)) return;
    if (h.id === current) await switchTo(histList().find((x) => x.id !== h.id).id);
    saveList(histList().filter((x) => x.id !== h.id));
    try { indexedDB.deleteDatabase(dbNameOf(h.id)); } catch (e) { /* already gone */ }
    render(); toast(`Deleted “${h.name}”.`);
  }; });
  $("hCombine").onclick = async () => {
    const ids = picked(), tgt = $("hTarget").value;
    if (!ids.length) { toast("Tick the histories to combine first."); return; }
    let target = tgt;
    if (tgt === "__new") {
      const name = prompt("Name for the combined history:", ids.map(nameOf).join(" + "));
      if (!name || !name.trim()) return;
      target = createHistory(name).id;
    }
    const src = ids.filter((id) => id !== target);
    if (!src.length) { toast("Tick at least one history other than the one you're combining into."); return; }
    busy(true, "Combining…");
    let added = 0;
    try { for (const id of src) added += (await mergeInto(target, await readData(id), nameOf(id))).added; }
    finally { busy(false); }
    const name = nameOf(target);
    if (target === current) await reloadCurrent(); else render();
    toast(`Combined ${plural(src.length, "history", "histories")} into “${name}” (${plural(added, "file")} copied).`, 6000);
    if (target !== current && confirm(`Open “${name}” now?`)) await switchTo(target);
  };
  $("hExport").onclick = async () => {
    const ids = picked().length ? picked() : histList().map((h) => h.id);
    busy(true, "Packing…");
    const histories = [];
    try { for (const id of ids) histories.push(await readData(id)); } finally { busy(false); }
    const nf = histories.reduce((a, h) => a + h.files.length, 0);
    download(`Trip histories ${new Date().toISOString().slice(0, 10)} (${plural(histories.length, "history", "histories")}, ${nf} files).json`,
      new Blob([JSON.stringify({ app: "sel-trip-history-bundle", version: VERSION, exported: new Date().toISOString(), histories })], { type: "application/json" }));
  };
  $("hImport").onclick = () => $("pickBundle").click();
  $("pickBundle").onchange = async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importBundle(f); };
}
/** Each history in the file becomes its own history here. */
async function importBundle(f) {
  const bundle = await readBackupFile(f);
  if (!bundle) { toast("That isn't a Trip History backup."); return; }
  busy(true, "Importing…");
  const made = [];
  let intoCurrent = false;
  try {
    for (const h of bundle.histories) {
      const name = h.name || f.name.replace(/\.json$/i, "");
      // an empty history with the same name (e.g. a new computer's empty "Main history") is filled in rather than duplicated
      const same = histList().find((x) => x.name.toLowerCase() === name.toLowerCase());
      let id;
      if (same) {
        const p = same.id === current ? db() : openDb(dbNameOf(same.id));
        const n = await txOn(p, "files", "readonly", (st) => st.count()).catch(() => 1);
        if (same.id !== current) (await p).close();
        if (!n) id = same.id;
      }
      if (!id) id = createHistory(name).id;
      await mergeInto(id, h, "");
      if (id === current) intoCurrent = true;
      made.push((histList().find((x) => x.id === id) || {}).name);
    }
  } finally { busy(false); }
  if (intoCurrent) await reloadCurrent(); else render();
  toast(`Imported ${made.map((n) => `“${n}”`).join(", ")}.${made.length > 1 || !intoCurrent ? " Pick one in the History list at the top to open it." : ""}`, 7000);
}
$("emptyImport").onclick = () => $("pickEmpty").click();
$("pickEmpty").onchange = async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importBundle(f); };

// ---------------------------------------------------------------- evidence drawer
function openDrawer(id, list) {
  state.drawer = { id, list: list && list.length ? list : [id] };
  renderDrawer();
  $("drawer").classList.add("open"); $("drawer").setAttribute("aria-hidden", "false");
}
function closeDrawer() { $("drawer").classList.remove("open"); $("drawer").setAttribute("aria-hidden", "true"); state.drawer.id = null; }
function stepDrawer(d) {
  const { id, list } = state.drawer; const i = list.indexOf(id);
  if (i < 0) return; const j = i + d; if (j < 0 || j >= list.length) return;
  state.drawer.id = list[j]; renderDrawer();
}
function renderDrawer() {
  const m = state.model, r = m.byId.get(state.drawer.id);
  if (!r) { closeDrawer(); return; }
  const { list } = state.drawer, i = list.indexOf(r.id);
  $("dPrev").disabled = i <= 0; $("dNext").disabled = i < 0 || i >= list.length - 1;
  $("dTitle").innerHTML = `${esc(r.relay)} · ${evType(r)}`;
  $("dSub").textContent = `${H.fmtWhen(r)} · ${r.stationName}${list.length > 1 ? ` · ${i + 1} of ${list.length}` : ""}`;
  const L = m.relays.find((x) => x.key === upper(r.relay));
  const recs = m.recurring.filter((x) => x.allIds.includes(r.id));
  const hot = m.hotspots.filter((h) => h.ids.includes(r.id));
  const seqMates = L ? L.records.filter((x) => x.occ === r.occ && x.id !== r.id) : [];
  const amps = Object.entries(r.amps).filter(([k]) => k !== "N");
  const code = (c) => (c ? ` <span class="muted mono" style="font-size:11.5px">${esc(c)}</span>` : "");
  const kv = state.plain ? [
    ["What it was", `${esc(PL.faultShort(r.core, r.tripped))}${code(r.et)}`],
    ["Where", `${esc(PL.where(r) || "distance not known")}`],
    ["What tripped it", `${esc(PL.kindsOf(r.primary, r.targets).join("; ") || (r.tripped ? "not identified in the record" : "nothing tripped"))}${code([r.targets, r.primary.join(" ")].filter(Boolean).join(" · "))}`],
    ["Breaker opened", r.clearCyc !== null ? `${esc(PL.cycles(r.clearCyc))} after the trip${r.clearCyc > state.cfg.slowCycles ? ' <span class="trip">(slow)</span>' : ""}` : "–"],
  ] : [["Event type", `${esc(r.et)}${r.desc ? ` <span class="muted">(${esc(r.desc)})</span>` : ""}`], ["Targets", esc(r.targets || "–")],
    ["Fault location", r.loc ? `${esc(r.loc)}${r.locPct !== null ? ` <span class="muted">(~${r.locPct}% of the line, LL ${r.ll})</span>` : ""}` : "–"],
    ["Breaker cleared", r.clearCyc !== null ? `${r.clearCyc} cycles after the trip` : "–"], ["Tripping element", esc(r.primary.join(", ") || "–")],
    ["Fault current", amps.length ? amps.map(([k, v]) => `${{ A: "IA", B: "IB", C: "IC", G: "IG", Q: "3I2", F: "max" }[k] || k} ${v.toLocaleString()} A`).join(" · ") : "–"],
    ["Shot / frequency", `${esc(r.shot || "–")} / ${esc(r.freq || "–")} Hz`], ["Confidence", `${esc(r.confidence)} <span class="muted">(${esc(r.basis)})</span>`]];
  if (state.plain) kv.push(["Fault current", amps.length ? `highest ${Math.max(...amps.map(([, v]) => v)).toLocaleString()} A${code(amps.map(([k, v]) => `${{ A: "IA", B: "IB", C: "IC", G: "IG", Q: "3I2", F: "max" }[k] || k} ${v}`).join(" "))}` : "–"],
    ["How sure", `${esc({ High: "Fairly sure", Medium: "Somewhat sure", Low: "Not sure" }[r.confidence] || r.confidence)} <span class="muted">(${esc(r.basis)})</span>`]);
  $("dBody").innerHTML = `
    <p style="margin:0 0 8px;font-weight:600">${esc(H.whatHappened(r, state.plain))}</p>
    <div>${issueChips(r, 20)}</div>
    ${recs.length || hot.length ? `<h4>Part of a pattern</h4><ul>${recs.map((x) => `<li><b>Recurring ${esc(IL(x.key).toLowerCase())}</b> at ${esc(x.relay)}: ${x.inWindow} times in ${x.windowDays} days (${x.total} in all). <button class="link" data-list="${esc(x.allIds.join("\n"))}">step through them</button></li>`).join("")}
      ${hot.map((h) => `<li><b>Fault hot spot</b>: ${h.n} faults between ${h.from.toFixed(2)} and ${h.to.toFixed(2)}. <button class="link" data-list="${esc(h.ids.join("\n"))}">step through them</button></li>`).join("")}</ul>` : ""}
    ${seqMates.length ? `<h4>Same sequence</h4><ul>${seqMates.map((x) => `<li><button class="link" data-open="${esc(x.id)}">${esc(H.fmtWhen(x))} ${esc(x.et)}</button> <span class="muted">${esc(x.targets)}</span></li>`).join("")}</ul>` : ""}
    <div class="nosnap" style="margin:12px 0 4px;display:flex;gap:8px;flex-wrap:wrap"><button class="accent small" id="hx-dAnalyzer" title="Open this event's files in the SEL Trip Analyzer${r.waveId ? ", on the Waveforms page" : ""}">${r.waveId ? "Open waveforms in Trip Analyzer ↗" : "Open in Trip Analyzer ↗"}</button></div>
    ${r.wx ? `<h4>Weather</h4><p style="margin:0">${wxTag(r)} ${esc(r.wx.text)}${r.wx.location ? ` <span class="hint">at ${esc(r.wx.location)}</span>` : ""}</p>${r.wx.hints ? `<ul class="hint">${r.wx.hints.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : ""}` : ""}
    ${r.tripped ? `<h4>PRC-004 review</h4><p style="margin:0">${reviewHtml(r)}</p>${opts.reviewEvent && !SNAP ? `<p style="margin:6px 0 0"><button class="small" id="hx-dReview">${r.review ? "Change the review" : "Review this trip"}</button></p>` : ""}` : ""}
    <h4>Details</h4><table class="kv">${kv.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}</table>
    <h4>Probable cause</h4><ul>${r.cause.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
    ${r.checks.length ? `<h4>Check</h4><ul class="checkl">${r.checks.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    ${r.gaps.length ? `<h4>Missing data</h4><ul class="hint">${r.gaps.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    ${r.evidence.length ? `<h4>Evidence</h4><ul>${r.evidence.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    ${r.seq.length ? `<h4>${state.plain ? "What the relay saw, in order (cycles from the start)" : "Elements that asserted (cycles)"}</h4><div class="seq mono">${r.seq.map(([c, e]) => `${c.toFixed(2).padStart(6, " ")}  ${esc(e)}${state.plain ? ` <span style="font-family:inherit" class="muted">${esc(PL.element(e))}</span>` : ""}`).join("<br>")}</div>` : ""}
    <h4>Note</h4><textarea id="hx-dNote" rows="2" placeholder="e.g. Crew found a cracked insulator at pole 112"${SNAP ? " readonly" : ""}>${esc(noteOf(r.id))}</textarea>
    <p class="hint" style="margin:3px 0 0">${SNAP ? "" : "The same note shows in the Trip Analyzer's events table."}</p>
    <h4>Source files</h4><ul>${r.sources.map((s) => `<li class="mono" style="font-size:12px">${esc(s.path)} ${!SNAP && state.files.some((f) => f.hash === s.hash) ? `<button class="link" data-dl="${esc(s.hash)}">download</button>` : ""}</li>`).join("")}</ul>
    ${r.settingsFiles && r.settingsFiles.length ? `<h4>Settings for this relay</h4><ul>${r.settingsFiles.map((s) => `<li class="mono" style="font-size:12px">${esc(s.path)}</li>`).join("")}</ul>` : ""}`;
  $("dNote").oninput = (e) => {
    if (SNAP) return;
    const v = e.target.value.trim(), sn = shared.get("notes", {});
    if (v) { state.notes[r.id] = v; sn[r.id] = v; } else { delete state.notes[r.id]; delete sn[r.id]; }
    shared.set("notes", sn); state.sharedNotes = sn;
    clearTimeout(renderDrawer.t); renderDrawer.t = setTimeout(() => kvSet("notes", state.notes), 400);
  };
  if ($("dReview")) $("dReview").onclick = () => { const ev = eventFiles(r); if (ev) { closeDrawer(); opts.reviewEvent(ev); } };
  $("dBody").querySelectorAll("[data-list]").forEach((b) => { const ids = b.dataset.list.split("\n"); b.onclick = () => openDrawer(ids[0], ids); });
  $("dBody").querySelectorAll("[data-open]").forEach((b) => { b.onclick = () => openDrawer(b.dataset.open, state.drawer.list.includes(b.dataset.open) ? state.drawer.list : [b.dataset.open]); });
  $("dAnalyzer").onclick = () => openInAnalyzer(r);
  $("dBody").querySelectorAll("[data-dl]").forEach((b) => { b.onclick = () => { const f = state.files.find((x) => x.hash === b.dataset.dl); if (f) download(f.name, new Blob([f.bytes])); }; });
}
$("dClose").onclick = closeDrawer;
$("dPrev").onclick = () => stepDrawer(-1);
$("dNext").onclick = () => stepDrawer(1);

// ---------------------------------------------------------------- customers per circuit
function custCardHtml() {
  const m = state.model;
  return `<div class="card" id="hx-custCard" style="margin-bottom:16px">
    <div class="card-head"><h2>Customers</h2><span class="hint">How many customers each circuit serves, for customer interruptions and SAIFI / MAIFI estimates</span></div>
    <div class="tablewrap"><table class="t locs"><thead><tr><th>Location</th><th>Station</th><th style="width:160px">Customers</th></tr></thead><tbody>
    ${m.relays.map((L) => `<tr><td><b>${esc(L.relay)}</b></td><td class="hint">${esc(L.station)}</td><td><input type="number" min="0" step="1" data-cust="${esc(L.relay)}" value="${L.cust ? L.cust.customers : ""}" placeholder="–" style="width:120px"></td></tr>`).join("")}
    </tbody></table></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px">
      <label for="hx-custMode" class="hint">Sustained interruptions</label>
      <select id="hx-custMode"><option value="lockout">a recloser lockout is sustained, other trips momentary</option><option value="all">every trip is sustained (no reclosing)</option></select>
    </div></div>`;
}
function wireCustCard() {
  $("custMode").value = state.cfg.sustained || "lockout";
  $("custMode").onchange = (e) => { state.cfg.sustained = e.target.value; kvSet("cfg", state.cfg); rebuild(false); };
  root.querySelectorAll("[data-cust]").forEach((inp) => { inp.onchange = async () => {
    const v = parseInt(inp.value, 10);
    if (Number.isFinite(v) && v > 0) state.customers[inp.dataset.cust] = v; else delete state.customers[inp.dataset.cust];
    await kvSet("customers", state.customers); rebuild(false);
  }; });
}

// ---------------------------------------------------------------- weather
const HOURLY = "temperature_2m,precipitation,snowfall,weather_code,wind_speed_10m,wind_gusts_10m";
function analyzerLocations() { try { return JSON.parse(localStorage.getItem("sel-trip:locations") || "{}"); } catch (e) { return {}; } }
/** Where to look up the weather for a record: its station's location, else the location the Trip Analyzer has for the relay. */
function locFor(r) {
  const st = state.locations[r.stationName];
  if (st) return st;
  const a = analyzerLocations();
  return a[r.relay] || a[upper(r.relay)] || null;
}
function wxCardHtml() {
  const m = state.model;
  const a = analyzerLocations();
  const need = m.records.filter((r) => r.tripped && r.ms !== null);
  const done = need.filter((r) => state.weather[r.id]).length;
  return `<div class="card" id="hx-wxCard" style="margin-bottom:16px">
    <div class="card-head"><h2>Stations &amp; weather</h2><span class="hint">${done} of ${need.length} trips have weather · from Open-Meteo: only the location and dates are sent</span></div>
    <div class="tablewrap"><table class="t locs"><thead><tr><th>Station</th><th>Relays</th><th style="width:44%">Where (a town like “Apex, NC”, or latitude, longitude)</th><th></th></tr></thead><tbody>
    ${m.stations.map((S) => { const l = state.locations[S.name]; const fromA = !l && S.relays.some((L) => a[L.relay] || a[L.key]);
      return `<tr><td><b>${esc(S.name)}</b></td><td class="hint">${S.relays.map((L) => esc(L.relay)).join(", ")}</td><td><input type="text" data-loc="${esc(S.name)}" value="${esc(l ? l.typed || l.label : "")}" placeholder="${fromA ? "using the Trip Analyzer's locations" : "not set"}"></td><td data-locst="${esc(S.name)}">${l ? `<span class="st-ok">✓ ${esc(l.label)}</span>` : fromA ? '<span class="st-ok">✓ from Trip Analyzer</span>' : ""}</td></tr>`; }).join("")}
    </tbody></table></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px">
      <button class="accent" id="hx-wxGo">Look up weather</button>
      <select id="hx-wxUnits" aria-label="Units"><option value="us">°F, mph</option><option value="metric">°C, km/h</option></select>
      <label class="check"><input type="checkbox" id="hx-wxAuto"${state.cfg.autoWeather !== false ? " checked" : ""}> Look up new trips automatically</label>
      <button id="hx-wxClear">Clear weather</button><span class="hint" id="hx-wxStatus"></span>
    </div></div>`;
}
function wireWxCard() {
  $("wxUnits").value = state.cfg.wxUnits || "us";
  $("wxUnits").onchange = (e) => { state.cfg.wxUnits = e.target.value; kvSet("cfg", state.cfg); };
  $("wxAuto").onchange = (e) => { state.cfg.autoWeather = e.target.checked; kvSet("cfg", state.cfg); };
  $("wxGo").onclick = () => lookupWeather(false);
  $("wxClear").onclick = async () => { state.weather = {}; await kvSet("weather", state.weather); rebuild(false); };
  root.querySelectorAll("[data-loc]").forEach((inp) => {
    inp.onchange = async () => {
      const st = inp.dataset.loc, text = inp.value.trim(), cell = root.querySelector(`[data-locst="${CSS.escape(st)}"]`);
      if (!text) { delete state.locations[st]; await kvSet("locations", state.locations); cell.innerHTML = ""; return; }
      cell.innerHTML = '<span class="hint">searching…</span>';
      try {
        const res = await WX.geocode(text);
        if (!res.length) { cell.innerHTML = '<span class="st-bad">not found: try “Town, ST” or “lat, lon”</span>'; return; }
        state.locations[st] = { label: res[0].label, lat: res[0].lat, lon: res[0].lon, typed: text };
        await kvSet("locations", state.locations);
        cell.innerHTML = `<span class="st-ok" title="${esc(res.slice(1, 4).map((x) => x.label).join("; "))}">✓ ${esc(res[0].label)}</span>`;
      } catch (e) { cell.innerHTML = `<span class="st-bad">couldn't reach the location service</span>`; }
    };
  });
}
async function fetchHours(loc, from, to, units) {
  const u = units === "metric" ? "" : "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch";
  const today = new Date().toISOString().slice(0, 10);
  const recent = (Date.parse(today) - Date.parse(from)) / 864e5 <= 60;
  const host = recent ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive";
  const r = await fetch(`${host}?latitude=${loc.lat}&longitude=${loc.lon}&start_date=${from}&end_date=${to}&hourly=${HOURLY}&timezone=auto${u}`);
  if (!r.ok) throw new Error(`weather service said ${r.status}`);
  const j = await r.json(), h = j.hourly || {}, byDate = {};
  (h.time || []).forEach((t, i) => {
    (byDate[t.slice(0, 10)] = byDate[t.slice(0, 10)] || []).push({ hour: +t.slice(11, 13), temp: h.temperature_2m[i], precip: h.precipitation[i], snow: h.snowfall[i],
      code: h.weather_code[i], wind: h.wind_speed_10m[i], gust: h.wind_gusts_10m[i] });
  });
  return byDate;
}
let wxBusy = false;
/** Weather at the hour of every trip that doesn't have it yet: one request per station for the older dates and one for the last 60 days. */
async function lookupWeather(quiet) {
  if (wxBusy) return;
  const status = (t) => { if ($("wxStatus")) $("wxStatus").textContent = t; };
  const units = state.cfg.wxUnits || "us", today = new Date().toISOString().slice(0, 10);
  const groups = new Map();
  let noLoc = 0;
  for (const r of state.model.records) {
    if (!r.tripped || r.ms === null || state.weather[r.id] || r.date > today) continue;
    const loc = locFor(r);
    if (!loc) { noLoc++; continue; }
    const k = `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}`;
    if (!groups.has(k)) groups.set(k, { loc, recs: [] });
    groups.get(k).recs.push(r);
  }
  if (!groups.size) { if (!quiet) { status(noLoc ? `Set where the stations are first (${plural(noLoc, "trip")} have no location).` : "Every trip already has its weather."); toast(noLoc ? "Set the station locations first." : "Every trip already has its weather."); } return; }
  wxBusy = true;
  let done = 0, failed = 0, n = 0;
  for (const g of groups.values()) n += g.recs.length;
  try {
    for (const { loc, recs } of groups.values()) {
      const recentCut = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
      for (const part of [recs.filter((r) => r.date < recentCut), recs.filter((r) => r.date >= recentCut)]) {
        if (!part.length) continue;
        const dates = part.map((r) => r.date).sort();
        status(`Looking up ${loc.label}…`);
        let byDate;
        try { byDate = await fetchHours(loc, dates[0], dates[dates.length - 1], units); } catch (e) { failed += part.length; status(`Couldn't reach the weather service (${e.message || e})`); continue; }
        for (const r of part) {
          const hours = byDate[r.date];
          const a = hours && WX.assess(hours, new Date(r.ms).getUTCHours(), units);
          if (!a) { failed++; continue; }
          state.weather[r.id] = { text: a.text, kinds: a.hints.map((h) => h.kind), hints: a.hints.filter((h) => h.kind !== "calm").map((h) => h.text), location: loc.label };
          done++;
        }
      }
    }
  } finally { wxBusy = false; }
  await kvSet("weather", state.weather);
  status(`Weather added to ${plural(done, "trip")}${failed ? `; ${failed} couldn't be looked up` : ""}${noLoc ? `; ${plural(noLoc, "trip")} at stations with no location` : ""}.`);
  if (!quiet || done) toast(`Weather added to ${plural(done, "trip")}${failed ? ` (${failed} couldn't be looked up)` : ""}.`);
  if (done) rebuild(false);
}

function reviewHtml(r) {
  const rv = r.review;
  if (!rv) return r.reviewStatus === "overdue" ? `<span class="trip">Not reviewed: overdue</span> (the decision was due ${esc(r.reviewDue)})` : `Not reviewed yet: decide by ${esc(r.reviewDue)}`;
  const label = { correct: '<span class="ok">Correct operation</span>', misop: '<span class="trip">Misoperation</span>', na: "Not applicable" }[rv.outcome] || esc(rv.outcome);
  const who = [rv.reviewer, rv.date].filter(Boolean).join(", ");
  return label + (rv.outcome === "misop" && rv.category ? ` · ${esc(rv.category)}` : "") + (rv.outcome === "misop" && rv.cause ? ` · cause: ${esc(rv.cause)}` : "") +
    (who ? ` <span class="hint">(${esc(who)})</span>` : "") + (rv.notes ? `<br><span class="hint">${esc(rv.notes)}</span>` : "");
}

// ---------------------------------------------------------------- open in the Trip Analyzer
function defaultAnalyzerUrl() {
  if (/^https?:$/.test(location.protocol)) return new URL("SEL_Trip_Analyzer.html", location.href).href;
  const [owner, repo] = REPO.split("/");
  return `https://${owner}.github.io/${repo}/SEL_Trip_Analyzer.html`;
}
const analyzerUrl = () => state.cfg.analyzerUrl || defaultAnalyzerUrl();
$("analyzerBtn").hidden = EMBED;
$("analyzerBtn").onclick = () => window.open(analyzerUrl(), "sel-analyzer");
/** Send the event's files (with its COMTRADE pair and the relay's settings) to the Analyzer page, which opens it. */
/** The event's files, its COMTRADE pair and the relay's settings, ready to hand to the Analyzer. */
function eventFiles(r) {
  const want = new Map();
  const byHash = new Map(state.files.map((f) => [f.hash, f]));
  for (const s of r.sources.concat(r.settingsFiles || [])) {
    const f = byHash.get(s.hash) || state.files.find((x) => x.path === s.path);
    if (f) want.set(f.hash, f);
    if (f && core.COMTRADE_EXTS.includes(core.extOf(f.name))) {       // the .cfg needs its .dat
      const stem = f.path.replace(/\.[^./]+$/, "").toLowerCase();
      for (const x of state.files) if (x.path.replace(/\.[^./]+$/, "").toLowerCase() === stem) want.set(x.hash, x);
    }
  }
  if (!want.size) { toast("This event's files aren't kept here any more."); return null; }
  return { files: [...want.values()].map((f) => ({ name: f.name, path: f.path, bytes: f.bytes })), id: r.id, rec: r.waveId || "", label: `${r.relay} ${r.date} ${r.time.slice(0, 8)}` };
}
function openInAnalyzer(r) {
  const ev = eventFiles(r); if (!ev) return;
  const files = ev.files;
  if (opts.openEvent) { closeDrawer(); opts.openEvent({ files, id: r.id, rec: r.waveId || "", label: `${r.relay} ${r.date} ${r.time.slice(0, 8)}` }); return; }
  const w = window.open(analyzerUrl() + "#from-history", "sel-analyzer");
  if (!w) { toast("The browser blocked the new window: allow pop-ups for this page and try again."); return; }
  let sent = false, tries = 0;
  const payload = { type: "sel-open", files, id: r.id, rec: r.waveId || "", label: `${r.relay} ${r.date} ${r.time.slice(0, 8)}` };
  const onMsg = (e) => {
    if (e.source !== w || !e.data) return;
    if (e.data.type === "sel-ready" && !sent) { sent = true; w.postMessage(payload, "*"); }
    if (e.data.type === "sel-opened") { cleanup(); toast(`Opened in the Trip Analyzer (${plural(files.length, "file")}).`); }
  };
  const ping = setInterval(() => {
    if (++tries > 60) { cleanup(); toast("The Trip Analyzer didn't answer. It needs a version with the History link; check its address in Files & settings."); return; }
    try { w.postMessage({ type: "sel-ping" }, "*"); } catch (e) { /* still loading */ }
  }, 400);
  function cleanup() { clearInterval(ping); window.removeEventListener("message", onMsg); }
  window.addEventListener("message", onMsg);
}

// ---------------------------------------------------------------- watch a folder (Chrome / Edge: File System Access)
const WATCH_MS = 15000;
let watch = null;             // {handle, seen: {path: "size|modified"}, waiting: Map, timer, added, checked, busy, paused}
function watchStatus() {
  const bar = $("watchBar"); if (!bar) return;
  bar.hidden = !watch; if (!watch) return;
  bar.classList.toggle("paused", !!watch.paused);
  const t = watch.checked ? watch.checked.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  $("watchText").innerHTML = watch.paused ? `Paused: allow <b>${esc(watch.handle.name)}</b> again` :
    `Watching <b>${esc(watch.handle.name)}</b>${t ? ` · checked ${t}` : ""}${watch.added ? ` · ${watch.added} new` : ""}`;
  $("watchStop").textContent = watch.paused ? "Resume" : "Stop";
}
async function listDir(handle, prefix, out) {
  for await (const [name, h] of handle.entries()) {
    if (h.kind === "file") { if (ALLOWED.has(core.extOf(name)) && !name.toUpperCase().startsWith("README")) out.push({ path: prefix + name, h, name }); }
    else if (h.kind === "directory" && !name.startsWith(".")) await listDir(h, prefix + name + "/", out);
  }
  return out;
}
/** New or changed files are taken once they haven't changed for one check (half-copied files wait). */
async function pollWatch(first) {
  if (!watch || watch.busy || watch.paused) return;
  watch.busy = true;
  try {
    const list = await listDir(watch.handle, watch.handle.name + "/", []);
    const fresh = [];
    for (const { path, h, name } of list) {
      let f; try { f = await h.getFile(); } catch (e) { continue; }
      const sig = f.size + "|" + f.lastModified;
      if (watch.seen[path] === sig) continue;
      if (!first && watch.waiting.get(path) !== sig) { watch.waiting.set(path, sig); continue; }
      watch.waiting.delete(path);
      watch.seen[path] = sig;
      fresh.push({ file: f, name, path });
    }
    watch.checked = new Date();
    if (fresh.length) {
      const n = await addFiles(fresh, `Watched folder ${watch.handle.name}`, true);
      if (!first) { watch.added += n; if (n && document.hidden && !EMBED) { newSinceFocus += n; document.title = `(${newSinceFocus} new) ${baseTitle}`; } }
      kvSet("watchSeen", watch.seen);
    }
  } catch (e) { watch.paused = true; }
  finally { if (watch) watch.busy = false; watchStatus(); }
}
async function startWatch(handle) {
  stopWatch(true);
  const seen = (await kvGet("watchSeen")) || {};
  watch = { handle, seen: (await kvGet("watchName")) === handle.name ? seen : {}, waiting: new Map(), timer: null, added: 0, checked: null, busy: false, paused: false };
  await kvSet("watchDir", handle).catch(() => {}); kvSet("watchName", handle.name);
  watchStatus();
  await pollWatch(true);
  watch.timer = setInterval(() => pollWatch(false), WATCH_MS);
  toast(`Watching ${handle.name}: new relay files are added as they arrive, while this page is open.`);
}
function stopWatch(silent) {
  if (watch && watch.timer) clearInterval(watch.timer);
  watch = null;
  if (!silent) { tx("kv", "readwrite", (s) => s.delete("watchDir")).catch(() => {}); }
  watchStatus();
}
async function canUse(handle, ask) {
  try {
    if ((await handle.queryPermission({ mode: "read" })) === "granted") return true;
    return ask && (await handle.requestPermission({ mode: "read" })) === "granted";
  } catch (e) { return false; }
}
async function pickWatch() {
  let h; try { h = await window.showDirectoryPicker({ id: "sel-history-watch", mode: "read" }); } catch (e) { return; }
  startWatch(h);
}
async function resumeWatch() {
  if (typeof window.showDirectoryPicker !== "function") return;
  $("watchBtn").hidden = false; $("watchBtn2").hidden = false;
  if (watch) return;
  const h = await kvGet("watchDir");
  if (!h || watch) return;
  if (await canUse(h, false)) startWatch(h);
  else { watch = { handle: h, seen: (await kvGet("watchSeen")) || {}, waiting: new Map(), added: 0, paused: true }; watchStatus(); }
}
$("watchBtn").onclick = pickWatch;
$("watchBtn2").onclick = pickWatch;
$("watchStop").onclick = async () => {
  if (watch && watch.paused) { const h = watch.handle; if (await canUse(h, true)) startWatch(h); return; }
  stopWatch(false); toast("Stopped watching the folder.");
};
let newSinceFocus = 0;
const baseTitle = document.title;
if (!EMBED) document.addEventListener("visibilitychange", () => { if (!document.hidden) { newSinceFocus = 0; document.title = baseTitle; } });

// ---------------------------------------------------------------- export
const DESK = window.SEL_DESKTOP || null;
function download(name, blob) {
  if (opts.download) { opts.download(name, blob); return; }
  if (DESK) {
    const fr = new FileReader();
    fr.onload = () => fetch("/api/save", { method: "POST", headers: { "X-Token": DESK.token, "Content-Type": "application/json" }, body: JSON.stringify({ name, b64: String(fr.result).split(",")[1] || "" }) })
      .then((r) => r.json()).then((r) => toast(r.saved ? "Saved " + r.saved : r.cancelled ? "Not saved" : "Couldn't save")).catch(() => toast("Couldn't save"));
    fr.readAsDataURL(blob); return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
/** Stacked bars on a canvas (for Word and PDF), colours fixed for paper. */
function chartPng(months, series, title, markers) {
  const W = 1400, Hh = 420, padL = 60, padB = 50, padT = 56, padR = 20;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = Hh;
  const c = cv.getContext("2d");
  c.fillStyle = "#fff"; c.fillRect(0, 0, W, Hh);
  const n = months.length || 1, iw = W - padL - padR, ih = Hh - padT - padB, bw = iw / n;
  const tot = months.map((_, i) => series.reduce((a, s) => a + s.values[i], 0));
  const max = Math.max(1, ...tot), step = max <= 5 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : Math.ceil(max / 6 / 5) * 5, top = Math.ceil(max / step) * step;
  const y = (v) => padT + ih - ih * v / top;
  c.font = "600 26px Calibri, 'Segoe UI', Arial, sans-serif"; c.fillStyle = "#1b1b1b"; c.fillText(title, padL, 34);
  c.font = "20px Calibri, 'Segoe UI', Arial, sans-serif";
  let lx = W - padR;
  for (const s of series.slice().reverse()) { const w = c.measureText(s.label).width; lx -= w + 40; c.fillStyle = s.paper; c.fillRect(lx, 18, 16, 16); c.fillStyle = "#555"; c.fillText(s.label, lx + 22, 33); }
  c.strokeStyle = "#e0e0e0"; c.lineWidth = 1; c.fillStyle = "#666"; c.textAlign = "right";
  for (let v = 0; v <= top; v += step) { c.beginPath(); c.moveTo(padL, y(v)); c.lineTo(W - padR, y(v)); c.stroke(); c.fillText(String(v), padL - 8, y(v) + 7); }
  c.textAlign = "center";
  const every = n <= 14 ? 1 : n <= 26 ? 2 : n <= 40 ? 3 : 6;
  months.forEach((m, i) => {
    let acc = 0;
    for (const s of series) { const v = s.values[i]; if (!v) continue; c.fillStyle = s.paper; c.fillRect(padL + i * bw + bw * 0.12, y(acc + v), bw * 0.76, y(acc) - y(acc + v)); acc += v; }
    if (i % every === 0) { c.fillStyle = "#666"; c.fillText(`${MONTHS[+m.slice(5) - 1]} ${m.slice(2, 4)}`, padL + i * bw + bw / 2, Hh - 18); }
  });
  for (const mk of markers || []) {
    const i = months.indexOf(mk.month); if (i < 0) continue;
    const x = padL + (i + ((+mk.date.slice(8, 10) || 1) - 1) / 31) * bw;
    c.strokeStyle = "#0f7b0f"; c.setLineDash([8, 6]); c.lineWidth = 2.5; c.beginPath(); c.moveTo(x, padT - 4); c.lineTo(x, padT + ih); c.stroke(); c.setLineDash([]);
    c.fillStyle = "#0f7b0f"; c.textAlign = "left"; c.fillText("✓ " + mk.text, x + 6, padT + 14); c.textAlign = "center";
  }
  const url = cv.toDataURL("image/png"), bin = atob(url.split(",")[1]), png = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) png[i] = bin.charCodeAt(i);
  return { png, url, width: W, height: Hh };
}
function paperSeries(m, recs) {
  const s = chartSeries(m, recs);
  const pal = { "Fault trips": "#005fb8", "Trips with no fault": "#d08a10", "No trip": "#a0a0a0" };
  for (const x of s) x.paper = pal[x.label];
  return s;
}
function exportOpts() {
  const sections = {};
  root.querySelectorAll("#hx-expSections [data-s]").forEach((c) => { sections[c.dataset.s] = c.checked; });
  return { station: $("expStation").value, relay: $("expRelay").value, sections, notes: $("expNotes").value, now: core.nowStamp(), plain: !!state.plain };
}
function exportName(fmt) {
  const m = state.model, o = exportOpts();
  const recs = m.records.filter((r) => r.ms !== null && (!o.station || r.stationName === o.station) && (!o.relay || upper(r.relay) === o.relay));
  const scope = o.relay ? (m.relays.find((L) => L.key === o.relay) || {}).relay || o.relay : o.station || "All locations";
  const span = recs.length ? ` ${fmtDate(recs[0].ms)} to ${fmtDate(recs[recs.length - 1].ms)}` : "";
  const base = fmt === "snap" ? `${scope === "All locations" ? currentName() : scope} snapshot ${new Date().toISOString().slice(0, 10)}` : fmt === "csv-ev" ? `${scope} trip events${span}` : fmt === "csv-loc" ? `${scope} problem locations${span}` : `${scope} trip history${span}`;
  return base.replace(/[\\/:*?"<>|]+/g, "-") + "." + ({ docx: "docx", pdf: "pdf", txt: "txt", "csv-ev": "csv", "csv-loc": "csv", snap: "html" }[fmt]);
}
let nameEdited = false;
function openExport(pre) {
  const m = state.model, saved = prefs.get("export", {});
  $("expStation").innerHTML = `<option value="">All stations</option>` + m.stations.map((S) => `<option>${esc(S.name)}</option>`).join("");
  const fillRelays = () => { const st = $("expStation").value; $("expRelay").innerHTML = `<option value="">All relays</option>` + m.relays.filter((L) => !st || L.station === st).map((L) => `<option value="${esc(L.key)}">${esc(L.relay)}</option>`).join(""); };
  $("expStation").value = ""; fillRelays();
  if (pre && pre.relay) { const L = m.relays.find((x) => x.key === pre.relay); $("expStation").value = L.station; fillRelays(); $("expRelay").value = pre.relay; }
  for (const c of root.querySelectorAll("#hx-expSections [data-s]")) if (saved.sections && c.dataset.s in saved.sections) c.checked = saved.sections[c.dataset.s];
  const fmtIn = root.querySelector(`#hx-expFmt input[value="${saved.fmt || "docx"}"]`); if (fmtIn) fmtIn.checked = true;
  nameEdited = false;
  const update = () => {
    const fmt = root.querySelector("#hx-expFmt input:checked").value;
    $("expSections").hidden = fmt.startsWith("csv") || fmt === "snap";
    if (!nameEdited) $("expName").value = exportName(fmt);
    $("expHint").textContent = { docx: "A Word document with tables and charts, ready to edit.", pdf: "Opens the print window: choose Save as PDF.", txt: "Plain text, for an email or a log.",
      "csv-ev": "One row per event, with its issues and whether it's part of a recurring issue or hot spot.", "csv-loc": "One row per location, in rank order, with its score, trend and issues.",
      snap: "One web page with this history (or the locations picked above) built in. Whoever opens it sees these pages, read-only; the original relay files aren't included." }[fmt];
  };
  $("expStation").onchange = () => { fillRelays(); update(); };
  $("expRelay").onchange = update;
  $("expName").oninput = () => { nameEdited = true; };
  root.querySelectorAll("#hx-expFmt input").forEach((i) => { i.onchange = update; });
  update();
  $("expDlg").showModal();
}
$("exportBtn").onclick = () => openExport();
$("expGo").onclick = () => {
  const m = state.model, o = exportOpts(), fmt = root.querySelector("#hx-expFmt input:checked").value;
  prefs.set("export", { fmt, sections: o.sections });
  const name = $("expName").value.trim() || exportName(fmt);
  if (fmt === "snap") makeSnapshot(o, name);
  else if (fmt === "csv-ev") download(name, new Blob(["﻿" + H.eventsCsv(m, o)], { type: "text/csv" }));
  else if (fmt === "csv-loc") download(name, new Blob(["﻿" + H.locationsCsv(m, o)], { type: "text/csv" }));
  else {
    const charts = o.sections.charts !== false && fmt !== "txt";
    const blocks = H.reportBlocks(m, Object.assign({}, o, {
      chart: charts ? (kind, L) => {
        const recs = kind === "all" ? m.records.filter((r) => (!o.station || r.stationName === o.station) && (!o.relay || upper(r.relay) === o.relay)) : L.records;
        const img = chartPng(m.months, paperSeries(m, recs), kind === "all" ? "Trips per month" : `${L.relay}: trips per month`,
                             kind === "all" ? [] : L.worklog.map((w) => ({ month: w.date.slice(0, 7), date: w.date, text: w.text })));
        return ["image", { png: img.png, url: img.url, width: img.width, height: img.height, maxInches: 6.5 }];
      } : null,
    }));
    if (fmt === "txt") download(name, new Blob([H.blocksToText(blocks)], { type: "text/plain" }));
    else if (fmt === "docx") download(name, new Blob([Docx.build(blocks, { title: name.replace(/\.docx$/, ""), footer: "SEL Trip History" })], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    else printBlocks(blocks, name.replace(/\.pdf$/, ""));
  }
  $("expDlg").close();
};
/** One HTML file: this page with the history built in, opening read-only. */
function makeSnapshot(o, name) {
  const src = typeof opts.pageSource === "function" ? opts.pageSource() : opts.pageSource;
  if (!src) { toast("This copy can't make snapshots."); return; }
  const m = state.model;
  const recs = m.records.filter((r) => (!o.station || r.stationName === o.station) && (!o.relay || upper(r.relay) === o.relay));
  const ids = new Set(recs.map((r) => r.id));
  const pick = (map) => Object.fromEntries(Object.entries(map || {}).filter(([k]) => ids.has(k)));
  const DROP = new Set(["wx", "storm", "review", "reviewStatus", "reviewDue", "stationName", "stationFrom2", "occ", "occSize"]);
  const scope = o.relay ? (m.relays.find((L) => L.key === o.relay) || {}).relay || o.relay : o.station || "";
  const data = { app: "sel-trip-history-snapshot", version: VERSION, name: SNAP ? SNAP.name : currentName(), scope, made: new Date().toISOString(),
    records: recs.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !DROP.has(k)))),
    plain: !!state.plain, cfg: Object.assign({}, state.cfg), notes: pick(Object.assign({}, state.notes, state.sharedNotes)), reviews: pick(reviewsMap()), weather: pick(state.weather),
    worklog: state.worklog, overrides: state.overrides, customers: state.customers || {} };
  const empty = (html, id) => {
    const tag = `<script id="${id}" type="application/json">`, a = html.indexOf(tag);
    if (a < 0) return html;
    const b = html.indexOf("<\/script>", a + tag.length);
    return html.slice(0, a + tag.length) + (id === "hx-snapshot" ? "" : "[]") + html.slice(b);
  };
  let html = ["sample-data", "history-samples"].reduce(empty, src);
  const TAG = '<script id="hx-' + 'snapshot" type="application/json">';    // split so this code never matches itself
  const old = html.lastIndexOf(TAG);
  if (old >= 0) html = html.slice(0, old) + html.slice(html.indexOf("<\/script>", old) + 9);
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const at = html.indexOf(">", html.indexOf("<body")) + 1;          // first thing in the body, so it's there before the page's code runs
  html = html.slice(0, at) + "\n" + TAG + json + "<\/script>" + html.slice(at);
  download(name, new Blob([html], { type: "text/html" }));
  toast(`Snapshot saved: ${plural(recs.length, "event")}. Send the file; it opens in any browser, read-only.`, 6000);
}
function printBlocks(blocks, title) {
  const out = [];
  for (const b of blocks) {
    const k = b[0];
    if (k === "title") out.push(`<h1 style="font-size:20pt;border:0">${esc(b[1])}</h1>`);
    else if (k === "meta") out.push(`<p class="note">${esc(b[1].join("  ·  "))}</p>`);
    else if (k === "h1") out.push(`<h1>${esc(b[1])}</h1>`);
    else if (k === "h2" || k === "sub") out.push(`<h2>${esc(b[1])}</h2>`);
    else if (k === "para") out.push(`<p>${esc(b[1])}</p>`);
    else if (k === "note") out.push(`<p class="note">${esc(b[1])}</p>`);
    else if (k === "bullets") out.push(`<ul>${b[1].map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`);
    else if (k === "kv") out.push(`<table>${b[1].map(([a, v]) => `<tr><th style="width:24%">${esc(a)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`);
    else if (k === "table") out.push(`<table><thead><tr>${b[1].map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${b[2].map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
    else if (k === "image") out.push(`<img src="${b[1].url}" alt="">`);
  }
  const pr = opts.printRoot || document.getElementById("print-root");
  pr.innerHTML = `<div class="hx-print">${out.join("\n")}</div>`;
  const old = document.title; document.title = title;
  setTimeout(() => { window.print(); document.title = old; }, 50);
}
for (const d of root.querySelectorAll("dialog")) d.addEventListener("click", (e) => { if (e.target.closest("[data-close]") || e.target === d) d.close(); });

// ---------------------------------------------------------------- keys (only while this screen is showing)
document.addEventListener("keydown", (e) => {
  if (!active()) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (!EMBED && e.altKey && /^[1-5]$/.test(e.key) && !$("mainView").hidden) { e.preventDefault(); go(["overview", "locations", "issues", "events", "data"][+e.key - 1]); }
  else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); e.stopImmediatePropagation(); $("pickFiles").click(); }
  else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "s") { e.preventDefault(); e.stopImmediatePropagation(); if (!$("exportBtn").disabled) openExport(); }
  else if (state.drawer.id && !typing && !root.querySelector("dialog[open]")) {
    if (e.key === "Escape") closeDrawer();
    else if (e.key === "ArrowLeft") stepDrawer(-1);
    else if (e.key === "ArrowRight") stepDrawer(1);
  }
});

// ---------------------------------------------------------------- start
async function load() {
  state.locGroup = prefs.get("locGroup", "rank");
  state.colorBy = prefs.get("colorBy", "type");
  if (SNAP) {
    Object.assign(state, { records: SNAP.records || [], cfg: Object.assign({}, H.DEFAULTS, SNAP.cfg || {}), notes: {}, worklog: SNAP.worklog || {}, overrides: SNAP.overrides || {},
      weather: SNAP.weather || {}, customers: SNAP.customers || {}, files: [], batches: [], locations: {} });
    await rebuild(false);
    return;
  }
  try {
    const [files, batches, cfg, notes, worklog, overrides, weather, locations, baseline, customers] = await Promise.all([allOf("files"), allOf("batches"), kvGet("cfg"), kvGet("notes"), kvGet("worklog"), kvGet("overrides"), kvGet("weather"), kvGet("locations"), kvGet("baseline"), kvGet("customers")]);
    state.customers = customers || {};
    state.weather = weather || {}; state.locations = locations || {}; state.baseline = baseline || null;
    state.files = files || []; state.batches = batches || [];
    state.cfg = Object.assign({}, H.DEFAULTS, cfg || {}); state.notes = notes || {}; state.worklog = worklog || {}; state.overrides = overrides || {};
  } catch (e) { toast("This browser won't keep the history (storage is blocked). Files you add are analyzed but forgotten when you close the page.", 8000); }
  if (state.files.length) await rebuild(true);
  else { state.model = H.buildModel([], state.cfg); render(); }
  resumeWatch();
}

const ready = load().catch((e) => { console.error(e); toast("Couldn't open the history: " + (e.message || e)); });
return {
  ready, state, render: () => (state.model ? render() : undefined), plainChanged: () => { if (state.model) { render(); if (state.drawer.id) renderDrawer(); } }, refresh: () => (state.model ? rebuild(false) : undefined), go, openDrawer, rebuild, lookupWeather, openInAnalyzer, pollWatch, startWatch: (h) => startWatch(h),
  addFiles: async (list, label) => { await ready; return addFiles(list, label); },
  currentName, histories: histList, switchTo, readData, mergeInto, createHistory,
};
}

root0.SELHistoryUI = { mount };
})(typeof window !== "undefined" ? window : globalThis);
