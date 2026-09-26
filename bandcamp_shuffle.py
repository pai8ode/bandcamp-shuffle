#!/usr/bin/env python3
"""Continuous shuffle radio over a public Bandcamp collection."""

import csv
import html
import io
import json
import os
import random
import re
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_FAN = {"id": 2201246, "username": "fedexlatte", "name": "p"}
COLLECTION_API = "https://bandcamp.com/api/fancollection/1/collection_items"
SEARCH_API = "https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic"
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) bandcamp-shuffle"
CACHE_DIR = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "bandcamp-shuffle"
COLLECTIONS_DIR = CACHE_DIR / "collections"  # <fan id>.json: {"fan", "synced_at", "items"}
FAN_FILE = CACHE_DIR / "fan.json"
FAVORITES_ONLY_FILE = CACHE_DIR / "favorites-only"  # present = shuffle only starred songs
FAV_RECENT_FILE = CACHE_DIR / "recent-favorites.json"  # the collection being shuffled; fedexlatte when missing
LEGACY_COLLECTION_FILE = CACHE_DIR / "collection.json"  # before per-fan caches
LEGACY_RECENT_FILE = CACHE_DIR / "recent.json"
OMARCHY_BIN = Path("/usr/share/omarchy/bin")
LOG_FILE = CACHE_DIR / "log"
VOLUME_FILE = CACHE_DIR / "volume"
RUNTIME_DIR = Path(os.environ.get("XDG_RUNTIME_DIR", "/tmp"))
PID_FILE = RUNTIME_DIR / "bandcamp-shuffle.pid"
MPV_SOCKET = RUNTIME_DIR / "bandcamp-shuffle.sock"
NOW_FILE = RUNTIME_DIR / "bandcamp-shuffle-now.json"  # the song playing, for favorites
FAV_FIELDS = ["saved_at", "artist", "title", "album", "bandcamp_url"]


def documents_dir():
    try:
        found = subprocess.run(["xdg-user-dir", "DOCUMENTS"], capture_output=True, text=True).stdout.strip()
    except OSError:
        found = ""
    return Path(found) if found else Path.home() / "Documents"
MAX_CACHE_AGE = 7 * 24 * 3600
RECENT_LIMIT = 50
MAX_FAILURES = 5
VOLUME_STEP = 5

TRALBUM_RE = re.compile(r'data-tralbum="([^"]*)"')
PAGEDATA_RE = re.compile(r'id="pagedata" data-blob="([^"]*)"')
HANDLE_RE = re.compile(r"^@([\w-]+)$")
PROFILE_LINK_RE = re.compile(r"^(?:https?://)?(?:www\.)?bandcamp\.com/([\w-]+)(?:[/?#]|$)", re.IGNORECASE)
# bandcamp.com paths that are site pages rather than fan profiles.
NOT_FANS = {"search", "discover", "about", "help", "login", "signup", "tag", "artists", "labels",
            "feed", "settings", "api", "EmbeddedPlayer"}

# Nerd Font glyphs for menu rows.
GLYPH_STOP = "\uf04d"
GLYPH_SEARCH = "\uf002"
GLYPH_CURRENT = "\uf00c"
GLYPH_FAN = "\uf007"
GLYPH_HOME = "\uf015"
GLYPH_RESYNC = "\uf021"
GLYPH_STAR = "\uf005"
GLYPH_STAR_EMPTY = "\uf006"


def parse_tralbum(page):
    """Return the streamable tracks on an album or track page."""
    match = TRALBUM_RE.search(page)
    if not match:
        return []
    data = json.loads(html.unescape(match.group(1)))
    release_artist = data.get("artist") or ""
    tracks = []
    for info in data.get("trackinfo") or []:
        url = (info.get("file") or {}).get("mp3-128")
        if url:
            tracks.append({
                "title": info.get("title") or "",
                "artist": info.get("artist") or release_artist,
                "url": url,
            })
    return tracks


def parse_collection_page(data):
    """Return (items, more_available, next_token) from a collection_items response.

    The next token is the last item's own token: the response's last_token
    lags behind the page end when count is large, which repeats items.
    """
    raw = data.get("items") or []
    items = [
        {"url": item["item_url"], "title": item.get("item_title") or "", "artist": item.get("band_name") or ""}
        for item in raw
        if item.get("item_url")
    ]
    token = raw[-1].get("token") if raw else data.get("last_token")
    return items, bool(data.get("more_available")), token or ""


def dedupe(items):
    seen = set()
    return [item for item in items if not (item["url"] in seen or seen.add(item["url"]))]


def pick_release(items, recent, rng):
    recent = set(recent)
    fresh = [item for item in items if item["url"] not in recent]
    return rng.choice(fresh or items)


def push_recent(recent, url, limit=50):
    recent = [u for u in recent if u != url] + [url]
    return recent[-limit:]


def adjust_volume(current, action):
    """Apply "up", "down", or an absolute level to a 0-100 volume."""
    if action == "up":
        level = current + VOLUME_STEP
    elif action == "down":
        level = current - VOLUME_STEP
    else:
        try:
            level = int(action)
        except ValueError:
            raise ValueError(f"volume must be up, down, or 0-100, not {action!r}") from None
    return max(0, min(100, level))


def parse_profile_input(text):
    """Return the username in a bandcamp.com/<username> link or an @handle, else None."""
    text = text.strip()
    match = HANDLE_RE.match(text)
    if match:
        return match.group(1)
    match = PROFILE_LINK_RE.match(text)
    if match and match.group(1) not in NOT_FANS:
        return match.group(1)
    return None


def profile_url(username):
    return f"https://bandcamp.com/{urllib.parse.quote(username)}"


def parse_fan_page(page):
    """Return the fan behind a profile page, or None for any other page."""
    match = PAGEDATA_RE.search(page)
    if not match:
        return None
    data = json.loads(html.unescape(match.group(1)))
    fan = data.get("fan_data") or {}
    if not fan.get("fan_id"):
        return None
    size = data.get("collection_count")
    if size is None:
        size = (data.get("collection_data") or {}).get("item_count", 0)
    return {"id": fan["fan_id"], "username": fan["username"], "name": fan.get("name") or fan["username"],
            "collection_size": size}


def parse_fan_search(data):
    return [
        {"id": r["id"], "username": r["username"], "name": r.get("name") or r["username"],
         "collection_size": r.get("collection_size") or 0}
        for r in (data.get("auto") or {}).get("results") or []
        if r.get("type") == "f"
    ]


def fan_row(fan, size, current=False):
    """An omarchy-menu-select row: "<glyph>\t<name>\t<@username · size>"."""
    if size:
        detail = f"{size:,} release{'' if size == 1 else 's'}"
    else:
        detail = "private or empty"
    return f"{GLYPH_CURRENT if current else GLYPH_FAN}\t{fan['name']}\t@{fan['username']} · {detail}"


def username_from_selection(selection):
    """omarchy-menu-select returns "<label>\t<subtext>"; the subtext starts with @username."""
    _, _, subtext = selection.partition("\t")
    match = re.match(r"@([\w-]+)", subtext)
    return match.group(1) if match else None


def now_playing(track, release):
    """What gets saved as a favorite: the song plus the release page it came from."""
    return {"artist": track["artist"], "title": track["title"], "album": release.get("title") or "",
            "bandcamp_url": release["url"]}


def fav_line(song):
    """"Artist - Title", the line format TuneMyMusic and Soundiiz import."""
    return f"{song['artist']} - {song['title']}"


def _same_song(row, song):
    return row["bandcamp_url"] == song["bandcamp_url"] and row["title"] == song["title"]


def is_favorite(rows, song):
    return any(_same_song(row, song) for row in rows)


def add_favorite(text, rows, song, saved_at):
    """Append a song to the text list and the CSV rows; lines typed by hand are kept."""
    if is_favorite(rows, song):
        return text, rows
    if text and not text.endswith("\n"):
        text += "\n"
    return text + fav_line(song) + "\n", rows + [{**song, "saved_at": saved_at}]


def favorite_items(rows):
    """Favorites as shuffle picks: one per song, even when several share a release."""
    return [
        {"url": f"{row['bandcamp_url']}#{row['title']}", "page": row["bandcamp_url"], "song": row["title"],
         "title": row.get("album") or "", "artist": row.get("artist") or ""}
        for row in rows
        if row.get("bandcamp_url") and row.get("title")
    ]


def track_for_favorite(tracks, title):
    """The starred song among its release's tracks (titles compared loosely)."""
    wanted = title.strip().casefold()
    return next((track for track in tracks if track["title"].strip().casefold() == wanted), None)


def favorites_only():
    return FAVORITES_ONLY_FILE.exists()


def set_favorites_only(on):
    if on:
        FAVORITES_ONLY_FILE.parent.mkdir(parents=True, exist_ok=True)
        FAVORITES_ONLY_FILE.touch()
    else:
        FAVORITES_ONLY_FILE.unlink(missing_ok=True)
    return on


def remove_favorite(text, rows, song):
    line = fav_line(song)
    kept = [existing for existing in text.splitlines() if existing != line]
    return ("\n".join(kept) + "\n" if kept else ""), [row for row in rows if not _same_song(row, song)]


# --- I/O -------------------------------------------------------------------

def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", "replace")


def http_post_json(url, payload):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


def read_json(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False))
    tmp.replace(path)


def notify(message):
    subprocess.run(["notify-send", "-a", "Bandcamp shuffle", "Bandcamp shuffle", message], check=False)


# --- Collections -------------------------------------------------------------

def collection_file(fan):
    return COLLECTIONS_DIR / f"{fan['id']}.json"


def recent_file(fan):
    return CACHE_DIR / f"recent-{fan['id']}.json"


def current_fan():
    return read_json(FAN_FILE, None) or DEFAULT_FAN


def migrate_legacy_cache():
    """Move the single-collection cache (always fedexlatte) into the per-fan layout."""
    if LEGACY_COLLECTION_FILE.exists():
        items = read_json(LEGACY_COLLECTION_FILE, [])
        if items and not collection_file(DEFAULT_FAN).exists():
            write_json(collection_file(DEFAULT_FAN), {
                "fan": DEFAULT_FAN, "synced_at": LEGACY_COLLECTION_FILE.stat().st_mtime, "items": items,
            })
        LEGACY_COLLECTION_FILE.unlink()
    if LEGACY_RECENT_FILE.exists():
        if not recent_file(DEFAULT_FAN).exists():
            LEGACY_RECENT_FILE.replace(recent_file(DEFAULT_FAN))
        else:
            LEGACY_RECENT_FILE.unlink()


def sync(fan=None):
    fan = fan or current_fan()
    items, token = [], "9999999999::a::"
    while True:
        page, more, token = parse_collection_page(
            http_post_json(COLLECTION_API, {"fan_id": fan["id"], "older_than_token": token, "count": 100})
        )
        items.extend(page)
        if not more or not page:
            break
    items = dedupe(items)
    if not items:
        raise RuntimeError(f"@{fan['username']}'s collection is private or empty")
    write_json(collection_file(fan), {"fan": fan, "synced_at": time.time(), "items": items})
    print(f"Synced {len(items)} releases for @{fan['username']}")
    return items


def load_collection(fan):
    cached = read_json(collection_file(fan), {})
    if cached.get("items") and time.time() - cached.get("synced_at", 0) < MAX_CACHE_AGE:
        return cached["items"]
    return sync(fan)


def saved_collections():
    """(fan, release count) for every cached collection, by name."""
    saved = [read_json(path, {}) for path in COLLECTIONS_DIR.glob("*.json")]
    return sorted(((c["fan"], len(c["items"])) for c in saved if c.get("fan") and c.get("items")),
                  key=lambda entry: entry[0]["name"].lower())


def search_fans(text):
    return parse_fan_search(http_post_json(
        SEARCH_API, {"search_text": text, "search_filter": "f", "full_page": False, "fan_id": None}))


class FanNotFound(RuntimeError):
    """bandcamp.com/<username> doesn't exist — often a display name typed as a username."""


def lookup_fan(username):
    try:
        page = http_get(profile_url(username))
    except urllib.error.HTTPError as err:
        if err.code == 404:
            raise FanNotFound(f"No Bandcamp user @{username}") from None
        raise RuntimeError(f"Couldn't open @{username} (Bandcamp returned {err.code})") from None
    fan = parse_fan_page(page)
    if not fan:
        raise RuntimeError(f"bandcamp.com/{username} isn't a fan profile")
    return fan


def switch_to(fan):
    """Load a collection, then make it current; a failed load leaves the current one playing."""
    fan = {key: fan[key] for key in ("id", "username", "name")}
    if not read_json(collection_file(fan), {}).get("items"):
        notify(f"Loading @{fan['username']}'s collection…")
    items = load_collection(fan)
    write_json(FAN_FILE, fan)
    if running_pid():
        skip()
    notify(f"Now shuffling @{fan['username']} · {len(items):,} releases")


def running_pid():
    try:
        pid = int(PID_FILE.read_text())
        cmdline = Path(f"/proc/{pid}/cmdline").read_bytes()
    except (OSError, ValueError):
        return None
    return pid if b"bandcamp" in cmdline else None


class Player:
    def __init__(self):
        self.proc = None
        self.skipping = False
        self.stopping = False
        signal.signal(signal.SIGUSR1, self.skip)
        signal.signal(signal.SIGTERM, self.stop)
        signal.signal(signal.SIGINT, self.stop)

    def skip(self, *_):
        self.skipping = True
        if self.proc:
            self.proc.terminate()

    def stop(self, *_):
        self.stopping = True
        self.skip()

    def play(self, track):
        """Play one track; return True unless mpv failed on its own.

        A skip or stop that arrived between songs (while the next was being
        fetched, with no mpv to terminate) applies to this track instead of
        being lost.
        """
        if self.stopping:
            return True
        if self.skipping:
            self.skipping = False
            return True
        self.proc = subprocess.Popen([
            "mpv", "--no-video", "--really-quiet",
            f"--force-media-title={track['artist']} — {track['title']}",
            f"--volume={read_volume()}",
            f"--input-ipc-server={MPV_SOCKET}",
            track["url"],
        ])
        code = self.proc.wait()
        skipped, self.skipping = self.skipping, False
        if code != 0 and not skipped:
            print(f"mpv exited {code}: {track['artist']} — {track['title']}", flush=True)
        self.proc = None
        return code == 0 or skipped


def run():
    if running_pid():
        sys.exit("already running")
    PID_FILE.write_text(str(os.getpid()))
    try:
        player, rng, failures = Player(), random.Random(), 0
        fan, items, recent = None, [], []
        while not player.stopping:
            wanted = current_fan()
            if fan is None or wanted["id"] != fan["id"]:  # first pass, or `use` switched collections
                try:
                    items = load_collection(wanted)
                except (OSError, RuntimeError) as err:
                    print(f"couldn't load @{wanted['username']}: {err}", flush=True)
                    if fan is None:
                        notify(f"Couldn't load @{wanted['username']}'s collection: {err}")
                        break
                else:
                    fan, recent = wanted, read_json(recent_file(wanted), [])
            pool = []
            if favorites_only():
                pool = favorite_items(read_favorites()[1])
                if not pool:
                    set_favorites_only(False)
                    notify("No favorites yet, so shuffling the whole collection. Star songs with ☆ first.")
            if pool:
                # Favorites only: a starred song, re-fetched for a fresh stream link.
                pick = pick_release(pool, read_json(FAV_RECENT_FILE, []), rng)
                write_json(FAV_RECENT_FILE, push_recent(read_json(FAV_RECENT_FILE, []), pick["url"],
                                                        max(1, len(pool) // 2)))
                release = {"url": pick["page"], "title": pick["title"]}
            else:
                pick = None
                release = pick_release(items, recent, rng)
                recent = push_recent(recent, release["url"], RECENT_LIMIT)
                write_json(recent_file(fan), recent)
            try:
                tracks = parse_tralbum(http_get(release["url"]))
            except OSError as err:
                print(f"fetch failed: {release['url']}: {err}", flush=True)
                tracks = []
            if pick:
                starred = track_for_favorite(tracks, pick["song"])
                tracks = [starred] if starred else []
            if not tracks:
                print(f"nothing streamable: {release['url']}{' (' + pick['song'] + ')' if pick else ''}", flush=True)
            ok = False
            if tracks:
                track = rng.choice(tracks)
                write_json(NOW_FILE, now_playing(track, release))
                ok = player.play(track)
            failures = 0 if ok else failures + 1
            if failures >= MAX_FAILURES:
                notify(f"Stopped after {MAX_FAILURES} tracks in a row failed to play")
                break
    finally:
        if running_pid() == os.getpid():
            PID_FILE.unlink(missing_ok=True)
            NOW_FILE.unlink(missing_ok=True)


def start():
    if running_pid():
        return skip()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with open(LOG_FILE, "a") as log:
        subprocess.Popen(
            [sys.executable, os.path.realpath(__file__), "run"],
            stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True,
        )


def skip():
    pid = running_pid()
    if pid:
        os.kill(pid, signal.SIGUSR1)


def stop():
    pid = running_pid()
    if pid:
        os.kill(pid, signal.SIGTERM)


def status():
    sys.exit(0 if running_pid() else 1)


def info():
    """One-line JSON for the bar widget."""
    song = current_song()
    print(json.dumps({
        "playing": bool(running_pid()), "volume": read_volume(), "fan": current_fan(),
        "favorites_only": favorites_only(),
        "song": song, "favorite": bool(song) and is_favorite(read_favorites()[1], song),
    }))


def fan():
    current = current_fan()
    print(f"{current['name']} (@{current['username']}) {profile_url(current['username'])}")


def use(target):
    """Switch to the collection at a bandcamp.com/<username> link, @handle, or username."""
    username = parse_profile_input(target) or target.strip().lstrip("@")
    if not re.fullmatch(r"[\w-]+", username):
        raise RuntimeError(f"Not a Bandcamp username or profile link: {target}")
    try:
        found = lookup_fan(username)
    except FanNotFound as err:
        similar = search_fans(username)
        if similar:
            best = similar[0]
            raise RuntimeError(f"{err}. Did you mean {best['name']} (@{best['username']})? "
                               f"Run: bandcamp-shuffle use {best['username']}") from None
        raise
    switch_to(found)


def search(text):
    for found in search_fans(text):
        print(f"{found['username']}\t{found['name']}\t{found['collection_size']}")


# --- Favorites ---------------------------------------------------------------
# ~/Documents/Bandcamp Favorites.txt is the import-ready "Artist - Title" list;
# the .csv next to it keeps album, Bandcamp link, and when it was saved.

def favorites_paths():
    docs = documents_dir()
    return docs / "Bandcamp Favorites.txt", docs / "Bandcamp Favorites.csv"


def read_favorites():
    txt_path, csv_path = favorites_paths()
    text = txt_path.read_text() if txt_path.exists() else ""
    rows = list(csv.DictReader(io.StringIO(csv_path.read_text()))) if csv_path.exists() else []
    return text, rows


def write_favorites(text, rows):
    txt_path, csv_path = favorites_paths()
    txt_path.parent.mkdir(parents=True, exist_ok=True)
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=FAV_FIELDS, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    for path, content in ((txt_path, text), (csv_path, out.getvalue())):
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(content)
        tmp.replace(path)


def current_song():
    return read_json(NOW_FILE, None) if running_pid() else None


def fav():
    """Star the song that's playing, or unstar it if it's already a favorite."""
    song = current_song()
    if not song:
        raise RuntimeError("Nothing is playing")
    text, rows = read_favorites()
    if is_favorite(rows, song):
        write_favorites(*remove_favorite(text, rows, song))
        notify(f"Removed from favorites: {fav_line(song)}")
    else:
        write_favorites(*add_favorite(text, rows, song, time.strftime("%Y-%m-%d %H:%M")))
        notify(f"★ Saved to favorites: {fav_line(song)}")


def favs():
    txt_path, _ = favorites_paths()
    print(txt_path)
    print(read_favorites()[0], end="")


def open_favorites():
    txt_path, _ = favorites_paths()
    if not txt_path.exists():
        write_favorites(*read_favorites())
    subprocess.Popen([omarchy_tool("omarchy-launch-editor"), str(txt_path)], start_new_session=True)


def favonly(action="toggle"):
    """Shuffle only starred songs: favonly [on|off|toggle]. The setting is saved."""
    if action not in {"on", "off", "toggle"}:
        raise ValueError("favonly takes on, off, or toggle")
    on = set_favorites_only(not favorites_only() if action == "toggle" else action == "on")
    count = len(favorite_items(read_favorites()[1]))
    if on and not count:
        set_favorites_only(False)
        raise RuntimeError("No favorites yet. Star songs with ☆ first.")
    print("on" if on else "off")
    notify(f"Shuffling favorites only ({count} song{'' if count == 1 else 's'})" if on
           else "Shuffling the whole collection")
    if running_pid():
        skip()  # the next song follows the new mode


def find():
    """The search icon: straight to the search box."""
    search_menu()


# --- Menu (omarchy-menu-select / omarchy-menu-input) --------------------------

def omarchy_tool(name):
    return shutil.which(name) or str(OMARCHY_BIN / name)


def menu_select(prompt, rows):
    result = subprocess.run([omarchy_tool("omarchy-menu-select"), prompt, *rows, "--", "--width", "440"],
                            capture_output=True, text=True)
    return result.stdout.rstrip("\n") if result.returncode == 0 else None


def menu_input(prompt):
    result = subprocess.run([omarchy_tool("omarchy-menu-input"), prompt, "--width", "440"],
                            capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None


MENU_STOP = "Stop"
MENU_SEARCH = "Search users or paste a link…"
MENU_DEFAULT = "Back to fedexlatte"
MENU_RESYNC = "Resync current collection"
MENU_FAVORITES = "Favorites list"
MENU_FAV_ONLY = "Shuffle favorites only"


def pick():
    """The right-click / Super+Alt+B menu."""
    current = current_fan()
    saved = saved_collections()
    rows = [f"{GLYPH_STOP}\t{MENU_STOP}"] if running_pid() else []
    rows.append(f"{GLYPH_SEARCH}\t{MENU_SEARCH}")
    rows += [fan_row(f, size, current=f["id"] == current["id"]) for f, size in saved]
    if current["id"] != DEFAULT_FAN["id"] and all(f["id"] != DEFAULT_FAN["id"] for f, _ in saved):
        rows.append(f"{GLYPH_HOME}\t{MENU_DEFAULT}")
    rows.append(f"{GLYPH_STAR}\t{MENU_FAVORITES}")
    rows.append(f"{GLYPH_CURRENT if favorites_only() else GLYPH_STAR_EMPTY}\t{MENU_FAV_ONLY}")
    rows.append(f"{GLYPH_RESYNC}\t{MENU_RESYNC}")

    choice = menu_select("Bandcamp shuffle", rows)
    if choice is None:
        return
    if choice == MENU_STOP:
        return stop()
    if choice == MENU_SEARCH:
        return search_menu()
    if choice == MENU_DEFAULT:
        return switch_to(DEFAULT_FAN)
    if choice == MENU_FAVORITES:
        return open_favorites()
    if choice == MENU_FAV_ONLY:
        return favonly()
    if choice == MENU_RESYNC:
        notify(f"Resyncing @{current['username']}…")
        items = sync(current)
        return notify(f"@{current['username']} · {len(items):,} releases")
    username = username_from_selection(choice)
    chosen = next((f for f, _ in saved if f["username"] == username), None)
    if chosen:
        switch_to(chosen)


def search_menu():
    text = menu_input("Search users or paste bandcamp.com/username")
    if not text:
        return
    username = parse_profile_input(text)
    if username:
        try:
            return switch_to(lookup_fan(username))
        except FanNotFound:
            # Display names aren't usernames (hotPai is @onepie), so offer similar names.
            found = search_fans(username)
            if not found:
                return notify(f"No Bandcamp user @{username}, and no similar names")
            prompt = f"No user @{username} — similar names"
    else:
        found = search_fans(text)
        if not found:
            return notify(f'No Bandcamp users match "{text}"')
        prompt = f'Users matching "{text}"'
    choice = menu_select(prompt, [fan_row(f, f["collection_size"]) for f in found])
    if choice is None:
        return
    username = username_from_selection(choice)
    chosen = next((f for f in found if f["username"] == username), None)
    if chosen and not chosen["collection_size"]:
        return notify(f"@{username}'s collection is private or empty")
    if chosen:
        switch_to(chosen)


def read_volume():
    try:
        return adjust_volume(100, VOLUME_FILE.read_text().strip())
    except (OSError, ValueError):
        return 100


def volume(action=None):
    """Print the volume, after changing it (live, if a track is playing) when given an action."""
    level = read_volume()
    if action is not None:
        level = adjust_volume(level, action)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        VOLUME_FILE.write_text(str(level))
        if running_pid():
            try:
                with socket.socket(socket.AF_UNIX) as sock:
                    sock.connect(str(MPV_SOCKET))
                    sock.sendall(json.dumps({"command": ["set_property", "volume", level]}).encode() + b"\n")
            except OSError:
                pass  # between tracks; the next one starts at the saved level
    print(level)


COMMANDS = {
    "sync": sync, "run": run, "start": start, "skip": skip, "stop": stop, "status": status, "volume": volume,
    "info": info, "fan": fan, "use": use, "search": search, "pick": pick,
    "fav": fav, "favs": favs, "find": find, "favonly": favonly,
}
ONE_ARG = {"volume", "use", "search", "favonly"}  # volume's and favonly's argument is optional
USAGE = (f"usage: bandcamp-shuffle {{{'|'.join(COMMANDS)}}}\n"
         "  volume [up|down|0-100]   use <bandcamp.com/username|@username>   search <text>\n"
         "  favonly [on|off|toggle]")
INTERACTIVE = {"use", "pick", "fav", "find", "favonly"}  # launched from the bar or a key: report problems as notifications


def main(argv):
    command, args = (argv[1], argv[2:]) if len(argv) > 1 else (None, [])
    if command not in COMMANDS:
        sys.exit(USAGE)
    if command in ONE_ARG and args:
        args = [" ".join(args)]  # search text may contain spaces
    if len(args) > (1 if command in ONE_ARG else 0) or (command in {"use", "search"} and not args):
        sys.exit(USAGE)
    try:
        migrate_legacy_cache()
        COMMANDS[command](*args)
    except (ValueError, RuntimeError, OSError) as err:
        if command in INTERACTIVE:
            notify(str(err))
        sys.exit(str(err))


if __name__ == "__main__":
    main(sys.argv)
