#!/usr/bin/env python3
"""Continuous shuffle radio over a public Bandcamp collection."""

import html
import json
import os
import random
import re
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

FAN_ID = 2201246
COLLECTION_API = "https://bandcamp.com/api/fancollection/1/collection_items"
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) bandcamp-shuffle"
CACHE_DIR = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "bandcamp-shuffle"
COLLECTION_FILE = CACHE_DIR / "collection.json"
RECENT_FILE = CACHE_DIR / "recent.json"
LOG_FILE = CACHE_DIR / "log"
PID_FILE = Path(os.environ.get("XDG_RUNTIME_DIR", "/tmp")) / "bandcamp-shuffle.pid"
MAX_CACHE_AGE = 7 * 24 * 3600
RECENT_LIMIT = 50
MAX_FAILURES = 5

TRALBUM_RE = re.compile(r'data-tralbum="([^"]*)"')


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
    subprocess.run(["notify-send", "Bandcamp shuffle", message], check=False)


# --- Commands --------------------------------------------------------------

def sync():
    items, token = [], "9999999999::a::"
    while True:
        page, more, token = parse_collection_page(
            http_post_json(COLLECTION_API, {"fan_id": FAN_ID, "older_than_token": token, "count": 100})
        )
        items.extend(page)
        if not more or not page:
            break
    items = dedupe(items)
    write_json(COLLECTION_FILE, items)
    print(f"Synced {len(items)} releases")
    return items


def load_collection():
    try:
        fresh = time.time() - COLLECTION_FILE.stat().st_mtime < MAX_CACHE_AGE
    except OSError:
        fresh = False
    items = read_json(COLLECTION_FILE, []) if fresh else []
    return items or sync()


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
        """Play one track; return True unless mpv failed on its own."""
        self.skipping = False
        self.proc = subprocess.Popen([
            "mpv", "--no-video", "--really-quiet",
            f"--force-media-title={track['artist']} — {track['title']}",
            track["url"],
        ])
        code = self.proc.wait()
        self.proc = None
        return code == 0 or self.skipping


def run():
    if running_pid():
        sys.exit("already running")
    PID_FILE.write_text(str(os.getpid()))
    try:
        items = load_collection()
        player, rng, failures = Player(), random.Random(), 0
        recent = read_json(RECENT_FILE, [])
        while not player.stopping:
            release = pick_release(items, recent, rng)
            recent = push_recent(recent, release["url"], RECENT_LIMIT)
            write_json(RECENT_FILE, recent)
            try:
                tracks = parse_tralbum(http_get(release["url"]))
            except OSError as err:
                print(f"fetch failed: {release['url']}: {err}", flush=True)
                tracks = []
            ok = bool(tracks) and player.play(rng.choice(tracks))
            failures = 0 if ok else failures + 1
            if failures >= MAX_FAILURES:
                notify(f"Stopped after {MAX_FAILURES} tracks in a row failed to play")
                break
    finally:
        if running_pid() == os.getpid():
            PID_FILE.unlink(missing_ok=True)


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


COMMANDS = {"sync": sync, "run": run, "start": start, "skip": skip, "stop": stop, "status": status}


def main(argv):
    if len(argv) != 2 or argv[1] not in COMMANDS:
        sys.exit(f"usage: bandcamp-shuffle {{{'|'.join(COMMANDS)}}}")
    COMMANDS[argv[1]]()


if __name__ == "__main__":
    main(sys.argv)
