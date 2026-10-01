/**
 * Tests for wabit-wakeup-card.
 *
 *   node test/card.test.mjs
 */
import { loadCards } from "./dom-stub.mjs";

const T = loadCards(process.argv[2]);

/* ----------------------------------------------------------- assertions */
let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL ${label}\n     got  ${g}\n     want ${w}`); }
};
const throws = (label, fn, frag) => {
  try { fn(); fail++; console.log(`FAIL ${label} (no throw)`); }
  catch (e) {
    if (String(e.message).includes(frag)) pass++;
    else { fail++; console.log(`FAIL ${label}: ${e.message}`); }
  }
};

/* pure helpers */
eq("time 06:55:00", T.timeToMinutes("06:55:00"), 415);
eq("time 6:55", T.timeToMinutes("6:55"), 415);
eq("time unknown", T.timeToMinutes("unknown"), null);
eq("time rubbish", T.timeToMinutes("99:99"), null);
eq("time null", T.timeToMinutes(null), null);
eq("fmt 415", T.minutesToTime(415), "06:55");
eq("fmt wrap -10", T.minutesToTime(-10), "23:50");
eq("fmt wrap 1450", T.minutesToTime(1450), "00:10");
eq("dur 40", T.humanDuration(40), "40m");
eq("dur 95", T.humanDuration(95), "1h 35m");
eq("dur 120", T.humanDuration(120), "2h");
eq("dur 1440", T.humanDuration(1440), "1d");
eq("dur 2755", T.humanDuration(2755), "1d 21h");
eq("dur 60", T.humanDuration(60), "1h");
eq("days mixed", T.normaliseDays(["Mon", "tuesday", "junk"]), ["mon", "tue"]);
eq("days empty", T.normaliseDays([]), null);
eq("days absent", T.normaliseDays(undefined), null);

// Thu 2026-10-01 06:00 -> weekday 06:55 is 55m away
const thu6 = new Date(2026, 9, 1, 6, 0);
eq("next same day", T.minutesUntilNext(thu6, 415, ["mon","tue","wed","thu","fri"]), 55);
// Thu 08:00 -> next weekday occurrence is Friday
const thu8 = new Date(2026, 9, 1, 8, 0);
eq("next next day", T.minutesUntilNext(thu8, 415, ["mon","tue","wed","thu","fri"]), 1440 + 415 - 480);
// Thu -> weekend only: Saturday (offset 2)
eq("next weekend", T.minutesUntilNext(thu8, 475, ["sat","sun"]), 2 * 1440 + 475 - 480);
eq("next no days", T.minutesUntilNext(thu8, 415, null), null);

/* ------------------------------------------------- full card lifecycle */
const calls = [];
const hass = {
  themes: { darkMode: true },
  states: {
    "input_datetime.bedroom_weekday_wakeup_time": { state: "06:55:00", attributes: {} },
    "input_datetime.bedroom_weekend_wakeup_time": { state: "07:55:00", attributes: {} },
    "input_number.bedroom_wakeup_fade": { state: "5.0", attributes: { min: 1, max: 60, step: 1 } },
    "automation.bedroom_weekday_wakeup": { state: "on", attributes: {} },
    "automation.bedroom_weekend_wakeup": { state: "off", attributes: {} },
    "input_text.bedroom_wakeup_light": { state: "light.bedroom_ceiling_light", attributes: {} },
    "input_select.bedroom_wakeup_light": { state: "light.bedroom_ceiling_light", attributes: {} },
    "light.bedroom_ceiling_light": {
      state: "on", attributes: { friendly_name: "Bedroom ceiling light", brightness: 102 } },
    "light.bedside_lamp": { state: "off", attributes: { friendly_name: "Bedside lamp" } },
  },
  callService: (d, s, data) => calls.push([d, s, data]),
};

const CONFIG = {
  type: "custom:wabit-wakeup-card",
  title: "Bedroom Wakeup",
  fade_entity: "input_number.bedroom_wakeup_fade",
  schedules: [
    { name: "Weekday", time: "input_datetime.bedroom_weekday_wakeup_time",
      automation: "automation.bedroom_weekday_wakeup",
      days: ["mon","tue","wed","thu","fri"] },
    { name: "Weekend", time: "input_datetime.bedroom_weekend_wakeup_time",
      automation: "automation.bedroom_weekend_wakeup", days: ["sat","sun"] },
  ],
};

const card = new T.WabitWakeupCard();
card.setConfig(CONFIG);
card.hass = hass;

eq("built", card._built, true);
eq("colorScheme dark", card.style.colorScheme, "dark");
// fade is tucked behind the gear, so it does not add to the resting height
eq("card size", card.getCardSize(), 4);

const rows = card._els.rows;
eq("row count", rows.length, 2);
eq("weekday time input", rows[0].timeInput.value, "06:55");
eq("weekday sub", rows[0].sub.textContent, "full at 07:00");
eq("weekday toggle on", rows[0].toggle.checked, true);
eq("weekend sub (off)", rows[1].sub.textContent, "disabled - full at 08:00");
eq("weekend toggle off", rows[1].toggle.checked, false);
eq("weekend row off class", rows[1].row.classList.contains("off"), true);
eq("fade slider value", card._els.fade.slider.value, "5");
eq("fade label", card._els.fade.value.textContent, "5m");
eq("hero eyebrow", card._els.hero.eyebrow.textContent, "Next wakeup");
eq("hero time", card._els.hero.time.textContent, "06:55");
eq("hero name", card._els.hero.name.textContent, "Weekday");
eq("ramp from", card._els.hero.from.textContent, "06:55");
eq("ramp to", card._els.hero.to.textContent, "07:00 full");

/* interactions */
rows[0].timeInput.value = "07:10";
rows[0].timeInput._fire("change");
eq("set_datetime call", calls.at(-1),
   ["input_datetime", "set_datetime",
    { entity_id: "input_datetime.bedroom_weekday_wakeup_time", time: "07:10:00" }]);

rows[1].toggle.checked = true;
rows[1].toggle._fire("change");
eq("automation turn_on", calls.at(-1),
   ["automation", "turn_on", { entity_id: "automation.bedroom_weekend_wakeup" }]);

card._els.fade.slider.value = "25";
card._els.fade.slider._fire("change");
eq("input_number set_value", calls.at(-1),
   ["input_number", "set_value", { entity_id: "input_number.bedroom_wakeup_fade", value: 25 }]);

// invalid time must not fire a service call
const before = calls.length;
rows[0].timeInput.value = "";
rows[0].timeInput._fire("change");
eq("blank time makes no call", calls.length, before);
eq("blank time snaps back", rows[0].timeInput.value, "06:55");

/* fade_mode: finish */
const card2 = new T.WabitWakeupCard();
card2.setConfig({ ...CONFIG, fade_mode: "finish" });
card2.hass = hass;
eq("finish mode sub", card2._els.rows[0].sub.textContent, "fade starts 06:50");
eq("finish ramp from", card2._els.hero.from.textContent, "06:50");
eq("finish ramp to", card2._els.hero.to.textContent, "06:55 full");

/* missing entities must degrade, not explode */
const card3 = new T.WabitWakeupCard();
card3.setConfig({
  title: "Broken",
  fade_entity: "input_number.nope",
  schedules: [{ name: "Gone", time: "input_datetime.nope", automation: "automation.nope" }],
});
card3.hass = hass;
eq("missing time sub", card3._els.rows[0].sub.textContent, "input_datetime.nope is missing");
eq("missing row flagged", card3._els.rows[0].row.classList.contains("missing"), true);
eq("missing fade disabled", card3._els.fade.slider.disabled, true);
eq("missing fade label", card3._els.fade.value.textContent, "-");
eq("no days hides countdown", card3._els.hero.chip.classList.contains("hidden"), true);

/* no fade entity at all */
const card4 = new T.WabitWakeupCard();
card4.setConfig({ schedules: [{ name: "Only", time: "input_datetime.bedroom_weekday_wakeup_time", days: ["mon"] }] });
card4.hass = hass;
eq("no fade row", card4._els.fade, null);
eq("no fade sub empty", card4._els.rows[0].sub.textContent, "");
eq("no fade hides ramp", card4._els.hero.ramp.classList.contains("hidden"), true);

/* config validation */
throws("empty schedules", () => new T.WabitWakeupCard().setConfig({ schedules: [] }), "at least one");
throws("no schedules key", () => new T.WabitWakeupCard().setConfig({}), "at least one");
throws("bad time domain",
  () => new T.WabitWakeupCard().setConfig({ schedules: [{ time: "sensor.x" }] }), "must be an input_datetime");
throws("bad fade domain",
  () => new T.WabitWakeupCard().setConfig({ fade_entity: "sensor.x", schedules: [{}] }), "must be an input_number");

/* stub config + registration */
const stub = T.WabitWakeupCard.getStubConfig(hass);
eq("stub type", stub.type, "custom:wabit-wakeup-card");
eq("stub fade", stub.fade_entity, "input_number.bedroom_wakeup_fade");
eq("stub schedule count", stub.schedules.length, 2);
eq("stub weekday days", stub.schedules[0].days, ["mon","tue","wed","thu","fri"]);
eq("stub weekend days", stub.schedules[1].days, ["sat","sun"]);
// a stub must be valid input to setConfig, or the picker preview breaks
new T.WabitWakeupCard().setConfig(stub);
pass++;
eq("registered card", !!customElements.get("wabit-wakeup-card"), true);
eq("registered editor", !!customElements.get("wabit-wakeup-card-editor"), true);
eq("customCards entry", window.customCards[0].type, "wabit-wakeup-card");




/* ------------------------------------------------------- light picker */
const withLight = (over = {}) => ({ ...CONFIG, light_entity: "input_text.bedroom_wakeup_light", ...over });

// No ha-entity-picker in this environment, so the <select> fallback is used.
const lc = new T.WabitWakeupCard();
lc.setConfig(withLight());
lc.hass = hass;

eq("light row exists", !!lc._els.light, true);
eq("light picker kind", lc._els.light.kind, "select");
eq("light card size", lc.getCardSize(), 4);
eq("light sub shows state", lc._els.light.sub.textContent, "on - 40%");
const opts = lc._els.light.picker.children.map((o) => [o.value, o.textContent]);
eq("light options", opts, [
  ["light.bedroom_ceiling_light", "Bedroom ceiling light"],
  ["light.bedside_lamp", "Bedside lamp"],
]);
eq("light select value", lc._els.light.picker.value, "light.bedroom_ceiling_light");

// Choosing a different light writes to the helper.
let n = calls.length;
lc._els.light.picker.value = "light.bedside_lamp";
lc._els.light.picker._fire("change");
eq("light change calls set_value", calls.at(-1),
   ["input_text", "set_value",
    { entity_id: "input_text.bedroom_wakeup_light", value: "light.bedside_lamp" }]);

// Re-selecting the current value must not call the service again.
n = calls.length;
lc._els.light.picker.value = "light.bedroom_ceiling_light";
lc._els.light.picker._fire("change");
eq("light no-op makes no call", calls.length, n);

// Clearing must be refused rather than silently sending the automation to its fallback.
n = calls.length;
lc._els.light.picker.value = "";
lc._els.light.picker._fire("change");
eq("clearing light makes no call", calls.length, n);
eq("clearing light snaps back", lc._els.light.picker.value, "light.bedroom_ceiling_light");

// The option list is rebuilt, not appended to, when hass changes.
lc.hass = hass;
eq("options not duplicated", lc._els.light.picker.children.length, 2);

// An off light, and one that no longer exists.
const hass2 = { ...hass, states: { ...hass.states,
  "input_text.bedroom_wakeup_light": { state: "light.bedside_lamp", attributes: {} } } };
lc.hass = hass2;
eq("off light sub", lc._els.light.sub.textContent, "off");

const hass3 = { ...hass, states: { ...hass.states,
  "input_text.bedroom_wakeup_light": { state: "light.ghost", attributes: {} } } };
lc.hass = hass3;
eq("missing light sub", lc._els.light.sub.textContent, "light.ghost not found");
eq("missing light flagged", lc._els.light.row.classList.contains("missing"), true);
eq("unknown light still selectable", lc._els.light.picker.value, "light.ghost");

// Helper itself absent.
const lc2 = new T.WabitWakeupCard();
lc2.setConfig(withLight({ light_entity: "input_text.nope" }));
lc2.hass = hass;
eq("absent helper sub", lc2._els.light.sub.textContent, "input_text.nope is missing");
eq("absent helper disables picker", lc2._els.light.picker.disabled, true);

// input_select helpers use select_option instead.
const lc3 = new T.WabitWakeupCard();
lc3.setConfig(withLight({ light_entity: "input_select.bedroom_wakeup_light" }));
lc3.hass = hass;
lc3._els.light.picker.value = "light.bedside_lamp";
lc3._els.light.picker._fire("change");
eq("input_select uses select_option", calls.at(-1),
   ["input_select", "select_option",
    { entity_id: "input_select.bedroom_wakeup_light", option: "light.bedside_lamp" }]);

// With ha-entity-picker available the card uses it instead.
customElements.define("ha-entity-picker", class {});
const lc4 = new T.WabitWakeupCard();
lc4.setConfig(withLight());
lc4.hass = hass;
eq("uses entity picker", lc4._els.light.kind, "picker");
eq("picker domains", lc4._els.light.picker.includeDomains, ["light"]);
eq("picker value synced", lc4._els.light.picker.value, "light.bedroom_ceiling_light");
lc4._els.light.picker._handlers["value-changed"][0](
  { stopPropagation() {}, detail: { value: "light.bedside_lamp" } });
eq("picker change calls set_value", calls.at(-1),
   ["input_text", "set_value",
    { entity_id: "input_text.bedroom_wakeup_light", value: "light.bedside_lamp" }]);
delete customElements._d["ha-entity-picker"];

// No light configured -> no row at all.
const lc5 = new T.WabitWakeupCard();
lc5.setConfig(CONFIG);
lc5.hass = hass;
eq("no light row when unconfigured", lc5._els.light, null);

throws("bad light helper domain",
  () => new T.WabitWakeupCard().setConfig({ light_entity: "light.x", schedules: [{}] }),
  "must be an input_text or input_select");

eq("stub picks up light helper",
   T.WabitWakeupCard.getStubConfig(hass).light_entity, "input_text.bedroom_wakeup_light");


/* ----------------------------------------------------- settings button */
const sc = new T.WabitWakeupCard();
sc.setConfig(withLight());
sc.hass = hass;

const scCard = sc.shadowRoot.children.find((e) => e.tagName === "HA-CARD");
const scHeader = scCard.children.find((e) => e.classList.contains("header"));
eq("header rendered by the card", !!scHeader, true);
eq("title not left to ha-card", scCard.getAttribute("header"), undefined);
eq("title text", scHeader.children[0].textContent, "Bedroom Wakeup");

const scGear = scHeader.children.find((e) => e.classList.contains("gear"));
eq("gear present", !!scGear, true);
eq("gear starts collapsed", scGear.getAttribute("aria-expanded"), "false");
eq("panel starts collapsed", sc._els.settings.panel.classList.contains("open"), false);

// The configuration rows live inside the panel, not loose in the body.
const scBody = scCard.children.find((e) => e.classList.contains("body"));
const inPanel = (el) => {
  const inner = sc._els.settings.panel.children[0];
  return inner.children.includes(el);
};
eq("light row is in the panel", inPanel(sc._els.light.row), true);
eq("fade row is in the panel", inPanel(sc._els.fade.row), true);
eq("schedule rows stay in the body", scBody.children.includes(sc._els.rows[0].row), true);

// Toggling.
scGear._fire("click");
eq("gear opens panel", sc._els.settings.panel.classList.contains("open"), true);
eq("gear marked expanded", scGear.getAttribute("aria-expanded"), "true");
eq("gear gets open styling", scGear.classList.contains("open"), true);
scGear._fire("click");
eq("gear closes panel", sc._els.settings.panel.classList.contains("open"), false);
eq("gear marked collapsed", scGear.getAttribute("aria-expanded"), "false");

// Opening the panel must not disturb the controls inside it.
scGear._fire("click");
eq("fade still usable when open", sc._els.fade.slider.value, "5");
eq("light still usable when open", sc._els.light.picker.value, "light.bedroom_ceiling_light");

// show_settings: false puts everything back inline.
const sc2 = new T.WabitWakeupCard();
sc2.setConfig(withLight({ show_settings: false }));
sc2.hass = hass;
eq("no panel when disabled", sc2._els.settings, null);
eq("inline card size", sc2.getCardSize(), 6);
const sc2Card = sc2.shadowRoot.children.find((e) => e.tagName === "HA-CARD");
const sc2Header = sc2Card.children.find((e) => e.classList.contains("header"));
eq("no gear when disabled", sc2Header.children.some((e) => e.classList.contains("gear")), false);
const sc2Body = sc2Card.children.find((e) => e.classList.contains("body"));
eq("light row inline", sc2Body.children.includes(sc2._els.light.row), true);

// Nothing to configure -> no gear, even with settings enabled.
const sc3 = new T.WabitWakeupCard();
sc3.setConfig({ title: "Bare", schedules: [{ name: "X", time: "input_datetime.bedroom_weekday_wakeup_time" }] });
sc3.hass = hass;
eq("no gear with nothing to tuck", sc3._els.settings, null);
const sc3Header = sc3.shadowRoot.children
  .find((e) => e.tagName === "HA-CARD").children.find((e) => e.classList.contains("header"));
eq("header still shows title", sc3Header.children[0].textContent, "Bare");
eq("no gear rendered", sc3Header.children.some((e) => e.classList.contains("gear")), false);

// No title but settings available -> header exists just for the gear.
const sc4 = new T.WabitWakeupCard();
sc4.setConfig(withLight({ title: "" }));
sc4.hass = hass;
const sc4Header = sc4.shadowRoot.children
  .find((e) => e.tagName === "HA-CARD").children.find((e) => e.classList.contains("header"));
eq("headerless title still gets a gear", !!sc4Header, true);
eq("empty title text", sc4Header.children[0].textContent, "");
eq("gear present without title", sc4Header.children.some((e) => e.classList.contains("gear")), true);

/* ---------------------------------- live fade, with the clock pinned */
const RealDate = Date;
function pinClock(y, mo, d, h, mi) {
  globalThis.Date = class extends RealDate {
    constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(y, mo, d, h, mi, 0); }
    static now() { return new RealDate(y, mo, d, h, mi, 0).getTime(); }
  };
}

// Thursday 2026-10-01 06:57 -> 2 min into the 06:55 -> 07:00 weekday fade
pinClock(2026, 9, 1, 6, 57);
const live = new T.WabitWakeupCard();
live.setConfig(CONFIG);
live.hass = hass;
eq("live eyebrow", live._els.hero.eyebrow.textContent, "Fading now");
eq("live pct chip", live._els.hero.chip.textContent, "40%");
eq("live ramp class", live._els.hero.ramp.classList.contains("live"), true);
eq("live veil transform", live._els.hero.veil.style.transform, "scaleX(0.6)");
eq("live hero time", live._els.hero.time.textContent, "06:55");

// Thursday 06:00 -> not fading yet, countdown should read 55m
pinClock(2026, 9, 1, 6, 0);
const soon = new T.WabitWakeupCard();
soon.setConfig(CONFIG);
soon.hass = hass;
eq("pre-fade eyebrow", soon._els.hero.eyebrow.textContent, "Next wakeup");
eq("pre-fade countdown", soon._els.hero.chip.textContent, "in 55m");
eq("pre-fade ramp idle", soon._els.hero.ramp.classList.contains("live"), false);
eq("pre-fade veil full", soon._els.hero.veil.style.transform, "scaleX(1)");

// Saturday 09:00 -> weekday is disabled-for-today, weekend is off, so the
// only enabled schedule (weekday) must still be the one shown, next Monday.
pinClock(2026, 9, 3, 9, 0);
const sat = new T.WabitWakeupCard();
sat.setConfig(CONFIG);
sat.hass = hass;
eq("saturday picks weekday", sat._els.hero.name.textContent, "Weekday");
// Sat 09:00 -> Mon 06:55 is 45h 55m
eq("saturday countdown", sat._els.hero.chip.textContent, "in 1d 21h");
globalThis.Date = RealDate;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
