/**
 * Shared test scaffolding for the Wabit cards.
 *
 * The cards are browser scripts, so this stubs just enough of the DOM to load
 * them in node and drive the real setConfig/_build/_update code paths.
 */
import fs from "fs";


/* ------------------------------------------------ minimal DOM stand-in */
function mkEl(tag) {
  const classes = new Set();
  const handlers = {};
  const el = {
    tagName: tag,
    children: [],
    _handlers: handlers,
    textContent: "",
    title: "",
    style: {},
    attrs: {},
    get className() { return [...classes].join(" "); },
    set className(v) {
      classes.clear();
      String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
    },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, force) => {
        const on = force === undefined ? !classes.has(c) : !!force;
        if (on) classes.add(c); else classes.delete(c);
        return on;
      },
    },
    setAttribute(n, v) { el.attrs[n] = v; },
    get innerHTML() { return ""; },
    set innerHTML(_) { el.children.length = 0; },
    getAttribute(n) { return el.attrs[n]; },
    appendChild(c) { el.children.push(c); return c; },
    append(...cs) { cs.forEach((c) => el.children.push(c)); },
    addEventListener(t, fn) { (handlers[t] = handlers[t] || []).push(fn); },
    dispatchEvent() { return true; },
    _fire(t) { (handlers[t] || []).forEach((fn) => fn({ stopPropagation() {} })); },
  };
  return el;
}

function mkShadow() {
  const root = mkEl("#shadow");
  root.activeElement = null;
  Object.defineProperty(root, "innerHTML", {
    get() { return ""; },
    set() { root.children.length = 0; },
  });
  return root;
}

globalThis.HTMLElement = class {
  constructor() { this.style = {}; this.shadowRoot = null; this._handlers = {}; }
  attachShadow() { this.shadowRoot = mkShadow(); return this.shadowRoot; }
  addEventListener(t, fn) { (this._handlers[t] = this._handlers[t] || []).push(fn); }
  dispatchEvent(ev) { (this._handlers[ev.type] || []).forEach((fn) => fn(ev)); return true; }
};
globalThis.document = { createElement: mkEl };
globalThis.customElements = { _d: {}, get(n) { return this._d[n]; }, define(n, c) { this._d[n] = c; } };
globalThis.window = { customCards: [], setInterval: () => 0, clearInterval: () => {} };
globalThis.Event = class { constructor(t) { this.type = t; } };

/* ------------------------------------------------------- load the card */
const target = process.argv[2] || new URL("../dist/wabit-cards.js", import.meta.url).pathname;

/** Symbols pulled out of the bundle so tests can reach internals. */
const EXPORTS = [
  // wakeup card
  "timeToMinutes", "minutesToTime", "humanDuration", "normaliseDays",
  "minutesUntilNext", "WabitWakeupCard", "WabitWakeupCardEditor",
  // room lights card
  "resolveAreaId", "lightsInArea", "groupMemberIds", "brightnessPct",
  "lightColourCss", "supportsBrightness", "supportsColour", "supportsTemp",
  "kelvinToCss", "WabitRoomLightsCard", "WabitRoomLightsCardEditor",
];

export { mkEl, mkShadow };

export function loadCards(target) {
  const path = target || new URL("../dist/wabit-cards.js", import.meta.url).pathname;
  const src =
    fs.readFileSync(path, "utf8") +
    `\nglobalThis.__T = { ${EXPORTS.join(", ")} };`;
  new Function(src)();
  return globalThis.__T;
}

/** Tiny assertion helpers shared by the suites. */
export function harness() {
  const state = { pass: 0, fail: 0 };
  const eq = (label, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) state.pass++;
    else { state.fail++; console.log(`FAIL ${label}\n     got  ${g}\n     want ${w}`); }
  };
  const throws = (label, fn, frag) => {
    try { fn(); state.fail++; console.log(`FAIL ${label} (no throw)`); }
    catch (e) {
      if (String(e.message).includes(frag)) state.pass++;
      else { state.fail++; console.log(`FAIL ${label}: ${e.message}`); }
    }
  };
  const done = (name) => {
    console.log(`\n${name}: ${state.pass} passed, ${state.fail} failed`);
    if (state.fail) process.exitCode = 1;
  };
  return { eq, throws, done, state };
}
