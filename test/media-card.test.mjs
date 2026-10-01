/**
 * Tests for wabit-media-card.
 *
 *   node test/media-card.test.mjs
 */
import { loadCards, harness } from "./dom-stub.mjs";

const T = loadCards(process.argv[2]);
const { eq, throws, done } = harness();

const RealDate = Date;
const NOW = new RealDate(2026, 9, 1, 13, 0, 0);
globalThis.Date = class extends RealDate {
  constructor(...a) { return a.length ? new RealDate(...a) : new RealDate(NOW); }
  static now() { return NOW.getTime(); }
};

/* --------------------------------------------------------------- fixture */
const calls = [];
const SONOS_FEATURES = 8321599;          // everything a Sonos offers
const LIMITED = 1 | 16384;               // play + pause only

const iso = (secondsAgo) => new RealDate(NOW.getTime() - secondsAgo * 1000).toISOString();
const mp = (name, state, attrs, secondsAgo) => ({
  state,
  last_changed: iso(secondsAgo === undefined ? 600 : secondsAgo),
  attributes: { friendly_name: name, supported_features: SONOS_FEATURES, ...attrs },
});

const hass = {
  themes: { darkMode: false },
  areas: {
    living_room: { area_id: "living_room", name: "Living Room", aliases: ["lounge"] },
    office: { area_id: "office", name: "Office", aliases: [] },
    hallway: { area_id: "hallway", name: "Hallway", aliases: [] },
  },
  devices: {
    d_fire: { area_id: "living_room" },
    d_fire_cloud: { area_id: "living_room" },
    d_atv: { area_id: "living_room" },
    d_tv: { area_id: "living_room" },
    d_cam: { area_id: "living_room" },
    d_desk: { area_id: "office" },
    d_office_atv: { area_id: "office" },
  },
  entities: {
    "media_player.fireplace": { entity_id: "media_player.fireplace", device_id: "d_fire", platform: "sonos" },
    // the same speaker again, announcements only - must be filtered by default
    "media_player.fireplace_2": { entity_id: "media_player.fireplace_2", device_id: "d_fire_cloud", platform: "sonos_cloud" },
    "media_player.living_room_apple_tv": { entity_id: "media_player.living_room_apple_tv", device_id: "d_atv", platform: "apple_tv" },
    "media_player.living_room_tv": { entity_id: "media_player.living_room_tv", device_id: "d_tv", platform: "samsungtv" },
    "media_player.living_room_camera_speaker": { entity_id: "media_player.living_room_camera_speaker", device_id: "d_cam", platform: "unifiprotect" },
    "media_player.hidden_one": { entity_id: "media_player.hidden_one", device_id: "d_fire", platform: "sonos", hidden: true },
    "media_player.diag": { entity_id: "media_player.diag", device_id: "d_fire", platform: "sonos", entity_category: "diagnostic" },
    "media_player.no_state": { entity_id: "media_player.no_state", device_id: "d_fire", platform: "sonos" },
    "media_player.office_desk": { entity_id: "media_player.office_desk", device_id: "d_desk", platform: "sonos" },
    "media_player.office_atv": { entity_id: "media_player.office_atv", device_id: "d_office_atv", platform: "apple_tv" },
    "light.not_a_player": { entity_id: "light.not_a_player", device_id: "d_fire", platform: "sonos" },
  },
  states: {
    "media_player.fireplace": mp("Fireplace - (Sonos)", "paused", {
      media_title: "Radio 6 Music", media_channel: "BBC Radio 6",
      volume_level: 0.21, is_volume_muted: false,
      entity_picture: "/api/media_player_proxy/fireplace?token=abc",
    }),
    "media_player.fireplace_2": mp("Fireplace", "idle", {}),
    "media_player.living_room_apple_tv": mp("Living room - Apple TV", "off", {}),
    "media_player.living_room_tv": mp("Living room tv", "off", {}),
    "media_player.living_room_camera_speaker": mp("Camera Speaker", "idle", {}),
    "media_player.hidden_one": mp("Hidden", "playing", {}),
    "media_player.diag": mp("Diag", "playing", {}),
    "media_player.office_desk": mp("Josh's Desk - (Sonos)", "playing", {
      media_title: "Teardrop", media_artist: "Massive Attack", media_album_name: "Mezzanine",
      media_duration: 330, media_position: 60,
      media_position_updated_at: iso(30),
      volume_level: 0.5, is_volume_muted: false,
    }, 30),
    "media_player.tv_dc": mp("Telly", "off", { device_class: "tv" }),
    "media_player.office_atv": mp("Office - (Apple TV)", "playing", {
      media_title: "The One Where It Begins", media_series_title: "Friends",
      media_season: 1, media_episode: 2, app_name: "Netflix",
      supported_features: LIMITED,
    }, 900),
  },
  callService: (d, s, data, target) => calls.push([d, s, data, target]),
};

const mk = (cfg) => {
  const c = new T.WabitMediaCard();
  c.setConfig(cfg);
  c.hass = hass;
  return c;
};

/* ------------------------------------------------------------- discovery */
eq("finds the room's players, filtering noise",
   T.mediaPlayersInArea(hass, "living_room", T.MEDIA_NOISE_PLATFORMS),
   ["media_player.fireplace", "media_player.living_room_apple_tv",
    "media_player.living_room_tv"]);
eq("without the deny list the twins come back",
   T.mediaPlayersInArea(hass, "living_room", []).includes("media_player.fireplace_2"), true);
eq("default deny list", T.MEDIA_NOISE_PLATFORMS, ["sonos_cloud", "unifiprotect"]);
eq("other areas unaffected", T.mediaPlayersInArea(hass, "office", T.MEDIA_NOISE_PLATFORMS),
   ["media_player.office_atv", "media_player.office_desk"]);
eq("discovery order is stable",
   T.mediaPlayersInArea(hass, "office", T.MEDIA_NOISE_PLATFORMS),
   T.mediaPlayersInArea(hass, "office", T.MEDIA_NOISE_PLATFORMS).slice().sort());
eq("empty area", T.mediaPlayersInArea(hass, "hallway", T.MEDIA_NOISE_PLATFORMS), []);

/* --------------------------------------------------------------- ranking */
eq("playing outranks paused",
   T.mediaRank(hass.states["media_player.office_desk"]) >
   T.mediaRank(hass.states["media_player.fireplace"]), true);
eq("paused outranks off",
   T.mediaRank(hass.states["media_player.fireplace"]) >
   T.mediaRank(hass.states["media_player.living_room_tv"]), true);
eq("unavailable ranks below off",
   T.mediaRank({ state: "unavailable", attributes: {} }), -1);
eq("on with media outranks bare on",
   T.mediaRank({ state: "on", attributes: { media_title: "x" } }) >
   T.mediaRank({ state: "on", attributes: {} }), true);

/* ---------------------------------------------------------- text helpers */
eq("duration under an hour", T.formatDuration(93), "1:33");
eq("duration over an hour", T.formatDuration(3725), "1:02:05");
eq("duration zero", T.formatDuration(0), "0:00");
eq("negative clamps", T.formatDuration(-5), "0:00");
eq("artist and album", T.mediaSubtitle(hass.states["media_player.office_desk"]),
   "Massive Attack — Mezzanine");
eq("series and episode", T.mediaSubtitle(hass.states["media_player.office_atv"]),
   "Friends · S1E2");
eq("falls back to the channel", T.mediaSubtitle(hass.states["media_player.fireplace"]),
   "BBC Radio 6");
eq("falls back to the app", T.mediaSubtitle({ attributes: { app_name: "Spotify" } }), "Spotify");
eq("nothing to say", T.mediaSubtitle({ attributes: {} }), "");
eq("title prefers media_title", T.mediaTitle(hass.states["media_player.fireplace"]),
   "Radio 6 Music");

/* position advances while playing, but not while paused */
const playingAt = T.mediaPosition(hass.states["media_player.office_desk"], NOW);
eq("position advances with the clock", Math.round(playingAt), 90); // 60s + 30s elapsed
eq("paused position is not advanced",
   T.mediaPosition({ state: "paused", attributes: { media_position: 42,
     media_position_updated_at: iso(3600) } }, NOW), 42);
eq("position clamps to the duration",
   T.mediaPosition({ state: "playing", attributes: { media_position: 300, media_duration: 310,
     media_position_updated_at: iso(3600) } }, NOW), 310);
eq("no position reported", T.mediaPosition({ state: "playing", attributes: {} }, NOW), null);

/* ------------------------------------------------------------- rendering */
const lr = mk({ area: "living_room" });
eq("title is the room", lr._els.title.textContent, "Living Room");
eq("features the paused Sonos", lr._lastModel.featured.id, "media_player.fireplace");
eq("eyebrow reads paused", lr._els.eyebrow.textContent, "Paused");
eq("track shown", lr._els.track.textContent, "Radio 6 Music");
eq("subtitle shown", lr._els.sub.textContent, "BBC Radio 6");
eq("player name underneath", lr._els.where.textContent, "Fireplace - (Sonos)");
eq("artwork applied", lr._els.art.classList.contains("has-art"), true);
eq("no progress without a duration", lr._els.progress.classList.contains("hidden"), true);
eq("volume reflects the player", lr._els.volume.value, "21");
eq("controls shown", lr._els.controls.classList.contains("hidden"), false);
eq("two other players listed", lr._els.otherRows.length, 2);
eq("twins not listed", lr._els.otherRows.some((r) => r.id === "media_player.fireplace_2"), false);

const office = mk({ area: "office" });
// Both are playing; the one that started most recently is featured.
eq("features the most recently started", office._lastModel.featured.id, "media_player.office_desk");
eq("eyebrow reads now playing", office._els.eyebrow.textContent, "Now playing");
eq("progress shown with a duration", office._els.progress.classList.contains("hidden"), false);
eq("elapsed uses the advanced position", office._els.elapsed.textContent, "1:30");
eq("total duration", office._els.total.textContent, "5:30");
eq("progress bar width", office._els.fill.style.width, "27.27%");
eq("play icon shows pause while playing", office._els.playIcon._icon, "mdi:pause");
eq("paused player shows a play icon", lr._els.playIcon._icon, "mdi:play");

/* controls follow supported_features */
const limited = mk({ entities: ["media_player.office_atv"] });
eq("next disabled when unsupported", limited._els.next.disabled, true);
eq("previous disabled when unsupported", limited._els.prev.disabled, true);
eq("play still enabled", limited._els.play.disabled, false);
eq("volume hidden when unsupported", limited._els.vol.classList.contains("hidden"), true);
eq("series subtitle rendered", limited._els.sub.textContent, "Friends · S1E2");

/* ---------------------------------------------------------- interactions */
lr._els.play._fire("click");
eq("play/pause call", calls.at(-1).slice(0, 3),
   ["media_player", "media_play_pause", { entity_id: "media_player.fireplace" }]);
lr._els.next._fire("click");
eq("next call", calls.at(-1).slice(0, 3),
   ["media_player", "media_next_track", { entity_id: "media_player.fireplace" }]);
lr._els.prev._fire("click");
eq("previous call", calls.at(-1).slice(0, 3),
   ["media_player", "media_previous_track", { entity_id: "media_player.fireplace" }]);
lr._els.volume.value = "40";
lr._els.volume._fire("change");
eq("volume call", calls.at(-1).slice(0, 3),
   ["media_player", "volume_set", { entity_id: "media_player.fireplace", volume_level: 0.4 }]);
lr._els.mute._fire("click");
eq("mute call", calls.at(-1).slice(0, 3),
   ["media_player", "volume_mute",
    { entity_id: "media_player.fireplace", is_volume_muted: true }]);

/* tapping another player features it */
const otherId = lr._els.otherRows[0].id;
lr._els.otherRows[0].row._fire("click");
eq("tapping switches the featured player", lr._lastModel.featured.id, otherId);
eq("the previous one moves to the list",
   lr._els.otherRows.some((r) => r.id === "media_player.fireplace"), true);
lr._els.play._fire("click");
eq("controls follow the new selection", calls.at(-1)[2].entity_id, otherId);

/* --------------------------------------------------------- quiet and odd */
const quiet = mk({ area: "living_room", exclude: ["media_player.fireplace"] });
eq("nothing active shows the idle line", quiet._els.now.classList.contains("hidden"), true);
eq("idle text", quiet._els.idle.textContent, "Nothing playing");
eq("custom idle text",
   mk({ area: "living_room", exclude: ["media_player.fireplace"], idle_text: "All quiet" })
     ._els.idle.textContent, "All quiet");

const bare = mk({ area: "hallway" });
eq("empty room explained", bare._els.idle.textContent, "No media players in Hallway.");

const unknown = mk({ area: "atlantis" });
eq("unknown area message", unknown._els.error.textContent, 'No area called "atlantis".');

const noReg = new T.WabitMediaCard();
noReg.setConfig({ area: "living_room" });
noReg.hass = { ...hass, entities: undefined, areas: undefined };
eq("no registry message", noReg._els.error.textContent,
   "This Home Assistant build does not expose the area registry to cards.");

/* ------------------------------------------------------------- config */
throws("area or entities required",
  () => new T.WabitMediaCard().setConfig({}), "either `area` or `entities`");
throws("entities must be media players",
  () => new T.WabitMediaCard().setConfig({ entities: ["light.x"] }),
  "may only contain media players");
eq("explicit entities skip discovery",
   mk({ entities: ["media_player.office_desk"] })._lastModel.players.length, 1);
eq("title can be overridden", mk({ area: "office", title: "Desk" })._els.title.textContent, "Desk");
eq("header can be hidden", mk({ area: "office", show_header: false })._els.title, undefined);
eq("others can be hidden",
   mk({ area: "living_room", show_others: false })._els.others.classList.contains("hidden"), true);

eq("stub picks the busiest room", T.WabitMediaCard.getStubConfig(hass).area, "living_room");
eq("registered", !!customElements.get("wabit-media-card"), true);
eq("listed in the picker",
   window.customCards.some((c) => c.type === "wabit-media-card"), true);




/* ------------------------------- the card follows whatever starts playing --
   A room normally has one thing playing at a time. A manual pick holds while
   the room carries on as it was, but hands back as soon as playback moves. */
const follow = new T.WabitMediaCard();
follow.setConfig({ area: "living_room" });
follow.hass = hass;                       // fireplace paused, everything else off
eq("starts on the paused Sonos", follow._lastModel.featured.id, "media_player.fireplace");

// Pick the telly by hand.
follow._els.otherRows.find((r) => r.id === "media_player.living_room_tv").row._fire("click");
eq("manual pick takes over", follow._lastModel.featured.id, "media_player.living_room_tv");

// An unrelated update must not disturb it: nothing started or stopped.
follow.hass = { ...hass, states: { ...hass.states,
  "media_player.fireplace": { ...hass.states["media_player.fireplace"],
    attributes: { ...hass.states["media_player.fireplace"].attributes, volume_level: 0.4 } } } };
eq("manual pick holds while nothing changes hands",
   follow._lastModel.featured.id, "media_player.living_room_tv");

// Now the Sonos actually starts. The room has changed hands.
const sonosOn = { ...hass, states: { ...hass.states,
  "media_player.fireplace": { ...hass.states["media_player.fireplace"], state: "playing" } } };
follow.hass = sonosOn;
eq("playback wins over the manual pick",
   follow._lastModel.featured.id, "media_player.fireplace");
eq("the manual pick is forgotten", follow._selected, null);

// The Apple TV takes over from the Sonos.
const atvOn = { ...hass, states: { ...hass.states,
  "media_player.fireplace": { ...hass.states["media_player.fireplace"], state: "idle" },
  "media_player.living_room_apple_tv": { ...hass.states["media_player.living_room_apple_tv"],
    state: "playing", last_changed: iso(1),
    attributes: { ...hass.states["media_player.living_room_apple_tv"].attributes,
                  media_title: "The Bear" } } } };
follow.hass = atvOn;
eq("follows the handover", follow._lastModel.featured.id, "media_player.living_room_apple_tv");

// And when it stops, it falls back rather than sticking on a dead player.
follow.hass = hass;
eq("falls back when playback stops", follow._lastModel.featured.id, "media_player.fireplace");

/* Two at once - rare, and normally mid-handover - goes to the newer one. */
const bothOn = { ...hass, states: { ...hass.states,
  "media_player.fireplace": { ...hass.states["media_player.fireplace"],
    state: "playing", last_changed: iso(300) },
  "media_player.living_room_apple_tv": { ...hass.states["media_player.living_room_apple_tv"],
    state: "playing", last_changed: iso(5),
    attributes: { ...hass.states["media_player.living_room_apple_tv"].attributes,
                  media_title: "The Bear" } } } };
const both = new T.WabitMediaCard();
both.setConfig({ area: "living_room" });
both.hass = bothOn;
eq("the newer of two playing wins",
   both._lastModel.featured.id, "media_player.living_room_apple_tv");
eq("the older is still listed as playing",
   both._els.otherRows.find((r) => r.id === "media_player.fireplace").row
     .classList.contains("live"), true);

/* --------------------------------------------------------- artwork modes */
const cover = mk({ area: "living_room" });
eq("cover is the default", cover._config.artwork, "cover");
eq("cover applied when there is artwork",
   cover._els.stage.classList.contains("cover"), true);
eq("cover does not also wash", cover._els.stage.classList.contains("washed"), false);
// Controls and progress live inside the panel so they can sit over the image.
eq("progress is inside the stage",
   cover._els.stage.children[1].children.includes(cover._els.progress), true);
eq("controls are inside the stage",
   cover._els.stage.children[1].children.includes(cover._els.controls), true);

// No artwork to cover with: fall back rather than showing a blank panel.
const coverNoArt = mk({ area: "office" });
eq("no artwork means no cover", coverNoArt._els.stage.classList.contains("cover"), false);
eq("the tile is still there", coverNoArt._els.art.classList.contains("has-art"), false);

const tile = mk({ area: "living_room", artwork: "tile" });
eq("tile mode has no cover", tile._els.stage.classList.contains("cover"), false);
eq("tile mode washes", tile._els.stage.classList.contains("washed"), true);
eq("tile mode keeps the thumbnail", tile._els.art.classList.contains("has-art"), true);

const none = mk({ area: "living_room", artwork: "none" });
eq("none means no cover", none._els.stage.classList.contains("cover"), false);
eq("none means no wash", none._els.stage.classList.contains("washed"), false);
eq("none means no thumbnail", none._els.art.classList.contains("has-art"), false);

// The older art_backdrop option still means "tile, no wash".
const legacyArt = mk({ area: "living_room", art_backdrop: false });
eq("art_backdrop false still gives tile", legacyArt._config.artwork, "tile");
eq("art_backdrop false does not wash",
   legacyArt._els.stage.classList.contains("washed"), false);

/* ----------------------------------------------------------- artwork wash */
// A fresh card: `lr` has been tapped around by the interaction tests above.
const washed = mk({ area: "living_room", artwork: "tile" });
eq("wash on when there is artwork", washed._els.stage.classList.contains("washed"), true);
eq("wash carries the image",
   washed.style._props["--art"].includes("media_player_proxy"), true);
eq("the body below shares the tint", washed._els.body.classList.contains("tinted"), true);
const noWash = mk({ area: "living_room", artwork: "tile", art_backdrop: false });
eq("wash can be turned off", noWash._els.stage.classList.contains("washed"), false);
const noArt = mk({ area: "office", artwork: "tile" });
eq("no wash without artwork", noArt._els.stage.classList.contains("washed"), false);

/* ---------------------------------------------------------- presets ---
   One-tap shortcuts, matching the radio-station buttons that used to sit
   under the player as a horizontal-stack of button-cards. */
const PRESETS = [
  { name: "6 Music", image: "/local/6-music.png",
    entity: "automation.living_room_play_6_music" },
  { name: "Def Con Radio", image: "/local/defcon-radio.png",
    entity: "automation.living_room_play_def_con_radio" },
];
const pre = mk({ area: "living_room", presets: PRESETS });

eq("no presets row without presets", lr._els.presets.classList.contains("hidden"), true);
eq("presets row shown", pre._els.presets.classList.contains("hidden"), false);
eq("one button per preset", pre._els.presetEls.length, 2);
eq("preset name", pre._els.presetEls[0].btn.children[1].textContent, "6 Music");
eq("preset artwork applied",
   pre._els.presetEls[0].btn.children[0].classList.contains("has-art"), true);

let n = calls.length;
pre._els.presetEls[0].btn._fire("click");
eq("automation preset triggers", calls.at(-1).slice(0, 3),
   ["automation", "trigger", { entity_id: "automation.living_room_play_6_music" }]);

const kinds = mk({ area: "living_room", presets: [
  { name: "Script", entity: "script.evening" },
  { name: "Scene", entity: "scene.movie" },
  { name: "Direct", service: "media_player.play_media",
    data: { media_content_id: "FV:2/31", media_content_type: "favorite_item_id" },
    target: { entity_id: "media_player.fireplace" } },
]});
kinds._els.presetEls[0].btn._fire("click");
eq("script preset turns on", calls.at(-1).slice(0, 3),
   ["script", "turn_on", { entity_id: "script.evening" }]);
kinds._els.presetEls[1].btn._fire("click");
eq("scene preset turns on", calls.at(-1).slice(0, 3),
   ["scene", "turn_on", { entity_id: "scene.movie" }]);
kinds._els.presetEls[2].btn._fire("click");
eq("explicit service preset", calls.at(-1), [
  "media_player", "play_media",
  { media_content_id: "FV:2/31", media_content_type: "favorite_item_id" },
  { entity_id: "media_player.fireplace" },
]);

/* The preset playing right now is marked, by matching the title. */
// Paused still counts: the station is loaded, it is just not sounding.
eq("a paused station still marks its preset",
   pre._els.presetEls[0].btn.classList.contains("on"), true);
eq("an off player marks nothing",
   mk({ area: "living_room", exclude: ["media_player.fireplace"], presets: PRESETS })
     ._els.presetEls[0].btn.classList.contains("on"), false);
const playingRadio = { ...hass, states: { ...hass.states,
  "media_player.fireplace": { ...hass.states["media_player.fireplace"], state: "playing" } } };
const livePre = new T.WabitMediaCard();
livePre.setConfig({ area: "living_room", presets: PRESETS });
livePre.hass = playingRadio;
eq("playing preset marked", livePre._els.presetEls[0].btn.classList.contains("on"), true);
eq("the other preset is not", livePre._els.presetEls[1].btn.classList.contains("on"), false);

const custom = new T.WabitMediaCard();
custom.setConfig({ area: "living_room", presets: [
  { name: "Anything", entity: "automation.x", match: "teardrop" },
  { name: "Never", entity: "automation.y", match: null },
]});
custom.hass = playingRadio;
eq("explicit match that misses", custom._els.presetEls[0].btn.classList.contains("on"), false);
eq("match null never marks", custom._els.presetEls[1].btn.classList.contains("on"), false);

const subMatch = new T.WabitMediaCard();
subMatch.setConfig({ area: "office", presets: [{ name: "Mezzanine", entity: "automation.z" }] });
subMatch.hass = hass;
eq("match looks at the subtitle too",
   subMatch._els.presetEls[0].btn.classList.contains("on"), true);

eq("preset defaults to a radio icon",
   mk({ area: "living_room", presets: [{ name: "X", entity: "automation.x" }] })
     ._config.presets[0].icon, "mdi:radio");
eq("a preset with no image shows the icon",
   mk({ area: "living_room", presets: [{ name: "X", entity: "automation.x" }] })
     ._els.presetEls[0].btn.children[0].classList.contains("has-art"), false);

throws("presets must be a list",
  () => new T.WabitMediaCard().setConfig({ area: "x", presets: {} }), "must be a list");
throws("a preset needs something to do",
  () => new T.WabitMediaCard().setConfig({ area: "x", presets: [{ name: "X" }] }),
  "needs an `entity` to trigger or a `service` to call");
throws("service must be domain.service",
  () => new T.WabitMediaCard().setConfig({ area: "x", presets: [{ name: "X", service: "nope" }] }),
  'must look like "domain.service"');

/* --------------------------------------------- icons must actually change --
   The DOM reports tagName upper case, so a `=== "ha-icon"` check never matched
   and the play/pause glyph silently stopped updating in real browsers. */
customElements.define("ha-icon", class {});
const iconed = mk({ area: "office" });
eq("uses a real ha-icon", iconed._els.playIcon.tagName, "HA-ICON");
eq("playing shows pause", iconed._els.playIcon.getAttribute("icon"), "mdi:pause");
iconed._selected = "media_player.office_atv";
iconed._render();
eq("still pause for another playing player",
   iconed._els.playIcon.getAttribute("icon"), "mdi:pause");
// A paused player must flip it back.
const pausedIcons = mk({ area: "living_room" });
eq("paused shows play", pausedIcons._els.playIcon.getAttribute("icon"), "mdi:play");
eq("mute glyph tracks the player",
   pausedIcons._els.muteIcon.getAttribute("icon"), "mdi:volume-high");
// Other rows pick an icon from the device class.
const dcCard = mk({ entities: ["media_player.fireplace", "media_player.tv_dc"] });
eq("a tv gets a television icon",
   dcCard._els.otherRows[0].row.children[0].getAttribute("icon"), "mdi:television");
delete customElements._d["ha-icon"];



/* ------------------------------------------------------------ power ---
   A telly is usually what this is for: no transport worth speaking of, but
   you want to be able to switch it off from the card. */
const TV_FEATURES = 128 | 256 | 4;   // on, off, volume - no transport
// The Sonos is idle here: a paused speaker outranks an on telly, which is a
// separate question from whether the power button works.
const tvHass = { ...hass, states: { ...hass.states,
  "media_player.fireplace": { ...hass.states["media_player.fireplace"], state: "idle" },
  "media_player.living_room_tv": { state: "on", last_changed: iso(10), attributes: {
    friendly_name: "Living room tv", device_class: "tv",
    supported_features: TV_FEATURES, media_title: "HDMI 2", volume_level: 0.3 } } } };
const tv = new T.WabitMediaCard();
tv.setConfig({ area: "living_room" });
tv.hass = tvHass;

eq("the on telly is featured", tv._lastModel.featured.id, "media_player.living_room_tv");
eq("power shown when supported", tv._els.power.style.display, "");
eq("power is marked while on", tv._els.power.classList.contains("lit"), true);
eq("power says turn off", tv._els.power.title, "Turn off");
eq("no transport, so those are disabled", tv._els.next.disabled, true);

tv._els.power._fire("click");
eq("power turns it off", calls.at(-1).slice(0, 3),
   ["media_player", "turn_off", { entity_id: "media_player.living_room_tv" }]);

// Switched off, nothing in the room is active, so the card features nothing by
// itself - you tap the telly in the list to get at it. That is the real flow
// for turning something back on.
const offTv = { ...tvHass, states: { ...tvHass.states,
  "media_player.living_room_tv": { ...tvHass.states["media_player.living_room_tv"],
    state: "off" } } };
tv.hass = offTv;
eq("a quiet room features nothing on its own", tv._lastModel.featured, null);
eq("the idle line explains it", tv._els.idle.textContent, "Nothing playing");

tv._els.otherRows.find((r) => r.id === "media_player.living_room_tv").row._fire("click");
eq("tapping an off player features it",
   tv._lastModel.featured.id, "media_player.living_room_tv");
eq("power says turn on when off", tv._els.power.title, "Turn on");
eq("power unmarked when off", tv._els.power.classList.contains("lit"), false);
tv._els.power._fire("click");
eq("power turns it on", calls.at(-1).slice(0, 3),
   ["media_player", "turn_on", { entity_id: "media_player.living_room_tv" }]);

// A player that cannot be switched does not get the button.
const noPower = mk({ entities: ["media_player.office_atv"] });
eq("power hidden when unsupported", noPower._els.power.style.display, "none");
const hiddenPower = new T.WabitMediaCard();
hiddenPower.setConfig({ area: "living_room", show_power: false });
hiddenPower.hass = tvHass;
eq("power can be turned off in config", hiddenPower._els.power.style.display, "none");

/* -------------------------------------------------------- presets editor */
customElements.define("ha-form", class {});
const ed = new T.WabitMediaCardEditor();
const emitted = [];
ed.addEventListener("config-changed", (ev) => emitted.push(ev.detail.config));
ed.setConfig({ area: "living_room", presets: PRESETS });
ed.hass = hass;

const blocks = () => ed._els.list.children.filter((c) => c.classList.contains("block"));
eq("a block per preset", blocks().length, 2);
eq("heading uses the name", blocks()[0].children[0].children[0].textContent, "6 Music");
eq("each block has a form", ed._presetForms.length, 2);
// Real HA controls rather than bare text boxes: an entity picker and an image chooser.
eq("form fields", ed._presetForms[0].schema.map((f) => f.name),
   ["name", "entity", "image", "icon"]);
eq("entity field is a picker over runnable things",
   ed._presetForms[0].schema[1].selector.entity.domain,
   ["automation", "script", "scene"]);
eq("image field is an image selector",
   Object.keys(ed._presetForms[0].schema[2].selector)[0], "image");
eq("form carries the preset", ed._presetForms[0].data,
   { name: "6 Music", entity: "automation.living_room_play_6_music",
     image: "/local/6-music.png", icon: undefined });

// Editing through the form merges rather than replacing.
ed._presetForms[0]._handlers["value-changed"][0]({
  stopPropagation() {}, detail: { value: { name: "BBC 6 Music" } } });
eq("editing emits", emitted.at(-1).presets[0].name, "BBC 6 Music");
eq("editing keeps the rest", emitted.at(-1).presets[0].entity,
   "automation.living_room_play_6_music");
eq("other presets untouched", emitted.at(-1).presets[1].name, "Def Con Radio");
eq("heading follows the name", blocks()[0].children[0].children[0].textContent, "BBC 6 Music");
// Editing a field must not tear the rows down underneath the cursor.
eq("rows are not rebuilt while editing", ed._presetForms.length, 2);

/* presets are ordered, so they can be reordered */
eq("first cannot move up", blocks()[0].children[0].children[1].disabled, true);
eq("last cannot move down", blocks()[1].children[0].children[2].disabled, true);
blocks()[0].children[0].children[2]._fire("click");
eq("move down reorders", emitted.at(-1).presets.map((p) => p.name),
   ["Def Con Radio", "BBC 6 Music"]);
blocks()[1].children[0].children[1]._fire("click");
eq("move up reorders back", emitted.at(-1).presets.map((p) => p.name),
   ["BBC 6 Music", "Def Con Radio"]);

ed._addPreset();
eq("adding appends", emitted.at(-1).presets.length, 3);
eq("three blocks now", blocks().length, 3);
blocks()[2].children[0].children[3]._fire("click");
eq("removing drops it", emitted.at(-1).presets.length, 2);
blocks()[1].children[0].children[3]._fire("click");
blocks()[0].children[0].children[3]._fire("click");
eq("emptying removes the key", "presets" in emitted.at(-1), false);
eq("empty state explained",
   ed._els.list.children[0].classList.contains("empty-pins"), true);
delete customElements._d["ha-form"];

globalThis.Date = RealDate;
done("media");
