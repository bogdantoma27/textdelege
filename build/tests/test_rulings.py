import csv
import io
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

from build.tests.fixture import FixtureRepo
from build.textdelege.gitrepo import GitRepo
from build.textdelege.rulings import Ruling, Subject, load_rulings, rulings_by_article

CSV_FIELDS = [
    "key", "label", "court", "kind", "subkind", "panel", "number", "year", "date",
    "mo_number", "mo_date", "outcome", "finds_unconstitutional", "interpretive",
    "rejected_as", "subjects", "folder", "portal_id", "portal", "warnings",
]
ACT = "lege/2009/287"
OTHER_ACT = "lege/2010/134"
OPERATIVE = ["Admite excepția de neconstituționalitate.", "Constată că art. 1112 este neconstituțional."]
TEXT = "DECIZIA nr. 1 din 2020\nÎn numele legii, curtea a hotărât: șțăîâ ȘȚĂÎÂ\n"


def meta(key, label, court, act, articles, **extra):
    base = {
        "binding_from": "2020-03-01", "cites": [], "court": court,
        "court_name": "Curtea Constituțională", "date": "2020-01-15",
        "dossiers": ["123D/2019"], "finds_unconstitutional": True,
        "heading": "DECIZIE referitoare la art. 1112", "interpretive": False,
        "issuer": "CCR", "key": key, "kind": "decizie", "label": label,
        "mo": {"number": 250, "bis": False, "date": "2020-03-01", "part": 1},
        "number": 1, "operative": OPERATIVE, "outcome": "admis", "partly": False,
        "rejected_as": None, "source": {"portal": "https://example.invalid/1", "text_sha256": "x"},
        "subjects": [{"act": {"kind": "lege", "label": "Codul civil", "number": "287",
                              "year": 2009, "path": act},
                      "articles": [{"art": a, "alin": None, "lit": None} for a in articles]}],
        "subtitle": None, "text": "decizie.md", "warnings": [], "year": 2020,
    }
    base.update(extra)
    return base


def csv_text(rows):
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, CSV_FIELDS, lineterminator="\n")
    writer.writeheader()
    for key, label, folder in rows:
        row = dict.fromkeys(CSV_FIELDS, "")
        row.update(key=key, label=label, folder=folder, court="ccr", finds_unconstitutional="True")
        writer.writerow(row)
    return out.getvalue()


def index(**acts):
    return {"note": "n", "acts": acts}


def entry(act_ids, articles):
    return {"slug": "s", "path": "p", "kind": "lege", "in_repo": True, "label": "l",
            "act": act_ids, "articles": articles}


class RulingsTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.fixture = FixtureRepo(Path(tmp.name) / "src")
        self.fixture.commit(
            {
                "jurisprudenta/ccr/2020/1/meta.json": json.dumps(
                    meta("ccr-1-2020", "CCR 1/2020", "ccr", ACT, ["1112"]), ensure_ascii=False),
                "jurisprudenta/ccr/2020/1/decizie.md": TEXT,
                "jurisprudenta/ccr/2020/2/meta.json": json.dumps(
                    meta("ccr-2-2020", "CCR 2/2020", "ccr", OTHER_ACT, ["5"]), ensure_ascii=False),
                "jurisprudenta/ccr/2020/2/decizie.md": "altul\n",
            },
            author="Lexifina", trailers={"Kind": "documentation"}, message="decisions",
        )
        self.repo = GitRepo(Path(tmp.name) / "src")
        self.csv = csv_text([
            ("ccr-1-2020", "CCR 1/2020", "jurisprudenta/ccr/2020/1"),
            ("ccr-2-2020", "CCR 2/2020", "jurisprudenta/ccr/2020/2"),
        ])
        self.index = index(**{
            ACT: entry([], {"1112": {"file": "art-1112.md", "decisions": ["ccr-1-2020"]}}),
            OTHER_ACT: entry([], {"5": {"file": "art-0005.md", "decisions": ["ccr-2-2020"]}}),
        })

    def test_only_rulings_on_selected_acts_are_loaded(self):
        rulings, warnings = load_rulings(self.repo, {ACT}, self.index, self.csv)
        self.assertEqual([r.key for r in rulings], ["ccr-1-2020"])
        self.assertEqual(warnings, [])

    def test_rulings_by_article_maps_act_and_article(self):
        self.assertEqual(
            rulings_by_article(self.index, {ACT}),
            {(ACT, "art-1112"): ["ccr-1-2020"]},
        )

    def test_text_is_none_when_only_meta_exists(self):
        self.fixture.commit(
            {"jurisprudenta/ccr/2020/1/decizie.md": None},
            author="Lexifina", trailers={"Kind": "documentation"}, message="drop text",
        )
        rulings, _ = load_rulings(self.repo, {ACT}, self.index, self.csv)
        self.assertIsNone(rulings[0].text)

    def test_missing_meta_is_reported_not_raised(self):
        self.index["acts"][ACT]["act"] = ["ghost", "nometa"]
        csv_rows = self.csv + "nometa,x,,,,,,,,,,,,,,,jurisprudenta/ccr/2020/9,,,\n"
        rulings, warnings = load_rulings(self.repo, {ACT}, self.index, csv_rows)
        self.assertEqual([r.key for r in rulings], ["ccr-1-2020"])
        self.assertEqual(len(warnings), 2)
        self.assertIn("ghost", warnings[0])
        self.assertIn("nometa", warnings[1])

    def test_act_level_decisions_key_is_empty_string(self):
        self.index["acts"][ACT]["act"] = ["ccr-1-2020"]
        self.assertEqual(
            rulings_by_article(self.index, {ACT}),
            {(ACT, ""): ["ccr-1-2020"], (ACT, "art-1112"): ["ccr-1-2020"]},
        )

    def test_article_without_file_uses_article_key(self):
        idx = index(**{ACT: entry([], {
            "I": {"file": None, "decisions": ["a", "b", "a"]},
            "112-1": {"file": "art-0112-1.md", "decisions": ["c"]},
        })})
        self.assertEqual(
            rulings_by_article(idx, {ACT}),
            {(ACT, "I"): ["a", "b"], (ACT, "art-0112-1"): ["c"]},
        )

    def test_operative_and_mo_are_loaded(self):
        rulings, _ = load_rulings(self.repo, {ACT}, self.index, self.csv)
        r = rulings[0]
        self.assertIsInstance(r, Ruling)
        self.assertEqual(r.operative, OPERATIVE)
        self.assertEqual(r.text, TEXT)
        self.assertEqual(r.mo, {"number": 250, "bis": False, "date": "2020-03-01", "part": 1})
        self.assertEqual(r.date, date(2020, 1, 15))
        self.assertEqual(r.binding_from, date(2020, 3, 1))
        self.assertTrue(r.finds_unconstitutional)
        self.assertEqual(r.subjects, [Subject(ACT, ["1112"])])
        self.assertEqual(r.source, "https://example.invalid/1")
        self.assertEqual(r.folder, "jurisprudenta/ccr/2020/1")
        self.assertEqual(r.court_name, "Curtea Constituțională")
        self.assertEqual(r.dossiers, ["123D/2019"])
        self.assertIsNone(r.subtitle)


ICCJ_KEYS = [
    "binding_from", "cites", "court", "court_name", "date", "dossiers", "heading", "issuer",
    "key", "kind", "label", "mo", "number", "operative", "outcome", "panel", "partly", "source",
    "subjects", "subtitle", "text", "warnings", "year",
]


class OptionalFieldsTest(unittest.TestCase):
    def load(self, key, meta_obj):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        fixture = FixtureRepo(Path(tmp.name) / "src")
        folder = f"jurisprudenta/iccj/2020/{key}"
        fixture.commit(
            {f"{folder}/meta.json": json.dumps(meta_obj, ensure_ascii=False)},
            author="Lexifina", trailers={"Kind": "documentation"}, message="decision",
        )
        idx = index(**{ACT: entry([key], {})})
        return load_rulings(GitRepo(Path(tmp.name) / "src"), {ACT}, idx, csv_text([(key, "x", folder)]))

    def test_iccj_meta_loads_with_defaults(self):
        iccj = {
            "key": "iccj-1", "label": "ICCJ 1/2020", "court": "iccj", "date": "2020-05-04",
            "subjects": [],
        }
        rulings, warnings = self.load("iccj-1", iccj)
        self.assertEqual(warnings, [])
        r = rulings[0]
        self.assertFalse(r.finds_unconstitutional)
        self.assertIsNone(r.binding_from)
        self.assertEqual((r.dossiers, r.operative, r.subjects), ([], [], []))
        self.assertEqual((r.heading, r.court_name, r.outcome, r.kind), ("", "", "", ""))
        self.assertEqual(r.mo, {})
        self.assertIsNone(r.subtitle)
        self.assertIsNone(r.source)

    def test_subject_outside_the_repository_is_skipped(self):
        meta = {
            "key": "iccj-3", "label": "ICCJ 3/2020", "court": "iccj", "date": "2020-05-04",
            "subjects": [
                {"act": {"kind": "lege", "path": ACT}, "articles": [{"art": "52"}]},
                {"act": {"kind": "ordin", "label": "Ordinul nr. 942/2016"}, "articles": [{"art": "1"}]},
            ],
        }
        rulings, warnings = self.load("iccj-3", meta)
        self.assertEqual(warnings, [])
        self.assertEqual([(s.act_path, s.articles) for s in rulings[0].subjects], [(ACT, ["52"])])

    def test_full_iccj_key_set_without_ccr_field(self):
        full = dict.fromkeys(ICCJ_KEYS)
        full.update(
            key="iccj-2", label="ICCJ 2/2020", court="iccj", date="2020-05-04", court_name="ICCJ",
            cites=[], dossiers=[], mo={}, operative=[], subjects=[], warnings=[],
            source={"portal": "https://example.invalid/2"},
        )
        self.assertNotIn("finds_unconstitutional", full)
        rulings, warnings = self.load("iccj-2", full)
        self.assertEqual(warnings, [])
        self.assertEqual(rulings[0].source, "https://example.invalid/2")
        self.assertIsNone(rulings[0].binding_from)

    def test_missing_date_is_reported_not_raised(self):
        bad = {"key": "iccj-3", "label": "l", "court": "iccj"}
        rulings, warnings = self.load("iccj-3", bad)
        self.assertEqual(rulings, [])
        self.assertEqual(len(warnings), 1)
        self.assertIn("iccj-3", warnings[0])
        self.assertIn("date", warnings[0])

    def test_unparseable_date_is_reported_not_raised(self):
        bad = {"key": "iccj-4", "label": "l", "court": "iccj", "date": "2015-13-40"}
        rulings, warnings = self.load("iccj-4", bad)
        self.assertEqual(rulings, [])
        self.assertEqual(len(warnings), 1)
        self.assertIn("iccj-4", warnings[0])
        self.assertIn("2015-13-40", warnings[0])


class NonUtf8Test(unittest.TestCase):
    def load_bytes(self, key, meta_bytes, text_bytes=None):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        fixture = FixtureRepo(Path(tmp.name) / "src")
        folder = Path(tmp.name) / "src" / "jurisprudenta" / "iccj" / key
        folder.mkdir(parents=True)
        (folder / "meta.json").write_bytes(meta_bytes)
        if text_bytes is not None:
            (folder / "decizie.md").write_bytes(text_bytes)
        fixture.commit({}, author="Lexifina", trailers={"Kind": "documentation"}, message="d")
        idx = index(**{ACT: entry([key], {})})
        csv_rows = csv_text([(key, "x", f"jurisprudenta/iccj/{key}")])
        return load_rulings(GitRepo(Path(tmp.name) / "src"), {ACT}, idx, csv_rows)

    def test_latin1_meta_is_skipped_with_warning(self):
        raw = json.dumps({"key": "k", "label": "é", "court": "iccj", "date": "2020-01-01"},
                         ensure_ascii=False).encode("latin-1")
        rulings, warnings = self.load_bytes("k", raw)
        self.assertEqual(rulings, [])
        self.assertEqual(len(warnings), 1)
        self.assertIn("k", warnings[0])
        self.assertIn("UTF-8", warnings[0])

    def test_latin1_text_keeps_decision_without_text_and_names_file(self):
        raw = json.dumps({"key": "k", "label": "l", "court": "iccj", "date": "2020-01-01"}).encode()
        rulings, warnings = self.load_bytes("k", raw, "é".encode("latin-1"))
        self.assertEqual([r.key for r in rulings], ["k"])
        self.assertIsNone(rulings[0].text)
        self.assertEqual(len(warnings), 1)
        self.assertIn("decizie.md", warnings[0])
