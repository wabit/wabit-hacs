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
   ["pm", "co2", "pressure", "temperature", "humidity", "voc", "nox"]);
// The four particle sizes are only meaningful against each other.
eq("the particle sizes share a chart", chartOfSpec(charts, "pm").series.map((s) => s.key),
   ["pm1", "pm25", "pm4", "pm10"]);
eq("in ascending size", chartOfSpec(charts, "pm").series.map((s) => s.label),
   ["PM1.0", "PM2.5", "PM4.0", "PM10"]);
eq("the shared chart spans the card", chartOfSpec(charts, "pm").width, "full");
eq("and carries a legend", chartOfSpec(charts, "pm").legend, true);
eq("CO₂ gets the full width too", chartOfSpec(charts, "co2").width, "full");
eq("temperature only needs half", chartOfSpec(charts, "temperature").width, "half");
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
eq("temperature keeps its colour", chartOf(card, "temperature").series[0].metric.color, "#e53935");
eq("humidity too", chartOf(card, "humidity").series[0].metric.color, "#1e88e5");
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
   chartOf(live, "humidity").plot.classList.contains("hidden"), true);

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
const blank = chartOf(live, "humidity");
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
delete customElements._d["ha-form"];

eq("stub picks the room with sensors", T.WabitAirCard.getStubConfig(hass).area, "office");
eq("registered", !!customElements.get("wabit-air-card"), true);
eq("listed in the picker",
   window.customCards.some((c) => c.type === "wabit-air-card"), true);

done("air");
