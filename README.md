# Bandcamp Shuffle

Shuffle radio over the public Bandcamp collection of
[fedexlatte](https://bandcamp.com/fedexlatte): it picks a random release,
plays a random track from it, and keeps going. No Bandcamp account needed.

## Install

**Firefox** — open
[bandcamp-shuffle-firefox.xpi](https://github.com/pai8ode/bandcamp-shuffle/releases/latest/download/bandcamp-shuffle-firefox.xpi)
in Firefox, then *Continue to Installation* → *Add*. From 1.3.0 on, Firefox
updates it automatically.

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
- **☆ Favorites** — star the playing song; *Favorites* lists them with links,
  **Copy for Spotify/Apple Music** (`Artist - Song` lines for TuneMyMusic or
  Soundiiz), and **.txt** / **.csv** downloads matching the Omarchy files
- Media keys (play/pause, next) and the system media overlay work too

## Layout

- `extension/` — shared browser extension source; `extension/chrome` and
  `extension/firefox` hold per-browser files. `extension/build.sh` assembles
  `dist/chrome` and `dist/firefox`.
- `bandcamp_shuffle.py` + `widget/` — the Omarchy (Linux) bar widget version.

## Omarchy bar widget

`./install.sh` links `~/.local/bin/bandcamp-shuffle`, installs the bar plugin,
and restarts omarchy-shell when the widget changed (the shell doesn't load
edited widget code on its own). The widget is three icons:

- **⤮ shuffle** — click plays or skips; right-click (two-finger tap) opens the
  menu: Stop, *Search users or paste a link…*, saved collections, Favorites
  list, Resync; scroll sets a Bandcamp-only volume. The same menu is
  `bandcamp-shuffle pick` (bound here to Super+Alt+B).
- **🔍 search** — straight to the search box (`bandcamp-shuffle find`).
- **☆ star** — adds the playing song to your favorites (★), or removes it.

Favorites go to `~/Documents/Bandcamp Favorites.txt` as `Artist - Title` lines,
ready for playlist importers such as TuneMyMusic or Soundiiz, and to
`Bandcamp Favorites.csv` with album, Bandcamp link and date.

From a terminal: `bandcamp-shuffle use bandcamp.com/<username>`, `search <text>`,
`fan`, `fav`, `favs`.

## Releasing

`./release.sh <version>` bumps both manifests, runs the tests, signs the
Firefox add-on with Mozilla (unlisted), publishes the GitHub release, and then
adds the version to `updates.json`, which installed Firefox copies check for
updates. It needs Mozilla API keys in `~/.config/bandcamp-shuffle/amo.env`.
