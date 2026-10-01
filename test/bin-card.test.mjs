/**
 * Tests for wabit-bin-collection-card.
 *
 *   node test/bin-card.test.mjs
 */
import { loadCards, harness } from "./dom-stub.mjs";

const T = loadCards(process.argv[2]);
const { eq, throws, done } = harness();

/* The card derives "in N days" from the date, so the clock must be fixed. */
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(2026, 9, 1, 9, 0, 0); }
  static now() { return new RealDate(2026, 9, 1, 9, 0, 0).getTime(); }
};

/* --------------------------------------------------------------- fixture */
const calls = [];
const binAttrs = {
  green:    { date: "07/10/2026", relative_time: "in 5 days", image: "x" },
  grey:     { date: "14/10/2026", relative_time: "in 12 days", image: "x" },
  beige:    { date: "21/10/2026", relative_time: "in 19 days", image: "x" },
  burgundy: { date: "07/10/2026", relative_time: "in 5 days", image: "x" },
};
const hass = {
  themes: { darkMode: false },
  // Pinned so date formatting does not depend on the machine's locale.
  locale: { language: "en-GB" },
  states: {
    "sensor.bin_collection": { state: "ok", attributes: { ...binAttrs, friendly_name: "Bin Collection" } },
    "sensor.empty_bins": { state: "ok", attributes: { friendly_name: "Nothing" } },
  },
  callService: (d, s, data) => calls.push([d, s, data]),
};
const mk = (cfg) => {
  const c = new T.WabitBinCollectionCard();
  c.setConfig({ entity: "sensor.bin_collection", ...cfg });
  c.hass = hass;
  return c;
};

/* ------------------------------------------------------------- utilities */
eq("date format follows the given locale",
   T.formatBinDate(new RealDate(2026, 9, 7), "en-GB"), "Wed 7 Oct");
eq("date format differs for US English",
   T.formatBinDate(new RealDate(2026, 9, 7), "en-US"), "Wed, Oct 7");
eq("parses DD/MM/YYYY", T.parseDMY("07/10/2026").getTime(), new RealDate(2026, 9, 7).getTime());
eq("parses single-digit day", T.parseDMY("7/1/2026").getTime(), new RealDate(2026, 0, 7).getTime());
eq("rejects impossible dates", T.parseDMY("31/02/2026"), null);
eq("rejects month 13", T.parseDMY("01/13/2026"), null);
eq("rejects rubbish", T.parseDMY("unknown"), null);
eq("rejects non-strings", T.parseDMY(null), null);
eq("rejects ISO dates", T.parseDMY("2026-10-07"), null);

const now = new RealDate(2026, 9, 1, 9, 0, 0);
eq("days until same day", T.daysUntil(new RealDate(2026, 9, 1), now), 0);
eq("days until tomorrow", T.daysUntil(new RealDate(2026, 9, 2), now), 1);
eq("days across a month end", T.daysUntil(new RealDate(2026, 10, 1), now), 31);
eq("days in the past", T.daysUntil(new RealDate(2026, 8, 29), now), -2);
// Time of day must not matter - both ends are taken at local midnight.
eq("late-evening now still counts whole days",
   T.daysUntil(new RealDate(2026, 9, 2), new RealDate(2026, 9, 1, 23, 59)), 1);

eq("relative today", T.relativeDays(0), "Today");
eq("relative tomorrow", T.relativeDays(1), "Tomorrow");
eq("relative future", T.relativeDays(6), "in 6 days");
eq("relative yesterday", T.relativeDays(-1), "Yesterday");
eq("relative past", T.relativeDays(-3), "3 days ago");

/* ---------------------------------------------------------- grouping */
const card = mk();
const m = card._lastModel;
eq("three collection days, not four bins", m.groups.length, 3);
eq("soonest first", m.groups.map((g) => g.raw), ["07/10/2026", "14/10/2026", "21/10/2026"]);
eq("bins sharing a day are grouped",
   m.groups[0].bins.map((b) => b.key), ["green", "burgundy"]);
eq("hero is the soonest", m.hero.raw, "07/10/2026");
eq("rows are the rest", m.rows.map((g) => g.raw), ["14/10/2026", "21/10/2026"]);

eq("hero date formatted", card._els.heroDate.textContent, "Wed 7 Oct");
// Derived from the date, not from the sensor's own relative_time text.
eq("hero countdown", card._els.heroWhen.textContent, "in 6 days");
eq("hero not marked urgent", card._els.hero.classList.contains("soon"), false);
eq("one chip per bin that day", card._els.chips.children.length, 2);
eq("chip labels", card._els.chips.children.map((c) => c.children[1].textContent),
   ["Garden", "Food Waste"]);
eq("chip colour", card._els.chips.children[0].children[0].style._props["--bin"], "#3fa34d");

eq("two rows", card._els.rows.children.length, 2);
eq("row label", card._els.rows.children[0].children[1].children[0].textContent, "General Waste");
eq("row date", card._els.rows.children[0].children[1].children[1].textContent, "Wed 14 Oct");
eq("row countdown", card._els.rows.children[0].children[2].textContent, "in 13 days");
eq("row has one bar per bin", card._els.rows.children[0].children[0].children.length, 1);
eq("card size", card.getCardSize(), 5);

/* Two bins on one day read as a single row when that day is not the hero. */
const noHero = mk({ show_hero: false });
eq("hero hidden", noHero._els.hero.classList.contains("hidden"), true);
eq("all days become rows", noHero._els.rows.children.length, 3);
eq("joined label", noHero._els.rows.children[0].children[1].children[0].textContent,
   "Garden + Food Waste");
eq("two bars for two bins", noHero._els.rows.children[0].children[0].children.length, 2);

/* ------------------------------------------------------------- urgency */
const soonHass = { ...hass, states: { ...hass.states,
  "sensor.bin_collection": { state: "ok", attributes: { ...binAttrs,
    green: { date: "02/10/2026", relative_time: "tomorrow" } } } } };
const soon = new T.WabitBinCollectionCard();
soon.setConfig({ entity: "sensor.bin_collection" });
soon.hass = soonHass;
eq("tomorrow is the hero", soon._els.heroDate.textContent, "Fri 2 Oct");
eq("tomorrow worded", soon._els.heroWhen.textContent, "Tomorrow");
eq("tomorrow marked urgent", soon._els.hero.classList.contains("soon"), true);
eq("tomorrow splits the shared day", soon._lastModel.groups.length, 4);

const todayHass = { ...hass, states: { ...hass.states,
  "sensor.bin_collection": { state: "ok", attributes: { ...binAttrs,
    green: { date: "01/10/2026", relative_time: "today" } } } } };
const today = new T.WabitBinCollectionCard();
today.setConfig({ entity: "sensor.bin_collection" });
today.hass = todayHass;
eq("today worded", today._els.heroWhen.textContent, "Today");
eq("today marked urgent", today._els.hero.classList.contains("soon"), true);

/* -------------------------------------------------------- odd data */
const oddHass = { ...hass, states: { ...hass.states,
  "sensor.bin_collection": { state: "ok", attributes: {
    green: { date: "07/10/2026", relative_time: "in 5 days" },
    grey: { date: "not a date", relative_time: "sometime" } } } } };
const odd = new T.WabitBinCollectionCard();
odd.setConfig({ entity: "sensor.bin_collection" });
odd.hass = oddHass;
eq("undated bin sorts last", odd._lastModel.groups.map((g) => g.raw),
   ["07/10/2026", "not a date"]);
eq("undated bin falls back to the sensor wording",
   odd._els.rows.children[0].children[2].textContent, "sometime");
eq("undated bin shows its raw date",
   odd._els.rows.children[0].children[1].children[1].textContent, "not a date");

/* ------------------------------------------------------- failure modes */
const missing = new T.WabitBinCollectionCard();
missing.setConfig({ entity: "sensor.nope" });
missing.hass = hass;
eq("missing sensor message", missing._els.error.textContent, "sensor.nope is not available.");
eq("missing sensor hides hero", missing._els.hero.classList.contains("hidden"), true);

const none = new T.WabitBinCollectionCard();
none.setConfig({ entity: "sensor.empty_bins" });
none.hass = hass;
eq("no bin attributes message", none._els.empty.textContent, "No bin data in sensor.empty_bins.");

throws("entity must be a sensor",
  () => new T.WabitBinCollectionCard().setConfig({ entity: "light.x" }), "must be a sensor");

/* ------------------------------------------------------------- config */
const partial = mk({ bins: { green: { label: "Garden waste" } } });
eq("partial bin keeps the default colour", partial._config.bins.green.color, "#3fa34d");
eq("partial bin takes the given label", partial._config.bins.green.label, "Garden waste");
eq("only configured bins are shown", partial._lastModel.groups.length, 1);

const custom = mk({ bins: { grey: { label: "Rubbish", color: "#111111" } } });
eq("custom colour used", custom._lastModel.groups[0].bins[0].color, "#111111");

// A config carried over from the old card must not throw on its glass keys.
const legacy = mk({ glass: true, glassOpacity: 35, title: "Bins" });
eq("legacy glass keys ignored", legacy._config.glass, undefined);
eq("legacy config still renders", legacy._lastModel.groups.length, 3);

eq("stub finds a bin sensor", T.WabitBinCollectionCard.getStubConfig(hass).entity,
   "sensor.bin_collection");
eq("registered", !!customElements.get("wabit-bin-collection-card"), true);
eq("listed in the picker",
   window.customCards.some((c) => c.type === "wabit-bin-collection-card"), true);


/* ================== UK Bin Collection Data integration ================== */

const uk = (name, colour, date, days, icon) => ({
  state: `In ${days} days`,
  attributes: {
    colour, next_collection: date, days, icon,
    device_class: "bin_collection_schedule", friendly_name: name,
  },
});
const ukStates = {
  "sensor.bins_140l_grey_rubbish_bin":
    uk("Bins 140L grey rubbish bin", "grey", "14/10/2026", 13, "mdi:trash-can"),
  "sensor.bins_240l_beige_recycling_bin":
    uk("Bins 240L beige recycling bin", "burlywood", "21/10/2026", 20, "mdi:recycle"),
  "sensor.bins_240l_burgundy_plastic_bin":
    uk("Bins 240L burgundy plastic bin", "maroon", "07/10/2026", 6,
       "mdi:bottle-soda-classic-outline"),
  "sensor.bins_240l_green_garden_bin":
    uk("Bins 240L green garden bin", "darkgreen", "07/10/2026", 6, "mdi:leaf"),
};
const ukHass = {
  themes: { darkMode: false },
  locale: { language: "en-GB" },
  states: {
    ...ukStates,
    // Must be ignored: right domain, wrong device class.
    "sensor.kitchen_temperature": { state: "19", attributes: { device_class: "temperature" } },
    "sensor.bin_collection": hass.states["sensor.bin_collection"],
  },
  callService: () => {},
};
const mkUk = (cfg) => {
  const c = new T.WabitBinCollectionCard();
  c.setConfig({ ...cfg });
  c.hass = ukHass;
  return c;
};

eq("discovers bin sensors by device class", T.discoverBinSensors(ukHass), [
  "sensor.bins_140l_grey_rubbish_bin",
  "sensor.bins_240l_beige_recycling_bin",
  "sensor.bins_240l_burgundy_plastic_bin",
  "sensor.bins_240l_green_garden_bin",
]);
eq("discovers nothing when the integration is absent", T.discoverBinSensors(hass), []);

eq("common prefix across bin names",
   T.commonWordPrefix(["Bins 140L grey rubbish bin", "Bins 240L green garden bin"]), "Bins");
eq("no common prefix", T.commonWordPrefix(["Green bin", "Grey bin"]), "");
eq("single name has no prefix to strip", T.commonWordPrefix(["Bins green"]), "");
// Must never consume a whole name.
eq("prefix stops short of emptying a name",
   T.commonWordPrefix(["Bins green", "Bins green bin"]), "Bins");

/* ------------------------------------------------- zero-config discovery */
const auto = mkUk({});
eq("no entity needed", auto._config.entity, null);
eq("four bins on three days", auto._lastModel.groups.length, 3);
eq("shared day grouped",
   auto._lastModel.groups[0].bins.map((b) => b.key).sort(),
   ["sensor.bins_240l_burgundy_plastic_bin", "sensor.bins_240l_green_garden_bin"]);
eq("prefix and size stripped, first letter capitalised",
   auto._lastModel.groups[1].bins[0].label, "Grey rubbish bin");
eq("colour taken from the sensor",
   auto._lastModel.groups[1].bins[0].color, "grey");
eq("icon taken from the sensor",
   auto._lastModel.groups[1].bins[0].icon, "mdi:trash-can");
eq("hero date", auto._els.heroDate.textContent, "Wed 7 Oct");
eq("hero countdown recomputed from the date", auto._els.heroWhen.textContent, "in 6 days");
eq("hero chips", auto._els.chips.children.map((c) => c.children[1].textContent),
   ["Burgundy plastic bin", "Green garden bin"]);
eq("rows for the other days", auto._els.rows.children.length, 2);
eq("row countdown", auto._els.rows.children[0].children[2].textContent, "in 13 days");

const noStrip = mkUk({ strip_prefix: false });
eq("full names kept", noStrip._lastModel.groups[1].bins[0].label, "Bins 140L grey rubbish bin");

/* ---------------------------------------------------- explicit entities */
const picked = mkUk({ entities: ["sensor.bins_140l_grey_rubbish_bin"] });
eq("only the listed sensor", picked._lastModel.groups.length, 1);
eq("single entity keeps its full name", picked._lastModel.groups[0].bins[0].label,
   "Bins 140L grey rubbish bin");

const over = mkUk({ overrides: {
  "sensor.bins_140l_grey_rubbish_bin": { label: "Rubbish", color: "#101010" } } });
const greyGroup = over._lastModel.groups.find((g) => g.raw === "14/10/2026");
eq("override label", greyGroup.bins[0].label, "Rubbish");
eq("override colour", greyGroup.bins[0].color, "#101010");
eq("override leaves others alone",
   over._lastModel.groups[0].bins[0].color, "maroon");


/* ----------------------------------------------------- tidying the names */
eq("strips a litre size", T.stripBinSize("240L green garden bin"), "green garden bin");
eq("strips a spaced litre size", T.stripBinSize("240 litre beige recycling bin"),
   "beige recycling bin");
eq("strips lowercase l", T.stripBinSize("140l grey rubbish bin"), "grey rubbish bin");
eq("leaves a name with no size", T.stripBinSize("Green garden bin"), "Green garden bin");
// Must never return nothing - a bin called only by its size keeps that name.
eq("never empties the name", T.stripBinSize("240L"), "240L");
eq("does not strip a size mid-name", T.stripBinSize("garden 240L bin"), "garden 240L bin");

eq("sentence case", T.applyCase("green garden bin", "sentence"), "Green garden bin");
eq("title case", T.applyCase("green garden bin", "title"), "Green Garden Bin");
eq("case left alone", T.applyCase("green garden bin", "none"), "green garden bin");
eq("already capitalised is untouched", T.applyCase("Green garden bin", "sentence"),
   "Green garden bin");
eq("empty name survives", T.applyCase("", "title"), "");

const titled = mkUk({ label_case: "title" });
eq("title case applied to labels",
   titled._lastModel.groups[1].bins[0].label, "Grey Rubbish Bin");
const plain = mkUk({ label_case: "none" });
eq("case can be left alone",
   plain._lastModel.groups[1].bins[0].label, "grey rubbish bin");
const sized = mkUk({ strip_size: false });
eq("size can be kept",
   sized._lastModel.groups[1].bins[0].label, "140L grey rubbish bin");
const raw = mkUk({ strip_size: false, strip_prefix: false, label_case: "none" });
eq("everything off leaves the sensor name",
   raw._lastModel.groups[1].bins[0].label, "Bins 140L grey rubbish bin");

// An explicit override is used verbatim - no trimming, no recasing.
const verbatim = mkUk({ overrides: {
  "sensor.bins_140l_grey_rubbish_bin": { label: "240L wheelie bin" } } });
eq("override used exactly as written",
   verbatim._lastModel.groups.find((g) => g.raw === "14/10/2026").bins[0].label,
   "240L wheelie bin");

/* ------------------------------------------------- glyphs from the icon */
customElements.define("ha-icon", class {});
const iconCard = mkUk({});
const firstChip = iconCard._els.chips.children[0];
eq("chip uses an ha-icon", firstChip.children[0].tagName, "ha-icon");
eq("chip icon is the bin's own", firstChip.children[0].getAttribute("icon"),
   "mdi:bottle-soda-classic-outline");
eq("chip icon tinted", firstChip.children[0].style._props["--bin"], "maroon");
// The dot/bar classes paint a background in the glyph's own colour, so an icon
// carrying them would be invisible.
eq("icon does not get the dot styling",
   firstChip.children[0].classList.contains("dot"), false);
eq("icon is sized as a chip glyph",
   firstChip.children[0].classList.contains("glyph-chip"), true);
eq("row icon does not get the bar styling",
   iconCard._els.rows.children[0].children[0].children[0].classList.contains("bar"), false);
eq("row icon is sized as a row glyph",
   iconCard._els.rows.children[0].children[0].children[0].classList.contains("glyph-row"), true);
eq("row uses an ha-icon",
   iconCard._els.rows.children[0].children[0].children[0].tagName, "ha-icon");
delete customElements._d["ha-icon"];
// Without ha-icon it must still render, as a coloured dot.
const dotCard = mkUk({});
eq("falls back to a dot", dotCard._els.chips.children[0].children[0].tagName, "span");
eq("dot still tinted", dotCard._els.chips.children[0].children[0].style._props["--bin"], "maroon");

/* --------------------------------------------------------- failure modes */
const nothing = new T.WabitBinCollectionCard();
nothing.setConfig({});
nothing.hass = hass; // no bin sensors at all
eq("nothing found message", nothing._els.empty.textContent,
   "No bin sensors found. Set up the UK Bin Collection Data integration, " +
   "or point the card at a sensor with `entity`.");

const gone = mkUk({ entities: ["sensor.not_here"] });
eq("configured sensors missing", gone._els.empty.textContent,
   "None of the configured bin sensors are available.");

/* A sensor whose date will not parse still appears, using its own state text. */
const brokenHass = { ...ukHass, states: { ...ukStates,
  "sensor.bins_140l_grey_rubbish_bin": { state: "Unknown", attributes: {
    colour: "grey", next_collection: "n/a", days: 4,
    device_class: "bin_collection_schedule", friendly_name: "Bins grey" } } } };
const broken = new T.WabitBinCollectionCard();
broken.setConfig({});
broken.hass = brokenHass;
const brokenItem = broken._lastModel.groups.find((g) => g.raw === "n/a");
eq("unparseable date still listed", !!brokenItem, true);
eq("falls back to the integration's day count", brokenItem.bins[0].days, 4);
eq("undated sorts last", broken._lastModel.groups.at(-1).raw, "n/a");

throws("entities must be a list",
  () => new T.WabitBinCollectionCard().setConfig({ entities: "sensor.a" }), "must be a list");
throws("entities must be sensors",
  () => new T.WabitBinCollectionCard().setConfig({ entities: ["light.a"] }), "may only contain sensors");

eq("stub needs no entity when discovery works",
   "entity" in T.WabitBinCollectionCard.getStubConfig(ukHass), false);
eq("stub falls back to a named sensor",
   T.WabitBinCollectionCard.getStubConfig(hass).entity, "sensor.bin_collection");

/* The older single-sensor setup must keep working alongside. */
const legacyMode = new T.WabitBinCollectionCard();
legacyMode.setConfig({ entity: "sensor.bin_collection" });
legacyMode.hass = ukHass;
eq("legacy mode ignores discovery", legacyMode._lastModel.groups.length, 3);
eq("legacy labels come from config", legacyMode._lastModel.groups[0].bins[0].label, "Garden");

/* ------------------------------------------------------------- editor */
customElements.define("ha-form", class {});
const ed = new T.WabitBinCollectionCardEditor();
const emitted = [];
ed.addEventListener("config-changed", (ev) => emitted.push(ev.detail.config));
ed.setConfig({ entity: "sensor.bin_collection" });
ed.hass = hass;
eq("one row per bin", ed._els.list.children.length, 4);
eq("row shows the bin key", ed._els.list.children[0].children[0].textContent, "green");
eq("row shows the label", ed._els.list.children[0].children[1].value, "Garden");
eq("row shows the colour", ed._els.list.children[0].children[2].value, "#3fa34d");

ed._els.list.children[0].children[1].value = "Garden waste";
ed._els.list.children[0].children[1]._fire("change");
eq("label edit emits", emitted.at(-1).bins.green.label, "Garden waste");
eq("label edit keeps the colour", emitted.at(-1).bins.green.color, "#3fa34d");
ed._els.list.children[1].children[2].value = "#222222";
ed._els.list.children[1].children[2]._fire("change");
eq("colour edit emits", emitted.at(-1).bins.grey.color, "#222222");
eq("colour edit leaves other bins alone", emitted.at(-1).bins.green.label, "Garden waste");
delete customElements._d["ha-form"];

globalThis.Date = RealDate;
done("bin-collection");
