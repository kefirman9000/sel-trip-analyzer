/* Regenerate the README screenshots (dark mode) from the built page.
 *   python scripts/build_html.py && node scripts/screenshots.js [out-folder]
 * Needs Playwright with Chromium. Weather is faked so no network is needed. */
const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
const ROOT = path.resolve(__dirname, ".."), OUT = path.resolve(process.argv[2] || path.join(ROOT, "docs", "screenshots"));
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1.5, colorScheme: "dark" });
  await ctx.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "" }));
  await ctx.route("https://geocoding-api.open-meteo.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ results: [{ name: "Ocala", latitude: 29.19, longitude: -82.14, admin1: "Florida", country_code: "US" }] }) }));
  const wx = (r) => { const d = /start_date=([\d-]+)/.exec(r.request().url())[1]; const time = [...Array(24).keys()].map((h) => `${d}T${String(h).padStart(2, "0")}:00`);
    const storm = d === "2026-10-21";
    r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ hourly: { time,
      temperature_2m: time.map(() => 81), precipitation: time.map((t, i) => (storm && i >= 13 && i <= 15 ? 0.35 : 0)), snowfall: time.map(() => 0),
      weather_code: time.map((t, i) => (storm && i === 14 ? 95 : 2)), wind_speed_10m: time.map(() => 11), wind_gusts_10m: time.map((t, i) => (storm && i === 14 ? 46 : 17)) } }) }); };
  await ctx.route("https://api.open-meteo.com/**", wx);
  await ctx.route("https://archive-api.open-meteo.com/**", wx);
  const page = await ctx.newPage();
  await page.goto("file://" + path.join(ROOT, "dist", "SEL_Trip_Analyzer.html"));
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.click("#samples");
  await page.waitForFunction(() => !window.__selApp.state.empty);
  await page.screenshot({ path: path.join(OUT, "main.png") });

  // weather
  await page.click("#wxPanel summary");
  const locs = page.locator("#wxRelays input");
  for (let i = 0; i < await locs.count(); i++) { await locs.nth(i).fill("Ocala, FL"); await locs.nth(i).press("Enter"); }
  await page.waitForTimeout(400);
  await page.click("#wxGo");
  await page.waitForFunction(() => /Weather found/.test(document.getElementById("wxStatus").textContent));
  await page.evaluate(() => { const o = document.getElementById("out"); const i = o.innerText.indexOf("Event 5 of"); window.scrollTo(0, 0); });
  await page.locator("#wxPanel").screenshot({ path: path.join(OUT, "weather.png") });

  // waveform analysis: the COMTRADE record with a pinned note
  await page.click("#tabWave");
  const ct = (await page.$$eval("#wRec option", (o) => o.map((x) => x.textContent))).find((x) => x.includes("COMTRADE"));
  await page.selectOption("#wRec", { label: ct });
  await page.click("#wNoteMode");
  const bb = await page.locator("#wOverlay").boundingBox();
  await page.mouse.click(bb.x + bb.width * 0.72, bb.y + 60);
  await page.fill("#wNoteText", "51G times out on the U3 curve");
  await page.click("#wNoteSave");
  await page.mouse.move(bb.x + bb.width * 0.35, bb.y + 120);
  await page.setViewportSize({ width: 1360, height: 1180 });
  await page.screenshot({ path: path.join(OUT, "wave.png") });

  // reference library
  await page.selectOption("#wRec", { label: "CT saturation during a ground fault" });
  await page.screenshot({ path: path.join(OUT, "reference.png") });
  await browser.close();
  console.log("wrote screenshots to " + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
