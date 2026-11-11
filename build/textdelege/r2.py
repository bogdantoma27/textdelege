import base64
import hashlib
import hmac
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from xml.sax.saxutils import escape

from .retry import TIMEOUT, parse_retry_after, with_retries

REGION = "auto"
SERVICE = "s3"
DELETE_BATCH = 1000
RETRY_STATUSES = (429, 500, 502, 503, 504)


class R2Error(Exception):
    def __init__(self, method: str, key: str, status: int, body: str, retry_after: float | None = None):
        super().__init__(f"R2 {method} {key!r} failed with {status}: {body}")
        self.method = method
        self.key = key
        self.status = status
        self.body = body
        self.retry_after = retry_after


def retryable(error: Exception) -> bool:
    if isinstance(error, R2Error):
        return error.status in RETRY_STATUSES
    return isinstance(error, (urllib.error.URLError, TimeoutError))


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _quote(value: str) -> str:
    return urllib.parse.quote(value, safe="-_.~")


def sign(
    method: str,
    url: str,
    headers: dict[str, str],
    payload_hash: str,
    *,
    access_key_id: str,
    secret_access_key: str,
    region: str,
    service: str,
    now: datetime,
) -> dict[str, str]:
    parts = urllib.parse.urlsplit(url)
    amz_date = now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    date = amz_date[:8]
    added = {"x-amz-date": amz_date, "x-amz-content-sha256": payload_hash}
    all_headers = {"host": parts.netloc}
    for name, value in {**headers, **added}.items():
        all_headers[name.lower()] = " ".join(str(value).split())
    names = sorted(all_headers)
    canonical_headers = "".join(f"{n}:{all_headers[n]}\n" for n in names)
    signed_headers = ";".join(names)
    query = sorted(
        (_quote(k), _quote(v)) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
    )
    canonical_query = "&".join(f"{k}={v}" for k, v in query)
    canonical_request = "\n".join(
        [method, parts.path or "/", canonical_query, canonical_headers, signed_headers, payload_hash]
    )
    scope = f"{date}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join(
        ["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()]
    )
    key = _hmac(_hmac(_hmac(_hmac(f"AWS4{secret_access_key}".encode("utf-8"), date), region), service), "aws4_request")
    signature = hmac.new(key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    added["Authorization"] = (
        f"AWS4-HMAC-SHA256 Credential={access_key_id}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
    )
    return added


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class R2Client:
    def __init__(
        self,
        account_id: str,
        bucket: str,
        access_key_id: str,
        secret_access_key: str,
        *,
        opener=urllib.request.urlopen,
        now=None,
        sleep=time.sleep,
    ):
        self._base = f"https://{account_id}.r2.cloudflarestorage.com/{bucket}"
        self._access_key_id = access_key_id
        self._secret_access_key = secret_access_key
        self._opener = opener
        self._now = now or _utcnow
        self._sleep = sleep

    def _request(
        self,
        method: str,
        key: str,
        *,
        query: dict[str, str] | None = None,
        body: bytes = b"",
        headers: dict[str, str] | None = None,
        ok_statuses: tuple[int, ...] = (),
    ) -> bytes | None:
        url = self._base + "/" + urllib.parse.quote(key, safe="/-_.~") if key else self._base + "/"
        if query:
            url += "?" + urllib.parse.urlencode(query, quote_via=urllib.parse.quote, safe="-_.~")
        headers = dict(headers or {})
        headers.update(
            sign(
                method,
                url,
                headers,
                hashlib.sha256(body).hexdigest(),
                access_key_id=self._access_key_id,
                secret_access_key=self._secret_access_key,
                region=REGION,
                service=SERVICE,
                now=self._now(),
            )
        )
        request = urllib.request.Request(url, data=body if method in ("PUT", "POST") else None, headers=headers, method=method)

        def attempt() -> bytes | None:
            try:
                with self._opener(request, timeout=TIMEOUT) as response:
                    return response.read()
            except urllib.error.HTTPError as error:
                with error:
                    if error.code in ok_statuses:
                        return None
                    raise R2Error(
                        method,
                        key,
                        error.code,
                        error.read().decode("utf-8", "replace"),
                        parse_retry_after(error.headers.get("Retry-After") if error.headers else None),
                    ) from error

        return with_retries(attempt, retryable, sleep=self._sleep)

    def put(self, key: str, body: bytes, content_type: str, content_encoding: str | None = None) -> None:
        headers = {"Content-Type": content_type}
        if content_encoding:
            headers["Content-Encoding"] = content_encoding
        self._request("PUT", key, body=body, headers=headers)

    def get(self, key: str) -> bytes | None:
        return self._request("GET", key, ok_statuses=(404,))

    def list(self, prefix: str) -> list[str]:
        keys: list[str] = []
        previous = None
        while True:
            token = None
            query = {"list-type": "2", "prefix": prefix}
            if previous:
                query["continuation-token"] = previous
            root = ET.fromstring(self._request("GET", "", query=query) or b"")
            for element in root.iter():
                tag = element.tag.rpartition("}")[2]
                if tag == "Key":
                    keys.append(element.text or "")
                elif tag == "NextContinuationToken":
                    token = element.text
            truncated = next((e.text for e in root.iter() if e.tag.rpartition("}")[2] == "IsTruncated"), "false")
            if truncated != "true" or not token:
                return keys
            previous = token

    def delete(self, key: str) -> None:
        self._request("DELETE", key, ok_statuses=(404,))

    def delete_prefix(self, prefix: str) -> int:
        if not prefix:
            raise ValueError("refusing to delete with an empty prefix")
        keys = self.list(prefix)
        for start in range(0, len(keys), DELETE_BATCH):
            objects = "".join(f"<Object><Key>{escape(k)}</Key></Object>" for k in keys[start : start + DELETE_BATCH])
            body = f'<Delete><Quiet>true</Quiet>{objects}</Delete>'.encode("utf-8")
            md5 = base64.b64encode(hashlib.md5(body).digest()).decode()
            result = self._request(
                "POST",
                "",
                query={"delete": ""},
                body=body,
                headers={"Content-MD5": md5, "Content-Type": "application/xml"},
            )
            for element in ET.fromstring(result or b"<DeleteResult/>").iter():
                if element.tag.rpartition("}")[2] == "Error":
                    fields = {c.tag.rpartition("}")[2]: (c.text or "") for c in element}
                    raise R2Error("POST", fields.get("Key", ""), 200, f"{fields.get('Code', '')}: {fields.get('Message', '')}")
        return len(keys)
