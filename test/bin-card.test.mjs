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

throws("entity required", () => new T.WabitBinCollectionCard().setConfig({}), "`entity` is required");
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
