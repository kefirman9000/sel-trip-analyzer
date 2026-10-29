/* End-to-end test of the built browser version (dist/Relay_Trip_Analyzer.html).
 *   python scripts/build_html.py && node tests/browser_test.js [screenshot-folder]
 * Needs Playwright with Chromium. */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const REPO = path.resolve(__dirname, ".."), OUT = process.argv[2] || null;
const url = "file://" + path.join(REPO, "dist/Relay_Trip_Analyzer.html");
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
    body: JSON.stringify({ tag_name: "v9.9.0", body: "notes", assets: [{ name: "Relay_Trip_Analyzer.html", browser_download_url: "https://example.invalid/new.html" }] }) }));
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
  ok("starts on the Events page with the events table filled", !(await page.isHidden("#pageEvents")) && (await page.locator("#evTable tbody tr").count()) >= 10);
  await page.click("#clear");
  await page.click("#tabSummary");
  await page.fill("#comments", "Crew patrol found a cracked insulator.\nSecond line.");
  const pick = ["Feeder12_AG_Zone1.cev", "Feeder12_settings.rdb", "Feeder12_history.his"].map((n) => path.join(REPO, "sample_files", n));
  await page.setInputFiles("#pickFiles", pick);
  await page.waitForFunction(() => !window.__selApp.state.empty);
  const up = norm(await page.evaluate(() => window.__selApp.summaryText()));
  ok("uploaded files + comments match command-line report", up === pyOut([...pick, "--comments", "Crew patrol found a cracked insulator.\nSecond line."]));

  // 4) folder upload (webkitdirectory)
  await page.click("#tabEvents");
  await page.click("#clear");
  await page.click("#tabSummary");
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
  await page.keyboard.press("Control+s");
  await page.waitForSelector("#expDlg[open]");
  ok("Ctrl+S opens the export options", (await page.locator("#expBody input[type=checkbox]").count()) >= 10);
  const [dDoc] = await Promise.all([page.waitForEvent("download"), page.click("#expGo")]);
  const doc = fs.readFileSync(await dDoc.path()).toString("latin1");
  if (OUT) fs.writeFileSync(path.join(OUT, "web_export.docx"), fs.readFileSync(await dDoc.path()));
  ok("Word export via Ctrl+S: real .docx with tables, pictures and the edit", doc.startsWith("PK") && doc.includes("EDITED BY HAND") &&
     doc.includes("<w:tbl>") && doc.includes("word/media/image1.png") && dDoc.suggestedFilename().endsWith(".docx"), dDoc.suggestedFilename());
  ok("export file is named after the relays and dates", /relays trip summary \d{4}-\d\d-\d\d to \d{4}-\d\d-\d\d \(\d+ events\)\.docx$/.test(dDoc.suggestedFilename()));

  // 5b) export options: leave out the CHECK lines and the pictures
  await page.click("#exportBtn"); await page.click('[data-exp="docx"]');
  await page.waitForSelector("#expDlg[open]");
  await page.uncheck('#expBody input[data-key="checks"]');
  await page.selectOption('#expBody select[data-key="pictures"]', "none");
  const [dOpt] = await Promise.all([page.waitForEvent("download"), page.click("#expGo")]);
  const optDoc = fs.readFileSync(await dOpt.path()).toString("latin1");
  ok("export options leave out CHECK lines and pictures", optDoc.includes("EDITED BY HAND") && !optDoc.includes("CHECK:") && !optDoc.includes("word/media/"));
  await page.click("#exportBtn"); await page.click('[data-exp="csv"]');
  await page.waitForSelector("#expDlg[open]");
  await page.click('#expBody legend button:has-text("none")');
  await page.check('#expBody input[data-key="col:Relay"]'); await page.check('#expBody input[data-key="col:Cause"]').catch(() => {});
  await page.check('#expBody input[data-key="col:Event type"]');
  const [dCols] = await Promise.all([page.waitForEvent("download"), page.click("#expGo")]);
  const colsHead = fs.readFileSync(await dCols.path(), "utf8").replace(/^\ufeff/, "").split("\r\n")[0];
  ok("CSV with chosen columns", colsHead === "Relay,Event type", colsHead);
  // put the defaults back for the rest of the test
  await page.evaluate(() => { localStorage.removeItem("sel-trip:exp.summary"); });

  // 6) PDF/print view
  await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
  await page.keyboard.press("Control+p");
  await page.waitForSelector("#expDlg[open]"); await page.click("#expGo");
  await page.waitForFunction(() => window.__printed === true, null, { timeout: 3000 }).catch(() => {});
  ok("Ctrl+P builds print view", await page.evaluate(() => window.__printed === true && document.getElementById("print-root").innerHTML.includes("Quick Summary")));
  await page.emulateMedia({ media: "print" });
  if (OUT) await page.pdf({ path: path.join(OUT, "web_print.pdf"), format: "Letter", printBackground: true });
  await page.emulateMedia({ media: "screen" });

  // 6b) event notes: typed in the list, shown in the summary
  await page.evaluate(() => { window.confirm = () => true; });
  await page.click("#generate");
  await page.waitForFunction(() => !window.__selApp.state.edited);
  await page.click("#tabEvents");
  const noteInput = page.locator("#evTable td.note input").first();
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
  await page.click("#stationsBtn");
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
  await page.click("#stClose");
  ok("events table shows the weather", (await page.locator("#evTable td.wx.storm").count()) >= 1);
  await page.click("#tabEvents");
  await page.selectOption("#evShow", "related");
  ok("events filter: two-ended or incident", (await page.locator("#evTable tbody tr").count()) === 5, String(await page.locator("#evTable tbody tr").count()));
  await page.selectOption("#evShow", "all");
  const f3 = page.locator("#evTable tbody tr", { hasText: "FEEDER 3" });
  ok("an .EVE event links to its COMTRADE record", (await f3.locator('button[data-act="wave"]').count()) === 1);
  await page.locator("#evTable tbody tr", { hasText: "LINE 5 HILL" }).last().locator('button[data-act="details"]').click();
  ok("Details jumps to the event in the summary", !(await page.isHidden("#pageSummary")) && /Showing event \d+ of \d+ in the summary/.test(await page.textContent("#status")));

  // 6c2) evidence: Why? lists what the conclusion rests on; Show on graph puts the cursor there
  await page.click("#tabEvents");
  const pott = page.locator("#evTable tbody tr[data-id]", { hasText: "PTRX" }).first();
  await pott.locator('button[data-act="why"]').click();
  const why = page.locator("#evTable tr.why").first();
  const whyText = await why.textContent();
  ok("Why? lists the trip equation, the tripping elements and breaker clearing", /TRCOMM = M2P OR Z2G/.test(whyText) && /PTRX .* asserted at 4\.50 cyc/.test(whyText) && /cleared 2\.75 cyc after the trip/.test(whyText), whyText.replace(/\s+/g, " ").slice(0, 160));
  await why.locator('button[data-act="goto"]', { hasText: "Show on graph" }).nth(1).click();
  await page.waitForSelector("#pageWave:not([hidden])");
  const focus = await page.evaluate(() => { const w = window.__selApp.wave().state; return { idx: w.cursor, rec: w.recKey, sel: [...w.digSel] }; });
  ok("Show on graph opens the record with the cursor on that moment", focus.idx === 72 && /^LINE 5\|/.test(focus.rec) && focus.sel.includes("PTRX") &&
     /Cursor on: PTRX/.test(await page.textContent("#status")), JSON.stringify(focus).slice(0, 120));
  await page.click("#tabEvents");
  await pott.locator('button[data-act="why"]').click();
  ok("Why? closes again", (await page.locator("#evTable tr.why").count()) === 0);
  const l22 = page.locator("#evTable tbody tr[data-id]", { hasText: "GND IOC1 OP" }).first();
  ok("another maker's COMTRADE shows as an event with its waveforms", /LINE 22/.test(await l22.textContent()) && (await l22.locator('button[data-act="wave"]').count()) === 1);
  await l22.locator('button[data-act="why"]').click();
  await page.locator("#evTable tr.why").first().locator('button[data-act="goto"]', { hasText: "Show on graph" }).nth(1).click();
  await page.waitForSelector("#pageWave:not([hidden])");
  const f22 = await page.evaluate(() => { const w = window.__selApp.wave().state; return { idx: w.cursor, rec: w.recKey }; });
  ok("Show on graph works for a COMTRADE event", f22.idx === 144 && f22.rec === "comtrade:Line22_other_maker.cfg", JSON.stringify(f22));
  await page.click("#tabEvents");
  await l22.locator('button[data-act="why"]').click();

  // 6c3) operation review (PRC-004): suggestion, misoperation with category and cause, summary section, review log
  const hill = page.locator("#evTable tbody tr[data-id]", { hasText: "via M1P @ 0.70" }).first();
  ok("trips show when the PRC-004 decision is due", /Review by 2027-02-19/.test(await hill.textContent()));
  await hill.locator('button[data-act="review"]').click();
  await page.waitForSelector("#rvDlg[open]");
  ok("review dialog suggests a starting point with its reason", /Starting point:.*M1P/.test(await page.textContent("#rvSug")) && /Decide by 2027-02-19/.test(await page.textContent("#rvDates")));
  ok("category and cause hidden until Misoperation is chosen", await page.isHidden("#rvCat"));
  await page.selectOption("#rvOutcome", "misop");
  await page.selectOption("#rvCat", "Unnecessary Trip - During Fault");
  await page.selectOption("#rvCause", "Incorrect Settings");
  await page.fill("#rvCauseFound", "2026-10-28");
  await page.fill("#rvWho", "J. Smith");
  await page.fill("#rvCap", "Reduce Z1 reach to 85%");
  ok("corrective action plan due 60 days after the cause was found", /Corrective action plan due 2026-12-27/.test(await page.textContent("#rvDates")));
  await page.click("#rvSave");
  ok("saved review shows on the event", /Misoperation/.test(await hill.textContent()) && (await hill.locator(".chip2.trip").count()) === 1);
  await page.selectOption("#evShow", "misop");
  ok("filter: misoperations", (await page.locator("#evTable tbody tr[data-id]").count()) === 1);
  await page.selectOption("#evShow", "unreviewed");
  const nUnrev = await page.locator("#evTable tbody tr[data-id]").count();
  ok("filter: trips not reviewed", nUnrev >= 8 && !(await page.locator("#evTable tbody tr[data-id]", { hasText: "via M1P @ 0.70" }).count()), String(nUnrev));
  await page.selectOption("#evShow", "all");
  const sumRv = await page.evaluate(() => window.__selApp.summaryText());
  ok("summary gets an OPERATION REVIEW section and a Review line", /OPERATION REVIEW \(NERC PRC-004\)/.test(sumRv) &&
     /LINE 5 HILL BC T 10\/22\/2026: Misoperation - Unnecessary Trip - During Fault; cause: Incorrect Settings; corrective action plan due 2026-12-27 \(J\. Smith/.test(sumRv) &&
     /Review {6}: not reviewed yet - decide by/.test(sumRv));
  await page.click("#tabSummary");
  await page.click("#exportBtn");
  const [dRv] = await Promise.all([page.waitForEvent("download"), page.click('[data-exp="review"]')]);
  const rvCsv = fs.readFileSync(await dRv.path(), "utf8").replace(/^\ufeff/, "").split("\r\n");
  ok("review log CSV: one row per trip with category, cause and due dates", rvCsv[0].startsWith("Date,Time,Relay,Station,Event type,What happened,Review,Category,Cause") &&
     rvCsv.some((l) => l.includes("LINE 5 HILL") && l.includes("Misoperation,Unnecessary Trip - During Fault,Incorrect Settings,J. Smith") && l.includes("2026-12-27")),
     dRv.suggestedFilename());
  await page.click("#tabEvents");
  await hill.locator('button[data-act="review"]').click();
  await page.click("#rvClear");
  ok("review can be cleared", /Review by/.test(await hill.textContent()) && !/OPERATION REVIEW/.test(await page.evaluate(() => window.__selApp.summaryText())));

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
  {
    const lay = await page.evaluate(() => { const st = window.__selApp.wave().state; return { box: st.lay.pinBoxes[0], panels: st.lay.panels.map((q) => [q.kind, q.y, q.h]) }; });
    const V = lay.panels.find((q) => q[0] === "V");
    await page.mouse.move(bb.x + lay.box.x + 8, bb.y + lay.box.y + 9); await page.mouse.down();
    await page.mouse.move(bb.x + lay.box.x + 60, bb.y + V[1] + 40, { steps: 6 }); await page.mouse.up();
    const saved = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("sel-trip:pins")))[0]);
    ok("a note can be dragged onto another graph", saved.length === 1 && saved[0].panel === "V", JSON.stringify(saved[0]));
    await page.click("#wNoteMode");
    await page.mouse.move(bb.x + bb.width * 0.2, bb.y + V[1] + 30); await page.mouse.down();
    await page.mouse.move(bb.x + bb.width * 0.4, bb.y + V[1] + 30, { steps: 4 }); await page.mouse.up();
    await page.fill("#wNoteText", "Voltage dip"); await page.click('.swatches label[title="Blue"]'); await page.selectOption("#wNoteLine", "panel");
    await page.click("#wNoteSave");
    const two = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("sel-trip:pins")))[0]);
    const span = two.find((x) => x.text === "Voltage dip");
    ok("drag in note mode marks a span, with colour and line options", span && span.t2 > span.t && span.color === "blue" && span.line === "panel" && span.panel === "V", JSON.stringify(span));
  }
  const spanMs = async () => parseInt(/\((\d+) ms of/.exec(await page.textContent("#wSpan"))[1], 10);
  const before = await spanMs();
  await page.mouse.move(bb.x + bb.width * 0.3, bb.y + 120); await page.mouse.down(); await page.mouse.move(bb.x + bb.width * 0.6, bb.y + 120, { steps: 4 }); await page.mouse.up();
  const after = await spanMs();
  ok("drag zooms in", after < before * 0.6, `${before} ms -> ${after} ms`);
  await page.click("#wAdv");
  ok("advanced view shows angles", (await page.textContent("#wPhTable")).includes("Angle"));
  await page.click("#wExportBtn"); await page.click('[data-wexp="docx"]');
  await page.waitForSelector("#expDlg[open]");
  const [dW] = await Promise.all([page.waitForEvent("download"), page.click("#expGo")]);
  const wdoc = fs.readFileSync(await dW.path()).toString("latin1");
  ok("waveform Word report has the graph, phasors and the note", wdoc.startsWith("PK") && wdoc.includes("Arc restrikes here") && wdoc.includes("word/media/image2.png"), dW.suggestedFilename());
  ok("file name includes the station location once it's set", dW.suggestedFilename().startsWith("FEEDER 3 (Ocala, Florida) 2026-10-21"), dW.suggestedFilename());
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
  await page.click("#tabEvents");
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

  // 9) watch a folder (File System Access): a stand-in folder handle; files appear, settle, then load
  const wp = await ctx.newPage();
  wp.on("pageerror", (e) => errors.push(e.message));
  await wp.goto(url);
  ok("Watch folder button offered in Chromium", await wp.isVisible("#watchBtn"));
  const b64 = (n) => fs.readFileSync(path.join(REPO, "sample_files", n)).toString("base64");
  await wp.evaluate(({ a, b }) => {
    const mk = (name, data, t) => { const bin = atob(data), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new File([u], name, { lastModified: t }); };
    window.__dir = new Map([["Feeder12_AG_Zone1.cev", mk("Feeder12_AG_Zone1.cev", a, 1000)], ["notes.docx", mk("notes.docx", a, 1000)]]);
    window.__mk = mk; window.__b = b;
    const fileH = (name) => ({ kind: "file", name, getFile: async () => window.__dir.get(name) });
    window.__handle = { kind: "directory", name: "Relay events", queryPermission: async () => "granted", requestPermission: async () => "granted",
      entries: async function* () { for (const name of [...window.__dir.keys()]) yield [name, fileH(name)]; } };
  }, { a: b64("Feeder12_AG_Zone1.cev"), b: b64("Line5_Hill_BC_Zone1.cev") });
  await wp.evaluate(() => window.__selWatch.startWatch(window.__handle));
  await wp.waitForFunction(() => window.__selApp.state.files.length === 1);
  ok("watching loads the folder's event files (and skips others)", /Watching Relay events/.test(await wp.textContent("#watchBar")) &&
     (await wp.evaluate(() => window.__selApp.state.files.map((f) => f.name).join())) === "Feeder12_AG_Zone1.cev");
  await wp.evaluate(() => window.__dir.set("Line5_Hill_BC_Zone1.cev", window.__mk("Line5_Hill_BC_Zone1.cev", window.__b, 2000)));
  await wp.evaluate(() => window.__selWatch.pollWatch(false));
  const waited = await wp.evaluate(() => window.__selApp.state.files.length);
  await wp.evaluate(() => window.__selWatch.pollWatch(false));
  await wp.waitForFunction(() => window.__selApp.state.files.length === 2, null, { timeout: 5000 }).catch(() => {});
  ok("a new file is picked up once it has stopped changing", waited === 1 && (await wp.evaluate(() => window.__selApp.state.files.length)) === 2 &&
     /1 new file picked up/.test(await wp.textContent("#watchBar")) && (await wp.locator("#evTable tbody tr[data-id]").count()) === 2);
  await wp.click("#watchStop");
  ok("Stop ends watching", await wp.isHidden("#watchBar") && (await wp.evaluate(() => window.__selWatch.state())) === null);
  await wp.close();

  ok("no page errors", errors.length === 0, errors.join(" | "));
  console.log(results.join("\n"));
  if (process.env.GITHUB_ACTIONS) for (const r of results.filter((x) => x.startsWith("FAIL"))) console.log("::error title=Browser test::" + r.replace(/\s+/g, " "));
  await browser.close();
  if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
})().catch((e) => { console.error(e); if (process.env.GITHUB_ACTIONS) console.log("::error title=Browser test crashed::" + String(e && e.message || e).split("\n").slice(0, 3).join(" ")); process.exit(1); });
