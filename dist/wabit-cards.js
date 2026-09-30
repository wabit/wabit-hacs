/**
 * Wabit Cards - a small suite of Home Assistant dashboard cards.
 * https://github.com/wabit/wabit-hacs
 *
 * Zero dependencies and no build step: this file is the shipped artifact, so
 * what you read here is exactly what the browser loads.
 *
 * Every colour comes from a theme token (Material You `--md-sys-color-*` first,
 * then the standard Home Assistant variables), so the card inherits whatever
 * theme the dashboard is using instead of imposing its own palette.
 */

const VERSION = "1.0.1";
const REPO = "https://github.com/wabit/wabit-hacs";

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

    this._config = {
      title: cfg.title === undefined ? "Wakeup" : cfg.title,
      fade_entity: isUnset(cfg.fade_entity) ? null : cfg.fade_entity,
      fade_mode: cfg.fade_mode === "finish" ? "finish" : "start",
      show_hero: cfg.show_hero !== false,
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
    return (
      (this._config.show_hero ? 2 : 0) +
      this._config.schedules.length +
      (this._config.fade_entity ? 1 : 0)
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

  _build() {
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const root = this.shadowRoot;
    root.innerHTML = "";

    const style = document.createElement("style");
    style.textContent = STYLES;
    root.appendChild(style);

    const card = document.createElement("ha-card");
    if (this._config.title) card.setAttribute("header", this._config.title);
    root.appendChild(card);

    const body = document.createElement("div");
    body.className = this._config.title ? "body tight" : "body";
    card.appendChild(body);

    this._els = { hero: null, rows: [], fade: null };

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
      body.appendChild(row);
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
  fade_mode: "What the time means",
  show_hero: "Show the big next-wakeup panel",
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
      fade_mode: this._config.fade_mode === "finish" ? "finish" : "start",
      show_hero: this._config.show_hero !== false,
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
      "Wake-up light schedule: per-schedule time and enable toggle, a shared fade " +
      "slider, and a live sunrise ramp.",
    preview: true,
    documentationURL: REPO,
  });
}
