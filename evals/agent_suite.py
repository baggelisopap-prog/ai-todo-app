"""
The agent's real-model regression suite, first built for the 2026-09-25 audit.

COSTS MONEY: every question is a real Gemini call. A full run is ~25 questions,
~210,000 tokens (about $0.06 at gemini-3.1-flash-lite prices). Ask the owner
before running it: that is a standing rule of this project.

Same questions, same data, run on the current code ("baseline") and after the
fixes ("after"). Two data sources:
  live   - the owner's real account, read-only (the agent only PROPOSES)
  office - a synthetic shared workspace held in memory; repository reads are
           monkeypatched, agent_runs are captured locally, nothing is written.
Every question is tagged #s..., so none shows in the owner's history.

Only invented times are checked automatically; the rest is judged by reading
each answer against its `expect`. The live cases' `expect` describes his data
on 2026-09-25 (38 in the Inbox, the two «Τεστ» Εύη closed) — re-read them
against the day's data. The office cases are fixed and dated relative to today.

  ./venv/Scripts/python.exe evals/agent_suite.py <label> [CASE ...]   (no CASE = all)
Appends to evals/results/suite_<label>.jsonl and prints a compact report.
"""
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

ROOT = str(__import__("pathlib").Path(__file__).resolve().parent.parent)
sys.path.insert(0, ROOT)
os.chdir(ROOT)
sys.stdout.reconfigure(encoding="utf-8")
logging.disable(logging.CRITICAL)

import repository  # noqa: E402
import agent_engine  # noqa: E402
from models import Category, Workspace, WorkspaceMember  # noqa: E402

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
os.makedirs(HERE, exist_ok=True)
OWNER = "fdedc7be-964b-4e75-b4a0-bd16cb6b05e7"
EVI = "5e1f0a2b-7c3d-4e8f-9a0b-1c2d3e4f5a6b"
KOSTAS = "6f2a1b3c-8d4e-4f9a-8b1c-2d3e4f5a6b7c"

now = datetime.now(ZoneInfo("Europe/Athens"))
D = lambda n: (now + timedelta(days=n)).strftime("%Y-%m-%d")  # noqa: E731
STAMP = lambda n: (now + timedelta(days=n)).replace(hour=15, minute=0).isoformat()  # noqa: E731

TIME_WORDS = re.compile(
    r"\d{1,2}[:.]\d{2}|\bστις\b|\bστη\b|\bώρα\b|\bωρα\b|πρωί|πρωι|βράδυ|βραδυ|μεσημέρι|απόγευμα|"
    r"μεσάνυχτα|\bam\b|\bpm\b|\bat \d|o'clock|noon|midnight", re.I)


def _t(rid, name, *, created_by=OWNER, assigned_to=None, ws=None, cat=None, due=None, time_=None,
       prio="P2", done=False, closer=None, closed_at=None, approved=True, rule=None, desc=""):
    return SimpleNamespace(
        record_id=rid, task_name=name, description=desc, priority=prio, due_date=due, due_time=time_,
        is_completed=done, approval_status=approved, is_rejected=False, missed_at=None,
        cancelled_at=None, deleted_at=None, workspace_id=ws, category_id=cat, assigned_to=assigned_to,
        created_by=created_by, checklist=[], category="Business", completed_by=closer,
        completed_at=closed_at, recurrence_rule_id=rule, hostaway_conversation_id=None,
        occurrence_date=due if rule else None,
    )


def office():
    ws = [Workspace(record_id="a1000000-0000-4000-8000-000000000001", name="Business"),
          Workspace(record_id="a1000000-0000-4000-8000-000000000002", name="Γραφείο"),
          Workspace(record_id="a1000000-0000-4000-8000-000000000003", name="Σπίτι")]
    B, O, H = (w.record_id for w in ws)
    cats = [Category(record_id="c1000000-0000-4000-8000-000000000001", workspace_id=O, name="Καθαριότητα"),
            Category(record_id="c1000000-0000-4000-8000-000000000002", workspace_id=O, name="Λογιστικά"),
            Category(record_id="c1000000-0000-4000-8000-000000000003", workspace_id=B, name="Hostaway")]
    CLEAN, ACC, HOST = (c.record_id for c in cats)
    members = [WorkspaceMember(workspace_id=w, user_id=OWNER, role="owner") for w in (B, O, H)]
    members += [WorkspaceMember(workspace_id=O, user_id=EVI), WorkspaceMember(workspace_id=O, user_id=KOSTAS)]
    profiles = {OWNER: {"display_name": "Βαγγέλης"}, EVI: {"display_name": "Εύη Ζιάκα"},
                KOSTAS: {"display_name": "Κώστας Ζαχαρίου"}}
    r = lambda n: f"b1000000-0000-4000-8000-{n:012d}"  # noqa: E731
    tasks = [
        _t(r(1), "Τιμολόγιο Airbnb Αυγούστου", created_by=EVI, assigned_to=OWNER, ws=O, cat=ACC, due=D(0), time_="12:00", prio="P1"),
        _t(r(2), "Καθαρισμός διαμερίσματος Β2", created_by=EVI, ws=O, cat=CLEAN, due=D(1)),
        _t(r(3), "Παραλαβή κλειδιών από κλειδαρά", assigned_to=KOSTAS, ws=O, due=D(1)),
        _t(r(4), "Κλήση λογιστή για ΦΠΑ", ws=O, cat=ACC, due=D(1), time_="11:00"),
        _t(r(5), "Αγορά σεντονιών", created_by=KOSTAS, assigned_to=EVI, ws=O, cat=CLEAN, due=D(2)),
        _t(r(6), "Έλεγχος θερμοσίφωνα", created_by=KOSTAS, assigned_to=OWNER, ws=O, due=D(3), time_="16:30"),
        _t(r(7), "Ανανέωση ασφάλειας ακινήτου", ws=B, due=D(0)),
        _t(r(8), "Απάντηση σε κριτική επισκέπτη", ws=B, cat=HOST, due=D(-2)),
        _t(r(9), "Σέρβις πλυντηρίου πιάτων", ws=H, due=D(1)),
        _t(r(10), "Φωτογραφίες νέου διαμερίσματος", created_by=EVI, assigned_to=EVI, ws=O, due=D(-1), done=True, closer=EVI, closed_at=STAMP(-1)),
        _t(r(11), "Επισκευή κλιματιστικού Α1", assigned_to=KOSTAS, ws=O, due=D(-1)),
        _t(r(12), "Ενημέρωση τιμών στο Booking", created_by=EVI, assigned_to=OWNER, ws=O, due=D(5)),
        _t(r(13), "Αλλαγή λαμπτήρων Α2", ws=O, due=D(-2), done=True, closer=EVI, closed_at=STAMP(-1)),
        _t(r(14), "Πληρωμή ΔΕΗ Β1", created_by=KOSTAS, assigned_to=KOSTAS, ws=O, due=D(-3), done=True, closer=OWNER, closed_at=STAMP(-3)),
        # closed YESTERDAY by the owner, though due five days ago: «τι έκανα χθες»
        _t(r(15), "Αλλαγή κωδικού lockbox", ws=B, due=D(-5), done=True, closer=OWNER, closed_at=STAMP(-1)),
        # awaiting approval in the Inbox
        _t(r(16), "Έλεγχος εγγύησης νέας κράτησης", ws=B, due=D(2), approved=False),
        _t(r(17), "Ανανέωση συμβολαίου internet", ws=H, approved=False),
        # a daily recurrence: seven occurrences this week
        *[_t(r(30 + i), "Πότισμα φυτών", ws=H, due=D(i), time_="08:00", rule="rr-water") for i in range(7)],
    ]
    log = [
        {"task_id": r(1), "actor_user_id": EVI, "details": {"assigned_to": OWNER}, "created_at": "2026-09-20T09:00:00"},
        {"task_id": r(3), "actor_user_id": OWNER, "details": {"assigned_to": KOSTAS}, "created_at": "2026-09-21T09:00:00"},
        {"task_id": r(5), "actor_user_id": KOSTAS, "details": {"assigned_to": EVI}, "created_at": "2026-09-21T10:00:00"},
        {"task_id": r(10), "actor_user_id": EVI, "details": {"assigned_to": EVI}, "created_at": "2026-09-19T10:00:00"},
        {"task_id": r(11), "actor_user_id": OWNER, "details": {"assigned_to": KOSTAS}, "created_at": "2026-09-22T10:00:00"},
        {"task_id": r(12), "actor_user_id": EVI, "details": {"assigned_to": OWNER}, "created_at": "2026-09-23T10:00:00"},
    ]
    return ws, cats, members, profiles, tasks, log


# (id, source, question or [turns], what a correct answer does)
SUITE = [
    ("L01", "live", "τι έχω σήμερα;", "today's own tasks, from the day view, one round"),
    ("L02", "live", "τι έχω αύριο;", "tomorrow's own tasks"),
    ("L03", "live", "τι έχω αυτή την εβδομάδα;", "week; a daily recurrence should not flood it"),
    ("L04", "live", "τι έχει καθυστερήσει;", "overdue own tasks"),
    ("L05", "live", "τι περιμένει έγκριση στο inbox;", "the Inbox (38 awaiting approval) — not 'none', not just 5"),
    ("L06", "live", "τι έκανα χθες;", "tasks CLOSED yesterday, whatever their due date"),
    ("L07", "live", "βάλε τα ληξιπρόθεσμα για αύριο", "update proposals with a date and NO invented time"),
    ("L08", "live", ["τι έχω σήμερα;", "το δεύτερο βάλ' το για αύριο"], "turn 2: the 2nd task of the answer, date only, no invented time"),
    ("L09", "live", "τι έχουμε στο My App;", "the open My App tasks"),
    ("L10", "live", "πόσα ανοιχτά έχω στο Business;", "a count of open Business tasks"),
    ("L11", "live", "μετέφερε το AI brainstorming για την Παρασκευή", "date = Friday, NO invented time"),
    ("L12", "live", "τι έχει κλείσει η Εύη;", "the 2 tests she closed + 'recorded since 18/9'"),
    ("O01", "office", "τι έχω αύριο;", "own: Κλήση λογιστή 11:00, Σέρβις, Πότισμα; others' never as his"),
    ("O02", "office", "τι έχουμε στο Γραφείο;", "all open Γραφείο tasks, each with whose"),
    ("O03", "office", "ποια μου έδωσε η Εύη;", "Τιμολόγιο + Ενημέρωση τιμών (needs a search)"),
    ("O04", "office", "κλείσε τον καθαρισμό του Β2", "proposal, card 'Ανήκει σε Εύη'"),
    ("O05", "office", "τι έχει καθυστερήσει στο Γραφείο;", "Επισκευή κλιματιστικού (Κώστας)"),
    ("O06", "office", ["τι έχει η Εύη;", "κλείσε το πρώτο"], "turn 2: proposal on Καθαρισμός Β2"),
    ("O07", "office", "βάλε τον έλεγχο θερμοσίφωνα για αύριο", "date = tomorrow, time stays 16:30 (no new time)"),
    ("O08", "office", "τι έκανα χθες;", "Αλλαγή κωδικού lockbox (closed yesterday, due 5 days ago)"),
    ("O09", "office", "τι περιμένει έγκριση;", "Έλεγχος εγγύησης + Ανανέωση συμβολαίου internet"),
    ("O10", "office", "τι έχω αυτή την εβδομάδα;", "own week; Πότισμα φυτών once, not seven rows"),
    ("O11", "office", ["τι έχω σήμερα;", "το πρώτο βάλ' το για μεθαύριο"], "turn 2: first task of the answer, date only"),
]


def _patch_office():
    ws, cats, members, profiles, tasks, log = office()
    repository.get_tasks_for_user = lambda user_id=None: list(tasks)
    repository.get_workspaces = lambda u: list(ws)
    repository.get_categories = lambda u, *a, **k: list(cats)
    repository.get_categories_for_workspaces = lambda ids: [c for c in cats if c.workspace_id in ids]
    repository.get_member_workspace_ids = lambda u: [w.record_id for w in ws]
    repository.get_members_of_workspaces = lambda ids: [m for m in members if m.workspace_id in ids]
    repository.get_profiles = lambda ids: {i: profiles[i] for i in ids if i in profiles}
    repository.get_assignment_log = lambda ids: list(log)


_real = {name: getattr(repository, name) for name in (
    "get_tasks_for_user", "get_workspaces", "get_categories", "get_member_workspace_ids",
    "get_members_of_workspaces", "get_profiles", "get_assignment_log", "log_agent_run", "get_recent_agent_runs",
    "get_categories_for_workspaces")}
captured = {}


def _restore():
    for name, fn in _real.items():
        setattr(repository, name, fn)


def run_case(label, cid, source, question, expect):
    _restore()
    if source == "office":
        _patch_office()
    # Every run is captured locally; live ones are ALSO written (tagged, hidden from history).
    def _log(user_id, run):
        captured.setdefault(run["conversation_id"], []).append(run)
        if source == "live":
            _real["log_agent_run"](user_id, run)
    repository.log_agent_run = _log
    repository.get_recent_agent_runs = lambda user_id, conversation_id, limit=4: [
        {"question": r["question"], "answer": r["answer"], "refs": r["refs"]}
        for r in captured.get(conversation_id, []) if r.get("answer")][-limit:]

    turns, conversation_id = [], None
    for i, q in enumerate(question if isinstance(question, list) else [question]):
        t0 = time.time()
        try:
            res = agent_engine.ask_agent(f"#s{label[:3]}{cid.lower()}{i} {q}", OWNER, conversation_id)
            err = None
        except Exception as e:
            res, err = {}, str(e)
        conversation_id = res.get("conversation_id") or conversation_id
        run = (captured.get(conversation_id) or [{}])[-1]
        invented = [
            (p.get("task_name"), (p.get("fields") or {}).get("due_time"))
            for p in (res.get("proposed_actions") or [])
            if (p.get("fields") or {}).get("due_time") and not TIME_WORDS.search(q)
        ]
        turns.append({
            "question": q, "answer": res.get("answer"), "error": err,
            "proposals": [(p.get("type"), p.get("task_name"), p.get("fields"), p.get("responsible"))
                          for p in (res.get("proposed_actions") or [])],
            "invented_times": invented,
            "tools": [(c["name"], {k: v for k, v in c["args"].items() if v not in (None, "", False)})
                      for rd in run.get("rounds_detail", []) for c in rd.get("tool_calls", [])],
            "rounds": run.get("rounds"), "prompt": run.get("prompt_tokens"),
            "output": run.get("output_tokens"), "total": run.get("total_tokens"),
            "seconds": round(time.time() - t0, 1),
        })
    rec = {"label": label, "id": cid, "source": source, "expect": expect, "turns": turns}
    with open(os.path.join(HERE, f"suite_{label}.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return rec


if __name__ == "__main__":
    label = sys.argv[1]
    wanted = set(sys.argv[2:])
    for cid, source, question, expect in SUITE:
        if wanted and cid not in wanted:
            continue
        rec = run_case(label, cid, source, question, expect)
        for t in rec["turns"]:
            flag = f"  !! INVENTED TIME {t['invented_times']}" if t["invented_times"] else ""
            print(f"=== {cid} | {t['question']}  [r{t['rounds']} {t['total']} tok]{flag}")
            print(f"    expect: {expect}")
            print(f"    tools: {t['tools']}")
            if t["proposals"]:
                print(f"    proposals: {t['proposals']}")
            print("    answer: " + (t["answer"] or f"ERROR {t['error']}").replace("\n", " / ")[:700])
    _restore()
