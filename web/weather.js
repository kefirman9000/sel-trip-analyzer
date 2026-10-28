/* SEL Trip Event Analyzer - weather at the time of an event.
 *
 * Uses Open-Meteo (free, no account): the geocoding API to turn a town name into
 * coordinates, and the historical weather API (or the forecast API's recent past)
 * for the hourly weather around each event. Only the station location and the
 * event date are sent; the event files never leave the computer.
 *
 *   SELWeather.geocode("Ocala, FL") -> [{name, lat, lon, label}]
 *   SELWeather.lookup({lat, lon}, "2026-10-21", 14, {units}) -> {text, hints, hours, ...}
 *   SELWeather.assess(hours, eventHour, units) -> {text, hints}   (pure, testable)
 */
(function (root) {
"use strict";

const WMO = {
  0: "clear", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "heavy freezing drizzle",
  61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "heavy freezing rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "rain showers", 81: "heavy rain showers",
  82: "violent rain showers", 85: "snow showers", 86: "heavy snow showers", 95: "thunderstorm",
  96: "thunderstorm with hail", 99: "thunderstorm with heavy hail",
};
const HOURLY = "temperature_2m,precipitation,snowfall,weather_code,wind_speed_10m,wind_gusts_10m";
const pad = (n) => String(n).padStart(2, "0");

/** "10/21/2026" or core datetime -> {date: "2026-10-21", hour} */
function eventWhen(e, core) {
  const dt = core.eventDatetime(e);
  if (dt === null) return null;
  const d = new Date(dt / 1000);
  return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

/** Parse "lat, lon" typed by the user. */
function parseLatLon(text) {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text || "");
  if (!m) return null;
  const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` } : null;
}

async function getJson(url, fetchFn) {
  const r = await (fetchFn || fetch)(url);
  if (!r.ok) throw new Error(`weather service said ${r.status}`);
  return r.json();
}

async function geocode(text, fetchFn) {
  const ll = parseLatLon(text);
  if (ll) return [{ name: ll.label, lat: ll.lat, lon: ll.lon, label: ll.label }];
  // "Ocala, FL" -> search "Ocala", prefer results whose state/country matches what follows the comma
  const [name, ...rest] = String(text).split(",").map((x) => x.trim()).filter(Boolean);
  if (!name) return [];
  const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json`, fetchFn);
  let res = (j.results || []).map((r) => ({
    name: r.name, lat: r.latitude, lon: r.longitude, admin1: r.admin1 || "", country: r.country_code || r.country || "",
    label: [r.name, r.admin1, r.country_code || r.country].filter(Boolean).join(", "),
  }));
  const hint = rest.join(" ").toUpperCase();
  if (hint) {
    const STATES = { AL: "ALABAMA", AK: "ALASKA", AZ: "ARIZONA", AR: "ARKANSAS", CA: "CALIFORNIA", CO: "COLORADO", CT: "CONNECTICUT", DE: "DELAWARE",
      FL: "FLORIDA", GA: "GEORGIA", HI: "HAWAII", ID: "IDAHO", IL: "ILLINOIS", IN: "INDIANA", IA: "IOWA", KS: "KANSAS", KY: "KENTUCKY", LA: "LOUISIANA",
      ME: "MAINE", MD: "MARYLAND", MA: "MASSACHUSETTS", MI: "MICHIGAN", MN: "MINNESOTA", MS: "MISSISSIPPI", MO: "MISSOURI", MT: "MONTANA", NE: "NEBRASKA",
      NV: "NEVADA", NH: "NEW HAMPSHIRE", NJ: "NEW JERSEY", NM: "NEW MEXICO", NY: "NEW YORK", NC: "NORTH CAROLINA", ND: "NORTH DAKOTA", OH: "OHIO",
      OK: "OKLAHOMA", OR: "OREGON", PA: "PENNSYLVANIA", RI: "RHODE ISLAND", SC: "SOUTH CAROLINA", SD: "SOUTH DAKOTA", TN: "TENNESSEE", TX: "TEXAS",
      UT: "UTAH", VT: "VERMONT", VA: "VIRGINIA", WA: "WASHINGTON", WV: "WEST VIRGINIA", WI: "WISCONSIN", WY: "WYOMING" };
    const want = STATES[hint] || hint;
    const score = (r) => (r.admin1.toUpperCase() === want ? 2 : 0) + (r.country.toUpperCase() === hint || r.country.toUpperCase() === want ? 1 : 0);
    res = res.map((r, i) => [r, score(r), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).map((x) => x[0]);
  }
  return res;
}

function urlFor(loc, date, units, today) {
  const u = units === "metric" ? "" : "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch";
  // the archive lags a few days; recent dates come from the forecast API's past data
  const age = (Date.parse(today || new Date().toISOString().slice(0, 10)) - Date.parse(date)) / 86400000;
  const host = age <= 60 ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive";
  return `${host}?latitude=${loc.lat}&longitude=${loc.lon}&start_date=${date}&end_date=${date}&hourly=${HOURLY}&timezone=auto${u}`;
}

/** Turn the hours around the event into a one-line summary and cause hints. */
function assess(hours, hour, units) {
  const metric = units === "metric";
  const U = metric ? { t: "°C", w: "km/h", p: "mm" } : { t: "°F", w: "mph", p: "in" };
  const at = hours.find((h) => h.hour === hour) || hours[Math.min(hours.length - 1, hour)] || null;
  if (!at) return null;
  const near = hours.filter((h) => h.hour >= hour - 2 && h.hour <= hour + 1);
  const max = (k) => Math.max(...near.map((h) => (h[k] === null || h[k] === undefined ? -Infinity : h[k])));
  const sum = (k) => near.reduce((t, h) => t + (h[k] || 0), 0);
  const codes = near.map((h) => h.code).filter((c) => c !== null && c !== undefined);
  const worst = codes.length ? Math.max(...codes) : at.code;
  const gust = max("gust"), wind = max("wind"), precip = sum("precip"), snow = sum("snow");
  const tC = metric ? at.temp : ((at.temp - 32) * 5) / 9;
  const gustMph = metric ? gust / 1.609 : gust;
  const rainHeavy = metric ? precip >= 7.5 : precip >= 0.3;
  const parts = [WMO[worst] !== undefined ? WMO[worst] : "weather code " + worst];
  if (isFinite(at.temp)) parts.push(`${Math.round(at.temp)}${U.t}`);
  if (isFinite(wind)) parts.push(`wind ${Math.round(wind)} ${U.w}` + (isFinite(gust) && gust > wind + 3 ? `, gusts ${Math.round(gust)} ${U.w}` : ""));
  if (precip > 0) parts.push(`${metric ? precip.toFixed(1) : precip.toFixed(2)} ${U.p} rain/precip. over ${near.length} h`);
  if (snow > 0) parts.push(`${metric ? snow.toFixed(1) + " cm" : (snow / 2.54).toFixed(1) + " in"} snow`);
  const hints = [];
  if (worst >= 95) hints.push({ kind: "lightning", label: "thunderstorm", text: "Thunderstorm in the area at the time. Lightning is a likely cause; check the arresters and look for flashed insulators." });
  if (gustMph >= 40) hints.push({ kind: "wind", label: "high wind", text: `Gusts to ${Math.round(gust)} ${U.w}. Consider wind: conductor slap or galloping (phase-to-phase), or trees and limbs contacting the line.` });
  else if (gustMph >= 30) hints.push({ kind: "wind", label: "wind", text: `Gusty (${Math.round(gust)} ${U.w}). Tree or limb contact is possible.` });
  if ([56, 57, 66, 67].includes(worst) || (snow > 0 && tC <= 1)) hints.push({ kind: "ice", label: "ice/snow", text: "Freezing precipitation or snow: ice or snow loading, sagging or galloping conductors, and tree limbs breaking under the weight." });
  if (rainHeavy && worst < 95) hints.push({ kind: "rain", label: "heavy rain", text: "Heavy rain: possible flashover across dirty or cracked insulators, or wet trees contacting the line." });
  if (isFinite(tC) && tC >= 35) hints.push({ kind: "heat", label: "heat", text: "Very hot: high load and conductor sag (tree contact), and equipment running hot." });
  if (!hints.length) hints.push({ kind: "calm", label: "calm", text: "No severe weather at the time, so weather is an unlikely cause." });
  return { text: `${parts.join(", ")} (hour of ${pad(hour)}:00 local)`, hints, at, near };
}

function hoursFrom(j) {
  const h = j.hourly || {};
  return (h.time || []).map((t, i) => ({
    hour: parseInt(t.slice(11, 13), 10), temp: h.temperature_2m ? h.temperature_2m[i] : null, precip: h.precipitation ? h.precipitation[i] : null,
    snow: h.snowfall ? h.snowfall[i] : null, code: h.weather_code ? h.weather_code[i] : null,
    wind: h.wind_speed_10m ? h.wind_speed_10m[i] : null, gust: h.wind_gusts_10m ? h.wind_gusts_10m[i] : null,
  }));
}

/** Weather for one location and date (cache: an object kept by the caller). */
async function lookup(loc, date, hour, opts) {
  opts = opts || {};
  const units = opts.units || "us";
  const key = `${loc.lat.toFixed(3)},${loc.lon.toFixed(3)},${date},${units}`;
  let hours = opts.cache && opts.cache[key];
  if (!hours) {
    const j = await getJson(urlFor(loc, date, units, opts.today), opts.fetch);
    hours = hoursFrom(j);
    if (!hours.length) throw new Error("no weather data for that date");
    if (opts.cache) opts.cache[key] = hours;
  }
  const a = assess(hours, hour, units);
  if (!a) throw new Error("no weather data for that hour");
  return Object.assign({ source: "Open-Meteo", location: loc.label || "" }, a);
}

const api = { geocode, lookup, assess, parseLatLon, eventWhen, urlFor, hoursFrom, WMO };
if (typeof module !== "undefined" && module.exports) module.exports = api;
else root.SELWeather = api;
})(typeof window !== "undefined" ? window : globalThis);
