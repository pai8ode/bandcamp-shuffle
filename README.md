# Bandcamp Shuffle

Shuffle radio over the public Bandcamp collection of
[fedexlatte](https://bandcamp.com/fedexlatte): it picks a random release,
plays a random track from it, and keeps going. No Bandcamp account needed.

## Install

**Firefox** — download `bandcamp-shuffle-firefox.xpi` from the
[latest release](../../releases/latest) and click *Add* when Firefox asks.

**Chrome / Edge** — download `bandcamp-shuffle-chrome.zip` from the latest
release, unzip it somewhere permanent, open `chrome://extensions`, turn on
*Developer mode*, click *Load unpacked*, and pick the unzipped folder.

Then pin **Bandcamp Shuffle** from the toolbar's extensions (puzzle-piece) menu.

## Using it

- **Collection** — starts on fedexlatte. Click *Change* to search Bandcamp
  users or paste a `bandcamp.com/username` link; *Back to fedexlatte* returns
  to the default. Each collection is remembered, so switching back is instant.

- **Shuffle / Skip** — start, or jump to another random track
- **Pause** and **Stop**
- **Volume** — a separate volume just for Bandcamp Shuffle
- **Resync** — refresh the collection (also happens weekly)
- Media keys (play/pause, next) and the system media overlay work too

## Layout

- `extension/` — shared browser extension source; `extension/chrome` and
  `extension/firefox` hold per-browser files. `extension/build.sh` assembles
  `dist/chrome` and `dist/firefox`.
- `bandcamp_shuffle.py` + `widget/` — the Omarchy (Linux) bar widget version.
