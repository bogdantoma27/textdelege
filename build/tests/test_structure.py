import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace

import contextlib
import gzip
import io

from build.textdelege.structure import Breaker, article_number, load, parse_structure, remote_key

# Snippets are cut from the official portal pages (event attributes and article bodies
# shortened): the Civil Code (legea 287/2009), the Fiscal Code (legea 227/2015) and legea 53/2003.


def unit(kind: str, label: str, name: str, body: str = "") -> str:
    return (
        f'<span class="S_{kind}" id="id_{kind.lower()}A1"><span class="TAG_COLLAPSED"> + </span>'
        f'<span class="S_{kind}_TTL">{label}</span><span class="S_{kind}_DEN"> {name}<!----></span>'
        f'<span class="S_{kind}_BDY">{body}</span></span>'
    )


def art(label: str) -> str:
    return (
        f'<span class="S_ART" id="id_artA9"><span class="S_ART_TTL">{label}</span>'
        '<span class="S_ART_DEN"><!----></span><span class="S_ART_BDY">'
        '<span class="S_ALN"><span class="S_ALN_TTL">(1)</span>'
        '<span class="S_ALN_BDY">Text.</span></span></span></span>'
    )


CIVIL = (
    "<html><body>"
    + unit("TTL", "Titlul PRELIMINAR", "Despre legea civilă**)", unit("CAP", "Capitolul I", "Dispoziții generale", art("Articolul 1") + art("Articolul 2")))
    + unit(
        "CRT", "Cartea I", "Despre persoane*)",
        unit("TTL", "Titlul I", "Dispoziții generale", art("Articolul 3"))
        + unit(
            "TTL", "Titlul II", "Persoana fizică",
            unit(
                "CAP", "Capitolul I", "Capacitatea civilă a persoanei fizice",
                unit("SEC", "Secţiunea 1", "Capacitatea de folosință", art("Articolul 4"))
                + unit("SEC", "Secţiunea a 2-a", "Capacitatea de exercițiu", art("Articolul 5") + art("Articolul 5^1")),
            )
            + art("Articolul 6"),
        ),
    )
    + unit("CRT", "Cartea a II-a", "Despre familie", unit("TTL", "Titlul I", "Căsătoria", art("Articolul 1.112")))
    + "</body></html>"
)


def names(structure: dict, number: str) -> list[str]:
    """Label of the heading of an article and of each of its ancestors, outermost first."""
    headings = structure["headings"]
    index = structure["articles"][number]
    path = [headings[index]]
    for earlier in reversed(headings[:index]):
        if earlier["depth"] < path[0]["depth"]:
            path.insert(0, earlier)
    return [heading["label"] for heading in path]


class ParseStructureTest(unittest.TestCase):
    def test_nests_carte_titlu_capitol_sectiune(self):
        structure = parse_structure(CIVIL)
        self.assertEqual(names(structure, "4"), ["Cartea I", "Titlul II", "Capitolul I", "Secțiunea 1"])
        self.assertEqual(names(structure, "5"), ["Cartea I", "Titlul II", "Capitolul I", "Secțiunea a 2-a"])
        self.assertEqual(names(structure, "3"), ["Cartea I", "Titlul I"])

    def test_an_article_keeps_the_deepest_heading_still_open(self):
        # The rank rule does not look at the markup nesting: only a new heading closes a rank.
        structure = parse_structure(CIVIL)
        self.assertEqual(names(structure, "6"), ["Cartea I", "Titlul II", "Capitolul I", "Secțiunea a 2-a"])

    def test_the_preliminary_title_comes_before_the_first_carte_and_is_closed_by_it(self):
        structure = parse_structure(CIVIL)
        self.assertEqual(names(structure, "1"), ["Titlul PRELIMINAR", "Capitolul I"])
        first = structure["headings"][0]
        self.assertEqual((first["kind"], first["depth"]), ("ttl", 0))
        # The later "Titlul I" of Cartea I is a different heading, one level deeper.
        self.assertEqual(structure["headings"][structure["articles"]["3"]]["depth"], 1)
        self.assertEqual(names(structure, "1112"), ["Cartea a II-a", "Titlul I"])

    def test_depth_counts_the_non_empty_ranks_above(self):
        structure = parse_structure(CIVIL)
        by_label = {(h["label"], h["name"]): h["depth"] for h in structure["headings"]}
        self.assertEqual(by_label[("Cartea I", "Despre persoane")], 0)
        self.assertEqual(by_label[("Secțiunea 1", "Capacitatea de folosință")], 3)

    def test_names_lose_footnote_marks_and_cedillas(self):
        structure = parse_structure(CIVIL)
        texts = {(h["label"], h["name"]) for h in structure["headings"]}
        self.assertIn(("Titlul PRELIMINAR", "Despre legea civilă"), texts)
        self.assertIn(("Cartea I", "Despre persoane"), texts)
        self.assertIn(("Secțiunea a 2-a", "Capacitatea de exercițiu"), texts)

    def test_thousands_dot_and_indexed_numbers(self):
        structure = parse_structure(CIVIL)
        self.assertIn("1112", structure["articles"])
        self.assertIn("5^1", structure["articles"])
        self.assertEqual(structure["articles"]["5"], structure["articles"]["5^1"])

    def test_headings_without_a_matched_article_are_dropped(self):
        html = "<html><body>" + unit("CAP", "Capitolul I", "Gol", art("Articolul 7-9")) + unit("CAP", "Capitolul II", "Plin", art("Articolul 10")) + "</body></html>"
        structure = parse_structure(html)
        self.assertEqual([h["label"] for h in structure["headings"]], ["Capitolul II"])
        self.assertEqual(structure["articles"], {"10": 0})

    def test_a_kept_heading_keeps_its_ancestors(self):
        html = "<html><body>" + unit("CRT", "Cartea I", "A", unit("CAP", "Capitolul I", "B", art("Articolul 1"))) + "</body></html>"
        structure = parse_structure(html)
        self.assertEqual([h["label"] for h in structure["headings"]], ["Cartea I", "Capitolul I"])
        self.assertEqual(structure["articles"], {"1": 1})

    def test_an_annex_is_ignored_but_the_text_after_it_is_not(self):
        annex = unit("ANX", "Anexa 1", "Lista", unit("CAP", "Capitolul IX", "Din anexă", art("Articolul 99")))
        html = (
            "<html><body>"
            + unit("TTL", "Titlul I", "Principal", art("Articolul 1") + annex + art("Articolul 2"))
            + "</body></html>"
        )
        structure = parse_structure(html)
        self.assertEqual(sorted(structure["articles"]), ["1", "2"])
        self.assertEqual([h["label"] for h in structure["headings"]], ["Titlul I"])

    def test_preambles_and_unknown_kinds_are_ignored(self):
        html = (
            "<html><body>"
            '<span class="S_PRE"><span class="S_PRE_TTL">Preambul</span></span>'
            '<span class="S_NTA"><span class="S_NTA_TTL"> Notă </span></span>'
            + unit("CAP", "Capitolul I", "Dispoziții", art("Articolul 1"))
            + "</body></html>"
        )
        structure = parse_structure(html)
        self.assertEqual(structure["headings"], [{"kind": "cap", "label": "Capitolul I", "name": "Dispoziții", "depth": 0}])

    def test_a_page_without_structure_gives_nothing(self):
        self.assertEqual(parse_structure("<html><body>Eroare</body></html>"), {"headings": [], "articles": {}})

    def test_an_unnamed_section_keeps_an_empty_name(self):
        html = "<html><body>" + unit("SEC", "Secțiunea 1", "", art("Articolul 1")) + "</body></html>"
        self.assertEqual(parse_structure(html)["headings"][0]["name"], "")


class ArticleNumberTest(unittest.TestCase):
    def test_labels(self):
        for label, number in [
            ("Articolul 1", "1"),
            ("Articolul 1.112", "1112"),
            ("Articolul 52^1", "52^1"),
            ("Articolul 220 ^4", "220^4"),
            ("Articolul 55*)", "55"),
            ("Articolul 49.", "49"),
            ("  Articolul   7 ", "7"),
        ]:
            self.assertEqual(article_number(label), number, label)

    def test_unmatched_labels(self):
        for label in ["Articolul 6-16", "Articolul 160^a", "Articolul 5O1", "Anexa 1", ""]:
            self.assertIsNone(article_number(label), label)


META = SimpleNamespace(path="lege/2009/287", portal="https://example.invalid/287")


class LoadTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.calls: list[str] = []

    def fetch(self, url: str) -> bytes | None:
        self.calls.append(url)
        return CIVIL.encode("utf-8")

    def test_fetches_parses_and_caches(self):
        first = load(META, date(2023, 7, 9), Path(self.dir.name), self.fetch)
        self.assertEqual(names(first, "4"), ["Cartea I", "Titlul II", "Capitolul I", "Secțiunea 1"])
        cached = Path(self.dir.name) / "structure" / "lege_2009_287.json"
        stored = json.loads(cached.read_text(encoding="utf-8"))
        self.assertEqual((stored["url"], stored["latest"]), ("https://example.invalid/287", "2023-07-09"))
        again = load(META, date(2023, 7, 9), Path(self.dir.name), self.fetch)
        self.assertEqual(again, first)
        self.assertEqual(len(self.calls), 1)

    def test_a_new_latest_day_or_portal_refetches(self):
        load(META, date(2023, 7, 9), Path(self.dir.name), self.fetch)
        load(META, "2024-01-01", Path(self.dir.name), self.fetch)
        moved = SimpleNamespace(path=META.path, portal="https://example.invalid/other")
        load(moved, "2024-01-01", Path(self.dir.name), self.fetch)
        self.assertEqual(len(self.calls), 3)

    def test_a_failed_fetch_gives_none_and_caches_nothing(self):
        def broken(url):
            raise OSError("boom")

        self.assertIsNone(load(META, date(2023, 7, 9), Path(self.dir.name), broken))
        self.assertIsNone(load(META, date(2023, 7, 9), Path(self.dir.name), lambda url: None))
        self.assertFalse((Path(self.dir.name) / "structure").exists())
        # a later success still works
        self.assertIsNotNone(load(META, date(2023, 7, 9), Path(self.dir.name), self.fetch))

    def test_a_page_without_headings_gives_none_and_is_not_fetched_again(self):
        calls = []

        def plain(url):
            calls.append(url)
            return b"<html><body>Eroare</body></html>"

        self.assertIsNone(load(META, date(2023, 7, 9), Path(self.dir.name), plain))
        self.assertIsNone(load(META, date(2023, 7, 9), Path(self.dir.name), plain))
        self.assertEqual(len(calls), 1)

    def test_a_portal_that_is_not_a_url_is_not_fetched(self):
        odd = SimpleNamespace(path="x/1", portal="")
        self.assertIsNone(load(odd, date(2023, 7, 9), Path(self.dir.name), self.fetch))
        self.assertEqual(self.calls, [])

    def test_a_damaged_cache_file_is_replaced(self):
        file = Path(self.dir.name) / "structure" / "lege_2009_287.json"
        file.parent.mkdir(parents=True)
        file.write_text("not json", encoding="utf-8")
        self.assertIsNotNone(load(META, date(2023, 7, 9), Path(self.dir.name), self.fetch))


class FakeR2:
    def __init__(self, broken=False):
        self.objects: dict[str, bytes] = {}
        self.puts: list[str] = []
        self.broken = broken

    def get(self, key):
        if self.broken:
            raise OSError("r2 down")
        return self.objects.get(key)

    def put(self, key, body, content_type, content_encoding=None):
        if self.broken:
            raise OSError("r2 down")
        self.puts.append(key)
        self.objects[key] = body


def entry(latest: str, label: str = "Cartea veche") -> dict:
    structure = {"headings": [{"kind": "crt", "label": label, "name": "", "depth": 0}], "articles": {"1": 0}}
    return {"url": META.portal, "latest": latest, "structure": structure}


def gz(data: dict) -> bytes:
    return gzip.compress(json.dumps(data).encode("utf-8"))


def failing(url):
    raise OSError("Remote end closed connection without response")


class RemoteCacheTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.cache = Path(self.dir.name)
        self.key = remote_key(META.path)
        self.calls: list[str] = []

    def fetch(self, url):
        self.calls.append(url)
        return CIVIL.encode("utf-8")

    def write_local(self, data):
        file = self.cache / "structure" / "lege_2009_287.json"
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(json.dumps(data), encoding="utf-8")

    def quiet(self, *args, **kwargs):
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            result = load(*args, **kwargs)
        return result, err.getvalue()

    def test_the_remote_key_format(self):
        self.assertEqual(self.key, "build-cache/structure/lege_2009_287.json.gz")

    def test_a_remote_hit_avoids_fetching_and_is_kept_locally(self):
        r2 = FakeR2()
        r2.objects[self.key] = gz(entry("2023-07-09"))
        result = load(META, date(2023, 7, 9), self.cache, self.fetch, r2=r2)
        self.assertEqual(result["headings"][0]["label"], "Cartea veche")
        self.assertEqual(self.calls, [])
        self.assertTrue((self.cache / "structure" / "lege_2009_287.json").exists())
        self.assertEqual(r2.puts, [])
        load(META, date(2023, 7, 9), self.cache, self.fetch, r2=r2)
        self.assertEqual(r2.puts, [])

    def test_a_fetch_is_stored_locally_and_remotely_once(self):
        r2 = FakeR2()
        load(META, date(2023, 7, 9), self.cache, self.fetch, r2=r2)
        self.assertEqual(r2.puts, [self.key])
        stored = json.loads(gzip.decompress(r2.objects[self.key]))
        self.assertEqual((stored["url"], stored["latest"]), (META.portal, "2023-07-09"))
        load(META, date(2023, 7, 9), self.cache, self.fetch, r2=r2)
        self.assertEqual((len(self.calls), len(r2.puts)), (1, 1))

    def test_a_local_hit_seeds_the_remote_once(self):
        self.write_local(entry("2023-07-09"))
        r2 = FakeR2()
        load(META, date(2023, 7, 9), self.cache, self.fetch, r2=r2)
        load(META, date(2023, 7, 9), self.cache, self.fetch, r2=r2)
        self.assertEqual((r2.puts, self.calls), ([self.key], []))
        # a new R2 (or changed content) is seeded again
        self.write_local(entry("2023-07-09", "Alta"))
        load(META, date(2023, 7, 9), self.cache, self.fetch, r2=r2)
        self.assertEqual(len(r2.puts), 2)

    def test_a_failed_fetch_keeps_a_stale_local_entry(self):
        self.write_local(entry("2020-01-01"))
        result, err = self.quiet(META, date(2023, 7, 9), self.cache, failing)
        self.assertEqual(result["headings"][0]["label"], "Cartea veche")
        self.assertIn("headings: lege/2009/287: Remote end closed connection without response; keeping the cached headings from 2020-01-01", err)

    def test_a_failed_fetch_keeps_a_stale_remote_entry(self):
        r2 = FakeR2()
        r2.objects[self.key] = gz(entry("2020-01-01"))
        result, err = self.quiet(META, date(2023, 7, 9), self.cache, failing, r2=r2)
        self.assertEqual(result["headings"][0]["label"], "Cartea veche")
        self.assertIn("keeping the cached headings from 2020-01-01", err)

    def test_a_failure_with_nothing_cached_gives_none(self):
        result, err = self.quiet(META, date(2023, 7, 9), self.cache, failing, r2=FakeR2())
        self.assertIsNone(result)
        self.assertNotIn("keeping", err)

    def test_the_breaker_stops_fetching_after_three_failures_and_a_success_resets_it(self):
        breaker = Breaker()
        calls = []

        def broken(url):
            calls.append(url)
            raise OSError("down")

        def meta(n):
            return SimpleNamespace(path=f"lege/2000/{n}", portal=f"https://example.invalid/{n}")

        with contextlib.redirect_stderr(io.StringIO()):
            for n in range(1, 3):
                load(meta(n), "2023-07-09", self.cache, broken, breaker=breaker)
            load(meta(3), "2023-07-09", self.cache, self.fetch, breaker=breaker)  # success resets
            self.assertEqual(breaker.failures, 0)
            for n in range(4, 10):
                load(meta(n), "2023-07-09", self.cache, broken, breaker=breaker)
        self.assertEqual(len(calls), 5)  # 2 failures, then 3 more after the reset
        self.assertTrue(breaker.stopped)
        self.assertEqual((breaker.kept, breaker.none), (0, 8))
        self.assertEqual(
            breaker.summary(),
            "headings: fetching stopped after 3 failures in a row; 0 acts kept cached headings, 8 acts have none",
        )

    def test_a_stopped_breaker_still_serves_cached_headings_without_fetching(self):
        breaker = Breaker()
        breaker.stopped = True
        self.write_local(entry("2020-01-01"))
        result, err = self.quiet(META, date(2023, 7, 9), self.cache, self.fetch, breaker=breaker)
        self.assertIsNotNone(result)
        self.assertEqual((self.calls, breaker.kept, err), ([], 1, ""))
        self.assertIsNone(Breaker().summary())

    def test_remote_errors_never_raise(self):
        r2 = FakeR2(broken=True)
        result, err = self.quiet(META, date(2023, 7, 9), self.cache, self.fetch, r2=r2)
        self.assertIsNotNone(result)
        self.assertIn("could not", err)
        self.write_local(entry("2023-07-09"))
        result, err = self.quiet(META, date(2023, 7, 9), self.cache, self.fetch, r2=r2)
        self.assertIsNotNone(result)


if __name__ == "__main__":
    unittest.main()
