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

const mk = (cfg) => {
  const c = new T.WabitAirCard();
  c.setConfig(cfg || {});
  c.hass = hass;
  return c;
};

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

/* ------------------------------------------------------------ sparklines */
eq("a path across readings",
   T.sparklinePath([0, 5, 10], 100, 20), "M0.00,20.00 L50.00,10.00 L100.00,0.00");
eq("one reading is not a line", T.sparklinePath([5], 100, 20), null);
eq("no readings, no line", T.sparklinePath([], 100, 20), null);
// A flat series would divide by zero; it should sit in the middle instead.
const flat = T.sparklinePath([7, 7, 7], 100, 20);
eq("a flat series still draws", flat, "M0.00,10.00 L50.00,10.00 L100.00,10.00");
eq("rubbish is filtered out",
   T.sparklinePath([1, NaN, 2], 100, 20), "M0.00,20.00 L100.00,0.00");

eq("precision comes from Home Assistant",
   T.airPrecision(hass, "sensor.air_puck_v1_0_co2", 413), 0);
eq("and from the value when it does not",
   T.airPrecision({ entities: {} }, "sensor.x", 1.234), 2);

/* ------------------------------------------------------------- rendering */
const card = mk({ area: "office" });
eq("titled after the room", card._els.title.textContent, "Office");
eq("verdict shown", card._els.verdict.classList.contains("hidden"), false);
eq("the air is good", card._els.verdictWord.textContent, "Air is good");
eq("and says why", card._els.verdictWhy.textContent, "Everything measured is within range.");
eq("a tile per reading", card._els.tiles.length, 10);
eq("labels", card._els.tiles.slice(0, 3).map((t) => t.tile.children[0].children[1].textContent),
   ["CO₂", "PM2.5", "PM10"]);
// Precision follows what Home Assistant suggests, not the raw float.
eq("CO₂ rounded to a whole number",
   card._els.tiles[0].value.children[0].textContent, "413");
eq("PM2.5 to two places", card._els.tiles[1].value.children[0].textContent, "1.90");
eq("units shown", card._els.tiles[0].value.children[1].textContent, "ppm");
// Labels share a third of the card width. Eight characters fit; "Temperature" did not.
eq("every label fits its tile",
   card._els.tiles.map((t) => t.tile.children[0].children[1].textContent)
     .filter((l) => l.length > 8), []);
eq("a judged tile is marked", card._els.tiles[0].tile.classList.contains("judged"), true);
eq("an unjudged tile is not",
   card._els.tiles.find((t) => t.metric.key === "temperature").tile.classList.contains("judged"),
   false);

const poor = new T.WabitAirCard();
poor.setConfig({ area: "office" });
poor.hass = { ...hass, states: { ...hass.states,
  "sensor.air_puck_v1_0_co2": { ...OFFICE["sensor.air_puck_v1_0_co2"], state: "1600" } } };
eq("poor air says so", poor._els.verdictWord.textContent, "Air is poor");
eq("naming the culprit", poor._els.verdictWhy.textContent, "CO₂ is the highest at 1600 ppm.");

/* ---------------------------------------------------------------- config */
const picked = mk({ area: "office", metrics: ["co2", "pm25"] });
eq("metrics can be chosen", picked._els.tiles.length, 2);
eq("and ordered", picked._els.tiles.map((t) => t.metric.key), ["co2", "pm25"]);
eq("verdict still considers them", picked._els.verdictWord.textContent, "Air is good");

const explicit = mk({ entities: ["sensor.air_puck_v1_0_co2", "sensor.air_puck_v1_0_voc_index"] });
eq("explicit sensors skip discovery", explicit._els.tiles.length, 2);
eq("and are still matched to metrics",
   explicit._els.tiles.map((t) => t.metric.key), ["co2", "voc"]);

eq("verdict can be hidden",
   mk({ area: "office", show_verdict: false })._els.verdict.classList.contains("hidden"), true);
eq("header can be hidden", mk({ area: "office", show_header: false })._els.title, undefined);
eq("hours default to 12", mk({ area: "office" })._config.hours, 12);
eq("hours are honoured", mk({ area: "office", hours: 48 })._config.hours, 48);
eq("silly hours are clamped", mk({ area: "office", hours: 100000 })._config.hours, 168);
eq("nonsense hours fall back", mk({ area: "office", hours: "soon" })._config.hours, 12);

/* --------------------------------------------------------------- history */
let asked = null;
const histHass = {
  ...hass,
  callWS: (msg) => {
    asked = msg;
    return Promise.resolve({
      "sensor.air_puck_v1_0_co2": [{ s: "400" }, { s: "500" }, { s: "450" }],
    });
  },
};
const sparked = new T.WabitAirCard();
sparked.setConfig({ area: "office", hours: 6 });
sparked.hass = histHass;
await new Promise((r) => setTimeout(r, 0));
eq("history is requested", asked.type, "history/history_during_period");
eq("for the sensors shown", asked.entity_ids.length, 10);
eq("over the configured window",
   Math.round((Date.parse(asked.end_time) - Date.parse(asked.start_time)) / 3600000), 6);
eq("attributes are not fetched", asked.no_attributes, true);
eq("a sparkline is drawn",
   sparked._els.tiles[0].spark.classList.contains("hidden"), false);
eq("with a path", !!sparked._els.tiles[0].path.getAttribute("d"), true);
eq("sensors without history get none",
   sparked._els.tiles[1].spark.classList.contains("hidden"), true);

/* The card has to survive history being unavailable - it is only decoration. */
const broken = new T.WabitAirCard();
broken.setConfig({ area: "office" });
broken.hass = { ...hass, callWS: () => Promise.reject(new Error("nope")) };
await new Promise((r) => setTimeout(r, 0));
eq("a failed history leaves the card standing", broken._els.tiles.length, 10);
eq("and simply no sparklines",
   broken._els.tiles.every((t) => t.spark.classList.contains("hidden")), true);

const noWs = mk({ area: "office" });
eq("no websocket, no trouble", noWs._els.tiles.length, 10);
eq("sparklines can be turned off",
   mk({ area: "office", show_sparklines: false })._els.tiles
     .every((t) => t.spark.classList.contains("hidden")), true);

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

eq("stub picks the room with sensors", T.WabitAirCard.getStubConfig(hass).area, "office");
eq("registered", !!customElements.get("wabit-air-card"), true);
eq("listed in the picker",
   window.customCards.some((c) => c.type === "wabit-air-card"), true);

done("air");
