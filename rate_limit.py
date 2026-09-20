"""
A ceiling on how often one caller may hit an endpoint.

The app had none, anywhere. That mattered most on the two endpoints a
stranger can reach: `/webhooks/hostaway`, whose shared secret is guessable
one attempt at a time, and `/notifications/run-scheduler`, same. Without a
ceiling, "guessable one attempt at a time" means thousands of attempts a
second, which is a different thing entirely.

DELIBERATELY IN MEMORY, and deliberately not a dependency. requirements.txt
is UTF-16LE with a BOM and documented as not-to-be-edited (see
docs/ARCHITECTURE.md), so adding slowapi would mean touching the one file
this project has a standing rule about. The counter that fits in one module
with no I/O is worth more here than the one with features nobody needs.

WHAT THIS IS NOT: it does not survive a restart, and it counts per process.
Render runs this app as a single uvicorn worker, so today one process is all
of them; with N workers the effective ceiling becomes N times the limit —
looser than configured, never tighter, and never wrong in the direction that
locks a real caller out. A restart forgives every counter, which an attacker
cannot cause and a deploy does anyway.

The decisions here are pure: `allow()` takes the clock as an argument and
owns no state, so the tests read like arithmetic. `_WINDOWS` below is the
only mutable thing in the module, and `check_rate_limit` is the only door
to it.
"""
import logging
import threading
from collections import deque
from typing import Deque, Dict, Tuple

logger = logging.getLogger(__name__)

# Bucket → the timestamps of that bucket's recent hits, oldest first.
_WINDOWS: Dict[str, Deque[float]] = {}

# Every read-modify-write below happens under this. FastAPI runs `def`
# endpoints in a threadpool (see ARCHITECTURE.md — 23 of them are plain
# `def`), so two deliveries really can land on one bucket at once, and
# "check the length, then append" is not atomic without it.
_LOCK = threading.Lock()

# Buckets idle for longer than this are dropped on the next sweep. Without
# it the dict grows one entry per distinct IP, forever, which is a slow leak
# an attacker can drive on purpose.
_IDLE_EVICT_SECONDS = 3600.0

# A sweep walks every bucket, so it must not run per request. Once a minute
# is far more often than the dict can grow into a problem.
_SWEEP_EVERY_SECONDS = 60.0
_last_sweep = 0.0


def allow(hits: Deque[float], now: float, limit: int, window_seconds: float) -> bool:
    """
    Whether one more hit fits, given the ones already in this window.

    A SLIDING window, not a fixed one: a fixed window resets on a clock
    boundary, so 2×limit requests land in a blink either side of it and the
    ceiling means half what it says. This drops everything older than
    `window_seconds` before counting, so the limit holds over any span.

    Mutates `hits` — drops what has expired, and appends `now` when the
    answer is True. That keeps the caller from having to remember which of
    the two bookkeeping steps it owes.
    """
    cutoff = now - window_seconds
    while hits and hits[0] <= cutoff:
        hits.popleft()

    if len(hits) >= limit:
        return False

    hits.append(now)
    return True


def _sweep(now: float) -> int:
    """Drops buckets nobody has touched in an hour. Returns how many went."""
    stale = [
        key for key, hits in _WINDOWS.items()
        if not hits or hits[-1] <= now - _IDLE_EVICT_SECONDS
    ]
    for key in stale:
        del _WINDOWS[key]
    return len(stale)


def check_rate_limit(bucket: str, now: float, limit: int, window_seconds: float) -> bool:
    """
    True when this hit is within the limit, False when the caller is over it.

    `bucket` names what is being limited and for whom — by convention
    "<endpoint>:<client>", so two endpoints never share one caller's budget.
    `now` is passed in rather than read here, so a test can advance time
    without sleeping.
    """
    global _last_sweep

    with _LOCK:
        if now - _last_sweep >= _SWEEP_EVERY_SECONDS:
            evicted = _sweep(now)
            _last_sweep = now
            if evicted:
                logger.debug(f"[rate limit] evicted {evicted} idle bucket(s)")

        hits = _WINDOWS.setdefault(bucket, deque())
        return allow(hits, now, limit, window_seconds)


def reset() -> None:
    """Clears every counter. For tests, and for nothing else."""
    global _last_sweep
    with _LOCK:
        _WINDOWS.clear()
        _last_sweep = 0.0


def snapshot() -> Tuple[int, int]:
    """(buckets tracked, hits remembered) — for logging and for tests."""
    with _LOCK:
        return len(_WINDOWS), sum(len(hits) for hits in _WINDOWS.values())
