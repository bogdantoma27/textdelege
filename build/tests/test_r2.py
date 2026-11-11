import base64
import hashlib
import io
import unittest
import urllib.error
from datetime import datetime, timezone

from build.textdelege.r2 import R2Client, R2Error, sign

NOW = datetime(2026, 11, 8, 12, 0, 0, tzinfo=timezone.utc)
NS = 'xmlns="http://s3.amazonaws.com/doc/2006-03-01/"'


class FakeResponse:
    def __init__(self, body=b"", status=200, headers=None):
        self._body = body
        self.status = status
        self.headers = headers or {}

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeOpener:
    def __init__(self, *responses):
        self.responses = list(responses)
        self.requests = []
        self.timeouts = []

    def __call__(self, request, timeout=None):
        self.requests.append(request)
        self.timeouts.append(timeout)
        item = self.responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def http_error(status, body=b"", headers=None):
    return urllib.error.HTTPError("http://x", status, "err", headers or {}, io.BytesIO(body))


def client(opener, sleeps=None):
    sleep = (lambda seconds: None) if sleeps is None else sleeps.append
    return R2Client("acct", "bkt", "AKID", "SECRET", opener=opener, now=lambda: NOW, sleep=sleep)


def header(request, name):
    return {k.lower(): v for k, v in request.header_items()}.get(name.lower())


class R2Tests(unittest.TestCase):
    def test_sigv4_known_vector(self):
        headers = sign(
            "GET",
            "https://examplebucket.s3.amazonaws.com/test.txt",
            {"Range": "bytes=0-9"},
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            access_key_id="AKIAIOSFODNN7EXAMPLE",
            secret_access_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            region="us-east-1",
            service="s3",
            now=datetime(2013, 5, 24, tzinfo=timezone.utc),
        )
        auth = headers["Authorization"]
        self.assertTrue(
            auth.startswith("AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request")
        )
        self.assertIn("SignedHeaders=host;range;x-amz-content-sha256;x-amz-date", auth)
        self.assertIn("Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41", auth)
        self.assertEqual(headers["x-amz-date"], "20130524T000000Z")

    def test_put_signs_request_with_sigv4(self):
        op = FakeOpener(FakeResponse())
        client(op).put("a/b c.json", b"hello", "application/json", "gzip")
        req = op.requests[0]
        self.assertEqual(req.get_method(), "PUT")
        self.assertEqual(req.full_url, "https://acct.r2.cloudflarestorage.com/bkt/a/b%20c.json")
        self.assertTrue(
            header(req, "Authorization").startswith("AWS4-HMAC-SHA256 Credential=AKID/20261108/auto/s3/aws4_request")
        )
        self.assertEqual(header(req, "x-amz-content-sha256"), hashlib.sha256(b"hello").hexdigest())
        self.assertEqual(header(req, "Content-Encoding"), "gzip")
        self.assertEqual(header(req, "Content-Type"), "application/json")
        self.assertEqual(req.data, b"hello")

    def test_requests_carry_a_timeout(self):
        op = FakeOpener(FakeResponse())
        client(op).put("k", b"x", "text/plain")
        self.assertEqual(op.timeouts, [60])

    def test_retries_transport_errors_and_retryable_statuses_with_backoff(self):
        for make in (
            lambda: urllib.error.URLError("reset"),
            lambda: TimeoutError("slow"),
            lambda: http_error(429),
            lambda: http_error(500),
            lambda: http_error(502),
            lambda: http_error(503),
            lambda: http_error(504),
        ):
            failure = make()
            with self.subTest(failure=repr(failure)):
                sleeps = []
                op = FakeOpener(failure, make(), FakeResponse(b"data"))
                self.assertEqual(client(op, sleeps).get("k"), b"data")
                self.assertEqual(len(op.requests), 3)
                self.assertEqual(len(sleeps), 2)
                self.assertTrue(1 <= sleeps[0] < 2 and 2 <= sleeps[1] < 3)

    def test_retry_honours_retry_after_and_gives_up_after_five_attempts(self):
        sleeps = []
        throttled = [http_error(429, b"slow down", {"Retry-After": "7"}) for _ in range(5)]
        op = FakeOpener(*throttled)
        with self.assertRaises(R2Error) as ctx:
            client(op, sleeps).put("k", b"x", "text/plain")
        self.assertEqual(ctx.exception.status, 429)
        self.assertEqual(len(op.requests), 5)
        self.assertEqual(sleeps, [7.0] * 4)

    def test_client_errors_are_not_retried(self):
        for status in (400, 403, 404, 412):
            op = FakeOpener(http_error(status), FakeResponse())
            sleeps = []
            with self.assertRaises(R2Error):
                client(op, sleeps).put("k", b"x", "text/plain")
            self.assertEqual((len(op.requests), sleeps), (1, []))

    def test_get_returns_none_on_404(self):
        op = FakeOpener(http_error(404), FakeResponse(b"data"))
        c = client(op)
        self.assertIsNone(c.get("missing"))
        self.assertEqual(c.get("present"), b"data")

    def test_delete_removes_one_key_and_tolerates_a_missing_one(self):
        op = FakeOpener(FakeResponse(status=204), http_error(404), http_error(403))
        c = client(op)
        c.delete("a/b c.json")
        c.delete("gone.json")
        req = op.requests[0]
        self.assertEqual(req.get_method(), "DELETE")
        self.assertEqual(req.full_url, "https://acct.r2.cloudflarestorage.com/bkt/a/b%20c.json")
        self.assertTrue(header(req, "Authorization").startswith("AWS4-HMAC-SHA256"))
        with self.assertRaises(R2Error):
            c.delete("denied.json")

    def test_list_follows_continuation_token(self):
        page1 = (
            f"<ListBucketResult {NS}><IsTruncated>true</IsTruncated>"
            "<NextContinuationToken>tok/1=</NextContinuationToken>"
            "<Contents><Key>p/a</Key></Contents></ListBucketResult>"
        ).encode()
        page2 = (
            f"<ListBucketResult {NS}><IsTruncated>false</IsTruncated>"
            "<Contents><Key>p/b</Key></Contents></ListBucketResult>"
        ).encode()
        op = FakeOpener(FakeResponse(page1), FakeResponse(page2))
        self.assertEqual(client(op).list("p/"), ["p/a", "p/b"])
        self.assertIn("list-type=2", op.requests[0].full_url)
        self.assertIn("prefix=p%2F", op.requests[0].full_url)
        self.assertIn("continuation-token=tok%2F1%3D", op.requests[1].full_url)

    def test_delete_prefix_batches_and_sends_content_md5(self):
        keys = [f"p/{i}" for i in range(1001)]
        body = (
            f"<ListBucketResult {NS}><IsTruncated>false</IsTruncated>"
            + "".join(f"<Contents><Key>{k}</Key></Contents>" for k in keys)
            + "</ListBucketResult>"
        ).encode()
        op = FakeOpener(FakeResponse(body), FakeResponse(b"<DeleteResult/>"), FakeResponse(b"<DeleteResult/>"))
        self.assertEqual(client(op).delete_prefix("p/"), 1001)
        deletes = op.requests[1:]
        self.assertEqual(len(deletes), 2)
        for req in deletes:
            self.assertEqual(req.get_method(), "POST")
            self.assertIn("delete", req.full_url)
            self.assertEqual(header(req, "Content-MD5"), base64.b64encode(hashlib.md5(req.data).digest()).decode())
        self.assertEqual(deletes[0].data.count(b"<Object>"), 1000)
        self.assertEqual(deletes[1].data.count(b"<Object>"), 1)

    def test_non_2xx_raises_r2error(self):
        op = FakeOpener(http_error(403, b"denied"))
        with self.assertRaises(R2Error) as ctx:
            client(op).put("k", b"x", "text/plain")
        self.assertEqual(ctx.exception.status, 403)
        self.assertEqual(ctx.exception.body, "denied")
        self.assertEqual(ctx.exception.key, "k")

    def test_delete_prefix_raises_on_partial_failure(self):
        listing = f"<ListBucketResult {NS}><IsTruncated>false</IsTruncated><Contents><Key>p/1</Key></Contents></ListBucketResult>"
        result = "<DeleteResult><Error><Key>p/1</Key><Code>AccessDenied</Code><Message>denied</Message></Error></DeleteResult>"
        op = FakeOpener(FakeResponse(listing.encode()), FakeResponse(result.encode()))
        with self.assertRaises(R2Error) as ctx:
            client(op).delete_prefix("p/")
        self.assertEqual((ctx.exception.key, ctx.exception.status, ctx.exception.body), ("p/1", 200, "AccessDenied: denied"))
        self.assertEqual(header(op.requests[1], "Content-Type"), "application/xml")

    def test_delete_prefix_rejects_empty_prefix(self):
        with self.assertRaises(ValueError):
            client(FakeOpener()).delete_prefix("")

    def test_delete_prefix_escapes_xml_in_keys(self):
        listing = f"<ListBucketResult {NS}><IsTruncated>false</IsTruncated><Contents><Key>p/a&amp;b&lt;c</Key></Contents></ListBucketResult>"
        op = FakeOpener(FakeResponse(listing.encode()), FakeResponse(b"<DeleteResult/>"))
        client(op).delete_prefix("p/")
        self.assertIn(b"<Key>p/a&amp;b&lt;c</Key>", op.requests[1].data)

    def test_list_stops_when_truncated_without_token(self):
        page = f"<ListBucketResult {NS}><IsTruncated>true</IsTruncated><Contents><Key>p/a</Key></Contents></ListBucketResult>"
        self.assertEqual(client(FakeOpener(FakeResponse(page.encode()))).list("p/"), ["p/a"])

    def test_romanian_key_is_signed_on_encoded_path(self):
        op = FakeOpener(FakeResponse())
        client(op).put("acte/știre mă.json", b"x", "application/json")
        req = op.requests[0]
        self.assertTrue(req.full_url.endswith("/bkt/acte/%C8%99tire%20m%C4%83.json"))
        expected = sign(
            "PUT", req.full_url, {"Content-Type": "application/json"}, hashlib.sha256(b"x").hexdigest(),
            access_key_id="AKID", secret_access_key="SECRET", region="auto", service="s3", now=NOW,
        )
        self.assertEqual(header(req, "Authorization"), expected["Authorization"])


if __name__ == "__main__":
    unittest.main()
