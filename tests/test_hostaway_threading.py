"""The 90-second window. Cases are real message pairs from the live account."""
import hostaway_threading as ht


def test_the_measured_bursts_all_append():
    # «καλησπέρα σας» -> «Ηθελα να ρωτήσω αν η αυλή...» (0.4 min)
    assert ht.should_append_to_thread("2026-08-10 14:00:00", "2026-08-10 14:00:24") is True
    # «βρίσκεται κοντά στο κέντρο ;» -> «του νησιού» (0.1 min)
    assert ht.should_append_to_thread("2026-08-10 14:00:00", "2026-08-10 14:00:06") is True
    # «...να μας αλλάξετε...» -> «Πετσέτες εννοώ συγγνώμη» (0.2 min)
    assert ht.should_append_to_thread("2026-08-10 14:00:00", "2026-08-10 14:00:12") is True


def test_two_real_problems_do_not_merge():
    # «den exv mpataria» -> «δεν εχω νερο» (2.4 min) — must be two tasks
    assert ht.should_append_to_thread("2026-08-10 14:00:00", "2026-08-10 14:02:24") is False


def test_the_boundary_is_inclusive_at_90_seconds():
    assert ht.should_append_to_thread("2026-08-10 14:00:00", "2026-08-10 14:01:30") is True
    assert ht.should_append_to_thread("2026-08-10 14:00:00", "2026-08-10 14:01:31") is False


def test_a_task_with_no_previous_message_never_appends():
    assert ht.should_append_to_thread(None, "2026-08-10 14:00:00") is False


def test_an_unparseable_date_fails_towards_a_new_task():
    """A new task is the safe direction: noisy, but nothing is ever lost."""
    assert ht.should_append_to_thread("not a date", "2026-08-10 14:00:00") is False
    assert ht.should_append_to_thread("2026-08-10 14:00:00", "") is False


def test_a_message_older_than_the_last_one_does_not_append():
    """Out-of-order delivery must not produce a negative gap that looks tiny."""
    assert ht.should_append_to_thread("2026-08-10 14:00:00", "2026-08-10 13:59:00") is False


def test_higher_priority_picks_the_more_urgent():
    assert ht.higher_priority("P3", "P1") == "P1"
    assert ht.higher_priority("P1", "P3") == "P1"
    assert ht.higher_priority("P2", "P3") == "P2"
    assert ht.higher_priority("P2", "P2") == "P2"


def test_higher_priority_survives_junk():
    assert ht.higher_priority("P3", "banana") == "P3"
    assert ht.higher_priority(None, "P2") == "P2"


def test_is_more_urgent_only_looks_upwards():
    """The burst re-notification fires on an ESCALATION, never on a change."""
    assert ht.is_more_urgent("P1", "P3") is True
    assert ht.is_more_urgent("P2", "P3") is True
    assert ht.is_more_urgent("P3", "P3") is False
    assert ht.is_more_urgent("P3", "P1") is False
    assert ht.is_more_urgent(None, "P3") is False


def test_a_hostaway_automation_is_not_a_human_reply():
    """The account's own 'arrival' automation: communicationId set, userId null."""
    assert ht.is_human_reply({
        "isIncoming": 0, "userId": None, "communicationId": 395182,
        "communicationEvent": "arrival",
    }) is False


def test_the_auto_reply_is_not_a_human_reply():
    """
    THE trap. communicationEvent 'messageReceived' fires after EVERY guest
    message — treating it as a reply would close every task on creation.
    """
    assert ht.is_human_reply({
        "isIncoming": 0, "userId": None, "communicationId": 368747,
        "communicationEvent": "messageReceived",
    }) is False


def test_a_third_party_automation_is_not_a_human_reply():
    """
    GuestArrive: communicationId null AND userId null. This is why the
    signal is userId — communicationId alone would let this through.
    """
    assert ht.is_human_reply({
        "isIncoming": 0, "userId": None, "communicationId": None,
    }) is False


def test_a_typed_reply_is_a_human_reply():
    assert ht.is_human_reply({
        "isIncoming": 0, "userId": 990952, "communicationId": None,
    }) is True


def test_an_incoming_guest_message_is_never_a_reply():
    assert ht.is_human_reply({"isIncoming": 1, "userId": 990952}) is False


def test_a_missing_userId_key_is_not_a_reply():
    assert ht.is_human_reply({"isIncoming": 0}) is False
