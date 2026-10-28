/* End-to-end test of the built browser version (dist/SEL_Trip_Analyzer.html).
 *   python scripts/build_html.py && node tests/browser_test.js [screenshot-folder]
 * Needs Playwright with Chromium. */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const REPO = path.resolve(__dirname, ".."), OUT = process.argv[2] || null;
const url = "file://" + path.join(REPO, "dist/SEL_Trip_Analyzer.html");
// reference output: the same core run from the command line (Python parity is checked by tests/test_web_parity.py)
const pyOut = (args) => {
  const ci = args.indexOf("--comments");
  const extra = ci >= 0 ? ["--comments", args[ci + 1]] : [];
  const paths = ci >= 0 ? args.slice(0, ci).concat(args.slice(ci + 2)) : args;
  return execFileSync(process.execPath, [path.join(REPO, "web", "cli.js"), "--now", "X", ...extra, ...paths], { encoding: "utf8" }).trimEnd();
};
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

  // 5) edit the summary, then export txt + doc include the edit
  await page.click("#out");
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nEDITED BY HAND: confirmed with dispatch.");
  const [dTxt] = await Promise.all([page.waitForEvent("download"), page.evaluate(() => window.__selApp.exportAs("txt"))]);
  const txt = fs.readFileSync(await dTxt.path(), "utf8");
  ok("txt export includes hand edit", txt.includes("EDITED BY HAND") && txt.includes("\r\n"), dTxt.suggestedFilename());
  const [dDoc] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Control+s")]);
  const doc = fs.readFileSync(await dDoc.path(), "utf8");
  if (OUT) fs.writeFileSync(path.join(OUT, "web_export.doc.html"), doc);
  ok("Word export via Ctrl+S, formatted + edit", doc.includes("urn:schemas-microsoft-com:office:word") && doc.includes("EDITED BY HAND") && doc.includes("<table"), dDoc.suggestedFilename());

  // 6) PDF/print view
  await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
  await page.keyboard.press("Control+p");
  await page.waitForFunction(() => window.__printed === true, null, { timeout: 3000 }).catch(() => {});
  ok("Ctrl+P builds print view", await page.evaluate(() => window.__printed === true && document.getElementById("print-root").innerHTML.includes("Quick Summary")));
  await page.emulateMedia({ media: "print" });
  if (OUT) await page.pdf({ path: path.join(OUT, "web_print.pdf"), format: "Letter", printBackground: true });
  await page.emulateMedia({ media: "screen" });

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

  ok("no page errors", errors.length === 0, errors.join(" | "));
  console.log(results.join("\n"));
  await browser.close();
  if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
