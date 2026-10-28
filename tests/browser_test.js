/* End-to-end test of the built browser version (dist/SEL_Trip_Analyzer.html).
 *   python scripts/build_html.py && node tests/browser_test.js [screenshot-folder]
 * Needs Playwright with Chromium. */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const REPO = path.resolve(__dirname, ".."), OUT = process.argv[2] || null;
const url = "file://" + path.join(REPO, "dist/SEL_Trip_Analyzer.html");
// reference output: the same core run from the command line
const pyOut = (args) => {
  const ci = args.indexOf("--comments");
  const extra = ci >= 0 ? ["--comments", args[ci + 1]] : [];
  const paths = ci >= 0 ? args.slice(0, ci).concat(args.slice(ci + 2)) : args;
  return execFileSync(process.execPath, [path.join(REPO, "web", "cli.js"), "--now", "X", ...UI_DEFAULTS, ...extra, ...paths], { encoding: "utf8" }).trimEnd();
};
const UI_DEFAULTS = ["--hide-duplicates", "--detail", "standard"];
const cliRaw = (args) => execFileSync(process.execPath, [path.join(REPO, "web", "cli.js"), "--now", "X", ...args], { encoding: "utf8" });
const shot = (p, name, opts) => (OUT ? p.screenshot({ path: path.join(OUT, name), ...(opts || {}) }) : Promise.resolve());
const norm = (t) => t.replace(/^Generated: .*$/m, "Generated: X").trimEnd();
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, cond, extra) => { results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1240, height: 1000 }, acceptDownloads: true, colorScheme: "light" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  // fake GitHub: a newer release with the html asset
  await ctx.route("https://api.github.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ tag_name: "v9.9.0", body: "notes", assets: [{ name: "SEL_Trip_Analyzer.html", browser_download_url: "https://example.invalid/new.html" }] }) }));
  await page.goto(url);
  await shot(page, "web_empty_light.png");

  // 1) samples -> identical to Python
  await page.click("#samples");
  await page.waitForFunction(() => !window.__selApp.state.empty);
  const fromSamples = norm(await page.evaluate(() => window.__selApp.summaryText()));
  ok("Try samples matches command-line report", fromSamples === pyOut([path.join(REPO, "sample_files")]));
  ok("highlighting applied", (await page.locator("#out .trip").count()) > 5 && (await page.locator("#out .warnb").count()) > 5);

  // 2) update banner from (faked) GitHub
  await page.waitForSelector("#banner.show", { timeout: 5000 }).catch(() => {});
  ok("update banner shows newer version", await page.isVisible("#banner") && (await page.textContent("#updBtn")).includes("9.9.0"));
  await shot(page, "web_samples_light.png");

  // 3) real file upload with comments
  await page.click("#clear");
  await page.fill("#comments", "Crew patrol found a cracked insulator.\nSecond line.");
  const pick = ["Feeder12_AG_Zone1.cev", "Feeder12_settings.rdb", "Feeder12_history.his"].map((n) => path.join(REPO, "sample_files", n));
  await page.setInputFiles("#pickFiles", pick);
  await page.waitForFunction(() => !window.__selApp.state.empty);
  const up = norm(await page.evaluate(() => window.__selApp.summaryText()));
  ok("uploaded files + comments match command-line report", up === pyOut([...pick, "--comments", "Crew patrol found a cracked insulator.\nSecond line."]));

  // 4) folder upload (webkitdirectory)
  await page.click("#clear");
  await page.fill("#comments", "");
  try {
    await page.setInputFiles("#pickFolder", path.join(REPO, "sample_files"));
    await page.waitForFunction(() => !window.__selApp.state.empty, null, { timeout: 5000 });
    const names = await page.evaluate(() => window.__selApp.state.files.map((f) => f.name));
    ok("folder upload skips README and matches command-line report", !names.includes("README.txt") &&
       norm(await page.evaluate(() => window.__selApp.summaryText())) === pyOut([path.join(REPO, "sample_files")]), names.length + " files");
  } catch (e) { ok("folder upload", false, e.message.split("\n")[0]); }

  // 4b) view options: filters, search, relay, sort, detail, CSV
  await page.selectOption("#vShow", "review");
  await page.waitForFunction(() => /Showing: \d+ of \d+ events \(needs review/.test(window.__selApp.summaryText()));
  const samples = path.join(REPO, "sample_files");
  ok("Show = Needs review matches command-line", norm(await page.evaluate(() => window.__selApp.summaryText())) ===
     norm(cliRaw([...UI_DEFAULTS, "--show", "review", samples])));
  ok("Show menu lists counts", /Needs review \(\d+\)/.test(await page.textContent("#vShow")));
  await page.selectOption("#vRelay", "FEEDER 12");
  await page.selectOption("#vSort", "newest");
  await page.selectOption("#vDetail", "full");
  await page.fill("#vSearch", "zone");
  await page.waitForFunction(() => window.__selApp.summaryText().includes('matching "zone"'));
  const viewArgs = ["--hide-duplicates", "--show", "review", "--relay", "FEEDER 12", "--sort", "newest", "--detail", "full", "--search", "zone"];
  ok("combined view matches command-line", norm(await page.evaluate(() => window.__selApp.summaryText())) === norm(cliRaw([...viewArgs, samples])));
  const [dCsv] = await Promise.all([page.waitForEvent("download"), page.evaluate(() => window.__selApp.exportAs("csv"))]);
  const csv = fs.readFileSync(await dCsv.path(), "utf8").replace(/^\ufeff/, "");
  ok("CSV export matches command-line", csv === cliRaw([...viewArgs, "--format", "csv", samples]), dCsv.suggestedFilename());
  await page.evaluate(() => { window.__confirmAsked = 0; window.confirm = () => { window.__confirmAsked++; return false; }; });
  await page.click("#out"); await page.keyboard.press("Control+End"); await page.keyboard.type(" edited");
  await page.selectOption("#vShow", "all");
  ok("view change after editing asks first and keeps edits when declined",
     (await page.evaluate(() => window.__confirmAsked)) === 1 && (await page.inputValue("#vShow")) === "review" &&
     (await page.evaluate(() => window.__selApp.summaryText())).endsWith(" edited"));
  await page.evaluate(() => { window.confirm = () => true; });
  await page.fill("#vSearch", ""); await page.selectOption("#vShow", "all"); await page.selectOption("#vRelay", "");
  await page.selectOption("#vSort", "time"); await page.selectOption("#vDetail", "standard");
  await page.waitForFunction(() => !/^Showing: \d+ of \d+ events \((needs|relay)/m.test(window.__selApp.summaryText()));

  // 5) edit the summary, then export txt + doc include the edit
  await page.click("#out");
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nEDITED BY HAND: confirmed with dispatch.");
  const [dTxt] = await Promise.all([page.waitForEvent("download"), page.evaluate(() => window.__selApp.exportAs("txt"))]);
  const txt = fs.readFileSync(await dTxt.path(), "utf8");
  ok("txt export includes hand edit", txt.includes("EDITED BY HAND") && txt.includes("\r\n"), dTxt.suggestedFilename());
  const [dDoc] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Control+s")]);
  const doc = fs.readFileSync(await dDoc.path()).toString("latin1");
  if (OUT) fs.writeFileSync(path.join(OUT, "web_export.docx"), fs.readFileSync(await dDoc.path()));
  ok("Word export via Ctrl+S: real .docx with tables, pictures and the edit", doc.startsWith("PK") && doc.includes("EDITED BY HAND") &&
     doc.includes("<w:tbl>") && doc.includes("word/media/image1.png") && dDoc.suggestedFilename().endsWith(".docx"), dDoc.suggestedFilename());

  // 6) PDF/print view
  await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
  await page.keyboard.press("Control+p");
  await page.waitForFunction(() => window.__printed === true, null, { timeout: 3000 }).catch(() => {});
  ok("Ctrl+P builds print view", await page.evaluate(() => window.__printed === true && document.getElementById("print-root").innerHTML.includes("Quick Summary")));
  await page.emulateMedia({ media: "print" });
  if (OUT) await page.pdf({ path: path.join(OUT, "web_print.pdf"), format: "Letter", printBackground: true });
  await page.emulateMedia({ media: "screen" });

  // 6b) event notes: typed in the list, shown in the summary
  await page.evaluate(() => { window.confirm = () => true; });
  await page.click("#generate");
  await page.waitForFunction(() => !window.__selApp.state.edited);
  await page.click("#notesPanel summary");
  const noteInput = page.locator("#evList input").first();
  await noteInput.fill("Crew found a burned crossarm"); await noteInput.press("Enter"); await noteInput.blur();
  await page.waitForFunction(() => window.__selApp.summaryText().includes("Notes       : Crew found a burned crossarm"), null, { timeout: 5000 }).catch(() => {});
  ok("event note appears in the summary", (await page.evaluate(() => window.__selApp.summaryText())).includes("Notes       : Crew found a burned crossarm"));

  // 6c) weather (Open-Meteo mocked): location per relay, lookup, hints in the summary
  await page.route("https://geocoding-api.open-meteo.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ results: [{ name: "Ocala", latitude: 29.19, longitude: -82.14, admin1: "Florida", country_code: "US" }] }) }));
  const wxRoute = (r) => { const d = /start_date=([\d-]+)/.exec(r.request().url())[1]; const time = [...Array(24).keys()].map((h) => `${d}T${String(h).padStart(2, "0")}:00`);
    r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ hourly: { time,
      temperature_2m: time.map(() => 75), precipitation: time.map(() => 0), snowfall: time.map(() => 0), weather_code: time.map((t, i) => (d === "2026-10-21" && i === 14 ? 95 : 1)),
      wind_speed_10m: time.map(() => 9), wind_gusts_10m: time.map(() => 14) } }) }); };
  await page.route("https://api.open-meteo.com/**", wxRoute);
  await page.route("https://archive-api.open-meteo.com/**", wxRoute);
  await page.click("#wxPanel summary");
  await page.check("#wxAll");
  await page.fill("#wxBulkText", "Ocala, FL");
  await page.click("#wxBulkApply");
  await page.waitForFunction(() => [...document.querySelectorAll("#wxRelays .st")].every((x) => x.textContent.includes("Ocala")), null, { timeout: 5000 }).catch(() => {});
  await page.click("#wxGo");
  await page.waitForFunction(() => /Weather found for \d+/.test(document.getElementById("wxStatus").textContent), null, { timeout: 8000 }).catch(() => {});
  const wxText = await page.evaluate(() => window.__selApp.summaryText());
  ok("weather lookup adds Weather lines and a thunderstorm hint", /Weather {5}: thunderstorm/.test(wxText) && wxText.includes("Weather: Thunderstorm in the area"),
     await page.textContent("#wxStatus"));
  await shot(page, "web_weather_light.png", { fullPage: true });

  // 6d) waveform analysis page
  await page.click("#tabWave");
  await page.waitForSelector("#pageWave:not([hidden])");
  const recs = await page.$$eval("#wRec option", (o) => o.map((x) => x.textContent));
  ok("waveform page lists CEV + COMTRADE records and 9 references", recs.filter((x) => /CEV|\.cev|COMTRADE/i.test(x)).length >= 5 && recs.length >= 14, recs.length + " records");
  await page.selectOption("#wRec", { label: "Normal load (no fault)" });
  const codes = [];
  for (let i = 0; i < 9; i++) { codes.push((await page.textContent("#wCode")).trim()); if (i < 8) await page.click("#wNext"); }
  ok("stepping through the reference library classifies each one", codes.join(" ") === "— AG BC BCG ABC AG INRUSH AG ABG", codes.join(" "));
  const ct = recs.find((x) => x.includes("COMTRADE"));
  await page.selectOption("#wRec", { label: ct });
  ok("COMTRADE record: fault type and 51G check", (await page.textContent("#wCode")).trim() === "CG" && /51G[\s\S]*Agrees/.test(await page.textContent("#wOC")));
  await page.click("#wNoteMode");
  const bb = await page.locator("#wOverlay").boundingBox();
  await page.mouse.click(bb.x + bb.width * 0.5, bb.y + 80);
  await page.fill("#wNoteText", "Arc restrikes here"); await page.click("#wNoteSave");
  ok("note pinned on the graph", (await page.locator("#wPins li input").count()) === 1);
  const spanMs = async () => parseInt(/\((\d+) ms of/.exec(await page.textContent("#wSpan"))[1], 10);
  const before = await spanMs();
  await page.mouse.move(bb.x + bb.width * 0.3, bb.y + 120); await page.mouse.down(); await page.mouse.move(bb.x + bb.width * 0.6, bb.y + 120, { steps: 4 }); await page.mouse.up();
  const after = await spanMs();
  ok("drag zooms in", after < before * 0.6, `${before} ms -> ${after} ms`);
  await page.click("#wAdv");
  ok("advanced view shows angles", (await page.textContent("#wPhTable")).includes("Angle"));
  const [dW] = await Promise.all([page.waitForEvent("download"), page.click("#wExportBtn").then(() => page.click('[data-wexp="docx"]'))]);
  const wdoc = fs.readFileSync(await dW.path()).toString("latin1");
  ok("waveform Word report has the graph, phasors and the note", wdoc.startsWith("PK") && wdoc.includes("Arc restrikes here") && wdoc.includes("word/media/image2.png"), dW.suggestedFilename());
  await shot(page, "web_wave_light.png", { fullPage: true });
  await page.click("#wSimple");
  await page.click("#tabSummary");

  // 7) feedback opens a prefilled GitHub issue
  await page.evaluate(() => { window.open = (u) => { window.__opened = u; }; window.confirm = () => true; });
  await page.fill("#feedback", "Event 3 was really a DTT.");
  await page.check("#attach");
  await page.click("#send");
  const fb = await page.evaluate(() => window.__opened || "");
  const q = new URL(fb).searchParams;
  ok("feedback opens prefilled issue", fb.startsWith("https://github.com/kefirman9000/sel-trip-analyzer/issues/new?") &&
     q.get("title") === "Feedback: Event 3 was really a DTT." && q.get("body").includes("<details>") && fb.length < 8200, fb.length + " chars");

  // 8) dark mode via switch, remembered after reload
  await page.click("#clear");
  await page.click("#samples");
  await page.waitForFunction(() => !window.__selApp.state.empty);
  await page.click("label.switch");
  await shot(page, "web_samples_dark.png");
  await page.reload();
  ok("dark mode remembered", (await page.getAttribute("html", "data-theme")) === "dark");

  // 9) help dialog
  await page.keyboard.press("F1");
  ok("F1 opens help", await page.isVisible("#help"));
  await shot(page, "web_help_dark.png");
  await page.keyboard.press("Escape");

  // 10) phone width: no horizontal scroll
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(url);
  await phone.click("#samples");
  await phone.waitForFunction(() => !window.__selApp.state.empty);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok("phone width has no horizontal scroll", overflow <= 0, "overflow " + overflow + "px");
  await shot(phone, "web_phone.png");
  await phone.click("#tabWave");
  await phone.waitForSelector("#pageWave:not([hidden])");
  const overflowW = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok("waveform page fits a phone", overflowW <= 0, "overflow " + overflowW + "px");
  await shot(phone, "web_phone_wave.png", { fullPage: true });

  ok("no page errors", errors.length === 0, errors.join(" | "));
  console.log(results.join("\n"));
  if (process.env.GITHUB_ACTIONS) for (const r of results.filter((x) => x.startsWith("FAIL"))) console.log("::error title=Browser test::" + r.replace(/\s+/g, " "));
  await browser.close();
  if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
})().catch((e) => { console.error(e); if (process.env.GITHUB_ACTIONS) console.log("::error title=Browser test crashed::" + String(e && e.message || e).split("\n").slice(0, 3).join(" ")); process.exit(1); });
