import json
import unittest

from types import SimpleNamespace

from build.textdelege.shards import ShardError, ever_had_articles, load_extra, merge_laws, shard_entries

HEADER = "key,label,kind,title,enacted,published,in_force_days,commits,url\n"
INDEX = {
    "shards": [
        {"shard": "anexa/1990", "kind": "anexa", "acts": "data/acts/anexa/1990.json", "laws": "data/laws/anexa/1990.csv"},
        {"shard": "hg/1990", "kind": "hg", "acts": "data/acts/hg/1990.json", "laws": "data/laws/hg/1990.csv"},
        {"shard": "hg/1991", "kind": "hg", "acts": "data/acts/hg/1991.json", "laws": "data/laws/hg/1991.csv"},
    ]
}


class FakeRepo:
    def __init__(self, files):
        self.files = files
        self.prefetched = []

    def prefetch_head(self, paths):
        self.prefetched.extend(paths)
        return len(paths)

    def show_file(self, head, path):
        return self.files.get(path)

    def _git(self, *args):
        kinds = args[args.index("--") + 1:]
        return "".join(f"{name}\n" for name in self.files if name.split("/")[0] in kinds)


def acts(*paths):
    return json.dumps({"acts": [{"path": p, "kind": p.split("/")[0]} for p in paths]})


class ShardTest(unittest.TestCase):
    def test_entries_of_the_kinds_only_and_unknown_kinds_fail(self):
        self.assertEqual([e["shard"] for e in shard_entries(INDEX, ("hg",))], ["hg/1990", "hg/1991"])
        with self.assertRaises(ShardError) as ctx:
            shard_entries(INDEX, ("hg", "ordin"))
        self.assertIn("ordin", str(ctx.exception))

    def test_merge_keeps_the_primary_row_and_adds_new_keys(self):
        base = HEADER + 'legea-1-2000,Legea nr. 1/2000,law,"Legea, cu virgulă",2000-01-01,2000-01-02,2000-01-02,1,u\n'
        shard = HEADER + "legea-1-2000,altceva,law,t,,,,1,u\nhg-2-1990,HG nr. 2/1990,decree,\"t\nrând\",,,,1,u\n"
        merged = merge_laws(base, [shard])
        self.assertEqual(merged.count("legea-1-2000"), 1)
        self.assertIn('"Legea, cu virgulă"', merged)
        self.assertIn('hg-2-1990,HG nr. 2/1990,decree,"t\nrând"', merged)
        self.assertNotIn("altceva", merged)
        self.assertEqual(merge_laws(base, []), base)

    def test_load_extra_reads_every_shard_of_the_kinds(self):
        repo = FakeRepo({
            "data/index.json": json.dumps(INDEX),
            "data/acts/hg/1990.json": acts("hg/1990/1", "hg/1990/2"),
            "data/acts/hg/1991.json": json.dumps({"acts": [
                {"path": "hg/1991/7", "kind": "hg", "withdrawn_by": None},
                {"path": None, "kind": "hg", "withdrawn_by": "e74b4fb6fd04"},
            ]}),
            "data/acts/anexa/1990.json": acts("anexa/1990/1"),
            "data/laws/hg/1990.csv": HEADER + "hg-1-1990,HG nr. 1/1990,decree,t,,,,1,u\n",
            "hg/1990/1/art-0001.md": "a", "hg/1990/2/art-0001.md": "b", "hg/1991/7/art-0001.md": "c",
        })
        rows, laws, blobs = load_extra(repo, "head", ("hg",))
        self.assertEqual([r["path"] for r in rows], ["hg/1990/1", "hg/1990/2", "hg/1991/7"])
        self.assertEqual(len(laws), 1)
        self.assertNotIn("data/acts/anexa/1990.json", repo.prefetched)
        self.assertEqual(blobs, len(repo.prefetched))
        self.assertEqual(load_extra(repo, "head", ()), ([], [], 0))

    def test_whole_documents_are_left_out_but_acts_repealed_in_full_stay(self):
        repo = FakeRepo({
            "data/index.json": json.dumps(INDEX),
            "data/acts/hg/1990.json": acts("hg/1990/1", "hg/1990/2"),
            "data/acts/hg/1991.json": acts("hg/1991/7", "hg/1991/8"),
            "hg/1990/1/art-0001.md": "a",
            "hg/1990/2/README.md": "r", "hg/1990/2/text.md": "whole",
            "hg/1991/7/README.md": "repealed in full, no articles left",
            "hg/1991/8/text.md": "t", "hg/1991/8/art-0001.md": "both",
        })
        rows, _laws, _blobs = load_extra(repo, "head", ("hg",))
        self.assertEqual([r["path"] for r in rows], ["hg/1990/1", "hg/1991/7", "hg/1991/8"])

    def test_an_act_counts_as_having_articles_if_any_commit_touched_one(self):
        history = SimpleNamespace(touch={
            "hg/1990/1": [["c2", ["README.md"]], ["c1", ["art-0001.md", "README.md"]]],
            "hg-1-1990": [["c0", ["art-0002.md"]]],
            "decizie/x/2000/5": [["c3", ["README.md"]], ["c4", ["anexa-1/art-0001.md"]]],
        })
        self.assertTrue(ever_had_articles(history, ["hg/1990/1"]))
        self.assertTrue(ever_had_articles(history, ["hg/1990/9", "hg-1-1990"]))
        self.assertFalse(ever_had_articles(history, ["decizie/x/2000/5"]))
        self.assertFalse(ever_had_articles(history, ["missing"]))

    def test_load_extra_fails_on_a_missing_list(self):
        repo = FakeRepo({"data/index.json": json.dumps(INDEX)})
        with self.assertRaises(ShardError):
            load_extra(repo, "head", ("hg",))
        with self.assertRaises(ShardError):
            load_extra(FakeRepo({}), "head", ("hg",))


if __name__ == "__main__":
    unittest.main()
