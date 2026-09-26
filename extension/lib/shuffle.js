// Pure shuffle logic shared by the offscreen player; no browser APIs here.

export const FAN_ID = 2201246;
export const COLLECTION_API = "https://bandcamp.com/api/fancollection/1/collection_items";
export const RECENT_LIMIT = 50;
export const VOLUME_STEP = 5;

// Returns the next page token from the last item: the response's last_token
// lags behind the page end when count is large, which repeats items.
export function parseCollectionPage(data) {
  const raw = data.items || [];
  const items = raw
    .filter((item) => item.item_url)
    .map((item) => ({
      url: item.item_url,
      title: item.item_title || "",
      artist: item.band_name || "",
      bandId: item.band_id,
      tralbumId: item.tralbum_id,
      tralbumType: item.tralbum_type,
    }));
  const token = raw.length ? raw.at(-1).token : data.last_token;
  return { items, more: Boolean(data.more_available), token: token || "" };
}

export function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => !seen.has(item.url) && seen.add(item.url));
}

// Works for releases on custom domains too, since it always goes through bandcamp.com.
export function tralbumDetailsUrl({ bandId, tralbumId, tralbumType }) {
  return `https://bandcamp.com/api/mobile/24/tralbum_details?band_id=${bandId}&tralbum_type=${tralbumType}&tralbum_id=${tralbumId}`;
}

export function parseTralbumDetails(data) {
  const art = data.art_id ? `https://f4.bcbits.com/img/a${data.art_id}_10.jpg` : "";
  return (data.tracks || [])
    .filter((track) => track.streaming_url && track.streaming_url["mp3-128"])
    .map((track) => ({
      title: track.title || "",
      artist: track.band_name || data.tralbum_artist || "",
      album: data.title || "",
      art,
      url: track.streaming_url["mp3-128"],
    }));
}

export function pickRelease(items, recent, random = Math.random) {
  const recentSet = new Set(recent);
  const fresh = items.filter((item) => !recentSet.has(item.url));
  const pool = fresh.length ? fresh : items;
  return pool[Math.floor(random() * pool.length)];
}

export function pushRecent(recent, url, limit = RECENT_LIMIT) {
  return [...recent.filter((u) => u !== url), url].slice(-limit);
}

// Applies "up", "down", or an absolute level to a 0-100 volume.
export function adjustVolume(current, action) {
  let level;
  if (action === "up") level = current + VOLUME_STEP;
  else if (action === "down") level = current - VOLUME_STEP;
  else {
    level = Number(action);
    if (action === "" || !Number.isFinite(level)) throw new Error(`volume must be up, down, or 0-100, not ${action}`);
  }
  return Math.max(0, Math.min(100, Math.round(level)));
}
