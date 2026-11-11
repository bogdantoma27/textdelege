import random
import time
from collections.abc import Callable
from typing import TypeVar

ATTEMPTS = 5
BASE_DELAY = 1.0
MAX_RETRY_AFTER = 120.0
TIMEOUT = 60

T = TypeVar("T")


def parse_retry_after(value: str | None) -> float | None:
    try:
        seconds = float(value) if value is not None else None
    except ValueError:
        return None
    return seconds if seconds is not None and seconds >= 0 else None


def with_retries(
    attempt: Callable[[], T],
    retryable: Callable[[Exception], bool],
    *,
    sleep: Callable[[float], None] = time.sleep,
    attempts: int = ATTEMPTS,
) -> T:
    for number in range(1, attempts + 1):
        try:
            return attempt()
        except Exception as error:
            if number == attempts or not retryable(error):
                raise
            advised = getattr(error, "retry_after", None)
            if advised is not None:
                delay = min(advised, MAX_RETRY_AFTER)
            else:
                delay = BASE_DELAY * 2 ** (number - 1) + random.uniform(0, BASE_DELAY)
            sleep(delay)
    raise AssertionError("unreachable")
