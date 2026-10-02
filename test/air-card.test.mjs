/**
 * Tests for wabit-air-card.
 *
 *   node test/air-card.test.mjs
 */
import { loadCards, harness } from "./dom-stub.mjs";

const T = loadCards(process.argv[2]);
const { eq, throws, done } = harness();

/* --------------------------------------------------------------- fixture */
/* Mirrors a real ESPHome air sensor: every reading on one device, with VOC and
   NOx sharing the `aqi` device class. */
const sensor = (id, value, dc, unit, precision) => [
  id,
  {
    state: String(value),
    attributes: { device_class: dc, unit_of_measurement: unit, state_class: "measurement" },
    _precision: precision,
  },
];

const OFFICE = Object.fromEntries([
  sensor("sensor.air_puck_v1_0_co2", 413, "carbon_dioxide", "ppm", 0),
  sensor("sensor.air_puck_v1_0_pm2_5", 1.89727973937988, "pm25", "μg/m³", 2),
  sensor("sensor.air_puck_v1_0_pm10", 2.73941874504089, "pm10", "μg/m³", 2),
  sensor("sensor.air_puck_v1_0_pm1_0", 1.15892851352692, "pm1", "μg/m³", 2),
  sensor("sensor.air_puck_v1_0_pm4_0", 2.45424818992615, "pm25", "μg/m³", 2),
  sensor("sensor.air_puck_v1_0_voc_index", 18, "aqi", "", 0),
  sensor("sensor.air_puck_v1_0_nox_index", 2, "aqi", "", 0),
  sensor("sensor.air_puck_v1_0_air_temperature", 27.8625946044922, "temperature", "°C", 1),
  sensor("sensor.air_puck_v1_0_air_humidity", 42.1805152893066, "humidity", "%", 1),
  sensor("sensor.air_puck_v1_0_air_pressure", 1007.26422119141, "atmospheric_pressure", "hPa", 1),
]);

const entities = {};
for (const id of Object.keys(OFFICE)) {
  entities[id] = {
    entity_id: id, device_id: "d_puck", platform: "esphome",
    display_precision: OFFICE[id]._precision,
  };
}
// Noise that must not be mistaken for an air reading.
entities["sensor.office_ap_rssi"] = { entity_id: "sensor.office_ap_rssi", device_id: "d_ap" };
entities["sensor.office_diag"] = {
  entity_id: "sensor.office_diag", device_id: "d_puck", entity_category: "diagnostic",
};

const hass = {
  themes: { darkMode: false },
  locale: { language: "en-GB" },
  areas: {
    office: { area_id: "office", name: "Office", aliases: ["study"] },
    hallway: { area_id: "hallway", name: "Hallway", aliases: [] },
  },
  devices: { d_puck: { area_id: "office" }, d_ap: { area_id: "office" } },
  entities,
  states: {
    ...OFFICE,
    "sensor.office_ap_rssi": { state: "-54", attributes: { device_class: "signal_strength" } },
    "sensor.office_diag": { state: "1", attributes: { device_class: "carbon_dioxide" } },
  },
  callService: () => {},
};

const mk = (cfg, over) => {
  const c = new T.WabitAirCard();
  c.setConfig(cfg || {});
  c.hass = over ? { ...hass, ...over } : hass;
  return c;
};
const chartOf = (card, key) => card._els.chartEls.find((h) => h.spec.key === key);

/* ------------------------------------------------------------- discovery */
const found = T.airSensorsInArea(hass, "office");
eq("every reading is matched", found.length, 10);
eq("in a sensible reading order", found.map((m) => m.key),
   ["co2", "pm25", "pm10", "pm1", "pm4", "voc", "nox",
    "temperature", "humidity", "pressure"]);
// VOC and NOx are both device_class `aqi`, so the name has to break the tie.
eq("VOC matched by name", found.find((m) => m.key === "voc").id,
   "sensor.air_puck_v1_0_voc_index");
eq("NOx matched by name", found.find((m) => m.key === "nox").id,
   "sensor.air_puck_v1_0_nox_index");
eq("PM1 does not swallow PM10", found.find((m) => m.key === "pm1").id,
   "sensor.air_puck_v1_0_pm1_0");
eq("a signal strength sensor is not air",
   found.some((m) => m.id === "sensor.office_ap_rssi"), false);
eq("a diagnostic sensor is skipped",
   found.some((m) => m.id === "sensor.office_diag"), false);
eq("an empty room finds nothing", T.airSensorsInArea(hass, "hallway"), []);
eq("each sensor is used once",
   new Set(found.map((m) => m.id)).size, found.length);

/* ------------------------------------------------------------- judgement */
eq("fresh air is good", T.airBand("co2", 413), "good");
eq("stuffy is fair", T.airBand("co2", 900), "fair");
eq("bad is poor", T.airBand("co2", 1500), "poor");
eq("on the boundary is still good", T.airBand("co2", 800), "good");
eq("just over is fair", T.airBand("co2", 800.1), "fair");
eq("particulates judged too", T.airBand("pm25", 40), "poor");
// Temperature, humidity and pressure are reported but never judged.
eq("temperature is not judged", T.airBand("temperature", 27.9), null);
eq("humidity is not judged", T.airBand("humidity", 42), null);
eq("pressure is not judged", T.airBand("pressure", 1007), null);
eq("a missing reading is not judged", T.airBand("co2", null), null);
eq("thresholds can be overridden",
   T.airBand("co2", 500, { ...T.AIR_THRESHOLDS, co2: [400, 450] }), "poor");

const verdict = T.airVerdict([
  { key: "co2", label: "CO₂", value: 413 },
  { key: "pm25", label: "PM2.5", value: 40 },
  { key: "voc", label: "VOC", value: 18 },
]);
eq("the worst reading sets the verdict", verdict.band, "poor");
eq("and is named as the reason", verdict.driver.label, "PM2.5");
eq("all clear is good",
   T.airVerdict([{ key: "co2", label: "CO₂", value: 413 }]).band, "good");
eq("nothing judgeable gives no verdict",
   T.airVerdict([{ key: "temperature", label: "T", value: 21 }]).band, null);

eq("precision comes from Home Assistant",
   T.airPrecision(hass, "sensor.air_puck_v1_0_co2", 413), 0);
eq("and from the value when it does not",
   T.airPrecision({ entities: {} }, "sensor.x", 1.234), 2);

/* ------------------------------------------------------- history buckets */
const H0 = Date.UTC(2026, 9, 1, 0, 0, 0);
const HR = 3600000;
const stamped = (vals) => vals.map(([h, v]) => ({ s: String(v), lu: (H0 + h * HR) / 1000 }));

eq("samples land in the right buckets",
   T.bucketSeries(stamped([[0, 10], [2, 20]]), H0, H0 + 4 * HR, 4),
   [10, 10, 20, 20]);
// A sensor only reports on change, so a quiet bucket is still reading.
eq("a quiet bucket holds the last reading",
   T.bucketSeries(stamped([[0, 5]]), H0, H0 + 3 * HR, 3), [5, 5, 5]);
eq("before the first reading there is a gap",
   T.bucketSeries(stamped([[2, 7]]), H0, H0 + 4 * HR, 4), [null, null, 7, 7]);
eq("samples in one bucket are averaged",
   T.bucketSeries(stamped([[0, 10], [0.5, 20]]), H0, H0 + HR, 1), [15]);
eq("readings outside the window are pulled to the edge",
   T.bucketSeries(stamped([[-5, 3]]), H0, H0 + 2 * HR, 2), [3, 3]);
eq("non-numeric states are dropped",
   T.bucketSeries([{ s: "unavailable", lu: H0 / 1000 }, { s: "4", lu: (H0 + HR) / 1000 }],
                  H0, H0 + 2 * HR, 2), [null, 4]);
eq("no history, no points", T.bucketSeries([], H0, H0 + HR, 3), [null, null, null]);
eq("and undefined is the same", T.bucketSeries(undefined, H0, H0 + HR, 2), [null, null]);
// Older fixtures and some integrations hand back values with no timestamps.
eq("without timestamps the samples are spread evenly",
   T.bucketSeries([{ s: "1" }, { s: "3" }], H0, H0 + HR, 3), [1, 1, 3]);
eq("ISO timestamps work too",
   T.bucketSeries([{ s: "9", last_changed: new Date(H0).toISOString() }], H0, H0 + HR, 2),
   [9, 9]);

/* ----------------------------------------------------------- chart maths */
eq("bounds follow the data", T.chartBounds([[2, 6]]), { min: 2, max: 6 });
eq("a fixed floor is honoured", T.chartBounds([[2, 6]], 0), { min: 0, max: 6 });
eq("a fixed ceiling is honoured", T.chartBounds([[2, 6]], 0, 500), { min: 0, max: 500 });
eq("but real data is never clipped off", T.chartBounds([[2, 900]], 0, 500), { min: 0, max: 900 });
eq("several series share one axis", T.chartBounds([[1, 2], [8, 9]]), { min: 1, max: 9 });
eq("gaps are ignored", T.chartBounds([[null, 4, null, 8]]), { min: 4, max: 8 });
// A flat series would divide by zero; it sits in the middle instead.
eq("a flat series still has a range", T.chartBounds([[7, 7]]), { min: 6.5, max: 7.5 });
eq("nothing to plot, no bounds", T.chartBounds([[null, null]]), null);

eq("a line across the box",
   T.linePath([0, 5, 10], { min: 0, max: 10 }, 100, 20), "M0.00,20.00 L50.00,10.00 L100.00,0.00");
eq("one point is not a line", T.linePath([5], { min: 0, max: 10 }, 100, 20), "");
// A gap must break the line rather than being drawn straight through.
eq("a gap breaks the line",
   T.linePath([0, null, 10], { min: 0, max: 10 }, 100, 20), "M0.00,20.00 M100.00,0.00");
eq("the fill closes to the baseline",
   T.areaPath([0, 10], { min: 0, max: 10 }, 100, 20),
   "M0.00,20.00 L0.00,20.00 L100.00,0.00 L100.00,20.00 Z");
eq("a gap splits the fill in two",
   T.areaPath([0, 10, null, 10, 0], { min: 0, max: 10 }, 100, 20).match(/Z/g).length, 2);

eq("extrema are found", T.seriesExtrema([3, 9, 1]), { min: 2, max: 1 });
eq("gaps do not count", T.seriesExtrema([null, 4]), { min: 1, max: 1 });
eq("no readings, no extrema", T.seriesExtrema([null, null]), null);

/* ---------------------------------------------------------- chart layout */
const charts = T.airChartsFor(found.map((m) => ({ ...m, value: 1, color: "#000" })));
eq("one chart per group", charts.map((c) => c.key),
   ["temperature", "humidity", "pm", "co2", "pressure", "voc", "nox"]);
// Half-width graphs pair up on a row: temperature beside humidity, CO2 beside
// pressure, VOC beside NOx, with the four-line PM chart spanning both columns.
eq("the pairs are half width",
   ["temperature", "humidity", "co2", "pressure", "voc", "nox"]
     .map((k) => chartOfSpec(charts, k).width),
   ["half", "half", "half", "half", "half", "half"]);
// The four particle sizes are only meaningful against each other.
eq("the particle sizes share a chart", chartOfSpec(charts, "pm").series.map((s) => s.key),
   ["pm1", "pm25", "pm4", "pm10"]);
eq("in ascending size", chartOfSpec(charts, "pm").series.map((s) => s.label),
   ["PM1.0", "PM2.5", "PM4.0", "PM10"]);
eq("the shared chart spans the card", chartOfSpec(charts, "pm").width, "full");
eq("and carries a legend", chartOfSpec(charts, "pm").legend, true);
eq("only the shared chart spans both columns",
   charts.filter((c) => c.width === "full").map((c) => c.key), ["pm"]);
eq("the index charts are pinned to 0-500",
   [chartOfSpec(charts, "voc").lower_bound, chartOfSpec(charts, "voc").upper_bound], [0, 500]);
function chartOfSpec(list, key) { return list.find((c) => c.key === key); }

const partial = T.airChartsFor([
  { key: "co2", label: "CO₂", icon: "i" }, { key: "pm25", label: "PM2.5", icon: "i" },
]);
eq("charts with no sensors are dropped", partial.map((c) => c.key), ["pm", "co2"]);
eq("a lone particle size still draws", chartOfSpec(partial, "pm").series.map((s) => s.key), ["pm25"]);

const odd = T.airChartsFor([{ key: "mystery", label: "Mystery", icon: "i" }]);
eq("a reading no chart claims gets its own", odd.map((c) => c.key), ["mystery"]);

/* ------------------------------------------------------------- rendering */
const card = mk({ area: "office" });
eq("titled after the room", card._els.title.textContent, "Office");
eq("verdict shown", card._els.verdict.classList.contains("hidden"), false);
eq("the air is good", card._els.verdictWord.textContent, "Air is good");
eq("and says why", card._els.verdictWhy.textContent, "Everything measured is within range.");
eq("seven charts", card._els.chartEls.length, 7);
eq("temperature leads", card._els.chartEls[0].spec.key, "temperature");

const pm = chartOf(card, "pm");
eq("four lines on the PM chart", pm.series.length, 4);
// These are the colours the dashboard's graph cards already use.
eq("each in its own colour", pm.series.map((s) => s.metric.color),
   ["#00bcd4", "#4caf50", "#ff9800", "#f44336"]);
eq("a thin line, so four of them stay readable",
   pm.series[0].line.getAttribute("stroke-width"), "1");
eq("the legend is shown", pm.legend.classList.contains("hidden"), false);
eq("naming every line", pm.series.map((s) => s.legendVal.textContent),
   ["1.16 μg/m³", "1.90 μg/m³", "2.45 μg/m³", "2.74 μg/m³"]);
eq("a shared chart has no single headline figure", pm.state.textContent, "");
eq("titled as a group", pm.spec.title, "Particulate matter");

const co2 = chartOf(card, "co2");
eq("CO₂ keeps its colour", co2.series[0].metric.color, "#9c27b0");
eq("and a thicker line", co2.series[0].line.getAttribute("stroke-width"), "2");
eq("with the live reading in the header",
   co2.state.children.map((c) => c.textContent), ["413", "ppm"]);
eq("no legend for a single line", co2.legend.classList.contains("hidden"), true);
eq("temperature keeps its colour",
   chartOf(card, "temperature").series[0].metric.color, "#e53935");
eq("humidity too", chartOf(card, "humidity").series[0].metric.color, "#1e88e5");
eq("each shows its own reading",
   chartOf(card, "humidity").state.children.map((c) => c.textContent), ["42.2", "%"]);
eq("pressure too", chartOf(card, "pressure").series[0].metric.color, "#2196f3");

const poor = mk({ area: "office" }, { states: { ...hass.states,
  "sensor.air_puck_v1_0_co2": { ...OFFICE["sensor.air_puck_v1_0_co2"], state: "1600" } } });
eq("poor air says so", poor._els.verdictWord.textContent, "Air is poor");
eq("naming the culprit", poor._els.verdictWhy.textContent, "CO₂ is the highest at 1600 ppm.");
// The verdict is the headline, but the chart that caused it is flagged too.
eq("the chart at fault is marked",
   chartOf(poor, "co2").bandDot.classList.contains("hidden"), false);
eq("a chart that is fine is not",
   chartOf(poor, "humidity").bandDot.classList.contains("hidden"), true);

/* --------------------------------------------------------------- history */
const now = Date.now();
const trace = (base, n) => Array.from({ length: n }, (_, i) => ({
  s: String(base + i), lu: (now - (n - i) * 600000) / 1000,
}));
let asked = null;
const histHass = {
  ...hass,
  callWS: (msg) => {
    asked = msg;
    return Promise.resolve({
      "sensor.air_puck_v1_0_co2": trace(400, 12),
      "sensor.air_puck_v1_0_pm2_5": trace(1, 12),
      "sensor.air_puck_v1_0_voc_index": trace(10, 12),
      "sensor.air_puck_v1_0_air_temperature": trace(20, 12),
      "sensor.air_puck_v1_0_air_humidity": trace(60, 12),
    });
  },
};
const live = new T.WabitAirCard();
live.setConfig({ area: "office", hours: 6 });
live.hass = histHass;
await new Promise((r) => setTimeout(r, 0));

eq("history is requested", asked.type, "history/history_during_period");
eq("for every sensor shown", asked.entity_ids.length, 10);
eq("over the configured window",
   Math.round((Date.parse(asked.end_time) - Date.parse(asked.start_time)) / 3600000), 6);
eq("attributes are not fetched", asked.no_attributes, true);

const liveCo2 = chartOf(live, "co2");
eq("the chart is drawn", liveCo2.plot.classList.contains("hidden"), false);
eq("with a line", liveCo2.series[0].line.getAttribute("d").startsWith("M"), true);
eq("and a fill under it", liveCo2.series[0].fill.getAttribute("d").endsWith("Z"), true);
eq("at the configured resolution", liveCo2.buckets, 36);
// lower_bound 0 on CO2 means the axis starts at zero, not at the lowest reading.
eq("the axis floor is labelled", liveCo2.axisMin.classList.contains("hidden"), false);
eq("at zero", liveCo2.axisMin.textContent, "0");
eq("the extremes are marked", liveCo2.extMax.classList.contains("hidden"), false);
eq("the peak is read off the data", liveCo2.extMax.textContent, "411");
// The top of this axis IS the peak, and the marker already prints it - two
// labels on the same spot is one too many.
eq("the axis ceiling is left to the marker",
   liveCo2.axisMax.classList.contains("hidden"), true);
// Pinned to 0-500, the VOC axis ceiling says something the data does not.
eq("a pinned ceiling is always worth saying",
   chartOf(live, "voc").axisMax.textContent, "500");
eq("and is shown", chartOf(live, "voc").axisMax.classList.contains("hidden"), false);
// VOC readings sit at the very bottom of a 0-500 axis, so the floor label and
// the lowest marker would be printed on top of each other.
eq("a floor the data is already sitting on is dropped",
   chartOf(live, "voc").axisMin.classList.contains("hidden"), true);
// A marker at the very edge would hang outside the plot.
eq("an edge marker is pulled inside", liveCo2.extMax.style.transform, "translate(-100%, -50%)");
eq("a sensor with no history is not drawn",
   chartOf(live, "pressure").plot.classList.contains("hidden"), true);

/* ------------------------------------------------- two readings, one chart */
/* Temperature runs 20-31 and humidity 60-71. On one axis the pair would span
   20-71 and each line would use a fifth of the height; on their own scales
   both fill it, which is the point of putting them together. */
const paired = new T.WabitAirCard();
paired.setConfig({ area: "office", hours: 6, layout: [["temperature", "humidity"]] });
paired.hass = histHass;
await new Promise((r) => setTimeout(r, 0));
const liveClimate = paired._els.chartEls[0];

eq("a layout can put two readings on one chart",
   liveClimate.series.map((s) => s.metric.key), ["temperature", "humidity"]);
eq("named after both", liveClimate.spec.title, "Temperature & Humidity");
eq("each line gets its own scale",
   liveClimate.series.map((s) => s.bounds), [{ min: 20, max: 31 }, { min: 60, max: 71 }]);
eq("so the chart has no single axis", liveClimate.bounds, null);
eq("and no shared axis label to mislead",
   liveClimate.axisMax.classList.contains("hidden"), true);
// Instead each line gets a side of its own: temperature left, humidity right.
eq("temperature is read down the left",
   liveClimate.series[0].axisMax.className.includes("left"), true);
eq("humidity down the right",
   liveClimate.series[1].axisMax.className.includes("right"), true);
eq("both axes are shown",
   liveClimate.series.map((s) => s.axisMax.classList.contains("hidden")), [false, false]);
eq("labelled with their own range",
   liveClimate.series.map((s) => [s.axisMin.textContent, s.axisMax.textContent]),
   [["20.0", "31.0"], ["60.0", "71.0"]]);
eq("and coloured to their line",
   liveClimate.series.map((s) => s.axisMax.style.getPropertyValue("--series")),
   ["#e53935", "#1e88e5"]);
eq("both lines reach the top of the box",
   liveClimate.series.map((s) => s.line.getAttribute("d").includes(",0.00")), [true, true]);
eq("and the bottom",
   liveClimate.series.map((s) => s.line.getAttribute("d").includes(",100.00")), [true, true]);
// Readings in the same unit still share one axis - that is the whole point of
// putting the particle sizes together.
eq("one unit, one axis",
   T.airChartsFor(found.map((m) => ({ ...m, unit: "x", value: 1 })),
                  [{ metrics: ["pm1", "pm25"] }])[0].independent, false);
eq("two units, two axes",
   T.airChartsFor(found.map((m) => ({ ...m, unit: m.key, value: 1 })),
                  [{ metrics: ["pm1", "co2"] }])[0].independent, true);

const liveCo2b = chartOf(paired, "co2");
eq("the rest of the readings are still drawn",
   paired._els.chartEls.map((h) => h.spec.key).slice(1),
   ["pm", "co2", "pressure", "voc", "nox"]);
eq("each on its own", liveCo2b.series.length, 1);

// The readout is where the real numbers live on a chart like this.
live._hover(liveClimate, 1);
eq("hover reads both units", liveClimate.series.map((s) => s.tipVal.textContent),
   ["31.0 °C", "71.0 %"]);
live._hover(liveClimate, null);

/* ----------------------------------------------------------------- hover */
live._hover(liveCo2, 1);
eq("hovering opens the readout", liveCo2.el.classList.contains("hovering"), true);
eq("showing the value under the cursor", liveCo2.series[0].tipVal.textContent, "411 ppm");
eq("and the time it was read", /^\d{1,2}:\d{2}/.test(liveCo2.tipTime.textContent), true);
eq("with a marker on the line", liveCo2.series[0].point.style.left, "100%");
eq("and a crosshair", liveCo2.cross.style.left, "100%");
// The exact bucket a sample lands in shifts with the millisecond the window
// was opened, so what matters is that moving left reads further back.
live._hover(liveCo2, 0.8);
const earlier = Number(liveCo2.series[0].tipVal.textContent.replace(" ppm", ""));
eq("moving across reads an earlier value", earlier >= 400 && earlier < 411, true);
// The trace only covers the last two hours of a six-hour window; the empty
// stretch before it has no line drawn, so there is nothing to read out either.
live._hover(liveCo2, 0.2);
eq("hovering before the data starts shows nothing",
   liveCo2.el.classList.contains("hovering"), false);
live._hover(liveCo2, null);
eq("leaving closes it", liveCo2.el.classList.contains("hovering"), false);

const livePm = chartOf(live, "pm");
live._hover(livePm, 1);
eq("a shared chart reads out every line",
   livePm.series.map((s) => s.tipVal.textContent),
   ["—", "12.00 μg/m³", "—", "—"]);
// Hovering the empty start of a series must not report a gap as a reading.
const blank = chartOf(live, "pressure");
live._hover(blank, 0.5);
eq("a chart with no history does not open", blank.el.classList.contains("hovering"), false);

/* The card has to survive history being unavailable - it is only decoration. */
const broken = new T.WabitAirCard();
broken.setConfig({ area: "office" });
broken.hass = { ...hass, callWS: () => Promise.reject(new Error("nope")) };
await new Promise((r) => setTimeout(r, 0));
eq("a failed history leaves the card standing", broken._els.chartEls.length, 7);
eq("the readings are still there", chartOf(broken, "co2").state.children[0].textContent, "413");
eq("just no graphs",
   broken._els.chartEls.every((h) => h.plot.classList.contains("hidden")), true);
eq("no websocket, no trouble", mk({ area: "office" })._els.chartEls.length, 7);

/* ---------------------------------------------------------------- config */
const picked = mk({ area: "office", metrics: ["co2", "pm25"] });
eq("metrics can be chosen", picked._els.chartEls.map((h) => h.spec.key), ["pm", "co2"]);
eq("and the PM chart shrinks to what is left",
   chartOf(picked, "pm").series.map((s) => s.metric.key), ["pm25"]);

const recoloured = mk({ area: "office", colors: { co2: "#123456" } });
eq("colours can be overridden", chartOf(recoloured, "co2").series[0].metric.color, "#123456");
eq("leaving the rest alone", chartOf(recoloured, "pm").series[0].metric.color, "#00bcd4");

const explicit = mk({ entities: ["sensor.air_puck_v1_0_co2", "sensor.air_puck_v1_0_voc_index"] });
eq("explicit sensors skip discovery", explicit._els.chartEls.map((h) => h.spec.key), ["co2", "voc"]);

eq("verdict can be hidden",
   mk({ area: "office", show_verdict: false })._els.verdict.classList.contains("hidden"), true);
eq("header can be hidden", mk({ area: "office", show_header: false })._els.title, undefined);
eq("graphs can be turned off",
   mk({ area: "office", show_graphs: false })._els.chartEls
     .every((h) => h.plot.classList.contains("hidden")), true);
// `show_sparklines` was the option name in 1.16.0; configs using it still work.
eq("the old option name still turns them off",
   mk({ area: "office", show_sparklines: false })._els.chartEls
     .every((h) => h.plot.classList.contains("hidden")), true);
eq("the panel behind each graph can be dropped",
   mk({ area: "office", show_chart_background: false })._els.charts.classList.contains("flat"),
   true);
eq("and is drawn by default",
   mk({ area: "office" })._els.charts.classList.contains("flat"), false);
eq("the legend can be hidden",
   chartOf(mk({ area: "office", show_legend: false }), "pm")
     .legend.classList.contains("hidden"), true);

eq("hours default to 12", mk({ area: "office" })._config.hours, 12);
eq("hours are honoured", mk({ area: "office", hours: 48 })._config.hours, 48);
eq("silly hours are clamped", mk({ area: "office", hours: 100000 })._config.hours, 168);
eq("nonsense hours fall back", mk({ area: "office", hours: "soon" })._config.hours, 12);
eq("six points an hour by default", mk({ area: "office" })._config.points_per_hour, 6);
eq("resolution is configurable",
   mk({ area: "office", points_per_hour: 30 })._config.points_per_hour, 30);
eq("and clamped", mk({ area: "office", points_per_hour: 999 })._config.points_per_hour, 60);

/* ---------------------------------------------------------------- layout */
const laid = mk({ area: "office", layout: [
  { metrics: ["co2", "pressure"], width: "full" },
  ["temperature", "humidity"],
  "voc",
] });
eq("the layout sets the order",
   laid._els.chartEls.slice(0, 3).map((h) => h.series.map((s) => s.metric.key)),
   [["co2", "pressure"], ["temperature", "humidity"], ["voc"]]);
eq("and the widths",
   laid._els.chartEls.slice(0, 3).map((h) => h.spec.width), ["full", "half", "half"]);
// Readings the layout leaves out are still drawn, so adding a sensor to the
// room does not quietly vanish behind an old layout.
// What the layout did not mention keeps its default grouping - the particle
// sizes stay on one chart rather than being split into four.
eq("everything else keeps its default grouping",
   laid._els.chartEls.slice(3).map((h) => h.spec.key), ["pm", "nox"]);
eq("a graph whose readings are all missing is skipped",
   mk({ area: "office", layout: [["co2"], ["pm25"]] })._els.chartEls[0].spec.key, "row0");

throws("the layout must be a list",
  () => new T.WabitAirCard().setConfig({ area: "x", layout: "co2" }),
  "must be a list of graphs");
throws("a graph needs readings",
  () => new T.WabitAirCard().setConfig({ area: "x", layout: [{ width: "full" }] }),
  "graph 1 needs a list of readings");
throws("and they have to be real ones",
  () => new T.WabitAirCard().setConfig({ area: "x", layout: [["co2", "smell"]] }),
  'graph 1 asks for "smell"');
throws("naming the ones that are",
  () => new T.WabitAirCard().setConfig({ area: "x", layout: [["smell"]] }), "pm25");
throws("width is half or full",
  () => new T.WabitAirCard().setConfig({ area: "x", layout: [{ metrics: ["co2"], width: "wide" }] }),
  "must be `half` or `full`");

/* --------------------------------------------------------- failure modes */
const empty = mk({ area: "hallway" });
eq("an empty room explains itself", empty._els.empty.textContent,
   "No air sensors found in Hallway.");
const unknown = mk({ area: "atlantis" });
eq("unknown area message", unknown._els.error.textContent, 'No area called "atlantis".');

const noReg = new T.WabitAirCard();
noReg.setConfig({ area: "office" });
noReg.hass = { ...hass, entities: undefined, areas: undefined };
eq("no registry message", noReg._els.error.textContent,
   "This Home Assistant build does not expose the area registry to cards.");

throws("area or entities required",
  () => new T.WabitAirCard().setConfig({}), "either `area` or `entities`");
throws("entities must be sensors",
  () => new T.WabitAirCard().setConfig({ entities: ["light.x"] }), "may only contain sensors");
throws("metrics must be a list",
  () => new T.WabitAirCard().setConfig({ area: "x", metrics: "co2" }), "must be a list");

/* --------------------------------------------------- rearranging a layout */
const L = [
  { metrics: ["temperature"], width: "half" },
  { metrics: ["humidity"], width: "half" },
  { metrics: ["co2"], width: "half" },
];
eq("a graph can move down", T.airMoveGraph(L, 0, 2).map((g) => g.metrics[0]),
   ["humidity", "co2", "temperature"]);
eq("and back up", T.airMoveGraph(L, 2, 0).map((g) => g.metrics[0]),
   ["co2", "temperature", "humidity"]);
eq("moving past the end stops at it", T.airMoveGraph(L, 0, 9).map((g) => g.metrics[0]),
   ["humidity", "co2", "temperature"]);
eq("and past the start", T.airMoveGraph(L, 2, -3).map((g) => g.metrics[0]),
   ["co2", "temperature", "humidity"]);
eq("moving nowhere changes nothing", T.airMoveGraph(L, 1, 1), L);
eq("the original is left alone", L.map((g) => g.metrics[0]),
   ["temperature", "humidity", "co2"]);

eq("a reading can join another graph",
   T.airMoveReading(L, 1, "humidity", 0).map((g) => g.metrics),
   [["temperature", "humidity"], ["co2"]]);
// The graph it came from is gone, not left behind as an empty box.
eq("and the graph it emptied goes with it", T.airMoveReading(L, 1, "humidity", 0).length, 2);
eq("dropping a reading on its own graph does nothing",
   T.airMoveReading(L, 1, "humidity", 1).map((g) => g.metrics),
   [["temperature"], ["humidity"], ["co2"]]);

const merged = T.airMoveReading(L, 1, "humidity", 0);
eq("a reading can be pulled back out",
   T.airSplitReading(merged, 0, "humidity").map((g) => g.metrics),
   [["temperature"], ["humidity"], ["co2"]]);
eq("the last reading cannot leave its graph",
   T.airSplitReading(L, 0, "temperature").map((g) => g.metrics),
   [["temperature"], ["humidity"], ["co2"]]);

eq("a graph can be widened", T.airSetWidth(L, 1, "full").map((g) => g.width),
   ["half", "full", "half"]);

// Saved YAML only spells out a width that is not the one it would get anyway.
eq("a layout is written the short way",
   T.airLayoutShorthand([
     { metrics: ["temperature"], width: "half" },
     { metrics: ["pm1", "pm25", "pm4", "pm10"], width: "full" },
     { metrics: ["co2"], width: "full" },
   ]),
   [["temperature"], ["pm1", "pm25", "pm4", "pm10"], { metrics: ["co2"], width: "full" }]);

/* ---------------------------------------------------------------- editor */
customElements.define("ha-form", class {});
const editor = (cfg) => {
  const ed = new T.WabitAirCardEditor();
  ed.setConfig(cfg);
  ed.hass = hass;
  return ed;
};
const fields = editor({ area: "office" })._form;
eq("every option is on the form",
   T.AIR_SCHEMA.map((f) => f.name).every((n) => n in fields.data), true);
eq("with the defaults filled in",
   [fields.data.hours, fields.data.points_per_hour], [12, 6]);
eq("graphs default to on", fields.data.show_graphs, true);
// A card saved under 1.16.0 used `show_sparklines`; it must still read back.
eq("the old option name still reads back",
   editor({ area: "office", show_sparklines: false })._form.data.show_graphs, false);
/* ----------------------------------------------------- the layout editor */
const fire = (el, type, ev) => (el._handlers[type] || []).forEach((fn) => fn(ev));
const dragEvent = () => ({
  preventDefault() {}, stopPropagation() {},
  dataTransfer: { setData() {} },
});
const led = (cfg) => {
  const e = new T.WabitAirCardEditor();
  e.setConfig(cfg || { area: "office" });
  e.hass = hass;
  return e;
};

const lay = led();
eq("a row per graph", lay._rows.length, 7);
eq("holding its readings", lay._rows.map((r) => r.graph.metrics),
   [["temperature"], ["humidity"], ["pm1", "pm25", "pm4", "pm10"],
    ["co2"], ["pressure"], ["voc"], ["nox"]]);
eq("every row can be dragged", lay._rows.every((r) => r.row.getAttribute("draggable") === "true"),
   true);
eq("and so can every reading in it",
   lay._rows[2].chips.children.every((c) => c.getAttribute("draggable") === "true"), true);
eq("the width is shown and togglable", lay._rows.map((r) => r.width.textContent),
   ["Half", "Half", "Full", "Half", "Half", "Half", "Half"]);
// A reading on its own has nowhere to split to, so it offers no way to.
eq("a lone reading cannot be split out",
   lay._rows[0].chips.children[0].className.includes("alone"), true);
eq("but one sharing a graph can",
   lay._rows[2].chips.children[0].className.includes("alone"), false);

// Drag the temperature graph down onto CO2.
const moved = led();
fire(moved._rows[0].row, "dragstart", dragEvent());
fire(moved._rows[3].row, "drop", dragEvent());
eq("dropping a graph puts it where it landed", moved._config.layout,
   [["humidity"], ["pm1", "pm25", "pm4", "pm10"], ["co2"], ["temperature"],
    ["pressure"], ["voc"], ["nox"]]);

// Drag the humidity reading onto the temperature graph.
const joined = led();
fire(joined._rows[1].chips.children[0], "dragstart", dragEvent());
fire(joined._rows[0].row, "drop", dragEvent());
eq("dropping a reading joins the two", joined._config.layout[0], ["temperature", "humidity"]);
eq("and the graph it left is gone", joined._config.layout.length, 6);
eq("the rows redraw to match", joined._rows[0].graph.metrics, ["temperature", "humidity"]);
// Which is exactly what the card then draws on one chart with two axes.
const asDrawn = mk({ area: "office", layout: joined._config.layout });
eq("and the card agrees", asDrawn._els.chartEls[0].series.map((x) => x.metric.key),
   ["temperature", "humidity"]);
eq("on two axes", asDrawn._els.chartEls[0].spec.independent, true);

const split = led();
fire(split._rows[1].chips.children[0], "dragstart", dragEvent());
fire(split._rows[0].row, "drop", dragEvent());
// The × on a chip is its last child, after the colour swatch and the name.
const humidityChip = split._rows[0].chips.children[1];
humidityChip.children[humidityChip.children.length - 1]._fire("click");
eq("splitting a reading back out undoes it", split._config.layout.slice(0, 2),
   [["temperature"], ["humidity"]]);

const wide = led();
wide._rows[0].width._fire("click");
eq("the width toggle writes it out", wide._config.layout[0],
   { metrics: ["temperature"], width: "full" });
eq("and the button follows", wide._rows[0].width.textContent, "Full");

const nudged = led();
nudged._rows[1].nudge.up._fire("click");
eq("the arrows move a graph too", nudged._config.layout.slice(0, 2),
   [["humidity"], ["temperature"]]);
nudged._rows[0].nudge.up._fire("click");
eq("and stop at the top", nudged._config.layout[0], ["humidity"]);

const reset = led({ area: "office", layout: [["co2"]] });
eq("a saved layout is what gets edited", reset._rows[0].graph.metrics, ["co2"]);
eq("with everything else still listed", reset._rows.length, 7);
reset._layoutEls.actions.children[0]._fire("click");
eq("reset clears it", reset._config.layout, undefined);

// A layout the card would refuse must not take the editor down with it.
const bad = led({ area: "office", layout: "nonsense" });
eq("a broken layout falls back to the default", bad._rows.length, 7);
const noArea = led({ area: "" });
eq("with no room there is nothing to arrange", noArea._rows, undefined);
eq("and it says so", noArea._layoutEls.note.textContent,
   "Pick a room first, then its readings can be arranged here.");

delete customElements._d["ha-form"];

eq("stub picks the room with sensors", T.WabitAirCard.getStubConfig(hass).area, "office");
eq("registered", !!customElements.get("wabit-air-card"), true);
eq("listed in the picker",
   window.customCards.some((c) => c.type === "wabit-air-card"), true);

done("air");
