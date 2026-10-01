/**
 * Tests for wabit-room-lights-card.
 *
 *   node test/room-card.test.mjs
 */
import { loadCards, harness } from "./dom-stub.mjs";

const T = loadCards(process.argv[2]);
const { eq, throws, done } = harness();

/* --------------------------------------------------------------- fixture */
const calls = [];
const st = (over) => ({ state: "off", attributes: {}, ...over });

const hass = {
  themes: { darkMode: false },
  areas: {
    living_room: { area_id: "living_room", name: "Living Room", aliases: ["lounge"] },
    bedroom_2: { area_id: "bedroom_2", name: "Bedroom", aliases: [] },
    empty_room: { area_id: "empty_room", name: "Empty Room", aliases: [] },
    dead_room: { area_id: "dead_room", name: "Dead Room", aliases: [] },
  },
  devices: {
    d_group: { area_id: "living_room" },
    d_spot: { area_id: "living_room" },
    d_ap: { area_id: "living_room" },
    d_bed: { area_id: "bedroom_2" },
    d_none: { area_id: null },
    d_dead: { area_id: "dead_room" },
  },
  entities: {
    // area inherited from the device - the normal case
    "light.lr_ceiling": { entity_id: "light.lr_ceiling", device_id: "d_group" },
    "light.lr_spot_1": { entity_id: "light.lr_spot_1", device_id: "d_spot" },
    "light.lr_spot_2": { entity_id: "light.lr_spot_2", device_id: "d_spot" },
    // area set on the entity itself, overriding its device
    "light.lr_accent": { entity_id: "light.lr_accent", device_id: "d_bed", area_id: "living_room" },
    // noise that must not appear
    "light.ap_led": { entity_id: "light.ap_led", device_id: "d_ap", entity_category: "config" },
    "light.lr_hidden": { entity_id: "light.lr_hidden", device_id: "d_spot", hidden: true },
    "light.lr_disabled": { entity_id: "light.lr_disabled", device_id: "d_spot", disabled_by: "user" },
    "light.lr_ghost": { entity_id: "light.lr_ghost", device_id: "d_spot" }, // no state
    "light.orphan": { entity_id: "light.orphan", device_id: "d_none" },
    "switch.lr_fan": { entity_id: "switch.lr_fan", device_id: "d_spot" },
    "light.bed_strip": { entity_id: "light.bed_strip", device_id: "d_bed" },
    "light.ghost_group": { entity_id: "light.ghost_group", device_id: "d_dead" },
  },
  states: {
    "light.lr_ceiling": st({
      state: "on",
      attributes: {
        friendly_name: "Living Room - Ceiling All",
        supported_color_modes: ["color_temp", "xy"],
        brightness: 255, color_temp_kelvin: 4255,
        min_color_temp_kelvin: 2202, max_color_temp_kelvin: 6535,
        hs_color: [26.7, 30.4], rgb_color: [255, 212, 177],
        group_entities: ["light.lr_spot_1", "light.lr_spot_2"],
      },
    }),
    "light.lr_spot_1": st({
      state: "on",
      attributes: {
        friendly_name: "Living Room Spot 1",
        supported_color_modes: ["color_temp", "xy"], brightness: 128,
        min_color_temp_kelvin: 2202, max_color_temp_kelvin: 6535,
      },
    }),
    "light.lr_spot_2": st({
      attributes: { friendly_name: "Living Room Spot 2", supported_color_modes: ["color_temp", "xy"] },
    }),
    "light.lr_accent": st({
      state: "on",
      attributes: {
        friendly_name: "Living Room Accent", supported_color_modes: ["hs"],
        brightness: 51, hs_color: [280, 85], rgb_color: [200, 80, 255],
      },
    }),
    "light.ap_led": st({ state: "on", attributes: { supported_color_modes: ["onoff"] } }),
    "light.lr_hidden": st({ state: "on", attributes: {} }),
    "light.lr_disabled": st({ state: "on", attributes: {} }),
    "light.orphan": st({ state: "on", attributes: {} }),
    "light.bed_strip": st({
      attributes: { friendly_name: "Bedroom Strip", supported_color_modes: ["onoff"] },
    }),
    "light.ghost_group": st({
      state: "unavailable",
      attributes: { friendly_name: "Dead Room - Ghost Group",
                    supported_color_modes: ["color_temp", "xy"] },
    }),
  },
  callService: (d, s, data) => calls.push([d, s, data]),
};

const mk = (cfg) => {
  const c = new T.WabitRoomLightsCard();
  c.setConfig(cfg);
  c.hass = hass;
  return c;
};

/* ------------------------------------------------------------- utilities */
eq("area by id", T.resolveAreaId(hass, "living_room"), "living_room");
eq("area by name", T.resolveAreaId(hass, "Living Room"), "living_room");
eq("area by name, odd case", T.resolveAreaId(hass, "  lIvInG rOoM "), "living_room");
eq("area by alias", T.resolveAreaId(hass, "lounge"), "living_room");
eq("unknown area", T.resolveAreaId(hass, "atlantis"), null);

eq("lights in area", T.lightsInArea(hass, "living_room").sort(),
   ["light.lr_accent", "light.lr_ceiling", "light.lr_spot_1", "light.lr_spot_2"]);
eq("lights in other area", T.lightsInArea(hass, "bedroom_2"), ["light.bed_strip"]);
eq("empty area", T.lightsInArea(hass, "empty_room"), []);

eq("group members", [...T.groupMemberIds(hass, ["light.lr_ceiling"])].sort(),
   ["light.lr_spot_1", "light.lr_spot_2"]);

eq("brightness full", T.brightnessPct(hass.states["light.lr_ceiling"]), 100);
eq("brightness half", T.brightnessPct(hass.states["light.lr_spot_1"]), 50);
eq("brightness off", T.brightnessPct(hass.states["light.lr_spot_2"]), 0);
eq("brightness on-without-attr", T.brightnessPct({ state: "on", attributes: {} }), 100);
eq("supports brightness", T.supportsBrightness(hass.states["light.lr_ceiling"]), true);
eq("onoff has no brightness", T.supportsBrightness(hass.states["light.bed_strip"]), false);
eq("xy counts as colour", T.supportsColour(hass.states["light.lr_ceiling"]), true);
eq("onoff has no colour", T.supportsColour(hass.states["light.bed_strip"]), false);
eq("supports temp", T.supportsTemp(hass.states["light.lr_ceiling"]), true);
eq("hs-only has no temp", T.supportsTemp(hass.states["light.lr_accent"]), false);
eq("colour css from rgb", T.lightColourCss(hass.states["light.lr_accent"]), "rgb(200,80,255)");
eq("colour css when off", T.lightColourCss(hass.states["light.lr_spot_2"]), null);
eq("kelvin css shape", /^rgb\(\d+, \d+, \d+\)$/.test(T.kelvinToCss(2700)), true);

/* ------------------------------------------------------------ discovery */
const all = mk({ area: "living_room" });
eq("shows every light by default", all._lastModel.pinned,
   ["light.lr_accent", "light.lr_ceiling", "light.lr_spot_1", "light.lr_spot_2"]);
eq("nothing hidden by default", all._lastModel.extra, []);
eq("expander hidden", all._els.moreBtn.classList.contains("hidden"), true);
eq("area name resolved", all._lastModel.areaName, "Living Room");
eq("strips the room name", all._els.rows.get("light.lr_ceiling").name.textContent, "Ceiling All");
eq("strips without a dash", all._els.rows.get("light.lr_spot_1").name.textContent, "Spot 1");

const noStrip = mk({ area: "living_room", strip_area_name: false });
eq("keeps full name when asked",
   noStrip._els.rows.get("light.lr_ceiling").name.textContent, "Living Room - Ceiling All");

/* --------------------------------------------------------- pin and hide */
const pinned = mk({ area: "lounge", pinned: ["light.lr_ceiling", "light.lr_accent"] });
eq("pinned kept in config order", pinned._lastModel.pinned, ["light.lr_ceiling", "light.lr_accent"]);
eq("rest moved to the expander", pinned._lastModel.extra, ["light.lr_spot_1", "light.lr_spot_2"]);
eq("expander label", pinned._els.moreLabel.textContent, "2 more");
eq("expander shown", pinned._els.moreBtn.classList.contains("hidden"), false);
eq("expander starts closed", pinned._els.more.classList.contains("open"), false);
pinned._els.moreBtn._fire("click");
eq("expander opens", pinned._els.more.classList.contains("open"), true);
eq("expander label flips", pinned._els.moreLabel.textContent, "Show less");
eq("expander chevron flips", pinned._els.moreBtn.classList.contains("open"), true);
eq("expander aria", pinned._els.moreBtn.getAttribute("aria-expanded"), "true");
pinned._els.moreBtn._fire("click");
eq("expander closes", pinned._els.more.classList.contains("open"), false);

const ghostPin = mk({ area: "living_room", pinned: ["light.lr_ceiling", "light.not_here"] });
eq("pinned entries outside the area are dropped", ghostPin._lastModel.pinned, ["light.lr_ceiling"]);

const grouped = mk({ area: "living_room", collapse_groups: true });
eq("group members tucked away", grouped._lastModel.pinned, ["light.lr_accent", "light.lr_ceiling"]);
eq("members are the extras", grouped._lastModel.extra, ["light.lr_spot_1", "light.lr_spot_2"]);

const excluded = mk({ area: "living_room", exclude: ["light.lr_spot_1", "light.lr_spot_2"] });
eq("excluded lights never appear", excluded._lastModel.pinned,
   ["light.lr_accent", "light.lr_ceiling"]);

/* ------------------------------------------------------------- rendering */
eq("lit row flagged", all._els.rows.get("light.lr_ceiling").bulb.classList.contains("lit"), true);
eq("unlit row flagged", all._els.rows.get("light.lr_spot_2").wrap.classList.contains("off"), true);
eq("percent shown", all._els.rows.get("light.lr_spot_1").pct.textContent, "50%");
eq("off shown", all._els.rows.get("light.lr_spot_2").pct.textContent, "Off");
eq("slider tracks brightness", all._els.rows.get("light.lr_spot_1").dim.value, "50");
eq("slider disabled when off", all._els.rows.get("light.lr_spot_2").dim.disabled, true);
eq("header title", all._els.header.title.textContent, "Living Room");
eq("header summary", all._els.header.summary.textContent, "3 of 4 on - 57%");
eq("header lit", all._els.header.all.classList.contains("lit"), true);
eq("card size reflects pinned", all.getCardSize(), 9);

const bed = mk({ area: "bedroom_2" });
eq("onoff light has no slider", bed._els.rows.get("light.bed_strip").briWrap.classList.contains("hidden"), true);
eq("onoff light has no colour button", bed._els.rows.get("light.bed_strip").swatchBtn.style.display, "none");
eq("onoff light reads Off", bed._els.rows.get("light.bed_strip").pct.textContent, "Off");
eq("all-off summary", bed._els.header.summary.textContent, "All off - 1 light");
eq("header not lit", bed._els.header.all.classList.contains("lit"), false);

const custom = mk({ area: "living_room", title: "Lounge lamps" });
eq("custom title wins", custom._els.header.title.textContent, "Lounge lamps");
const noHeader = mk({ area: "living_room", show_header: false });
eq("header can be turned off", noHeader._els.header, undefined);

/* ---------------------------------------------------------- interactions */
let n = calls.length;
all._els.rows.get("light.lr_spot_2").bulb._fire("click");
eq("toggle call", calls.at(-1), ["light", "toggle", { entity_id: "light.lr_spot_2" }]);

const dim = all._els.rows.get("light.lr_spot_1").dim;
dim.value = "73";
dim._fire("change");
eq("brightness call", calls.at(-1),
   ["light", "turn_on", { entity_id: "light.lr_spot_1", brightness_pct: 73 }]);

all._els.header.all._fire("click");
eq("master turns everything off when any are on", calls.at(-1),
   ["light", "turn_off", { entity_id: ["light.lr_accent", "light.lr_ceiling",
                                        "light.lr_spot_1", "light.lr_spot_2"] }]);
bed._els.header.all._fire("click");
eq("master turns on when all are off", calls.at(-1),
   ["light", "turn_on", { entity_id: ["light.bed_strip"] }]);

/* -------------------------------------------------------- colour controls */
const ceilRow = all._els.rows.get("light.lr_ceiling");
eq("colour panel is lazy", ceilRow.colourBuilt, false);
ceilRow.swatchBtn._fire("click");
eq("colour panel built on open", ceilRow.colourBuilt, true);
eq("colour panel open", ceilRow.colour.classList.contains("open"), true);
eq("temp slider for a colour_temp light", !!ceilRow.controls.temp, true);
eq("temp range from the light", [ceilRow.controls.temp.min, ceilRow.controls.temp.max],
   ["2202", "6535"]);
eq("temp slider tracks state", ceilRow.controls.temp.value, "4255");
eq("xy light also gets hue", !!ceilRow.controls.hue, true);

ceilRow.controls.temp.value = "3000";
ceilRow.controls.temp._fire("change");
eq("temp call", calls.at(-1),
   ["light", "turn_on", { entity_id: "light.lr_ceiling", color_temp_kelvin: 3000 }]);

const accentRow = all._els.rows.get("light.lr_accent");
accentRow.swatchBtn._fire("click");
eq("hs light has no temp slider", accentRow.controls.temp, null);
eq("hs light has hue", !!accentRow.controls.hue, true);
eq("hue tracks state", accentRow.controls.hue.value, "280");
eq("sat tracks state", accentRow.controls.sat.value, "85");
accentRow.controls.hue.value = "120";
accentRow.controls.hue._fire("change");
eq("hue change keeps saturation", calls.at(-1),
   ["light", "turn_on", { entity_id: "light.lr_accent", hs_color: [120, 85] }]);
accentRow.controls.sat.value = "40";
accentRow.controls.sat._fire("change");
eq("sat change keeps hue", calls.at(-1),
   ["light", "turn_on", { entity_id: "light.lr_accent", hs_color: [280, 40] }]);

ceilRow.swatchBtn._fire("click");
eq("colour panel closes", ceilRow.colour.classList.contains("open"), false);

/* --------------------------------------------------------- failure modes */
const unknown = mk({ area: "atlantis" });
eq("unknown area message", unknown._els.error.textContent, 'No area called "atlantis".');
eq("unknown area hides the list", unknown._els.pinned.style.display, "none");

const oldHass = { ...hass, entities: undefined, areas: undefined };
const noReg = new T.WabitRoomLightsCard();
noReg.setConfig({ area: "living_room" });
noReg.hass = oldHass;
eq("no registry message",
   noReg._els.error.textContent,
   "This Home Assistant build does not expose the area registry to cards.");

const empty = mk({ area: "empty_room" });
eq("empty room message", empty._els.pinned.children[0].textContent,
   "No lights found in Empty Room.");
eq("empty room has no expander", empty._els.moreBtn.classList.contains("hidden"), true);

throws("area is required", () => new T.WabitRoomLightsCard().setConfig({}), "`area` is required");
throws("pinned must be lights",
  () => new T.WabitRoomLightsCard().setConfig({ area: "x", pinned: ["switch.a"] }),
  "may only contain light entities");
throws("pinned must be a list",
  () => new T.WabitRoomLightsCard().setConfig({ area: "x", pinned: "light.a" }),
  "must be a list");

eq("stub picks the busiest room", T.WabitRoomLightsCard.getStubConfig(hass).area, "living_room");
eq("registered", !!customElements.get("wabit-room-lights-card"), true);
eq("editor registered", !!customElements.get("wabit-room-lights-card-editor"), true);
eq("listed in the picker",
   window.customCards.some((c) => c.type === "wabit-room-lights-card"), true);


/* ------------------------------------------------- unavailable lights */
const deadCard = mk({ area: "dead_room" });
const deadRow = deadCard._els.rows.get("light.ghost_group");
eq("unavailable reads as such", deadRow.pct.textContent, "Unavailable");
eq("unavailable row flagged", deadRow.wrap.classList.contains("dead"), true);
eq("unavailable toggle disabled", deadRow.bulb.disabled, true);
eq("unavailable slider disabled", deadRow.dim.disabled, true);
eq("unavailable hides colour button", deadRow.swatchBtn.style.display, "none");
eq("unavailable counts as not-on", deadCard._els.header.summary.textContent, "All off - 1 light");

/* --------------------------------------------------- editor reordering */
customElements.define("ha-form", class {});
const edCfg = { area: "living_room",
                pinned: ["light.lr_ceiling", "light.lr_accent", "light.lr_spot_1"] };
const ed = new T.WabitRoomLightsCardEditor();
const emitted = [];
ed.addEventListener("config-changed", (ev) => emitted.push(ev.detail.config));
ed.setConfig(edCfg);
ed.hass = hass;

const rows = () => ed._els.list.children.filter((c) => c.classList.contains("pin-row"));
eq("one row per pinned light", rows().length, 3);
eq("row shows the friendly name", rows()[0].children[0].textContent, "Living Room - Ceiling All");
eq("first row cannot move up", rows()[0].children[1].disabled, true);
eq("first row can move down", rows()[0].children[2].disabled, false);
eq("last row cannot move down", rows()[2].children[2].disabled, true);

rows()[0].children[2]._fire("click");           // move Ceiling down
eq("move down reorders", emitted.at(-1).pinned,
   ["light.lr_accent", "light.lr_ceiling", "light.lr_spot_1"]);
eq("list re-rendered in new order", rows()[0].children[0].textContent, "Living Room Accent");

rows()[2].children[1]._fire("click");           // move Spot 1 up
eq("move up reorders", emitted.at(-1).pinned,
   ["light.lr_accent", "light.lr_spot_1", "light.lr_ceiling"]);

rows()[1].children[3]._fire("click");           // remove Spot 1
eq("remove drops the entry", emitted.at(-1).pinned,
   ["light.lr_accent", "light.lr_ceiling"]);

// Emptying the list must drop the key entirely, which means "show everything".
rows()[0].children[3]._fire("click");
rows()[0].children[3]._fire("click");
eq("empty list removes the key", "pinned" in emitted.at(-1), false);
eq("empty state explained", ed._els.list.children[0].classList.contains("empty-pins"), true);

// The add picker offers the room's other lights, minus whatever is already pinned.
const sel = ed._els.add.children[0];
eq("add control is a select here", sel.tagName, "select");
// Sorted by label: "Living Room - Ceiling All" collates before "Living Room Accent".
eq("offers every area light when none pinned",
   sel.children.slice(1).map((o) => o.value),
   ["light.lr_ceiling", "light.lr_accent", "light.lr_spot_1", "light.lr_spot_2"]);
sel.value = "light.lr_spot_2";
sel._fire("change");
eq("adding pins it", emitted.at(-1).pinned, ["light.lr_spot_2"]);
eq("added light leaves the candidate list",
   ed._els.add.children[0].children.slice(1).map((o) => o.value),
   ["light.lr_ceiling", "light.lr_accent", "light.lr_spot_1"]);
eq("adding a duplicate is ignored", (() => {
  const before = emitted.length;
  ed._addPin("light.lr_spot_2");
  return emitted.length === before;
})(), true);

// A pinned entity that has since disappeared is called out rather than hidden.
const ed2 = new T.WabitRoomLightsCardEditor();
ed2.setConfig({ area: "living_room", pinned: ["light.vanished"] });
ed2.hass = hass;
const missRow = ed2._els.list.children.filter((c) => c.classList.contains("pin-row"))[0];
eq("missing pin flagged", missRow.children[0].textContent, "light.vanished (not found)");
eq("missing pin styled", missRow.children[0].classList.contains("missing"), true);
delete customElements._d["ha-form"];



/* ------------------------------- editor stability across hass updates ---
   `hass` is replaced on every state change in the house. Rebuilding the add
   picker each time tore it down under the user's cursor: the dropdown
   flickered and would not stay open. Nothing here may be recreated. */
customElements.define("ha-form", class {});
const stable = new T.WabitRoomLightsCardEditor();
stable.setConfig({ area: "living_room", pinned: ["light.lr_ceiling", "light.lr_accent"] });
stable.hass = hass;

const pickerBefore = stable._els.picker;
const rowsBefore = stable._els.rows.map((r) => r.row);
const optionsBefore = stable._els.picker.children.length;

// Simulate a busy house: many hass objects in quick succession.
for (let i = 0; i < 25; i++) {
  stable.hass = { ...hass, states: { ...hass.states } };
}
eq("add picker survives hass updates", stable._els.picker === pickerBefore, true);
eq("add picker is not re-appended", stable._els.add.children.length, 1);
eq("add options are not rebuilt", stable._els.picker.children.length, optionsBefore);
eq("pin rows survive hass updates",
   stable._els.rows.map((r) => r.row).every((r, i) => r === rowsBefore[i]), true);
eq("pin rows are not duplicated", stable._els.list.children.length, 2);

// Changing the pinned list must still rebuild the rows.
stable._move(0, 1);
eq("reorder still rebuilds the rows", stable._els.rows[0].id, "light.lr_accent");
eq("still two rows after reorder", stable._els.list.children.length, 2);

// A light being renamed updates the text in place, without new elements.
const renamedRow = stable._els.rows[0].row;
stable.hass = { ...hass, states: { ...hass.states,
  "light.lr_accent": { ...hass.states["light.lr_accent"],
    attributes: { ...hass.states["light.lr_accent"].attributes,
                  friendly_name: "Living Room Mood" } } } };
eq("rename updates the label", stable._els.rows[0].name.textContent, "Living Room Mood");
eq("rename does not rebuild the row", stable._els.rows[0].row === renamedRow, true);

// Pinning a light must drop it from the candidate list.
const beforeAdd = stable._els.picker.children.length;
stable._addPin("light.lr_spot_1");
eq("adding a pin shrinks the candidates",
   stable._els.picker.children.length, beforeAdd - 1);
eq("add control still the same element", stable._els.picker === pickerBefore, true);

// Same guarantee when Home Assistant provides its own entity picker.
customElements.define("ha-entity-picker", class {});
const withPicker = new T.WabitRoomLightsCardEditor();
withPicker.setConfig({ area: "living_room", pinned: ["light.lr_ceiling"] });
withPicker.hass = hass;
eq("uses the HA picker", withPicker._els.add_kind, "picker");
const haPicker = withPicker._els.picker;
const includeBefore = haPicker.includeEntities;
for (let i = 0; i < 10; i++) {
  withPicker.hass = { ...hass, states: { ...hass.states } };
}
eq("HA picker survives hass updates", withPicker._els.picker === haPicker, true);
eq("HA picker candidate list untouched", withPicker._els.picker.includeEntities, includeBefore);
eq("HA picker still gets fresh hass", !!withPicker._els.picker.hass, true);
delete customElements._d["ha-entity-picker"];
delete customElements._d["ha-form"];


done("room-lights");
