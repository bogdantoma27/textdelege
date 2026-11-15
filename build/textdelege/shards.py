import csv
import io
import json

INDEX = "data/index.json"


class ShardError(Exception):
    pass


def shard_entries(index_json: dict, kinds: tuple[str, ...]) -> list[dict]:
    """The shards of data/index.json that hold the given kinds, in index order."""
    entries = [entry for entry in index_json.get("shards", []) if entry.get("kind") in kinds]
    missing = sorted(set(kinds) - {entry["kind"] for entry in entries})
    if missing:
        raise ShardError(f"the source has no act lists for: {', '.join(missing)}")
    return entries


def merge_laws(base: str, extra: list[str]) -> str:
    """data/laws.csv followed by the shard rows whose key it does not have yet."""
    if not extra:
        return base
    reader = csv.DictReader(io.StringIO(base, newline=""))
    rows = list(reader)
    fields = reader.fieldnames
    seen = {row["key"] for row in rows}
    for text in extra:
        shard = csv.DictReader(io.StringIO(text, newline=""))
        if fields is None:
            fields = shard.fieldnames
        for row in shard:
            if row["key"] not in seen:
                seen.add(row["key"])
                rows.append(row)
    if fields is None:
        return base
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator="\n", extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue()


def load_extra(repo, head: str, kinds: tuple[str, ...]) -> tuple[list[dict], list[str], int]:
    """Act rows and laws CSV texts of the extra kinds, and how many blobs were prefetched."""
    if not kinds:
        return [], [], 0
    blobs = repo.prefetch_head([INDEX])
    text = repo.show_file(head, INDEX)
    if text is None:
        raise ShardError(f"{INDEX} is missing from the source repository")
    entries = shard_entries(json.loads(text), kinds)
    files = [entry["acts"] for entry in entries] + [entry["laws"] for entry in entries if entry.get("laws")]
    blobs += repo.prefetch_head(files)
    rows: list[dict] = []
    for entry in entries:
        raw = repo.show_file(head, entry["acts"])
        if raw is None:
            raise ShardError(f"{entry['acts']} is missing from the source repository")
        # Withdrawn acts have no folder (path is null), so they are left out here.
        rows.extend(
            row for row in json.loads(raw)["acts"] if row.get("withdrawn_by") is None and row.get("path")
        )
    laws = [
        found
        for entry in entries
        if entry.get("laws") and (found := repo.show_file(head, entry["laws"])) is not None
    ]
    return rows, laws, blobs
