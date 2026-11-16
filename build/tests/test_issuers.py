import unittest
from datetime import date

from build.textdelege.extract import Article, Version
from build.textdelege.issuers import ISSUERS, KIND_WORDS, issuer_label, relabel_articles


class IssuerLabelTest(unittest.TestCase):
    def test_rewrites(self):
        cases = {
            "Norma asf nr. 32/2022": "Norma ASF nr. 32/2022",
            "Criterii guvern din 12 aprilie 1990": "Criteriile Guvernului din 12 aprilie 1990",
            "Regulament senat din 24 octombrie 2005": "Regulamentul Senatului din 24 octombrie 2005",
            "Hotărârea csspp nr. 14/2006": "Hotărârea CSSPP nr. 14/2006",
            "Norma xyz nr. 1/2000": "Norma XYZ nr. 1/2000",
            "Instrucțiuni bnr nr. 2/2001": "Instrucțiunile BNR nr. 2/2001",
            "Decizia sanatate nr. 3/2002": "Decizia Ministerului Sănătății nr. 3/2002",
            "Norma asf": "Norma ASF",
        }
        for label, expected in cases.items():
            self.assertEqual(issuer_label(label), expected, label)

    def test_leaves_others_alone(self):
        for label in (
            "Hotărârea Camerei Deputaților nr. 10/1990",
            "HG nr. 67/2020",
            "Legea nr. 1/2000",
            "Ordinul nr. 5/2020",
            "Norma nr. 5/2020",
            "Normalizare asf",
            "Norma ASF nr. 32/2022",
            "",
        ):
            self.assertEqual(issuer_label(label), label)

    def test_tables(self):
        self.assertEqual(len(KIND_WORDS), 12)
        self.assertEqual(ISSUERS["integritate"], "ANI")
        self.assertEqual(ISSUERS["senat"], "Senatului")


class RelabelTest(unittest.TestCase):
    def test_rewrites_version_and_repealed_by_labels(self):
        version = Version(date(2020, 1, 1), None, "a", "a", "norma-asf-32-2022", "Norma asf nr. 32/2022", "")
        other = Version(date(2021, 1, 1), None, "b", "b", "legea-1-2000", "Legea nr. 1/2000", "")
        article = Article(
            "art-1.md", "1", None, [version, other], "repealed", date(2021, 1, 1),
            "criterii-guvern-1990", "Criterii guvern din 12 aprilie 1990",
        )
        relabel_articles([article])
        self.assertEqual(version.law_label, "Norma ASF nr. 32/2022")
        self.assertEqual(other.law_label, "Legea nr. 1/2000")
        self.assertEqual(article.repealed_by_label, "Criteriile Guvernului din 12 aprilie 1990")

    def test_missing_repealed_by_label_stays(self):
        article = Article("art-1.md", "1", None, [], "in-force", None)
        relabel_articles([article])
        self.assertIsNone(article.repealed_by_label)


if __name__ == "__main__":
    unittest.main()
