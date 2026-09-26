import json
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import bandcamp_shuffle as bs

FIXTURES = Path(__file__).parent / "fixtures"


class ParseTralbumTest(unittest.TestCase):
    def test_returns_streamable_tracks_with_metadata(self):
        tracks = bs.parse_tralbum((FIXTURES / "album.html").read_text())

        self.assertEqual(len(tracks), 5)
        for track in tracks:
            self.assertTrue(track["title"])
            self.assertTrue(track["artist"])
            self.assertIn("mp3-128", track["url"])

    def test_page_without_tralbum_returns_nothing(self):
        self.assertEqual(bs.parse_tralbum("<html></html>"), [])


class ParseCollectionPageTest(unittest.TestCase):
    def test_extracts_items_and_paging(self):
        data = json.loads((FIXTURES / "collection_items.json").read_text())

        items, more, token = bs.parse_collection_page(data)

        self.assertEqual(len(items), 3)
        self.assertEqual(items[1], {
            "url": "https://celadonplaza.bandcamp.com/album/collection-keygen-h-update",
            "title": "続編 Collection: keygen_h​.​update",
            "artist": "haircuts for men",
        })
        self.assertTrue(more)
        self.assertEqual(token, "1783701096:3658257947:a::")


class SelectionTest(unittest.TestCase):
    ITEMS = [{"url": f"u{i}"} for i in range(5)]

    def test_pick_release_avoids_recent(self):
        recent = ["u0", "u1", "u2", "u3"]
        for seed in range(20):
            self.assertEqual(bs.pick_release(self.ITEMS, recent, random.Random(seed))["url"], "u4")

    def test_pick_release_falls_back_when_everything_is_recent(self):
        recent = [item["url"] for item in self.ITEMS]
        self.assertIn(bs.pick_release(self.ITEMS, recent, random.Random(1)), self.ITEMS)

    def test_push_recent_dedupes_and_trims(self):
        self.assertEqual(bs.push_recent(["a", "b", "c"], "a", limit=3), ["b", "c", "a"])
        self.assertEqual(bs.push_recent(["a", "b", "c"], "d", limit=3), ["b", "c", "d"])


if __name__ == "__main__":
    unittest.main()
