// Owns the shuffle loop and all saved state. Playback goes through the
// browser-specific audio.js (Chrome: offscreen document; Firefox: this page).

import { api } from "./lib/api.js";
import * as audio from "./audio.js";
import {
  DEFAULT_FAN, COLLECTION_API, SEARCH_API, parseCollectionPage, dedupe, tralbumDetailsUrl,
  parseTralbumDetails, pickRelease, pushRecent, adjustVolume, profileUrl, parseFanPage,
  fanSearchBody, parseFanSearch,
} from "./lib/shuffle.js";

const RESYNC_AFTER = 7 * 24 * 3600 * 1000;
const MAX_FAILURES = 5;
const IDLE = { playing: false, paused: false, track: null, status: "" };

// --- State -----------------------------------------------------------------
// Player state lives in storage.session because the worker can be shut down
// between events. The chosen fan, volume, and each fan's collection and recent
// history persist in storage.local, so switching back to a collection is instant.

const collectionKey = (fan) => `collection:${fan.id}`;
const recentKey = (fan) => `recent:${fan.id}`;

async function currentFan() {
  const { fan = DEFAULT_FAN } = await api.storage.local.get("fan");
  return fan;
}

async function getState() {
  const { player = IDLE } = await api.storage.session.get("player");
  const fan = await currentFan();
  const stored = await api.storage.local.get(["volume", collectionKey(fan)]);
  const collection = stored[collectionKey(fan)];
  return { ...player, volume: stored.volume ?? 100, fan, releases: collection?.items.length || 0 };
}

async function setPlayer(patch) {
  const { player = IDLE } = await api.storage.session.get("player");
  await api.storage.session.set({ player: { ...player, ...patch } });
  api.runtime.sendMessage({ target: "popup", state: await getState() }).catch(() => {});
}

// --- Collections -----------------------------------------------------------

const syncing = new Map(); // fan id -> in-flight sync

function sync(fan) {
  if (!syncing.has(fan.id)) syncing.set(fan.id, doSync(fan).finally(() => syncing.delete(fan.id)));
  return syncing.get(fan.id);
}

async function doSync(fan) {
  await setPlayer({ status: `Loading @${fan.username}'s collection…` });
  let items = [];
  let token = "9999999999::a::";
  for (;;) {
    const res = await fetch(COLLECTION_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fan_id: fan.id, older_than_token: token, count: 100 }),
    });
    if (!res.ok) throw new Error(`Couldn't load @${fan.username}'s collection (Bandcamp returned ${res.status})`);
    const page = parseCollectionPage(await res.json());
    items.push(...page.items);
    token = page.token;
    if (!page.more || !page.items.length) break;
    await setPlayer({ status: `Loading @${fan.username}'s collection… ${items.length}` });
  }
  items = dedupe(items);
  if (!items.length) throw new Error(`@${fan.username}'s collection is private or empty`);
  await api.storage.local.set({ [collectionKey(fan)]: { syncedAt: Date.now(), items } });
  await setPlayer({ status: `Loaded ${items.length.toLocaleString()} releases` });
  return items;
}

async function loadCollection(fan) {
  const { [collectionKey(fan)]: collection } = await api.storage.local.get(collectionKey(fan));
  if (collection?.items.length && Date.now() - collection.syncedAt < RESYNC_AFTER) return collection.items;
  return sync(fan);
}

async function searchFans(text) {
  const res = await fetch(SEARCH_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fanSearchBody(text)),
  });
  if (!res.ok) throw new Error(`Search failed (Bandcamp returned ${res.status})`);
  return { results: parseFanSearch(await res.json()) };
}

async function lookupFan(username) {
  const res = await fetch(profileUrl(username));
  if (res.status === 404) return { error: `No Bandcamp user @${username}`, notFound: true };
  if (!res.ok) return { error: `Couldn't open @${username} (Bandcamp returned ${res.status})` };
  const fan = parseFanPage(await res.text());
  return fan ? { fan } : { error: `bandcamp.com/${username} isn't a fan profile` };
}

// Loads the new collection before switching, so a private or empty one leaves
// the current collection playing.
async function selectFan({ id, username, name }) {
  const fan = { id, username, name };
  const previous = await currentFan();
  try {
    await loadCollection(fan);
  } catch (err) {
    await setPlayer({ status: err.message });
    return;
  }
  await api.storage.local.set({ fan });
  const { playing } = await getState();
  if (playing && fan.id !== previous.id) return playNext();
  await setPlayer({ status: "" });
}

// --- Playback ---------------------------------------------------------------

let generation = 0; // bumps on every skip/stop so a superseded pick gives up

async function playNext() {
  const gen = ++generation;
  await setPlayer({ playing: true, paused: false, status: "Picking a track…" });

  const fan = await currentFan();
  let items;
  try {
    items = await loadCollection(fan);
  } catch (err) {
    return stop(err.message);
  }
  let { [recentKey(fan)]: recent = [] } = await api.storage.local.get(recentKey(fan));
  let { failures = 0 } = await api.storage.session.get("failures");

  while (gen === generation) {
    const release = pickRelease(items, recent);
    recent = pushRecent(recent, release.url);
    await api.storage.local.set({ [recentKey(fan)]: recent });

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
  if (state.playing && state.track && !syncing.size && !(await audio.isAlive())) {
    await api.storage.session.set({ player: { ...IDLE, status: "Stopped after a long pause" } });
  }
  return getState();
}

// --- Messages ---------------------------------------------------------------

// Fire-and-forget commands: the popup gets progress from setPlayer broadcasts.
const commands = {
  start: playNext,
  stop: () => stop(),
  toggle: togglePause,
  sync: async () => sync(await currentFan()).catch((err) => setPlayer({ status: err.message })),
  volume: (msg) => setVolume(msg.value),
  select: (msg) => selectFan(msg.fan),
  state: () => {},
};

// Commands whose result the popup waits for.
const queries = {
  search: (msg) => searchFans(msg.value),
  lookup: (msg) => lookupFan(msg.value),
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

// Collections were stored under single keys before per-fan caching.
api.storage.local.remove(["collection", "recent"]);

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== "background" || !msg.cmd) return;
  if (queries[msg.cmd]) {
    queries[msg.cmd](msg).then(sendResponse, (err) => sendResponse({ error: err.message }));
    return true;
  }
  const handler = commands[msg.cmd];
  if (!handler) return;
  Promise.resolve(handler(msg)).catch((err) => console.error(msg, err));
  (msg.cmd === "state" ? reconcile() : getState()).then(sendResponse, () => sendResponse(null));
  return true;
});
