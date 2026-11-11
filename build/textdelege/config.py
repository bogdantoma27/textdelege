import os
import tomllib
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

DEFAULT_SOURCE_URL = "https://github.com/lexifina/romania-law"


@dataclass(frozen=True)
class R2Config:
    account_id: str
    bucket: str
    access_key_id: str
    secret_access_key: str


@dataclass(frozen=True)
class D1Config:
    account_id: str
    database_id: str
    api_token: str


@dataclass(frozen=True)
class Config:
    source_url: str
    selection: Literal["codes", "primary"]
    cache_dir: Path
    r2: R2Config | None
    d1: D1Config | None


def _section(data: dict, name: str, keys: tuple[str, ...], env: Mapping[str, str]):
    names = data.get(name, {})
    values = []
    for key in keys:
        var = names.get(f"{key}_env")
        value = env.get(var) if var else None
        if not value:
            return None
        values.append(value)
    return values


def load_config(path: Path, env: Mapping[str, str] = os.environ) -> Config:
    path = Path(path).resolve()
    data = tomllib.loads(path.read_text(encoding="utf-8"))
    selection = data.get("selection", "codes")
    if selection not in ("codes", "primary"):
        raise ValueError(f"unknown selection: {selection!r}")
    r2 = _section(
        data, "r2",
        ("account_id", "bucket", "access_key_id", "secret_access_key"), env,
    )
    d1 = _section(data, "d1", ("account_id", "database_id", "api_token"), env)
    return Config(
        source_url=data.get("source_url", DEFAULT_SOURCE_URL),
        selection=selection,
        cache_dir=(path.parent / data.get("cache_dir", ".cache")).resolve(),
        r2=R2Config(*r2) if r2 else None,
        d1=D1Config(*d1) if d1 else None,
    )
