import tempfile
import unittest
from datetime import date
from pathlib import Path

from build.tests.fixture import FixtureRepo
from build.textdelege.extract import extract_act, law_key_from_email, line_id, version_on
from build.textdelege.gitrepo import GitRepo
from build.textdelege.selection import act_commits, commit_for_day, tree_for_day

FOLDER = "act"
TODAY = date(2026, 11, 8)
LAW_2014 = "Legea nr. 138/2014"
LAW_2020 = "Legea nr. 55/2020"
LAW_2021 = "Legea nr. 9/2021"


def article(number, *lines):
    return "\n".join([f"# Articolul {number}", *lines]) + "\n"


class ExtractTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.fixture = FixtureRepo(Path(tmp.name) / "src")
        self.repo = GitRepo(Path(tmp.name) / "src")

    def commit(self, files, in_force, author=LAW_2014, kind="amendment"):
        files = {f"{FOLDER}/{name}": text for name, text in files.items()}
        return self.fixture.commit(
            files,
            author=author,
            trailers={"Kind": kind, "Law": author, "In-force": in_force},
            message="Change",
        )

    def extract(self, credits=None, labels=None, today=TODAY):
        return extract_act(
            self.repo,
            FOLDER,
            None,
            credits=credits or {},
            law_labels=labels or {},
            today=today,
        )

    def by_file(self, **kwargs):
        return {a.file: a for a in self.extract(**kwargs)}

    def test_law_key_from_email(self):
        self.assertEqual(law_key_from_email("legea-71-2011@legislatie.invalid"), "legea-71-2011")

    def test_versions_collapse_identical_blobs(self):
        self.commit(
            {"art-0001.md": article(1, "v1"), "art-0002.md": article(2, "x")},
            "2020-01-01",
        )
        self.commit({"art-0001.md": article(1, "v2")}, "2021-01-01", LAW_2020)
        self.commit({"art-0002.md": article(2, "y")}, "2022-01-01", LAW_2021)
        articles = self.by_file()
        versions = articles["art-0001.md"].versions
        self.assertEqual(
            [(v.from_, v.until) for v in versions],
            [(date(2020, 1, 1), date(2020, 12, 31)), (date(2021, 1, 1), None)],
        )
        self.assertEqual(len(articles["art-0002.md"].versions), 2)
        self.assertEqual(articles["art-0001.md"].state, "in-force")

    def test_line_ids_for_alin_lit_and_pct(self):
        self.commit(
            {
                "art-0005.md": article(
                    5,
                    "Titlu articol",
                    "(1) Intro:",
                    "a) first",
                    "b) second",
                    "(2) Next",
                    "a) again",
                    "1. point",
                    "1.2. sub point",
                    "Plain",
                    "Plain two",
                )
            },
            "2020-01-01",
        )
        art = self.by_file()["art-0005.md"]
        self.assertEqual(art.title, "Titlu articol")
        self.assertEqual(
            [line.id for line in art.versions[0].lines],
            [
                "alin-1",
                "alin-1-lit-a",
                "alin-1-lit-b",
                "alin-2",
                "alin-2-lit-a",
                "pct-1",
                "pct-1-2",
                "p-1",
                "p-2",
            ],
        )

    def test_line_id_helper(self):
        self.assertEqual(line_id("a) x", []), "lit-a")
        self.assertEqual(line_id("(1) x", ["alin-1"]), "alin-1-2")
        self.assertEqual(line_id("text", ["p-1"]), "p-2")
        self.assertEqual(line_id("(3) x", ["alin-1", "alin-1-lit-a"]), "alin-3")

    def test_blame_keeps_since_for_unchanged_lines_and_updates_changed_ones(self):
        self.commit({"art-0001.md": article(1, "(1) A", "(2) B", "(3) C")}, "2020-01-01")
        self.commit({"art-0001.md": article(1, "(1) A", "(2) B2", "(3) C", "(4) D")}, "2021-01-01", LAW_2020)
        lines = self.by_file()["art-0001.md"].versions[1].lines
        self.assertEqual(
            [(l.text, l.since, l.law_key) for l in lines],
            [
                ("(1) A", date(2020, 1, 1), "legea-138-2014"),
                ("(2) B2", date(2021, 1, 1), "legea-55-2020"),
                ("(3) C", date(2020, 1, 1), "legea-138-2014"),
                ("(4) D", date(2021, 1, 1), "legea-55-2020"),
            ],
        )

    def test_repealed_article_has_state_and_repealed_on(self):
        self.commit(
            {"art-0001.md": article(1, "A"), "art-0002.md": article(2, "B")}, "2020-01-01"
        )
        self.commit({"art-0001.md": None}, "2021-01-01", LAW_2021)
        articles = self.by_file()
        repealed = articles["art-0001.md"]
        self.assertEqual(repealed.state, "repealed")
        self.assertEqual(repealed.repealed_on, date(2021, 1, 1))
        self.assertEqual(repealed.versions[-1].until, date(2020, 12, 31))
        self.assertEqual(repealed.repealed_by_key, "legea-9-2021")
        self.assertEqual(repealed.repealed_by_label, LAW_2021)
        self.assertEqual(articles["art-0002.md"].state, "in-force")
        self.assertIsNone(articles["art-0002.md"].repealed_on)

    def test_body_abrogat_sets_repealed_state(self):
        self.commit({"art-0001.md": article(1, "(1) A")}, "2020-01-01")
        self.commit({"art-0001.md": article(1, "Abrogat.")}, "2021-01-01", LAW_2021)
        art = self.by_file()["art-0001.md"]
        self.assertEqual(art.state, "repealed")
        self.assertEqual(art.repealed_on, date(2021, 1, 1))
        self.assertEqual(art.repealed_by_key, "legea-9-2021")
        self.assertEqual(art.repealed_by_label, LAW_2021)
        self.assertEqual(len(art.versions), 2)

    def test_reinserted_article_is_in_force(self):
        self.commit({"art-0001.md": article(1, "A")}, "2020-01-01")
        self.commit({"art-0001.md": None}, "2021-01-01", LAW_2020)
        self.commit({"art-0001.md": article(1, "A")}, "2022-01-01", LAW_2021)
        art = self.by_file()["art-0001.md"]
        self.assertEqual(len(art.versions), 2)
        self.assertEqual(art.versions[0].until, date(2020, 12, 31))
        self.assertEqual(art.state, "in-force")
        self.assertIsNone(art.repealed_on)
        self.assertIsNone(art.repealed_by_key)

    def test_future_version_sets_state_future_when_no_version_is_in_force_today(self):
        self.commit({"art-0001.md": article(1, "A")}, "2030-01-01")
        art = self.by_file()["art-0001.md"]
        self.assertEqual(art.state, "future")
        self.assertIsNone(art.versions[0].until)

    def test_credits_override_law_key(self):
        self.commit({"art-0001.md": article(1, "A")}, "2020-01-01")
        self.commit({"art-0001.md": article(1, "B")}, "2021-01-01", LAW_2020)
        art = self.by_file(
            credits={("2021-01-01", "art-0001"): "legea-9-2021"},
            labels={"legea-9-2021": LAW_2021},
        )["art-0001.md"]
        self.assertEqual(art.versions[0].law_key, "legea-138-2014")
        self.assertEqual(art.versions[1].law_key, "legea-9-2021")
        self.assertEqual(art.versions[1].law_label, LAW_2021)
        self.assertEqual(art.versions[1].lines[0].law_key, "legea-9-2021")

    def test_unexplained_credit(self):
        self.commit({"art-0001.md": article(1, "A")}, "2020-01-01")
        self.commit({"art-0001.md": article(1, "B")}, "2021-01-01", LAW_2020)
        art = self.by_file(credits={("2021-01-01", "art-0001"): ""})["art-0001.md"]
        self.assertEqual(art.versions[1].law_key, "")
        self.assertEqual(art.versions[1].law_label, "unexplained")

    def test_date_before_first_version_has_no_version(self):
        self.commit({"art-0001.md": article(1, "A")}, "2020-01-01")
        art = self.by_file()["art-0001.md"]
        self.assertIsNone(version_on(art, date(2019, 12, 31)))
        self.assertEqual(version_on(art, date(2020, 1, 1)), art.versions[0])
        self.assertEqual(version_on(art, date(2099, 1, 1)), art.versions[0])

    def test_version_on_includes_until_day_and_excludes_the_next(self):
        self.commit({"art-0001.md": article(1, "A")}, "2020-01-01")
        self.commit({"art-0001.md": None}, "2021-01-01", LAW_2020)
        art = self.by_file()["art-0001.md"]
        self.assertIsNotNone(version_on(art, date(2020, 12, 31)))
        self.assertIsNone(version_on(art, date(2021, 1, 1)))

    def test_inserted_markers_get_underscore_ids(self):
        self.commit(
            {
                "art-0007.md": article(
                    7,
                    "(1^1) inserted first",
                    "a) one",
                    "m^1) inserted letter",
                    "(2) two",
                    "a^1) inserted under two",
                    "3^1. inserted point",
                    "3.1. sub point",
                    "3. plain point",
                )
            },
            "2020-01-01",
        )
        art = self.by_file()["art-0007.md"]
        self.assertIsNone(art.title)
        self.assertEqual(
            [line.id for line in art.versions[0].lines],
            [
                "alin-1_1",
                "alin-1_1-lit-a",
                "alin-1_1-lit-m_1",
                "alin-2",
                "alin-2-lit-a_1",
                "pct-3_1",
                "pct-3-1",
                "pct-3",
            ],
        )

    def test_line_id_inserted_forms_without_alin(self):
        self.assertEqual(line_id("a^1) x", []), "lit-a_1")
        self.assertEqual(line_id("1^1. x", []), "pct-1_1")
        self.assertEqual(line_id("(1^1) x", []), "alin-1_1")

    def test_repealer_is_file_commit_not_unrelated_later_commit(self):
        self.commit(
            {"art-0001.md": article(1, "A"), "art-0002.md": article(2, "B")}, "2020-01-01"
        )
        self.commit({"art-0001.md": None}, "2021-01-01", LAW_2021)
        self.commit({"art-0002.md": article(2, "C")}, "2021-01-01", LAW_2020, "correction")
        art = self.by_file()["art-0001.md"]
        self.assertEqual(art.state, "repealed")
        self.assertEqual(art.repealed_by_key, "legea-9-2021")
        self.assertEqual(art.repealed_by_label, LAW_2021)

    def test_credits_override_repealer(self):
        self.commit({"art-0001.md": article(1, "A")}, "2020-01-01")
        self.commit({"art-0001.md": None}, "2021-01-01", LAW_2021)
        art = self.by_file(
            credits={("2021-01-01", "art-0001"): "legea-55-2020"},
            labels={"legea-55-2020": LAW_2020},
        )["art-0001.md"]
        self.assertEqual((art.repealed_by_key, art.repealed_by_label), ("legea-55-2020", LAW_2020))
        art = self.by_file(credits={("2021-01-01", "art-0001"): ""})["art-0001.md"]
        self.assertEqual((art.repealed_by_key, art.repealed_by_label), ("", "unexplained"))

    def test_extract_reads_old_folder_across_layout_move(self):
        old, new = "codul-civil", "lege/2009/287"
        text1, text2 = article(1, "v1"), article(1, "v2")
        first = self.fixture.commit(
            {f"{old}/art-0001.md": text1},
            author=LAW_2014,
            trailers={"Kind": "base", "In-force": "2011-10-01"},
            message="Base",
        )
        self.fixture.commit(
            {f"{old}/art-0001.md": None, f"{new}/art-0001.md": text1},
            author="Lexifina",
            trailers={"Kind": "layout"},
            message="Move",
        )
        amendment = self.fixture.commit(
            {f"{new}/art-0001.md": text2},
            author=LAW_2020,
            trailers={"Kind": "amendment", "In-force": "2012-01-01"},
            message="Amend",
        )
        articles = extract_act(
            self.repo, new, old, credits={}, law_labels={}, today=TODAY
        )
        versions = articles[0].versions
        self.assertEqual([v.commit for v in versions], [first, amendment])
        self.assertEqual([v.law_commit for v in versions], [first, amendment])
        self.assertEqual([v.lines[0].text for v in versions], ["v1", "v2"])
        self.assertEqual(versions[0].until, date(2011, 12, 31))
        self.assertEqual(self.repo.show_file(versions[0].commit, f"{old}/art-0001.md"), text1)
        self.assertEqual(
            [v.source_path for v in versions], [f"{old}/art-0001.md", f"{new}/art-0001.md"]
        )
        for version in versions:
            self.assertEqual(
                self.repo.show_file(version.commit, version.source_path),
                text1 if version is versions[0] else text2,
            )

    def test_out_of_order_append_uses_commit_tree(self):
        first = self.commit(
            {"art-0001.md": article(1, "A text"), "art-0002.md": article(2, "base")},
            "2020-01-01",
        )
        self.commit({"art-0001.md": article(1, "B text")}, "2030-01-01", LAW_2020)
        correction = self.commit(
            {"art-0002.md": article(2, "fixed")}, "2021-01-01", LAW_2021, "correction"
        )
        commits = act_commits(self.repo, FOLDER, None)
        day = date(2021, 6, 1)
        selected = commit_for_day(commits, day)
        self.assertEqual(selected.trailers["Kind"], ["correction"])
        tree = tree_for_day(self.repo, commits, day, FOLDER, None)
        with self.repo.blobs() as reader:
            self.assertEqual(reader.read(tree["art-0001.md"]), article(1, "B text"))
        art = self.by_file()["art-0001.md"]
        self.assertEqual(version_on(art, day).lines[0].text, "B text")
        self.assertEqual(version_on(art, date(2020, 6, 1)).lines[0].text, "A text")
        version = version_on(art, day)
        self.assertEqual(version.commit, correction)
        self.assertEqual(version.law_commit, first)
        self.assertEqual(version.law_key, "legea-138-2014")
        self.assertEqual(
            self.repo.show_file(version.commit, f"{FOLDER}/art-0001.md"), article(1, "B text")
        )
        self.assertEqual(version_on(art, date(2020, 6, 1)).commit, first)

    def test_attribution_uses_file_history_not_act_commit(self):
        self.commit(
            {"art-0001.md": article(1, "A"), "art-0002.md": article(2, "x")},
            "2020-01-01",
        )
        self.commit({"art-0002.md": article(2, "y")}, "2021-01-01", LAW_2021)
        articles = self.by_file()
        self.assertEqual(len(articles["art-0001.md"].versions), 1)
        self.assertEqual(articles["art-0001.md"].versions[0].law_key, "legea-138-2014")
        self.assertEqual(articles["art-0001.md"].versions[0].kind, "amendment")
        self.assertEqual(articles["art-0002.md"].versions[1].law_key, "legea-9-2021")

    def test_title_absent_for_intro_line_ending_with_colon(self):
        self.commit(
            {"art-0002.md": article(2, "Prin contract se stabilesc:", "(1) primul", "(2) al doilea")},
            "2020-01-01",
        )
        art = self.by_file()["art-0002.md"]
        self.assertIsNone(art.title)
        self.assertEqual(
            [(l.id, l.text) for l in art.versions[0].lines][0],
            ("p-1", "Prin contract se stabilesc:"),
        )

    def test_title_needs_a_following_line(self):
        self.commit({"art-0003.md": article(3, "Doar un rand")}, "2020-01-01")
        art = self.by_file()["art-0003.md"]
        self.assertIsNone(art.title)
        self.assertEqual(len(art.versions[0].lines), 1)

    def test_inserted_article_number_from_heading(self):
        self.commit(
            {
                "art-0112-1.md": article("112^1", "Titlu", "(1) text"),
                "art-0113.md": "fara antet\n",
            },
            "2020-01-01",
        )
        articles = self.by_file()
        self.assertEqual(articles["art-0112-1.md"].number, "112^1")
        self.assertEqual(articles["art-0113.md"].number, "113")

    def test_number_falls_back_to_file_name(self):
        self.commit({"art-0112-1.md": "(1) text\n(2) alt text\n"}, "2020-01-01")
        self.assertEqual(self.by_file()["art-0112-1.md"].number, "112^1")

    def test_article_order_is_numeric(self):
        names = ["art-041.md", "art-040-10.md", "art-040-2.md", "art-040.md"]
        self.commit({name: article(1, "x") for name in names}, "2020-01-01")
        self.assertEqual(
            [a.file for a in self.extract()],
            ["art-040.md", "art-040-2.md", "art-040-10.md", "art-041.md"],
        )

    def test_article_order_with_letters_romans_and_title_groups(self):
        names = [
            "art-t3-i.md", "art-t1-1.md", "art-t1-unic.md", "art-ii-1.md", "art-ii.md", "art-i.md",
            "art-x.md", "art-ix.md", "art-270-2-a.md", "art-270-3.md", "art-270-2.md", "art-006-1.md",
            "art-007.md", "art-006.md", "art-t2-i.md", "art-t2-1.md",
        ]
        self.commit({name: article(1, "x") for name in names}, "2020-01-01")
        self.assertEqual(
            [a.file for a in self.extract()],
            [
                "art-006.md", "art-006-1.md", "art-007.md", "art-270-2.md", "art-270-2-a.md",
                "art-270-3.md", "art-i.md", "art-ii.md", "art-ii-1.md", "art-ix.md", "art-x.md",
                "art-t1-unic.md", "art-t1-1.md", "art-t2-1.md", "art-t2-i.md", "art-t3-i.md",
            ],
        )

    def test_transitory_articles_keep_their_heading_numbers(self):
        self.commit(
            {
                "art-0001.md": article(1, "Titlu", "(1) text"),
                "art-i.md": article("I", "(1) primul"),
                "art-t2-i.md": article("I", "(1) al doilea"),
                "art-t3-i.md": article("I", "(1) al treilea"),
                "art-t1-unic.md": article("UNIC", "text"),
                "art-270-2-a.md": article("270^2 a)", "text"),
            },
            "2020-01-01",
        )
        articles = self.extract()
        self.assertEqual(
            [(a.file, a.number) for a in articles],
            [
                ("art-0001.md", "1"),
                ("art-270-2-a.md", "270^2 a)"),
                ("art-i.md", "I"),
                ("art-t1-unic.md", "UNIC"),
                ("art-t2-i.md", "I"),
                ("art-t3-i.md", "I"),
            ],
        )
        self.assertTrue(all(a.state == "in-force" for a in articles))
        self.assertEqual(articles[3].versions[0].lines[0].text, "text")


if __name__ == "__main__":
    unittest.main()
