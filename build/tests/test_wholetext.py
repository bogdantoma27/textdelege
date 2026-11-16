import tempfile
import unittest
from datetime import date
from pathlib import Path

from build.tests.fixture import FixtureRepo
from build.textdelege.gitrepo import GitRepo
from build.textdelege.verify import sample
from build.textdelege.wholetext import paragraphs, whole_text_articles

FOLDER = "hotarare-parlament/camera/1990/10"
TODAY = date(2026, 11, 8)
HP_A = "Hotărârea Camerei Deputaților nr. 10/1990"
HP_B = "Hotărârea Camerei Deputaților nr. 11/1991"


class ParagraphsTest(unittest.TestCase):
    def test_splits_and_drops_noise(self):
        text = "Art. 1 primul.  Art. 2 al doilea.   +  ----------\n\nArt. 3  +\n  trei  "
        self.assertEqual(paragraphs(text), ["Art. 1 primul.", "Art. 2 al doilea.", "Art. 3", "trei"])

    def test_single_spaces_kept(self):
        self.assertEqual(paragraphs("un singur rând cu spații simple"), ["un singur rând cu spații simple"])


class WholeTextTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.fixture = FixtureRepo(Path(tmp.name) / "src")
        self.repo = GitRepo(Path(tmp.name) / "src")

    def commit(self, files, in_force, author=HP_A):
        return self.fixture.commit(
            {f"{FOLDER}/{name}": text for name, text in files.items()},
            author=author,
            trailers={"Kind": "amendment", "Law": author, "In-force": in_force},
            message="Change",
        )

    def articles(self):
        return whole_text_articles(self.repo, FOLDER, None, TODAY)

    def test_single_version(self):
        self.commit({"metadata.md": "m", "text.md": "Primul.  Al doilea.  +  ----------"}, "1990-01-01")
        [article] = self.articles()
        self.assertEqual((article.file, article.number, article.title), ("art-text.md", "text", None))
        self.assertEqual(article.state, "in-force")
        [version] = article.versions
        self.assertEqual([line.text for line in version.lines], ["Primul.", "Al doilea."])
        self.assertEqual([line.id for line in version.lines], ["p-1", "p-2"])
        self.assertEqual(version.source_path, f"{FOLDER}/text.md")
        self.assertEqual(version.law_label, HP_A)
        self.assertEqual(version.kind, "amendment")

    def test_versions_and_blame(self):
        self.commit({"text.md": "Primul.  Al doilea."}, "1990-01-01")
        self.commit({"text.md": "Primul.  Al treilea."}, "1991-01-01", HP_B)
        [article] = self.articles()
        first, second = article.versions
        self.assertEqual((first.from_, first.until), (date(1990, 1, 1), date(1990, 12, 31)))
        self.assertEqual(second.law_label, HP_B)
        self.assertEqual(second.lines[0].since, date(1990, 1, 1))
        self.assertEqual(second.lines[1].since, date(1991, 1, 1))

    def test_metadata_only_act_stays_empty(self):
        self.commit({"metadata.md": "m"}, "1990-01-01")
        self.assertEqual(self.articles(), [])

    def test_removed_text_is_repealed(self):
        self.commit({"text.md": "Primul."}, "1990-01-01")
        self.commit({"text.md": None}, "1992-01-01", HP_B)
        [article] = self.articles()
        self.assertEqual(article.state, "repealed")
        self.assertEqual(article.repealed_on, date(1992, 1, 1))
        self.assertEqual(article.repealed_by_label, HP_B)

    def test_old_folder_fallback(self):
        self.commit({"text.md": "Primul."}, "1990-01-01")
        [article] = whole_text_articles(self.repo, "nowhere/1/1", FOLDER, TODAY)
        self.assertEqual(article.versions[0].source_path, f"{FOLDER}/text.md")

    def test_not_sampled_for_verification(self):
        self.commit({"text.md": "Primul."}, "1990-01-01")
        articles = {FOLDER: self.articles()}
        self.assertEqual(sample(articles, 10, 1, TODAY), [])


if __name__ == "__main__":
    unittest.main()
