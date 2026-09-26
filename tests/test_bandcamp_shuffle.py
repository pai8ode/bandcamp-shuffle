import json
import random
import signal
import sys
import unittest
from unittest import mock
from tempfile import TemporaryDirectory
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

    def test_token_comes_from_last_item_not_last_token(self):
        # With count=100 the API's last_token lags ~20 items behind the page end.
        data = json.loads((FIXTURES / "collection_items.json").read_text())
        data["last_token"] = data["items"][0]["token"]

        _, _, token = bs.parse_collection_page(data)

        self.assertEqual(token, data["items"][-1]["token"])


class DedupeTest(unittest.TestCase):
    def test_keeps_first_occurrence_of_each_url(self):
        items = [{"url": "a", "title": "1"}, {"url": "b"}, {"url": "a", "title": "2"}]
        self.assertEqual(bs.dedupe(items), [{"url": "a", "title": "1"}, {"url": "b"}])


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


class AdjustVolumeTest(unittest.TestCase):
    def test_steps_up_and_down_by_five(self):
        self.assertEqual(bs.adjust_volume(50, "up"), 55)
        self.assertEqual(bs.adjust_volume(50, "down"), 45)

    def test_clamps_to_zero_and_hundred(self):
        self.assertEqual(bs.adjust_volume(98, "up"), 100)
        self.assertEqual(bs.adjust_volume(3, "down"), 0)
        self.assertEqual(bs.adjust_volume(50, "150"), 100)
        self.assertEqual(bs.adjust_volume(50, "-10"), 0)

    def test_sets_absolute_level(self):
        self.assertEqual(bs.adjust_volume(50, "72"), 72)

    def test_rejects_unknown_action(self):
        with self.assertRaises(ValueError):
            bs.adjust_volume(50, "loud")


class ProfileInputTest(unittest.TestCase):
    def test_reads_usernames_from_links_and_handles(self):
        self.assertEqual(bs.parse_profile_input("https://bandcamp.com/fedexlatte"), "fedexlatte")
        self.assertEqual(bs.parse_profile_input("bandcamp.com/fedexlatte"), "fedexlatte")
        self.assertEqual(bs.parse_profile_input("  www.bandcamp.com/some_fan-1/wishlist?from=menubar "), "some_fan-1")
        self.assertEqual(bs.parse_profile_input("@fedexlatte"), "fedexlatte")

    def test_leaves_plain_text_and_non_profile_links_for_search(self):
        for text in ["fedex", "two words", "", "https://artist.bandcamp.com/album/x",
                     "https://bandcamp.com/search?q=x", "https://bandcamp.com/discover"]:
            self.assertIsNone(bs.parse_profile_input(text), text)


class FanPageTest(unittest.TestCase):
    def test_reads_the_fan_behind_a_profile_page(self):
        page = (FIXTURES / "fan_page.html").read_text()
        self.assertEqual(bs.parse_fan_page(page),
                         {"id": 2201246, "username": "fedexlatte", "name": "p", "collection_size": 1439})

    def test_other_pages_are_not_fans(self):
        self.assertIsNone(bs.parse_fan_page("<html>not a fan page</html>"))


class FanSearchTest(unittest.TestCase):
    def test_returns_fans_with_collection_sizes(self):
        fans = bs.parse_fan_search(json.loads((FIXTURES / "search_fans.json").read_text()))
        self.assertEqual(fans[0], {"id": fans[0]["id"], "username": "_fede", "name": "_fede", "collection_size": 9})
        self.assertEqual(bs.parse_fan_search({"auto": {"results": [{"type": "b", "id": 1}]}}), [])
        self.assertEqual(bs.parse_fan_search({}), [])


class MenuRowTest(unittest.TestCase):
    FAN = {"id": 1, "username": "some_fan", "name": "Some Fan"}

    def test_row_shows_name_handle_and_size(self):
        self.assertEqual(bs.fan_row(self.FAN, 1375), bs.GLYPH_FAN + "\tSome Fan\t@some_fan · 1,375 releases")
        self.assertEqual(bs.fan_row(self.FAN, 1), bs.GLYPH_FAN + "\tSome Fan\t@some_fan · 1 release")
        self.assertEqual(bs.fan_row(self.FAN, 0), bs.GLYPH_FAN + "\tSome Fan\t@some_fan · private or empty")
        self.assertTrue(bs.fan_row(self.FAN, 3, current=True).startswith(bs.GLYPH_CURRENT + "\t"))

    def test_selection_maps_back_to_username(self):
        self.assertEqual(bs.username_from_selection("Some Fan\t@some_fan · 1,375 releases"), "some_fan")
        self.assertIsNone(bs.username_from_selection("Resync current collection"))


class PickMenuTest(unittest.TestCase):
    FEDEX = bs.DEFAULT_FAN
    OTHER = {"id": 9, "username": "_fede", "name": "_fede"}

    def run_pick(self, choices, inputs=(), running=False, current=None, saved=None, found=(), profiles=None):
        """Run pick() with scripted menu answers; return what it did."""
        calls = {"switch": [], "stop": 0, "notify": [], "menus": []}
        choices, inputs = list(choices), list(inputs)
        profiles = profiles or {}

        def lookup(username):
            if username not in profiles:
                raise bs.FanNotFound(f"No Bandcamp user @{username}")
            return profiles[username]

        def select(prompt, rows):
            calls["menus"].append((prompt, rows))
            return choices.pop(0) if choices else None

        with mock.patch.multiple(
            bs,
            menu_select=select,
            menu_input=lambda prompt: inputs.pop(0) if inputs else None,
            running_pid=lambda: 123 if running else None,
            current_fan=lambda: current or self.FEDEX,
            saved_collections=lambda: saved if saved is not None else [(self.FEDEX, 1375), (self.OTHER, 9)],
            search_fans=lambda text: calls.setdefault("searched", []).append(text) or list(found),
            lookup_fan=lambda username: lookup(username),
            switch_to=lambda fan: calls["switch"].append(fan["username"]),
            use=lambda target: calls["switch"].append(f"use:{target}"),
            stop=lambda: calls.__setitem__("stop", calls["stop"] + 1),
            notify=lambda message: calls["notify"].append(message),
            open_favorites=lambda: calls.__setitem__("opened_favorites", True),
            favorites_only=lambda: False,
            favonly=lambda: calls.__setitem__("toggled_favonly", True),
        ):
            bs.pick()
        return calls

    def test_menu_lists_stop_search_saved_collections_and_resync(self):
        rows = self.run_pick([], running=True)["menus"][0][1]
        self.assertEqual([row.split("\t")[1] for row in rows],
                         [bs.MENU_STOP, bs.MENU_SEARCH, "p", "_fede", bs.MENU_FAVORITES, bs.MENU_FAV_ONLY,
                          bs.MENU_RESYNC])
        self.assertTrue(rows[2].startswith(bs.GLYPH_CURRENT))  # fedexlatte is current

    def test_stop_only_shows_while_playing(self):
        rows = self.run_pick([])["menus"][0][1]
        self.assertNotIn(bs.MENU_STOP, [row.split("\t")[1] for row in rows])

    def test_back_to_default_shows_when_fedexlatte_is_not_saved(self):
        rows = self.run_pick([], current=self.OTHER, saved=[(self.OTHER, 9)])["menus"][0][1]
        self.assertIn(bs.MENU_DEFAULT, [row.split("\t")[1] for row in rows])

    def test_choosing_a_saved_collection_switches_to_it(self):
        self.assertEqual(self.run_pick(["_fede\t@_fede · 9 releases"])["switch"], ["_fede"])

    def test_choosing_favorites_opens_the_list(self):
        self.assertTrue(self.run_pick([bs.MENU_FAVORITES]).get("opened_favorites"))

    def test_choosing_favorites_only_toggles_it(self):
        self.assertTrue(self.run_pick([bs.MENU_FAV_ONLY]).get("toggled_favonly"))

    def test_choosing_stop_stops(self):
        self.assertEqual(self.run_pick([bs.MENU_STOP], running=True)["stop"], 1)

    def test_dismissing_the_menu_does_nothing(self):
        calls = self.run_pick([])
        self.assertEqual((calls["switch"], calls["stop"], calls["notify"]), ([], 0, []))

    def test_pasting_a_link_switches_directly(self):
        someone = {"id": 7, "username": "someone", "name": "Someone"}
        calls = self.run_pick([bs.MENU_SEARCH], inputs=["bandcamp.com/someone"], profiles={"someone": someone})
        self.assertEqual(calls["switch"], ["someone"])
        self.assertEqual(len(calls["menus"]), 1)  # no results list for a link

    def test_link_to_a_missing_user_offers_similar_names(self):
        found = [{"id": 8, "username": "onepie", "name": "hotPai", "collection_size": 2}]
        calls = self.run_pick([bs.MENU_SEARCH, "hotPai\t@onepie · 2 releases"], inputs=["@hotPai"], found=found)
        self.assertEqual(calls["searched"], ["hotPai"])
        self.assertEqual(calls["menus"][1][0], "No user @hotPai — similar names")
        self.assertEqual(calls["switch"], ["onepie"])

    def test_link_to_a_missing_user_with_no_similar_names_says_so(self):
        calls = self.run_pick([bs.MENU_SEARCH], inputs=["@zzzz"], found=[])
        self.assertEqual(calls["notify"], ["No Bandcamp user @zzzz, and no similar names"])

    def test_searching_lists_users_then_switches_to_the_pick(self):
        found = [{"id": 5, "username": "fede", "name": "Fede", "collection_size": 1},
                 {"id": 6, "username": "fede_", "name": "fede_", "collection_size": 0}]
        calls = self.run_pick([bs.MENU_SEARCH, "Fede\t@fede · 1 release"], inputs=["fede"], found=found)
        self.assertEqual(calls["menus"][1][0], 'Users matching "fede"')
        self.assertEqual(calls["switch"], ["fede"])

    def test_picking_a_private_collection_explains_instead_of_switching(self):
        found = [{"id": 6, "username": "fede_", "name": "fede_", "collection_size": 0}]
        calls = self.run_pick([bs.MENU_SEARCH, "fede_\t@fede_ · private or empty"], inputs=["fede"], found=found)
        self.assertEqual(calls["switch"], [])
        self.assertIn("private or empty", calls["notify"][0])

    def test_search_with_no_results_says_so(self):
        calls = self.run_pick([bs.MENU_SEARCH], inputs=["zzzz"], found=[])
        self.assertEqual(calls["notify"], ['No Bandcamp users match "zzzz"'])


class UseSuggestionTest(unittest.TestCase):
    def test_use_suggests_the_closest_name_for_a_missing_user(self):
        found = [{"id": 8, "username": "onepie", "name": "hotPai", "collection_size": 2}]
        with mock.patch.multiple(bs, lookup_fan=mock.Mock(side_effect=bs.FanNotFound("No Bandcamp user @hotPai")),
                                 search_fans=lambda text: found):
            with self.assertRaises(RuntimeError) as caught:
                bs.use("bandcamp.com/hotPai")
        self.assertEqual(str(caught.exception),
                         "No Bandcamp user @hotPai. Did you mean hotPai (@onepie)? Run: bandcamp-shuffle use onepie")


class FavoritesTest(unittest.TestCase):
    SONG = {"artist": "Clem Snide", "title": "Hilary", "album": "Moral Minority",
            "bandcamp_url": "https://clemsnide.bandcamp.com/album/moral-minority"}
    OTHER = {"artist": "Erykah Badu & The Alchemist", "title": "Witch Doctor", "album": "Before The World Blows",
             "bandcamp_url": "https://controlfreaq.bandcamp.com/album/before-the-world-blows"}

    def test_now_playing_combines_track_and_release(self):
        track = {"title": "Hilary", "artist": "Clem Snide", "url": "https://t4.bcbits.com/stream/x"}
        release = {"url": self.SONG["bandcamp_url"], "title": "Moral Minority", "artist": "Clem Snide"}
        self.assertEqual(bs.now_playing(track, release), self.SONG)

    def test_line_is_import_ready(self):
        self.assertEqual(bs.fav_line(self.SONG), "Clem Snide - Hilary")

    def test_add_appends_to_text_and_rows(self):
        text, rows = bs.add_favorite("", [], self.SONG, "2026-09-25 23:40")
        self.assertEqual(text, "Clem Snide - Hilary\n")
        self.assertEqual(rows, [{**self.SONG, "saved_at": "2026-09-25 23:40"}])
        self.assertTrue(bs.is_favorite(rows, self.SONG))
        self.assertFalse(bs.is_favorite(rows, self.OTHER))

    def test_adding_twice_does_not_duplicate(self):
        text, rows = bs.add_favorite("", [], self.SONG, "t1")
        self.assertEqual(bs.add_favorite(text, rows, self.SONG, "t2"), (text, rows))

    def test_add_keeps_hand_written_lines(self):
        text, _ = bs.add_favorite("my note\nSome Artist - Some Song", [], self.SONG, "t")
        self.assertEqual(text, "my note\nSome Artist - Some Song\nClem Snide - Hilary\n")

    def test_remove_drops_only_that_song(self):
        text, rows = bs.add_favorite("my note\n", [], self.SONG, "t1")
        text, rows = bs.add_favorite(text, rows, self.OTHER, "t2")
        text, rows = bs.remove_favorite(text, rows, self.SONG)
        self.assertEqual(text, "my note\nErykah Badu & The Alchemist - Witch Doctor\n")
        self.assertEqual([r["title"] for r in rows], ["Witch Doctor"])
        self.assertFalse(bs.is_favorite(rows, self.SONG))


class FavoritesOnlyTest(unittest.TestCase):
    ROWS = [
        {"saved_at": "t1", "artist": "Clem Snide", "title": "Hilary", "album": "Moral Minority",
         "bandcamp_url": "https://clemsnide.bandcamp.com/album/moral-minority"},
        {"saved_at": "t2", "artist": "Clem Snide", "title": "Moral Minority", "album": "Moral Minority",
         "bandcamp_url": "https://clemsnide.bandcamp.com/album/moral-minority"},
    ]

    def test_each_favorite_is_its_own_pick(self):
        items = bs.favorite_items(self.ROWS)
        self.assertEqual(len({item["url"] for item in items}), 2)  # same release, two songs
        self.assertEqual(items[0]["page"], "https://clemsnide.bandcamp.com/album/moral-minority")
        self.assertEqual(items[0]["song"], "Hilary")
        self.assertEqual(items[0]["title"], "Moral Minority")  # album, as now_playing expects

    def test_rows_without_a_link_are_skipped(self):
        self.assertEqual(bs.favorite_items([{"title": "x", "bandcamp_url": ""}]), [])

    def test_finds_the_starred_track_on_its_release(self):
        tracks = [{"title": "Intro", "artist": "a", "url": "u1"}, {"title": "Hilary", "artist": "a", "url": "u2"}]
        self.assertEqual(bs.track_for_favorite(tracks, "Hilary")["url"], "u2")
        self.assertEqual(bs.track_for_favorite(tracks, "hilary ")["url"], "u2")
        self.assertIsNone(bs.track_for_favorite(tracks, "Gone"))

    def test_mode_toggles_and_persists(self):
        with mock.patch.object(bs, "FAVORITES_ONLY_FILE", Path(self.enterContext(TemporaryDirectory())) / "flag"):
            self.assertFalse(bs.favorites_only())
            self.assertTrue(bs.set_favorites_only(True))
            self.assertTrue(bs.favorites_only())
            self.assertFalse(bs.set_favorites_only(False))
            self.assertFalse(bs.favorites_only())


class PlayerSignalTest(unittest.TestCase):
    """Skip and stop can arrive between songs, while the next one is being fetched."""
    TRACK = {"artist": "a", "title": "t", "url": "u"}

    def setUp(self):
        handlers = {sig: signal.getsignal(sig) for sig in (signal.SIGUSR1, signal.SIGTERM, signal.SIGINT)}
        self.addCleanup(lambda: [signal.signal(sig, handler) for sig, handler in handlers.items()])
        self.popen = self.enterContext(mock.patch.object(bs.subprocess, "Popen"))
        self.popen.return_value.wait.return_value = 0
        self.enterContext(mock.patch.object(bs, "read_volume", return_value=100))
        self.player = bs.Player()

    def test_skip_between_songs_skips_the_next_one(self):
        self.player.skip()
        self.assertTrue(self.player.play(self.TRACK))
        self.popen.assert_not_called()
        self.player.play(self.TRACK)  # the skip was used up
        self.popen.assert_called_once()

    def test_stop_between_songs_plays_nothing(self):
        self.player.stop()
        self.player.play(self.TRACK)
        self.popen.assert_not_called()
        self.assertTrue(self.player.stopping)

    def test_skip_during_a_song_ends_it_and_is_used_up(self):
        def skip_while_playing():
            self.player.skip()
            return -15
        self.popen.return_value.wait.side_effect = skip_while_playing
        self.assertTrue(self.player.play(self.TRACK))  # skipped counts as fine, not a failure
        self.popen.return_value.terminate.assert_called_once()
        self.popen.return_value.wait.side_effect = None
        self.popen.return_value.wait.return_value = 1
        self.assertFalse(self.player.play(self.TRACK))  # a real mpv failure afterwards still counts


if __name__ == "__main__":
    unittest.main()
