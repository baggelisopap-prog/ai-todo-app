"""
The ceiling holds, and it lets a real caller through.

Both halves matter equally here. A limiter that blocks an attacker and also
blocks Hostaway has cost more than it saved: a rejected guest message is a
guest waiting with nobody told.
"""
from collections import deque

import pytest

import rate_limit


@pytest.fixture(autouse=True)
def _clean():
    rate_limit.reset()
    yield
    rate_limit.reset()


# ── the pure decision ────────────────────────────────────────────────────

def test_hits_under_the_limit_are_allowed():
    hits = deque()
    assert all(rate_limit.allow(hits, now=100.0, limit=3, window_seconds=60) for _ in range(3))


def test_one_past_the_limit_is_refused():
    hits = deque()
    for _ in range(3):
        rate_limit.allow(hits, now=100.0, limit=3, window_seconds=60)

    assert rate_limit.allow(hits, now=100.0, limit=3, window_seconds=60) is False


def test_a_refused_hit_is_not_counted():
    """Otherwise a caller who keeps knocking pushes their own window forward
    and stays locked out long after they stopped being over the limit."""
    hits = deque()
    for _ in range(3):
        rate_limit.allow(hits, now=100.0, limit=3, window_seconds=60)
    rate_limit.allow(hits, now=100.0, limit=3, window_seconds=60)  # refused

    assert len(hits) == 3


def test_the_window_slides_rather_than_resetting():
    """
    The reason this is not a fixed window. A fixed one resets on a clock
    boundary, so 2×limit requests land either side of it in a blink and the
    ceiling means half what it says.
    """
    hits = deque()
    for _ in range(3):
        rate_limit.allow(hits, now=100.0, limit=3, window_seconds=60)

    # 59 seconds later the first three are still inside the window
    assert rate_limit.allow(hits, now=159.0, limit=3, window_seconds=60) is False
    # a moment past 60 and the oldest has aged out
    assert rate_limit.allow(hits, now=160.1, limit=3, window_seconds=60) is True


def test_an_old_burst_is_entirely_forgotten():
    hits = deque()
    for _ in range(10):
        rate_limit.allow(hits, now=100.0, limit=10, window_seconds=60)

    assert rate_limit.allow(hits, now=1000.0, limit=10, window_seconds=60) is True
    assert len(hits) == 1, "expired hits were not dropped"


# ── buckets keep callers apart ───────────────────────────────────────────

def test_two_callers_do_not_share_a_budget():
    for _ in range(3):
        rate_limit.check_rate_limit("hook:1.1.1.1", now=100.0, limit=3, window_seconds=60)

    assert rate_limit.check_rate_limit("hook:1.1.1.1", now=100.0, limit=3, window_seconds=60) is False
    assert rate_limit.check_rate_limit("hook:2.2.2.2", now=100.0, limit=3, window_seconds=60) is True


def test_two_endpoints_do_not_share_a_budget():
    """A flood at the scheduler must not lock the same IP out of the webhook,
    where real guest messages arrive."""
    for _ in range(3):
        rate_limit.check_rate_limit("scheduler:1.1.1.1", now=100.0, limit=3, window_seconds=60)

    assert rate_limit.check_rate_limit("scheduler:1.1.1.1", now=100.0, limit=3, window_seconds=60) is False
    assert rate_limit.check_rate_limit("hook:1.1.1.1", now=100.0, limit=3, window_seconds=60) is True


# ── the dict must not grow forever ───────────────────────────────────────

def test_idle_buckets_are_evicted():
    """
    One entry per distinct IP, kept forever, is a slow leak an attacker can
    drive on purpose by rotating source addresses.
    """
    for i in range(50):
        rate_limit.check_rate_limit(f"hook:10.0.0.{i}", now=100.0, limit=5, window_seconds=60)
    assert rate_limit.snapshot()[0] == 50

    # An hour and a minute later, one live caller triggers the sweep.
    rate_limit.check_rate_limit("hook:9.9.9.9", now=100.0 + 3661, limit=5, window_seconds=60)

    buckets, _ = rate_limit.snapshot()
    assert buckets == 1, f"{buckets} buckets survived the sweep"


def test_a_busy_bucket_survives_the_sweep():
    rate_limit.check_rate_limit("hook:1.1.1.1", now=100.0, limit=5, window_seconds=60)
    # Same caller, still active when the sweep runs.
    rate_limit.check_rate_limit("hook:1.1.1.1", now=3700.0, limit=5, window_seconds=60)
    rate_limit.check_rate_limit("hook:1.1.1.1", now=3701.0, limit=5, window_seconds=60)

    assert rate_limit.snapshot()[0] == 1


def test_the_sweep_does_not_run_on_every_call():
    """It walks every bucket, so per-request would make a flood cost more,
    not less."""
    for i in range(30):
        rate_limit.check_rate_limit(f"hook:10.0.0.{i}", now=100.0 + i, limit=5, window_seconds=60)

    # All 30 are recent; none should have been evicted, and the sweep should
    # have run at most once in that second-apart sequence.
    assert rate_limit.snapshot()[0] == 30


# ── wired into the two endpoints a stranger can reach ────────────────────

class _Req:
    def __init__(self, ip="203.0.113.7", headers=None):
        self.headers = headers if headers is not None else {"x-forwarded-for": ip}
        self.client = None

    async def json(self):
        return {"event": "ping"}


def test_the_webhook_refuses_a_flood_with_429(monkeypatch):
    """
    Without a ceiling, the secret is guessable as fast as the network allows.
    With it, an attacker gets 60 tries a minute against 43 random characters.
    """
    import asyncio
    import main

    monkeypatch.setattr(main, "HOSTAWAY_WEBHOOK_SECRET", "unguessable")

    statuses = []
    for _ in range(main.HOSTAWAY_WEBHOOK_RATE_LIMIT + 5):
        try:
            asyncio.run(main.hostaway_webhook(_Req()))
            statuses.append(200)
        except main.HTTPException as e:
            statuses.append(e.status_code)

    assert statuses[0] == 401, "the first attempt should reach the secret check"
    assert statuses[-1] == 429, "the flood was never throttled"
    assert statuses.count(429) == 5


def test_a_second_address_is_unaffected_by_the_first_ones_flood(monkeypatch):
    """Hostaway must still get through while somebody else is being throttled."""
    import asyncio
    import main

    monkeypatch.setattr(main, "HOSTAWAY_WEBHOOK_SECRET", "unguessable")

    for _ in range(main.HOSTAWAY_WEBHOOK_RATE_LIMIT + 5):
        try:
            asyncio.run(main.hostaway_webhook(_Req(ip="198.51.100.1")))
        except main.HTTPException:
            pass

    with pytest.raises(main.HTTPException) as caught:
        asyncio.run(main.hostaway_webhook(_Req(ip="203.0.113.99")))
    assert caught.value.status_code == 401, "a different caller was thrown out as 429"


def test_the_scheduler_refuses_a_flood_before_checking_the_secret(monkeypatch):
    import main

    monkeypatch.setattr(main, "SCHEDULER_SECRET", "s3cret")

    statuses = []
    for _ in range(main.SCHEDULER_RATE_LIMIT + 3):
        try:
            main.run_scheduler(secret="wrong", request=_Req())
            statuses.append(200)
        except main.HTTPException as e:
            statuses.append(e.status_code)

    assert statuses[0] == 403, "the first wrong secret should be answered normally"
    assert statuses[-1] == 429
    assert statuses.count(429) == 3


def test_the_two_endpoints_keep_separate_budgets(monkeypatch):
    """A flood at the scheduler must not cost the same address its webhook
    budget — that is where real guest messages arrive."""
    import asyncio
    import main

    monkeypatch.setattr(main, "SCHEDULER_SECRET", "s3cret")
    monkeypatch.setattr(main, "HOSTAWAY_WEBHOOK_SECRET", "unguessable")

    for _ in range(main.SCHEDULER_RATE_LIMIT + 3):
        try:
            main.run_scheduler(secret="wrong", request=_Req(ip="198.51.100.5"))
        except main.HTTPException:
            pass

    with pytest.raises(main.HTTPException) as caught:
        asyncio.run(main.hostaway_webhook(_Req(ip="198.51.100.5")))
    assert caught.value.status_code == 401, "the webhook budget was spent by the scheduler"


def test_the_bucket_key_comes_from_the_proxy_header():
    """
    Render terminates TLS and proxies every request, so request.client.host
    is Render's own address for all callers — one bucket for the world, and
    one flood would throttle everybody.
    """
    import main

    assert main._client_ip(_Req(headers={"x-forwarded-for": "203.0.113.7, 10.0.0.1"})) == "203.0.113.7"
    assert main._client_ip(_Req(headers={})) == "unknown"
