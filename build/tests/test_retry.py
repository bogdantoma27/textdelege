import unittest

from build.textdelege.retry import parse_retry_after, with_retries


class Flaky:
    def __init__(self, failures):
        self.failures, self.calls = list(failures), 0

    def __call__(self):
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return "done"


class RetryTests(unittest.TestCase):
    def test_returns_without_sleeping_on_success(self):
        sleeps = []
        self.assertEqual(with_retries(Flaky([]), lambda e: True, sleep=sleeps.append), "done")
        self.assertEqual(sleeps, [])

    def test_backoff_doubles_from_one_second_with_jitter(self):
        sleeps = []
        flaky = Flaky([OSError() for _ in range(4)])
        self.assertEqual(with_retries(flaky, lambda e: True, sleep=sleeps.append), "done")
        self.assertEqual(flaky.calls, 5)
        for delay, base in zip(sleeps, (1, 2, 4, 8)):
            self.assertTrue(base <= delay < base + 1, (delay, base))

    def test_raises_the_last_error_after_the_attempts(self):
        flaky = Flaky([OSError(str(i)) for i in range(9)])
        with self.assertRaises(OSError) as ctx:
            with_retries(flaky, lambda e: True, sleep=lambda s: None)
        self.assertEqual((flaky.calls, str(ctx.exception)), (5, "4"))

    def test_does_not_retry_errors_the_predicate_rejects(self):
        flaky = Flaky([ValueError("no"), OSError()])
        with self.assertRaises(ValueError):
            with_retries(flaky, lambda e: isinstance(e, OSError), sleep=lambda s: None)
        self.assertEqual(flaky.calls, 1)

    def test_retry_after_overrides_backoff_and_is_capped(self):
        sleeps = []
        error = OSError()
        error.retry_after = 4.0
        with_retries(Flaky([error]), lambda e: True, sleep=sleeps.append)
        error.retry_after = 9999.0
        with_retries(Flaky([error]), lambda e: True, sleep=sleeps.append)
        self.assertEqual(sleeps, [4.0, 120.0])

    def test_parse_retry_after(self):
        self.assertEqual(parse_retry_after("5"), 5.0)
        self.assertIsNone(parse_retry_after(None))
        self.assertIsNone(parse_retry_after("Wed, 21 Oct 2026 07:28:00 GMT"))
        self.assertIsNone(parse_retry_after("-3"))


if __name__ == "__main__":
    unittest.main()
