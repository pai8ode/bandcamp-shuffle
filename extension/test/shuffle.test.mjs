import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseCollectionPage, dedupe, parseTralbumDetails, tralbumDetailsUrl,
  pickRelease, pushRecent, adjustVolume,
  DEFAULT_FAN, parseProfileInput, parseFanPage, parseFanSearch,
  songOf, favLine, isFavorite, addFavorite, removeFavorite, favoritesText, favoritesCsv,
  favoritePicks, trackForFavorite,
} from "../lib/shuffle.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url)));

test("parseCollectionPage keeps release ids and pages by the last item's token", () => {
  const data = fixture("collection_items.json");
  data.last_token = data.items[0].token; // the API's last_token lags behind with count=100

  const { items, more, token } = parseCollectionPage(data);

  assert.equal(items.length, 3);
  assert.deepEqual(items[1], {
    url: "https://celadonplaza.bandcamp.com/album/collection-keygen-h-update",
    title: "続編 Collection: keygen_h​.​update",
    artist: "haircuts for men",
    bandId: 4077218056,
    tralbumId: 2340903579,
    tralbumType: "a",
  });
  assert.equal(more, true);
  assert.equal(token, data.items.at(-1).token);
});

test("dedupe keeps the first item per url", () => {
  assert.deepEqual(dedupe([{ url: "a", n: 1 }, { url: "b" }, { url: "a", n: 2 }]), [{ url: "a", n: 1 }, { url: "b" }]);
});

test("tralbumDetailsUrl builds the mobile API request", () => {
  assert.equal(
    tralbumDetailsUrl({ bandId: 1, tralbumId: 2, tralbumType: "t" }),
    "https://bandcamp.com/api/mobile/24/tralbum_details?band_id=1&tralbum_type=t&tralbum_id=2",
  );
});

test("parseTralbumDetails returns streamable tracks with album and art", () => {
  const tracks = parseTralbumDetails(fixture("tralbum_details.json"));

  assert.equal(tracks.length, 16);
  assert.deepEqual(Object.keys(tracks[0]).sort(), ["album", "art", "artist", "title", "url"]);
  assert.equal(tracks[0].title, "Luxonix Purity 1.24 kg");
  assert.equal(tracks[0].artist, "haircuts for men");
  assert.equal(tracks[0].album, "続編 Collection: keygen_h​.​update");
  assert.equal(tracks[0].art, "https://f4.bcbits.com/img/a652206266_10.jpg");
  assert.match(tracks[0].url, /mp3-128/);
});

test("parseTralbumDetails skips tracks without a stream", () => {
  const data = fixture("tralbum_details.json");
  data.tracks[0].streaming_url = null;
  assert.equal(parseTralbumDetails(data).length, 15);
  assert.deepEqual(parseTralbumDetails({}), []);
});

test("pickRelease avoids recent releases unless all are recent", () => {
  const items = [0, 1, 2, 3, 4].map((i) => ({ url: `u${i}` }));
  for (let i = 0; i < 20; i++) assert.equal(pickRelease(items, ["u0", "u1", "u2", "u3"]).url, "u4");
  assert.ok(items.includes(pickRelease(items, items.map((x) => x.url))));
});

test("pushRecent dedupes and trims", () => {
  assert.deepEqual(pushRecent(["a", "b", "c"], "a", 3), ["b", "c", "a"]);
  assert.deepEqual(pushRecent(["a", "b", "c"], "d", 3), ["b", "c", "d"]);
});

test("adjustVolume steps, sets, and clamps", () => {
  assert.equal(adjustVolume(50, "up"), 55);
  assert.equal(adjustVolume(50, "down"), 45);
  assert.equal(adjustVolume(98, "up"), 100);
  assert.equal(adjustVolume(3, "down"), 0);
  assert.equal(adjustVolume(50, 72), 72);
  assert.equal(adjustVolume(50, "150"), 100);
  assert.throws(() => adjustVolume(50, "loud"));
});

test("DEFAULT_FAN is fedexlatte", () => {
  assert.deepEqual(DEFAULT_FAN, { id: 2201246, username: "fedexlatte", name: "p" });
});

test("parseProfileInput reads usernames from links and @handles", () => {
  assert.equal(parseProfileInput("https://bandcamp.com/fedexlatte"), "fedexlatte");
  assert.equal(parseProfileInput("bandcamp.com/fedexlatte"), "fedexlatte");
  assert.equal(parseProfileInput("  www.bandcamp.com/some_fan-1/wishlist?from=menubar "), "some_fan-1");
  assert.equal(parseProfileInput("http://bandcamp.com/Fedexlatte#x"), "Fedexlatte");
  assert.equal(parseProfileInput("@fedexlatte"), "fedexlatte");
});

test("parseProfileInput leaves plain text and non-profile links for search", () => {
  assert.equal(parseProfileInput("fedex"), null);
  assert.equal(parseProfileInput("two words"), null);
  assert.equal(parseProfileInput(""), null);
  assert.equal(parseProfileInput("https://artist.bandcamp.com/album/x"), null); // an artist, not a fan
  assert.equal(parseProfileInput("https://bandcamp.com/search?q=x"), null);
  assert.equal(parseProfileInput("https://bandcamp.com/discover"), null);
});

test("parseFanPage reads the fan behind a profile page", () => {
  const page = readFileSync(new URL("fan_page.html", import.meta.url), "utf8");
  assert.deepEqual(parseFanPage(page), { id: 2201246, username: "fedexlatte", name: "p", collectionSize: 1439 });
  assert.equal(parseFanPage("<html>not a fan page</html>"), null);
});

test("parseFanSearch returns fans with collection sizes", () => {
  const results = parseFanSearch(fixture("search_fans.json"));
  assert.ok(results.length > 0);
  assert.deepEqual(Object.keys(results[0]).sort(), ["collectionSize", "id", "image", "name", "username"]);
  assert.equal(results[0].username, "_fede");
  assert.equal(parseFanSearch({ auto: { results: [{ type: "b", id: 1 }] } }).length, 0);
  assert.deepEqual(parseFanSearch({}), []);
});

const TRACK = { title: "Hilary", artist: "Clem Snide", album: "Moral Minority", art: "a.jpg", url: "https://t4.bcbits.com/x",
  page: "https://clemsnide.bandcamp.com/album/moral-minority" };
const SONG = { artist: "Clem Snide", title: "Hilary", album: "Moral Minority", bandcamp_url: "https://clemsnide.bandcamp.com/album/moral-minority" };
const OTHER = { artist: "Erykah Badu & The Alchemist", title: "Witch Doctor", album: "Before, \"The\" World",
  bandcamp_url: "https://controlfreaq.bandcamp.com/album/before-the-world-blows" };

test("songOf keeps what a favorite needs from the playing track", () => {
  assert.deepEqual(songOf(TRACK), SONG);
  assert.equal(songOf(null), null);
});

test("favLine is the importer format", () => {
  assert.equal(favLine(SONG), "Clem Snide - Hilary");
});

test("addFavorite appends once, removeFavorite removes only that song", () => {
  let favs = addFavorite([], SONG, "2026-09-25 23:40");
  assert.deepEqual(favs, [{ ...SONG, saved_at: "2026-09-25 23:40" }]);
  assert.equal(addFavorite(favs, SONG, "later"), favs);
  favs = addFavorite(favs, OTHER, "t2");
  assert.ok(isFavorite(favs, SONG) && isFavorite(favs, OTHER));
  favs = removeFavorite(favs, SONG);
  assert.deepEqual(favs.map((f) => f.title), ["Witch Doctor"]);
  assert.ok(!isFavorite(favs, SONG));
  assert.ok(!isFavorite(favs, null));
});

test("favoritesText and favoritesCsv match the Omarchy files", () => {
  const favs = [{ ...SONG, saved_at: "t1" }, { ...OTHER, saved_at: "t2" }];
  assert.equal(favoritesText(favs), "Clem Snide - Hilary\nErykah Badu & The Alchemist - Witch Doctor\n");
  assert.equal(favoritesText([]), "");
  assert.equal(favoritesCsv(favs),
    "saved_at,artist,title,album,bandcamp_url\r\n" +
    "t1,Clem Snide,Hilary,Moral Minority,https://clemsnide.bandcamp.com/album/moral-minority\r\n" +
    't2,Erykah Badu & The Alchemist,Witch Doctor,"Before, ""The"" World",https://controlfreaq.bandcamp.com/album/before-the-world-blows\r\n');
});

test("songOf keeps the release ids when the track has them", () => {
  const song = songOf({ ...TRACK, bandId: 1, tralbumId: 2, tralbumType: "a" });
  assert.deepEqual(song, { ...SONG, band_id: 1, tralbum_id: 2, tralbum_type: "a" });
});

test("favoritePicks makes one pick per playable favorite", () => {
  const playable = { ...SONG, band_id: 1, tralbum_id: 2, tralbum_type: "a" };
  const picks = favoritePicks([playable, { ...playable, title: "Other song" }, SONG]); // SONG has no ids
  assert.equal(picks.length, 2);
  assert.notEqual(picks[0].url, picks[1].url);
  assert.deepEqual({ ...picks[0], url: undefined }, {
    url: undefined, song: "Hilary", page: SONG.bandcamp_url, bandId: 1, tralbumId: 2, tralbumType: "a",
  });
});

test("trackForFavorite finds the starred song loosely", () => {
  const tracks = [{ title: "Intro" }, { title: "Hilary" }];
  assert.equal(trackForFavorite(tracks, " hilary"), tracks[1]);
  assert.equal(trackForFavorite(tracks, "Gone"), undefined);
});
