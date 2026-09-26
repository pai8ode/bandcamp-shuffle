import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseCollectionPage, dedupe, parseTralbumDetails, tralbumDetailsUrl,
  pickRelease, pushRecent, adjustVolume,
  DEFAULT_FAN, parseProfileInput, parseFanPage, parseFanSearch,
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
