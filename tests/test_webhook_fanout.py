"""
One guest message, one classification, one task per connected colleague.

Fifteen staff share account 147809 (design §1.2, §9). Whoever answers, every
copy closes on its own, because each colleague's poller sees the same reply.
"""
import asyncio

import main


class _FakeRequest:
    def __init__(self, payload):
        self._payload = payload

    async def json(self):
        return self._payload


def _post(payload):
    return asyncio.run(main.hostaway_webhook(_FakeRequest(payload)))


def _incoming(body="δεν βρίσκω τα κλειδιά", conversation_id=49446111):
    return {
        "event": "message.received",
        "accountId": 147809,
        "data": {
            "isIncoming": 1, "body": body, "conversationId": conversation_id,
            "date": "2026-08-13 16:00:00", "listingMapId": 410175, "reservationId": 64375741,
        },
    }


def _connection(user_id, **overrides):
    row = {
        "user_id": user_id, "account_id": "147809",
        "client_secret_encrypted": "cipher", "webhook_id": 34986,
        "tasks_enabled": True, "auto_close_enabled": True,
    }
    row.update(overrides)
    return row


def _wire(monkeypatch, connections):
    calls = {"created": [], "classified": [], "listings": 0, "reservations": 0, "pushes": []}

    monkeypatch.setattr(main.repository, "get_hostaway_connections_for_account",
                        lambda account_id: list(connections))
    monkeypatch.setattr(main.repository, "get_open_tasks_for_conversation", lambda u, c: [])
    monkeypatch.setattr(main.hostaway_integration, "credentials_from_connection",
                        lambda c: main.hostaway_integration.HostawayCredentials(c["account_id"], "s"))

    def _classify(text, user_id):
        calls["classified"].append(text)
        return {"summary": "τα κλειδιά", "priority": "P1"}

    monkeypatch.setattr(main.hostaway_integration, "classify_message", _classify)

    def _listing(listing_map_id, credentials):
        calls["listings"] += 1
        return "Pine Lodge"

    def _reservation(reservation_id, credentials):
        calls["reservations"] += 1
        return {"guest_name": "Κώστας", "arrival_date": "2026-08-14", "departure_date": "2026-08-18"}

    monkeypatch.setattr(main.hostaway_integration, "get_listing_name", _listing)
    monkeypatch.setattr(main.hostaway_integration, "get_reservation_details", _reservation)
    monkeypatch.setattr(main.service, "create_task_manual",
                        lambda user_id, fields: calls["created"].append((user_id, fields)))
    monkeypatch.setattr(main.service, "send_push_to_user",
                        lambda u, **kw: calls["pushes"].append((u, kw)))
    return calls


def test_three_colleagues_get_three_tasks(monkeypatch):
    calls = _wire(monkeypatch, [_connection("user-1"), _connection("user-2"), _connection("user-3")])

    result = _post(_incoming())

    assert result["status"] == "ok"
    assert [user_id for user_id, _ in calls["created"]] == ["user-1", "user-2", "user-3"]


def test_the_message_is_classified_once_for_all_of_them(monkeypatch):
    """N colleagues must not mean N Gemini calls for one guest message."""
    calls = _wire(monkeypatch, [_connection("user-1"), _connection("user-2"), _connection("user-3")])

    _post(_incoming())

    assert len(calls["classified"]) == 1


def test_enrichment_is_fetched_once_for_all_of_them(monkeypatch):
    """Two Hostaway round-trips per message, not two per colleague."""
    calls = _wire(monkeypatch, [_connection("user-1"), _connection("user-2")])

    _post(_incoming())

    assert calls["listings"] == 1
    assert calls["reservations"] == 1


def test_a_colleague_with_task_creation_off_is_skipped(monkeypatch):
    calls = _wire(monkeypatch, [
        _connection("user-1"),
        _connection("user-2", tasks_enabled=False),
    ])

    _post(_incoming())

    assert [user_id for user_id, _ in calls["created"]] == ["user-1"]


def test_an_unknown_account_is_ignored_with_200(monkeypatch):
    """A Hostaway account nobody has connected. Never a 500, never a task."""
    calls = _wire(monkeypatch, [])

    result = _post(_incoming())

    assert result["status"] == "ignored"
    assert calls["created"] == []
    assert calls["classified"] == []


def test_nobody_connected_costs_no_gemini_call(monkeypatch):
    """Classification must happen AFTER the connection lookup, not before."""
    calls = _wire(monkeypatch, [])
    _post(_incoming())
    assert calls["classified"] == []


def test_every_colleague_with_the_switch_off_means_no_classification(monkeypatch):
    calls = _wire(monkeypatch, [_connection("user-1", tasks_enabled=False)])
    _post(_incoming())
    assert calls["classified"] == []
    assert calls["created"] == []
