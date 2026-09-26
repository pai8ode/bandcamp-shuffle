// Pure shuffle logic shared by the offscreen player; no browser APIs here.

export const DEFAULT_FAN = { id: 2201246, username: "fedexlatte", name: "p" };
export const COLLECTION_API = "https://bandcamp.com/api/fancollection/1/collection_items";
export const SEARCH_API = "https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic";
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

// bandcamp.com paths that are site pages rather than fan profiles.
const NOT_FANS = new Set(["search", "discover", "about", "help", "login", "signup", "tag", "artists", "labels", "feed", "settings", "api", "EmbeddedPlayer"]);

// Returns the username in a bandcamp.com/<username> link or an @handle, or
// null for anything else (plain text is a search).
export function parseProfileInput(text) {
  const input = text.trim();
  const handle = input.match(/^@([\w-]+)$/);
  if (handle) return handle[1];
  const link = input.match(/^(?:https?:\/\/)?(?:www\.)?bandcamp\.com\/([\w-]+)(?:[/?#]|$)/i);
  if (link && !NOT_FANS.has(link[1])) return link[1];
  return null;
}

export const profileUrl = (username) => `https://bandcamp.com/${encodeURIComponent(username)}`;

// Reads the fan from a profile page's embedded page data.
export function parseFanPage(page) {
  const match = page.match(/id="pagedata" data-blob="([^"]*)"/);
  if (!match) return null;
  const data = JSON.parse(decodeHtml(match[1]));
  const fan = data.fan_data;
  if (!fan?.fan_id) return null;
  return {
    id: fan.fan_id,
    username: fan.username,
    name: fan.name || fan.username,
    collectionSize: data.collection_count ?? data.collection_data?.item_count ?? 0,
  };
}

export function fanSearchBody(text) {
  return { search_text: text, search_filter: "f", full_page: false, fan_id: null };
}

export function parseFanSearch(data) {
  return (data.auto?.results || [])
    .filter((result) => result.type === "f")
    .map((result) => ({
      id: result.id,
      username: result.username,
      name: result.name || result.username,
      collectionSize: result.collection_size ?? 0,
      image: result.img || "",
    }));
}

function decodeHtml(text) {
  return text.replace(/&(quot|amp|lt|gt|#39|#x27|#(\d+));/g, (_, name, code) =>
    code ? String.fromCharCode(Number(code)) : { quot: '"', amp: "&", lt: "<", gt: ">", "#39": "'", "#x27": "'" }[name]);
}
