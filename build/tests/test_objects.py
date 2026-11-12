import json
import unittest
from datetime import date
from pathlib import Path

from build.tests.test_laws import CSV, L71, L200
from build.textdelege.acts import ActMeta
from build.textdelege.events import events_for
from build.textdelege.extract import Article, Line, Version
from build.textdelege.laws import changes_feed, laws_from, upcoming
from build.textdelege.objects import (
    act_object,
    article_object,
    changes_object,
    law_object,
    lead,
    manifest_object,
    object_key,
    articles_by_ruling,
    ruling_object,
)
from build.textdelege.rulings import Ruling, Subject

SHAPES = Path(__file__).with_name("shapes.json")
PATH = "lege/2009/287"
TODAY = date(2026, 11, 8)
FRESHNESS = {
    "status": "stale",
    "last_verified": "2026-06-25",
    "check_due": "2026-07-02",
    "method": "consolidated-form",
    "newest_change": "legea-57-2026",
    "newest_change_date": "2026-05-03",
    "change_in_repo": True,
    "official_url": "https://legislatie.just.ro/Public/DetaliiDocument/109884",
}

STATUS = {
    "schema": "romania-law-status/1",
    "generated": "2026-11-08T10:00:00Z",
    "updates": "idle",
    "last_published": "2026-11-08T09:59:00Z",
    "published_last_24h": {"commits": 3, "new_acts": 1},
    "official_sources": [
        {
            "name": "Source A",
            "state": "unavailable",
            "unavailable_since": "2026-11-08T08:00:00Z",
            "last_successful_contact": "2026-11-08T07:59:00Z",
            "as_of": "2026-11-08T08:01:00Z",
        },
        {
            "name": "Source B",
            "state": "available",
            "unavailable_since": None,
            "last_successful_contact": "2026-11-07T01:00:00Z",
            "as_of": "2026-11-07T01:00:00Z",
        },
    ],
    "note": "Note.",
}
SUMMARY = {"as_of": "2026-11-08", "checked_against_official_source": "2026-11-08"}

_ARTICLE_NULLABLE = {
    "act.alias", "act.short", "title", "repealed", "repealed.law", "versions[].until",
    "versions[].law", "events[].law", "events[].from_version", "prev", "prev.title", "next",
    "next.title",
}
NULLABLE = {
    "article": _ARTICLE_NULLABLE,
    "article-repealed": _ARTICLE_NULLABLE,
    "act": {
        "alias", "short", "code", "freshness", "freshness.status", "freshness.last_verified",
        "freshness.check_due", "freshness.method", "freshness.newest_change",
        "freshness.newest_change_date", "freshness.change_in_repo", "freshness.official_url",
        "articles[].title", "articles[].lead", "articles[].first", "articles[].last_change",
        "stats.most_amended[].title",
    },
    "law": {"enacted", "published", "source", "mo"},
    "ruling": {"subtitle", "binding_from", "text"},
    "changes": {"items[].title", "items[].law", "upcoming[].title", "upcoming[].law"},
    "manifest": {
        "acts[].alias", "acts[].short", "acts[].freshness_status", "freshness.as_of",
        "freshness.checked_against_official_source",
        "status.official_sources[].unavailable_since",
    },
}

ACT = ActMeta(
    PATH, "codul-civil", "law", 2009, "287", "Legea nr. 287/2009 privind Codul civil",
    "civil", "Codul civil", "codul-civil", "in-force",
    "https://legislatie.just.ro/Public/DetaliiDocument/109884", 2,
    date(2011, 10, 1), date(2023, 7, 9),
)
RULING = Ruling(
    "ccr-1-2020", "Decizia CCR nr. 1/2020", "ccr", "Curtea Constituțională", "decision",
    "Decizia nr. 1 din 15 ianuarie 2020", "Subtitlu", date(2020, 1, 15), date(2020, 3, 1),
    {"number": 250, "bis": False, "date": "2020-03-01", "part": 1}, "respinge", False,
    ["123D/2019"], ["Respinge excepția."], "Text integral.",
    [Subject(PATH, ["1112"])], "https://www.ccr.ro/decizia-1-2020", "ccr/2020/1",
)


def version(from_, until, key, label, lines):
    return Version(from_, until, "c" * 40, "d" * 40, key, label, "law", lines, "codul-civil/art-1112.md")


def line(id_, text, since, key):
    return Line(text, id_, since, key)


def art1112():
    v1 = version(date(2011, 10, 1), date(2023, 7, 8), L71, "Legea nr. 71/2011", [
        line("alin-1", "(1) A", date(2011, 10, 1), L71),
        line("alin-2", "(2) B", date(2011, 10, 1), L71),
    ])
    v2 = version(date(2023, 7, 9), None, L200, "Legea nr. 200/2023", [
        line("alin-1", "(1) A2", date(2023, 7, 9), L200),
        line("alin-2", "(2) B", date(2011, 10, 1), L71),
    ])
    return Article("art-1112.md", "1112", "Ofertă", [v1, v2], "in-force", None)


def untitled(*texts):
    versions = [
        version(date(2011 + i, 1, 1), None, L71, "Legea nr. 71/2011", [line("p-1", text, date(2011, 1, 1), L71)] if text else [])
        for i, text in enumerate(texts)
    ]
    return Article("art-0002.md", "2", None, versions, "in-force", None)


class LeadTests(unittest.TestCase):
    def test_strips_paragraph_marker_and_collapses_whitespace(self):
        self.assertEqual(lead(untitled("(1)  Primul   text.")), "Primul text.")
        self.assertEqual(lead(untitled("1. Primul text.")), "Primul text.")
        self.assertEqual(lead(untitled("(2^1) Text.")), "Text.")

    def test_letter_marker_is_kept(self):
        self.assertEqual(lead(untitled("a) text")), "a) text")

    def test_short_text_is_unchanged(self):
        self.assertEqual(lead(untitled("A" * 80)), "A" * 80)

    def test_cuts_at_word_boundary(self):
        text = " ".join(["cuvant"] * 20)
        result = lead(untitled(text))
        self.assertEqual(result, " ".join(["cuvant"] * 11) + "…")
        self.assertLessEqual(len(result), 81)

    def test_cuts_unbroken_text_at_limit(self):
        self.assertEqual(lead(untitled("A" * 120)), "A" * 80 + "…")

    def test_uses_newest_version(self):
        self.assertEqual(lead(untitled("Vechi.", "Nou.")), "Nou.")

    def test_repealed_falls_back_to_newest_version_with_text(self):
        self.assertEqual(lead(untitled("Text vechi.", "")), "Text vechi.")

    def test_none_without_text(self):
        self.assertIsNone(lead(untitled("")))
        self.assertIsNone(lead(untitled("(1)")))

    def test_act_index_carries_lead_only_without_title(self):
        obj = act_object(ACT, [art1112(), untitled("(1) Text.")], [], [], None)
        self.assertEqual([entry["lead"] for entry in obj["articles"]], [None, "Text."])


def other(file, number, title, versions=None, state="in-force"):
    return Article(file, number, title, versions or [], state, None)


def example_shapes() -> dict[str, dict]:
    blocks = json.loads(SHAPES.read_text(encoding="utf-8"))
    examples = {}
    for block in blocks:
        name = block["schema"].split("/")[1]
        if block.get("state") == "repealed":
            name += "-repealed"
        examples[name] = block
    return examples


def shape_differences(expected, out, nullable, where="$", path=""):
    if expected is None or out is None:
        if (expected is None and out is None) or path in nullable:
            return []
        return [f"{where}: null where the example shape says otherwise"]
    if isinstance(expected, dict) and isinstance(out, dict):
        if set(expected) != set(out):
            return [f"{where}: keys differ by {sorted(set(expected) ^ set(out))}"]
        return [
            d
            for k in expected
            for d in shape_differences(
                expected[k], out[k], nullable, f"{where}.{k}", f"{path}.{k}" if path else k
            )
        ]
    if isinstance(expected, list) and isinstance(out, list):
        if not expected and out:
            return [f"{where}: example list has no item"]
        return [
            d
            for i, item in enumerate(out)
            for d in shape_differences(
                expected[min(i, len(expected) - 1)], item, nullable, f"{where}[{i}]", path + "[]"
            )
        ]
    if type(expected) is not type(out):
        return [f"{where}: {type(expected).__name__} != {type(out).__name__}"]
    return []


def build_article():
    article = art1112()
    return article_object(
        ACT,
        article,
        events_for(article),
        [RULING],
        other("art-1111.md", "1111", "Condiții"),
        other("art-1113.md", "1113", "Acceptare"),
    )


def build_repealed():
    v = version(date(2012, 1, 1), date(2019, 12, 31), L71, "Legea nr. 71/2011",
                [line("alin-1", "(1) Text.", date(2012, 1, 1), L71)])
    article = Article("art-5.md", "5", None, [v], "repealed", date(2020, 1, 1), L200,
                      "Legea nr. 200/2023")
    return article_object(
        ACT, article, events_for(article), [RULING],
        other("art-4.md", "4", None), other("art-6.md", "6", "Titlu"),
    )


def build_all() -> dict[str, dict]:
    article = art1112()
    future = other("art-1113.md", "1113", "Acceptare", [
        version(date(2011, 10, 1), date(2026, 12, 31), L71, "L",
                [line("alin-1", "a", date(2011, 10, 1), L71)]),
        version(date(2027, 1, 1), None, L200, "L2",
                [line("alin-1", "b", date(2027, 1, 1), L200)]),
    ])
    laws = laws_from(CSV, {PATH: [article]})
    articles = {PATH: [article, future]}
    return {
        "article": build_article(),
        "article-repealed": build_repealed(),
        "act": act_object(ACT, [article], list(laws.values()), [RULING], FRESHNESS),
        "law": law_object(laws[L200]),
        "ruling": ruling_object(RULING, articles_by_ruling({(PATH, "art-1112"): ["ccr-1-2020"]})),
        "changes": changes_object(
            PATH, changes_feed(articles, 20, TODAY), upcoming(articles, TODAY)
        ),
        "manifest": manifest_object(
            "20261108T060000Z",
            "5" * 40,
            "2026-11-08T06:00:00Z",
            {"acts": 1, "articles": 1, "versions": 2, "laws": 2, "rulings": 1},
            [ACT],
            {PATH: {"articles": 1, "versions": 2}},
            {PATH: FRESHNESS},
            SUMMARY,
            STATUS,
        ),
    }


class KeyTest(unittest.TestCase):
    def test_object_key_layout(self):
        self.assertEqual(object_key("act", PATH), f"acts/{PATH}/act.json")
        self.assertEqual(
            object_key("article", PATH, "art-1112"), f"acts/{PATH}/art/art-1112.json"
        )
        self.assertEqual(object_key("law", L200), f"laws/{L200}.json")
        self.assertEqual(object_key("ruling", "ccr-1-2020"), "rulings/ccr-1-2020.json")
        self.assertEqual(object_key("changes-site"), "changes/site.json")
        self.assertEqual(object_key("changes-act", PATH), f"changes/acts/{PATH}.json")

    def test_object_key_rejects_unknown_kind(self):
        with self.assertRaises(ValueError):
            object_key("nope")


class ArticleTest(unittest.TestCase):
    def test_article_object_matches_example_shape(self):
        obj = build_article()
        self.assertEqual(
            shape_differences(example_shapes()["article"], obj, NULLABLE["article"]), []
        )
        self.assertEqual(obj["schema"], "textdelege/article/1")

    def test_article_values(self):
        article = art1112()
        obj = article_object(ACT, article, events_for(article), [], None, None)
        self.assertEqual(obj["file"], "art-1112")
        self.assertEqual(obj["act"]["alias"], "codul-civil")
        self.assertEqual([v["until"] for v in obj["versions"]], ["2023-07-08", None])
        self.assertEqual(obj["versions"][1]["lines"][0]["law"], L200)
        self.assertEqual(obj["versions"][0]["path"], "codul-civil/art-1112.md")
        self.assertEqual(obj["versions"][0]["law"], {"key": L71, "label": "Legea nr. 71/2011"})
        self.assertEqual(obj["events"][0]["verb"], "modified")
        self.assertEqual(obj["events"][0]["date"], "2023-07-09")
        self.assertEqual(obj["events"][0]["law"]["key"], L200)
        self.assertEqual(obj["rulings"], [])
        self.assertIsNone(obj["prev"])
        self.assertIsNone(obj["next"])
        self.assertIsNone(obj["repealed"])
        json.dumps(obj)

    def test_repealed_article(self):
        v = version(date(2012, 1, 1), date(2019, 12, 31), L71, "Legea nr. 71/2011",
                    [line("alin-1", "(1) A", date(2012, 1, 1), L71)])
        article = Article("art-5.md", "5", None, [v], "repealed", date(2020, 1, 1), L200,
                          "Legea nr. 200/2023")
        obj = article_object(ACT, article, events_for(article), [], None, None)
        self.assertEqual(
            obj["repealed"],
            {"on": "2020-01-01", "law": {"key": L200, "label": "Legea nr. 200/2023"}},
        )
        self.assertEqual(obj["events"][0]["to_version"], -1)

    def test_missing_law_is_null(self):
        article = Article("art-5.md", "5", None, [], "repealed", date(2020, 1, 1))
        obj = article_object(ACT, article, [], [], None, None)
        self.assertIsNone(obj["repealed"]["law"])


class ActTest(unittest.TestCase):
    def test_act_object_counts_changes_and_timeline(self):
        a = art1112()
        b = other("art-1113.md", "1113", "Acceptare", [
            version(date(2011, 10, 1), None, L71, "Legea nr. 71/2011",
                    [line("alin-1", "x", date(2011, 10, 1), L71)]),
        ])
        c = other("art-1114.md", "1114", None)
        laws = list(laws_from(CSV, {PATH: [a, b]}).values())
        obj = act_object(ACT, [a, b, c], laws, [RULING], FRESHNESS)
        index = {entry["file"]: entry for entry in obj["articles"]}
        self.assertEqual(index["art-1112"]["versions"], 2)
        self.assertEqual(index["art-1112"]["changes"], 1)
        self.assertEqual(index["art-1112"]["first"], "2011-10-01")
        self.assertEqual(index["art-1112"]["last_change"], "2023-07-09")
        self.assertEqual(index["art-1113"]["changes"], 0)
        self.assertEqual(index["art-1113"]["last_change"], "2011-10-01")
        self.assertIsNone(index["art-1114"]["first"])
        self.assertIsNone(index["art-1114"]["last_change"])
        self.assertEqual(
            [(t["date"], t["articles"], [law["key"] for law in t["laws"]]) for t in obj["timeline"]],
            [("2011-10-01", 2, [L71]), ("2023-07-09", 1, [L200])],
        )
        self.assertEqual(obj["stats"]["changes_per_year"], {"2023": 1})
        self.assertEqual(obj["stats"]["most_amended"][0]["file"], "art-1112")
        self.assertEqual([law["key"] for law in obj["laws"]], [L200, L71])
        self.assertEqual(obj["rulings"][0]["key"], "ccr-1-2020")
        self.assertEqual(obj["freshness"], FRESHNESS)
        self.assertEqual(obj["from"], "2011-10-01")
        self.assertEqual(obj["slug"], "codul-civil")
        self.assertIsNone(act_object(ACT, [a], laws, [], None)["freshness"])
        json.dumps(obj)

    def test_most_amended_is_limited_to_ten_and_ordered(self):
        articles = []
        for n in range(12):
            versions = [
                version(
                    date(2011 + i, 1, 1),
                    None if i == n else date(2011 + i, 12, 31),
                    L71,
                    "L",
                    [line("alin-1", f"t{i}", date(2011 + i, 1, 1), L71)],
                )
                for i in range(n + 1)
            ]
            articles.append(other(f"art-{n}.md", str(n), None, versions))
        top = act_object(ACT, articles, [], [], None)["stats"]["most_amended"]
        self.assertEqual(len(top), 10)
        self.assertEqual([t["file"] for t in top][:3], ["art-11", "art-10", "art-9"])
        self.assertEqual(top[0]["changes"], 11)


class RulingTest(unittest.TestCase):
    def test_ruling_object_resolves_articles(self):
        by_article = {
            (PATH, ""): ["ccr-1-2020"],
            (PATH, "art-1112"): ["ccr-2-2020", "ccr-1-2020"],
            (PATH, "art-1111"): ["ccr-1-2020"],
            ("lege/2010/1", "art-2"): ["ccr-1-2020"],
        }
        obj = ruling_object(RULING, articles_by_ruling(by_article))
        self.assertEqual(
            obj["articles"],
            [
                {"act_path": PATH, "file": "art-1111"},
                {"act_path": PATH, "file": "art-1112"},
                {"act_path": "lege/2010/1", "file": "art-2"},
            ],
        )
        self.assertEqual(
            articles_by_ruling(by_article),
            {
                "ccr-1-2020": [(PATH, "art-1111"), (PATH, "art-1112"), ("lege/2010/1", "art-2")],
                "ccr-2-2020": [(PATH, "art-1112")],
            },
        )
        self.assertEqual(ruling_object(RULING, {})["articles"], [])
        self.assertEqual(obj["date"], "2020-01-15")
        self.assertEqual(obj["binding_from"], "2020-03-01")
        self.assertEqual(obj["subjects"], [{"act_path": PATH, "articles": ["1112"]}])
        self.assertEqual(obj["mo"], RULING.mo)
        json.dumps(obj)


class ChangesAndManifestTest(unittest.TestCase):
    def test_changes_object_scope_and_lists(self):
        obj = build_all()["changes"]
        self.assertEqual(obj["scope"], PATH)
        self.assertEqual(len(obj["upcoming"]), 1)
        self.assertEqual(obj["upcoming"][0]["date"], "2027-01-01")
        self.assertEqual(obj["upcoming"][0]["law"], {"key": L200, "label": "L2"})
        self.assertNotIn("law_key", obj["items"][0])
        self.assertEqual(obj["items"][0]["law"]["key"], L200)

    def test_manifest_shape(self):
        obj = build_all()["manifest"]
        self.assertEqual(
            shape_differences(example_shapes()["manifest"], obj, NULLABLE["manifest"]), []
        )
        self.assertEqual(obj["acts"][0]["freshness_status"], "stale")
        self.assertEqual(obj["acts"][0]["latest"], "2023-07-09")
        self.assertEqual(obj["acts"][0]["from"], "2011-10-01")
        self.assertEqual((obj["acts"][0]["articles"], obj["acts"][0]["versions"]), (1, 2))
        self.assertEqual(obj["status"], STATUS)
        missing = manifest_object("b", "h", "g", {}, [ACT], {}, {}, {}, {})
        self.assertIsNone(missing["acts"][0]["freshness_status"])
        self.assertEqual((missing["acts"][0]["articles"], missing["acts"][0]["versions"]), (0, 0))


class DocumentationTest(unittest.TestCase):
    def test_every_example_shape_matches_builder_keys(self):
        examples = example_shapes()
        built = build_all()
        self.assertEqual(sorted(examples), sorted(built))
        for kind, example in examples.items():
            with self.subTest(kind=kind):
                self.assertEqual(shape_differences(example, built[kind], NULLABLE[kind]), [])
                self.assertEqual(built[kind]["schema"], example["schema"])

    def test_shape_check_rejects_null_and_missing_objects(self):
        example = example_shapes()["article"]
        built = build_article()
        nullable = NULLABLE["article"]
        for field in ("act", "versions", "events", "rulings"):
            self.assertNotEqual(shape_differences(example, {**built, field: None}, nullable), [])
        broken = {**built, "versions": [{**built["versions"][0], "commit": None}]}
        self.assertNotEqual(shape_differences(example, broken, nullable), [])
        self.assertNotEqual(shape_differences({"a": []}, {"a": ["x"]}, set()), [])
