#!/usr/bin/env python3
"""Continuous shuffle radio over a public Bandcamp collection."""

import html
import json
import re

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
    """Return (items, more_available, last_token) from a collection_items response."""
    items = [
        {"url": item["item_url"], "title": item.get("item_title") or "", "artist": item.get("band_name") or ""}
        for item in data.get("items") or []
        if item.get("item_url")
    ]
    return items, bool(data.get("more_available")), data.get("last_token") or ""


def pick_release(items, recent, rng):
    recent = set(recent)
    fresh = [item for item in items if item["url"] not in recent]
    return rng.choice(fresh or items)


def push_recent(recent, url, limit=50):
    recent = [u for u in recent if u != url] + [url]
    return recent[-limit:]
