# Wabit Cards

Custom [Home Assistant](https://www.home-assistant.io) dashboard cards, installable through
[HACS](https://hacs.xyz). One bundle, so new cards land here rather than in a new repository
each time.

| Card | What it does |
| --- | --- |
| `wabit-media-card` | What is playing in a room, across speakers, TVs and streamers, with the active one brought to the front. |
| `wabit-bin-collection-card` | Upcoming bin collections, grouped by day so bins that go out together read as one collection. |
| `wabit-room-lights-card` | Every light in a room, found automatically from its area: pin the ones you use, tuck the rest behind "Show more", with brightness and colour per light. |
| `wabit-wakeup-card` | Control a sunrise-style wake-up light: set the time per schedule, toggle each schedule on or off, choose which light wakes you, and drag a shared fade length — with a live sunrise ramp while it runs. Set-once options tuck behind a settings button. |

![The wakeup card in light and dark Material You themes](https://raw.githubusercontent.com/wabit/wabit-hacs-dashboard/main/docs/preview.png)

Every colour comes from a theme token (`--md-sys-color-*` first, then the standard Home
Assistant variables), so the cards inherit whatever theme the dashboard uses — including
Material You — instead of imposing their own palette.

## Install

1. In Home Assistant go to **HACS → ⋮ (top right) → Custom repositories**.
2. Add `https://github.com/wabit/wabit-hacs-dashboard` with category **Dashboard**.
3. Find **Wabit Cards** in the HACS list and click **Download**.
4. Reload your browser (a hard refresh, or restart Home Assistant).

HACS registers the dashboard resource for you. If you need to add it by hand it is:

```yaml
url: /hacsfiles/wabit-hacs-dashboard/wabit-cards.js
type: module
```

Then add the card from the dashboard card picker ("Wabit Wakeup"), or paste YAML.

## `wabit-media-card`

![Media card, music and television](https://raw.githubusercontent.com/wabit/wabit-hacs-dashboard/main/docs/preview-media.png)

```yaml
type: custom:wabit-media-card
area: living_room
```

Point it at a room and it finds the media players there — speakers, TVs, streamers —
and brings whatever is actually playing to the front, with artwork, progress, transport
controls and volume. Everything else in the room is listed underneath; tap one to take
it over.

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | string | **required** | `custom:wabit-media-card` |
| `area` | string | **required*** | Area id, name or alias. *Not required if `entities` is given. |
| `entities` | list | – | Specific players, skipping discovery entirely. |
| `exclude` | list | – | Players in the room to leave out. |
| `exclude_platforms` | list | `[sonos_cloud, unifiprotect]` | Integrations to ignore. See below. |
| `title` | string | the room name | Card header. |
| `idle_text` | string | `Nothing playing` | Shown when nothing in the room is active. |
| `show_volume` | boolean | `true` | Volume slider and mute. |
| `show_progress` | boolean | `true` | Progress bar and times. |
| `show_others` | boolean | `true` | The room's other players underneath. |
| `show_header` | boolean | `true` | The room name. |
| `presets` | list | – | One-tap shortcuts under the player. See below. |
| `artwork` | `cover` \| `tile` \| `none` | `cover` | How prominent the artwork is. See below. |
| `art_backdrop` | boolean | `true` | In `tile` mode only, wash the panel in the artwork's colours. |

### One speaker, several integrations

A room usually holds fewer devices than it holds `media_player` entities. A single Sonos
can appear three times — once from the Sonos integration, again from `sonos_cloud`, and
again through SmartThings — and a Plex client adds another entity per app.

Two things keep that under control. `sonos_cloud` and `unifiprotect` are ignored by
default, because neither ever reports what is playing: the first exists only to send
announcements, the second is a camera intercom. More importantly, the card features
whatever is **active**, and the duplicates are invariably idle, so they fall to the
bottom of the list on their own rather than needing to be hunted down. Add anything that
still gets in the way to `exclude`.

### Artwork

```yaml
artwork: cover   # the default
```

- **`cover`** — the artwork *is* the panel. It bleeds to the card edges with the title,
  progress and controls laid over it, behind a scrim that keeps text readable over any
  image. The same idea as Home Assistant's own media control card.
- **`tile`** — a thumbnail beside the text, with the artwork repeated behind the panel
  blurred and dimmed so the card picks up the album's colours. `art_backdrop: false`
  drops that wash.
- **`none`** — no artwork at all.

`cover` needs an image to cover with, so a player reporting no artwork falls back to the
tile layout rather than showing an empty panel.

### Presets

A row of one-tap shortcuts under the player — a radio station, a scene, anything worth a
button:

```yaml
presets:
  - name: 6 Music
    image: /local/6-music.png
    entity: automation.living_room_play_6_music
  - name: Def Con Radio
    image: /local/defcon-radio.png
    entity: automation.living_room_play_def_con_radio
```

`entity` can be an `automation` (triggered), a `script` or a `scene` (turned on). For
anything else, give a `service` instead with optional `data` and `target`:

```yaml
  - name: Groove Salad
    icon: mdi:radio
    service: media_player.play_media
    target: { entity_id: media_player.fireplace }
    data:
      media_content_type: favorite_item_id
      media_content_id: "FV:2/31"
```

`image` is optional; without one the preset shows `icon`, defaulting to `mdi:radio`.

The preset matching what is playing is highlighted. By default the card looks for the
preset's `name` in the current title or subtitle, so "6 Music" lights up while "Radio 6
Music" is on — including when it is paused, since the station is still the loaded one.
Set `match` to look for something else, or `match: null` to never highlight it.

### What gets featured

A room normally has one thing playing, so the card follows it. Players are ranked —
playing, then paused, then on-with-media, on, idle, off, and finally unavailable — and
ties go to whichever changed most recently. Two things playing at once is rare and
usually means a handover is in progress; the newer one wins, and the other stays visible
in the list, marked as playing.

Tapping a player in the list takes you to it, and that choice holds while the room
carries on as it was. As soon as playback changes hands — something starts, or the
current one stops — the card goes back to following the room. So picking the telly to
check on it does not leave you stuck there once music starts.

Transport buttons follow each player's own `supported_features`, so a streamer that
cannot skip tracks shows those buttons greyed rather than pretending. Progress is
recomputed from `media_position` and the timestamp Home Assistant reports it against, so
the bar keeps moving between state updates instead of jumping.

## `wabit-bin-collection-card`

![Bin collection card, light and dark](https://raw.githubusercontent.com/wabit/wabit-hacs-dashboard/main/docs/preview-bins.png)

```yaml
type: custom:wabit-bin-collection-card
```

That is the whole config. With the
[UK Bin Collection Data](https://github.com/robbrad/UKBinCollectionData) integration
installed, the card finds your bin sensors itself — that integration stamps each one with
`device_class: bin_collection_schedule`, and every bin brings its own name, colour and
icon, so there is nothing to wire up.

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | string | **required** | `custom:wabit-bin-collection-card` |
| `entities` | list | – | Specific bin sensors to show. Omit it and they are discovered. |
| `overrides` | map | – | Per-sensor `{ label, color, icon }` tweaks, keyed by entity id. |
| `strip_prefix` | boolean | `true` | Trim the prefix shared by every bin's name. |
| `strip_size` | boolean | `true` | Trim a leading size, so "240L green garden bin" shows as "green garden bin". |
| `label_case` | `sentence` \| `title` \| `none` | `sentence` | How the tidied name is capitalised. |
| `title` | string | `Bin Collection` | Card header. Set to `""` for no header. |
| `show_hero` | boolean | `true` | The large next-collection panel. With it off, every collection becomes a row. |
| `entity` | entity | – | **Older setups only.** One sensor carrying an object per bin. See below. |
| `bins` | map | the four below | Labels and colours for `entity` mode only. |

### Tidying the names

The integration names a bin after whatever the council calls it, which is usually more
than you want on a card. Three steps run in order, each of which can be turned off:

```
Bins 240L green garden bin     as the sensor reports it
     240L green garden bin     strip_prefix - drops the prefix shared by every bin
          green garden bin     strip_size   - drops a leading 240L / 240 litre
          Green garden bin     label_case   - sentence (default), title, or none
```

`label_case: title` gives "Green Garden Bin" instead. An explicit `overrides` label is
used exactly as written and skips all three.

### Renaming or recolouring a bin

Discovered bins use the integration's own name, colour and icon. To change one, key an
override by its entity id — anything you leave out keeps what the sensor reported:

```yaml
overrides:
  sensor.bins_140l_grey_rubbish_bin:
    label: Rubbish
    color: "#55595d"
```

### Older single-sensor setups

If your dates come from one sensor carrying an object per bin — a `date` of `DD/MM/YYYY`
and optionally a `relative_time` — point `entity` at it instead. Discovery is then skipped
and the `bins` map supplies the labels and colours:

```yaml
entity: sensor.bin_collection
bins:
  green:    { label: Garden,        color: "#3fa34d" }
  grey:     { label: General Waste, color: "#7a7f85" }
  beige:    { label: Recycling,     color: "#d9b56b" }
  burgundy: { label: Food Waste,    color: "#7c2740" }
```

A bin given only a `label` keeps its default colour, and vice versa. Only the keys you
list are shown, so trimming the map is how you hide a bin you do not have.

### Grouped by day, not by bin

Bins that go out on the same date are one collection, not two rows — the card groups them
and shows both as chips under a single date. With a fortnightly garden bin and a weekly
food bin that coincide, that is the difference between reading "Wed 7 Oct: Garden + Food
Waste" and scanning four rows for matching dates.

The countdown is computed from each collection date rather than taken from the feed's own
wording, so it stays correct on a dashboard left open overnight and cannot drift from the
date shown beside it. If the feed's wording disagrees, the date is what the card trusts. A
bin whose date will not parse still appears, falling back to the integration's own day
count and the sensor's text, sorted last.

Today and tomorrow get a solid chip instead of a tonal one, so an imminent collection
reads differently at a glance. Dates are formatted in Home Assistant's own language
(`hass.locale`), not the browser's, so the card reads the same as the rest of HA.

## `wabit-room-lights-card`

![Room lights card, pinned and expanded](https://raw.githubusercontent.com/wabit/wabit-hacs-dashboard/main/docs/preview-room.png)

Point it at a room and it finds that room's lights itself — no entity list to maintain.

```yaml
type: custom:wabit-room-lights-card
area: living_room
pinned:
  - light.living_room_ceiling
  - light.living_room_accent
```

Each light gets a tap-to-toggle button tinted with its current colour, a brightness
slider, and a colour control. Anything not in `pinned` moves behind a **Show N more**
button, so a room with twenty spots still reads as a short card.

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | string | **required** | `custom:wabit-room-lights-card` |
| `area` | string | **required** | Area id, name or alias — `living_room`, `Living Room` and `lounge` all work. |
| `title` | string | the room name | Card header. |
| `pinned` | list | – | Lights that are always visible, **in this order**. Everything else goes behind the expander. Omit it and every light shows. |
| `exclude` | list | – | Lights to leave out entirely. |
| `collapse_groups` | boolean | `false` | When nothing is pinned, treat members of a group light as the hidden ones. See below. |
| `show_brightness` | boolean | `true` | Per-light brightness sliders. |
| `show_colour` | boolean | `true` | Per-light colour controls (`show_color` also accepted). |
| `show_header` | boolean | `true` | Room name, on-count and the room-wide toggle. |
| `strip_area_name` | boolean | `true` | Trim the room name off each label, so "Living Room - Ceiling All" shows as "Ceiling All". |

### Ordering the pinned lights

`pinned` is an ordered list — the card shows those lights top to bottom exactly as you
write them, so reordering in YAML is just moving the lines.

In the visual editor the "Always visible" section lists them with ↑ / ↓ / ✕ controls, so
you can reorder and remove without retyping anything. The picker underneath offers the
room's other lights, sorted by name, minus whatever is already pinned. Clearing the list
removes the `pinned` key entirely, which means "show everything" again.

Lights behind the expander are always sorted by name; the ordering control is for the
ones you actually see.

### What counts as a light in the room

An entity can be placed in an area directly, but usually inherits it from its device, so
both are checked. Entities Home Assistant marks as **config or diagnostic** are skipped —
that is what keeps access-point status LEDs and presence-sensor LEDs, which are `light`
entities as far as HA is concerned, out of your living room. Hidden and disabled entities
are skipped too.

### `collapse_groups`

Zigbee2MQTT group lights report their members in a `group_entities` attribute. With
`collapse_groups: true` and no `pinned` list, any light that is a member of another light
in the same room moves behind "Show more" — so a ceiling group stays visible while its
thirteen individual spots tuck away. It never hides everything: if every light turns out
to be a group member, they all stay visible.

### Controls

Brightness and colour adapt to what each bulb reports in `supported_color_modes`:

- an `onoff` light gets no slider and no colour button, just On/Off
- a `color_temp` light gets a warm-to-cool white slider over its own kelvin range
- an `hs`/`xy`/`rgb` light gets hue and saturation sliders
- a light supporting both gets all three, plus preset swatches

A light that is `unavailable` or `unknown` is shown as such and its controls are disabled,
rather than being drawn as a plain "Off" with a toggle that would do nothing.

The room-wide button in the header turns everything off if anything is on, otherwise turns
everything on. It targets exactly the lights the card is showing, not the whole area, so
the entities you excluded stay excluded.

## `wabit-wakeup-card`

```yaml
type: custom:wabit-wakeup-card
title: Bedroom Wakeup
light_entity: input_text.bedroom_wakeup_light
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
| `light_entity` | entity | – | An `input_text` or `input_select` holding the **entity id of the light** to wake you. Omit it to hide the light row. See below. |
| `fade_mode` | `start` \| `finish` | `start` | Whether each schedule's time is when the fade *starts* or when the light is *fully on*. See below. |
| `show_hero` | boolean | `true` | The large next-wakeup panel at the top. |
| `show_settings` | boolean | `true` | Tuck the light and fade rows behind a settings button in the header. Set `false` to show them inline. |
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

### The settings button

The light and the fade length are things you set once; the times and the on/off toggles are
what you touch day to day. So by default the first two collapse behind a gear in the card
header, leaving the resting card as just the next-wakeup panel and the schedule rows.

Tap the gear to expand them. `show_settings: false` puts them back inline permanently, and
the gear disappears on its own if neither `light_entity` nor `fade_entity` is configured,
since there would be nothing behind it.

### Choosing the light

`light_entity` does not point at a light. It points at an `input_text` (or `input_select`)
whose *value* is a light's entity id, and the card renders a light picker that writes to it.
That indirection is what makes the choice live: your automation reads the same helper, so
picking a different light on the dashboard changes what actually turns on, with no YAML edit.

The card will not let you clear the helper, because an empty value would quietly send the
automation to its fallback light.

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

`input_text.yaml`:

```yaml
bedroom_wakeup_light:
  name: Bedroom Wakeup Light
  max: 255
  mode: text
  icon: mdi:lightbulb-on-outline
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
        entity_id: >-
          {% set e = states('input_text.bedroom_wakeup_light') %}
          {{ e if e.startswith('light.') else 'light.bedroom_ceiling_light' }}
      data:
        transition: >-
          {{ (states('input_number.bedroom_wakeup_fade') | float(5) * 60) | round(0) | int }}
  mode: single
```

`target.entity_id` is templated, so the automation picks up whatever light the helper holds
at the moment it fires. The `else` branch matters: if the helper is ever empty or holds
something that is not a light, the automation still turns *a* light on rather than erroring
out. For an alarm, falling back beats failing silently — pick a sensible default there.

Long fades lean on the light's own transition handling. Most Zigbee and Hue bulbs are fine up
to about 30 minutes; if a long fade looks steppy or stalls, drive the brightness in a `repeat`
loop instead and keep the card pointed at the same helpers.

## Development

No build step and no dependencies: `dist/wabit-cards.js` is the shipped file, so what you read
is what the browser loads.

```bash
node --check dist/wabit-cards.js   # parses
node test/card.test.mjs            # wakeup card
node test/room-card.test.mjs       # room lights card
node test/bin-card.test.mjs        # bin collection card
node test/media-card.test.mjs      # media card
```

Both suites share `test/dom-stub.mjs`, which stubs just enough of the DOM to load the
bundle in node and drive the real render paths.

The `test/preview-*.html` pages render the cards outside Home Assistant, with stand-ins for
`ha-card` / `ha-icon` / `ha-switch` and Material You tokens, on a pinned clock so the
states stay stable. It is what `docs/preview.png` is captured from - open it in a browser,
or screenshot it headlessly:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --force-device-scale-factor=2 --window-size=912,517 \
  --screenshot=docs/preview.png test/preview.html
```

Releases are cut by pushing a tag (`v1.0.0`), which runs the tests and attaches the card to a
GitHub release for HACS to pick up.

## Licence

[MIT](LICENSE)
