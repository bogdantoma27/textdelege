import unittest
from datetime import date, timedelta

from build.textdelege.extract import Article, Line, Version
from build.textdelege.laws import changes_feed, laws_from, parse_laws_csv, upcoming

HEADER = "key,label,kind,title,enacted,published,in_force_days,commits,url\n"
CSV = HEADER + (
    'legea-200-2023,Legea nr. 200/2023,law,"Legea nr. 200 din 5 iulie 2023, publicată în '
    'Monitorul Oficial al României, Partea I, nr. 616 din 6 iulie 2023",'
    "2023-07-05,2023-07-06,2023-07-09,5,https://legislatie.just.ro/Public/DetaliiDocument/271902\n"
    "legea-71-2011,Legea nr. 71/2011,law,Legea nr. 71/2011 pentru punerea în aplicare a "
    "Legii nr. 287/2009 privind Codul civil,,2011-06-10,2011-01-01 2011-06-13 2011-08-31 "
    "2011-10-01,35,\n"
    'oug-57-2019,OUG nr. 57/2019,decree,"Ordonanța de urgență a Guvernului nr. 57 din 3 iulie '
    '2019 privind Codul administrativ, publicată în Monitorul Oficial al României, Partea I, '
    'nr. 555 din 5 iulie 2019",2019-07-03,2019-07-05,2019-07-05,10,'
    "https://legislatie.just.ro/Public/DetaliiDocumentAfis/215925\n"
)

L200 = "legea-200-2023"
L71 = "legea-71-2011"
TODAY = date(2026, 11, 8)


def version(from_, until, key, label, text):
    line = Line(text, "alin-1", from_, key)
    return Version(from_, until, "c", "c", key, label, "law", [line])


def article(file, number, versions, title=None, state="in-force", repealed_on=None,
            by_key=None, by_label=None):
    return Article(file, number, title, versions, state, repealed_on, by_key, by_label)


def sample():
    a1 = article(
        "art-0001.md",
        "1",
        [
            version(date(2011, 10, 1), date(2023, 7, 8), L71, "Legea nr. 71/2011", "(1) A"),
            version(date(2023, 7, 9), None, L200, "Legea nr. 200/2023", "(1) B"),
        ],
        title="Titlu",
    )
    a2 = article(
        "art-0002.md",
        "2",
        [
            version(date(2011, 10, 1), date(2030, 12, 31), L71, "Legea nr. 71/2011", "(1) A"),
            version(date(2031, 1, 1), None, L200, "Legea nr. 200/2023", "(1) C"),
        ],
    )
    return {"codul/civil": [a1, a2]}


class ParseTest(unittest.TestCase):
    def test_parse_laws_csv_handles_empty_fields_and_multiple_days(self):
        row = parse_laws_csv(CSV)[L71]
        self.assertIsNone(row["enacted"])
        self.assertIsNone(row["source"])
        self.assertIsNone(row["mo"])
        self.assertEqual(row["published"], date(2011, 6, 10))
        self.assertEqual(
            row["in_force"],
            [date(2011, 1, 1), date(2011, 6, 13), date(2011, 8, 31), date(2011, 10, 1)],
        )
        source = parse_laws_csv(CSV)[L200]["source"]
        self.assertEqual(source, "https://legislatie.just.ro/Public/DetaliiDocument/271902")

    def test_mo_extracted_from_title(self):
        rows = parse_laws_csv(CSV)
        self.assertEqual(
            rows[L200]["mo"], "Monitorul Oficial al României, Partea I, nr. 616 din 6 iulie 2023"
        )
        self.assertEqual(rows["oug-57-2019"]["kind"], "decree")


class LawsTest(unittest.TestCase):
    def test_law_collects_dates_and_source(self):
        laws = laws_from(CSV, sample())
        law = laws[L200]
        self.assertEqual(law.label, "Legea nr. 200/2023")
        self.assertEqual(law.enacted, date(2023, 7, 5))
        self.assertEqual(law.in_force, [date(2023, 7, 9)])
        self.assertIsNotNone(law.mo)
        self.assertNotIn("oug-57-2019", laws)

    def test_law_changes_list_every_article_it_changed(self):
        changes = laws_from(CSV, sample())[L200].changes
        self.assertEqual(
            [(c.act_path, c.file, c.number, c.verb, c.units, c.date) for c in changes],
            [
                ("codul/civil", "art-0001", "1", "modified", ["alin-1"], date(2023, 7, 9)),
                ("codul/civil", "art-0002", "2", "modified", ["alin-1"], date(2031, 1, 1)),
            ],
        )

    def test_missing_law_falls_back_to_label(self):
        art = article("art-0001.md", "1", [version(date(2020, 1, 1), None, "x-1", "X 1", "(1) A")])
        law = laws_from(CSV, {"a": [art]})["x-1"]
        self.assertEqual((law.label, law.kind, law.title), ("X 1", "", ""))
        self.assertIsNone(law.enacted)
        self.assertEqual(law.in_force, [])
        self.assertEqual(law.changes[0].verb, "entered")

    def test_repealer_law_is_referenced(self):
        art = article(
            "art-0001.md",
            "1",
            [version(date(2020, 1, 1), date(2022, 12, 31), L71, "Legea nr. 71/2011", "(1) A")],
            state="repealed",
            repealed_on=date(2023, 1, 1),
            by_key=L200,
            by_label="Legea nr. 200/2023",
        )
        laws = laws_from(CSV, {"a": [art]})
        self.assertEqual([c.verb for c in laws[L200].changes], ["repealed"])
        self.assertEqual(laws[L200].changes[0].date, date(2023, 1, 1))


class FeedTest(unittest.TestCase):
    def test_changes_feed_is_sorted_newest_first_and_limited(self):
        feed = changes_feed(sample(), 2, TODAY)
        self.assertEqual([e["date"] for e in feed], ["2023-07-09", "2011-10-01"])
        self.assertEqual(
            feed[0],
            {
                "date": "2023-07-09",
                "act_path": "codul/civil",
                "file": "art-0001",
                "number": "1",
                "title": "Titlu",
                "verb": "modified",
                "units": ["alin-1"],
                "law_key": L200,
                "law_label": "Legea nr. 200/2023",
            },
        )
        self.assertEqual(feed[1]["file"], "art-0001")

    def test_feed_excludes_future_and_upcoming_excludes_past(self):
        feed = changes_feed(sample(), 100, TODAY)
        self.assertNotIn("2031-01-01", [e["date"] for e in feed])
        coming = upcoming(sample(), TODAY)
        self.assertEqual([(e["date"], e["file"]) for e in coming], [("2031-01-01", "art-0002")])
        self.assertIsNone(coming[0]["title"])

    def test_upcoming_is_oldest_first(self):
        art = article(
            "art-0001.md",
            "1",
            [
                version(date(2030, 1, 1), date(2030, 12, 31), L71, "L", "(1) A"),
                version(date(2031, 1, 1), None, L200, "L2", "(1) B"),
            ],
        )
        coming = upcoming({"x": [art]}, TODAY)
        self.assertEqual([e["date"] for e in coming], ["2030-01-01", "2031-01-01"])


    def test_upcoming_limit_keeps_the_earliest_events(self):
        versions = [
            version(date(2030, 1, 1) + timedelta(days=n), None, L200, "L", "(1) A") for n in range(5)
        ]
        art = article("art-0001.md", "1", versions)
        coming = upcoming({"x": [art]}, TODAY, 2)
        self.assertEqual([e["date"] for e in coming], ["2030-01-01", "2030-01-02"])
        self.assertEqual(len(upcoming({"x": [art]}, TODAY)), 5)


if __name__ == "__main__":
    unittest.main()
