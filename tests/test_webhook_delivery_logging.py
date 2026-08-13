"""
Every delivery leaves a line, whatever its event name.

Gap A (CURRENT_TASK.md) is decided by searching Render's log after replying
to a guest: a line means Hostaway fires this webhook for outgoing messages,
no line means it doesn't. That inference only holds if EVERY delivery logs.
While the unmatched-event branch returned silently, an outgoing message
arriving as, say, `message.sent` looked exactly like no delivery at all —
and the wrong half of the fix (poll the API on a timer) would have been
built on it.
"""
import asyncio
import logging

import main


class _FakeRequest:
    def __init__(self, payload):
        self._payload = payload

    async def json(self):
        return self._payload


def _post(payload):
    return asyncio.run(main.hostaway_webhook(_FakeRequest(payload)))


def test_an_unmatched_event_still_logs_its_name(caplog):
    """The one that burned us: silence read as 'Hostaway never called'."""
    with caplog.at_level(logging.INFO):
        result = _post({
            "event": "message.sent",
            "accountId": 90987,
            "data": {"isIncoming": 0, "userId": 990952, "conversationId": 47342748},
        })

    assert result["status"] == "ignored"
    line = "\n".join(caplog.messages)
    assert "[hostaway webhook] Delivery:" in line
    assert "message.sent" in line, "the event name is the whole point of the line"


def test_a_delivery_with_no_data_still_logs(caplog):
    """A malformed body must not swap a mute return for a crash."""
    with caplog.at_level(logging.INFO):
        result = _post({"event": "reservation.created", "data": None})

    assert result["status"] == "ignored"
    assert "[hostaway webhook] Delivery:" in "\n".join(caplog.messages)
