import unittest
from datetime import date

from build.textdelege.events import events_for
from build.textdelege.extract import Article, Line, Version

LAW = "legea-1-2020"


def lines(*pairs):
    return [Line(text, id_, date(2020, 1, 1), LAW) for id_, text in pairs]


def version(from_, until, content, kind="law"):
    return Version(from_, until, "c", "c", LAW, "Legea 1/2020", kind, content)


def make(versions, state="in-force", repealed_on=None, by_key=None, by_label=None):
    return Article("art-0001.md", "1", None, versions, state, repealed_on, by_key, by_label)


A1 = ("alin-1", "(1) A")
A2 = ("alin-2", "(2) B")


class EventsTest(unittest.TestCase):
    def test_first_version_is_entered(self):
        art = make([version(date(2020, 1, 1), None, lines(A1))])
        (event,) = events_for(art)
        self.assertEqual(event.verb, "entered")
        self.assertEqual(event.units, [])
        self.assertIsNone(event.from_version)
        self.assertEqual(event.to_version, 0)
        self.assertEqual(event.date, date(2020, 1, 1))
        self.assertEqual(event.law_key, LAW)

    def test_changed_paragraph_is_modified_with_unit_ids(self):
        art = make(
            [
                version(date(2020, 1, 1), date(2020, 12, 31), lines(A1, A2)),
                version(date(2021, 1, 1), None, lines(A1, ("alin-2", "(2) C"))),
            ]
        )
        event = events_for(art)[0]
        self.assertEqual((event.verb, event.units), ("modified", ["alin-2"]))
        self.assertEqual((event.from_version, event.to_version), (0, 1))

    def test_new_paragraph_only_is_completed(self):
        art = make(
            [
                version(date(2020, 1, 1), date(2020, 12, 31), lines(A1)),
                version(date(2021, 1, 1), None, lines(A1, A2)),
            ]
        )
        event = events_for(art)[0]
        self.assertEqual((event.verb, event.units), ("completed", ["alin-2"]))

    def test_modified_lists_changed_added_removed_units(self):
        art = make(
            [
                version(date(2020, 1, 1), date(2020, 12, 31), lines(A1, A2, ("alin-3", "(3) X"))),
                version(
                    date(2021, 1, 1),
                    None,
                    lines(("alin-1", "(1) A2"), A2, ("alin-4", "(4) N")),
                ),
            ]
        )
        event = events_for(art)[0]
        self.assertEqual(event.verb, "modified")
        self.assertEqual(event.units, ["alin-1", "alin-4", "alin-3"])

    def test_version_with_only_incetat_efecte_juridice_is_unconstitutional_for_kind_court(self):
        art = make(
            [
                version(date(2020, 1, 1), date(2020, 12, 31), lines(A1, A2)),
                version(
                    date(2021, 1, 1),
                    None,
                    lines(A1, ("alin-2", "(2) Încetat efecte juridice.")),
                    kind="court",
                ),
            ]
        )
        event = events_for(art)[0]
        self.assertEqual((event.verb, event.units), ("unconstitutional", ["alin-2"]))
        self.assertEqual(event.kind, "court")

    def test_court_with_other_changes_is_modified(self):
        art = make(
            [
                version(date(2020, 1, 1), date(2020, 12, 31), lines(A1, A2)),
                version(date(2021, 1, 1), None, lines(("alin-1", "(1) Z"), A2), kind="court"),
            ]
        )
        self.assertEqual(events_for(art)[0].verb, "modified")

    def test_correction_kind_is_restated(self):
        art = make(
            [
                version(date(2020, 1, 1), date(2020, 12, 31), lines(A1)),
                version(date(2021, 1, 1), None, lines(("alin-1", "(1) A!")), kind="correction"),
            ]
        )
        event = events_for(art)[0]
        self.assertEqual((event.verb, event.units), ("restated", ["alin-1"]))

    def test_paragraph_abrogat_is_repealed_with_units(self):
        art = make(
            [
                version(date(2020, 1, 1), date(2020, 12, 31), lines(A1, A2)),
                version(date(2021, 1, 1), None, lines(A1, ("alin-2", "(2) Abrogat."))),
            ]
        )
        event = events_for(art)[0]
        self.assertEqual((event.verb, event.units), ("repealed", ["alin-2"]))

    def test_whole_body_abrogat_is_repealed(self):
        art = make(
            [
                version(date(2020, 1, 1), date(2020, 12, 31), lines(A1, A2)),
                version(date(2021, 1, 1), None, lines(("p-1", "Abrogat."))),
            ]
        )
        event = events_for(art)[0]
        self.assertEqual((event.verb, event.units), ("repealed", []))

    def test_deleted_file_is_repealed(self):
        art = make(
            [version(date(2020, 1, 1), date(2020, 12, 31), lines(A1))],
            state="repealed",
            repealed_on=date(2021, 1, 1),
            by_key="legea-9-2021",
            by_label="Legea 9/2021",
        )
        event = events_for(art)[0]
        self.assertEqual(event.verb, "repealed")
        self.assertEqual(event.date, date(2021, 1, 1))
        self.assertEqual(
            (event.law_key, event.law_label, event.kind), ("legea-9-2021", "Legea 9/2021", "")
        )
        self.assertEqual((event.from_version, event.to_version), (0, -1))

    def test_version_after_gap_is_entered_and_gap_is_repealed(self):
        art = make(
            [
                version(date(2020, 1, 1), date(2020, 12, 31), lines(A1)),
                version(date(2022, 1, 1), None, lines(A1)),
            ]
        )
        events = events_for(art)
        self.assertEqual([e.verb for e in events], ["entered", "repealed", "entered"])
        gap = events[1]
        self.assertEqual(gap.date, date(2021, 1, 1))
        self.assertEqual((gap.law_key, gap.law_label), ("", ""))
        self.assertEqual((events[0].from_version, events[0].to_version), (None, 1))

    def test_events_newest_first(self):
        art = make(
            [
                version(date(2020, 1, 1), date(2020, 12, 31), lines(A1)),
                version(date(2021, 1, 1), date(2021, 12, 31), lines(A1, A2)),
                version(date(2022, 1, 1), None, lines(A1, ("alin-2", "(2) C"))),
            ]
        )
        dates = [e.date for e in events_for(art)]
        self.assertEqual(dates, sorted(dates, reverse=True))
        self.assertEqual(len(dates), 3)


if __name__ == "__main__":
    unittest.main()
