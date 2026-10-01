/**
 * Wabit Cards - a small suite of Home Assistant dashboard cards.
 * https://github.com/wabit/wabit-hacs-dashboard
 *
 * Zero dependencies and no build step: this file is the shipped artifact, so
 * what you read here is exactly what the browser loads.
 *
 * Every colour comes from a theme token (Material You `--md-sys-color-*` first,
 * then the standard Home Assistant variables), so the card inherits whatever
 * theme the dashboard is using instead of imposing its own palette.
 */

const VERSION = "1.18.0";
const REPO = "https://github.com/wabit/wabit-hacs-dashboard";

console.info(
  `%c WABIT-CARDS %c v${VERSION} `,
  "color:#fff;background:#3f51b5;font-weight:700;border-radius:3px 0 0 3px;padding:2px 5px",
  "color:#3f51b5;background:#eceff1;font-weight:700;border-radius:0 3px 3px 0;padding:2px 5px"
);

/* -------------------------------------------------------------- utilities */

const pad2 = (n) => String(n).padStart(2, "0");

const NOT_SET = new Set(["unknown", "unavailable", "none", ""]);

function isUnset(raw) {
  return raw === null || raw === undefined || NOT_SET.has(String(raw).trim().toLowerCase());
}

/** "HH:MM:SS" or "HH:MM" -> minutes since midnight, or null when unusable. */
function timeToMinutes(raw) {
  if (isUnset(raw)) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(raw).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** Minutes since midnight (may be negative or past 1440) -> "HH:MM", wrapped into a day. */
function minutesToTime(total) {
  const wrapped = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}

/** 40 -> "40m", 95 -> "1h 35m", 2755 -> "1d 21h" */
function humanDuration(mins) {
  const m = Math.max(0, Math.round(mins));
  if (m >= 1440) {
    const d = Math.floor(m / 1440);
    const h = Math.floor((m % 1440) / 60);
    return h ? `${d}d ${h}h` : `${d}d`;
  }
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

const DAY_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_DISPLAY = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_INITIAL = { mon: "M", tue: "T", wed: "W", thu: "T", fri: "F", sat: "S", sun: "S" };
const DAY_ALIASES = {
  sunday: "sun", monday: "mon", tuesday: "tue", wednesday: "wed",
  thursday: "thu", friday: "fri", saturday: "sat",
};

/** Accepts ["Mon","tuesday"] etc. Returns a clean list, or null when unusable. */
function normaliseDays(days) {
  if (!Array.isArray(days)) return null;
  const out = days
    .map((d) => String(d).trim().toLowerCase())
    .map((d) => DAY_ALIASES[d] || d)
    .filter((d) => DAY_ORDER.includes(d));
  return out.length ? [...new Set(out)] : null;
}

/**
 * Minutes from `now` until `minuteOfDay` next falls on one of `days`.
 * `days` is required - without it we cannot know which days the automation
 * actually runs, and guessing would mean promising a wake-up that never fires.
 */
function minutesUntilNext(now, minuteOfDay, days) {
  if (!days || !days.length) return null;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let offset = 0; offset < 8; offset++) {
    const dayIdx = (now.getDay() + offset) % 7;
    if (!days.includes(DAY_ORDER[dayIdx])) continue;
    if (offset === 0 && minuteOfDay <= nowMin) continue;
    return offset * 1440 + minuteOfDay - nowMin;
  }
  return null;
}

function fireEvent(node, type, detail) {
  const ev = new Event(type, { bubbles: true, composed: true });
  ev.detail = detail || {};
  node.dispatchEvent(ev);
  return ev;
}

/* ------------------------------------------------------ wabit-wakeup-card */

const FADE_FALLBACK = { min: 1, max: 60, step: 1 };

const STYLES = `
  :host {
    display: block;

    /* Theme tokens: Material You first, then core HA, then a safe literal.
       Override any of these per-card with card_mod or a theme if you want. */
    --wc-text: var(--md-sys-color-on-surface, var(--primary-text-color, #212121));
    --wc-muted: var(--md-sys-color-on-surface-variant, var(--secondary-text-color, #727272));
    --wc-accent: var(--md-sys-color-primary, var(--primary-color, #3f51b5));
    --wc-tonal: var(--md-sys-color-surface-container-highest,
                 rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.08));
    --wc-outline: var(--md-sys-color-outline-variant, var(--divider-color, #e0e0e0));
    --wc-accent-tonal: var(--md-sys-color-primary-container,
                        rgba(var(--rgb-primary-color, 63, 81, 181), 0.16));
    --wc-on-accent-tonal: var(--md-sys-color-on-primary-container, var(--wc-accent));
  }

  ha-card { overflow: hidden; }

  /* Mirrors Home Assistant's own .card-header so the title still looks native
     even though we render it ourselves to fit the settings button alongside. */
  .header { display: flex; align-items: center; gap: 8px; padding: 12px 16px 8px; }
  .title {
    flex: 1; min-width: 0;
    color: var(--ha-card-header-color, var(--wc-text));
    font-family: var(--ha-card-header-font-family, inherit);
    font-size: var(--ha-card-header-font-size, 24px);
    font-weight: 400; letter-spacing: -0.012em; line-height: 1.3;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .gear {
    flex: none; display: flex; align-items: center; justify-content: center;
    width: 40px; height: 40px; padding: 0; border: none; border-radius: 50%;
    background: none; cursor: pointer; color: var(--wc-muted);
    transition: background 160ms, color 160ms;
  }
  .gear:hover { background: var(--wc-tonal); color: var(--wc-text); }
  .gear:focus-visible { outline: 2px solid var(--wc-accent); outline-offset: 2px; }
  /* A filled tonal background, not a rotation: a gear glyph is rotationally
     symmetric, so turning it reads as no change at all. */
  .gear.open { background: var(--wc-accent-tonal); color: var(--wc-on-accent-tonal); }
  .gear .icon { color: inherit; --mdc-icon-size: 21px; }

  /* 0fr -> 1fr animates to the content's real height, unlike a guessed max-height. */
  .settings { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 260ms ease; }
  .settings.open { grid-template-rows: 1fr; }
  .settings-inner { overflow: hidden; min-height: 0; }
  .settings-inner .row:first-of-type {
    border-top: 1px solid var(--wc-outline); padding-top: 10px;
  }
  @media (prefers-reduced-motion: reduce) {
    .settings { transition: none; }
  }

  .body { display: flex; flex-direction: column; padding: 16px; }
  .body.tight { padding-top: 6px; }

  /* ---------------------------------------------------------------- hero */
  .hero { display: block; padding: 2px 0 14px; }
  .hero.hidden { display: none; }
  .eyebrow {
    font-size: 0.7rem; letter-spacing: 0.09em; text-transform: uppercase;
    color: var(--wc-muted); font-weight: 600;
  }
  .hero-main {
    display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
    margin-top: 2px;
  }
  .hero-time {
    font-size: 2.6rem; font-weight: 300; line-height: 1.05;
    letter-spacing: -0.02em; color: var(--wc-text);
    font-variant-numeric: tabular-nums;
  }
  .hero-name { font-size: 1rem; color: var(--wc-muted); }
  .hero-chip {
    margin-left: auto; align-self: center;
    font-size: 0.78rem; font-weight: 600; font-variant-numeric: tabular-nums;
    color: var(--wc-on-accent-tonal); background: var(--wc-accent-tonal);
    padding: 4px 10px; border-radius: 999px; white-space: nowrap;
  }
  .hero-chip.hidden { display: none; }

  /* Sunrise ramp: dark -> dawn -> full. Width tracks the fade length. */
  .ramp {
    position: relative; height: 8px; border-radius: 999px; margin-top: 12px;
    background: linear-gradient(90deg, #2c2342 0%, #59386c 20%, #b8553c 50%, #efa94e 76%, #ffeec2 100%);
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.18) inset;
    overflow: hidden; opacity: 0.55; transition: opacity 400ms ease;
  }
  .ramp.live { opacity: 1; }
  .ramp.hidden { display: none; }
  /* Scrims the part of the ramp still to come. Deliberately a translucent
     literal rather than a theme token: an opaque surface colour would hide the
     sunrise gradient underneath it. */
  .ramp-veil {
    position: absolute; inset: 0; left: 0;
    background: rgba(0, 0, 0, 0.5);
    transition: transform 600ms ease;
    transform-origin: right center;
  }
  .ramp.live .ramp-veil { animation: wc-breathe 3.2s ease-in-out infinite; }
  @keyframes wc-breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.72; } }
  @media (prefers-reduced-motion: reduce) {
    .ramp.live .ramp-veil { animation: none; }
    .ramp-veil { transition: none; }
  }
  .ramp-ends {
    display: flex; justify-content: space-between; margin-top: 5px;
    font-size: 0.72rem; color: var(--wc-muted); font-variant-numeric: tabular-nums;
  }
  .ramp-ends.hidden { display: none; }

  /* ---------------------------------------------------------------- rows */
  .row {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center; gap: 12px; padding: 10px 0;
    border-top: 1px solid var(--wc-outline);
  }
  .row.fade-row { grid-template-columns: auto 1fr minmax(78px, 150px) auto; }

  .icon { color: var(--wc-accent); --mdc-icon-size: 22px; transition: color 200ms, opacity 200ms; }
  .row.off .icon { color: var(--wc-muted); opacity: 0.6; }

  .label { min-width: 0; }
  .name {
    color: var(--wc-text); font-size: 0.98rem; line-height: 1.35;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .sub {
    color: var(--wc-muted); font-size: 0.78rem; line-height: 1.35;
    min-height: 1.1em; font-variant-numeric: tabular-nums;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .row.off .name { opacity: 0.6; }
  .row.missing .sub { color: var(--error-color, #db4437); }

  .days { display: flex; gap: 3px; margin-top: 4px; }
  .days.hidden { display: none; }
  .day {
    font-size: 0.62rem; font-weight: 700; line-height: 1;
    width: 15px; height: 15px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    color: var(--wc-muted); background: var(--wc-tonal); opacity: 0.55;
  }
  .day.on {
    color: var(--wc-on-accent-tonal); background: var(--wc-accent-tonal); opacity: 1;
  }

  input.time {
    font: inherit; font-size: 1rem; font-variant-numeric: tabular-nums;
    color: var(--wc-text); background: var(--wc-tonal);
    border: none; border-radius: 999px; padding: 7px 12px;
    min-width: 0; cursor: pointer; transition: background 160ms, opacity 200ms;
  }
  input.time:hover:not(:disabled) { background: var(--wc-accent-tonal); }
  input.time:focus-visible { outline: 2px solid var(--wc-accent); outline-offset: 1px; }
  input.time:disabled { opacity: 0.45; cursor: default; }
  .row.off input.time { opacity: 0.6; }
  input.time::-webkit-calendar-picker-indicator { opacity: 0.55; cursor: pointer; }

  input.slider { width: 100%; accent-color: var(--wc-accent); cursor: pointer; }
  input.slider:disabled { cursor: default; opacity: 0.45; }
  .fade-value {
    font-variant-numeric: tabular-nums; color: var(--wc-muted);
    font-size: 0.85rem; min-width: 3.6em; text-align: right;
  }

  .light-row { grid-template-columns: auto auto minmax(130px, 1fr); }
  .light-row ha-entity-picker { width: 100%; display: block; }
  select.light-select {
    font: inherit; font-size: 0.95rem; width: 100%; cursor: pointer;
    color: var(--wc-text); background: var(--wc-tonal);
    border: none; border-radius: 999px; padding: 7px 12px;
  }
  select.light-select:disabled { opacity: 0.45; cursor: default; }

  .toggle { display: flex; align-items: center; }
  input.fallback-switch { accent-color: var(--wc-accent); width: 18px; height: 18px; }
`;

class WabitWakeupCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("wabit-wakeup-card-editor");
  }

  /** Best-effort guess so the card-picker preview is useful straight away. */
  static getStubConfig(hass) {
    const ids = Object.keys((hass && hass.states) || {});
    const wakeish = (e) => /wake|alarm|sunrise/.test(e);
    const times = ids.filter((e) => e.startsWith("input_datetime.") && wakeish(e)).sort();
    const autos = ids.filter((e) => e.startsWith("automation.") && wakeish(e)).sort();
    const fade = ids.find(
      (e) => e.startsWith("input_number.") && /fade|ramp|transition/.test(e)
    );
    const lightHelper = ids.find(
      (e) => /^(input_text|input_select)\./.test(e) && /light/.test(e) && wakeish(e)
    );

    const pairFor = (time) => {
      const weekend = /weekend|sat|sun/.test(time);
      const match = autos.find((a) => /weekend|sat|sun/.test(a) === weekend);
      const sched = {
        name: weekend ? "Weekend" : "Weekday",
        time,
        days: weekend ? ["sat", "sun"] : ["mon", "tue", "wed", "thu", "fri"],
      };
      if (match) sched.automation = match;
      return sched;
    };

    const schedules = times.length ? times.slice(0, 2).map(pairFor) : [{ name: "Wakeup" }];
    const stub = { type: "custom:wabit-wakeup-card", title: "Wakeup", schedules };
    if (lightHelper) stub.light_entity = lightHelper;
    if (fade) stub.fade_entity = fade;
    return stub;
  }

  setConfig(config) {
    const cfg = config || {};
    const raw = Array.isArray(cfg.schedules) ? cfg.schedules.filter(Boolean) : null;
    if (!raw || !raw.length) {
      throw new Error("wabit-wakeup-card: `schedules` must list at least one entry");
    }
    raw.forEach((s, i) => {
      if (!isUnset(s.time) && !String(s.time).startsWith("input_datetime.")) {
        throw new Error(
          `wabit-wakeup-card: schedules[${i}].time must be an input_datetime entity`
        );
      }
      if (!isUnset(s.automation) && !String(s.automation).startsWith("automation.")) {
        throw new Error(
          `wabit-wakeup-card: schedules[${i}].automation must be an automation entity`
        );
      }
    });
    if (!isUnset(cfg.fade_entity) && !String(cfg.fade_entity).startsWith("input_number.")) {
      throw new Error("wabit-wakeup-card: `fade_entity` must be an input_number entity");
    }
    if (
      !isUnset(cfg.light_entity) &&
      !/^(input_text|input_select)\./.test(String(cfg.light_entity))
    ) {
      throw new Error(
        "wabit-wakeup-card: `light_entity` must be an input_text or input_select entity " +
          "holding the chosen light's entity_id"
      );
    }

    this._config = {
      title: cfg.title === undefined ? "Wakeup" : cfg.title,
      fade_entity: isUnset(cfg.fade_entity) ? null : cfg.fade_entity,
      light_entity: isUnset(cfg.light_entity) ? null : cfg.light_entity,
      fade_mode: cfg.fade_mode === "finish" ? "finish" : "start",
      show_hero: cfg.show_hero !== false,
      show_settings: cfg.show_settings !== false,
      show_ramp: cfg.show_ramp !== false,
      icon: cfg.icon || "mdi:weather-sunset-up",
      schedules: raw.map((s) => ({
        name: s.name || "",
        time: isUnset(s.time) ? null : s.time,
        automation: isUnset(s.automation) ? null : s.automation,
        days: normaliseDays(s.days),
        icon: s.icon || null,
      })),
    };

    // Structure depends on config, so drop the built DOM and start again.
    this._built = false;
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config) this._render();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    // Keeps the countdown and the live fade progress honest between state changes.
    this._tick = window.setInterval(() => {
      if (this._built && this._hass) this._update();
    }, 20000);
  }

  disconnectedCallback() {
    if (this._tick) window.clearInterval(this._tick);
    this._tick = null;
  }

  getCardSize() {
    if (!this._config) return 4;
    const extras =
      (this._config.light_entity ? 1 : 0) + (this._config.fade_entity ? 1 : 0);
    // Settings start collapsed, so they do not contribute to the resting height.
    const tucked = this._config.show_settings && extras > 0;
    return (
      (this._config.show_hero ? 2 : 0) +
      this._config.schedules.length +
      (tucked ? 0 : extras)
    );
  }

  _render() {
    if (!this._config || !this._hass) return;
    if (!this._built) this._build();
    this._update();
  }

  _makeSwitch() {
    if (customElements.get("ha-switch")) return document.createElement("ha-switch");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "fallback-switch";
    return cb;
  }

  _makeIcon(icon) {
    if (customElements.get("ha-icon")) {
      const el = document.createElement("ha-icon");
      el.setAttribute("icon", icon);
      el.className = "icon";
      return el;
    }
    const span = document.createElement("span");
    span.className = "icon";
    return span;
  }

  /** HA's entity picker when the frontend has it, otherwise a plain select. */
  _makeLightPicker() {
    if (customElements.get("ha-entity-picker")) {
      const el = document.createElement("ha-entity-picker");
      el.includeDomains = ["light"];
      el.allowCustomEntity = false;
      el.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._onLightChange(ev.detail && ev.detail.value);
      });
      return { el, kind: "picker" };
    }
    const el = document.createElement("select");
    el.className = "light-select";
    el.addEventListener("change", () => this._onLightChange(el.value));
    return { el, kind: "select" };
  }

  _makeSettingsButton() {
    const btn = document.createElement("button");
    btn.className = "gear";
    btn.type = "button";
    btn.setAttribute("aria-label", "Settings");
    btn.setAttribute("aria-expanded", "false");
    btn.appendChild(this._makeIcon("mdi:cog-outline"));
    btn.addEventListener("click", () => this._toggleSettings());
    return btn;
  }

  _toggleSettings(force) {
    if (!this._els || !this._els.settings) return;
    const open = force === undefined ? !this._settingsOpen : !!force;
    this._settingsOpen = open;
    const { panel, button } = this._els.settings;
    panel.classList.toggle("open", open);
    button.classList.toggle("open", open);
    button.setAttribute("aria-expanded", String(open));
  }

  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = STYLES;
    root.appendChild(style);

    const card = document.createElement("ha-card");
    root.appendChild(card);

    this._els = { hero: null, rows: [], light: null, fade: null, settings: null };

    // Only worth a settings button if there is actually something to put in it.
    const tuck =
      this._config.show_settings &&
      !!(this._config.light_entity || this._config.fade_entity);

    let gear = null;
    if (this._config.title || tuck) {
      const header = document.createElement("div");
      header.className = "header";
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = this._config.title || "";
      header.appendChild(title);
      if (tuck) {
        gear = this._makeSettingsButton();
        header.appendChild(gear);
      }
      card.appendChild(header);
    }

    const body = document.createElement("div");
    body.className = this._config.title || tuck ? "body tight" : "body";
    card.appendChild(body);

    if (this._config.show_hero) {
      const hero = document.createElement("div");
      hero.className = "hero";

      const eyebrow = document.createElement("div");
      eyebrow.className = "eyebrow";

      const main = document.createElement("div");
      main.className = "hero-main";
      const time = document.createElement("div");
      time.className = "hero-time";
      const name = document.createElement("div");
      name.className = "hero-name";
      const chip = document.createElement("div");
      chip.className = "hero-chip";
      main.append(time, name, chip);

      const ramp = document.createElement("div");
      ramp.className = "ramp";
      const veil = document.createElement("div");
      veil.className = "ramp-veil";
      ramp.appendChild(veil);

      const ends = document.createElement("div");
      ends.className = "ramp-ends";
      const from = document.createElement("span");
      const to = document.createElement("span");
      ends.append(from, to);

      hero.append(eyebrow, main, ramp, ends);
      body.appendChild(hero);
      this._els.hero = { hero, eyebrow, time, name, chip, ramp, veil, ends, from, to };
    }

    this._config.schedules.forEach((sched) => {
      const row = document.createElement("div");
      row.className = "row";

      const icon = this._makeIcon(sched.icon || this._config.icon);

      const label = document.createElement("div");
      label.className = "label";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = sched.name || sched.time || "Wakeup";
      const sub = document.createElement("div");
      sub.className = "sub";
      const days = document.createElement("div");
      days.className = sched.days ? "days" : "days hidden";
      if (sched.days) {
        DAY_DISPLAY.forEach((d) => {
          const chip = document.createElement("span");
          chip.className = sched.days.includes(d) ? "day on" : "day";
          chip.textContent = DAY_INITIAL[d];
          chip.title = d;
          days.appendChild(chip);
        });
      }
      label.append(name, sub, days);

      const timeInput = document.createElement("input");
      timeInput.type = "time";
      timeInput.step = "60";
      timeInput.className = "time";
      timeInput.addEventListener("change", () => this._onTimeChange(sched, timeInput));

      const toggleHolder = document.createElement("div");
      toggleHolder.className = "toggle";
      let toggle = null;
      if (sched.automation) {
        toggle = this._makeSwitch();
        toggle.addEventListener("change", () => this._onToggle(sched, toggle));
        toggleHolder.appendChild(toggle);
      }

      row.append(icon, label, timeInput, toggleHolder);
      body.appendChild(row);
      this._els.rows.push({ sched, row, sub, timeInput, toggle });
    });

    // Everything below here is configuration rather than daily use, so it lives
    // behind the gear unless show_settings is off.
    let host = body;
    if (tuck) {
      const panel = document.createElement("div");
      panel.className = "settings";
      const inner = document.createElement("div");
      inner.className = "settings-inner";
      panel.appendChild(inner);
      body.appendChild(panel);
      this._els.settings = { panel, button: gear };
      this._settingsOpen = false;
      host = inner;
    }

    if (this._config.light_entity) {
      const row = document.createElement("div");
      row.className = "row light-row";

      const icon = this._makeIcon("mdi:lightbulb-on-outline");

      const label = document.createElement("div");
      label.className = "label";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = "Light";
      const sub = document.createElement("div");
      sub.className = "sub";
      label.append(name, sub);

      const { el, kind } = this._makeLightPicker();

      row.append(icon, label, el);
      host.appendChild(row);
      this._els.light = { row, sub, picker: el, kind };
    }

    if (this._config.fade_entity) {
      const row = document.createElement("div");
      row.className = "row fade-row";

      const icon = this._makeIcon("mdi:timer-sand");

      const label = document.createElement("div");
      label.className = "label";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = "Fade";
      const sub = document.createElement("div");
      sub.className = "sub";
      label.append(name, sub);

      const slider = document.createElement("input");
      slider.type = "range";
      slider.className = "slider";
      const value = document.createElement("div");
      value.className = "fade-value";

      // Live label while dragging, but only one service call, on release.
      slider.addEventListener("input", () => {
        value.textContent = humanDuration(Number(slider.value));
      });
      slider.addEventListener("change", () => this._onFadeChange(slider));

      row.append(icon, label, slider, value);
      host.appendChild(row);
      this._els.fade = { row, slider, value, sub };
    }

    this._built = true;
  }

  _fadeMinutes() {
    if (!this._config.fade_entity) return null;
    const st = this._hass.states[this._config.fade_entity];
    if (!st || isUnset(st.state)) return null;
    const n = Number(st.state);
    return Number.isFinite(n) ? n : null;
  }

  /** start/full window for a schedule, honouring fade_mode. */
  _window(mins, fadeMins) {
    const fade = fadeMins === null ? 0 : fadeMins;
    return this._config.fade_mode === "finish"
      ? { start: mins - fade, full: mins }
      : { start: mins, full: mins + fade };
  }

  _update() {
    const hass = this._hass;
    const fadeMins = this._fadeMinutes();
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;

    // Make the browser's native time picker follow the dashboard theme.
    const dark = !!(hass.themes && hass.themes.darkMode);
    this.style.colorScheme = dark ? "dark" : "light";

    if (this._els.light) this._updateLightRow();

    if (this._els.fade) {
      const { row, slider, value, sub } = this._els.fade;
      const st = hass.states[this._config.fade_entity];
      if (!st) {
        row.classList.add("missing");
        sub.textContent = `${this._config.fade_entity} is missing`;
        slider.disabled = true;
        value.textContent = "-";
      } else {
        row.classList.remove("missing");
        sub.textContent = "ramp length";
        const a = st.attributes || {};
        slider.min = String(a.min !== undefined ? a.min : FADE_FALLBACK.min);
        slider.max = String(a.max !== undefined ? a.max : FADE_FALLBACK.max);
        slider.step = String(a.step !== undefined ? a.step : FADE_FALLBACK.step);
        slider.disabled = false;
        // Never fight the user's thumb while they are dragging.
        if (this.shadowRoot.activeElement !== slider && fadeMins !== null) {
          slider.value = String(fadeMins);
        }
        value.textContent = fadeMins === null ? "-" : humanDuration(fadeMins);
      }
    }

    let next = null;   // soonest upcoming, needs `days`
    let live = null;   // currently mid-fade
    let anyOn = null;  // fallback when we cannot compute "next"

    for (const r of this._els.rows) {
      const timeState = r.sched.time ? hass.states[r.sched.time] : null;
      const autoState = r.sched.automation ? hass.states[r.sched.automation] : null;
      const enabled = autoState ? autoState.state === "on" : true;
      const mins = timeState ? timeToMinutes(timeState.state) : null;

      const missing = (r.sched.time && !timeState) || (r.sched.automation && !autoState);
      r.row.classList.toggle("missing", !!missing);
      r.row.classList.toggle("off", !enabled);

      // Do not clobber the field mid-edit.
      if (this.shadowRoot.activeElement !== r.timeInput) {
        r.timeInput.value = mins === null ? "" : minutesToTime(mins);
      }
      r.timeInput.disabled = !timeState;

      if (r.toggle) {
        r.toggle.checked = enabled;
        r.toggle.disabled = !autoState;
      }

      const win = mins === null ? null : this._window(mins, fadeMins);

      let detail;
      if (!r.sched.time) {
        detail = "no time entity configured";
      } else if (!timeState) {
        detail = `${r.sched.time} is missing`;
      } else if (r.sched.automation && !autoState) {
        detail = `${r.sched.automation} is missing`;
      } else if (mins === null) {
        detail = "time not set";
      } else if (fadeMins === null) {
        detail = "";
      } else if (this._config.fade_mode === "finish") {
        detail = `fade starts ${minutesToTime(win.start)}`;
      } else {
        detail = `full at ${minutesToTime(win.full)}`;
      }
      if (!enabled) detail = detail ? `disabled - ${detail}` : "disabled";
      r.sub.textContent = detail;

      if (!enabled || mins === null) continue;
      if (anyOn === null) anyOn = { sched: r.sched, mins, win };

      const runningToday =
        (!r.sched.days || r.sched.days.includes(DAY_ORDER[now.getDay()])) &&
        fadeMins !== null &&
        nowMin >= win.start &&
        nowMin < win.full;
      if (runningToday && !live) {
        live = { sched: r.sched, mins, win, pct: (nowMin - win.start) / (win.full - win.start) };
      }

      const until = minutesUntilNext(now, mins, r.sched.days);
      if (until !== null && (next === null || until < next.until)) {
        next = { until, sched: r.sched, mins, win };
      }
    }

    if (this._els.hero) this._updateHero({ next, live, anyOn, fadeMins });
  }

  _updateHero({ next, live, anyOn, fadeMins }) {
    const h = this._els.hero;
    const focus = live || next || anyOn;

    if (!focus) {
      h.hero.classList.remove("hidden");
      h.eyebrow.textContent = "Wakeup";
      h.time.textContent = "--:--";
      h.name.textContent = "nothing scheduled";
      h.chip.classList.add("hidden");
      h.ramp.classList.add("hidden");
      h.ends.classList.add("hidden");
      return;
    }

    h.hero.classList.remove("hidden");
    h.time.textContent = minutesToTime(focus.mins);
    h.name.textContent = focus.sched.name || "";

    if (live) {
      h.eyebrow.textContent = "Fading now";
      h.chip.classList.remove("hidden");
      h.chip.textContent = `${Math.round(live.pct * 100)}%`;
    } else if (next) {
      h.eyebrow.textContent = "Next wakeup";
      h.chip.classList.remove("hidden");
      h.chip.textContent = `in ${humanDuration(next.until)}`;
    } else {
      // No `days` configured, so we genuinely do not know when it next fires.
      h.eyebrow.textContent = "Wakeup";
      h.chip.classList.add("hidden");
    }

    const showRamp = this._config.show_ramp && fadeMins !== null && fadeMins > 0;
    h.ramp.classList.toggle("hidden", !showRamp);
    h.ends.classList.toggle("hidden", !showRamp);
    if (showRamp) {
      const pct = live ? live.pct : 0;
      h.ramp.classList.toggle("live", !!live);
      // The veil retracts left-to-right as the fade progresses.
      h.veil.style.transform = `scaleX(${Math.max(0, Math.min(1, 1 - pct))})`;
      h.from.textContent = minutesToTime(focus.win.start);
      h.to.textContent = `${minutesToTime(focus.win.full)} full`;
    }
  }

  _updateLightRow() {
    const hass = this._hass;
    const { row, sub, picker, kind } = this._els.light;
    const helper = hass.states[this._config.light_entity];

    if (!helper) {
      row.classList.add("missing");
      sub.textContent = `${this._config.light_entity} is missing`;
      picker.disabled = true;
      return;
    }
    picker.disabled = false;

    const chosen = isUnset(helper.state) ? "" : helper.state;
    const light = chosen ? hass.states[chosen] : null;

    if (kind === "picker") {
      picker.hass = hass;
      if (picker.value !== chosen) picker.value = chosen;
    } else {
      this._syncLightSelect(picker, chosen);
    }

    if (!chosen) {
      sub.textContent = "no light chosen";
    } else if (!light) {
      sub.textContent = `${chosen} not found`;
    } else {
      const b = light.attributes && light.attributes.brightness;
      const pct = b ? ` - ${Math.round((b / 255) * 100)}%` : "";
      sub.textContent = light.state === "on" ? `on${pct}` : light.state;
    }
    row.classList.toggle("missing", !!chosen && !light);
  }

  /** Rebuild the fallback <select> only when the set of lights actually changes. */
  _syncLightSelect(sel, chosen) {
    const hass = this._hass;
    const ids = Object.keys(hass.states).filter((e) => e.startsWith("light.")).sort();
    if (chosen && !ids.includes(chosen)) ids.unshift(chosen);
    const key = ids.join("|");
    if (sel._key !== key) {
      sel._key = key;
      sel.innerHTML = "";
      ids.forEach((id) => {
        const opt = document.createElement("option");
        opt.value = id;
        const st = hass.states[id];
        opt.textContent = (st && st.attributes && st.attributes.friendly_name) || id;
        sel.appendChild(opt);
      });
    }
    if (sel.value !== chosen) sel.value = chosen;
  }

  _onLightChange(value) {
    const id = this._config.light_entity;
    const helper = this._hass.states[id];
    if (!helper) return;
    const v = value === null || value === undefined ? "" : String(value);
    // Ignore no-ops and refuse to clear: an empty helper would silently send the
    // automation to its fallback light.
    if (!v || v === helper.state) {
      this._updateLightRow();
      return;
    }
    if (id.startsWith("input_select.")) {
      this._hass.callService("input_select", "select_option", { entity_id: id, option: v });
    } else {
      this._hass.callService("input_text", "set_value", { entity_id: id, value: v });
    }
  }

  _onTimeChange(sched, input) {
    const mins = timeToMinutes(input.value);
    if (mins === null || !sched.time) {
      this._update(); // cleared or invalid: snap back to the entity's value
      return;
    }
    this._hass.callService("input_datetime", "set_datetime", {
      entity_id: sched.time,
      time: `${minutesToTime(mins)}:00`,
    });
  }

  _onToggle(sched, toggle) {
    this._hass.callService("automation", toggle.checked ? "turn_on" : "turn_off", {
      entity_id: sched.automation,
    });
  }

  _onFadeChange(slider) {
    const v = Number(slider.value);
    if (!Number.isFinite(v)) return;
    this._hass.callService("input_number", "set_value", {
      entity_id: this._config.fade_entity,
      value: v,
    });
  }
}

/* ----------------------------------------------- wabit-wakeup-card-editor */

const LABELS = {
  title: "Card title (leave empty for no header)",
  fade_entity: "Fade duration helper (input_number, minutes)",
  light_entity: "Light chooser helper (input_text or input_select holding the light's entity_id)",
  fade_mode: "What the time means",
  show_hero: "Show the big next-wakeup panel",
  show_settings: "Tuck the light and fade rows behind a settings button",
  show_ramp: "Show the sunrise bar",
  name: "Label",
  time: "Time helper (input_datetime)",
  automation: "Automation to enable/disable (optional)",
  days: "Days it runs (unlocks the countdown)",
  icon: "Icon",
};

const MAIN_SCHEMA = [
  { name: "title", selector: { text: {} } },
  { name: "fade_entity", selector: { entity: { domain: "input_number" } } },
  {
    name: "light_entity",
    selector: { entity: { domain: ["input_text", "input_select"] } },
  },
  {
    name: "fade_mode",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "start", label: "The fade starts at this time" },
          { value: "finish", label: "The light is fully on at this time" },
        ],
      },
    },
  },
  { name: "show_hero", selector: { boolean: {} } },
  { name: "show_settings", selector: { boolean: {} } },
  { name: "show_ramp", selector: { boolean: {} } },
];

const DAY_LABELS = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

const SCHEDULE_SCHEMA = [
  { name: "name", selector: { text: {} } },
  { name: "time", required: true, selector: { entity: { domain: "input_datetime" } } },
  { name: "automation", selector: { entity: { domain: "automation" } } },
  { name: "icon", selector: { icon: {} } },
  {
    name: "days",
    selector: {
      select: {
        multiple: true,
        mode: "list",
        options: DAY_DISPLAY.map((d) => ({ value: d, label: DAY_LABELS[d] })),
      },
    },
  },
];

const EDITOR_STYLES = `
  :host { display: block; }
  .list { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
  .block {
    border: 1px solid var(--divider-color); border-radius: 12px; padding: 12px;
  }
  .head {
    display: flex; align-items: center; justify-content: space-between;
    gap: 8px; margin-bottom: 8px;
  }
  .head span {
    font-weight: 600; font-size: 0.9rem; color: var(--primary-text-color);
  }
  .btn {
    font: inherit; font-size: 0.85rem; cursor: pointer;
    background: none; color: var(--primary-color);
    border: 1px solid var(--divider-color); border-radius: 999px;
    padding: 5px 12px;
  }
  .btn:hover:not(:disabled) { background: rgba(var(--rgb-primary-color, 63, 81, 181), 0.1); }
  .btn:disabled { opacity: 0.45; cursor: default; }
  .btn.danger { color: var(--error-color, #db4437); }
  .add { margin-top: 12px; }
  .note {
    padding: 12px; border-radius: 12px; line-height: 1.5;
    background: rgba(var(--rgb-primary-color, 63, 81, 181), 0.08);
    color: var(--primary-text-color); font-size: 0.9rem;
  }
  .note a { color: var(--primary-color); }
  .section { margin: 16px 0 4px; }
  .section-title {
    font-size: 0.95rem; font-weight: 600; color: var(--primary-text-color);
    margin-bottom: 2px;
  }
  .hint {
    font-size: 0.78rem; color: var(--secondary-text-color);
    line-height: 1.45; margin-bottom: 8px;
  }
  .preset-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
  .preset-thumb {
    flex: none; width: 34px; height: 34px; border-radius: 8px;
    background: var(--divider-color) center/cover no-repeat;
    border: 1px solid var(--divider-color);
  }
  .preset-thumb.empty { background-image: none; opacity: 0.5; }
  .preset-row { display: flex; align-items: center; gap: 6px; }
  .preset-row input[type="text"] {
    min-width: 0; font: inherit; font-size: 0.85rem; padding: 7px 9px;
    border-radius: 9px; border: 1px solid var(--divider-color);
    background: var(--card-background-color); color: var(--primary-text-color);
  }
  .pin-btn {
    flex: none; width: 30px; height: 30px; padding: 0; border: none;
    border-radius: 50%; background: none; cursor: pointer; font: inherit;
    font-size: 1rem; line-height: 1; color: var(--secondary-text-color);
  }
  .pin-btn.danger:hover { background: rgba(219, 68, 55, 0.14); color: var(--error-color, #db4437); }
`;

class WabitWakeupCardEditor extends HTMLElement {
  setConfig(config) {
    const cfg = { ...(config || {}) };
    if (!Array.isArray(cfg.schedules) || !cfg.schedules.length) cfg.schedules = [{}];
    this._config = cfg;
    if (this._builtCount !== cfg.schedules.length) this._rebuild();
    else this._pushData();
  }

  set hass(hass) {
    this._hass = hass;
    this._pushData();
  }

  get hass() {
    return this._hass;
  }

  _emit() {
    fireEvent(this, "config-changed", { config: this._config });
  }

  _addSchedule() {
    this._config = { ...this._config, schedules: [...this._config.schedules, {}] };
    this._emit();
    this._rebuild(); // some Lovelace builds do not call setConfig back
  }

  _removeSchedule(index) {
    if (this._config.schedules.length < 2) return;
    const schedules = this._config.schedules.filter((_, i) => i !== index);
    this._config = { ...this._config, schedules };
    this._emit();
    this._rebuild();
  }

  _rebuild() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = EDITOR_STYLES;
    root.appendChild(style);

    if (!customElements.get("ha-form")) {
      const note = document.createElement("div");
      note.className = "note";
      note.textContent =
        "This Home Assistant build does not provide ha-form, so the visual editor " +
        "is unavailable. Configure this card in YAML instead - the options are " +
        "documented at " + REPO;
      root.appendChild(note);
      this._forms = null;
      this._builtCount = this._config ? this._config.schedules.length : 0;
      return;
    }

    const main = document.createElement("ha-form");
    main.schema = MAIN_SCHEMA;
    main.computeLabel = (s) => LABELS[s.name] || s.name;
    main.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      this._config = { ...this._config, ...ev.detail.value };
      this._emit();
    });
    root.appendChild(main);

    const list = document.createElement("div");
    list.className = "list";
    root.appendChild(list);

    this._forms = { main, schedules: [] };

    this._config.schedules.forEach((sched, i) => {
      const block = document.createElement("div");
      block.className = "block";

      const head = document.createElement("div");
      head.className = "head";
      const heading = document.createElement("span");
      heading.textContent = sched && sched.name ? sched.name : `Schedule ${i + 1}`;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn danger";
      del.textContent = "Remove";
      del.disabled = this._config.schedules.length < 2;
      del.addEventListener("click", () => this._removeSchedule(i));
      head.append(heading, del);

      const form = document.createElement("ha-form");
      form.schema = SCHEDULE_SCHEMA;
      form.computeLabel = (s) => LABELS[s.name] || s.name;
      form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const schedules = this._config.schedules.slice();
        schedules[i] = { ...schedules[i], ...ev.detail.value };
        this._config = { ...this._config, schedules };
        heading.textContent = schedules[i].name || `Schedule ${i + 1}`;
        this._emit();
      });

      block.append(head, form);
      list.appendChild(block);
      this._forms.schedules.push(form);
    });

    const add = document.createElement("button");
    add.type = "button";
    add.className = "btn add";
    add.textContent = "+ Add schedule";
    add.addEventListener("click", () => this._addSchedule());
    root.appendChild(add);

    this._builtCount = this._config.schedules.length;
    this._pushData();
  }

  /** Assign hass/data, skipping no-op writes so we never interrupt typing. */
  _pushData() {
    if (!this._forms || !this._hass || !this._config) return;

    const mainData = {
      title: this._config.title,
      fade_entity: this._config.fade_entity,
      light_entity: this._config.light_entity,
      fade_mode: this._config.fade_mode === "finish" ? "finish" : "start",
      show_hero: this._config.show_hero !== false,
      show_settings: this._config.show_settings !== false,
      show_ramp: this._config.show_ramp !== false,
    };
    this._forms.main.hass = this._hass;
    if (JSON.stringify(this._forms.main.data) !== JSON.stringify(mainData)) {
      this._forms.main.data = mainData;
    }

    this._forms.schedules.forEach((form, i) => {
      const data = this._config.schedules[i] || {};
      form.hass = this._hass;
      if (JSON.stringify(form.data) !== JSON.stringify(data)) form.data = data;
    });
  }
}

/* --------------------------------------------------------- registration */

if (!customElements.get("wabit-wakeup-card")) {
  customElements.define("wabit-wakeup-card", WabitWakeupCard);
}
if (!customElements.get("wabit-wakeup-card-editor")) {
  customElements.define("wabit-wakeup-card-editor", WabitWakeupCardEditor);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "wabit-wakeup-card")) {
  window.customCards.push({
    type: "wabit-wakeup-card",
    name: "Wabit Wakeup",
    description:
      "Wake-up light schedule: per-schedule time and enable toggle, a light " +
      "chooser, a shared fade slider, and a live sunrise ramp.",
    preview: true,
    documentationURL: REPO,
  });
}

/* ------------------------------------------------- wabit-room-lights-card */

/* Any of these colour modes implies a dimmable light. "onoff" does not. */
const DIMMABLE_MODES = new Set([
  "brightness", "color_temp", "hs", "xy", "rgb", "rgbw", "rgbww", "white",
]);
/* Modes that accept an actual colour (as opposed to a colour temperature). */
const COLOUR_MODES = new Set(["hs", "xy", "rgb", "rgbw", "rgbww"]);

const modesOf = (st) => (st && st.attributes && st.attributes.supported_color_modes) || [];
const supportsBrightness = (st) => modesOf(st).some((m) => DIMMABLE_MODES.has(m));
const supportsColour = (st) => modesOf(st).some((m) => COLOUR_MODES.has(m));
const supportsTemp = (st) => modesOf(st).includes("color_temp");

/** 0-100, and 0 whenever the light is off. */
function brightnessPct(st) {
  if (!st || st.state !== "on") return 0;
  const b = st.attributes && st.attributes.brightness;
  if (b === undefined || b === null) return 100; // on, but not dimmable
  return Math.max(1, Math.round((Number(b) / 255) * 100));
}

/** A CSS colour approximating what the bulb is currently showing, or null when off. */
function lightColourCss(st) {
  if (!st || st.state !== "on") return null;
  const a = st.attributes || {};
  if (Array.isArray(a.rgb_color) && a.rgb_color.length >= 3) {
    return `rgb(${a.rgb_color.slice(0, 3).join(",")})`;
  }
  if (Array.isArray(a.hs_color) && a.hs_color.length >= 2) {
    return `hsl(${a.hs_color[0]}deg ${a.hs_color[1]}% 60%)`;
  }
  return null;
}

/** Accepts an area_id, an area name, or one of its aliases. */
function resolveAreaId(hass, wanted) {
  const areas = (hass && hass.areas) || {};
  if (!wanted) return null;
  if (areas[wanted]) return wanted;
  const want = String(wanted).trim().toLowerCase();
  for (const [id, area] of Object.entries(areas)) {
    if (String(area.name || "").trim().toLowerCase() === want) return id;
    const aliases = Array.isArray(area.aliases) ? area.aliases : [];
    if (aliases.some((a) => String(a || "").trim().toLowerCase() === want)) return id;
  }
  return null;
}

/**
 * Every light entity belonging to an area. An entity can be placed in an area
 * directly, but usually inherits it from its device, so both must be checked.
 * Config/diagnostic entities are skipped - those are things like access-point
 * status LEDs, which are lights to Home Assistant but not to a person.
 */
function lightsInArea(hass, areaId) {
  const entities = (hass && hass.entities) || {};
  const devices = (hass && hass.devices) || {};
  const out = [];
  for (const [id, ent] of Object.entries(entities)) {
    if (!id.startsWith("light.")) continue;
    if (ent.entity_category) continue;
    if (ent.hidden || ent.hidden_by || ent.disabled_by) continue;
    const device = ent.device_id ? devices[ent.device_id] : null;
    const area = ent.area_id || (device ? device.area_id : null);
    if (area !== areaId) continue;
    if (!hass.states[id]) continue;
    out.push(id);
  }
  return out;
}

/** Entity ids that are members of some other light's group, within `ids`. */
function groupMemberIds(hass, ids) {
  const members = new Set();
  for (const id of ids) {
    const st = hass.states[id];
    const g = st && st.attributes && st.attributes.group_entities;
    if (Array.isArray(g)) g.forEach((m) => members.add(m));
  }
  return members;
}

const SWATCHES = [
  { label: "Warm", kelvin: 2200 },
  { label: "Soft", kelvin: 2700 },
  { label: "Neutral", kelvin: 4000 },
  { label: "Cool", kelvin: 6000 },
  { label: "Red", hs: [0, 100] },
  { label: "Orange", hs: [28, 100] },
  { label: "Green", hs: [120, 85] },
  { label: "Blue", hs: [220, 95] },
  { label: "Purple", hs: [280, 85] },
];

const ROOM_STYLES = `
  :host {
    display: block;
    --wc-text: var(--md-sys-color-on-surface, var(--primary-text-color, #212121));
    --wc-muted: var(--md-sys-color-on-surface-variant, var(--secondary-text-color, #727272));
    --wc-accent: var(--md-sys-color-primary, var(--primary-color, #3f51b5));
    --wc-tonal: var(--md-sys-color-surface-container-highest,
                 rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.08));
    --wc-outline: var(--md-sys-color-outline-variant, var(--divider-color, #e0e0e0));
    --wc-accent-tonal: var(--md-sys-color-primary-container,
                        rgba(var(--rgb-primary-color, 63, 81, 181), 0.16));
    --wc-on-accent-tonal: var(--md-sys-color-on-primary-container, var(--wc-accent));
  }
  ha-card { overflow: hidden; }
  .body { padding: 8px 16px 16px; }

  .header { display: flex; align-items: center; gap: 8px; padding: 12px 16px 4px; }
  .heading { flex: 1; min-width: 0; }
  .title {
    color: var(--ha-card-header-color, var(--wc-text));
    font-family: var(--ha-card-header-font-family, inherit);
    font-size: var(--ha-card-header-font-size, 24px);
    font-weight: 400; letter-spacing: -0.012em; line-height: 1.25;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .summary {
    color: var(--wc-muted); font-size: 0.8rem; margin-top: 2px;
    font-variant-numeric: tabular-nums;
  }
  .all {
    flex: none; display: flex; align-items: center; justify-content: center;
    width: 40px; height: 40px; padding: 0; border: none; border-radius: 50%;
    background: none; cursor: pointer; color: var(--wc-muted);
    transition: background 160ms, color 160ms;
  }
  .all:hover { background: var(--wc-tonal); color: var(--wc-text); }
  .all:focus-visible { outline: 2px solid var(--wc-accent); outline-offset: 2px; }
  .all.lit { background: var(--wc-accent-tonal); color: var(--wc-on-accent-tonal); }
  .all .icon { color: inherit; --mdc-icon-size: 22px; }

  .light { padding: 8px 0; border-top: 1px solid var(--wc-outline); }
  .light:first-of-type { border-top: none; }
  .top { display: flex; align-items: center; gap: 10px; }
  .bulb {
    flex: none; display: flex; align-items: center; justify-content: center;
    width: 38px; height: 38px; padding: 0; border: none; border-radius: 50%;
    cursor: pointer; background: var(--wc-tonal); color: var(--wc-muted);
    transition: background 180ms, color 180ms, box-shadow 180ms;
  }
  .bulb:focus-visible { outline: 2px solid var(--wc-accent); outline-offset: 2px; }
  .bulb.lit { background: var(--wc-accent-tonal); color: var(--wc-on-accent-tonal); }
  .bulb .icon { color: inherit; --mdc-icon-size: 21px; }
  .name {
    flex: 1; min-width: 0; color: var(--wc-text); font-size: 0.98rem;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .light.off .name { color: var(--wc-muted); }
  .light.dead { opacity: 0.55; }
  .light.dead .pct { font-style: italic; }
  .light.dead .bulb { cursor: not-allowed; }
  .pct {
    color: var(--wc-muted); font-size: 0.85rem; min-width: 3.1em;
    text-align: right; font-variant-numeric: tabular-nums;
  }
  .swatch-btn {
    flex: none; width: 30px; height: 30px; padding: 0; border-radius: 50%;
    cursor: pointer; border: 2px solid var(--wc-outline); background: var(--wc-tonal);
    transition: border-color 160ms, transform 160ms;
  }
  .swatch-btn:hover { transform: scale(1.08); }
  .swatch-btn:focus-visible { outline: 2px solid var(--wc-accent); outline-offset: 2px; }
  .swatch-btn.open { border-color: var(--wc-accent); }

  .bri { margin: 6px 0 2px 48px; }
  .bri.hidden { display: none; }
  input[type="range"].dim {
    width: 100%; cursor: pointer; accent-color: var(--wc-accent);
  }
  input[type="range"]:disabled { cursor: default; opacity: 0.45; }

  .colour { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 240ms ease; }
  .colour.open { grid-template-rows: 1fr; }
  .colour-inner { overflow: hidden; min-height: 0; }
  .colour-pad { margin: 6px 0 2px 48px; display: flex; flex-direction: column; gap: 8px; }
  .ctl { display: flex; align-items: center; gap: 10px; }
  .ctl-label {
    color: var(--wc-muted); font-size: 0.72rem; width: 3.4em; flex: none;
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  input[type="range"].strip {
    flex: 1; width: 100%; cursor: pointer; height: 14px; border-radius: 999px;
    -webkit-appearance: none; appearance: none; border: 1px solid var(--wc-outline);
  }
  input[type="range"].strip::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none; width: 16px; height: 16px;
    border-radius: 50%; background: #fff; border: 2px solid rgba(0,0,0,0.35);
    cursor: pointer;
  }
  input[type="range"].strip::-moz-range-thumb {
    width: 14px; height: 14px; border-radius: 50%; background: #fff;
    border: 2px solid rgba(0,0,0,0.35); cursor: pointer;
  }
  .hue { background: linear-gradient(90deg,
    hsl(0 100% 50%), hsl(60 100% 50%), hsl(120 100% 50%),
    hsl(180 100% 50%), hsl(240 100% 50%), hsl(300 100% 50%), hsl(360 100% 50%)); }
  .temp { background: linear-gradient(90deg, #ffb46b, #ffd6aa, #fff4e8, #f2f6ff, #cfe0ff); }
  .swatches { display: flex; flex-wrap: wrap; gap: 6px; }
  .preset {
    width: 24px; height: 24px; border-radius: 50%; cursor: pointer;
    border: 1px solid var(--wc-outline); padding: 0;
  }
  .preset:hover { transform: scale(1.1); }
  .preset:focus-visible { outline: 2px solid var(--wc-accent); outline-offset: 2px; }

  .more { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 260ms ease; }
  .more.open { grid-template-rows: 1fr; }
  .more-inner { overflow: hidden; min-height: 0; }
  /* Deliberately light: a borderless strip, not a full-width pill, so the
     expander costs a line of text rather than a whole row. */
  .more-btn {
    width: 100%; margin-top: 2px; padding: 3px 8px; border-radius: 8px;
    border: none; background: none; cursor: pointer;
    color: var(--wc-muted); font: inherit; font-size: 0.76rem;
    letter-spacing: 0.02em;
    display: flex; align-items: center; justify-content: center; gap: 3px;
    transition: background 160ms, color 160ms;
  }
  .more-btn:hover { background: var(--wc-tonal); color: var(--wc-text); }
  .more-btn:focus-visible { outline: 2px solid var(--wc-accent); outline-offset: 2px; }
  .more-btn.hidden { display: none; }
  .more-btn .icon {
    color: inherit; --mdc-icon-size: 15px; transition: transform 200ms ease;
  }
  .more-btn.open .icon { transform: rotate(180deg); }
  @media (prefers-reduced-motion: reduce) { .more-btn .icon { transition: none; } }

  .empty { color: var(--wc-muted); font-size: 0.9rem; padding: 8px 0 4px; line-height: 1.5; }
  .error { color: var(--error-color, #db4437); font-size: 0.9rem; padding: 8px 0; line-height: 1.5; }

  @media (prefers-reduced-motion: reduce) {
    .colour, .more { transition: none; }
  }
`;

class WabitRoomLightsCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("wabit-room-lights-card-editor");
  }

  static getStubConfig(hass) {
    const areas = (hass && hass.areas) || {};
    // Offer the area with the most lights - the one this card helps with most.
    let best = null;
    for (const id of Object.keys(areas)) {
      const n = lightsInArea(hass, id).length;
      if (n && (!best || n > best.n)) best = { id, n };
    }
    return { type: "custom:wabit-room-lights-card", area: best ? best.id : "" };
  }

  setConfig(config) {
    const cfg = config || {};
    if (isUnset(cfg.area)) {
      throw new Error("wabit-room-lights-card: `area` is required");
    }
    const lightList = (v, key) => {
      if (v === undefined || v === null) return null;
      if (!Array.isArray(v)) {
        throw new Error(`wabit-room-lights-card: \`${key}\` must be a list of light entities`);
      }
      v.forEach((e) => {
        if (typeof e !== "string" || !e.startsWith("light.")) {
          throw new Error(
            `wabit-room-lights-card: \`${key}\` may only contain light entities, got "${e}"`
          );
        }
      });
      return v;
    };

    this._config = {
      area: String(cfg.area),
      title: cfg.title,
      pinned: lightList(cfg.pinned, "pinned"),
      exclude: lightList(cfg.exclude, "exclude") || [],
      collapse_groups: cfg.collapse_groups === true,
      show_header: cfg.show_header !== false,
      show_brightness: cfg.show_brightness !== false,
      show_colour: cfg.show_colour !== false && cfg.show_color !== false,
      strip_area_name: cfg.strip_area_name !== false,
    };

    this._built = false;
    this._rowsKey = null;
    this._openColour = this._openColour || new Set();
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config) this._render();
  }

  get hass() {
    return this._hass;
  }

  getCardSize() {
    const m = this._lastModel;
    if (!m || m.error) return 4;
    // Each light is a name row plus its brightness slider; extras start collapsed.
    return 1 + m.pinned.length * 2;
  }

  /** Work out which lights belong here and how they are split. */
  _model() {
    const hass = this._hass;
    const cfg = this._config;

    if (!hass.entities || !hass.areas) {
      return { error: "This Home Assistant build does not expose the area registry to cards." };
    }
    const areaId = resolveAreaId(hass, cfg.area);
    if (!areaId) return { error: `No area called "${cfg.area}".` };

    const areaName = (hass.areas[areaId] || {}).name || cfg.area;
    const excluded = new Set(cfg.exclude);
    let ids = lightsInArea(hass, areaId).filter((id) => !excluded.has(id));

    const byName = (a, b) => this._nameOf(a, areaName).localeCompare(this._nameOf(b, areaName));
    ids.sort(byName);

    let pinned;
    let extra;
    if (cfg.pinned) {
      const pinSet = new Set(cfg.pinned);
      // Keep the configured order, but only for lights actually in the area.
      pinned = cfg.pinned.filter((id) => ids.includes(id));
      extra = ids.filter((id) => !pinSet.has(id));
    } else if (cfg.collapse_groups) {
      const members = groupMemberIds(hass, ids);
      pinned = ids.filter((id) => !members.has(id));
      extra = ids.filter((id) => members.has(id));
      if (!pinned.length) { pinned = ids; extra = []; } // never hide everything
    } else {
      pinned = ids;
      extra = [];
    }

    return { areaId, areaName, pinned, extra, all: pinned.concat(extra) };
  }

  _nameOf(id, areaName) {
    const hass = this._hass;
    const reg = (hass.entities || {})[id] || {};
    const st = hass.states[id];
    let name = reg.name || (st && st.attributes && st.attributes.friendly_name) || id;
    if (this._config.strip_area_name && areaName) {
      // "Living Room - Ceiling All" reads better as "Ceiling All" inside a room
      // card. Plain string work rather than a built regex, so no escaping worries.
      if (name.toLowerCase().startsWith(areaName.toLowerCase())) {
        const rest = name.slice(areaName.length).replace(/^[\s:-]+/, "").trim();
        if (rest) name = rest;
      }
    }
    return name;
  }

  _render() {
    if (!this._config || !this._hass) return;
    if (!this._built) this._buildShell();
    const model = this._model();
    this._lastModel = model;

    if (model.error) {
      this._els.error.textContent = model.error;
      this._els.error.style.display = "";
      this._els.pinned.style.display = "none";
      this._els.moreBtn.classList.add("hidden");
      this._els.more.classList.remove("open");
      return;
    }
    this._els.error.style.display = "none";
    this._els.pinned.style.display = "";

    const key = JSON.stringify([model.areaId, model.pinned, model.extra]);
    if (key !== this._rowsKey) {
      this._rowsKey = key;
      this._buildRows(model);
    }
    this._update(model);
  }

  _buildShell() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = ROOM_STYLES;
    root.appendChild(style);

    const card = document.createElement("ha-card");
    root.appendChild(card);

    this._els = { rows: new Map() };

    if (this._config.show_header) {
      const header = document.createElement("div");
      header.className = "header";
      const heading = document.createElement("div");
      heading.className = "heading";
      const title = document.createElement("div");
      title.className = "title";
      const summary = document.createElement("div");
      summary.className = "summary";
      heading.append(title, summary);

      const all = document.createElement("button");
      all.className = "all";
      all.type = "button";
      all.setAttribute("aria-label", "Toggle all lights in this room");
      all.appendChild(this._makeIcon("mdi:lightbulb-group-outline"));
      all.addEventListener("click", () => this._toggleAll());

      header.append(heading, all);
      card.appendChild(header);
      this._els.header = { title, summary, all };
    }

    const body = document.createElement("div");
    body.className = "body";
    card.appendChild(body);

    const error = document.createElement("div");
    error.className = "error";
    error.style.display = "none";
    body.appendChild(error);

    const pinned = document.createElement("div");
    pinned.className = "pinned";
    body.appendChild(pinned);

    const more = document.createElement("div");
    more.className = "more";
    const moreInner = document.createElement("div");
    moreInner.className = "more-inner";
    more.appendChild(moreInner);
    body.appendChild(more);

    const moreBtn = document.createElement("button");
    moreBtn.className = "more-btn hidden";
    moreBtn.type = "button";
    moreBtn.setAttribute("aria-expanded", "false");
    const moreLabel = document.createElement("span");
    const moreChev = this._makeIcon("mdi:chevron-down");
    moreBtn.append(moreLabel, moreChev);
    moreBtn.addEventListener("click", () => this._toggleMore());
    body.appendChild(moreBtn);
    this._els.moreLabel = moreLabel;

    this._els.error = error;
    this._els.pinned = pinned;
    this._els.more = more;
    this._els.moreInner = moreInner;
    this._els.moreBtn = moreBtn;
    this._moreOpen = false;
    this._built = true;
  }

  _makeIcon(icon) {
    if (customElements.get("ha-icon")) {
      const el = document.createElement("ha-icon");
      el.setAttribute("icon", icon);
      el.className = "icon";
      return el;
    }
    const span = document.createElement("span");
    span.className = "icon";
    return span;
  }

  _buildRows(model) {
    this._els.pinned.innerHTML = "";
    this._els.moreInner.innerHTML = "";
    this._els.rows = new Map();

    model.pinned.forEach((id) => this._els.pinned.appendChild(this._buildRow(id, model)));
    model.extra.forEach((id) => this._els.moreInner.appendChild(this._buildRow(id, model)));

    const n = model.extra.length;
    this._els.moreBtn.classList.toggle("hidden", n === 0);
    if (!n) {
      this._moreOpen = false;
      this._els.more.classList.remove("open");
    }
    this._setMoreLabel(n);

    if (!model.pinned.length && !n) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = `No lights found in ${model.areaName}.`;
      this._els.pinned.appendChild(empty);
    }
  }

  _buildRow(id, model) {
    const wrap = document.createElement("div");
    wrap.className = "light";

    const top = document.createElement("div");
    top.className = "top";

    const bulb = document.createElement("button");
    bulb.className = "bulb";
    bulb.type = "button";
    bulb.setAttribute("aria-label", `Toggle ${this._nameOf(id, model.areaName)}`);
    bulb.appendChild(this._makeIcon("mdi:lightbulb"));
    bulb.addEventListener("click", () => this._toggle(id));

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = this._nameOf(id, model.areaName);

    const pct = document.createElement("div");
    pct.className = "pct";

    const swatchBtn = document.createElement("button");
    swatchBtn.className = "swatch-btn";
    swatchBtn.type = "button";
    swatchBtn.setAttribute("aria-label", `Colour for ${this._nameOf(id, model.areaName)}`);
    swatchBtn.setAttribute("aria-expanded", "false");
    swatchBtn.addEventListener("click", () => this._toggleColour(id));

    top.append(bulb, name, pct, swatchBtn);
    wrap.appendChild(top);

    const briWrap = document.createElement("div");
    briWrap.className = "bri";
    const dim = document.createElement("input");
    dim.type = "range";
    dim.className = "dim";
    dim.min = "1";
    dim.max = "100";
    dim.step = "1";
    dim.addEventListener("input", () => { pct.textContent = `${dim.value}%`; });
    dim.addEventListener("change", () => this._setBrightness(id, Number(dim.value)));
    briWrap.appendChild(dim);
    wrap.appendChild(briWrap);

    const colour = document.createElement("div");
    colour.className = "colour";
    const colourInner = document.createElement("div");
    colourInner.className = "colour-inner";
    colour.appendChild(colourInner);
    wrap.appendChild(colour);

    this._els.rows.set(id, {
      wrap, bulb, name, pct, swatchBtn, briWrap, dim,
      colour, colourInner, colourBuilt: false, controls: null,
    });
    return wrap;
  }

  /** Colour controls are built on first open - 20 lights would be a lot of sliders up front. */
  _buildColour(id) {
    const row = this._els.rows.get(id);
    const st = this._hass.states[id];
    if (!row || row.colourBuilt || !st) return;

    const pad = document.createElement("div");
    pad.className = "colour-pad";
    const controls = { temp: null, hue: null, sat: null };

    if (supportsTemp(st)) {
      const line = document.createElement("div");
      line.className = "ctl";
      const label = document.createElement("div");
      label.className = "ctl-label";
      label.textContent = "White";
      const temp = document.createElement("input");
      temp.type = "range";
      temp.className = "strip temp";
      const a = st.attributes || {};
      temp.min = String(a.min_color_temp_kelvin || 2000);
      temp.max = String(a.max_color_temp_kelvin || 6500);
      temp.step = "50";
      temp.addEventListener("change", () => this._setTemp(id, Number(temp.value)));
      line.append(label, temp);
      pad.appendChild(line);
      controls.temp = temp;
    }

    if (supportsColour(st)) {
      const hueLine = document.createElement("div");
      hueLine.className = "ctl";
      const hueLabel = document.createElement("div");
      hueLabel.className = "ctl-label";
      hueLabel.textContent = "Hue";
      const hue = document.createElement("input");
      hue.type = "range";
      hue.className = "strip hue";
      hue.min = "0"; hue.max = "360"; hue.step = "1";
      hue.addEventListener("change", () => this._setHs(id, Number(hue.value), null));
      hueLine.append(hueLabel, hue);
      pad.appendChild(hueLine);
      controls.hue = hue;

      const satLine = document.createElement("div");
      satLine.className = "ctl";
      const satLabel = document.createElement("div");
      satLabel.className = "ctl-label";
      satLabel.textContent = "Sat";
      const sat = document.createElement("input");
      sat.type = "range";
      sat.className = "strip";
      sat.min = "0"; sat.max = "100"; sat.step = "1";
      sat.addEventListener("change", () => this._setHs(id, null, Number(sat.value)));
      satLine.append(satLabel, sat);
      pad.appendChild(satLine);
      controls.sat = sat;
    }

    const swatches = document.createElement("div");
    swatches.className = "swatches";
    SWATCHES.forEach((s) => {
      if (s.kelvin && !supportsTemp(st)) return;
      if (s.hs && !supportsColour(st)) return;
      const b = document.createElement("button");
      b.className = "preset";
      b.type = "button";
      b.title = s.label;
      b.setAttribute("aria-label", s.label);
      b.style.background = s.hs
        ? `hsl(${s.hs[0]}deg ${s.hs[1]}% 55%)`
        : kelvinToCss(s.kelvin);
      b.addEventListener("click", () => {
        if (s.kelvin) this._setTemp(id, s.kelvin);
        else this._setHs(id, s.hs[0], s.hs[1]);
      });
      swatches.appendChild(b);
    });
    if (swatches.children.length) pad.appendChild(swatches);

    row.colourInner.appendChild(pad);
    row.controls = controls;
    row.colourBuilt = true;
  }

  _update(model) {
    const hass = this._hass;
    const dark = !!(hass.themes && hass.themes.darkMode);
    this.style.colorScheme = dark ? "dark" : "light";

    let on = 0;
    let briSum = 0;
    let briCount = 0;

    for (const id of model.all) {
      const row = this._els.rows.get(id);
      const st = hass.states[id];
      if (!row || !st) continue;

      const dead = st.state === "unavailable" || st.state === "unknown";
      const lit = st.state === "on";
      if (lit) on += 1;
      const pct = brightnessPct(st);
      const dimmable = supportsBrightness(st);
      if (lit && dimmable) { briSum += pct; briCount += 1; }

      row.wrap.classList.toggle("off", !lit);
      row.bulb.classList.toggle("lit", lit);

      const colour = lightColourCss(st);
      // Tint the bulb button with the light's actual colour when it has one.
      row.bulb.style.background = lit && colour ? colour : "";
      row.bulb.style.color = lit && colour ? "#1a1a1a" : "";

      row.swatchBtn.style.background = colour || "";
      const showSwatch =
        !dead && this._config.show_colour && (supportsColour(st) || supportsTemp(st));
      row.swatchBtn.style.display = showSwatch ? "" : "none";

      const showBri = this._config.show_brightness && dimmable;
      row.briWrap.classList.toggle("hidden", !showBri);
      row.dim.disabled = !lit;
      if (this.shadowRoot.activeElement !== row.dim) row.dim.value = String(pct || 1);

      // An unavailable light must not read as a plain "Off" with a live toggle.
      row.wrap.classList.toggle("dead", dead);
      row.bulb.disabled = dead;
      if (dead) row.dim.disabled = true;
      if (dead) row.pct.textContent = "Unavailable";
      else if (!dimmable) row.pct.textContent = lit ? "On" : "Off";
      else row.pct.textContent = lit ? `${pct}%` : "Off";

      if (row.colourBuilt && row.controls) {
        const a = st.attributes || {};
        const c = row.controls;
        if (c.temp && this.shadowRoot.activeElement !== c.temp && a.color_temp_kelvin) {
          c.temp.value = String(a.color_temp_kelvin);
        }
        if (Array.isArray(a.hs_color)) {
          if (c.hue && this.shadowRoot.activeElement !== c.hue) {
            c.hue.value = String(Math.round(a.hs_color[0]));
          }
          if (c.sat && this.shadowRoot.activeElement !== c.sat) {
            c.sat.value = String(Math.round(a.hs_color[1]));
          }
        }
      }
    }

    if (this._els.header) {
      const total = model.all.length;
      this._els.header.title.textContent =
        this._config.title === undefined ? model.areaName : this._config.title;
      const avg = briCount ? Math.round(briSum / briCount) : 0;
      this._els.header.summary.textContent = !total
        ? "No lights"
        : on === 0
          ? `All off - ${total} light${total === 1 ? "" : "s"}`
          : `${on} of ${total} on${avg ? ` - ${avg}%` : ""}`;
      this._els.header.all.classList.toggle("lit", on > 0);
    }

    const n = model.extra.length;
    if (n) this._setMoreLabel(n);
  }

  _setMoreLabel(n) {
    this._els.moreLabel.textContent = this._moreOpen ? "Show less" : `${n} more`;
    this._els.moreBtn.classList.toggle("open", this._moreOpen);
  }

  _toggleMore() {
    this._moreOpen = !this._moreOpen;
    this._els.more.classList.toggle("open", this._moreOpen);
    this._els.moreBtn.setAttribute("aria-expanded", String(this._moreOpen));
    this._setMoreLabel(this._lastModel ? this._lastModel.extra.length : 0);
  }

  _toggleColour(id) {
    const row = this._els.rows.get(id);
    if (!row) return;
    const open = !this._openColour.has(id);
    if (open) {
      this._buildColour(id);
      this._openColour.add(id);
    } else {
      this._openColour.delete(id);
    }
    row.colour.classList.toggle("open", open);
    row.swatchBtn.classList.toggle("open", open);
    row.swatchBtn.setAttribute("aria-expanded", String(open));
    if (open && this._lastModel) this._update(this._lastModel);
  }

  _toggle(id) {
    this._hass.callService("light", "toggle", { entity_id: id });
  }

  _toggleAll() {
    const model = this._lastModel;
    if (!model || !model.all || !model.all.length) return;
    const anyOn = model.all.some((id) => {
      const st = this._hass.states[id];
      return st && st.state === "on";
    });
    // Target exactly the lights this card shows, not the whole area - the card
    // deliberately filters some entities out.
    this._hass.callService("light", anyOn ? "turn_off" : "turn_on", {
      entity_id: model.all,
    });
  }

  _setBrightness(id, pct) {
    if (!Number.isFinite(pct)) return;
    this._hass.callService("light", "turn_on", {
      entity_id: id,
      brightness_pct: Math.max(1, Math.min(100, Math.round(pct))),
    });
  }

  _setTemp(id, kelvin) {
    if (!Number.isFinite(kelvin)) return;
    this._hass.callService("light", "turn_on", { entity_id: id, color_temp_kelvin: kelvin });
  }

  _setHs(id, hue, sat) {
    const st = this._hass.states[id];
    const current = (st && st.attributes && st.attributes.hs_color) || [0, 100];
    const h = hue === null ? current[0] : hue;
    const s = sat === null ? current[1] : sat;
    this._hass.callService("light", "turn_on", {
      entity_id: id,
      hs_color: [Math.round(h), Math.round(s)],
    });
  }
}

/** Rough blackbody colour for a kelvin value, good enough for a swatch. */
function kelvinToCss(k) {
  const t = Math.max(1000, Math.min(12000, k)) / 100;
  let r, g, b;
  if (t <= 66) {
    r = 255;
    g = 99.47 * Math.log(t) - 161.12;
    b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  } else {
    r = 329.7 * Math.pow(t - 60, -0.1332);
    g = 288.12 * Math.pow(t - 60, -0.0755);
    b = 255;
  }
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}

/* ------------------------------------------ wabit-room-lights-card-editor */

const ROOM_LABELS = {
  area: "Room",
  title: "Card title (defaults to the room name)",
  pinned: "Always visible (everything else moves behind \"Show more\")",
  exclude: "Never show",
  collapse_groups: "Tuck group members away when nothing is pinned",
  show_header: "Show the room header",
  show_brightness: "Show brightness sliders",
  show_colour: "Show colour controls",
  strip_area_name: "Trim the room name off each light's label",
};

const ROOM_SCHEMA_TOP = [
  { name: "area", required: true, selector: { area: {} } },
  { name: "title", selector: { text: {} } },
];

const ROOM_SCHEMA_BOTTOM = [
  { name: "exclude", selector: { entity: { domain: "light", multiple: true } } },
  { name: "collapse_groups", selector: { boolean: {} } },
  { name: "show_brightness", selector: { boolean: {} } },
  { name: "show_colour", selector: { boolean: {} } },
  { name: "show_header", selector: { boolean: {} } },
  { name: "strip_area_name", selector: { boolean: {} } },
];

const ROOM_EDITOR_STYLES = `
  :host { display: block; }
  .section { margin: 16px 0 8px; }
  .section-title {
    font-size: 0.95rem; font-weight: 600; color: var(--primary-text-color);
    margin-bottom: 2px;
  }
  .hint {
    font-size: 0.78rem; color: var(--secondary-text-color);
    line-height: 1.45; margin-bottom: 8px;
  }
  .pin-list {
    display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px;
  }
  .pin-row {
    display: flex; align-items: center; gap: 4px;
    border: 1px solid var(--divider-color); border-radius: 10px;
    padding: 4px 4px 4px 12px;
  }
  .pin-name {
    flex: 1; min-width: 0; font-size: 0.9rem; color: var(--primary-text-color);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .pin-name.missing { color: var(--error-color, #db4437); }
  .pin-btn {
    flex: none; width: 30px; height: 30px; padding: 0; border: none;
    border-radius: 50%; background: none; cursor: pointer; font: inherit;
    font-size: 1rem; line-height: 1; color: var(--secondary-text-color);
    transition: background 140ms, color 140ms;
  }
  .pin-btn:hover:not(:disabled) {
    background: rgba(var(--rgb-primary-color, 63, 81, 181), 0.12);
    color: var(--primary-text-color);
  }
  .pin-btn:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 1px; }
  .pin-btn:disabled { opacity: 0.3; cursor: default; }
  .pin-btn.danger:hover:not(:disabled) {
    background: rgba(219, 68, 55, 0.14); color: var(--error-color, #db4437);
  }
  .empty-pins {
    font-size: 0.85rem; color: var(--secondary-text-color);
    border: 1px dashed var(--divider-color); border-radius: 10px;
    padding: 10px 12px; margin-bottom: 8px; line-height: 1.45;
  }
  select.add-pin {
    width: 100%; font: inherit; font-size: 0.9rem; padding: 8px 10px;
    border-radius: 10px; border: 1px solid var(--divider-color);
    background: var(--card-background-color); color: var(--primary-text-color);
  }
  .note {
    padding: 12px; border-radius: 12px; line-height: 1.5;
    background: rgba(var(--rgb-primary-color, 63, 81, 181), 0.08);
    color: var(--primary-text-color); font-size: 0.9rem;
  }
`;

class WabitRoomLightsCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...(config || {}) };
    if (!this._built) this._build();
    this._renderPins();
    this._syncAdd();
    this._push();
  }

  set hass(hass) {
    this._hass = hass;
    // Deliberately does NOT rebuild the pin list or the add picker. `hass` is
    // replaced on every state change in the house, and tearing down the picker
    // mid-interaction is what made its dropdown flicker and refuse to stay open.
    this._renderPins();
    this._refreshPinLabels();
    this._syncAdd();
    this._push();
  }

  get hass() {
    return this._hass;
  }

  _emit() {
    fireEvent(this, "config-changed", { config: this._config });
  }

  _pins() {
    return Array.isArray(this._config.pinned) ? this._config.pinned : [];
  }

  _setPins(list) {
    const next = { ...this._config };
    if (list.length) next.pinned = list;
    else delete next.pinned; // no `pinned` key means "show everything"
    this._config = next;
    this._emit();
    this._renderPins();
    this._syncAdd();
  }

  _move(index, delta) {
    const list = this._pins().slice();
    const to = index + delta;
    if (to < 0 || to >= list.length) return;
    [list[index], list[to]] = [list[to], list[index]];
    this._setPins(list);
  }

  _removePin(index) {
    const list = this._pins().slice();
    list.splice(index, 1);
    this._setPins(list);
  }

  _addPin(entityId) {
    if (!entityId || !String(entityId).startsWith("light.")) return;
    const list = this._pins();
    if (list.includes(entityId)) return;
    this._setPins(list.concat([entityId]));
  }

  /** Lights in the configured area, for the "add" picker. */
  _areaLights() {
    const hass = this._hass;
    if (!hass || !hass.areas || !this._config.area) return [];
    const areaId = resolveAreaId(hass, this._config.area);
    return areaId ? lightsInArea(hass, areaId) : [];
  }

  _labelFor(id) {
    const hass = this._hass;
    if (!hass) return id;
    const reg = (hass.entities || {})[id];
    const st = hass.states[id];
    return (
      (reg && reg.name) ||
      (st && st.attributes && st.attributes.friendly_name) ||
      id
    );
  }

  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = ROOM_EDITOR_STYLES;
    root.appendChild(style);

    if (!customElements.get("ha-form")) {
      const note = document.createElement("div");
      note.className = "note";
      note.textContent =
        "This Home Assistant build does not provide ha-form, so the visual editor " +
        "is unavailable. Configure this card in YAML instead - the options are " +
        "documented at " + REPO;
      root.appendChild(note);
      this._forms = null;
      this._built = true;
      return;
    }

    const mkForm = (schema) => {
      const f = document.createElement("ha-form");
      f.schema = schema;
      f.computeLabel = (s) => ROOM_LABELS[s.name] || s.name;
      f.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        this._config = { ...this._config, ...ev.detail.value };
        this._emit();
        // The area may have changed, so the rows and candidates must follow.
        this._renderPins();
        this._syncAdd();
      });
      return f;
    };

    const top = mkForm(ROOM_SCHEMA_TOP);
    root.appendChild(top);

    const section = document.createElement("div");
    section.className = "section";
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = "Always visible";
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent =
      "These stay on the card, in this order. Everything else in the room moves " +
      "behind the expander. Leave the list empty to show every light.";
    const list = document.createElement("div");
    list.className = "pin-list";
    const add = document.createElement("div");
    add.className = "pin-add";
    section.append(title, hint, list, add);
    root.appendChild(section);

    const bottom = mkForm(ROOM_SCHEMA_BOTTOM);
    root.appendChild(bottom);

    this._forms = { top, bottom };
    this._els = { list, add, rows: [] };
    this._built = true;
  }

  /** Rebuilds the rows only when the pinned list or the area has changed. */
  _renderPins(force) {
    if (!this._built || !this._els || !this._hass) return;
    const pins = this._pins();
    const key = JSON.stringify([this._config.area, pins]);
    if (!force && key === this._pinsKey) return;
    this._pinsKey = key;

    const list = this._els.list;
    list.innerHTML = "";
    this._els.rows = [];

    if (!pins.length) {
      const empty = document.createElement("div");
      empty.className = "empty-pins";
      empty.textContent =
        "Nothing pinned, so every light in the room is shown. Add one below to " +
        "start choosing.";
      list.appendChild(empty);
    }

    pins.forEach((id, i) => {
      const row = document.createElement("div");
      row.className = "pin-row";

      const name = document.createElement("span");
      name.className = "pin-name";

      const mkBtn = (glyph, label, disabled, fn, danger) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = danger ? "pin-btn danger" : "pin-btn";
        b.textContent = glyph;
        b.title = label;
        b.disabled = !!disabled;
        b.addEventListener("click", fn);
        return b;
      };

      row.append(
        name,
        mkBtn("\u2191", "Move up", i === 0, () => this._move(i, -1)),
        mkBtn("\u2193", "Move down", i === pins.length - 1, () => this._move(i, 1)),
        mkBtn("\u2715", "Remove", false, () => this._removePin(i), true)
      );
      list.appendChild(row);
      this._els.rows.push({ id, name, row });
    });

    this._refreshPinLabels();
  }

  /** Names can change under us; updating the text costs nothing and rebuilds nothing. */
  _refreshPinLabels() {
    if (!this._els || !this._els.rows || !this._hass) return;
    this._els.rows.forEach(({ id, name, row }) => {
      const known = !!this._hass.states[id];
      const label = known ? this._labelFor(id) : `${id} (not found)`;
      if (name.textContent !== label) name.textContent = label;
      name.className = known ? "pin-name" : "pin-name missing";
      [...row.children].forEach((c) => {
        if (c.title) c.setAttribute("aria-label", `${c.title}: ${label}`);
      });
    });
  }

  /**
   * Creates the add control once, then only touches it when the candidates
   * change. Recreating it on every hass update is what broke the dropdown.
   */
  _syncAdd() {
    if (!this._built || !this._els || !this._hass) return;
    const { add } = this._els;
    const pins = this._pins();
    const candidates = this._areaLights()
      .filter((id) => !pins.includes(id))
      .sort((a, b) => this._labelFor(a).localeCompare(this._labelFor(b)));
    const key = JSON.stringify(candidates);

    if (!this._els.add_kind) {
      if (customElements.get("ha-entity-picker")) {
        const picker = document.createElement("ha-entity-picker");
        picker.includeDomains = ["light"];
        picker.label = "Add a light";
        picker.allowCustomEntity = false;
        picker.value = "";
        picker.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          const v = ev.detail && ev.detail.value;
          picker.value = "";
          this._addPin(v);
        });
        add.appendChild(picker);
        this._els.picker = picker;
        this._els.add_kind = "picker";
      } else {
        const sel = document.createElement("select");
        sel.className = "add-pin";
        sel.addEventListener("change", () => {
          const v = sel.value;
          sel.value = "";
          this._addPin(v);
        });
        add.appendChild(sel);
        this._els.picker = sel;
        this._els.add_kind = "select";
      }
    }

    const el = this._els.picker;
    if (this._els.add_kind === "picker") {
      el.hass = this._hass;
      if (key !== this._addKey) {
        el.includeEntities = candidates.length ? candidates : undefined;
      }
    } else if (key !== this._addKey) {
      el.innerHTML = "";
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = candidates.length ? "Add a light\u2026" : "No more lights in this room";
      el.appendChild(blank);
      candidates.forEach((id) => {
        const o = document.createElement("option");
        o.value = id;
        o.textContent = this._labelFor(id);
        el.appendChild(o);
      });
      el.disabled = !candidates.length;
    }
    this._addKey = key;
  }

  _push() {
    if (!this._forms || !this._hass || !this._config) return;
    const assign = (form, data) => {
      form.hass = this._hass;
      if (JSON.stringify(form.data) !== JSON.stringify(data)) form.data = data;
    };
    assign(this._forms.top, {
      area: this._config.area,
      title: this._config.title,
    });
    assign(this._forms.bottom, {
      exclude: this._config.exclude,
      collapse_groups: this._config.collapse_groups === true,
      show_brightness: this._config.show_brightness !== false,
      show_colour: this._config.show_colour !== false && this._config.show_color !== false,
      show_header: this._config.show_header !== false,
      strip_area_name: this._config.strip_area_name !== false,
    });
  }
}

if (!customElements.get("wabit-room-lights-card")) {
  customElements.define("wabit-room-lights-card", WabitRoomLightsCard);
}
if (!customElements.get("wabit-room-lights-card-editor")) {
  customElements.define("wabit-room-lights-card-editor", WabitRoomLightsCardEditor);
}

if (!window.customCards.some((c) => c.type === "wabit-room-lights-card")) {
  window.customCards.push({
    type: "wabit-room-lights-card",
    name: "Wabit Room Lights",
    description:
      "Every light in a room, found automatically: pin the ones you use, tuck the " +
      "rest behind Show more, with brightness and colour per light.",
    preview: true,
    documentationURL: REPO,
  });
}

/* ---------------------------------------------- wabit-bin-collection-card */

/**
 * The UK Bin Collection Data integration stamps every bin sensor with this
 * device class, which is what lets the card find them without being told.
 */
const BIN_DEVICE_CLASS = "bin_collection_schedule";

/** Every bin sensor that integration has created. */
function discoverBinSensors(hass) {
  const states = (hass && hass.states) || {};
  return Object.keys(states)
    .filter((id) => id.startsWith("sensor."))
    .filter((id) => {
      const a = states[id].attributes || {};
      return a.device_class === BIN_DEVICE_CLASS;
    })
    .sort();
}

/**
 * Longest run of leading whole words shared by every name. The integration
 * prefixes each sensor with its config entry name ("Bins 240L green garden
 * bin"), which is noise once they are all on one card.
 */
function commonWordPrefix(names) {
  if (names.length < 2) return "";
  const split = names.map((n) => String(n).trim().split(/\s+/));
  const first = split[0];
  let i = 0;
  while (i < first.length - 1) {
    const word = first[i];
    // Never strip so much that a name would be left empty.
    if (!split.every((w) => w.length > i + 1 && w[i] === word)) break;
    i += 1;
  }
  return first.slice(0, i).join(" ");
}

/**
 * Drops a leading volume from a bin's name: "240L green garden bin" is a
 * garden bin whatever size it happens to be. Never returns an empty string.
 */
function stripBinSize(name) {
  const out = String(name)
    .replace(/^\s*\d+\s*(?:l|ltr|litres?|liters?)\b[\s.\-]*/i, "")
    .trim();
  return out || String(name).trim();
}

/** "green garden bin" -> "Green garden bin" (sentence) or "Green Garden Bin" (title). */
function applyCase(name, mode) {
  const s = String(name);
  if (!s || mode === "none") return s;
  if (mode === "title") return s.replace(/\b\p{Ll}/gu, (c) => c.toUpperCase());
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const DEFAULT_BINS = {
  green: { label: "Garden", color: "#3fa34d" },
  grey: { label: "General Waste", color: "#7a7f85" },
  beige: { label: "Recycling", color: "#d9b56b" },
  burgundy: { label: "Food Waste", color: "#7c2740" },
};

/** "07/10/2026" (DD/MM/YYYY) -> Date at local midnight, or null. */
function parseDMY(raw) {
  if (typeof raw !== "string") return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, mo - 1, d);
  // Rejects things like 31/02, which Date would silently roll over.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
    return null;
  }
  return date;
}

/** Whole days from today to `date`, both taken at local midnight. */
function daysUntil(date, now) {
  const a = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a - b) / 86400000);
}

function relativeDays(days) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 0) return days === -1 ? "Yesterday" : `${-days} days ago`;
  return `in ${days} days`;
}

/**
 * Formatted in Home Assistant's own language rather than the browser's, so the
 * card reads the same as the rest of HA for everyone looking at the dashboard.
 */
function formatBinDate(date, locale) {
  try {
    return date.toLocaleDateString(locale || undefined, {
      weekday: "short", day: "numeric", month: "short",
    });
  } catch (e) {
    return date.toDateString();
  }
}

const BIN_STYLES = `
  :host {
    display: block;
    --wc-text: var(--md-sys-color-on-surface, var(--primary-text-color, #212121));
    --wc-muted: var(--md-sys-color-on-surface-variant, var(--secondary-text-color, #727272));
    --wc-accent: var(--md-sys-color-primary, var(--primary-color, #3f51b5));
    --wc-tonal: var(--md-sys-color-surface-container-highest,
                 rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.08));
    --wc-outline: var(--md-sys-color-outline-variant, var(--divider-color, #e0e0e0));
    --wc-accent-tonal: var(--md-sys-color-primary-container,
                        rgba(var(--rgb-primary-color, 63, 81, 181), 0.16));
    --wc-on-accent-tonal: var(--md-sys-color-on-primary-container, var(--wc-accent));
  }
  ha-card { overflow: hidden; }
  .body { padding: 16px; }
  .body.tight { padding-top: 4px; }

  .header { padding: 12px 16px 4px; }
  .title {
    color: var(--ha-card-header-color, var(--wc-text));
    font-family: var(--ha-card-header-font-family, inherit);
    font-size: var(--ha-card-header-font-size, 24px);
    font-weight: 400; letter-spacing: -0.012em; line-height: 1.25;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  /* ------------------------------------------------------------- hero */
  .hero { padding: 2px 0 14px; }
  .hero.hidden { display: none; }
  .eyebrow {
    font-size: 0.7rem; letter-spacing: 0.09em; text-transform: uppercase;
    color: var(--wc-muted); font-weight: 600;
  }
  .hero-main { display: flex; align-items: baseline; gap: 10px; margin-top: 2px; }
  .hero-date {
    font-size: 1.9rem; font-weight: 300; line-height: 1.1;
    letter-spacing: -0.02em; color: var(--wc-text); flex: 1; min-width: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .hero-when {
    font-size: 0.78rem; font-weight: 600; white-space: nowrap;
    color: var(--wc-on-accent-tonal); background: var(--wc-accent-tonal);
    padding: 4px 10px; border-radius: 999px; align-self: center;
  }
  .hero.soon .hero-when { background: var(--wc-accent); color: var(--card-background-color, #fff); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .chip {
    display: inline-flex; align-items: center; gap: 7px;
    background: var(--wc-tonal); border-radius: 999px;
    padding: 5px 12px 5px 8px; font-size: 0.85rem; color: var(--wc-text);
  }
  .dot {
    width: 12px; height: 12px; border-radius: 50%; flex: none;
    background: var(--bin, var(--wc-accent));
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18);
  }
  /* The UK Bin Collection Data integration gives each bin its own icon, which
     says more than a coloured dot. Falls back to the dot when there is none. */
  .glyph { color: var(--bin, var(--wc-accent)); flex: none; }
  .glyph-chip { --mdc-icon-size: 19px; }
  .glyph-row { --mdc-icon-size: 24px; }

  /* ------------------------------------------------------------- rows */
  .row {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 0; border-top: 1px solid var(--wc-outline);
  }
  .bars { display: flex; gap: 3px; flex: none; }
  .bar {
    width: 6px; height: 30px; border-radius: 3px;
    background: var(--bin, var(--wc-accent));
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18);
  }
  .row-main { flex: 1; min-width: 0; }
  .row-label {
    color: var(--wc-text); font-size: 0.95rem; line-height: 1.35;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .row-date { color: var(--wc-muted); font-size: 0.78rem; line-height: 1.35; }
  .row-when {
    color: var(--wc-muted); font-size: 0.8rem; white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .empty, .error { font-size: 0.9rem; line-height: 1.5; padding: 6px 0; }
  .empty { color: var(--wc-muted); }
  .error { color: var(--error-color, #db4437); }
`;

class WabitBinCollectionCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("wabit-bin-collection-card-editor");
  }

  static getStubConfig(hass) {
    // Nothing to configure when the bin sensors can be found on their own.
    if (discoverBinSensors(hass).length) {
      return { type: "custom:wabit-bin-collection-card" };
    }
    const ids = Object.keys((hass && hass.states) || {});
    const found = ids.find(
      (e) => e.startsWith("sensor.") && /bin|waste|refuse|recycl/.test(e)
    );
    const stub = { type: "custom:wabit-bin-collection-card" };
    if (found) stub.entity = found;
    return stub;
  }

  setConfig(config) {
    const cfg = config || {};
    // Three ways in: an explicit list of per-bin sensors, a single sensor with
    // one attribute per bin (the older scraper shape), or nothing at all, in
    // which case the bin sensors are discovered.
    if (!isUnset(cfg.entity) && !String(cfg.entity).startsWith("sensor.")) {
      throw new Error("wabit-bin-collection-card: `entity` must be a sensor");
    }
    if (cfg.entities !== undefined && !Array.isArray(cfg.entities)) {
      throw new Error("wabit-bin-collection-card: `entities` must be a list of sensors");
    }
    (cfg.entities || []).forEach((e) => {
      if (typeof e !== "string" || !e.startsWith("sensor.")) {
        throw new Error(
          `wabit-bin-collection-card: \`entities\` may only contain sensors, got "${e}"`
        );
      }
    });
    const bins = {};
    const src = cfg.bins && typeof cfg.bins === "object" ? cfg.bins : DEFAULT_BINS;
    for (const [key, v] of Object.entries(src)) {
      const def = DEFAULT_BINS[key] || {};
      bins[key] = {
        label: (v && v.label) || def.label || key,
        color: (v && v.color) || def.color || "#9e9e9e",
      };
    }
    if (!Object.keys(bins).length) {
      throw new Error("wabit-bin-collection-card: `bins` must list at least one bin");
    }

    this._config = {
      entity: isUnset(cfg.entity) ? null : cfg.entity,
      entities: Array.isArray(cfg.entities) && cfg.entities.length ? cfg.entities : null,
      overrides: cfg.overrides && typeof cfg.overrides === "object" ? cfg.overrides : {},
      strip_prefix: cfg.strip_prefix !== false,
      strip_size: cfg.strip_size !== false,
      label_case: ["title", "none"].includes(cfg.label_case) ? cfg.label_case : "sentence",
      title: cfg.title === undefined ? "Bin Collection" : cfg.title,
      bins,
      show_hero: cfg.show_hero !== false,
      // `glass` and `glassOpacity` from the previous card are accepted and ignored,
      // so an existing config keeps working after switching card type.
    };

    this._built = false;
    this._rowsKey = null;
    this._chipsKey = null;
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config) this._render();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    // "in 5 days" must not go stale if the dashboard is left open overnight.
    this._tick = window.setInterval(() => {
      if (this._built && this._hass) this._render();
    }, 300000);
  }

  disconnectedCallback() {
    if (this._tick) window.clearInterval(this._tick);
    this._tick = null;
  }

  getCardSize() {
    const m = this._lastModel;
    if (!m || m.error) return 3;
    return 1 + (this._config.show_hero ? 2 : 0) + m.rows.length;
  }

  /** One entry per bin, from whichever source this card is configured for. */
  _items() {
    const cfg = this._config;
    if (cfg.entity) return this._legacyItems();
    const ids = cfg.entities || discoverBinSensors(this._hass);
    return this._sensorItems(ids);
  }

  /** A single sensor carrying one object attribute per bin. */
  _legacyItems() {
    const cfg = this._config;
    const st = this._hass.states[cfg.entity];
    if (!st) return { error: `${cfg.entity} is not available.` };
    const attrs = st.attributes || {};
    const now = new Date();
    const items = [];
    for (const [key, conf] of Object.entries(cfg.bins)) {
      const data = attrs[key];
      if (!data || typeof data !== "object") continue;
      const date = parseDMY(data.date);
      items.push({
        key, label: conf.label, color: conf.color, raw: data.date, date,
        days: date ? daysUntil(date, now) : null,
        fallback: data.relative_time,
      });
    }
    return items.length ? { items } : { empty: `No bin data in ${cfg.entity}.` };
  }

  /** One sensor per bin, each carrying colour, next_collection and days. */
  _sensorItems(ids) {
    const hass = this._hass;
    const cfg = this._config;
    const live = ids.filter((id) => hass.states[id]);
    if (!live.length) {
      return {
        empty: cfg.entities
          ? "None of the configured bin sensors are available."
          : "No bin sensors found. Set up the UK Bin Collection Data integration, " +
            "or point the card at a sensor with `entity`.",
      };
    }

    const nameOf = (id) => {
      const st = hass.states[id];
      return (st.attributes && st.attributes.friendly_name) || id;
    };
    const prefix = cfg.strip_prefix ? commonWordPrefix(live.map(nameOf)) : "";

    const now = new Date();
    const items = live.map((id) => {
      const st = hass.states[id];
      const a = st.attributes || {};
      const over = cfg.overrides[id] || {};
      let label = nameOf(id);
      if (prefix && label.toLowerCase().startsWith(prefix.toLowerCase())) {
        const rest = label.slice(prefix.length).trim();
        if (rest) label = rest;
      }
      if (cfg.strip_size) label = stripBinSize(label);
      // An explicit override is used exactly as written; only derived names are tidied.
      label = applyCase(label, cfg.label_case);
      const date = parseDMY(a.next_collection);
      return {
        key: id,
        label: over.label || label,
        color: over.color || a.colour || a.color || "#9e9e9e",
        raw: a.next_collection,
        icon: over.icon || a.icon || null,
        date,
        // Recomputed from the date so it stays right overnight, with the
        // integration's own count as the fallback.
        days: date ? daysUntil(date, now) : (typeof a.days === "number" ? a.days : null),
        fallback: st.state,
      };
    });
    return { items };
  }

  /** Bins grouped by collection day, soonest first. */
  _model() {
    const sourced = this._items();
    if (sourced.error || sourced.empty) return sourced;
    const items = sourced.items;

    // Two bins on the same day are one collection, not two rows.
    const groups = new Map();
    for (const it of items) {
      const key = it.date
        ? `${it.date.getFullYear()}-${it.date.getMonth()}-${it.date.getDate()}`
        : `raw:${it.raw}`;
      if (!groups.has(key)) {
        groups.set(key, { date: it.date, raw: it.raw, days: it.days, fallback: it.fallback, bins: [] });
      }
      groups.get(key).bins.push(it);
    }

    const list = [...groups.values()].sort((a, b) => {
      if (a.date && b.date) return a.date - b.date;
      if (a.date) return -1; // undated entries sort last
      if (b.date) return 1;
      return 0;
    });

    const hero = this._config.show_hero ? list[0] : null;
    return { groups: list, hero, rows: hero ? list.slice(1) : list };
  }

  _locale() {
    const l = this._hass && this._hass.locale;
    return (l && l.language) || undefined;
  }

  /** The bin's own icon when it has one, otherwise a coloured dot. */
  _binGlyph(item, cls) {
    if (item.icon && customElements.get("ha-icon")) {
      const el = document.createElement("ha-icon");
      el.setAttribute("icon", item.icon);
      // Deliberately not the dot/bar classes: those paint a background in the
      // same colour the glyph is drawn in, which would hide the icon entirely.
      el.className = cls === "bar" ? "glyph glyph-row" : "glyph glyph-chip";
      el.style.setProperty("--bin", item.color);
      el.title = item.label;
      return el;
    }
    const span = document.createElement("span");
    span.className = cls;
    span.style.setProperty("--bin", item.color);
    span.title = item.label;
    return span;
  }

  _label(group) {
    return group.bins.map((b) => b.label).join(" + ");
  }

  _when(group) {
    return group.days === null || group.days === undefined
      ? group.fallback || ""
      : relativeDays(group.days);
  }

  _render() {
    if (!this._config || !this._hass) return;
    if (!this._built) this._build();
    const model = this._model();
    this._lastModel = model;

    const { error, empty, hero, rows } = this._els;

    if (model.error || model.empty) {
      error.textContent = model.error || "";
      error.style.display = model.error ? "" : "none";
      empty.textContent = model.empty || "";
      empty.style.display = model.empty ? "" : "none";
      hero.classList.add("hidden");
      rows.innerHTML = "";
      this._rowsKey = null;
      return;
    }
    error.style.display = "none";
    empty.style.display = "none";

    this._renderHero(model);

    const key = JSON.stringify(
      model.rows.map((g) => [g.raw, g.days, g.bins.map((b) => b.key)])
    );
    if (key !== this._rowsKey) {
      this._rowsKey = key;
      this._renderRows(model);
    }
  }

  _renderHero(model) {
    const h = this._els;
    if (!this._config.show_hero || !model.hero) {
      h.hero.classList.add("hidden");
      return;
    }
    const g = model.hero;
    h.hero.classList.remove("hidden");
    h.heroDate.textContent = g.date
      ? formatBinDate(g.date, this._locale())
      : g.raw || "Unknown date";
    h.heroWhen.textContent = this._when(g);
    // Today and tomorrow earn a solid chip; anything further out stays tonal.
    h.hero.classList.toggle("soon", g.days !== null && g.days <= 1);

    // Same reasoning as the rows: only rebuild when the bins themselves change,
    // not on every hass update.
    const chipKey = JSON.stringify(g.bins.map((b) => [b.key, b.label, b.color, b.icon]));
    if (chipKey === this._chipsKey) return;
    this._chipsKey = chipKey;

    h.chips.innerHTML = "";
    g.bins.forEach((b) => {
      const chip = document.createElement("div");
      chip.className = "chip";
      const label = document.createElement("span");
      label.textContent = b.label;
      chip.append(this._binGlyph(b, "dot"), label);
      h.chips.appendChild(chip);
    });
  }

  _renderRows(model) {
    const host = this._els.rows;
    host.innerHTML = "";
    model.rows.forEach((g) => {
      const row = document.createElement("div");
      row.className = "row";

      const bars = document.createElement("div");
      bars.className = "bars";
      g.bins.forEach((b) => bars.appendChild(this._binGlyph(b, "bar")));

      const main = document.createElement("div");
      main.className = "row-main";
      const label = document.createElement("div");
      label.className = "row-label";
      label.textContent = this._label(g);
      const date = document.createElement("div");
      date.className = "row-date";
      date.textContent = g.date ? formatBinDate(g.date, this._locale()) : g.raw || "";
      main.append(label, date);

      const when = document.createElement("div");
      when.className = "row-when";
      when.textContent = this._when(g);

      row.append(bars, main, when);
      host.appendChild(row);
    });
  }

  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = BIN_STYLES;
    root.appendChild(style);

    const card = document.createElement("ha-card");
    root.appendChild(card);

    if (this._config.title) {
      const header = document.createElement("div");
      header.className = "header";
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = this._config.title;
      header.appendChild(title);
      card.appendChild(header);
    }

    const body = document.createElement("div");
    body.className = this._config.title ? "body tight" : "body";
    card.appendChild(body);

    const error = document.createElement("div");
    error.className = "error";
    error.style.display = "none";
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.style.display = "none";
    body.append(error, empty);

    const hero = document.createElement("div");
    hero.className = "hero";
    const eyebrow = document.createElement("div");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = "Next collection";
    const main = document.createElement("div");
    main.className = "hero-main";
    const heroDate = document.createElement("div");
    heroDate.className = "hero-date";
    const heroWhen = document.createElement("div");
    heroWhen.className = "hero-when";
    main.append(heroDate, heroWhen);
    const chips = document.createElement("div");
    chips.className = "chips";
    hero.append(eyebrow, main, chips);
    body.appendChild(hero);

    const rows = document.createElement("div");
    rows.className = "rows";
    body.appendChild(rows);

    this._els = { error, empty, hero, heroDate, heroWhen, chips, rows };
    this._built = true;
  }
}

/* --------------------------------------- wabit-bin-collection-card-editor */

const BIN_LABELS = {
  entities: "Bin sensors (leave empty to find them automatically)",
  entity: "Or one sensor with an attribute per bin (older scraper setups)",
  title: "Card title (leave empty for no header)",
  show_hero: "Show the next-collection panel",
  strip_prefix: "Trim the shared prefix off each bin's name",
  strip_size: "Trim the bin size (240L) off each name",
  label_case: "Capitalisation",
};

const BIN_SCHEMA = [
  { name: "entities", selector: { entity: { domain: "sensor", multiple: true } } },
  { name: "entity", selector: { entity: { domain: "sensor" } } },
  { name: "title", selector: { text: {} } },
  { name: "show_hero", selector: { boolean: {} } },
  { name: "strip_prefix", selector: { boolean: {} } },
  { name: "strip_size", selector: { boolean: {} } },
  {
    name: "label_case",
    selector: {
      select: {
        mode: "dropdown",
        options: [
          { value: "sentence", label: "Green garden bin" },
          { value: "title", label: "Green Garden Bin" },
          { value: "none", label: "green garden bin" },
        ],
      },
    },
  },
];

const BIN_EDITOR_STYLES = `
  :host { display: block; }
  .section { margin: 16px 0 4px; }
  .section-title {
    font-size: 0.95rem; font-weight: 600; color: var(--primary-text-color);
    margin-bottom: 2px;
  }
  .hint {
    font-size: 0.78rem; color: var(--secondary-text-color);
    line-height: 1.45; margin-bottom: 8px;
  }
  .bin-row {
    display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
  }
  .bin-key {
    flex: 0 0 84px; font-size: 0.78rem; text-transform: capitalize;
    color: var(--secondary-text-color);
  }
  .bin-row input[type="text"] {
    flex: 1; min-width: 0; font: inherit; font-size: 0.9rem; padding: 8px 10px;
    border-radius: 10px; border: 1px solid var(--divider-color);
    background: var(--card-background-color); color: var(--primary-text-color);
  }
  .bin-row input[type="color"] {
    flex: none; width: 40px; height: 34px; padding: 2px; cursor: pointer;
    border: 1px solid var(--divider-color); border-radius: 10px; background: none;
  }
  .note {
    padding: 12px; border-radius: 12px; line-height: 1.5;
    background: rgba(var(--rgb-primary-color, 63, 81, 181), 0.08);
    color: var(--primary-text-color); font-size: 0.9rem;
  }
`;

class WabitBinCollectionCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...(config || {}) };
    if (!this._config.bins) this._config.bins = { ...DEFAULT_BINS };
    if (!this._built) this._build();
    this._renderBins();
    this._push();
  }

  set hass(hass) {
    this._hass = hass;
    this._push();
  }

  get hass() {
    return this._hass;
  }

  _emit() {
    fireEvent(this, "config-changed", { config: this._config });
  }

  _setBin(key, patch) {
    const bins = { ...this._config.bins, [key]: { ...this._config.bins[key], ...patch } };
    this._config = { ...this._config, bins };
    this._emit();
  }

  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = BIN_EDITOR_STYLES;
    root.appendChild(style);

    if (!customElements.get("ha-form")) {
      const note = document.createElement("div");
      note.className = "note";
      note.textContent =
        "This Home Assistant build does not provide ha-form, so the visual editor " +
        "is unavailable. Configure this card in YAML instead - the options are " +
        "documented at " + REPO;
      root.appendChild(note);
      this._form = null;
      this._built = true;
      return;
    }

    const form = document.createElement("ha-form");
    form.schema = BIN_SCHEMA;
    form.computeLabel = (s) => BIN_LABELS[s.name] || s.name;
    form.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      this._config = { ...this._config, ...ev.detail.value };
      this._emit();
      this._renderBins(); // switching to or from single-sensor mode
    });
    root.appendChild(form);

    const section = document.createElement("div");
    section.className = "section";
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = "Bins";
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent =
      "Labels and colours for the single-sensor setup above. Bin sensors found " +
      "automatically bring their own colour, so this section does not apply to them.";
    const list = document.createElement("div");
    list.className = "bin-list";
    section.append(title, hint, list);
    root.appendChild(section);

    this._form = form;
    this._els = { list, section };
    this._built = true;
  }

  _renderBins() {
    if (!this._els) return;
    // The per-bin labels and colours only mean anything in single-sensor mode.
    const legacy = !!this._config.entity;
    this._els.section.style.display = legacy ? "" : "none";
    // Keyed on which bins exist, not on their labels: rebuilding these rows
    // while someone is editing a label would throw focus out of the field.
    const key = legacy ? Object.keys(this._config.bins).join("|") : "";
    if (key === this._binKey) return;
    this._binKey = key;
    const list = this._els.list;
    list.innerHTML = "";
    if (!legacy) return;
    Object.entries(this._config.bins).forEach(([key, conf]) => {
      const row = document.createElement("div");
      row.className = "bin-row";

      const name = document.createElement("span");
      name.className = "bin-key";
      name.textContent = key;

      const label = document.createElement("input");
      label.type = "text";
      label.value = conf.label || "";
      label.placeholder = key;
      label.addEventListener("change", () => this._setBin(key, { label: label.value }));

      const colour = document.createElement("input");
      colour.type = "color";
      colour.value = conf.color || "#9e9e9e";
      colour.addEventListener("change", () => this._setBin(key, { color: colour.value }));

      row.append(name, label, colour);
      list.appendChild(row);
    });
  }

  _push() {
    if (!this._form || !this._hass || !this._config) return;
    this._form.hass = this._hass;
    const data = {
      entities: this._config.entities,
      entity: this._config.entity,
      title: this._config.title === undefined ? "Bin Collection" : this._config.title,
      show_hero: this._config.show_hero !== false,
      strip_prefix: this._config.strip_prefix !== false,
      strip_size: this._config.strip_size !== false,
      label_case: ["title", "none"].includes(this._config.label_case)
        ? this._config.label_case
        : "sentence",
    };
    if (JSON.stringify(this._form.data) !== JSON.stringify(data)) this._form.data = data;
  }
}

if (!customElements.get("wabit-bin-collection-card")) {
  customElements.define("wabit-bin-collection-card", WabitBinCollectionCard);
}
if (!customElements.get("wabit-bin-collection-card-editor")) {
  customElements.define("wabit-bin-collection-card-editor", WabitBinCollectionCardEditor);
}

if (!window.customCards.some((c) => c.type === "wabit-bin-collection-card")) {
  window.customCards.push({
    type: "wabit-bin-collection-card",
    name: "Wabit Bin Collection",
    description:
      "Upcoming bin collections, grouped by day so bins that go out together read " +
      "as one collection.",
    preview: true,
    documentationURL: REPO,
  });
}

/* ------------------------------------------------------- wabit-media-card */

/* media_player supported_features bits we care about. */
const MF = {
  PAUSE: 1, SEEK: 2, VOLUME_SET: 4, VOLUME_MUTE: 8,
  PREVIOUS: 16, NEXT: 32, TURN_ON: 128, TURN_OFF: 256,
  VOLUME_STEP: 1024, SELECT_SOURCE: 2048, STOP: 4096, PLAY: 16384,
};
const can = (st, bit) => !!(((st && st.attributes && st.attributes.supported_features) || 0) & bit);

/**
 * Platforms that expose a player which never reports what is actually playing.
 * sonos_cloud mirrors every Sonos purely for announcements, and UniFi Protect
 * camera speakers are a one-way intercom - both are noise in a room card.
 */
const MEDIA_NOISE_PLATFORMS = ["sonos_cloud", "unifiprotect"];

const ACTIVE_STATES = new Set(["playing", "paused", "buffering"]);
const DEAD_STATES = new Set(["unavailable", "unknown"]);

/** Higher sorts first: what the room should feature. */
function mediaRank(st) {
  if (!st) return -1;
  const s = st.state;
  if (s === "playing" || s === "buffering") return 5;
  if (s === "paused") return 4;
  if (s === "on" && (st.attributes || {}).media_title) return 3;
  if (s === "on") return 2;
  if (s === "idle") return 1;
  if (s === "off") return 0;
  return -1; // unavailable / unknown
}

function mediaPlayersInArea(hass, areaId, denyPlatforms) {
  const entities = (hass && hass.entities) || {};
  const devices = (hass && hass.devices) || {};
  const deny = new Set(denyPlatforms || []);
  const out = [];
  for (const [id, ent] of Object.entries(entities)) {
    if (!id.startsWith("media_player.")) continue;
    if (ent.entity_category || ent.hidden || ent.hidden_by || ent.disabled_by) continue;
    if (ent.platform && deny.has(ent.platform)) continue;
    const device = ent.device_id ? devices[ent.device_id] : null;
    const area = ent.area_id || (device ? device.area_id : null);
    if (area !== areaId) continue;
    if (!hass.states[id]) continue;
    out.push(id);
  }
  return out.sort();
}

/** 93 -> "1:33", 3725 -> "1:02:05" */
function formatDuration(totalSeconds) {
  const t = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/**
 * Where the track has got to now. Home Assistant reports the position at a
 * moment in time, so it has to be advanced by hand while playing.
 */
function mediaPosition(st, now) {
  const a = (st && st.attributes) || {};
  if (typeof a.media_position !== "number") return null;
  let pos = a.media_position;
  if (st.state === "playing" && a.media_position_updated_at) {
    const since = (now.getTime() - new Date(a.media_position_updated_at).getTime()) / 1000;
    if (Number.isFinite(since) && since > 0) pos += since;
  }
  const dur = typeof a.media_duration === "number" ? a.media_duration : null;
  return dur ? Math.min(pos, dur) : pos;
}

/** The line under the title: artist, show, station or app, whichever fits. */
function mediaSubtitle(st) {
  const a = (st && st.attributes) || {};
  if (a.media_artist) {
    return a.media_album_name ? `${a.media_artist} — ${a.media_album_name}` : a.media_artist;
  }
  if (a.media_series_title) {
    const se =
      a.media_season && a.media_episode ? ` · S${a.media_season}E${a.media_episode}` : "";
    return `${a.media_series_title}${se}`;
  }
  if (a.media_channel) return a.media_channel;
  if (a.app_name) return a.app_name;
  return "";
}

function mediaTitle(st) {
  const a = (st && st.attributes) || {};
  return a.media_title || a.media_channel || a.app_name || "";
}

const MEDIA_STYLES = `
  :host {
    display: block;
    --wc-text: var(--md-sys-color-on-surface, var(--primary-text-color, #212121));
    --wc-muted: var(--md-sys-color-on-surface-variant, var(--secondary-text-color, #727272));
    --wc-accent: var(--md-sys-color-primary, var(--primary-color, #3f51b5));
    --wc-tonal: var(--md-sys-color-surface-container-highest,
                 rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.08));
    --wc-outline: var(--md-sys-color-outline-variant, var(--divider-color, #e0e0e0));
    --wc-accent-tonal: var(--md-sys-color-primary-container,
                        rgba(var(--rgb-primary-color, 63, 81, 181), 0.16));
    --wc-on-accent-tonal: var(--md-sys-color-on-primary-container, var(--wc-accent));
  }
  ha-card { overflow: hidden; }
  .header { padding: 12px 16px 4px; }
  .title {
    color: var(--ha-card-header-color, var(--wc-text));
    font-family: var(--ha-card-header-font-family, inherit);
    font-size: var(--ha-card-header-font-size, 24px);
    font-weight: 400; letter-spacing: -0.012em; line-height: 1.25;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .body { padding: 12px 16px 16px; position: relative; }
  .body.tight { padding-top: 4px; }
  /* The presets and the player list sat on bare card, which read as a separate
     block bolted under the artwork. They now share the album's colour. */
  .body-wash {
    position: absolute; inset: 0; z-index: 0; pointer-events: none;
    background: var(--art) center/cover no-repeat;
    filter: blur(44px) saturate(1.5);
    opacity: 0; transition: opacity 500ms ease;
  }
  .body.tinted .body-wash { opacity: 0.18; }
  .body > *:not(.body-wash) { position: relative; z-index: 1; }
  @media (prefers-reduced-motion: reduce) { .body-wash { transition: none; } }

  /* ------------------------------------------------------------- now playing */
  .stage { position: relative; }
  /* The artwork, blurred and heavily scrimmed, washes the panel in the album's
     own colour without putting text on top of arbitrary imagery. */
  .wash {
    position: absolute; inset: -20px -20px -8px; z-index: 0; pointer-events: none;
    background: var(--art) center/cover no-repeat;
    filter: blur(28px) saturate(1.35);
    opacity: 0; transition: opacity 500ms ease;
    /* Faded at both ends: a hard top edge reads as a band across the card. */
    -webkit-mask-image: linear-gradient(180deg,
      transparent 0%, #000 22%, #000 58%, transparent 100%);
    mask-image: linear-gradient(180deg,
      transparent 0%, #000 22%, #000 58%, transparent 100%);
  }
  .stage.washed .wash { opacity: 0.3; }
  .stage-body { position: relative; z-index: 1; }
  .now { position: relative; z-index: 1; display: flex; gap: 16px; align-items: flex-start; }

  /* ------------------------------------------------------- cover artwork --
     The artwork becomes the panel, bleeding to the card edges, with the text
     and controls laid over it - the same idea as Home Assistant's own media
     control card. A scrim keeps text readable over any image. */
  .stage.cover {
    margin: -4px -16px 0; min-height: 268px;
    display: flex; align-items: stretch;
    background: var(--art) center/cover no-repeat;
  }
  /* The scrim never thins out completely. Text sits near the top of the panel,
     where a bottom-weighted gradient leaves nothing, so a bright image would
     make the title unreadable. It stays dark enough everywhere for white text,
     and darkens further behind the controls. */
  .stage.cover .wash {
    inset: 0; opacity: 1; filter: none;
    background: linear-gradient(to top,
      rgba(0, 0, 0, 0.92) 0%, rgba(0, 0, 0, 0.74) 30%,
      rgba(0, 0, 0, 0.56) 62%, rgba(0, 0, 0, 0.44) 100%);
    -webkit-mask-image: none; mask-image: none;
  }
  /* Spread top to bottom so the title uses the space rather than hugging the
     controls and leaving a dead band of image above it. */
  .stage.cover .stage-body {
    width: 100%; padding: 18px 16px 16px;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .stage.cover .now { flex: 0 0 auto; }
  .stage.cover .progress { margin-top: auto; padding-top: 14px; }
  .stage.cover .art { display: none; }
  .stage.cover .meta { padding-top: 0; }
  /* A shadow on every piece of text, not just the title: the scrim alone
     cannot be trusted against an arbitrary photograph. */
  .stage.cover .eyebrow,
  .stage.cover .track,
  .stage.cover .sub,
  .stage.cover .where,
  .stage.cover .times { text-shadow: 0 1px 6px rgba(0, 0, 0, 0.75); }
  .stage.cover .eyebrow { color: rgba(255, 255, 255, 0.82); }
  .stage.cover .track { color: #fff; font-size: 1.45rem; font-weight: 500; }
  .stage.cover .sub { color: rgba(255, 255, 255, 0.92); font-size: 0.9rem; }
  .stage.cover .where { color: rgba(255, 255, 255, 0.74); }
  .stage.cover .btn { filter: drop-shadow(0 1px 4px rgba(0, 0, 0, 0.5)); }
  .stage.cover .bar { background: rgba(255, 255, 255, 0.28); }
  .stage.cover .bar-fill { background: #fff; }
  .stage.cover .times { color: rgba(255, 255, 255, 0.88); }
  .stage.cover .btn { color: rgba(255, 255, 255, 0.92); }
  .stage.cover .btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.2); color: #fff; }
  .stage.cover .btn:disabled { opacity: 0.4; }
  .stage.cover .btn.primary { background: rgba(255, 255, 255, 0.95); color: #141414; }
  .stage.cover .btn.primary:hover:not(:disabled) { background: #fff; filter: none; }
  .stage.cover input.volume { accent-color: #fff; }
  .stage.cover .progress { margin-top: 14px; }
  .now.hidden { display: none; }
  .art {
    width: 104px; height: 104px; border-radius: 14px; flex: none;
    background: var(--wc-tonal) center/cover no-repeat;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.26);
  }
  .art .icon { color: var(--wc-muted); --mdc-icon-size: 38px; }
  .art.has-art .icon { display: none; }
  .meta { flex: 1; min-width: 0; padding-top: 4px; }
  @media (prefers-reduced-motion: reduce) { .wash { transition: none; } }
  .eyebrow {
    font-size: 0.68rem; letter-spacing: 0.09em; text-transform: uppercase;
    color: var(--wc-muted); font-weight: 600;
  }
  .track {
    color: var(--wc-text); font-size: 1.25rem; line-height: 1.28; margin-top: 4px;
    font-weight: 500;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .sub {
    color: var(--wc-muted); font-size: 0.85rem; line-height: 1.35; margin-top: 1px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .where {
    color: var(--wc-muted); font-size: 0.74rem; margin-top: 4px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  /* --------------------------------------------------------------- progress */
  .progress { margin-top: 12px; }
  .progress.hidden { display: none; }
  .bar { height: 4px; border-radius: 999px; background: var(--wc-tonal); overflow: hidden; }
  .bar-fill {
    height: 100%; width: 0%; border-radius: 999px; background: var(--wc-accent);
    transition: width 900ms linear;
  }
  .times {
    display: flex; justify-content: space-between; margin-top: 4px;
    font-size: 0.72rem; color: var(--wc-muted); font-variant-numeric: tabular-nums;
  }
  @media (prefers-reduced-motion: reduce) { .bar-fill { transition: none; } }

  /* --------------------------------------------------------------- controls */
  .controls {
    display: flex; align-items: center; gap: 4px; margin-top: 10px;
  }
  .controls.hidden { display: none; }
  .btn {
    width: 40px; height: 40px; flex: none; padding: 0; border: none;
    border-radius: 50%; background: none; cursor: pointer;
    color: var(--wc-muted); display: flex; align-items: center; justify-content: center;
    transition: background 150ms, color 150ms;
  }
  .btn:hover:not(:disabled) { background: var(--wc-tonal); color: var(--wc-text); }
  .btn:focus-visible { outline: 2px solid var(--wc-accent); outline-offset: 2px; }
  .btn:disabled { opacity: 0.3; cursor: default; }
  .btn.primary {
    background: var(--wc-accent-tonal); color: var(--wc-on-accent-tonal);
    width: 46px; height: 46px;
  }
  .btn.primary:hover:not(:disabled) { background: var(--wc-accent-tonal); filter: brightness(1.06); }
  .btn .icon { color: inherit; --mdc-icon-size: 22px; }
  .btn.primary .icon { --mdc-icon-size: 26px; }
  .btn.power { margin-left: 4px; }
  .btn.power.lit { color: var(--wc-accent); }
  .stage.cover .btn.power.lit { color: #fff; }
  .spacer { flex: 1; }
  .vol { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 0 1 150px; }
  .vol.hidden { display: none; }
  input.volume { width: 100%; cursor: pointer; accent-color: var(--wc-accent); }

  /* ------------------------------------------------------------ other rooms */
  .others { margin-top: 4px; }
  /* No rule directly under the artwork - the panel edge is separation enough. */
  .stage.cover + .presets + .others > .other:first-of-type,
  .stage.cover + .others > .other:first-of-type { border-top: none; }
  .others.hidden { display: none; }
  .other {
    display: flex; align-items: center; gap: 10px; width: 100%;
    padding: 9px 0; border: none; border-top: 1px solid var(--wc-outline);
    background: none; cursor: pointer; font: inherit; text-align: left;
    color: var(--wc-text);
  }
  .other:hover .other-name { color: var(--wc-accent); }
  .other:focus-visible { outline: 2px solid var(--wc-accent); outline-offset: -2px; }
  .other .icon { color: var(--wc-muted); --mdc-icon-size: 20px; flex: none; }
  .other.live .icon { color: var(--wc-accent); }
  .other-main { flex: 1; min-width: 0; }
  .other-name {
    font-size: 0.92rem; line-height: 1.3; transition: color 150ms;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .other-state {
    font-size: 0.75rem; color: var(--wc-muted); line-height: 1.3;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .other.dim .other-name { color: var(--wc-muted); }

  /* ---------------------------------------------------------- presets */
  .presets {
    display: flex; gap: 10px; margin-top: 12px; padding-bottom: 2px;
    overflow-x: auto; scrollbar-width: none;
  }
  .presets::-webkit-scrollbar { display: none; }
  .presets.hidden { display: none; }
  .preset {
    flex: none; width: 64px; padding: 0; border: none; background: none;
    cursor: pointer; font: inherit; color: var(--wc-text);
    display: flex; flex-direction: column; align-items: center; gap: 5px;
  }
  .preset-art {
    width: 58px; height: 58px; border-radius: 12px;
    background: var(--wc-tonal) center/cover no-repeat;
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.14);
    outline: 2px solid transparent; outline-offset: 2px;
    transition: outline-color 180ms, transform 160ms;
  }
  .preset:hover .preset-art { transform: scale(1.05); }
  .preset:focus-visible .preset-art { outline-color: var(--wc-accent); }
  .preset.on .preset-art { outline-color: var(--wc-accent); }
  .preset-art .icon { color: var(--wc-muted); --mdc-icon-size: 24px; }
  .preset-art.has-art .icon { display: none; }
  .preset-name {
    font-size: 0.7rem; line-height: 1.25; text-align: center; color: var(--wc-muted);
    width: 100%; overflow: hidden;
    /* Two lines rather than an ellipsis: "Def Con Radio" should not become
       "Def Con R...". */
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .preset.on .preset-name { color: var(--wc-accent); font-weight: 600; }

  .idle, .error { font-size: 0.9rem; line-height: 1.5; padding: 4px 0 2px; }
  .idle { color: var(--wc-muted); }
  .error { color: var(--error-color, #db4437); }
`;

class WabitMediaCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("wabit-media-card-editor");
  }

  static getStubConfig(hass) {
    const areas = (hass && hass.areas) || {};
    let best = null;
    for (const id of Object.keys(areas)) {
      const n = mediaPlayersInArea(hass, id, MEDIA_NOISE_PLATFORMS).length;
      if (n && (!best || n > best.n)) best = { id, n };
    }
    return { type: "custom:wabit-media-card", area: best ? best.id : "" };
  }

  setConfig(config) {
    const cfg = config || {};
    const list = (v, key) => {
      if (v === undefined || v === null) return null;
      if (!Array.isArray(v)) {
        throw new Error(`wabit-media-card: \`${key}\` must be a list`);
      }
      return v;
    };
    if (isUnset(cfg.area) && !(Array.isArray(cfg.entities) && cfg.entities.length)) {
      throw new Error("wabit-media-card: either `area` or `entities` is required");
    }
    (cfg.entities || []).forEach((e) => {
      if (typeof e !== "string" || !e.startsWith("media_player.")) {
        throw new Error(
          `wabit-media-card: \`entities\` may only contain media players, got "${e}"`
        );
      }
    });

    this._config = {
      area: isUnset(cfg.area) ? null : String(cfg.area),
      entities: list(cfg.entities, "entities"),
      exclude: list(cfg.exclude, "exclude") || [],
      exclude_platforms: list(cfg.exclude_platforms, "exclude_platforms") || MEDIA_NOISE_PLATFORMS,
      title: cfg.title,
      show_header: cfg.show_header !== false,
      show_volume: cfg.show_volume !== false,
      show_progress: cfg.show_progress !== false,
      show_others: cfg.show_others !== false,
      idle_text: cfg.idle_text || "Nothing playing",
      show_power: cfg.show_power !== false,
      // cover: the artwork is the panel, text and controls over it.
      // tile:   a thumbnail beside the text, with a blurred colour wash.
      // none:   no artwork at all.
      artwork: ["tile", "none", "cover"].includes(cfg.artwork)
        ? cfg.artwork
        : cfg.art_backdrop === false
          ? "tile"   // honours the older option, which meant "tile, no wash"
          : "cover",
      art_backdrop: cfg.art_backdrop !== false,
      presets: this._readPresets(cfg.presets),
    };

    this._built = false;
    this._othersKey = null;
    this._selected = null;
    this._playingKey = null;
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
    if (this._hass) this._render();
  }

  /** One-tap shortcuts: a radio station, a scene, anything worth a button. */
  _readPresets(raw) {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) {
      throw new Error("wabit-media-card: `presets` must be a list");
    }
    return raw.map((p, i) => {
      if (!p || typeof p !== "object") {
        throw new Error(`wabit-media-card: presets[${i}] must be an object`);
      }
      if (!p.entity && !p.service) {
        throw new Error(
          `wabit-media-card: presets[${i}] needs an \`entity\` to trigger or a \`service\` to call`
        );
      }
      if (p.service && !/^[a-z_]+\.[a-z0-9_]+$/.test(String(p.service))) {
        throw new Error(
          `wabit-media-card: presets[${i}].service must look like "domain.service"`
        );
      }
      return {
        name: p.name || p.entity || p.service,
        image: p.image || null,
        icon: p.icon || "mdi:radio",
        entity: p.entity || null,
        service: p.service || null,
        data: p.data || null,
        target: p.target || null,
        // What to look for in the current title to show this one as playing.
        match: p.match === undefined ? p.name || null : p.match,
      };
    });
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config) this._render();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    // Keeps the progress bar moving between state updates.
    this._tick = window.setInterval(() => {
      if (this._built && this._hass) this._render();
    }, 1000);
  }

  disconnectedCallback() {
    if (this._tick) window.clearInterval(this._tick);
    this._tick = null;
  }

  getCardSize() {
    return 4;
  }

  _model() {
    const hass = this._hass;
    const cfg = this._config;
    let ids;
    let areaName = cfg.title;

    if (cfg.entities) {
      ids = cfg.entities.filter((id) => hass.states[id]);
    } else {
      if (!hass.entities || !hass.areas) {
        return { error: "This Home Assistant build does not expose the area registry to cards." };
      }
      const areaId = resolveAreaId(hass, cfg.area);
      if (!areaId) return { error: `No area called "${cfg.area}".` };
      if (areaName === undefined) areaName = (hass.areas[areaId] || {}).name || cfg.area;
      ids = mediaPlayersInArea(hass, areaId, cfg.exclude_platforms);
    }

    const excluded = new Set(cfg.exclude);
    ids = ids.filter((id) => !excluded.has(id));
    if (!ids.length) {
      return { areaName, empty: true, players: [], featured: null };
    }

    const players = ids
      .map((id) => ({ id, st: hass.states[id], rank: mediaRank(hass.states[id]) }))
      .sort(
        (a, b) =>
          b.rank - a.rank ||
          // Same rank: whatever started most recently is what you just put on.
          (Date.parse(b.st.last_changed) || 0) - (Date.parse(a.st.last_changed) || 0) ||
          a.id.localeCompare(b.id)
      );

    // A room normally has one thing playing. When that changes hands - something
    // starts, or the current one stops - the card follows it, dropping any
    // manual pick. A manual pick only holds while the room carries on as it was.
    const playingKey = players
      .filter((p) => p.st.state === "playing" || p.st.state === "buffering")
      .map((p) => p.id)
      .sort()
      .join("|");
    if (playingKey !== this._playingKey) {
      this._playingKey = playingKey;
      this._selected = null;
    }

    let featured = players.find((p) => p.id === this._selected) || null;
    if (!featured) featured = players.find((p) => p.rank >= 3) || null;

    return {
      areaName: areaName === undefined ? "" : areaName,
      players,
      featured,
      anyActive: players.some((p) => ACTIVE_STATES.has(p.st.state)),
    };
  }

  _render() {
    if (!this._config || !this._hass) return;
    if (!this._built) this._build();
    const m = this._model();
    this._lastModel = m;
    const e = this._els;

    if (m.error) {
      e.error.textContent = m.error;
      e.error.style.display = "";
      e.now.classList.add("hidden");
      e.controls.classList.add("hidden");
      e.progress.classList.add("hidden");
      e.others.classList.add("hidden");
      e.idle.style.display = "none";
      return;
    }
    e.error.style.display = "none";

    if (e.title) {
      e.title.textContent = m.areaName || "";
      // Keep a direct reference rather than walking up to the parent.
      e.header.style.display = m.areaName ? "" : "none";
    }

    this._renderNowPlaying(m);
    this._renderPresets(m);
    this._renderOthers(m);
  }

  _renderPresets(m) {
    const e = this._els;
    const presets = this._config.presets;
    e.presets.classList.toggle("hidden", !presets.length);
    if (!presets.length) return;

    if (!e.presetEls || e.presetEls.length !== presets.length) {
      e.presets.innerHTML = "";
      e.presetEls = presets.map((p) => {
        const btn = document.createElement("button");
        btn.className = "preset";
        btn.type = "button";
        btn.title = p.name;
        btn.setAttribute("aria-label", `Play ${p.name}`);
        const art = document.createElement("div");
        art.className = "preset-art";
        art.appendChild(this._makeIcon(p.icon));
        if (p.image) {
          art.style.backgroundImage = `url("${p.image}")`;
          art.classList.add("has-art");
        }
        const name = document.createElement("div");
        name.className = "preset-name";
        name.textContent = p.name;
        btn.append(art, name);
        btn.addEventListener("click", () => this._runPreset(p));
        e.presets.appendChild(btn);
        return { p, btn };
      });
    }

    e.presetEls.forEach(({ p, btn }) => {
      btn.classList.toggle("on", this._presetActive(p, m.featured));
    });
  }

  _renderNowPlaying(m) {
    const e = this._els;
    const f = m.featured;

    if (!f) {
      e.now.classList.add("hidden");
      e.controls.classList.add("hidden");
      e.progress.classList.add("hidden");
      e.idle.style.display = "";
      e.idle.textContent = m.empty
        ? `No media players in ${m.areaName || "this room"}.`
        : this._config.idle_text;
      return;
    }
    e.idle.style.display = "none";
    e.now.classList.remove("hidden");

    const st = f.st;
    const a = st.attributes || {};
    const now = new Date();

    const mode = this._config.artwork;
    const art = mode === "none" ? "" : a.entity_picture || "";
    if (e.art._art !== art || e.stage._mode !== mode) {
      e.art._art = art;
      e.stage._mode = mode;
      e.art.style.backgroundImage = art ? `url("${art}")` : "";
      e.art.classList.toggle("has-art", !!art);
      // Set on the host so the panel and the body below share one source.
      this.style.setProperty("--art", art ? `url("${art}")` : "none");
      e.body.classList.toggle("tinted", !!art);
      // Cover needs an image to cover with; without one it falls back to tile.
      e.stage.classList.toggle("cover", mode === "cover" && !!art);
      e.stage.classList.toggle("washed", mode === "tile" && !!art && this._config.art_backdrop);
    }

    const stateWord =
      st.state === "playing" ? "Now playing"
        : st.state === "paused" ? "Paused"
        : st.state === "buffering" ? "Buffering"
        : st.state === "idle" ? "Idle"
        : st.state === "off" ? "Off"
        : DEAD_STATES.has(st.state) ? "Unavailable" : "On";
    e.eyebrow.textContent = stateWord;

    const title = mediaTitle(st);
    e.track.textContent = title || this._nameOf(f.id);
    const sub = mediaSubtitle(st);
    e.sub.textContent = sub;
    e.sub.style.display = sub ? "" : "none";
    // When the title is the track, the player's own name belongs underneath.
    e.where.textContent = title ? this._nameOf(f.id) : "";
    e.where.style.display = title ? "" : "none";

    // progress
    const dur = typeof a.media_duration === "number" ? a.media_duration : null;
    const pos = mediaPosition(st, now);
    const showProgress = this._config.show_progress && !!dur && pos !== null;
    e.progress.classList.toggle("hidden", !showProgress);
    if (showProgress) {
      const pct = Math.max(0, Math.min(100, (pos / dur) * 100));
      e.fill.style.width = `${pct.toFixed(2)}%`;
      e.elapsed.textContent = formatDuration(pos);
      e.total.textContent = formatDuration(dur);
    }

    // controls
    const playing = st.state === "playing" || st.state === "buffering";
    e.controls.classList.remove("hidden");
    e.prev.disabled = !can(st, MF.PREVIOUS);
    e.next.disabled = !can(st, MF.NEXT);
    const canToggle = can(st, MF.PLAY) || can(st, MF.PAUSE) || can(st, MF.TURN_ON);
    e.play.disabled = !canToggle;
    this._setIcon(e.playIcon, playing ? "mdi:pause" : "mdi:play");
    e.play.setAttribute("aria-label", playing ? "Pause" : "Play");

    const canPower = can(st, MF.TURN_OFF) || can(st, MF.TURN_ON);
    const showPower = this._config.show_power && canPower;
    e.power.style.display = showPower ? "" : "none";
    if (showPower) {
      const isOff = st.state === "off";
      e.power.setAttribute("aria-label", isOff ? "Turn on" : "Turn off");
      e.power.title = isOff ? "Turn on" : "Turn off";
      e.power.classList.toggle("lit", !isOff);
    }

    const showVol = this._config.show_volume && can(st, MF.VOLUME_SET);
    e.vol.classList.toggle("hidden", !showVol);
    if (showVol) {
      const muted = !!a.is_volume_muted;
      this._setIcon(e.muteIcon, muted ? "mdi:volume-off" : "mdi:volume-high");
      e.mute.disabled = !can(st, MF.VOLUME_MUTE);
      e.mute.setAttribute("aria-label", muted ? "Unmute" : "Mute");
      if (this.shadowRoot.activeElement !== e.volume) {
        const lvl = typeof a.volume_level === "number" ? Math.round(a.volume_level * 100) : 0;
        e.volume.value = String(lvl);
      }
      e.volume.disabled = muted;
    }
  }

  _renderOthers(m) {
    const e = this._els;
    const others = this._config.show_others
      ? m.players.filter((p) => !m.featured || p.id !== m.featured.id)
      : [];
    e.others.classList.toggle("hidden", !others.length);

    const key = JSON.stringify(others.map((p) => p.id));
    if (key !== this._othersKey) {
      this._othersKey = key;
      e.others.innerHTML = "";
      e.otherRows = others.map((p) => {
        const row = document.createElement("button");
        row.className = "other";
        row.type = "button";
        const icon = this._makeIcon(this._iconFor(this._hass.states[p.id]));
        const main = document.createElement("div");
        main.className = "other-main";
        const name = document.createElement("div");
        name.className = "other-name";
        const state = document.createElement("div");
        state.className = "other-state";
        main.append(name, state);
        row.append(icon, main);
        row.addEventListener("click", () => {
          this._selected = p.id;
          this._render();
        });
        e.others.appendChild(row);
        return { id: p.id, row, name, state };
      });
    }

    (e.otherRows || []).forEach((r) => {
      const st = this._hass.states[r.id];
      if (!st) return;
      const live = ACTIVE_STATES.has(st.state);
      r.row.classList.toggle("live", live);
      r.row.classList.toggle("dim", DEAD_STATES.has(st.state) || st.state === "off");
      r.name.textContent = this._nameOf(r.id);
      const t = mediaTitle(st);
      r.state.textContent = live && t ? `${st.state === "paused" ? "Paused" : "Playing"} · ${t}` : st.state;
    });
  }

  _nameOf(id) {
    const reg = (this._hass.entities || {})[id] || {};
    const st = this._hass.states[id];
    return reg.name || (st && st.attributes && st.attributes.friendly_name) || id;
  }

  _makeIcon(icon) {
    if (customElements.get("ha-icon")) {
      const el = document.createElement("ha-icon");
      el.setAttribute("icon", icon);
      el.className = "icon";
      el._haIcon = true; // the DOM uppercases tagName, so flag it instead
      return el;
    }
    const span = document.createElement("span");
    span.className = "icon";
    span._icon = icon;
    return span;
  }

  _setIcon(el, icon) {
    if (!el) return;
    if (el._haIcon) {
      if (el.getAttribute("icon") !== icon) el.setAttribute("icon", icon);
    } else {
      el._icon = icon;
    }
  }

  /** A speaker, a telly or a generic player, from the entity's device class. */
  _iconFor(st) {
    const dc = (st && st.attributes && st.attributes.device_class) || "";
    if (dc === "tv") return "mdi:television";
    if (dc === "receiver") return "mdi:audio-video";
    return "mdi:speaker";
  }

  _runPreset(p) {
    if (p.service) {
      const dot = p.service.indexOf(".");
      this._hass.callService(
        p.service.slice(0, dot),
        p.service.slice(dot + 1),
        p.data || {},
        p.target || undefined
      );
      return;
    }
    const domain = p.entity.slice(0, p.entity.indexOf("."));
    const service =
      domain === "automation" ? "trigger"
        : domain === "script" || domain === "scene" ? "turn_on"
        : "turn_on";
    this._hass.callService(domain, service, { entity_id: p.entity, ...(p.data || {}) });
  }

  /** A preset counts as playing when its match text is in the current title. */
  _presetActive(p, featured) {
    if (!p.match || !featured) return false;
    const st = featured.st;
    if (!ACTIVE_STATES.has(st.state)) return false;
    const hay = `${mediaTitle(st)} ${mediaSubtitle(st)}`.toLowerCase();
    return hay.includes(String(p.match).toLowerCase());
  }

  _call(service, data) {
    const f = this._lastModel && this._lastModel.featured;
    if (!f) return;
    this._hass.callService("media_player", service, { entity_id: f.id, ...(data || {}) });
  }

  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = MEDIA_STYLES;
    root.appendChild(style);

    const card = document.createElement("ha-card");
    root.appendChild(card);

    this._els = {};

    if (this._config.show_header) {
      const header = document.createElement("div");
      header.className = "header";
      const title = document.createElement("div");
      title.className = "title";
      header.appendChild(title);
      card.appendChild(header);
      this._els.title = title;
      this._els.header = header;
    }

    const body = document.createElement("div");
    body.className = this._config.show_header ? "body tight" : "body";
    const bodyWash = document.createElement("div");
    bodyWash.className = "body-wash";
    body.appendChild(bodyWash);
    card.appendChild(body);
    this._els.body = body;

    const error = document.createElement("div");
    error.className = "error";
    error.style.display = "none";
    const idle = document.createElement("div");
    idle.className = "idle";
    idle.style.display = "none";
    body.append(error, idle);

    // now playing
    const stage = document.createElement("div");
    stage.className = "stage";
    const wash = document.createElement("div");
    wash.className = "wash";
    stage.appendChild(wash);
    const now = document.createElement("div");
    now.className = "now";
    const art = document.createElement("div");
    art.className = "art";
    art.appendChild(this._makeIcon("mdi:music"));
    const meta = document.createElement("div");
    meta.className = "meta";
    const eyebrow = document.createElement("div");
    eyebrow.className = "eyebrow";
    const track = document.createElement("div");
    track.className = "track";
    const sub = document.createElement("div");
    sub.className = "sub";
    const where = document.createElement("div");
    where.className = "where";
    meta.append(eyebrow, track, sub, where);
    const stageBody = document.createElement("div");
    stageBody.className = "stage-body";
    now.append(art, meta);
    stageBody.appendChild(now);
    stage.appendChild(stageBody);
    body.appendChild(stage);

    // progress
    const progress = document.createElement("div");
    progress.className = "progress hidden";
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    bar.appendChild(fill);
    const times = document.createElement("div");
    times.className = "times";
    const elapsed = document.createElement("span");
    const total = document.createElement("span");
    times.append(elapsed, total);
    progress.append(bar, times);
    stageBody.appendChild(progress);

    // controls
    const controls = document.createElement("div");
    controls.className = "controls hidden";
    const mkBtn = (icon, label, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls ? `btn ${cls}` : "btn";
      b.setAttribute("aria-label", label);
      const ic = this._makeIcon(icon);
      b.appendChild(ic);
      b.addEventListener("click", fn);
      return { b, ic };
    };
    const prev = mkBtn("mdi:skip-previous", "Previous", "", () => this._call("media_previous_track"));
    const play = mkBtn("mdi:play", "Play", "primary", () => this._call("media_play_pause"));
    const next = mkBtn("mdi:skip-next", "Next", "", () => this._call("media_next_track"));
    const spacer = document.createElement("div");
    spacer.className = "spacer";
    const power = mkBtn("mdi:power", "Power", "power", () => {
      const f = this._lastModel && this._lastModel.featured;
      if (!f) return;
      // Off means on; anything else means off. A telly is usually the reason
      // this button exists, and off is what you want from it.
      this._call(f.st.state === "off" ? "turn_on" : "turn_off");
    });

    const vol = document.createElement("div");
    vol.className = "vol";
    const mute = mkBtn("mdi:volume-high", "Mute", "", () => {
      const f = this._lastModel && this._lastModel.featured;
      if (!f) return;
      this._call("volume_mute", { is_volume_muted: !(f.st.attributes || {}).is_volume_muted });
    });
    const volume = document.createElement("input");
    volume.type = "range";
    volume.className = "volume";
    volume.min = "0";
    volume.max = "100";
    volume.step = "1";
    volume.addEventListener("change", () =>
      this._call("volume_set", { volume_level: Number(volume.value) / 100 })
    );
    vol.append(mute.b, volume);
    controls.append(prev.b, play.b, next.b, spacer, vol, power.b);
    stageBody.appendChild(controls);

    const presets = document.createElement("div");
    presets.className = "presets hidden";
    body.appendChild(presets);

    const others = document.createElement("div");
    others.className = "others";
    body.appendChild(others);

    Object.assign(this._els, {
      error, idle, stage, now, art, eyebrow, track, sub, where,
      progress, fill, elapsed, total,
      controls, prev: prev.b, play: play.b, playIcon: play.ic, next: next.b,
      vol, mute: mute.b, muteIcon: mute.ic, volume,
      power: power.b, powerIcon: power.ic,
      presets, presetEls: null, others, otherRows: [],
    });
    this._built = true;
  }
}

/* ------------------------------------------------ wabit-media-card-editor */

const MEDIA_LABELS = {
  area: "Room",
  entities: "Specific players (leave empty to use the room)",
  exclude: "Players to leave out",
  title: "Card title (defaults to the room name)",
  show_header: "Show the header",
  show_volume: "Show the volume slider",
  show_progress: "Show the progress bar",
  show_others: "List the room's other players underneath",
  idle_text: "Text when nothing is playing",
};

const PRESET_LABELS = {
  name: "Name",
  entity: "Automation, script or scene to run",
  image: "Artwork - a path or URL, such as /local/6-music.png",
  icon: "Icon (used when there is no artwork)",
};

/**
 * `image` is a plain text field rather than Home Assistant's image selector.
 * ha-form renders nothing at all for a selector it cannot resolve, and that
 * one is not available everywhere - the field simply vanished. A text field
 * always renders, and the thumbnail beside each preset shows whether what you
 * typed actually resolves.
 */
const PRESET_SCHEMA = [
  { name: "name", selector: { text: {} } },
  { name: "entity", selector: { entity: { domain: ["automation", "script", "scene"] } } },
  { name: "image", selector: { text: {} } },
  { name: "icon", selector: { icon: {} } },
];

const MEDIA_SCHEMA = [
  { name: "area", selector: { area: {} } },
  { name: "entities", selector: { entity: { domain: "media_player", multiple: true } } },
  { name: "exclude", selector: { entity: { domain: "media_player", multiple: true } } },
  { name: "title", selector: { text: {} } },
  { name: "idle_text", selector: { text: {} } },
  { name: "show_volume", selector: { boolean: {} } },
  { name: "show_progress", selector: { boolean: {} } },
  { name: "show_others", selector: { boolean: {} } },
  { name: "show_header", selector: { boolean: {} } },
];

class WabitMediaCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...(config || {}) };
    if (!this._built) this._build();
    this._renderPresets();
    this._push();
  }

  set hass(hass) {
    this._hass = hass;
    this._pushPresetForms();
    this._push();
  }

  get hass() {
    return this._hass;
  }

  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = EDITOR_STYLES;
    root.appendChild(style);

    if (!customElements.get("ha-form")) {
      const note = document.createElement("div");
      note.className = "note";
      note.textContent =
        "This Home Assistant build does not provide ha-form, so the visual editor " +
        "is unavailable. Configure this card in YAML instead - the options are " +
        "documented at " + REPO;
      root.appendChild(note);
      this._form = null;
      this._built = true;
      return;
    }

    const form = document.createElement("ha-form");
    form.schema = MEDIA_SCHEMA;
    form.computeLabel = (s) => MEDIA_LABELS[s.name] || s.name;
    form.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      this._config = { ...this._config, ...ev.detail.value };
      fireEvent(this, "config-changed", { config: this._config });
    });
    root.appendChild(form);

    const section = document.createElement("div");
    section.className = "section";
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = "Presets";
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent =
      "One-tap shortcuts shown under the player - a radio station, a scene, " +
      "anything worth a button. Each runs an automation, script or scene.";
    const list = document.createElement("div");
    list.className = "preset-list";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "btn add";
    add.textContent = "+ Add preset";
    add.addEventListener("click", () => this._addPreset());
    section.append(title, hint, list, add);
    root.appendChild(section);

    this._form = form;
    this._els = { list };
    this._built = true;
  }

  _presets() {
    return Array.isArray(this._config.presets) ? this._config.presets : [];
  }

  _setPresets(list, keepRows) {
    const next = { ...this._config };
    if (list.length) next.presets = list;
    else delete next.presets;
    this._config = next;
    fireEvent(this, "config-changed", { config: this._config });
    if (keepRows) this._pushPresetForms();
    else this._renderPresets(true);
  }

  _addPreset() {
    this._setPresets(this._presets().concat([{ name: "", entity: "" }]));
  }

  _renderPresets(force) {
    if (!this._built || !this._els) return;
    const presets = this._presets();
    // Keyed on how many presets there are, never on their contents. Keying on
    // the name meant every keystroke changed the key, rebuilt the rows and
    // threw focus out of the field being typed in. Adding, removing and
    // reordering all rebuild explicitly with `force`, so length is enough.
    const key = presets.length;
    if (!force && key === this._presetKey) return;
    this._presetKey = key;

    const list = this._els.list;
    list.innerHTML = "";
    this._presetForms = [];
    this._presetThumbs = [];

    if (!presets.length) {
      const empty = document.createElement("div");
      empty.className = "empty-pins";
      empty.textContent =
        "No presets yet. Add one to put a radio station, scene or script a tap away.";
      list.appendChild(empty);
    }

    presets.forEach((p, i) => {
      const block = document.createElement("div");
      block.className = "block";

      const head = document.createElement("div");
      head.className = "head";
      const thumb = document.createElement("div");
      thumb.className = "preset-thumb";
      const heading = document.createElement("span");
      heading.textContent = (p && p.name) || `Preset ${i + 1}`;

      const mkBtn = (glyph, label, disabled, fn, danger) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = danger ? "pin-btn danger" : "pin-btn";
        b.textContent = glyph;
        b.title = label;
        b.setAttribute("aria-label", `${label}: ${heading.textContent}`);
        b.disabled = !!disabled;
        b.addEventListener("click", fn);
        return b;
      };
      head.append(
        thumb,
        heading,
        mkBtn("\u2191", "Move up", i === 0, () => this._movePreset(i, -1)),
        mkBtn("\u2193", "Move down", i === presets.length - 1, () => this._movePreset(i, 1)),
        mkBtn("\u2715", "Remove", false, () =>
          this._setPresets(this._presets().filter((_, j) => j !== i)), true)
      );
      block.appendChild(head);

      if (customElements.get("ha-form")) {
        const form = document.createElement("ha-form");
        form.schema = PRESET_SCHEMA;
        form.computeLabel = (sc) => PRESET_LABELS[sc.name] || sc.name;
        form.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          const next = this._presets().slice();
          next[i] = { ...next[i], ...ev.detail.value };
          heading.textContent = next[i].name || `Preset ${i + 1}`;
          this._setPresets(next, true);
        });
        block.appendChild(form);
        this._presetForms.push(form);
        this._presetThumbs.push(thumb);
      }
      list.appendChild(block);
    });

    this._pushPresetForms();
  }

  _pushPresetForms() {
    if (!this._presetForms || !this._hass) return;
    const presets = this._presets();
    this._presetForms.forEach((form, i) => {
      const p = presets[i] || {};
      const data = {
        name: p.name,
        entity: p.entity,
        image: p.image,
        icon: p.icon,
      };
      form.hass = this._hass;
      if (JSON.stringify(form.data) !== JSON.stringify(data)) form.data = data;

      // Immediate feedback on whether the path resolves, which is the bit a
      // bare text field otherwise leaves you guessing at.
      const thumb = this._presetThumbs[i];
      if (thumb && thumb._src !== (p.image || "")) {
        thumb._src = p.image || "";
        thumb.style.backgroundImage = p.image ? `url("${p.image}")` : "";
        thumb.classList.toggle("empty", !p.image);
        thumb.title = p.image || "No artwork set";
      }
    });
  }

  _movePreset(index, delta) {
    const list = this._presets().slice();
    const to = index + delta;
    if (to < 0 || to >= list.length) return;
    [list[index], list[to]] = [list[to], list[index]];
    this._setPresets(list);
  }

  _push() {
    if (!this._form || !this._hass || !this._config) return;
    this._form.hass = this._hass;
    const data = {
      area: this._config.area,
      entities: this._config.entities,
      exclude: this._config.exclude,
      title: this._config.title,
      idle_text: this._config.idle_text || "Nothing playing",
      show_volume: this._config.show_volume !== false,
      show_progress: this._config.show_progress !== false,
      show_others: this._config.show_others !== false,
      show_header: this._config.show_header !== false,
    };
    if (JSON.stringify(this._form.data) !== JSON.stringify(data)) this._form.data = data;
  }
}

if (!customElements.get("wabit-media-card")) {
  customElements.define("wabit-media-card", WabitMediaCard);
}
if (!customElements.get("wabit-media-card-editor")) {
  customElements.define("wabit-media-card-editor", WabitMediaCardEditor);
}

if (!window.customCards.some((c) => c.type === "wabit-media-card")) {
  window.customCards.push({
    type: "wabit-media-card",
    name: "Wabit Media",
    description:
      "What is playing in a room, across speakers, TVs and streamers, with the " +
      "active one brought to the front.",
    preview: true,
    documentationURL: REPO,
  });
}

/* ---------------------------------------------------------- wabit-f1-card */

/** Session attribute prefixes on the next-race sensor, in running order. */
const F1_SESSIONS = [
  ["first_practice", "Practice 1"],
  ["second_practice", "Practice 2"],
  ["third_practice", "Practice 3"],
  ["sprint_qualifying", "Sprint Qualifying"],
  ["sprint", "Sprint"],
  ["qualifying", "Qualifying"],
  ["race", "Race"],
];

/**
 * Formula 1's own circuit artwork is named by country rather than by the
 * circuit ids the data uses, so a lookup is needed to build those URLs. Only
 * consulted when the `map_url` template asks for {circuit_f1}.
 */
const F1_CIRCUIT_SLUGS = {
  albert_park: "Australia", bahrain: "Bahrain", shanghai: "China",
  suzuka: "Japan", jeddah: "Saudi_Arabia", miami: "Miami",
  imola: "Emilia_Romagna", monaco: "Monaco", catalunya: "Spain",
  villeneuve: "Canada", red_bull_ring: "Austria", silverstone: "Great_Britain",
  hungaroring: "Hungary", spa: "Belgium", zandvoort: "Netherlands",
  monza: "Italy", baku: "Baku", marina_bay: "Singapore",
  americas: "USA", rodriguez: "Mexico", interlagos: "Brazil",
  vegas: "Las_Vegas", losail: "Qatar", yas_marina: "Abu_Dhabi",
  sepang: "Malaysia", istanbul: "Turkey", portimao: "Portugal",
  ricard: "France", mugello: "Mugello", nurburgring: "Nurburgring",
  hockenheimring: "Germany", sochi: "Russia", algarve: "Portugal",
};

/** A sensor that looks like the F1 next-race sensor. */
function findF1RaceSensor(hass) {
  const states = (hass && hass.states) || {};
  return (
    Object.keys(states)
      .filter((id) => id.startsWith("sensor."))
      .find((id) => {
        const a = states[id].attributes || {};
        return !!a.race_name && !!a.circuit_id && !!a.race_start_utc;
      }) || null
  );
}

/** A weather entity the F1 integration has pinned to the circuit. */
function findF1WeatherEntity(hass) {
  const states = (hass && hass.states) || {};
  return (
    Object.keys(states)
      .filter((id) => id.startsWith("weather."))
      .find((id) => !!(states[id].attributes || {}).circuit_id) || null
  );
}

/**
 * Formula 1's own circuit artwork. It moved for the 2026 season, so which one
 * applies depends on the year being shown.
 */
const F1_MAP_PRESETS = {
  modern:
    "https://media.formula1.com/image/upload/c_fit,h_704/q_auto/v1740000001/" +
    "common/f1/{season}/track/{season}track{circuit_f1_lower}detailed.webp",
  legacy:
    "https://media.formula1.com/image/upload/f_auto,c_limit,q_auto,w_1320/" +
    "content/dam/fom-website/2018-redesign-assets/Circuit%20maps%2016x9/{circuit_f1}_Circuit",
};

/** Fills {circuit_id}, {circuit_f1}, {circuit_f1_lower}, {season}, {round}. */
function f1MapUrl(template, attrs) {
  if (!template) return null;
  const slug = F1_CIRCUIT_SLUGS[attrs.circuit_id] || attrs.circuit_id || "";
  return String(template)
    .replace(/\{circuit_id\}/g, attrs.circuit_id || "")
    .replace(/\{circuit_f1_lower\}/g, slug.toLowerCase())
    .replace(/\{circuit_f1\}/g, slug)
    .replace(/\{season\}/g, attrs.season || "")
    .replace(/\{round\}/g, attrs.round || "");
}

/**
 * The Formula 1 artwork URL for a given race.
 *
 * The legacy path is the default whatever the season. Other cards switch to
 * the 2026 path for 2026 onwards, but every 2026 URL checked returns 404 while
 * the legacy ones resolve, so switching on the year would lose the artwork
 * rather than gain it. `f1-modern` is there for when those paths go live.
 */
function f1OfficialMapUrl(attrs, which) {
  const preset = which === "f1-modern" ? F1_MAP_PRESETS.modern : F1_MAP_PRESETS.legacy;
  return f1MapUrl(preset, attrs);
}

/** Whole minutes until `date`, or null. */
function minutesTo(date, now) {
  if (!date || Number.isNaN(date.getTime())) return null;
  return Math.round((date.getTime() - now.getTime()) / 60000);
}

/** "in 3 days", "in 4h 20m", "Under way", "Finished". */
function f1Countdown(mins) {
  if (mins === null) return "";
  if (mins < -240) return "Finished";
  if (mins < 0) return "Under way";
  if (mins < 60) return `in ${mins}m`;
  if (mins < 1440) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `in ${h}h ${m}m` : `in ${h}h`;
  }
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  return h ? `in ${d}d ${h}h` : `in ${d}d`;
}

function f1DateTime(date, locale) {
  try {
    return date.toLocaleString(locale || undefined, {
      weekday: "short", day: "numeric", month: "short",
      hour: "2-digit", minute: "2-digit",
    });
  } catch (e) {
    return date.toString();
  }
}

function f1Time(date, locale) {
  try {
    return date.toLocaleTimeString(locale || undefined, {
      hour: "2-digit", minute: "2-digit",
    });
  } catch (e) {
    return "";
  }
}

function f1Day(date, locale) {
  try {
    return date.toLocaleDateString(locale || undefined, {
      weekday: "short", day: "numeric", month: "short",
    });
  } catch (e) {
    return "";
  }
}

const WEATHER_ICONS = {
  "clear-night": "mdi:weather-night", cloudy: "mdi:weather-cloudy",
  fog: "mdi:weather-fog", hail: "mdi:weather-hail",
  lightning: "mdi:weather-lightning", "lightning-rainy": "mdi:weather-lightning-rainy",
  partlycloudy: "mdi:weather-partly-cloudy", pouring: "mdi:weather-pouring",
  rainy: "mdi:weather-rainy", snowy: "mdi:weather-snowy",
  "snowy-rainy": "mdi:weather-snowy-rainy", sunny: "mdi:weather-sunny",
  windy: "mdi:weather-windy", "windy-variant": "mdi:weather-windy-variant",
  exceptional: "mdi:alert-circle-outline",
};

const F1_STYLES = `
  :host {
    display: block;
    --wc-text: var(--md-sys-color-on-surface, var(--primary-text-color, #212121));
    --wc-muted: var(--md-sys-color-on-surface-variant, var(--secondary-text-color, #727272));
    --wc-accent: var(--md-sys-color-primary, var(--primary-color, #3f51b5));
    --wc-tonal: var(--md-sys-color-surface-container-highest,
                 rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.08));
    --wc-outline: var(--md-sys-color-outline-variant, var(--divider-color, #e0e0e0));
    --wc-accent-tonal: var(--md-sys-color-primary-container,
                        rgba(var(--rgb-primary-color, 63, 81, 181), 0.16));
    --wc-on-accent-tonal: var(--md-sys-color-on-primary-container, var(--wc-accent));
  }
  ha-card { overflow: hidden; }
  .body { padding: 16px; }

  .eyebrow {
    font-size: 0.7rem; letter-spacing: 0.09em; text-transform: uppercase;
    color: var(--wc-muted); font-weight: 600;
  }
  .race {
    color: var(--wc-text); font-size: 1.5rem; font-weight: 500; line-height: 1.22;
    letter-spacing: -0.01em; margin-top: 3px;
  }
  .circuit { color: var(--wc-text); font-size: 0.95rem; margin-top: 6px; }
  .place { color: var(--wc-muted); font-size: 0.82rem; margin-top: 1px; }

  /* ------------------------------------------------------------- the map */
  /* No min-height: with nothing to show the block collapses rather than
     leaving an empty panel while the image is on its way. */
  .map {
    margin: 14px 0 2px; border-radius: 14px; background: var(--wc-tonal);
    display: flex; align-items: center; justify-content: center;
    padding: 10px; box-sizing: border-box;
  }
  .map.hidden { display: none; }
  .map img { max-width: 100%; max-height: 230px; display: block; }

  /* ----------------------------------------------------------- the strip */
  .strip { display: flex; gap: 10px; margin-top: 14px; }
  .panel {
    flex: 1 1 0; min-width: 0; border-radius: 14px; padding: 12px;
    background: var(--wc-tonal);
  }
  .panel.hidden { display: none; }
  .panel-label {
    font-size: 0.66rem; letter-spacing: 0.09em; text-transform: uppercase;
    color: var(--wc-muted); font-weight: 600;
  }
  .panel-main {
    display: flex; align-items: center; gap: 8px; margin-top: 5px;
    color: var(--wc-text); font-size: 1.12rem; line-height: 1.2;
  }
  .panel-main .icon { --mdc-icon-size: 26px; color: var(--wc-accent); flex: none; }
  .panel-sub {
    color: var(--wc-muted); font-size: 0.78rem; margin-top: 4px; line-height: 1.4;
  }
  .countdown {
    display: inline-block; margin-top: 7px; padding: 3px 9px; border-radius: 999px;
    font-size: 0.74rem; font-weight: 600;
    background: var(--wc-accent-tonal); color: var(--wc-on-accent-tonal);
  }

  /* --------------------------------------------------------- the sessions */
  .sessions { margin-top: 14px; }
  .sessions.hidden { display: none; }
  .session {
    display: flex; align-items: baseline; gap: 10px;
    padding: 7px 0; border-top: 1px solid var(--wc-outline);
    font-variant-numeric: tabular-nums;
  }
  .session:first-of-type { border-top: none; }
  .session-name { flex: 1; min-width: 0; color: var(--wc-text); font-size: 0.9rem; }
  .session-when { color: var(--wc-muted); font-size: 0.82rem; white-space: nowrap; }
  .session.next .session-name { color: var(--wc-accent); font-weight: 600; }
  .session.next .session-when { color: var(--wc-accent); }
  .session.done { opacity: 0.45; }

  .error { color: var(--error-color, #db4437); font-size: 0.9rem; line-height: 1.5; }
`;

class WabitF1Card extends HTMLElement {
  static getConfigElement() {
    return document.createElement("wabit-f1-card-editor");
  }

  static getStubConfig(hass) {
    const stub = { type: "custom:wabit-f1-card" };
    const race = findF1RaceSensor(hass);
    if (race) stub.entity = race;
    return stub;
  }

  setConfig(config) {
    const cfg = config || {};
    if (!isUnset(cfg.entity) && !String(cfg.entity).startsWith("sensor.")) {
      throw new Error("wabit-f1-card: `entity` must be a sensor");
    }
    if (!isUnset(cfg.weather_entity) && !String(cfg.weather_entity).startsWith("weather.")) {
      throw new Error("wabit-f1-card: `weather_entity` must be a weather entity");
    }
    this._config = {
      entity: isUnset(cfg.entity) ? null : cfg.entity,
      weather_entity: isUnset(cfg.weather_entity) ? null : cfg.weather_entity,
      // Not isUnset(): that treats the literal string "none" as absent, which
      // is exactly the value used to turn the map off.
      map_url:
        cfg.map_url === undefined || cfg.map_url === null || cfg.map_url === ""
          ? null
          : String(cfg.map_url),
      title: cfg.title,
      show_map: cfg.show_map !== false,
      show_weather: cfg.show_weather !== false,
      show_sessions: cfg.show_sessions !== false,
    };
    this._built = false;
    this._sessionsKey = null;
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config) this._render();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    // Countdowns go stale on a dashboard left open.
    this._tick = window.setInterval(() => {
      if (this._built && this._hass) this._render();
    }, 30000);
  }

  disconnectedCallback() {
    if (this._tick) window.clearInterval(this._tick);
    this._tick = null;
  }

  getCardSize() {
    return 6;
  }

  _locale() {
    const l = this._hass && this._hass.locale;
    return (l && l.language) || undefined;
  }

  _model() {
    const hass = this._hass;
    const cfg = this._config;
    const id = cfg.entity || findF1RaceSensor(hass);
    if (!id) {
      return { error: "No Formula 1 race sensor found. Set `entity` to one." };
    }
    const st = hass.states[id];
    if (!st) return { error: `${id} is not available.` };
    const a = st.attributes || {};

    const now = new Date();
    const sessions = F1_SESSIONS.map(([key, label]) => {
      const raw = a[`${key}_start_utc`] || a[`${key}_start`];
      if (!raw) return null;
      const when = new Date(raw);
      if (Number.isNaN(when.getTime())) return null;
      return { key, label, when, mins: minutesTo(when, now) };
    })
      .filter(Boolean)
      .sort((x, y) => x.when - y.when);

    // The next session is the first that has not started.
    const next = sessions.find((s) => s.mins !== null && s.mins >= 0) || null;
    const race = sessions.find((s) => s.key === "race") || null;

    const weatherId = cfg.weather_entity || findF1WeatherEntity(hass);
    const weather = weatherId ? hass.states[weatherId] : null;

    return {
      attrs: a,
      sessions,
      next,
      race,
      weather,
      mapUrl: this._mapUrlFor(a),
    };
  }

  _render() {
    if (!this._config || !this._hass) return;
    if (!this._built) this._build();
    const m = this._model();
    this._lastModel = m;
    const e = this._els;

    if (m.error) {
      e.error.textContent = m.error;
      e.error.style.display = "";
      ["head", "map", "strip", "sessions"].forEach((k) => e[k].classList.add("hidden"));
      return;
    }
    e.error.style.display = "none";
    e.head.classList.remove("hidden");

    const a = m.attrs;
    const locale = this._locale();

    e.eyebrow.textContent = a.round
      ? `Round ${a.round}${a.season ? ` · ${a.season}` : ""}`
      : "Next race";
    e.race.textContent = a.race_name || "Next race";
    e.circuit.textContent = a.circuit_name || "";
    e.circuit.style.display = a.circuit_name ? "" : "none";
    const place = [a.circuit_locality, a.circuit_country].filter(Boolean).join(", ");
    e.place.textContent = place;
    e.place.style.display = place ? "" : "none";

    this._renderMap(m);
    this._renderStrip(m, locale);
    this._renderSessions(m, locale);
  }

  /**
   * An explicit template wins, then whatever the integration supplies, then
   * Formula 1's own artwork. `map_url: none` opts out entirely.
   */
  _mapUrlFor(attrs) {
    const custom = this._config.map_url;
    if (custom === "none") return null;
    const named = ["f1", "f1-legacy", "f1-modern"].includes(custom);
    if (custom && !named) return f1MapUrl(custom, attrs);
    if (attrs.circuit_map_url) return attrs.circuit_map_url;
    if (attrs.circuit_outline_url) return attrs.circuit_outline_url;
    return f1OfficialMapUrl(attrs, custom || "f1");
  }

  /**
   * No map means no block. An empty plate saying so is worse than the space it
   * occupies, so the whole thing goes - including when the artwork fails to
   * load, which happens for circuits Formula 1 publishes nothing for.
   */
  _renderMap(m) {
    const e = this._els;
    const url = this._config.show_map ? m.mapUrl : null;

    if (url && e.mapImg._src !== url) {
      e.mapImg._src = url;
      this._mapFailed = null;
      e.mapImg.setAttribute("src", url);
      e.mapImg.setAttribute("alt", `${m.attrs.circuit_name || "Circuit"} layout`);
    }
    const show = !!url && this._mapFailed !== url;
    e.map.classList.toggle("hidden", !show);
  }

  _renderStrip(m, locale) {
    const e = this._els;
    const target = m.next || m.race;

    if (target) {
      e.next.classList.remove("hidden");
      e.nextLabel.textContent = m.next ? "Next session" : "Race";
      e.nextName.textContent = target.label;
      e.nextWhen.textContent = f1DateTime(target.when, locale);
      const text = f1Countdown(target.mins);
      e.nextCountdown.textContent = text;
      e.nextCountdown.style.display = text ? "" : "none";
    } else {
      e.next.classList.add("hidden");
    }

    const w = m.weather;
    const show = this._config.show_weather && !!w && !DEAD_STATES.has(w.state);
    e.weather.classList.toggle("hidden", !show);
    if (!show) return;

    const wa = w.attributes || {};
    this._setIcon(e.weatherIcon, WEATHER_ICONS[w.state] || "mdi:weather-cloudy");
    const unit = wa.temperature_unit || "°C";
    e.weatherTemp.textContent =
      typeof wa.temperature === "number" ? `${Math.round(wa.temperature)}${unit}` : "";
    const bits = [];
    // The state is a slug like "partlycloudy"; make it read as words.
    bits.push(String(w.state).replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()));
    if (typeof wa.humidity === "number") bits.push(`${Math.round(wa.humidity)}% humidity`);
    if (typeof wa.wind_speed === "number") {
      bits.push(`${Math.round(wa.wind_speed)} ${wa.wind_speed_unit || "km/h"} wind`);
    }
    e.weatherSub.textContent = bits.join(" · ");
  }

  _renderSessions(m, locale) {
    const e = this._els;
    if (!this._config.show_sessions || !m.sessions.length) {
      e.sessions.classList.add("hidden");
      return;
    }
    e.sessions.classList.remove("hidden");

    const key = JSON.stringify(m.sessions.map((s) => [s.key, s.when.getTime()]));
    if (key !== this._sessionsKey) {
      this._sessionsKey = key;
      e.sessions.innerHTML = "";
      e.sessionRows = m.sessions.map((s) => {
        const row = document.createElement("div");
        row.className = "session";
        const name = document.createElement("div");
        name.className = "session-name";
        name.textContent = s.label;
        const when = document.createElement("div");
        when.className = "session-when";
        row.append(name, when);
        e.sessions.appendChild(row);
        return { s, row, when };
      });
    }

    (e.sessionRows || []).forEach(({ s, row, when }) => {
      when.textContent = `${f1Day(s.when, locale)} ${f1Time(s.when, locale)}`;
      row.classList.toggle("next", !!m.next && s.key === m.next.key);
      row.classList.toggle("done", s.mins !== null && s.mins < 0);
    });
  }

  _makeIcon(icon) {
    if (customElements.get("ha-icon")) {
      const el = document.createElement("ha-icon");
      el.setAttribute("icon", icon);
      el.className = "icon";
      el._haIcon = true;
      return el;
    }
    const span = document.createElement("span");
    span.className = "icon";
    span._icon = icon;
    return span;
  }

  _setIcon(el, icon) {
    if (!el) return;
    if (el._haIcon) {
      if (el.getAttribute("icon") !== icon) el.setAttribute("icon", icon);
    } else {
      el._icon = icon;
    }
  }

  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = F1_STYLES;
    root.appendChild(style);

    const card = document.createElement("ha-card");
    if (this._config.title) card.setAttribute("header", this._config.title);
    root.appendChild(card);

    const body = document.createElement("div");
    body.className = "body";
    card.appendChild(body);

    const error = document.createElement("div");
    error.className = "error";
    error.style.display = "none";
    body.appendChild(error);

    const head = document.createElement("div");
    head.className = "head";
    const eyebrow = document.createElement("div");
    eyebrow.className = "eyebrow";
    const race = document.createElement("div");
    race.className = "race";
    const circuit = document.createElement("div");
    circuit.className = "circuit";
    const place = document.createElement("div");
    place.className = "place";
    head.append(eyebrow, race, circuit, place);
    body.appendChild(head);

    const map = document.createElement("div");
    map.className = "map";
    const mapImg = document.createElement("img");
    mapImg.setAttribute("loading", "lazy");
    // The artwork is fetched from Formula 1 unless pointed elsewhere, so a
    // missing image has to degrade rather than leave a broken-image icon.
    mapImg.addEventListener("error", () => {
      this._mapFailed = mapImg._src;
      if (this._lastModel) this._renderMap(this._lastModel);
    });
    map.appendChild(mapImg);
    body.appendChild(map);

    const strip = document.createElement("div");
    strip.className = "strip";

    const next = document.createElement("div");
    next.className = "panel";
    const nextLabel = document.createElement("div");
    nextLabel.className = "panel-label";
    const nextMain = document.createElement("div");
    nextMain.className = "panel-main";
    const nextName = document.createElement("span");
    nextMain.appendChild(nextName);
    const nextWhen = document.createElement("div");
    nextWhen.className = "panel-sub";
    const nextCountdown = document.createElement("div");
    nextCountdown.className = "countdown";
    next.append(nextLabel, nextMain, nextWhen, nextCountdown);

    const weather = document.createElement("div");
    weather.className = "panel";
    const weatherLabel = document.createElement("div");
    weatherLabel.className = "panel-label";
    weatherLabel.textContent = "Track weather";
    const weatherMain = document.createElement("div");
    weatherMain.className = "panel-main";
    const weatherIcon = this._makeIcon("mdi:weather-cloudy");
    const weatherTemp = document.createElement("span");
    weatherMain.append(weatherIcon, weatherTemp);
    const weatherSub = document.createElement("div");
    weatherSub.className = "panel-sub";
    weather.append(weatherLabel, weatherMain, weatherSub);

    strip.append(next, weather);
    body.appendChild(strip);

    const sessions = document.createElement("div");
    sessions.className = "sessions";
    body.appendChild(sessions);

    this._els = {
      error, head, eyebrow, race, circuit, place,
      map, mapImg,
      strip, next, nextLabel, nextName, nextWhen, nextCountdown,
      weather, weatherIcon, weatherTemp, weatherSub,
      sessions, sessionRows: [],
    };
    this._built = true;
  }
}

/* --------------------------------------------------- wabit-f1-card-editor */

const F1_LABELS = {
  entity: "Next-race sensor (found automatically if left empty)",
  weather_entity: "Circuit weather (found automatically if left empty)",
  map_url: "Circuit map URL - {circuit_id}, {circuit_f1}, {season} and {round} are filled in",
  title: "Card title (leave empty for none)",
  show_map: "Show the circuit map",
  show_weather: "Show track weather",
  show_sessions: "Show the session times",
};

const F1_SCHEMA = [
  { name: "entity", selector: { entity: { domain: "sensor" } } },
  { name: "weather_entity", selector: { entity: { domain: "weather" } } },
  { name: "map_url", selector: { text: {} } },
  { name: "title", selector: { text: {} } },
  { name: "show_map", selector: { boolean: {} } },
  { name: "show_weather", selector: { boolean: {} } },
  { name: "show_sessions", selector: { boolean: {} } },
];

class WabitF1CardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...(config || {}) };
    if (!this._built) this._build();
    this._push();
  }

  set hass(hass) {
    this._hass = hass;
    this._push();
  }

  get hass() {
    return this._hass;
  }

  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = EDITOR_STYLES;
    root.appendChild(style);

    if (!customElements.get("ha-form")) {
      const note = document.createElement("div");
      note.className = "note";
      note.textContent =
        "This Home Assistant build does not provide ha-form, so the visual editor " +
        "is unavailable. Configure this card in YAML instead - the options are " +
        "documented at " + REPO;
      root.appendChild(note);
      this._form = null;
      this._built = true;
      return;
    }

    const form = document.createElement("ha-form");
    form.schema = F1_SCHEMA;
    form.computeLabel = (s) => F1_LABELS[s.name] || s.name;
    form.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      this._config = { ...this._config, ...ev.detail.value };
      fireEvent(this, "config-changed", { config: this._config });
    });
    root.appendChild(form);
    this._form = form;
    this._built = true;
  }

  _push() {
    if (!this._form || !this._hass || !this._config) return;
    this._form.hass = this._hass;
    const data = {
      entity: this._config.entity,
      weather_entity: this._config.weather_entity,
      map_url: this._config.map_url,
      title: this._config.title,
      show_map: this._config.show_map !== false,
      show_weather: this._config.show_weather !== false,
      show_sessions: this._config.show_sessions !== false,
    };
    if (JSON.stringify(this._form.data) !== JSON.stringify(data)) this._form.data = data;
  }
}

if (!customElements.get("wabit-f1-card")) {
  customElements.define("wabit-f1-card", WabitF1Card);
}
if (!customElements.get("wabit-f1-card-editor")) {
  customElements.define("wabit-f1-card-editor", WabitF1CardEditor);
}

if (!window.customCards.some((c) => c.type === "wabit-f1-card")) {
  window.customCards.push({
    type: "wabit-f1-card",
    name: "Wabit F1",
    description:
      "The next Grand Prix: where, when, the circuit layout, the session times " +
      "and the weather at the track.",
    preview: true,
    documentationURL: REPO,
  });
}

/* --------------------------------------------------------- wabit-air-card */

/**
 * The metrics an air sensor might report, in the order they are worth reading.
 * Matched on device class, with a name test where a class is ambiguous: VOC and
 * NOx indexes are both `aqi`, so the class alone cannot tell them apart.
 */
const AIR_METRICS = [
  { key: "co2", label: "CO₂", classes: ["carbon_dioxide"], icon: "mdi:molecule-co2" },
  { key: "pm25", label: "PM2.5", classes: ["pm25"], match: /pm_?2_?5/i, icon: "mdi:blur" },
  { key: "pm10", label: "PM10", classes: ["pm10"], match: /pm_?10/i, icon: "mdi:blur" },
  { key: "pm1", label: "PM1.0", classes: ["pm1"], match: /pm_?1(_?0)?(?!\d)/i, icon: "mdi:blur" },
  { key: "pm4", label: "PM4.0", classes: ["pm25", "pm10", "pm1", null], match: /pm_?4/i, icon: "mdi:blur" },
  { key: "voc", label: "VOC", classes: ["aqi"], match: /voc/i, icon: "mdi:chemical-weapon" },
  { key: "nox", label: "NOx", classes: ["aqi"], match: /nox/i, icon: "mdi:chemical-weapon" },
  { key: "temperature", label: "Temperature", classes: ["temperature"], icon: "mdi:thermometer" },
  { key: "humidity", label: "Humidity", classes: ["humidity"], icon: "mdi:water-percent" },
  { key: "pressure", label: "Pressure", classes: ["atmospheric_pressure", "pressure"], icon: "mdi:gauge" },
];

/**
 * Series colours, carried over from the graph cards this replaces. On a chart
 * with four lines the colour is the only thing telling them apart, so these are
 * part of the data, not decoration - override them per metric with `colors`.
 */
const AIR_COLORS = {
  pm1: "#00bcd4",
  pm25: "#4caf50",
  pm4: "#ff9800",
  pm10: "#f44336",
  co2: "#9c27b0",
  pressure: "#2196f3",
  temperature: "#e53935",
  humidity: "#1e88e5",
  voc: "var(--accent-color, #ff9800)",
  nox: "var(--accent-color, #ff9800)",
};

/**
 * How readings are grouped into charts. The four particle sizes share one,
 * because each is only meaningful next to the others; the rest get their own,
 * full width where the shape carries information and half where it does not.
 */
const AIR_CHARTS = [
  {
    key: "climate", title: "Temperature & humidity", icon: "mdi:thermometer",
    metrics: ["temperature", "humidity"],
    width: "full", legend: true, independent: true, line_width: 2,
  },
  {
    key: "pm", title: "Particulate matter", icon: "mdi:blur",
    metrics: ["pm1", "pm25", "pm4", "pm10"],
    width: "full", legend: true, line_width: 1, lower_bound: 0,
  },
  {
    key: "co2", metrics: ["co2"], width: "full",
    labels: true, extrema: true, line_width: 2, lower_bound: 0,
  },
  {
    key: "pressure", metrics: ["pressure"], width: "full",
    labels: true, extrema: true, line_width: 2,
  },
  {
    key: "voc", metrics: ["voc"], width: "half",
    labels: true, extrema: true, line_width: 2, lower_bound: 0, upper_bound: 500,
  },
  {
    key: "nox", metrics: ["nox"], width: "half",
    labels: true, extrema: true, line_width: 2, lower_bound: 0, upper_bound: 500,
  },
];

/**
 * Where each metric stops being good and starts being poor. Only the ones that
 * say something about air quality get a verdict; temperature, humidity and
 * pressure are reported but never judged.
 */
const AIR_THRESHOLDS = {
  co2: [800, 1200],     // ppm: fresh indoor air is ~400-800
  pm25: [12, 35],       // µg/m³, WHO-ish daily guidance
  pm10: [45, 100],
  pm1: [12, 35],
  voc: [150, 250],      // Sensirion index, 100 is the running average
  nox: [150, 250],
};

const AIR_BANDS = ["good", "fair", "poor"];

/** Which band a reading falls in, or null for metrics that are not judged. */
function airBand(key, value, thresholds) {
  const t = (thresholds || AIR_THRESHOLDS)[key];
  if (!t || typeof value !== "number" || Number.isNaN(value)) return null;
  if (value <= t[0]) return "good";
  if (value <= t[1]) return "fair";
  return "poor";
}

/** The worst band across the judged metrics, and what drove it. */
function airVerdict(metrics, thresholds) {
  let worst = null;
  let driver = null;
  for (const m of metrics) {
    const band = airBand(m.key, m.value, thresholds);
    if (!band) continue;
    if (!worst || AIR_BANDS.indexOf(band) > AIR_BANDS.indexOf(worst)) {
      worst = band;
      driver = m;
    }
  }
  return { band: worst, driver };
}

/** Air sensors belonging to an area, one per metric. */
function airSensorsInArea(hass, areaId) {
  const entities = (hass && hass.entities) || {};
  const devices = (hass && hass.devices) || {};
  const candidates = [];
  for (const [id, ent] of Object.entries(entities)) {
    if (!id.startsWith("sensor.")) continue;
    if (ent.entity_category || ent.hidden || ent.hidden_by || ent.disabled_by) continue;
    const device = ent.device_id ? devices[ent.device_id] : null;
    const area = ent.area_id || (device ? device.area_id : null);
    if (area !== areaId) continue;
    const st = hass.states[id];
    if (!st) continue;
    candidates.push({ id, st });
  }
  return matchAirMetrics(candidates);
}

/** Pairs candidate sensors to metrics, keeping the first match for each. */
function matchAirMetrics(candidates) {
  const out = [];
  const taken = new Set();
  for (const metric of AIR_METRICS) {
    for (const { id, st } of candidates) {
      if (taken.has(id)) continue;
      const dc = (st.attributes || {}).device_class || null;
      if (!metric.classes.includes(dc)) continue;
      // A name test is required wherever the device class is shared.
      if (metric.match && !metric.match.test(id)) continue;
      taken.add(id);
      out.push({ ...metric, id, st });
      break;
    }
  }
  return out;
}

/** Significant figures HA suggests for a sensor, falling back on the value. */
function airPrecision(hass, id, value) {
  const reg = ((hass && hass.entities) || {})[id];
  if (reg && typeof reg.display_precision === "number") return reg.display_precision;
  if (Math.abs(value) >= 100) return 0;
  if (Math.abs(value) >= 10) return 1;
  return 2;
}

/**
 * History, averaged into evenly spaced buckets across the window.
 *
 * A sensor reports when it changes, so a bucket with no sample has not gone
 * quiet - it is still reading whatever it last said. Empty buckets therefore
 * carry the previous value forward, and only the stretch before the first
 * reading is left as a gap.
 */
function bucketSeries(entries, startMs, endMs, buckets) {
  const out = new Array(Math.max(0, buckets)).fill(null);
  if (!Array.isArray(entries) || !entries.length || buckets < 1) return out;

  const samples = [];
  let stamped = 0;
  for (const e of entries) {
    if (!e) continue;
    const v = Number(e.s !== undefined ? e.s : e.state);
    if (!Number.isFinite(v)) continue;
    let t = null;
    if (typeof e.lu === "number") t = e.lu * 1000;
    else if (e.last_changed || e.last_updated) t = Date.parse(e.last_changed || e.last_updated);
    if (t !== null && Number.isFinite(t)) stamped++;
    else t = null;
    samples.push({ v, t });
  }
  if (!samples.length) return out;

  const sums = new Array(buckets).fill(0);
  const counts = new Array(buckets).fill(0);
  const span = endMs - startMs;
  if (stamped < samples.length || span <= 0) {
    // Without usable timestamps the only honest reading of the data is that it
    // is evenly spaced across the window.
    const step = samples.length > 1 ? (buckets - 1) / (samples.length - 1) : 0;
    samples.forEach((s, i) => {
      const idx = Math.round(i * step);
      sums[idx] += s.v;
      counts[idx] += 1;
    });
  } else {
    for (const s of samples) {
      let idx = Math.floor(((s.t - startMs) / span) * buckets);
      if (idx < 0) idx = 0;
      if (idx >= buckets) idx = buckets - 1;
      sums[idx] += s.v;
      counts[idx] += 1;
    }
  }

  let carried = null;
  for (let i = 0; i < buckets; i++) {
    if (counts[i]) carried = sums[i] / counts[i];
    out[i] = carried;
  }
  return out;
}

/** The value range a chart's axis should cover, honouring any fixed bounds. */
function chartBounds(seriesValues, lower, upper) {
  let min = Infinity;
  let max = -Infinity;
  for (const values of seriesValues || []) {
    for (const v of values || []) {
      if (typeof v !== "number" || Number.isNaN(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (min === Infinity) return null;
  if (typeof lower === "number") min = Math.min(lower, min);
  if (typeof upper === "number") max = Math.max(upper, max);
  if (max - min < 1e-9) {
    // A flat line would divide by zero; park it in the middle instead.
    min -= 0.5;
    max += 0.5;
  }
  return { min, max };
}

/** Where a value sits in the box, as a fraction from the top. */
function chartY(value, bounds) {
  return 1 - (value - bounds.min) / (bounds.max - bounds.min);
}

/** An SVG path along a series. Gaps in the data break the line. */
function linePath(values, bounds, width, height) {
  if (!bounds || !values || values.length < 2) return "";
  const step = width / (values.length - 1);
  let d = "";
  let open = false;
  values.forEach((v, i) => {
    if (typeof v !== "number" || Number.isNaN(v)) {
      open = false;
      return;
    }
    d += `${open ? "L" : "M"}${(i * step).toFixed(2)},${(chartY(v, bounds) * height).toFixed(2)} `;
    open = true;
  });
  return d.trim();
}

/** The same series closed down to the baseline, for the fade underneath. */
function areaPath(values, bounds, width, height) {
  if (!bounds || !values || values.length < 2) return "";
  const step = width / (values.length - 1);
  let d = "";
  let run = [];
  const flush = () => {
    if (run.length > 1) {
      const first = run[0];
      const last = run[run.length - 1];
      d += `M${(first.i * step).toFixed(2)},${height.toFixed(2)} `;
      for (const p of run) {
        d += `L${(p.i * step).toFixed(2)},${(chartY(p.v, bounds) * height).toFixed(2)} `;
      }
      d += `L${(last.i * step).toFixed(2)},${height.toFixed(2)} Z `;
    }
    run = [];
  };
  values.forEach((v, i) => {
    if (typeof v !== "number" || Number.isNaN(v)) flush();
    else run.push({ i, v });
  });
  flush();
  return d.trim();
}

/** Indexes of the lowest and highest readings in a series. */
function seriesExtrema(values) {
  let lo = -1;
  let hi = -1;
  (values || []).forEach((v, i) => {
    if (typeof v !== "number" || Number.isNaN(v)) return;
    if (lo < 0 || v < values[lo]) lo = i;
    if (hi < 0 || v > values[hi]) hi = i;
  });
  return lo < 0 ? null : { min: lo, max: hi };
}

/* SVG elements need their namespace: document.createElement("svg") yields an
   unknown HTML element that renders nothing. */
const SVG_NS = "http://www.w3.org/2000/svg";

const AIR_VIEW_W = 300;
const AIR_VIEW_H = 100;

const AIR_STYLES = `
  :host {
    display: block;
    --wc-text: var(--md-sys-color-on-surface, var(--primary-text-color, #212121));
    --wc-muted: var(--md-sys-color-on-surface-variant, var(--secondary-text-color, #727272));
    --wc-tonal: var(--md-sys-color-surface-container-highest,
                 rgba(var(--rgb-primary-text-color, 33, 33, 33), 0.08));
    --wc-outline: var(--md-sys-color-outline-variant, var(--divider-color, #e0e0e0));
    /* Judgement colours are literal: green, amber and red mean the same thing
       in every theme, and a themed accent would not carry the meaning. */
    --wc-card-bg: var(--ha-card-background, var(--card-background-color, transparent));
    --wc-good: #2e9b57;
    --wc-fair: #c88a1a;
    --wc-poor: #cf4436;
  }
  ha-card { overflow: hidden; }
  .header { padding: 12px 16px 4px; }
  .title {
    color: var(--ha-card-header-color, var(--wc-text));
    font-family: var(--ha-card-header-font-family, inherit);
    font-size: var(--ha-card-header-font-size, 24px);
    font-weight: 400; letter-spacing: -0.012em; line-height: 1.25;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .body { padding: 12px 16px 16px; }
  .body.tight { padding-top: 4px; }

  /* --------------------------------------------------------- the verdict */
  .verdict { display: flex; align-items: center; gap: 12px; }
  .verdict.hidden { display: none; }
  .dot {
    width: 14px; height: 14px; border-radius: 50%; flex: none;
    background: var(--band, var(--wc-muted));
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--band, #888) 22%, transparent);
  }
  .verdict-main { flex: 1; min-width: 0; }
  .verdict-word {
    font-size: 1.35rem; font-weight: 500; line-height: 1.2;
    color: var(--band, var(--wc-text));
  }
  .verdict-why { color: var(--wc-muted); font-size: 0.82rem; margin-top: 2px; }

  /* ---------------------------------------------------------- the charts */
  .charts { display: grid; gap: 10px; margin-top: 14px; }
  @media (min-width: 420px) {
    .charts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .chart.full { grid-column: 1 / -1; }
  }
  .chart {
    border-radius: 14px; padding: 10px 12px 8px; background: var(--wc-tonal);
    min-width: 0;
  }
  /* Flat: no panel behind the graphs, so they sit straight on the card. The
     label chips and point halos have to follow, or they keep painting the
     panel colour over a background that is no longer there. */
  .charts.flat { gap: 16px 24px; }
  .charts.flat .chart { background: none; padding-left: 0; padding-right: 0; }
  .charts.flat .axis { background: var(--wc-card-bg); }
  .charts.flat .point { box-shadow: 0 0 0 2px var(--wc-card-bg); }
  .chart-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .chart-head .icon { --mdc-icon-size: 17px; color: var(--series, var(--wc-muted)); flex: none; }
  .chart-name {
    font-size: 0.7rem; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--wc-muted); font-weight: 600; min-width: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .band-dot {
    width: 7px; height: 7px; border-radius: 50%; flex: none;
    background: var(--band, transparent);
  }
  .band-dot.hidden { display: none; }
  .chart-state {
    margin-left: auto; color: var(--wc-text); font-size: 1.15rem; line-height: 1.1;
    font-variant-numeric: tabular-nums; white-space: nowrap; flex: none;
  }
  .chart-state .unit { font-size: 0.7rem; color: var(--wc-muted); margin-left: 2px; }

  .plot { position: relative; margin-top: 6px; touch-action: pan-y; }
  .chart.full .plot { height: 94px; }
  .chart.half .plot { height: 68px; }
  .plot.hidden { display: none; }
  .plot svg { display: block; width: 100%; height: 100%; overflow: visible; }
  .line { fill: none; stroke: var(--series); stroke-linecap: round; stroke-linejoin: round;
          vector-effect: non-scaling-stroke; }
  .fill { stroke: none; fill: var(--series); opacity: 0.16; }

  /* Axis bounds and extrema sit in HTML, not SVG: the plot is stretched to fit
     its box, which would distort any text inside it. */
  .axis {
    position: absolute; left: 0; font-size: 0.62rem; color: var(--wc-muted);
    font-variant-numeric: tabular-nums; pointer-events: none;
    background: var(--wc-tonal); padding-right: 3px; border-radius: 3px;
  }
  .axis.hidden { display: none; }
  .axis.max { top: -2px; }
  .axis.min { bottom: -2px; }
  .ext {
    position: absolute; transform: translate(-50%, -50%);
    font-size: 0.62rem; color: var(--wc-muted); font-variant-numeric: tabular-nums;
    pointer-events: none; white-space: nowrap;
  }
  .ext.hidden { display: none; }

  .cross {
    position: absolute; top: 0; bottom: 0; width: 1px; opacity: 0;
    background: var(--wc-muted); pointer-events: none; transform: translateX(-0.5px);
  }
  .point {
    position: absolute; width: 7px; height: 7px; border-radius: 50%; opacity: 0;
    background: var(--series); pointer-events: none;
    transform: translate(-50%, -50%);
    box-shadow: 0 0 0 2px var(--wc-tonal);
  }
  .chart.hovering .cross, .chart.hovering .point { opacity: 1; }
  .hit { position: absolute; inset: 0; cursor: crosshair; }

  /* The readout sits in whichever top corner the cursor is not near, so it
     never leaves the card or covers the point being read. */
  .tip {
    position: absolute; top: 2px;
    background: var(--md-sys-color-inverse-surface, #313033);
    color: var(--md-sys-color-inverse-on-surface, #f5eff7);
    border-radius: 8px; padding: 6px 8px; font-size: 0.72rem; line-height: 1.35;
    pointer-events: none; opacity: 0; transition: opacity 90ms linear;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28); z-index: 2;
    white-space: nowrap; min-width: 84px;
  }
  .chart.hovering .tip { opacity: 1; }
  .tip-time { opacity: 0.7; font-size: 0.66rem; margin-bottom: 2px; }
  .tip-row { display: flex; align-items: center; gap: 6px; }
  .tip-row .sw { width: 7px; height: 7px; border-radius: 50%; background: var(--series); flex: none; }
  .tip-row .nm { opacity: 0.8; }
  .tip-row .val { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 600; }

  .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px; }
  .legend.hidden { display: none; }
  .key { display: flex; align-items: center; gap: 5px; font-size: 0.7rem; color: var(--wc-muted); }
  .key .sw { width: 8px; height: 8px; border-radius: 50%; background: var(--series); flex: none; }
  .key .val { color: var(--wc-text); font-variant-numeric: tabular-nums; }

  .empty, .error { font-size: 0.9rem; line-height: 1.5; padding: 4px 0; }
  .empty { color: var(--wc-muted); }
  .error { color: var(--error-color, #db4437); }
`;

class WabitAirCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("wabit-air-card-editor");
  }

  static getStubConfig(hass) {
    const areas = (hass && hass.areas) || {};
    let best = null;
    for (const id of Object.keys(areas)) {
      const n = airSensorsInArea(hass, id).length;
      if (n && (!best || n > best.n)) best = { id, n };
    }
    return { type: "custom:wabit-air-card", area: best ? best.id : "" };
  }

  setConfig(config) {
    const cfg = config || {};
    if (isUnset(cfg.area) && !(Array.isArray(cfg.entities) && cfg.entities.length)) {
      throw new Error("wabit-air-card: either `area` or `entities` is required");
    }
    (cfg.entities || []).forEach((e) => {
      if (typeof e !== "string" || !e.startsWith("sensor.")) {
        throw new Error(`wabit-air-card: \`entities\` may only contain sensors, got "${e}"`);
      }
    });
    if (cfg.metrics !== undefined && !Array.isArray(cfg.metrics)) {
      throw new Error("wabit-air-card: `metrics` must be a list of metric names");
    }
    const hours = Number(cfg.hours);
    const pph = Number(cfg.points_per_hour);

    this._config = {
      area: isUnset(cfg.area) ? null : String(cfg.area),
      entities: Array.isArray(cfg.entities) && cfg.entities.length ? cfg.entities : null,
      metrics: Array.isArray(cfg.metrics) ? cfg.metrics : null,
      title: cfg.title,
      show_header: cfg.show_header !== false,
      show_verdict: cfg.show_verdict !== false,
      // `show_sparklines` was the name in 1.16.0, before the graphs were real.
      show_graphs: cfg.show_graphs !== false && cfg.show_sparklines !== false,
      show_legend: cfg.show_legend !== false,
      show_labels: cfg.show_labels !== false,
      show_extrema: cfg.show_extrema !== false,
      show_chart_background: cfg.show_chart_background !== false,
      hours: Number.isFinite(hours) && hours > 0 ? Math.min(hours, 168) : 12,
      points_per_hour: Number.isFinite(pph) && pph > 0 ? Math.min(pph, 60) : 6,
      colors: { ...AIR_COLORS, ...(cfg.colors || {}) },
      thresholds: { ...AIR_THRESHOLDS, ...(cfg.thresholds || {}) },
    };

    this._built = false;
    this._chartKey = null;
    this._history = null;
    this._historyAt = 0;
    this._window = null;
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._config) this._render();
  }

  get hass() {
    return this._hass;
  }

  connectedCallback() {
    this._tick = window.setInterval(() => {
      if (this._built && this._hass) this._refreshHistory();
    }, 300000);
  }

  disconnectedCallback() {
    if (this._tick) window.clearInterval(this._tick);
    this._tick = null;
  }

  getCardSize() {
    const m = this._lastModel;
    const charts = (m && m.charts) || [];
    const rows = charts.reduce((n, c) => n + (c.width === "full" ? 1 : 0.5), 0);
    return 2 + Math.ceil(rows * 1.5 || 4);
  }

  _model() {
    const hass = this._hass;
    const cfg = this._config;

    let metrics;
    if (cfg.entities) {
      metrics = matchAirMetrics(
        cfg.entities.filter((id) => hass.states[id]).map((id) => ({ id, st: hass.states[id] }))
      );
    } else {
      if (!hass.entities || !hass.areas) {
        return { error: "This Home Assistant build does not expose the area registry to cards." };
      }
      const areaId = resolveAreaId(hass, cfg.area);
      if (!areaId) return { error: `No area called "${cfg.area}".` };
      metrics = airSensorsInArea(hass, areaId);
      this._areaName = (hass.areas[areaId] || {}).name || cfg.area;
    }

    if (cfg.metrics) {
      metrics = cfg.metrics.map((k) => metrics.find((m) => m.key === k)).filter(Boolean);
    }

    const read = metrics.map((m) => {
      const raw = Number(m.st.state);
      const value = Number.isFinite(raw) ? raw : null;
      return {
        ...m,
        value,
        unit: (m.st.attributes || {}).unit_of_measurement || "",
        band: airBand(m.key, value, cfg.thresholds),
        color: cfg.colors[m.key] || "var(--wc-muted)",
      };
    });

    return { metrics: read, verdict: airVerdict(read, cfg.thresholds), charts: airChartsFor(read) };
  }

  _render() {
    if (!this._config || !this._hass) return;
    if (!this._built) this._build();
    const m = this._model();
    this._lastModel = m;
    const e = this._els;

    if (m.error) {
      e.error.textContent = m.error;
      e.error.style.display = "";
      e.verdict.classList.add("hidden");
      e.charts.style.display = "none";
      e.empty.style.display = "none";
      return;
    }
    e.error.style.display = "none";

    if (e.title) {
      const name = this._config.title === undefined ? this._areaName || "" : this._config.title;
      e.title.textContent = name;
      e.header.style.display = name ? "" : "none";
    }

    if (!m.metrics.length) {
      e.verdict.classList.add("hidden");
      e.charts.style.display = "none";
      e.empty.style.display = "";
      e.empty.textContent = this._config.entities
        ? "None of the configured sensors are available."
        : `No air sensors found in ${this._areaName || "this room"}.`;
      return;
    }
    e.empty.style.display = "none";
    e.charts.style.display = "";

    this._renderVerdict(m);
    this._renderCharts(m);
    this._refreshHistory();
  }

  _renderVerdict(m) {
    const e = this._els;
    const show = this._config.show_verdict && !!m.verdict.band;
    e.verdict.classList.toggle("hidden", !show);
    if (!show) return;

    const band = m.verdict.band;
    e.verdict.style.setProperty("--band", `var(--wc-${band})`);
    e.verdictWord.textContent =
      band === "good" ? "Air is good" : band === "fair" ? "Air is fair" : "Air is poor";

    const d = m.verdict.driver;
    if (band === "good") {
      e.verdictWhy.textContent = "Everything measured is within range.";
    } else if (d) {
      e.verdictWhy.textContent =
        `${d.label} is the highest at ${this._format(d)}${d.unit ? " " + d.unit : ""}.`;
    } else {
      e.verdictWhy.textContent = "";
    }
  }

  _format(metric, value) {
    const v = value === undefined ? metric.value : value;
    if (typeof v !== "number" || Number.isNaN(v)) return "—";
    return v.toFixed(airPrecision(this._hass, metric.id, v));
  }

  _renderCharts(m) {
    const e = this._els;
    const key = JSON.stringify(
      m.charts.map((c) => [c.key, c.width, c.series.map((s) => s.id)])
    );
    if (key !== this._chartKey) {
      this._chartKey = key;
      e.charts.innerHTML = "";
      e.chartEls = m.charts.map((spec) => this._buildChart(spec));
    }

    e.chartEls.forEach((h, i) => {
      h.spec = m.charts[i];
      h.series.forEach((s, j) => (s.metric = m.charts[i].series[j]));
      this._paintChart(h);
    });
  }

  _buildChart(spec) {
    const el = document.createElement("div");
    el.className = `chart ${spec.width}`;

    const head = document.createElement("div");
    head.className = "chart-head";
    head.appendChild(this._makeIcon(spec.icon));
    const name = document.createElement("div");
    name.className = "chart-name";
    name.textContent = spec.title;
    const bandDot = document.createElement("div");
    bandDot.className = "band-dot hidden";
    const state = document.createElement("div");
    state.className = "chart-state";
    head.append(name, bandDot, state);

    const plot = document.createElement("div");
    plot.className = "plot";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${AIR_VIEW_W} ${AIR_VIEW_H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    plot.appendChild(svg);

    const series = spec.series.map((metric) => {
      const g = document.createElementNS(SVG_NS, "g");
      g.style.setProperty("--series", metric.color);
      const fill = document.createElementNS(SVG_NS, "path");
      fill.setAttribute("class", "fill");
      const line = document.createElementNS(SVG_NS, "path");
      line.setAttribute("class", "line");
      line.setAttribute("stroke-width", String(spec.line_width || 2));
      g.append(fill, line);
      svg.appendChild(g);

      const point = document.createElement("div");
      point.className = "point";
      point.style.setProperty("--series", metric.color);
      plot.appendChild(point);

      return { metric, g, fill, line, point };
    });

    const axisMax = document.createElement("div");
    axisMax.className = "axis max hidden";
    const axisMin = document.createElement("div");
    axisMin.className = "axis min hidden";
    const extMax = document.createElement("div");
    extMax.className = "ext hidden";
    const extMin = document.createElement("div");
    extMin.className = "ext hidden";
    extMax.style.setProperty("--series", spec.series[0].color);
    extMin.style.setProperty("--series", spec.series[0].color);

    const cross = document.createElement("div");
    cross.className = "cross";

    const tip = document.createElement("div");
    tip.className = "tip";
    const tipTime = document.createElement("div");
    tipTime.className = "tip-time";
    tip.appendChild(tipTime);
    series.forEach((s) => {
      const row = document.createElement("div");
      row.className = "tip-row";
      row.style.setProperty("--series", s.metric.color);
      const sw = document.createElement("span");
      sw.className = "sw";
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = s.metric.label;
      const val = document.createElement("span");
      val.className = "val";
      row.append(sw, nm, val);
      tip.appendChild(row);
      s.tipVal = val;
    });

    const hit = document.createElement("div");
    hit.className = "hit";
    plot.append(axisMax, axisMin, extMax, extMin, cross, tip, hit);

    const legend = document.createElement("div");
    legend.className = "legend hidden";
    series.forEach((s) => {
      const key = document.createElement("div");
      key.className = "key";
      key.style.setProperty("--series", s.metric.color);
      const sw = document.createElement("span");
      sw.className = "sw";
      const nm = document.createElement("span");
      nm.textContent = s.metric.label;
      const val = document.createElement("span");
      val.className = "val";
      key.append(sw, nm, val);
      legend.appendChild(key);
      s.legendVal = val;
    });

    el.append(head, plot, legend);
    this._els.charts.appendChild(el);

    const handle = {
      spec, el, plot, svg, series, state, bandDot, legend,
      axisMax, axisMin, extMax, extMin, cross, tip, tipTime, hit,
      bounds: null, buckets: 0,
    };
    this._bindHover(handle);
    return handle;
  }

  /** Pointer anywhere over the plot reads out every series at that moment. */
  _bindHover(h) {
    const at = (ev) => {
      const rect = h.plot.getBoundingClientRect ? h.plot.getBoundingClientRect() : null;
      if (!rect || !rect.width) return;
      this._hover(h, (ev.clientX - rect.left) / rect.width);
    };
    h.hit.addEventListener("pointermove", at);
    h.hit.addEventListener("pointerdown", at);
    h.hit.addEventListener("pointerleave", () => this._hover(h, null));
    h.hit.addEventListener("pointercancel", () => this._hover(h, null));
  }

  _hover(h, fraction) {
    const n = h.buckets;
    if (fraction === null || !h.drawable || n < 2) {
      h.el.classList.remove("hovering");
      return;
    }
    const clamped = Math.max(0, Math.min(1, fraction));
    let i = Math.round(clamped * (n - 1));
    // Before the first reading there is nothing to show; step back to where
    // the data starts rather than reporting a gap as a value.
    while (i > 0 && h.series.every((s) => typeof s.values[i] !== "number")) i -= 1;
    if (h.series.every((s) => typeof s.values[i] !== "number")) {
      h.el.classList.remove("hovering");
      return;
    }

    h.el.classList.add("hovering");
    const x = (i / (n - 1)) * 100;
    h.cross.style.left = `${x}%`;
    h.series.forEach((s) => {
      const v = s.values[i];
      const on = typeof v === "number" && !Number.isNaN(v);
      s.point.style.display = on ? "" : "none";
      if (on && s.bounds) {
        s.point.style.left = `${x}%`;
        s.point.style.top = `${chartY(v, s.bounds) * 100}%`;
      }
      s.tipVal.textContent = on ? this._withUnit(s.metric, v) : "—";
    });
    h.tipTime.textContent = this._timeAt(i, n);
    // Park the readout in the corner furthest from the cursor.
    const right = x < 50;
    h.tip.style.left = right ? "auto" : "2px";
    h.tip.style.right = right ? "2px" : "auto";
    h.hovered = i;
  }

  _withUnit(metric, value) {
    const text = this._format(metric, value);
    return metric.unit ? `${text} ${metric.unit}` : text;
  }

  _timeAt(i, n) {
    const w = this._window;
    if (!w) return "";
    const t = new Date(w.start + ((w.end - w.start) * i) / (n - 1));
    try {
      return new Intl.DateTimeFormat(this._hass.locale && this._hass.locale.language, {
        hour: "2-digit",
        minute: "2-digit",
      }).format(t);
    } catch (err) {
      return t.toISOString().slice(11, 16);
    }
  }

  _paintChart(h) {
    const cfg = this._config;
    const spec = h.spec;
    const hist = this._history || {};
    const w = this._window || this._defaultWindow();
    const buckets = Math.max(2, Math.round((cfg.hours * cfg.points_per_hour)));
    h.buckets = buckets;

    h.series.forEach((s) => {
      s.values = cfg.show_graphs
        ? bucketSeries(hist[s.metric.id], w.start, w.end, buckets)
        : new Array(buckets).fill(null);
      s.g.style.setProperty("--series", s.metric.color);
      s.point.style.setProperty("--series", s.metric.color);
    });

    // Readings in different units cannot share an axis - degrees against a
    // percentage would squash one of them into a flat line. An independent
    // chart scales each line to its own range, so both shapes are readable and
    // the legend and the hover readout carry the actual numbers.
    const shared = chartBounds(h.series.map((s) => s.values), spec.lower_bound, spec.upper_bound);
    h.series.forEach((s) => {
      s.bounds = spec.independent
        ? chartBounds([s.values], spec.lower_bound, spec.upper_bound)
        : shared;
    });
    const drawable = h.series.some(
      (s) => s.bounds && s.values.some((v) => typeof v === "number")
    );
    const bounds = spec.independent ? null : (drawable ? shared : null);
    h.bounds = bounds;
    h.drawable = drawable;
    h.plot.classList.toggle("hidden", !drawable);

    h.series.forEach((s) => {
      const b = drawable ? s.bounds : null;
      s.line.setAttribute("d", b ? linePath(s.values, b, AIR_VIEW_W, AIR_VIEW_H) : "");
      s.fill.setAttribute("d", b ? areaPath(s.values, b, AIR_VIEW_W, AIR_VIEW_H) : "");
    });

    // The headline figure is the live state, not the last point of history.
    const lead = h.series[0].metric;
    h.el.style.setProperty("--series", lead.color);
    if (h.series.length === 1) {
      h.state.textContent = "";
      const num = document.createElement("span");
      num.textContent = this._format(lead);
      h.state.appendChild(num);
      if (lead.unit) {
        const unit = document.createElement("span");
        unit.className = "unit";
        unit.textContent = lead.unit;
        h.state.appendChild(unit);
      }
    } else {
      h.state.textContent = "";
    }

    const worst = airVerdict(h.series.map((s) => s.metric), cfg.thresholds);
    const flagged = worst.band === "fair" || worst.band === "poor";
    h.bandDot.classList.toggle("hidden", !flagged);
    if (flagged) h.bandDot.style.setProperty("--band", `var(--wc-${worst.band})`);

    const showLegend = cfg.show_legend && spec.legend && h.series.length > 1;
    h.legend.classList.toggle("hidden", !showLegend);
    if (showLegend) {
      h.series.forEach((s) => {
        s.legendVal.textContent = this._withUnit(s.metric, s.metric.value);
      });
    }

    const showAxis = cfg.show_labels && spec.labels && drawable && !!bounds;
    h.axisMax.classList.toggle("hidden", !showAxis);
    h.axisMin.classList.toggle("hidden", !showAxis);
    if (showAxis) {
      h.axisMax.textContent = this._format(lead, bounds.max);
      h.axisMin.textContent = this._format(lead, bounds.min);
    }

    const ext = cfg.show_extrema && spec.extrema && drawable && bounds && h.series.length === 1
      ? seriesExtrema(h.series[0].values)
      : null;
    h.extMax.classList.toggle("hidden", !ext);
    h.extMin.classList.toggle("hidden", !ext);
    if (ext) {
      const values = h.series[0].values;
      const place = (el, idx) => {
        const x = (idx / (buckets - 1)) * 100;
        el.textContent = this._format(lead, values[idx]);
        el.style.left = `${x}%`;
        el.style.top = `${chartY(values[idx], bounds) * 100}%`;
        // A marker at either end would otherwise hang outside the plot.
        el.style.transform =
          x < 12 ? "translate(0, -50%)"
          : x > 88 ? "translate(-100%, -50%)"
          : "translate(-50%, -50%)";
      };
      place(h.extMax, ext.max);
      place(h.extMin, ext.min);
      // With a flat line both markers land together; one is enough.
      h.extMin.classList.toggle("hidden", ext.min === ext.max);
      // An axis label is dropped where the extremum marker already answers it:
      // either it reads the same number, or it is close enough to collide.
      if (showAxis) {
        const yMax = chartY(values[ext.max], bounds) * 100;
        const yMin = chartY(values[ext.min], bounds) * 100;
        h.axisMax.classList.toggle(
          "hidden", h.axisMax.textContent === h.extMax.textContent || yMax < 15);
        h.axisMin.classList.toggle(
          "hidden", h.axisMin.textContent === h.extMin.textContent || yMin > 85);
      }
    }
  }

  _defaultWindow() {
    const end = Date.now();
    return { start: end - this._config.hours * 3600000, end };
  }

  /** History draws the graphs; without it the readings still stand on their own. */
  _refreshHistory() {
    const cfg = this._config;
    const m = this._lastModel;
    if (!cfg.show_graphs || !m || !m.metrics || !m.metrics.length) return;
    if (!this._hass.callWS) return;
    if (this._historyAt && Date.now() - this._historyAt < 290000) return;
    this._historyAt = Date.now();

    const w = this._defaultWindow();
    this._hass
      .callWS({
        type: "history/history_during_period",
        start_time: new Date(w.start).toISOString(),
        end_time: new Date(w.end).toISOString(),
        entity_ids: m.metrics.map((x) => x.id),
        minimal_response: true,
        no_attributes: true,
      })
      .then((res) => {
        this._history = res || {};
        this._window = w;
        this._repaint();
      })
      .catch(() => {
        this._history = null;
        this._repaint();
      });
  }

  _repaint() {
    const e = this._els;
    if (e && e.chartEls) e.chartEls.forEach((h) => this._paintChart(h));
  }

  _makeIcon(icon) {
    if (customElements.get("ha-icon")) {
      const el = document.createElement("ha-icon");
      el.setAttribute("icon", icon);
      el.className = "icon";
      el._haIcon = true;
      return el;
    }
    const span = document.createElement("span");
    span.className = "icon";
    span._icon = icon;
    return span;
  }

  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = AIR_STYLES;
    root.appendChild(style);

    const card = document.createElement("ha-card");
    root.appendChild(card);

    this._els = {};
    if (this._config.show_header) {
      const header = document.createElement("div");
      header.className = "header";
      const title = document.createElement("div");
      title.className = "title";
      header.appendChild(title);
      card.appendChild(header);
      this._els.header = header;
      this._els.title = title;
    }

    const body = document.createElement("div");
    body.className = this._config.show_header ? "body tight" : "body";
    card.appendChild(body);

    const error = document.createElement("div");
    error.className = "error";
    error.style.display = "none";
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.style.display = "none";
    body.append(error, empty);

    const verdict = document.createElement("div");
    verdict.className = "verdict";
    const dot = document.createElement("div");
    dot.className = "dot";
    const vmain = document.createElement("div");
    vmain.className = "verdict-main";
    const verdictWord = document.createElement("div");
    verdictWord.className = "verdict-word";
    const verdictWhy = document.createElement("div");
    verdictWhy.className = "verdict-why";
    vmain.append(verdictWord, verdictWhy);
    verdict.append(dot, vmain);
    body.appendChild(verdict);

    const charts = document.createElement("div");
    charts.className = this._config.show_chart_background ? "charts" : "charts flat";
    body.appendChild(charts);

    Object.assign(this._els, {
      error, empty, verdict, verdictWord, verdictWhy, charts, chartEls: null,
    });
    this._built = true;
  }
}

/** Groups the metrics that were found into the charts that can be drawn. */
function airChartsFor(metrics) {
  const byKey = new Map(metrics.map((m) => [m.key, m]));
  const claimed = new Set();
  const out = [];
  for (const spec of AIR_CHARTS) {
    const series = spec.metrics.map((k) => byKey.get(k)).filter(Boolean);
    if (!series.length) continue;
    series.forEach((s) => claimed.add(s.key));
    out.push({
      ...spec,
      series,
      title: spec.title || series[0].label,
      icon: spec.icon || series[0].icon,
    });
  }
  // A sensor no chart asked for still deserves to be drawn.
  for (const m of metrics) {
    if (claimed.has(m.key)) continue;
    out.push({
      key: m.key, metrics: [m.key], series: [m], width: "half",
      line_width: 2, title: m.label, icon: m.icon,
    });
  }
  return out;
}

/* -------------------------------------------------- wabit-air-card-editor */

const AIR_LABELS = {
  area: "Room",
  entities: "Specific sensors (leave empty to use the room)",
  title: "Card title (defaults to the room name)",
  hours: "Hours of history on each graph",
  points_per_hour: "Points per hour",
  show_verdict: "Show the overall verdict",
  show_graphs: "Show the graphs",
  show_legend: "Show the legend on shared graphs",
  show_labels: "Show the axis range",
  show_extrema: "Mark the highest and lowest points",
  show_chart_background: "Draw a panel behind each graph",
  show_header: "Show the header",
};

const AIR_SCHEMA = [
  { name: "area", selector: { area: {} } },
  { name: "entities", selector: { entity: { domain: "sensor", multiple: true } } },
  { name: "title", selector: { text: {} } },
  { name: "hours", selector: { number: { min: 1, max: 168, mode: "box" } } },
  { name: "points_per_hour", selector: { number: { min: 1, max: 60, mode: "box" } } },
  { name: "show_verdict", selector: { boolean: {} } },
  { name: "show_graphs", selector: { boolean: {} } },
  { name: "show_legend", selector: { boolean: {} } },
  { name: "show_labels", selector: { boolean: {} } },
  { name: "show_extrema", selector: { boolean: {} } },
  { name: "show_chart_background", selector: { boolean: {} } },
  { name: "show_header", selector: { boolean: {} } },
];

class WabitAirCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...(config || {}) };
    if (!this._built) this._build();
    this._push();
  }

  set hass(hass) {
    this._hass = hass;
    this._push();
  }

  get hass() {
    return this._hass;
  }

  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = EDITOR_STYLES;
    root.appendChild(style);

    if (!customElements.get("ha-form")) {
      const note = document.createElement("div");
      note.className = "note";
      note.textContent =
        "This Home Assistant build does not provide ha-form, so the visual editor " +
        "is unavailable. Configure this card in YAML instead - the options are " +
        "documented at " + REPO;
      root.appendChild(note);
      this._form = null;
      this._built = true;
      return;
    }

    const form = document.createElement("ha-form");
    form.schema = AIR_SCHEMA;
    form.computeLabel = (s) => AIR_LABELS[s.name] || s.name;
    form.addEventListener("value-changed", (ev) => {
      ev.stopPropagation();
      this._config = { ...this._config, ...ev.detail.value };
      fireEvent(this, "config-changed", { config: this._config });
    });
    root.appendChild(form);
    this._form = form;
    this._built = true;
  }

  _push() {
    if (!this._form || !this._hass || !this._config) return;
    this._form.hass = this._hass;
    const data = {
      area: this._config.area,
      entities: this._config.entities,
      title: this._config.title,
      hours: this._config.hours === undefined ? 12 : this._config.hours,
      points_per_hour:
        this._config.points_per_hour === undefined ? 6 : this._config.points_per_hour,
      show_verdict: this._config.show_verdict !== false,
      // `show_sparklines` was the option name in 1.16.0.
      show_graphs:
        this._config.show_graphs !== false && this._config.show_sparklines !== false,
      show_legend: this._config.show_legend !== false,
      show_labels: this._config.show_labels !== false,
      show_extrema: this._config.show_extrema !== false,
      show_chart_background: this._config.show_chart_background !== false,
      show_header: this._config.show_header !== false,
    };
    if (JSON.stringify(this._form.data) !== JSON.stringify(data)) this._form.data = data;
  }
}

if (!customElements.get("wabit-air-card")) {
  customElements.define("wabit-air-card", WabitAirCard);
}
if (!customElements.get("wabit-air-card-editor")) {
  customElements.define("wabit-air-card-editor", WabitAirCardEditor);
}

if (!window.customCards.some((c) => c.type === "wabit-air-card")) {
  window.customCards.push({
    type: "wabit-air-card",
    name: "Wabit Air",
    description:
      "Air quality for a room: one verdict, every reading, and the trend behind " +
      "each - in place of a stack of graphs.",
    preview: true,
    documentationURL: REPO,
  });
}
