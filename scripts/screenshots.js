/* Regenerate the README screenshots (dark mode) from the built page.
 *   python scripts/build_html.py && node scripts/screenshots.js [out-folder]
 * Needs Playwright with Chromium (and the Inter font for the same look as the README).
 * Weather is faked so no network is needed.
 *
 *   main.png        the Events page: at-a-glance cards and the events table with weather and notes
 *   summary.png     the written trip summary
 *   connections.png two-ended event and incident in the summary
 *   wave.png        Waveform analysis: graphs with a pinned note and the hover readout, phasors
 *   checks.png      overcurrent elements vs. settings, sequence components, harmonics
 *   elements.png    every relay element in plain English (Advanced view)
 *   reference.png   the reference library (CT saturation)
 *   weather.png     the Stations & weather window
 *   export.png      the export options dialog
 *   history.png     the History tab: overview of two years of made-up events at five stations
 *   history-location.png  one location on the History tab: recurring issue, fault hot spot along the line, breaker
 */
const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
const ROOT = path.resolve(__dirname, ".."), OUT = path.resolve(process.argv[2] || path.join(ROOT, "docs", "screenshots"));
fs.mkdirSync(OUT, { recursive: true });
const W = 1360;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1.5, colorScheme: "dark" });
  await ctx.route("https://api.github.com/**", (r) => r.fulfill({ status: 404, body: "" }));
  await ctx.route("https://geocoding-api.open-meteo.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ results: [{ name: "Ocala", latitude: 29.19, longitude: -82.14, admin1: "Florida", country_code: "US" }] }) }));
  const wx = (r) => {
    const d = /start_date=([\d-]+)/.exec(r.request().url())[1];
    const time = [...Array(24).keys()].map((h) => `${d}T${String(h).padStart(2, "0")}:00`);
    const storm = d === "2026-10-21", windy = d === "2026-10-22";
    r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ hourly: { time,
      temperature_2m: time.map(() => (storm ? 81 : 68)), precipitation: time.map((t, i) => (storm && i >= 13 && i <= 15 ? 0.35 : 0)), snowfall: time.map(() => 0),
      weather_code: time.map((t, i) => (storm && i === 14 ? 95 : windy ? 3 : 1)), wind_speed_10m: time.map(() => (windy ? 24 : 9)),
      wind_gusts_10m: time.map((t, i) => (storm && i === 14 ? 46 : windy ? 44 : 15)) } }) });
  };
  await ctx.route("https://api.open-meteo.com/**", wx);
  await ctx.route("https://archive-api.open-meteo.com/**", wx);

  const page = await ctx.newPage();
  await page.goto("file://" + path.join(ROOT, "dist", "SEL_Trip_Analyzer.html"));
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  const shot = (name, opts) => page.screenshot(Object.assign({ path: path.join(OUT, name) }, opts || {}));
  const clipOf = async (sel, pad, maxH) => {
    const b = await page.locator(sel).first().boundingBox();
    b.y += await page.evaluate(() => window.scrollY);        // page coordinates (all clips use fullPage)
    pad = pad === undefined ? 12 : pad;
    return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(W, b.width + 2 * pad), height: Math.min(maxH || 5000, b.height + 2 * pad) };
  };

  // --- load the samples, set the stations, look up the weather, add notes
  await page.click("#samples");
  await page.waitForFunction(() => !window.__selApp.state.empty);
  await page.click("#stationsBtn");
  await page.check("#wxAll");
  await page.fill("#wxBulkText", "Ocala, FL");
  await page.click("#wxBulkApply");
  await page.waitForFunction(() => /Set \d+ relays/.test(document.getElementById("wxStatus").textContent));
  await page.click("#wxGo");
  await page.waitForFunction(() => /Weather found/.test(document.getElementById("wxStatus").textContent));
  await page.setViewportSize({ width: W, height: 1000 });
  await shot("weather.png", { clip: await clipOf("#stDlg", 16) });
  await page.click("#stClose");
  const notes = { "FEEDER 3": "Crew found a flashed insulator at pole 214", "LINE 5 HILL": "Both ends agree: fault near Hill Sub" };
  for (const [relay, text] of Object.entries(notes)) {
    const row = page.locator("#evTable tbody tr", { has: page.locator("td.relay b", { hasText: new RegExp(`^${relay}$`) }) }).first();
    await row.locator("td.note input").fill(text); await row.locator("td.note input").press("Enter");
  }
  await page.waitForTimeout(300);

  // --- the main screen: the Events page
  await page.setViewportSize({ width: W, height: 1300 });
  await page.evaluate(() => { document.activeElement.blur(); document.querySelector(".evt-wrap").scrollTop = 0; window.scrollTo(0, 0); });
  await shot("main.png");

  // --- the Summary page
  await page.click("#tabSummary");
  await page.fill("#comments", "Storm on 10/21: crews patrolling Feeder 3 and Feeder 8. Line 5 relays checked by protection.");
  await page.click("#generate");
  await page.waitForFunction(() => window.__selApp.summaryText().includes("Storm on 10/21"));
  await page.setViewportSize({ width: W, height: 1100 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("summary.png");

  // summary: two-ended + incident + an event with weather and a note
  const region = await page.evaluate(() => {
    const out = document.getElementById("out"), text = out.innerText;
    const r = document.createRange(), walker = document.createTreeWalker(out, NodeFilter.SHOW_TEXT);
    const find = (needle) => {
      let acc = 0, n;
      const at = text.indexOf(needle);
      walker.currentNode = out;
      while ((n = walker.nextNode())) {
        if (acc + n.length > at) { r.setStart(n, at - acc); r.setEnd(n, Math.min(n.length, at - acc + 1)); const b = r.getBoundingClientRect(); return b.top + window.scrollY; }
        acc += n.length;
      }
      return null;
    };
    const ob = out.getBoundingClientRect();
    return { top: find("TWO-ENDED EVENTS"), bottom: find("REPEAT TRIPS"), x: ob.left + window.scrollX, w: ob.width };
  });
  await shot("connections.png", { fullPage: true, clip: { x: region.x - 2, y: region.top - 18, width: region.w + 4, height: Math.min(900, region.bottom - region.top + 8) } });

  // --- export dialog
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.setViewportSize({ width: W, height: 900 });
  await page.click("#exportBtn"); await page.click('[data-exp="docx"]');
  await page.waitForSelector("#expDlg[open]");
  await shot("export.png", { fullPage: true, clip: await clipOf("#expDlg", 16) });
  await page.click("#expCancel");

  // --- waveform analysis
  await page.click("#tabWave");
  await page.setViewportSize({ width: W, height: 1180 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const ct = (await page.$$eval("#wRec option", (o) => o.map((x) => x.textContent))).find((x) => x.includes("COMTRADE"));
  await page.selectOption("#wRec", { label: ct });
  await page.click("#wNoteMode");
  let bb = await page.locator("#wOverlay").boundingBox();
  await page.mouse.click(bb.x + bb.width * 0.73, bb.y + 60);
  await page.fill("#wNoteText", "51G times out on the U3 curve");
  await page.click("#wNoteSave");
  {
    const lay = await page.evaluate(() => window.__selApp.wave().state.lay.panels.map((q) => [q.kind, q.y, q.h]));
    const V = lay.find((q) => q[0] === "V"), D = lay.find((q) => q[0] === "D");
    await page.click("#wNoteMode");
    await page.mouse.click(bb.x + bb.width * 0.2, bb.y + V[1] + 18);
    await page.fill("#wNoteText", "VC sags to 37%");
    await page.click('.swatches label[title="Red"]'); await page.selectOption("#wNoteLine", "panel");
    await page.click("#wNoteSave");
    await page.click("#wNoteMode");
    await page.mouse.move(bb.x + bb.width * 0.13, bb.y + D[1] + 70); await page.mouse.down();
    await page.mouse.move(bb.x + bb.width * 0.69, bb.y + D[1] + 70, { steps: 5 }); await page.mouse.up();
    await page.fill("#wNoteText", "51G timing");
    await page.click('.swatches label[title="Blue"]'); await page.selectOption("#wNoteLine", "panel");
    await page.click("#wNoteSave");
  }
  await page.setViewportSize({ width: W, height: 1180 });
  bb = await page.locator("#wOverlay").boundingBox();
  await page.mouse.move(bb.x + bb.width * 0.36, bb.y + 110);
  await shot("wave.png");

  // settings check, sequence and harmonics (simple view: plain-English meanings)
  await page.mouse.move(5, 5);
  await page.evaluate(() => document.querySelector(".wv-lower").scrollIntoView());
  const oc = await clipOf(".wv-lower .card", 0);
  const side = await clipOf(".wv-side .card:nth-child(3)", 0);
  const x0 = oc.x - 12, y0 = Math.min(oc.y, side.y) - 12;
  await shot("checks.png", { fullPage: true, clip: { x: x0, y: y0, width: W - 2 * x0, height: Math.max(oc.y + oc.height, side.y + side.height) - y0 + 12 } });
  await page.click("#wAdv");
  await shot("elements.png", { fullPage: true, clip: await clipOf(".wv-els", 12, 700) });
  await page.click("#wSimple");

  // reference library
  await page.selectOption("#wRec", { label: "CT saturation during a ground fault" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(5, 5);
  await shot("reference.png");

  // History tab: the two-year sample history, with customer counts and one review
  await page.setViewportSize({ width: W, height: 900 });
  await page.evaluate(() => window.__selApp.showPage("history"));
  await page.evaluate(async () => { const h = window.__selApp.history(); await h.ready; h.state.cfg.autoWeather = false; });
  await page.click("#hx-samples");
  await page.waitForFunction(() => window.__selApp.history().state.records.length > 80, null, { timeout: 60000 });
  await page.evaluate(async () => {
    const h = window.__selApp.history();
    Object.assign(h.state.customers, { "FEEDER 12": 1850, "FEEDER 8": 2400, "FEEDER 11": 3100, "FEEDER 9": 900, "FEEDER 7": 1500, "FEEDER 3": 1200, "FEEDER 14": 1100 });
    await h.refresh();
    h.go("overview");
    document.getElementById("hx-toast").hidden = true;
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(5, 5);
  await shot("history.png", { fullPage: true, clip: await clipOf("#pageHistory", 0, 1500) });
  await page.evaluate(() => { const h = window.__selApp.history(); h.go("locations", { relay: "FEEDER 12" }); document.getElementById("hx-toast").hidden = true; });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("history-location.png", { fullPage: true, clip: await clipOf("#pageHistory .loc-layout", 0, 1700) });

  await browser.close();
  console.log("wrote screenshots to " + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
