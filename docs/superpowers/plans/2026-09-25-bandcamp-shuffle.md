# Bandcamp Shuffle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continuous shuffle radio over fedexlatte's Bandcamp collection, driven from an Omarchy bar widget.

**Architecture:** A stdlib-only Python CLI (`bandcamp_shuffle.py`, symlinked as `~/.local/bin/bandcamp-shuffle`) caches the collection list and runs a detached play loop that resolves a fresh stream URL per track and plays it with mpv (MPRIS via mpv-mpris). A QML bar-widget plugin shells out to the CLI.

**Tech Stack:** Python 3 stdlib (urllib, json, html, signal, subprocess, unittest), mpv, Quickshell/QML (Omarchy shell plugin API).

**Spec:** `docs/superpowers/specs/2026-09-25-bandcamp-shuffle-design.md`

## Global Constraints

- fan_id `2201246`; collection API `POST https://bandcamp.com/api/fancollection/1/collection_items`, `count: 100`.
- Cache dir `~/.cache/bandcamp-shuffle/`; resync when older than 7 days.
- Recent-history window: 50 releases. Give up after 5 consecutive failures.
- Plugin id `pai.bandcamp-shuffle`, installed to `~/.config/omarchy/plugins/pai.bandcamp-shuffle/`.
- Never edit `/usr/share/omarchy/`.

---

### Task 1: Parsing and selection core (TDD)

**Files:**
- Create: `bandcamp_shuffle.py`
- Test: `tests/test_bandcamp_shuffle.py` (fixtures already in `tests/fixtures/`)

**Interfaces:**
- Produces: `parse_tralbum(html: str) -> list[dict]` (`{"title","artist","url"}`, streamable only);
  `parse_collection_page(data: dict) -> tuple[list[dict], bool, str]` (items `{"url","title","artist"}`, more, last_token);
  `pick_release(items, recent: list[str], rng) -> dict`; `push_recent(recent, url, limit=50) -> list[str]`.

- [ ] Step 1: Write tests — album fixture yields 5 streamable tracks with `stream_redirect` URLs and non-empty artist; collection fixture yields 3 items, `more is True`, token `1783701096:3658257947:a::`; `pick_release` never returns a recent URL unless all are recent; `push_recent` dedupes, appends, trims to limit.
- [ ] Step 2: Run `python -m unittest -v` → FAIL (module missing).
- [ ] Step 3: Implement the four functions.
- [ ] Step 4: Run tests → PASS. Commit.

### Task 2: CLI — sync / run / start / skip / stop / status

**Files:** Modify `bandcamp_shuffle.py`; create `install.sh`.

- `sync`: page the API from token `"9999999999::a::"` until `more_available` false; atomic write `collection.json`.
- `run`: foreground loop; pidfile `$XDG_RUNTIME_DIR/bandcamp-shuffle.pid`; SIGUSR1 → terminate current mpv; SIGTERM → stop flag + terminate mpv; mpv args `--no-video --really-quiet --force-media-title=<artist — title>`; nonzero exit without skip = failure; release with no streamable tracks = failure; 5 in a row → `notify-send` and exit. Recent list persisted to `recent.json`.
- `start`: if running, act as `skip`; else spawn `run` detached (`start_new_session=True`, log to `~/.cache/bandcamp-shuffle/log`).
- `status`: exit 0 iff pidfile pid alive and its cmdline contains `bandcamp`.
- `install.sh`: symlink script to `~/.local/bin/bandcamp-shuffle`, copy `widget/` to plugin dir.

- [ ] Verify: `bandcamp-shuffle sync` reports ~1439 items; `start` plays audio; `skip` changes track; `stop` exits; `status` codes correct. Commit.

### Task 3: Bar widget

**Files:** `widget/manifest.json`, `widget/BarWidget.qml`.

- `BarWidget` with `BarIconButton` (glyph ``), `dimmed: !playing`, polls `status` every 3 s (and 700 ms after a click).
- Left → `start`, right → `stop`, middle → `sync`; invoked by absolute path `$HOME/.local/bin/bandcamp-shuffle` via `Quickshell.execDetached`.

- [ ] `omarchy plugin validate widget`; install; `omarchy plugin enable pai.bandcamp-shuffle`; `omarchy bar put omarchy.media` and place both in the right section; confirm no shell errors and clicks work. Commit.

### Task 4: Chrome extension (spec addendum "Chrome extension")
- [ ] `chrome-extension/lib/shuffle.js` + `chrome-extension/test/shuffle.test.mjs` (TDD with node:test, fixtures incl. a saved tralbum_details response).
- [ ] manifest, background.js, offscreen.html/js, popup.html/css/js, icons (magick).
- [ ] Verify in Chromium with a temp profile + `--load-extension`: popup renders, playback starts, skip/stop/volume work, media session visible over MPRIS.
- [ ] Zip, upload to Google Drive, commit.
