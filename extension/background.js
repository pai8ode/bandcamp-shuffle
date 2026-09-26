// Owns the shuffle loop and all saved state. Playback goes through the
// browser-specific audio.js (Chrome: offscreen document; Firefox: this page).

import { api } from "./lib/api.js";
import * as audio from "./audio.js";
import {
  FAN_ID, COLLECTION_API, parseCollectionPage, dedupe, tralbumDetailsUrl,
  parseTralbumDetails, pickRelease, pushRecent, adjustVolume,
} from "./lib/shuffle.js";

const RESYNC_AFTER = 7 * 24 * 3600 * 1000;
const MAX_FAILURES = 5;
const IDLE = { playing: false, paused: false, track: null, status: "" };

// --- State -----------------------------------------------------------------
// Player state lives in storage.session because the worker can be shut down
// between events; collection, recent history, and volume persist in storage.local.

async function getState() {
  const { player = IDLE } = await api.storage.session.get("player");
  const { volume = 100, collection = null } = await api.storage.local.get(["volume", "collection"]);
  return { ...player, volume, releases: collection?.items.length || 0 };
}

async function setPlayer(patch) {
  const { player = IDLE } = await api.storage.session.get("player");
  await api.storage.session.set({ player: { ...player, ...patch } });
  api.runtime.sendMessage({ target: "popup", state: await getState() }).catch(() => {});
}

// --- Collection -------------------------------------------------------------

let syncing = null;

function sync() {
  syncing ??= doSync().finally(() => { syncing = null; });
  return syncing;
}

async function doSync() {
  await setPlayer({ status: "Syncing collection…" });
  let items = [];
  let token = "9999999999::a::";
  for (;;) {
    const res = await fetch(COLLECTION_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fan_id: FAN_ID, older_than_token: token, count: 100 }),
    });
    if (!res.ok) throw new Error(`Bandcamp returned ${res.status}`);
    const page = parseCollectionPage(await res.json());
    items.push(...page.items);
    token = page.token;
    if (!page.more || !page.items.length) break;
    await setPlayer({ status: `Syncing collection… ${items.length}` });
  }
  items = dedupe(items);
  await api.storage.local.set({ collection: { syncedAt: Date.now(), items } });
  await setPlayer({ status: `Synced ${items.length} releases` });
  return items;
}

async function loadCollection() {
  const { collection } = await api.storage.local.get("collection");
  if (collection?.items.length && Date.now() - collection.syncedAt < RESYNC_AFTER) return collection.items;
  return sync();
}

// --- Playback ---------------------------------------------------------------

let generation = 0; // bumps on every skip/stop so a superseded pick gives up

async function playNext() {
  const gen = ++generation;
  await setPlayer({ playing: true, paused: false, status: "Picking a track…" });

  let items;
  try {
    items = await loadCollection();
  } catch (err) {
    return stop(`Couldn't load your collection: ${err.message}`);
  }
  let { recent = [] } = await api.storage.local.get("recent");
  let { failures = 0 } = await api.storage.session.get("failures");

  while (gen === generation) {
    const release = pickRelease(items, recent);
    recent = pushRecent(recent, release.url);
    await api.storage.local.set({ recent });

    let tracks = [];
    try {
      const res = await fetch(tralbumDetailsUrl(release));
      if (res.ok) tracks = parseTralbumDetails(await res.json());
    } catch (err) {
      console.warn("fetch failed", release.url, err);
    }
    if (gen !== generation) return;

    if (tracks.length) {
      const track = tracks[Math.floor(Math.random() * tracks.length)];
      const { volume = 100 } = await api.storage.local.get("volume");
      await api.storage.session.set({ failures });
      await setPlayer({ track, status: "" });
      await audio.play(track, volume);
      return;
    }
    console.warn("nothing streamable", release.url);
    if (++failures >= MAX_FAILURES) return stop(`Stopped: ${MAX_FAILURES} releases in a row wouldn't play`);
  }
}

async function stop(status = "") {
  generation++;
  await api.storage.session.set({ failures: 0 });
  await audio.stop();
  await setPlayer({ ...IDLE, status });
}

async function trackFailed() {
  let { failures = 0 } = await api.storage.session.get("failures");
  failures++;
  await api.storage.session.set({ failures });
  if (failures >= MAX_FAILURES) return stop(`Stopped: ${MAX_FAILURES} tracks in a row wouldn't play`);
  return playNext();
}

async function togglePause() {
  const gen = generation;
  const { playing, paused } = await getState();
  const alive = await audio.isAlive();
  if (gen !== generation) return; // a stop or skip landed while we were checking
  if (!playing || !alive) return playNext();
  await (paused ? audio.resume() : audio.pause());
}

async function setVolume(action) {
  const { volume } = await getState();
  const level = adjustVolume(volume, action);
  await api.storage.local.set({ volume: level });
  await audio.setVolume(level);
  await setPlayer({});
}

// Chrome closes its audio page after ~30 s without sound (for example a long
// pause), so treat dead audio as stopped instead of showing a dead track.
async function reconcile() {
  const state = await getState();
  if (state.playing && state.track && !syncing && !(await audio.isAlive())) {
    await api.storage.session.set({ player: { ...IDLE, status: "Stopped after a long pause" } });
  }
  return getState();
}

// --- Messages ---------------------------------------------------------------

const commands = {
  start: playNext,
  stop: () => stop(),
  toggle: togglePause,
  sync: () => sync().catch((err) => setPlayer({ status: `Sync failed: ${err.message}` })),
  volume: (msg) => setVolume(msg.value),
  state: () => {},
};

const events = {
  playing: async () => {
    await api.storage.session.set({ failures: 0 });
    await setPlayer({ paused: false });
  },
  pause: () => setPlayer({ paused: true }),
  ended: playNext,
  error: trackFailed,
  next: playNext,
  stop: () => stop(),
};

audio.init((event) => {
  Promise.resolve(events[event]?.()).catch((err) => console.error(event, err));
});

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== "background" || !msg.cmd) return;
  const handler = commands[msg.cmd];
  if (!handler) return;
  // Long-running commands (a pick, a sync) finish in the background; the popup
  // gets progress from setPlayer broadcasts, so answer with the current state.
  Promise.resolve(handler(msg)).catch((err) => console.error(msg, err));
  (msg.cmd === "state" ? reconcile() : getState()).then(sendResponse, () => sendResponse(null));
  return true;
});
