/**
 * Tests for wabit-f1-card.
 *
 *   node test/f1-card.test.mjs
 */
process.env.TZ = "UTC"; // formatted times must not depend on the machine

import { loadCards, harness } from "./dom-stub.mjs";

const T = loadCards(process.argv[2]);
const { eq, throws, done } = harness();

const RealDate = Date;
const NOW = new RealDate(RealDate.UTC(2026, 9, 1, 12, 0, 0));
globalThis.Date = class extends RealDate {
  constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(NOW); }
  static now() { return NOW.getTime(); }
  static UTC(...a) { return RealDate.UTC(...a); }
  static parse(x) { return RealDate.parse(x); }
};

/* --------------------------------------------------------------- fixture */
const RACE_ATTRS = {
  season: "2026", round: "16",
  race_name: "Bahrain Grand Prix in Malaysia",
  circuit_id: "sepang",
  circuit_name: "Sepang International Circuit",
  circuit_lat: "2.76083", circuit_long: "101.738",
  circuit_locality: "Kuala Lumpur", circuit_country: "Malaysia",
  circuit_map_url: null, circuit_outline_url: null,
  race_start_utc: "2026-10-04T07:00:00+00:00",
  first_practice_start_utc: "2026-10-02T04:30:00+00:00",
  second_practice_start_utc: "2026-10-02T08:00:00+00:00",
  third_practice_start_utc: "2026-10-03T04:30:00+00:00",
  qualifying_start_utc: "2026-10-03T08:00:00+00:00",
  sprint_start_utc: null, sprint_qualifying_start_utc: null,
  device_class: "timestamp", friendly_name: "F1 - Race Next race",
};

const hass = {
  themes: { darkMode: false },
  locale: { language: "en-GB" },
  states: {
    "sensor.f1_next_race": { state: "2026-10-04T07:00:00+00:00", attributes: RACE_ATTRS },
    "weather.f1_weather": {
      state: "cloudy",
      attributes: {
        temperature: 25, temperature_unit: "°C", humidity: 99,
        wind_speed: 1.26, wind_speed_unit: "km/h",
        circuit_id: "sepang", circuit_name: "Sepang International Circuit",
        friendly_name: "Sepang International Circuit · Kuala Lumpur",
      },
    },
    // Decoys that must not be picked up.
    "sensor.kitchen_temperature": { state: "19", attributes: { device_class: "temperature" } },
    "weather.home": { state: "sunny", attributes: { temperature: 14 } },
  },
  callService: () => {},
};

const mk = (cfg) => {
  const c = new T.WabitF1Card();
  c.setConfig(cfg || {});
  c.hass = hass;
  return c;
};

/* ------------------------------------------------------------ discovery */
eq("finds the race sensor", T.findF1RaceSensor(hass), "sensor.f1_next_race");
eq("finds the circuit weather", T.findF1WeatherEntity(hass), "weather.f1_weather");
eq("ignores the household weather",
   T.findF1WeatherEntity({ states: { "weather.home": hass.states["weather.home"] } }), null);
eq("no race sensor", T.findF1RaceSensor({ states: {} }), null);

/* ----------------------------------------------------------- map urls */
eq("fills the circuit id",
   T.f1MapUrl("/local/circuits/{circuit_id}.png", RACE_ATTRS), "/local/circuits/sepang.png");
eq("fills season and round",
   T.f1MapUrl("{season}/{round}.png", RACE_ATTRS), "2026/16.png");
// Formula 1 names its artwork by country, so circuit ids have to be translated.
eq("translates to the F1 name",
   T.f1MapUrl("x/{circuit_f1}_Circuit", RACE_ATTRS), "x/Malaysia_Circuit");
eq("an unknown circuit falls back to its id",
   T.f1MapUrl("x/{circuit_f1}", { circuit_id: "nowhere" }), "x/nowhere");
eq("no template, no url", T.f1MapUrl(null, RACE_ATTRS), null);
eq("known slugs include the current calendar",
   ["silverstone", "monza", "spa", "suzuka", "vegas"].every((c) => T.F1_CIRCUIT_SLUGS[c]), true);

/* ---------------------------------------------------------- countdowns */
eq("minutes to a future time",
   T.minutesTo(new RealDate(RealDate.UTC(2026, 9, 1, 13, 30)), NOW), 90);
eq("minutes to a past time",
   T.minutesTo(new RealDate(RealDate.UTC(2026, 9, 1, 11, 0)), NOW), -60);
eq("minutes of nothing", T.minutesTo(null, NOW), null);
eq("countdown in minutes", T.f1Countdown(42), "in 42m");
eq("countdown in hours", T.f1Countdown(150), "in 2h 30m");
eq("countdown in whole hours", T.f1Countdown(120), "in 2h");
eq("countdown in days", T.f1Countdown(2880), "in 2d");
eq("countdown in days and hours", T.f1Countdown(3000), "in 2d 2h");
eq("a session under way", T.f1Countdown(-30), "Under way");
eq("a session long finished", T.f1Countdown(-600), "Finished");
eq("no countdown", T.f1Countdown(null), "");

/* ------------------------------------------------------------ rendering */
const card = mk();
eq("round and season", card._els.eyebrow.textContent, "Round 16 · 2026");
eq("race name", card._els.race.textContent, "Bahrain Grand Prix in Malaysia");
eq("circuit", card._els.circuit.textContent, "Sepang International Circuit");
eq("locality and country", card._els.place.textContent, "Kuala Lumpur, Malaysia");

/* sessions, in running order, with the next one marked */
eq("five sessions", card._els.sessionRows.length, 5);
eq("in running order", card._els.sessionRows.map((r) => r.s.label),
   ["Practice 1", "Practice 2", "Practice 3", "Qualifying", "Race"]);
eq("missing sessions are skipped",
   card._els.sessionRows.some((r) => r.s.label === "Sprint"), false);
eq("the next session is the first practice", card._lastModel.next.label, "Practice 1");
eq("the next session is marked",
   card._els.sessionRows[0].row.classList.contains("next"), true);
eq("later sessions are not", card._els.sessionRows[1].row.classList.contains("next"), false);
eq("nothing is done yet", card._els.sessionRows[0].row.classList.contains("done"), false);
eq("session time formatted", card._els.sessionRows[0].when.textContent, "Fri 2 Oct 04:30");

eq("the strip points at the next session", card._els.nextLabel.textContent, "Next session");
eq("and names it", card._els.nextName.textContent, "Practice 1");
// 1 Oct 12:00Z to 2 Oct 04:30Z
eq("with a countdown", card._els.nextCountdown.textContent, "in 16h 30m");

/* weather */
eq("weather shown", card._els.weather.classList.contains("hidden"), false);
eq("temperature", card._els.weatherTemp.textContent, "25°C");
eq("conditions read as words", card._els.weatherSub.textContent,
   "Cloudy · 99% humidity · 1 km/h wind");

/* the map: Formula 1's own artwork, with no configuration */
eq("defaults to Formula 1's artwork", card._els.mapImg.getAttribute("src"),
   "https://media.formula1.com/image/upload/f_auto,c_limit,q_auto,w_1320/content/dam/" +
   "fom-website/2018-redesign-assets/Circuit%20maps%2016x9/Malaysia_Circuit");
eq("the map block is shown", card._els.map.classList.contains("hidden"), false);
// Every 2026-path URL checked returns 404 while the legacy ones resolve, so the
// season must not switch the default over to them.
eq("a 2026 season still uses the legacy path",
   card._els.mapImg.getAttribute("src").includes("2018-redesign-assets"), true);
eq("the modern path can be asked for",
   mk({ map_url: "f1-modern" })._els.mapImg.getAttribute("src"),
   "https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/common/f1/" +
   "2026/track/2026trackmalaysiadetailed.webp");

// Hotlinked artwork can vanish. Rather than a broken image or a plate saying
// so, the block goes entirely - there is nothing useful to put in its place.
card._els.mapImg._handlers.error[0]();
eq("a failed image hides the block", card._els.map.classList.contains("hidden"), true);
eq("the rest of the card is untouched", card._els.race.textContent,
   "Bahrain Grand Prix in Malaysia");
eq("the sessions still show", card._els.sessions.classList.contains("hidden"), false);

eq("the map can be opted out of",
   mk({ map_url: "none" })._els.map.classList.contains("hidden"), true);
eq("show_map false hides the block",
   mk({ show_map: false })._els.map.classList.contains("hidden"), true);

// A new circuit must not inherit the previous one's failure.
card._els.mapImg._src = null;
card.hass = { ...hass, states: { ...hass.states,
  "sensor.f1_next_race": { ...hass.states["sensor.f1_next_race"],
    attributes: { ...RACE_ATTRS, circuit_id: "monza", circuit_name: "Monza" } } } };
eq("a different circuit tries again", card._els.map.classList.contains("hidden"), false);
eq("and points at the new artwork",
   card._els.mapImg.getAttribute("src").includes("Italy_Circuit"), true);

const mapped = mk({ map_url: "/local/circuits/{circuit_id}.png" });
eq("a template beats the Formula 1 default",
   mapped._els.mapImg.getAttribute("src").includes("media.formula1.com"), false);
eq("a template gives a map", mapped._els.mapImg.getAttribute("src"),
   "/local/circuits/sepang.png");
eq("the block is shown", mapped._els.map.classList.contains("hidden"), false);
eq("the map is labelled", mapped._els.mapImg.getAttribute("alt"),
   "Sepang International Circuit layout");

// The integration can supply its own, and does so without configuration.
const supplied = { ...hass, states: { ...hass.states,
  "sensor.f1_next_race": { ...hass.states["sensor.f1_next_race"],
    attributes: { ...RACE_ATTRS, circuit_map_url: "https://example.test/sepang.png" } } } };
const auto = new T.WabitF1Card();
auto.setConfig({});
auto.hass = supplied;
eq("the sensor's own map is used", auto._els.mapImg.getAttribute("src"),
   "https://example.test/sepang.png");

/* ----------------------------------------------------- later in the weekend */
const afterQuali = new T.WabitF1Card();
afterQuali.setConfig({});
globalThis.Date = class extends RealDate {
  constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(RealDate.UTC(2026, 9, 3, 12, 0)); }
  static now() { return RealDate.UTC(2026, 9, 3, 12, 0); }
  static UTC(...a) { return RealDate.UTC(...a); }
  static parse(x) { return RealDate.parse(x); }
};
afterQuali.hass = hass;
eq("the race is next once qualifying is done", afterQuali._lastModel.next.label, "Race");
eq("finished sessions are dimmed",
   afterQuali._els.sessionRows[0].row.classList.contains("done"), true);
eq("the race is not dimmed",
   afterQuali._els.sessionRows[4].row.classList.contains("done"), false);
globalThis.Date = class extends RealDate {
  constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(NOW); }
  static now() { return NOW.getTime(); }
  static UTC(...a) { return RealDate.UTC(...a); }
  static parse(x) { return RealDate.parse(x); }
};

/* ------------------------------------------------------------- options */

eq("weather can be hidden",
   mk({ show_weather: false })._els.weather.classList.contains("hidden"), true);
eq("sessions can be hidden",
   mk({ show_sessions: false })._els.sessions.classList.contains("hidden"), true);

const noWeather = new T.WabitF1Card();
noWeather.setConfig({});
noWeather.hass = { ...hass, states: { "sensor.f1_next_race": hass.states["sensor.f1_next_race"] } };
eq("no weather entity, no panel",
   noWeather._els.weather.classList.contains("hidden"), true);
eq("the rest still renders", noWeather._els.race.textContent,
   "Bahrain Grand Prix in Malaysia");

/* --------------------------------------------------------- failure modes */
const nothing = new T.WabitF1Card();
nothing.setConfig({});
nothing.hass = { ...hass, states: {} };
eq("no sensor explains itself", nothing._els.error.textContent,
   "No Formula 1 race sensor found. Set `entity` to one.");
eq("and hides the rest", nothing._els.head.classList.contains("hidden"), true);

const gone = new T.WabitF1Card();
gone.setConfig({ entity: "sensor.not_here" });
gone.hass = hass;
eq("a missing sensor is named", gone._els.error.textContent,
   "sensor.not_here is not available.");

throws("entity must be a sensor",
  () => new T.WabitF1Card().setConfig({ entity: "light.x" }), "must be a sensor");
throws("weather must be a weather entity",
  () => new T.WabitF1Card().setConfig({ weather_entity: "sensor.x" }),
  "must be a weather entity");

eq("stub finds the sensor", T.WabitF1Card.getStubConfig(hass).entity, "sensor.f1_next_race");
eq("registered", !!customElements.get("wabit-f1-card"), true);
eq("listed in the picker",
   window.customCards.some((c) => c.type === "wabit-f1-card"), true);

globalThis.Date = RealDate;
done("f1");
