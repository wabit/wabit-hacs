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

const VERSION = "1.6.0";
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
    this._push();
  }

  set hass(hass) {
    this._hass = hass;
    this._renderPins();
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
        this._renderPins(); // the area may have changed, so the picker must follow
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
    this._els = { list, add };
    this._built = true;
  }

  _renderPins() {
    if (!this._built || !this._els || !this._hass) return;
    const { list, add } = this._els;
    list.innerHTML = "";

    const pins = this._pins();
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
      name.textContent = this._labelFor(id);
      if (!this._hass.states[id]) {
        name.className = "pin-name missing";
        name.textContent = `${id} (not found)`;
      }

      const mkBtn = (glyph, label, disabled, fn, danger) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = danger ? "pin-btn danger" : "pin-btn";
        b.textContent = glyph;
        b.title = label;
        b.setAttribute("aria-label", `${label}: ${this._labelFor(id)}`);
        b.disabled = !!disabled;
        b.addEventListener("click", fn);
        return b;
      };

      row.append(
        name,
        mkBtn("↑", "Move up", i === 0, () => this._move(i, -1)),
        mkBtn("↓", "Move down", i === pins.length - 1, () => this._move(i, 1)),
        mkBtn("✕", "Remove", false, () => this._removePin(i), true)
      );
      list.appendChild(row);
    });

    // The "add" control is rebuilt alongside, since the candidate list depends
    // on the chosen area and on what is already pinned.
    add.innerHTML = "";
    const candidates = this._areaLights()
      .filter((id) => !pins.includes(id))
      .sort((a, b) => this._labelFor(a).localeCompare(this._labelFor(b)));

    if (customElements.get("ha-entity-picker")) {
      const picker = document.createElement("ha-entity-picker");
      picker.hass = this._hass;
      picker.includeDomains = ["light"];
      if (candidates.length) picker.includeEntities = candidates;
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
    } else {
      const sel = document.createElement("select");
      sel.className = "add-pin";
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = candidates.length ? "Add a light…" : "No more lights in this room";
      sel.appendChild(blank);
      candidates.forEach((id) => {
        const o = document.createElement("option");
        o.value = id;
        o.textContent = this._labelFor(id);
        sel.appendChild(o);
      });
      sel.disabled = !candidates.length;
      sel.addEventListener("change", () => {
        const v = sel.value;
        sel.value = "";
        this._addPin(v);
      });
      add.appendChild(sel);
    }
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
      title: cfg.title === undefined ? "Bin Collection" : cfg.title,
      bins,
      show_hero: cfg.show_hero !== false,
      // `glass` and `glassOpacity` from the previous card are accepted and ignored,
      // so an existing config keeps working after switching card type.
    };

    this._built = false;
    this._rowsKey = null;
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
};

const BIN_SCHEMA = [
  { name: "entities", selector: { entity: { domain: "sensor", multiple: true } } },
  { name: "entity", selector: { entity: { domain: "sensor" } } },
  { name: "title", selector: { text: {} } },
  { name: "show_hero", selector: { boolean: {} } },
  { name: "strip_prefix", selector: { boolean: {} } },
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
