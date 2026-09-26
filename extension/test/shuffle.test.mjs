import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseCollectionPage, dedupe, parseTralbumDetails, tralbumDetailsUrl,
  pickRelease, pushRecent, adjustVolume,
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
