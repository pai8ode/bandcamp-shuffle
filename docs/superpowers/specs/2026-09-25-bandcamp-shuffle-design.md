# Bandcamp Shuffle — Design

Continuous shuffle radio over the public Bandcamp collection of `fedexlatte`
(fan_id 2201246), controlled from an Omarchy bar widget.

## Components

### `bandcamp-shuffle` (Python 3, stdlib only; installed to `~/.local/bin`)
- `sync` — pages `POST https://bandcamp.com/api/fancollection/1/collection_items`
  (`fan_id`, `older_than_token`, `count: 100`) until `more_available` is false.
  Writes `~/.cache/bandcamp-shuffle/collection.json` (item_url, title, artist).
- `start` — foreground loop (launched detached by the widget): pick random
  release not among the last 50 played, fetch its page, parse `data-tralbum`
  → `trackinfo`, pick random track with `file["mp3-128"]`, play with
  `mpv --no-video --force-media-title="Artist — Title"`. Repeat.
  Auto-syncs when the cache is missing or older than 7 days.
  Writes a pidfile; only one loop runs at a time.
- `skip` — SIGUSR1 to the loop → kills current mpv child → next track.
- `stop` — SIGTERM to the loop → kills mpv and exits.
- `status` — exit 0 if running (for the widget).
- Failures: a release with no streamable tracks or a network error counts as a
  failure; retry with another release; 5 consecutive failures → notify-send + exit.
- Stream URLs are signed and expire, so they are resolved just before playback.

### Bar widget `pai.bandcamp-shuffle` (`~/.config/omarchy/plugins/pai.bandcamp-shuffle/`)
- Shuffle glyph; dimmed when stopped, active colour when playing (polls `status`).
- Left click: start, or skip when playing. Right click: stop. Middle click: sync.
- Now-playing text comes from `omarchy.media` via mpv-mpris; add `omarchy.media`
  to the bar next to the widget.

## Testing
- Unit tests (unittest) for tralbum parsing, collection-page parsing, and
  recent-history selection, using saved real fixtures.
- Manual end-to-end: sync, start, skip, stop, widget clicks.

## Addendum 2026-09-25: separate volume (Omarchy)
- `bandcamp-shuffle volume [up|down|0-100]` (5-point steps, clamped); saved in
  `~/.cache/bandcamp-shuffle/volume`, passed as `--volume`, pushed live over
  mpv's IPC socket `$XDG_RUNTIME_DIR/bandcamp-shuffle.sock`. Scroll on the widget.

## Addendum 2026-09-25: Chrome extension (Windows)
Manifest V3 extension in `chrome-extension/`, loaded unpacked on Windows Chrome.
- Host permission `https://bandcamp.com/*` only. Collection via the same
  collection_items API; tracks via
  `https://bandcamp.com/api/mobile/24/tralbum_details?band_id&tralbum_type&tralbum_id`
  (works for custom-domain releases, returns `streaming_url["mp3-128"]` + `art_id`).
- `lib/shuffle.js` — pure logic (parsing, dedupe, pick, recent, volume), node:test.
- `offscreen.html/js` — `AUDIO_PLAYBACK` offscreen document owns the `<audio>`
  element and the play loop; state (collection, recent, volume) in the
  extension origin's localStorage. Media Session metadata + next/pause handlers
  so Windows media keys and overlay work.
- `background.js` — creates the offscreen document on demand, relays popup commands.
- Popup — art, track/artist, play-or-skip, stop, volume slider, resync, status.
- Same rules: weekly resync, last 50 releases excluded, 5 consecutive failures stop.
- Delivered as a zip uploaded to Google Drive.
