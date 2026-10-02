/**
 * Tests for wabit-movie-mode-card.
 *
 *   node test/movie-mode-card.test.mjs
 */
import { loadCards, harness } from "./dom-stub.mjs";

const T = loadCards(process.argv[2]);
const { eq, throws, done } = harness();

/* --------------------------------------------------------------- helpers */

/** Depth-first search of the stubbed tree for the first element with a class. */
function find(el, cls) {
  const kids = (el && (el.children || [])) || [];
  for (const k of kids) {
    if (k.classList && k.classList.contains(cls)) return k;
    const deep = find(k, cls);
    if (deep) return deep;
  }
  return null;
}

function findAll(el, cls, out) {
  const acc = out || [];
  const kids = (el && (el.children || [])) || [];
  for (const k of kids) {
    if (k.classList && k.classList.contains(cls)) acc.push(k);
    findAll(k, cls, acc);
  }
  return acc;
}

/** A card wired up the way Lovelace does it, so the real paths run. */
function mount(config, hass) {
  const card = new T.WabitMovieModeCard();
  card.setConfig(config);
  card.hass = hass;
  return card;
}

/* --------------------------------------------------------------- fixture */
const calls = [];

function makeHass(over) {
  const o = over || {};
  return {
    locale: { language: "en-GB" },
    states: {
      "input_boolean.movie_mode": {
        state: o.mode || "on",
        attributes: { friendly_name: "Movie Mode" },
      },
      "input_boolean.movie_mode_override": {
        state: "off",
        attributes: { friendly_name: "Movie Mode Override" },
      },
      "switch.movie_projector": { state: "off", attributes: { friendly_name: "Projector" } },
      "light.living_room_ceiling": {
        state: o.ceiling || "off",
        attributes: { friendly_name: "Living Room - Ceiling" },
      },
      "light.living_room_accent": {
        state: "on",
        attributes: { friendly_name: "Living Room - Accent", brightness: 51, rgb_color: [255, 146, 39] },
      },
      "light.gone_dark": { state: "unavailable", attributes: { friendly_name: "Gone Dark" } },
      // A decoy that must not be mistaken for the mode switch.
      "sensor.movie_count": { state: "12", attributes: {} },
    },
    callService(domain, service, data) {
      calls.push([domain, service, data && data.entity_id]);
    },
  };
}

const hass = makeHass();

/* ------------------------------------------------------------- discovery */
eq("finds the movie mode helper",
   T.findMovieModeEntity(hass), "input_boolean.movie_mode");
eq("an override flag never wins",
   T.findMovieModeEntity({
     states: { "input_boolean.movie_mode_override": { state: "off" } },
   }), null);
eq("falls back to a switch when there is no helper",
   T.findMovieModeEntity({ states: { "switch.cinema_mode": { state: "off" } } }),
   "switch.cinema_mode");
eq("a sensor is never the switch",
   T.findMovieModeEntity({ states: { "sensor.movie_mode": { state: "on" } } }), null);
eq("nothing to find", T.findMovieModeEntity({ states: {} }), null);
eq("survives a junk hass", T.findMovieModeEntity(null), null);

/* ------------------------------------------------------------- light rows */
eq("an off light reads Off",
   T.movieLightRow(hass, "light.living_room_ceiling").detail, "Off");
eq("a dimmed light reads its percentage",
   T.movieLightRow(hass, "light.living_room_accent").detail, "20%");
eq("a dimmed light keeps its colour",
   T.movieLightRow(hass, "light.living_room_accent").colour, "rgb(255,146,39)");
eq("an unavailable light says so",
   T.movieLightRow(hass, "light.gone_dark").detail, "Unavailable");
eq("a missing entity drops out",
   T.movieLightRow(hass, "light.never_existed"), null);

/* ----------------------------------------------------------------- config */
throws("entity must be a boolean or switch",
  () => new T.WabitMovieModeCard().setConfig({ entity: "sensor.x" }),
  "must be an input_boolean or a switch");
throws("lights must be lights",
  () => new T.WabitMovieModeCard().setConfig({ lights: ["switch.x"] }),
  "must all be light entities");

{
  const card = new T.WabitMovieModeCard();
  card.setConfig({});
  eq("show_lights defaults on", card._config.show_lights, true);
  eq("lights default empty", card._config.lights, []);
  eq("entity defaults to nothing", card._config.entity, null);
}

eq("stub config discovers the helper",
   T.WabitMovieModeCard.getStubConfig(hass).entity, "input_boolean.movie_mode");

/* ----------------------------------------------------------------- render */
{
  const card = mount(
    { entity: "input_boolean.movie_mode", lights: ["light.living_room_ceiling", "light.living_room_accent"] },
    hass
  );
  const toggle = find(card.shadowRoot, "toggle");
  eq("toggle rendered", !!toggle, true);
  eq("movie mode on is reflected", toggle.classList.contains("on"), true);
  eq("state line reads On", find(card.shadowRoot, "sub").textContent, "On");
  eq("name comes from the entity", find(card.shadowRoot, "name").textContent, "Movie Mode");
  eq("icon is the lit film glyph",
     find(card.shadowRoot, "glyph").getAttribute("icon"), "mdi:movie-open");

  const rows = findAll(card.shadowRoot, "row");
  eq("a row per light", rows.length, 2);
  const details = findAll(card.shadowRoot, "rdetail").map((d) => d.textContent);
  eq("rows show what movie mode did", details, ["Off", "20%"]);
  const names = findAll(card.shadowRoot, "rname").map((d) => d.textContent);
  eq("rows are named", names, ["Living Room - Ceiling", "Living Room - Accent"]);

  // Tapping the hero toggles the helper, not the lights.
  calls.length = 0;
  toggle._fire("click");
  eq("tap toggles the helper", calls, [["input_boolean", "toggle", "input_boolean.movie_mode"]]);
}

{
  const card = mount({ entity: "input_boolean.movie_mode" }, makeHass({ mode: "off" }));
  const toggle = find(card.shadowRoot, "toggle");
  eq("off loses the on class", toggle.classList.contains("on"), false);
  eq("state line reads Off", find(card.shadowRoot, "sub").textContent, "Off");
  eq("icon is the dim film glyph",
     find(card.shadowRoot, "glyph").getAttribute("icon"), "mdi:movie-outline");
  eq("no lights means no rows", findAll(card.shadowRoot, "row").length, 0);
}

{
  const card = mount({ entity: "input_boolean.movie_mode" }, makeHass({ mode: "unavailable" }));
  eq("unavailable is surfaced", find(card.shadowRoot, "sub").textContent, "Unavailable");
  eq("and the button is disabled", find(card.shadowRoot, "toggle").disabled, true);
}

{
  // Nothing configured and nothing discoverable: explain, do not throw.
  const card = mount({}, { states: {} });
  const err = find(card.shadowRoot, "error");
  eq("missing switch explains itself", err.textContent.includes("No movie mode switch"), true);
  eq("and hides the toggle", find(card.shadowRoot, "toggle").style.display, "none");
}

{
  // Discovery still drives the card when `entity` is left out.
  const card = mount({}, hass);
  eq("undconfigured card finds the helper",
     find(card.shadowRoot, "name").textContent, "Movie Mode");
}

{
  const card = mount({ entity: "input_boolean.movie_mode", title: "Film night" }, hass);
  eq("an explicit title wins", find(card.shadowRoot, "title").textContent, "Film night");
  eq("and the title shows",
     find(card.shadowRoot, "title").classList.contains("hidden"), false);
}

{
  const card = mount({ entity: "input_boolean.movie_mode", show_lights: false, lights: ["light.living_room_accent"] }, hass);
  eq("show_lights false suppresses the rows", findAll(card.shadowRoot, "row").length, 0);
}

/* --------------------------------------------------------------- plumbing */
{
  const card = mount({ entity: "input_boolean.movie_mode", lights: ["light.living_room_accent"] }, hass);
  eq("card size covers the rows", card.getCardSize(), 3);
  // Re-rendering must not duplicate rows: the row list is keyed on ids.
  card.hass = makeHass();
  eq("re-render reuses the rows", findAll(card.shadowRoot, "row").length, 1);
}

eq("editor is offered", typeof T.WabitMovieModeCard.getConfigElement, "function");
eq("schema covers the options",
   T.MOVIE_SCHEMA.map((s) => s.name), ["entity", "title", "show_lights", "lights"]);
eq("registered", !!customElements.get("wabit-movie-mode-card"), true);
eq("editor registered", !!customElements.get("wabit-movie-mode-card-editor"), true);
eq("listed in the picker",
   window.customCards.some((c) => c.type === "wabit-movie-mode-card"), true);

done("movie-mode");
