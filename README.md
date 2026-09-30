# Wabit Cards

Custom [Home Assistant](https://www.home-assistant.io) dashboard cards, installable through
[HACS](https://hacs.xyz). One bundle, so new cards land here rather than in a new repository
each time.

| Card | What it does |
| --- | --- |
| `wabit-wakeup-card` | Control a sunrise-style wake-up light: set the time per schedule, toggle each schedule on or off, and drag a shared fade length — with a live sunrise ramp while it runs. |

Every colour comes from a theme token (`--md-sys-color-*` first, then the standard Home
Assistant variables), so the cards inherit whatever theme the dashboard uses — including
Material You — instead of imposing their own palette.

## Install

1. In Home Assistant go to **HACS → ⋮ (top right) → Custom repositories**.
2. Add `https://github.com/wabit/wabit-hacs` with category **Dashboard**.
3. Find **Wabit Cards** in the HACS list and click **Download**.
4. Reload your browser (a hard refresh, or restart Home Assistant).

HACS registers the dashboard resource for you. If you need to add it by hand it is:

```yaml
url: /hacsfiles/wabit-hacs/wabit-cards.js
type: module
```

Then add the card from the dashboard card picker ("Wabit Wakeup"), or paste YAML.

## `wabit-wakeup-card`

```yaml
type: custom:wabit-wakeup-card
title: Bedroom Wakeup
fade_entity: input_number.bedroom_wakeup_fade
schedules:
  - name: Weekday
    time: input_datetime.bedroom_weekday_wakeup_time
    automation: automation.bedroom_weekday_wakeup
    days: [mon, tue, wed, thu, fri]
  - name: Weekend
    time: input_datetime.bedroom_weekend_wakeup_time
    automation: automation.bedroom_weekend_wakeup
    days: [sat, sun]
```

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | string | **required** | `custom:wabit-wakeup-card` |
| `schedules` | list | **required** | One entry per schedule. At least one is required. |
| `title` | string | `Wakeup` | Card header. Set to `""` for no header. |
| `fade_entity` | entity | – | An `input_number` holding the fade length **in minutes**. Omit it to hide the fade row. |
| `fade_mode` | `start` \| `finish` | `start` | Whether each schedule's time is when the fade *starts* or when the light is *fully on*. See below. |
| `show_hero` | boolean | `true` | The large next-wakeup panel at the top. |
| `show_ramp` | boolean | `true` | The sunrise gradient bar. |
| `icon` | icon | `mdi:weather-sunset-up` | Default icon for schedule rows. |

### Schedule options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `time` | entity | **required** | An `input_datetime` with `has_time: true`. Edited straight from the card. |
| `name` | string | – | Row label, e.g. `Weekday`. |
| `automation` | entity | – | An `automation` to enable/disable with the row's toggle. Without it the row has no toggle. |
| `days` | list | – | Days this schedule runs, e.g. `[mon, tue]`. Accepts `mon` or `monday`. |
| `icon` | icon | – | Overrides the card-level `icon`. |

### `days` and the countdown

`days` is what unlocks the **"Next wakeup — in 8h 20m"** countdown and the day chips, and it
has to be given explicitly: the card can read your automation's on/off state, but it cannot
see the weekday condition inside it. Rather than guess and promise a wake-up that never
fires, the countdown stays hidden until every schedule declares its days. Keep them in step
with the conditions in your automations.

### `fade_mode`

A wake-up light fades up over several minutes, so "07:00" is ambiguous. `fade_mode` says
which end of that fade the time refers to:

- **`start`** (default) — the fade begins at the time shown. With a 5 minute fade, 06:55 means
  full brightness at 07:00. Lengthening the fade pushes the bright moment later.
- **`finish`** — the light is fully on at the time shown, and the fade starts earlier.
  Lengthening the fade makes it start earlier and leaves your wake-up moment where it is.

This only changes what the card *displays* and computes. Your automation still triggers on the
`input_datetime`, so pick the mode that matches how the automation is written.

## The Home Assistant side

The card edits helpers; it does not create them. A matching setup looks like this.

`configuration.yaml`:

```yaml
input_datetime: !include input_datetime.yaml
input_number: !include input_number.yaml
```

`input_datetime.yaml`:

```yaml
bedroom_weekday_wakeup_time:
  name: Bedroom Weekday Wakeup Time
  has_date: false
  has_time: true
  icon: mdi:weather-sunset-up
```

`input_number.yaml`:

```yaml
bedroom_wakeup_fade:
  name: Bedroom Wakeup Fade
  min: 1
  max: 60
  step: 1
  unit_of_measurement: min
  icon: mdi:timer-sand
```

> **Do not set `initial:` on these helpers.** With `initial:` present Home Assistant resets the
> helper to that value on every restart, silently throwing away the time you chose on the
> dashboard. Leaving it out makes Home Assistant restore the last value instead.

And the automation, taking both its time and its fade length from the helpers:

```yaml
- id: bedroom_weekday_wakeup
  alias: Bedroom - Weekday wakeup
  triggers:
    - trigger: time
      at: input_datetime.bedroom_weekday_wakeup_time
  conditions:
    - condition: time
      weekday: [mon, tue, wed, thu, fri]
  actions:
    - action: light.turn_on
      target:
        entity_id: light.bedroom_ceiling_light
      data:
        transition: >-
          {{ (states('input_number.bedroom_wakeup_fade') | float(5) * 60) | round(0) | int }}
  mode: single
```

Long fades lean on the light's own transition handling. Most Zigbee and Hue bulbs are fine up
to about 30 minutes; if a long fade looks steppy or stalls, drive the brightness in a `repeat`
loop instead and keep the card pointed at the same helpers.

## Development

No build step and no dependencies: `dist/wabit-cards.js` is the shipped file, so what you read
is what the browser loads.

```bash
node --check dist/wabit-cards.js   # parses
node test/card.test.mjs            # stubs a DOM and drives the real render paths
```

Releases are cut by pushing a tag (`v1.0.0`), which runs the tests and attaches the card to a
GitHub release for HACS to pick up.

## Licence

[MIT](LICENSE)
