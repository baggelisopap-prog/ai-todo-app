"""
The 2026-09-25 agent audit — one test per failure, each measured on the code as
it stood that day by a real-model baseline run BEFORE anything was changed.

The owner's instruction: «κάνε όσα τεστ θέλεις… γτ πολλά απο τα αποτελέσματα
είναι απο παλιότερες εκδόσεις» — so every fix below answers a failure
reproduced on the current code, not one read out of an old log.

Offline: nothing here calls the model.
"""
import json

import agent_tools
from tests.test_agent_workspaces import CATS, EVI, ME, MEMBERS, PROFILES, TODAY, WS, _task

YESTERDAY = "2026-09-22"


def _ctx(tasks, aliases=False):
    people = agent_tools.build_people_directory(ME, MEMBERS, PROFILES)
    return agent_tools.build_agent_context(ME, WS, CATS, people, {}, tasks=tasks if aliases else None)


def _tools(tasks, question=None, aliases=False, **write_kwargs):
    ctx = _ctx(tasks, aliases)
    search, details = agent_tools.build_tool_functions(tasks, ctx, question=question)
    proposals = []
    complete, update, create = agent_tools.build_write_proposal_tools(
        proposals, tasks, question=question, ctx=ctx, **write_kwargs)
    return search, details, complete, update, create, proposals, ctx


def _ids(rows):
    return [row["record_id"] for row in rows]


# ------------------------------------------------ 1. times nobody asked for


def test_a_time_is_recognised_only_when_the_user_gave_one():
    said = ["βάλ' το αύριο στις 5", "στις 10:30", "για την Παρασκευή στις δέκα", "το πρωί",
            "αύριο το απόγευμα", "στη μία", "tomorrow at 9", "at noon", "9.30", "5 μμ"]
    not_said = ["βάλ' το για αύριο", "μετέφερε το για την Παρασκευή", "στις 26 Σεπτεμβρίου",
                "στις 5 Οκτωβρίου", "βάλε τα ληξιπρόθεσμα για αύριο", "το δεύτερο βάλ' το για αύριο", ""]

    assert all(agent_tools.mentions_time(q) for q in said), [q for q in said if not agent_tools.mentions_time(q)]
    assert not any(agent_tools.mentions_time(q) for q in not_said), [q for q in not_said if agent_tools.mentions_time(q)]


def test_moving_a_task_to_another_day_keeps_its_time():
    """Baseline: «μετέφερε το AI brainstorming για την Παρασκευή» -> 00:00, and
    «βάλε τα ληξιπρόθεσμα για αύριο» -> 19:48 on six tasks, the clock at asking."""
    task = _task("t-a", due_date="2026-09-20")
    task.due_time = "10:00"
    *_, update, _create, proposals, _ = _tools([task], question="βάλ' το για αύριο")

    result = update("t-a", due_date="2026-09-24", due_time="19:48")

    assert proposals[-1]["fields"] == {"due_date": "2026-09-24"}
    assert "due_time" in result["unchanged_note"]


def test_a_time_the_user_gave_is_kept():
    task = _task("t-a", due_date="2026-09-20")
    *_, update, _create, proposals, _ = _tools([task], question="βάλ' το αύριο στις 10")

    update("t-a", due_date="2026-09-24", due_time="10:00")

    assert proposals[-1]["fields"] == {"due_date": "2026-09-24", "due_time": "10:00"}


def test_a_new_task_gets_no_time_nobody_gave():
    *_, create, proposals, _ = _tools([], question="πρόσθεσε να πάρω τον λογιστή αύριο")

    create("Κλήση στον λογιστή", due_date="2026-09-24", due_time="00:00")

    assert proposals[-1]["fields"]["due_time"] is None


# ------------------------------------------- 2. descriptions copied back


def test_the_copy_check_knows_a_truncated_or_decorated_copy_from_a_change():
    current = "Έχετε ένα εκκρεμές υπόλοιπο ύψους €11.96. Επισκεφθείτε τη σελίδα Finance για πληρωμή."
    assert agent_tools.is_copy_of_current(current[:70] + " | -", current)
    assert agent_tools.is_copy_of_current(current[:100] + "...", current)
    assert agent_tools.is_copy_of_current("  " + current + "  ", current)
    assert not agent_tools.is_copy_of_current("Πληρώθηκε με κάρτα.", current)
    assert not agent_tools.is_copy_of_current(current + " Πληρωμή έως Δευτέρα.", current)


def test_a_description_copied_from_the_day_view_is_never_written_back():
    """Baseline: six proposals like «…Επισκεφθείτε τη σελίδα Finan | -». A
    confirmed card would have cut all six descriptions permanently."""
    task = _task("t-a", due_date="2026-09-20")
    task.description = "Έχετε ένα εκκρεμές υπόλοιπο ύψους €11.96. Επισκεφθείτε τη σελίδα Finance."
    *_, update, _create, proposals, _ = _tools([task], question="βάλε τα ληξιπρόθεσμα για αύριο")

    update("t-a", due_date="2026-09-24", description=task.description[:70] + " | -")

    assert proposals[-1]["fields"] == {"due_date": "2026-09-24"}


def test_a_description_the_user_asked_for_is_written():
    task = _task("t-a")
    task.description = "Παλιά σημείωση."
    *_, update, _create, proposals, _ = _tools([task], question="γράψε στην περιγραφή ότι πληρώθηκε")

    update("t-a", description="Πληρώθηκε.")

    assert proposals[-1]["fields"] == {"description": "Πληρώθηκε."}


# ------------------------------------------------ 3. aliases, and real ids out


def test_the_model_sees_short_ids_and_the_card_gets_the_real_one():
    tasks = [_task("0f3c9d2e-aaaa-4a5b-9c7d-000000000001", task_name="Σήμερα", due_date=TODAY),
             _task("0f3c9d2e-aaaa-4a5b-9c7d-000000000002", task_name="Αργότερα", due_date="2026-09-30")]
    search, details, complete, _u, _c, proposals, ctx = _tools(tasks, aliases=True)

    view = agent_tools.build_day_view(tasks, TODAY, "12:00", ctx)
    rows = search()["tasks"]
    shown = json.dumps([view, rows, details("t2")], ensure_ascii=False)

    assert "0f3c9d2e" not in shown
    assert _ids(rows) == ["t1", "t2"]
    complete("t2")
    assert proposals[-1]["record_id"] == "0f3c9d2e-aaaa-4a5b-9c7d-000000000002"


def test_a_real_id_from_an_older_refs_line_still_resolves():
    tasks = [_task("0f3c9d2e-aaaa-4a5b-9c7d-000000000001")]
    *_, complete, _u, _c, proposals, _ = _tools(tasks, aliases=True)

    complete("0f3c9d2e-aaaa-4a5b-9c7d-000000000001")

    assert proposals[-1]["record_id"] == "0f3c9d2e-aaaa-4a5b-9c7d-000000000001"


def test_rows_leave_out_what_is_empty():
    row = agent_tools.render_task_rows([_task("t-a")], _ctx([_task("t-a")]))[0]

    assert "due_time" not in row and "is_completed" not in row and "description" not in row


# --------------------------------------------------------- 4. duplicates


def test_creating_a_task_that_already_exists_is_questioned_once():
    """Baseline: «βάλε τον έλεγχο θερμοσίφωνα για αύριο» created «έλεγχο
    θερμοσίφωνα» beside the existing «Έλεγχος θερμοσίφωνα»."""
    existing = _task("t-heater", task_name="Έλεγχος θερμοσίφωνα", due_date="2026-09-28")
    *_, create, proposals, _ = _tools([existing], question="βάλε τον έλεγχο θερμοσίφωνα για αύριο")

    first = create("έλεγχο θερμοσίφωνα", due_date="2026-09-24")
    assert "already exists" in first["error"] and not proposals

    create("έλεγχο θερμοσίφωνα", due_date="2026-09-24")        # the user really wants a second one
    assert len(proposals) == 1


def test_an_unrelated_new_task_is_not_questioned():
    existing = _task("t-pay", task_name="Πληρωμή ΔΕΗ")
    *_, create, proposals, _ = _tools([existing], question="πρόσθεσε πληρωμή ενοικίου")

    create("Πληρωμή ενοικίου")

    assert len(proposals) == 1


# ------------------------------------------------------------- 5. the Inbox


def _inbox_tasks():
    waiting_later = _task("t-wait-later", task_name="Έλεγχος εγγύησης", due_date="2026-09-30")
    waiting_later.approval_status = False
    waiting_undated = _task("t-wait-undated", task_name="Ανανέωση συμβολαίου internet")
    waiting_undated.approval_status = False
    waiting_late = _task("t-wait-late", task_name="Τεστ τασκ", due_date="2026-09-01")
    waiting_late.approval_status = False
    return [waiting_later, waiting_undated, waiting_late, _task("t-open", due_date=TODAY)]


def test_the_inbox_can_be_listed():
    """Baseline: «τι περιμένει έγκριση;» -> «none», with two tasks waiting."""
    search, *_ = _tools(_inbox_tasks())

    rows = search(inbox=True)["tasks"]

    assert sorted(_ids(rows)) == ["t-wait-late", "t-wait-later", "t-wait-undated"]
    assert all(row["awaiting_approval"] for row in rows)


def test_a_named_task_still_in_the_inbox_is_found_and_said_so():
    search, *_ = _tools(_inbox_tasks())

    result = search(keyword="εγγύησης")

    assert _ids(result["tasks"]) == ["t-wait-later"]
    assert "awaiting approval" in result["inbox_note"]


def test_the_day_view_gives_the_inbox_total():
    """Baseline: the model reported «24 in total» — the due-or-late count —
    while the Inbox held 38."""
    tasks = _inbox_tasks()
    view = agent_tools.build_day_view(tasks, TODAY, "12:00", _ctx(tasks))

    assert "PENDING APPROVAL (1 due today or late; 3 in the Inbox in total)" in view


# ------------------------------------------------ 6. «τι έκανα χθες»


def test_closed_yesterday_means_closed_yesterday_whatever_the_due_date():
    """Baseline: «τι έκανα χθες» filtered by DUE date and answered «nothing»
    about a task due five days earlier and closed yesterday."""
    late_one = _task("t-late", due_date="2026-09-17", is_completed=True)
    late_one.completed_by, late_one.completed_at = ME, "2026-09-22T09:15:00+00:00"
    old_one = _task("t-old", due_date="2026-09-22", is_completed=True)
    old_one.completed_by, old_one.completed_at = ME, "2026-09-10T09:15:00+00:00"
    search, *_ = _tools([late_one, old_one])

    rows = search(closed_by="me", date_from=YESTERDAY, date_to=YESTERDAY)["tasks"]

    assert _ids(rows) == ["t-late"]


def test_the_day_a_task_was_closed_is_the_athens_day():
    """Stored in UTC: 22:30 UTC on the 22nd is 01:30 on the 23rd in Athens."""
    assert agent_tools.local_day("2026-09-22T22:30:00+00:00") == "2026-09-23"
    assert agent_tools.local_day("2026-09-22T12:00:00+03:00") == "2026-09-22"
    assert agent_tools.local_day(None) is None


# -------------------------------------------- 7. a recurrence, shown once


def test_a_daily_recurrence_is_one_row_with_its_dates():
    """Baseline: «τι έχω αυτή την εβδομάδα» — «Χάπι end» on seven rows."""
    tasks = []
    for day in range(23, 30):
        occurrence = _task(f"t-pill-{day}", task_name="Χάπι", due_date=f"2026-09-{day}")
        occurrence.recurrence_rule_id = "rule-pill"
        tasks.append(occurrence)
    tasks.append(_task("t-dentist", task_name="Οδοντίατρος", due_date="2026-09-25"))
    search, *_ = _tools(tasks)

    result = search(date_from="2026-09-23", date_to="2026-09-29")

    assert _ids(result["tasks"]) == ["t-pill-23", "t-dentist"]
    assert result["tasks"][0]["repeats"] == "every day from 2026-09-23 to 2026-09-29 (7 times)"
    # Final run: shown a bare list of dates, the model named the recurrence once,
    # on its first day, and never said it repeats.
    assert "never only on its first day" in result["repeats_hint"]


# --------------------------------------------- 8. others, in the same call


def test_other_peoples_rows_come_back_when_the_user_has_none():
    """Baseline: «τι έχει καθυστερήσει στο Γραφείο» took three rounds — the
    first search saw the colleague's task and only hinted at it."""
    theirs = _task("t-theirs", created_by=EVI, workspace_id="ws-personal", due_date="2026-09-20")
    search, *_ = _tools([theirs])

    result = search(workspace="Personal", date_to=YESTERDAY)

    assert result["tasks"] == []
    assert _ids(result["others"]) == ["t-theirs"]


def test_other_peoples_rows_never_sit_beside_the_users_own():
    mine = _task("t-mine", workspace_id="ws-personal", due_date="2026-09-20")
    theirs = _task("t-theirs", created_by=EVI, workspace_id="ws-personal", due_date="2026-09-20")
    search, *_ = _tools([mine, theirs])

    result = search(workspace="Personal", date_to=YESTERDAY)

    assert _ids(result["tasks"]) == ["t-mine"]
    assert "others" not in result and result["others_excluded"] == 1


def test_nearby_dates_stay_inside_the_asked_workspace():
    """Baseline: «no tasks in that range» followed by a list containing
    today — dates from other workspaces."""
    elsewhere = _task("t-elsewhere", workspace_id="ws-business", due_date=TODAY)
    here = _task("t-here", workspace_id="ws-personal", due_date="2026-09-30")
    search, *_ = _tools([elsewhere, here])

    result = search(workspace="Personal", date_from=TODAY, date_to=TODAY)

    assert result["no_matches_hint"].endswith("2026-09-30")


# --------------------------------------------- 9. follow-ups and ordinals


def test_ordinals_are_read_and_weekdays_are_not():
    assert agent_tools.ordinal_in("το δεύτερο βάλ' το για αύριο") == 2
    assert agent_tools.ordinal_in("Το 3το βάλτο για αύριο") == 3
    assert agent_tools.ordinal_in("Το 1 ρε") == 1
    assert agent_tools.ordinal_in("κλείσε το τελευταίο") == -1
    assert agent_tools.ordinal_in("βάλ' το την Τρίτη") is None
    assert agent_tools.ordinal_in("μετέφερε το για την Πέμπτη") is None
    assert agent_tools.ordinal_in("βάλ' το στις 5") is None


def test_the_answer_decides_the_order_of_the_refs():
    """Baseline: after «τι έχω σήμερα;» — answered from the day view, so no
    refs at all — «το πρώτο» reached a task that was not the first listed."""
    answer = "Σήμερα έχεις: **Πότισμα φυτών** (08:00), **Τιμολόγιο Airbnb** (12:00) και **Ανανέωση ασφάλειας**."
    candidates = [("r-ins", "Ανανέωση ασφάλειας"), ("r-inv", "Τιμολόγιο Airbnb"), ("r-water", "Πότισμα φυτών"),
                  ("r-other", "Απάντηση σε κριτική")]

    refs = agent_tools.refs_from_answer(answer, candidates)

    assert [r["record_id"] for r in refs] == ["r-water", "r-inv", "r-ins"]


def test_the_refs_block_is_numbered_in_the_answers_order():
    runs = [{"refs": [{"task_name": "Καθαρισμός Β2", "record_id": "r1"},
                      {"task_name": "Αγορά σεντονιών", "record_id": "r2"}]}]

    block = agent_tools.build_conversation_refs_block(runs)

    assert "1. Καθαρισμός Β2 = r1" in block and "2. Αγορά σεντονιών = r2" in block


def test_a_refused_target_is_answered_with_what_the_ordinal_points_to():
    """Baseline: after «τι έχει η Εύη;», «κλείσε το πρώτο» went for a day-view
    row; refused, the model then asked instead of counting."""
    first = _task("r1", task_name="Καθαρισμός Β2", created_by=EVI, workspace_id="ws-personal")
    second = _task("r2", task_name="Αγορά σεντονιών", created_by=EVI, workspace_id="ws-personal")
    salient = _task("r-day", task_name="Απάντηση σε κριτική", due_date="2026-09-20")
    *_, complete, _u, _c, proposals, _ = _tools(
        [first, second, salient], question="κλείσε το πρώτο",
        conversation_refs={"r1", "r2"}, recent_refs=["r1", "r2"])

    result = complete("r-day")

    assert not proposals
    assert "most likely means 'Καθαρισμός Β2'" in result["error"]


def test_a_whole_day_view_scope_is_reachable_mid_conversation():
    """«βάλε τα ληξιπρόθεσμα για αύριο» after a conversation that named other
    tasks: the overdue ones are justified by the scope, not one by one."""
    overdue = _task("r-late", task_name="Πληρωμή ΔΕΗ", due_date="2026-09-01")
    *_, update, _c, proposals, _ = _tools(
        [overdue], question="βάλε τα ληξιπρόθεσμα για αύριο",
        conversation_refs={"r-something-else"}, recent_refs=["r-something-else"],
        day_scopes={"overdue": {"r-late"}, "today": set()})

    update("r-late", due_date="2026-09-24")

    assert proposals[-1]["record_id"] == "r-late"


# ------------------------------------- 10. filters nobody asked for (2026-09-25)


def test_a_filter_is_kept_only_when_the_users_words_carry_it():
    """After the instruction was shortened the real model added «today» and
    P1 to «πόσα ανοιχτά έχω στο Business;», and workspace="no workspace" as if
    it were a default."""
    assert agent_tools.ungrounded_filters("πόσα ανοιχτά έχω στο Business;", priority="P1",
                                          date_from="2026-09-25", workspace="no workspace") == [
        "priority", "dates", "workspace"]
    assert agent_tools.ungrounded_filters("επείγοντα για αύριο", priority="P1", date_from="2026-09-26") == []
    assert agent_tools.ungrounded_filters("τι έχω χωρίς workspace;", workspace="no workspace") == []
    assert agent_tools.ungrounded_filters(None, priority="P1") == []


def test_an_invented_filter_is_set_aside_and_said_so():
    tasks = [_task("t-a", due_date="2026-09-30"), _task("t-b")]
    search, *_ = _tools(tasks, question="τι ανοιχτά έχω;")

    result = search(priority="P1", date_from=TODAY, date_to=TODAY)

    assert sorted(_ids(result["tasks"])) == ["t-a", "t-b"]
    assert "dates" in result["ignored_note"] and "priority" in result["ignored_note"]


def test_an_earlier_question_in_the_conversation_can_carry_a_date():
    """«και στο Business;» after «τι έχω αύριο;» still means tomorrow."""
    tasks = [_task("t-tomorrow", workspace_id="ws-business", due_date="2026-09-24"),
             _task("t-later", workspace_id="ws-business", due_date="2026-09-30")]
    ctx = _ctx(tasks)
    search, _ = agent_tools.build_tool_functions(tasks, ctx, question="και στο Business;",
                                                 earlier_turns=["τι έχω αύριο;"])

    result = search(workspace="Business", date_from="2026-09-24", date_to="2026-09-24")

    assert _ids(result["tasks"]) == ["t-tomorrow"]
    assert "ignored_note" not in result


def test_a_wildcard_is_no_filter():
    """Baseline-after: «τι έχουμε στο My App;» arrived as category="*",
    keyword="*" and was refused, costing a round."""
    tasks = [_task("t-a", workspace_id="ws-myapp")]
    search, *_ = _tools(tasks, question="τι έχουμε στο My App;")

    result = search(workspace="My App", category="*", keyword="*")

    assert _ids(result["tasks"]) == ["t-a"]


def test_an_update_changes_only_what_the_user_asked_for():
    """Baseline-after: «βάλε τον έλεγχο θερμοσίφωνα για αύριο» proposed
    description «Γραφείο» — the workspace's name — for a task with none."""
    task = _task("t-heater", task_name="Έλεγχος θερμοσίφωνα", due_date="2026-09-28")
    *_, update, _create, proposals, _ = _tools([task], question="βάλε τον έλεγχο θερμοσίφωνα για αύριο")

    update("t-heater", due_date="2026-09-24", description="Γραφείο", priority="P1")

    assert proposals[-1]["fields"] == {"due_date": "2026-09-24"}


def test_a_yes_to_the_agents_own_suggestion_carries_its_date():
    task = _task("t-a")
    ctx = _ctx([task])
    proposals = []
    _c, update, _cr = agent_tools.build_write_proposal_tools(
        proposals, [task], question="ναι", ctx=ctx,
        earlier_turns=["τι δεν έχει ημερομηνία;", "Έχεις ένα. Θέλεις να το βάλω για αύριο;"])

    update("t-a", due_date="2026-09-24")

    assert proposals[-1]["fields"] == {"due_date": "2026-09-24"}


def test_the_users_own_rows_say_so_once_colleagues_exist():
    """Final run: left bare beside rows naming people, the user's own «Κλήση
    λογιστή» was filed under «Άλλων»."""
    mine = _task("t-mine", workspace_id="ws-personal")
    row = agent_tools.render_task_rows([mine], _ctx([mine]))[0]

    assert (row["assigned_to"], row["created_by"]) == ("nobody", "you")


def test_the_inbox_never_counts_other_peoples_tasks():
    """Final run: «τι περιμένει έγκριση;» added «4 more in the Inbox belong to
    others» — counted from their OPEN tasks."""
    waiting = _task("t-wait", task_name="Έλεγχος εγγύησης")
    waiting.approval_status = False
    theirs = _task("t-theirs", created_by=EVI, workspace_id="ws-personal")
    search, *_ = _tools([waiting, theirs])

    result = search(inbox=True)

    assert _ids(result["tasks"]) == ["t-wait"] and "others_hint" not in result
