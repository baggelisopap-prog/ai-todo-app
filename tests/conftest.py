"""
One guard for the whole suite: no test reaches Supabase through the board diary.

Since 2026-09-26 every completion, reopening and cancellation also writes a line
to the diary of each board the task sits on (repository.log_task_event_on_boards).
That call reads board_cards first — and the repository's client is the REAL one,
built from .env at import. Dozens of existing tests drive TaskService.update_task
with a fake repository object but leave the module-level functions alone, so
without this every one of them would quietly query the live database.

Tests that are ABOUT the diary replace this stub with their own recorder.
"""
import pytest

import repository


@pytest.fixture(autouse=True)
def _board_diary_stays_offline(monkeypatch):
    monkeypatch.setattr(repository, "log_task_event_on_boards", lambda *args, **kwargs: None)
