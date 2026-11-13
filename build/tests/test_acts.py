import os
import shutil
import tempfile
import unittest
from datetime import date
from pathlib import Path

from build.textdelege.acts import (
    alias_for,
    aliases_for,
    old_folder_for,
    select_acts,
)
from build.textdelege.config import D1Config, R2Config, load_config

ROWS = [
    ("constitutia", "Constituția României", "Constituția", "constitutie/1991", "constitutie", "in force"),
    ("codul-civil", "Codul civil", "Codul civil", "lege/2009/287", "lege", "in force"),
    ("codul-fiscal", "Codul fiscal", "Codul fiscal", "lege/2015/227", "lege", "in force"),
    ("codul-fiscal-2003", "Codul fiscal", "Codul fiscal 2003", "lege/2003/571", "lege", "repealed 2016-01-01"),
    ("legea-207-2015", "Codul de procedură fiscală", "Codul de procedură fiscală", "lege/2015/207", "lege", "in force"),
    ("legea-86-2006", "Codul vamal al României", "Codul vamal (Legea nr. 86/2006)", "lege/2006/86", "lege", "in force"),
    ("legea-296-2004", "Codul consumului", "Legea nr. 296/2004", "lege/2004/296", "lege", "in force"),
    ("legea-21-2020", "Codul aerian", "Legea nr. 21/2020", "lege/2020/21", "lege", "in force"),
    ("legea-46-2008", "Codul silvic", "Legea nr. 46/2008", "lege/2008/46", "lege", "in force"),
    ("legea-3-1962", "CODUL SILVIC", "Legea nr. 3/1962", "lege/1962/3", "lege", "amended, not consolidated"),
    ("codul-civil-1864", "Codul civil din 26 noiembrie 1864", "Codul civil din 1864", "cod/1864/civil", "cod", "repealed 2013-02-15"),
    ("codul-procedura-civila", "Codul de procedură civilă", "Codul de procedură civilă", "lege/2010/134", "lege", "in force"),
]
EXPECTED = {
    "constitutia": "constitutia",
    "codul-civil": "codul-civil",
    "codul-fiscal": "codul-fiscal",
    "codul-fiscal-2003": "codul-fiscal-2003",
    "legea-207-2015": "codul-procedura-fiscala",
    "legea-86-2006": "codul-vamal",
    "legea-296-2004": "codul-consumului",
    "legea-21-2020": "codul-aerian",
    "legea-46-2008": "codul-silvic",
    "legea-3-1962": "codul-silvic-1962",
    "codul-civil-1864": "codul-civil-1864",
    "codul-procedura-civila": "codul-procedura-civila",
}


def row(slug, code, short, path, kind, status, **extra):
    parts = path.split("/")
    year = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else int(parts[-1])
    base = {
        "code": code, "from": "2000-01-01", "kind": kind, "latest": "2025-01-01",
        "number": parts[2] if len(parts) > 2 else "", "path": path, "portal": "https://x",
        "reason": None, "short": short, "slug": slug, "status": status,
        "title": f"title {slug}", "versions": 3, "withdrawn_by": None, "year": year,
    }
    base.update(extra)
    return base


def acts_json(*extra):
    return {"country": "RO", "acts": [row(*r) for r in ROWS] + list(extra)}


PATHS = {"paths": {"codul-civil": "lege/2009/287", "legea-86-2006": "lege/2006/86"}, "aliases": {}}
PLAIN = row("legea-1-2000", None, "Legea nr. 1/2000", "lege/2000/1", "lege", "in force")


class SelectTest(unittest.TestCase):
    def test_select_codes_includes_constitution_and_coded_acts_only(self):
        metas = select_acts(acts_json(PLAIN), PATHS, "codes")
        self.assertEqual(len(metas), len(ROWS))
        self.assertEqual(metas[0].slug, "constitutia")
        self.assertEqual([m.path for m in metas[1:]], sorted(m.path for m in metas[1:]))
        self.assertNotIn("legea-1-2000", [m.slug for m in metas])
        civil = next(m for m in metas if m.slug == "codul-civil")
        self.assertEqual(civil.from_, date(2000, 1, 1))
        self.assertEqual(civil.latest, date(2025, 1, 1))
        self.assertEqual((civil.year, civil.number, civil.versions), (2009, "287", 3))

    def test_primary_kinds_and_withdrawn_excluded(self):
        withdrawn = row("legea-2-2000", "Codul x", "Codul x", "lege/2000/2", "lege", "in force", withdrawn_by="x")
        hg = row("hg-1-2000", None, "HG", "decret/2000/1", "decret", "in force")
        other = row("hg-2-2000", None, "HG", "hg/2000/2", "hg", "in force")
        metas = select_acts(acts_json(PLAIN, withdrawn, hg, other), PATHS, "primary")
        slugs = [m.slug for m in metas]
        self.assertIn("legea-1-2000", slugs)
        self.assertIn("hg-1-2000", slugs)
        self.assertNotIn("hg-2-2000", slugs)
        self.assertNotIn("legea-2-2000", slugs)
        self.assertIn("codul-civil-1864", slugs)
        self.assertEqual(slugs[0], "constitutia")
        self.assertIsNone(next(m for m in metas if m.slug == "legea-1-2000").alias)
        withdrawn_codes = select_acts(acts_json(withdrawn), PATHS, "codes")
        self.assertNotIn("legea-2-2000", [m.slug for m in withdrawn_codes])


class ConsolidatedSelectionTest(unittest.TestCase):
    def slugs(self, *extra):
        return [m.slug for m in select_acts(acts_json(*extra), PATHS, "consolidated")]

    def test_codes_stay_whatever_their_status_and_in_force_primary_acts_join(self):
        law = row("legea-1-2001", None, None, "lege/2001/1", "lege", "in force")
        ordinance = row("oug-5-2002", None, None, "oug/2002/5", "oug", "in force")
        decree = row("decret-lege-1-1990", None, None, "decret-lege/1990/1", "decret-lege", "in force")
        slugs = self.slugs(law, ordinance, decree)
        for slug in ("legea-1-2001", "oug-5-2002", "decret-lege-1-1990", "codul-civil-1864", "constitutia"):
            self.assertIn(slug, slugs)

    def test_repealed_amended_withdrawn_and_other_kinds_are_left_out(self):
        repealed = row("legea-2-2001", None, None, "lege/2001/2", "lege", "repealed 2010-01-01")
        amended = row("legea-3-2001", None, None, "lege/2001/3", "lege", "amended, not consolidated")
        withdrawn = row("legea-4-2001", None, None, "lege/2001/4", "lege", "in force", withdrawn_by="x")
        order = row("hg-5-2001", None, None, "hg/2001/5", "hg", "in force")
        decree = row("decret-6-1970", None, None, "decret/1970/6", "decret", "in force")
        slugs = self.slugs(repealed, amended, withdrawn, order, decree)
        for slug in ("legea-2-2001", "legea-3-2001", "legea-4-2001", "hg-5-2001", "decret-6-1970"):
            self.assertNotIn(slug, slugs)

    def test_plain_acts_get_no_alias_and_cannot_collide(self):
        extra = [
            row(f"legea-{n}-2001", None, "Legea nr. 1", f"lege/2001/{n}", "lege", "in force")
            for n in range(10, 14)
        ]
        metas = select_acts(acts_json(*extra), PATHS, "consolidated")
        self.assertTrue(all(m.alias is None for m in metas if m.slug.startswith("legea-1")))


class AliasTest(unittest.TestCase):
    def test_alias_slug_strips_diacritics_and_spaces(self):
        metas = select_acts(acts_json(PLAIN), PATHS, "codes")
        self.assertEqual({m.slug: m.alias for m in metas}, EXPECTED)
        self.assertEqual(aliases_for(metas), {m.path: EXPECTED[m.slug] for m in metas})

    def test_alias_for_single_act(self):
        metas = {m.slug: m for m in select_acts(acts_json(PLAIN), PATHS, "codes")}
        self.assertEqual(alias_for(metas["legea-3-1962"]), "codul-silvic")
        self.assertEqual(alias_for(metas["legea-207-2015"]), "codul-procedura-fiscala")
        plain = select_acts(acts_json(PLAIN), PATHS, "primary")
        self.assertIsNone(alias_for(next(m for m in plain if m.slug == "legea-1-2000")))

    def test_old_folder_is_the_act_id(self):
        metas = {m.slug: m for m in select_acts(acts_json(), PATHS, "codes")}
        self.assertEqual(old_folder_for(metas["legea-86-2006"], PATHS), "legea-86-2006")
        self.assertIsNone(old_folder_for(metas["legea-21-2020"], PATHS))
        same = {"paths": {"codul-civil": "codul-civil"}}
        meta = metas["codul-civil"]
        self.assertIsNone(old_folder_for(meta, same))


class ShortNameTest(unittest.TestCase):
    def test_codes_get_clean_names_and_historical_homonyms_a_year(self):
        metas = select_acts(acts_json(PLAIN), PATHS, "codes")
        self.assertEqual({m.slug: m.short for m in metas}, {
            "constitutia": "Constituția",
            "codul-civil": "Codul civil",
            "codul-fiscal": "Codul fiscal",
            "codul-fiscal-2003": "Codul fiscal 2003",
            "legea-207-2015": "Codul de procedură fiscală",
            "legea-86-2006": "Codul vamal",
            "legea-296-2004": "Codul consumului",
            "legea-21-2020": "Codul aerian",
            "legea-46-2008": "Codul silvic",
            "legea-3-1962": "Codul silvic din 1962",
            "codul-civil-1864": "Codul civil din 1864",
            "codul-procedura-civila": "Codul de procedură civilă",
        })

    def test_non_code_acts_keep_their_short_name(self):
        plain = select_acts(acts_json(PLAIN), PATHS, "primary")
        self.assertEqual(
            next(m.short for m in plain if m.slug == "legea-1-2000"), "Legea nr. 1/2000"
        )


class DuplicateAliasTest(unittest.TestCase):
    def test_duplicate_alias_raises(self):
        metas = [
            select_acts({"acts": [row(*r)]}, {"paths": {}}, "codes")[0]
            for r in (
                ("a", "Codul fiscal", "Codul fiscal", "lege/2015/227", "lege", "in force"),
                ("b", "Codul fiscal", "Codul fiscal", "lege/2016/1", "lege", "in force"),
            )
        ]
        with self.assertRaises(ValueError) as ctx:
            aliases_for(metas)
        message = str(ctx.exception)
        for part in ("codul-fiscal", "lege/2015/227", "lege/2016/1"):
            self.assertIn(part, message)


class ConfigTest(unittest.TestCase):
    def write(self, text):
        d = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: shutil.rmtree(d, ignore_errors=True))
        p = d / "config.toml"
        p.write_text(text, encoding="utf-8")
        return p

    def test_load_config_defaults(self):
        p = self.write("")
        cfg = load_config(p, {})
        self.assertEqual(cfg.source_url, "https://github.com/lexifina/romania-law")
        self.assertEqual(cfg.selection, "codes")
        self.assertEqual(cfg.cache_dir, p.parent / ".cache")
        self.assertIsNone(cfg.r2)
        self.assertIsNone(cfg.d1)

    def test_load_config_resolves_relative_cache_dir(self):
        p = self.write("")
        previous = os.getcwd()
        self.addCleanup(os.chdir, previous)
        os.chdir(p.parent)
        cfg = load_config(Path("config.toml"), {})
        self.assertTrue(cfg.cache_dir.is_absolute())
        self.assertEqual(cfg.cache_dir, p.parent.resolve() / ".cache")

    def test_sections_from_environment(self):
        p = self.write(
            '[r2]\naccount_id_env = "A"\nbucket_env = "B"\n'
            'access_key_id_env = "C"\nsecret_access_key_env = "D"\n'
            '[d1]\naccount_id_env = "A"\ndatabase_id_env = "E"\napi_token_env = "F"\n'
        )
        env = {"A": "acc", "B": "bkt", "C": "key", "D": "sec", "E": "db"}
        cfg = load_config(p, env)
        self.assertEqual(cfg.r2, R2Config("acc", "bkt", "key", "sec"))
        self.assertIsNone(cfg.d1)
        cfg = load_config(p, {**env, "F": "tok"})
        self.assertEqual(cfg.d1, D1Config("acc", "db", "tok"))

    def test_headings_are_off_by_default_and_need_twenty_articles(self):
        cfg = load_config(self.write(""), {})
        self.assertEqual((cfg.headings, cfg.headings_min_articles), (False, 20))
        cfg = load_config(self.write("headings = true" + chr(10) + "headings_min_articles = 5" + chr(10)), {})
        self.assertEqual((cfg.headings, cfg.headings_min_articles), (True, 5))

    def test_repo_config_loads(self):
        cfg = load_config(Path(__file__).parents[1] / "config.toml", {})
        self.assertEqual(cfg.selection, "codes")
        self.assertTrue(cfg.headings)
