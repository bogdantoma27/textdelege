import json
import math
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

from .retry import TIMEOUT, parse_retry_after, with_retries

SCHEMA_PATH = Path(__file__).with_name("schema.sql")
SCHEMA_VERSION = int(
    re.match(r"-- schema_version: (\d+)", SCHEMA_PATH.read_text(encoding="utf-8")).group(1)
)
BATCH_BYTES = 90_000


RETRY_STATUSES = (429, 503)


class D1Error(Exception):
    def __init__(self, message: str, status: int | None = None, retry_after: float | None = None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


class D1QuotaExceeded(D1Error):
    ...


QUOTA_MESSAGE = re.compile(r"limit|quota|exceeded", re.IGNORECASE)


def _failure(message: str, status: int | None = None, retry_after: float | None = None) -> D1Error:
    kind = D1QuotaExceeded if QUOTA_MESSAGE.search(message) else D1Error
    return kind(message, status, retry_after)


def retryable(error: Exception) -> bool:
    if isinstance(error, D1QuotaExceeded):
        return False
    if isinstance(error, D1Error):
        return error.status in RETRY_STATUSES
    return isinstance(error, urllib.error.URLError) and isinstance(error.reason, ConnectionRefusedError)


class D1Client:
    def __init__(
        self,
        account_id: str,
        database_id: str,
        api_token: str,
        *,
        opener=urllib.request.urlopen,
        sleep=time.sleep,
    ):
        self._url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}/query"
        self._token = api_token
        self._opener = opener
        self._sleep = sleep

    def query(self, sql: str, params: list | None = None) -> list[dict]:
        request = urllib.request.Request(
            self._url,
            data=json.dumps({"sql": sql, "params": params or []}).encode("utf-8"),
            headers={"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"},
            method="POST",
        )

        def attempt() -> dict:
            try:
                with self._opener(request, timeout=TIMEOUT) as response:
                    return json.loads(response.read())
            except urllib.error.HTTPError as error:
                with error:
                    raise _failure(
                        f"D1 query failed with HTTP {error.code}: {error.read().decode('utf-8', 'replace')}",
                        error.code,
                        parse_retry_after(error.headers.get("Retry-After") if error.headers else None),
                    ) from error

        payload = with_retries(attempt, retryable, sleep=self._sleep)
        if not payload.get("success"):
            raise _failure(f"D1 query failed: {payload.get('errors')}")
        results = payload.get("result") or []
        if not results:
            return []
        if not results[0].get("success", True):
            raise _failure(f"D1 statement failed: {payload.get('errors')}")
        return results[0].get("results", [])

    def execute_batch(self, statements: list[str], *, max_bytes: int = BATCH_BYTES) -> None:
        chunk: list[str] = []
        size = 0
        for statement in statements:
            length = len(statement.encode("utf-8")) + 2
            if chunk and size + length > max_bytes:
                self.query(";\n".join(chunk))
                chunk, size = [], 0
            chunk.append(statement)
            size += length
        if chunk:
            self.query(";\n".join(chunk))


def _literal(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return repr(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"non-finite float cannot be rendered: {value}")
        return repr(value)
    if isinstance(value, str):
        if "\x00" in value:
            raise ValueError("NUL character in string literal")
        escaped = value.replace("'", "''").replace("\r", "' || char(13) || '").replace("\n", "' || char(10) || '")
        return "'" + escaped + "'"
    raise TypeError(f"unsupported SQL parameter type: {type(value).__name__}")


def render_statement(sql: str, params: list) -> str:
    template = " ".join(sql.split())
    parts = template.split("?")
    if len(parts) - 1 != len(params):
        raise ValueError(f"expected {len(parts) - 1} parameters, got {len(params)}: {sql}")
    out = parts[0]
    for value, rest in zip(params, parts[1:]):
        out += _literal(value) + rest
    return out
