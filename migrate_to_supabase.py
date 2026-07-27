"""
ONE-OFF migration script: reads RAW records directly from Airtable's REST
API (not through repository.py's models, to guarantee no field is silently
missed) and writes them into the corresponding Supabase tables. Read-only
on Airtable, does not touch any live app file.

Usage:
    python migrate_to_supabase.py --dry-run
    python migrate_to_supabase.py
"""
import os
import sys
import json
import logging
import requests
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

AIRTABLE_TOKEN = os.getenv("AIRTABLE_TOKEN")
AIRTABLE_BASE_ID = "appltfhiUjBTEsd9w"

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY")

if not all([AIRTABLE_TOKEN, SUPABASE_URL, SUPABASE_SECRET_KEY]):
    raise RuntimeError("AIRTABLE_TOKEN, SUPABASE_URL, and SUPABASE_SECRET_KEY must all be set in .env")

supabase = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
DRY_RUN = "--dry-run" in sys.argv

TABLE_IDS = {
    "tasks": "tblZgZ78btV6gCHvB",
    "push_subscriptions": "tblIm2GdmPg2ej8iH",
    "app_settings": "tblQJ6TazRzLVBstn",
    "token_usage_log": "tblcFkFTjZGU7IEMU",
}


def fetch_all_airtable_records(table_id):
    """Fetches ALL records from an Airtable table, raw, handling pagination."""
    all_records = []
    offset = None
    while True:
        params = {"pageSize": 100}
        if offset:
            params["offset"] = offset
        response = requests.get(
            f"https://api.airtable.com/v0/{AIRTABLE_BASE_ID}/{table_id}",
            headers={"Authorization": f"Bearer {AIRTABLE_TOKEN}"},
            params=params,
        )
        response.raise_for_status()
        data = response.json()
        all_records.extend(data.get("records", []))
        offset = data.get("offset")
        if not offset:
            break
    return all_records


def normalize_checklist(raw_value):
    if not raw_value:
        return []
    try:
        parsed = json.loads(raw_value)
    except (json.JSONDecodeError, TypeError):
        logging.warning(f"Could not parse checklist value: {raw_value!r}, defaulting to empty")
        return []
    if not isinstance(parsed, list):
        return []
    normalized = []
    for item in parsed:
        if isinstance(item, str):
            normalized.append({"text": item, "done": False})
        elif isinstance(item, dict):
            normalized.append({"text": item.get("text", ""), "done": bool(item.get("done", False))})
    return normalized


def migrate_tasks():
    records = fetch_all_airtable_records(TABLE_IDS["tasks"])
    logging.info(f"Found {len(records)} task records in Airtable")

    rows = []
    for rec in records:
        f = rec["fields"]
        rows.append({
            "task_name": f.get("task_name"),
            "description": f.get("description"),
            "category": f.get("category"),
            "priority": f.get("priority"),
            "due_date": f.get("due_date"),
            "due_time": f.get("due_time"),
            "checklist": normalize_checklist(f.get("checklist")),
            "approval_status": bool(f.get("approval_status", False)),
            "is_completed": bool(f.get("is_completed", False)),
            "created_time": f.get("created_time"),
            "ai_suggested_category": f.get("ai_suggested_category"),
            "ai_suggested_priority": f.get("ai_suggested_priority"),
            "is_rejected": bool(f.get("is_rejected", False)),
            "notify_enabled": bool(f.get("notify_enabled", False)),
            "notification_sent": bool(f.get("notification_sent", False)),
            "hostaway_created_at": f.get("hostaway_created_at"),
            "hostaway_last_notified_at": f.get("hostaway_last_notified_at"),
        })

    if DRY_RUN:
        logging.info(f"[DRY RUN] Would insert {len(rows)} rows into 'tasks'. Sample: {rows[0] if rows else 'none'}")
        return

    if rows:
        batch_size = 500
        total = 0
        for i in range(0, len(rows), batch_size):
            result = supabase.table("tasks").insert(rows[i:i+batch_size]).execute()
            total += len(result.data)
        logging.info(f"Inserted {total} rows into 'tasks'")


def migrate_push_subscriptions():
    records = fetch_all_airtable_records(TABLE_IDS["push_subscriptions"])
    logging.info(f"Found {len(records)} push subscription records in Airtable")

    rows = [{
        "endpoint": rec["fields"].get("endpoint"),
        "p256dh": rec["fields"].get("p256dh"),
        "auth": rec["fields"].get("auth"),
    } for rec in records]

    if DRY_RUN:
        logging.info(f"[DRY RUN] Would insert {len(rows)} rows into 'push_subscriptions'")
        return

    if rows:
        result = supabase.table("push_subscriptions").insert(rows).execute()
        logging.info(f"Inserted {len(result.data)} rows into 'push_subscriptions'")


def migrate_app_settings():
    records = fetch_all_airtable_records(TABLE_IDS["app_settings"])
    logging.info(f"Found {len(records)} app_settings records in Airtable")

    rows = [{
        "name": rec["fields"].get("name") or rec["fields"].get("Name"),
        "notifications_enabled": bool(rec["fields"].get("notifications_enabled", True)),
        "daily_summary_enabled": bool(rec["fields"].get("daily_summary_enabled", False)),
        "daily_summary_mode": rec["fields"].get("daily_summary_mode", "fixed_time"),
        "daily_summary_time": rec["fields"].get("daily_summary_time", "08:00"),
        "daily_summary_last_sent_date": rec["fields"].get("daily_summary_last_sent_date", ""),
        "send_all_enabled": bool(rec["fields"].get("send_all_enabled", True)),
    } for rec in records]

    if DRY_RUN:
        logging.info(f"[DRY RUN] Would insert {len(rows)} rows into 'app_settings': {rows}")
        return

    if rows:
        result = supabase.table("app_settings").insert(rows).execute()
        logging.info(f"Inserted {len(result.data)} rows into 'app_settings'")


def migrate_token_usage_log():
    records = fetch_all_airtable_records(TABLE_IDS["token_usage_log"])
    logging.info(f"Found {len(records)} token usage log records in Airtable")

    rows = [{
        "call_type": rec["fields"].get("call_type"),
        "timestamp": rec["fields"].get("timestamp"),
        "prompt_tokens": rec["fields"].get("prompt_tokens"),
        "output_tokens": rec["fields"].get("output_tokens"),
        "thinking_tokens": rec["fields"].get("thinking_tokens"),
        "total_tokens": rec["fields"].get("total_tokens"),
        "model": rec["fields"].get("model"),
    } for rec in records]

    if DRY_RUN:
        logging.info(f"[DRY RUN] Would insert {len(rows)} rows into 'token_usage_log'")
        return

    if rows:
        batch_size = 500
        total = 0
        for i in range(0, len(rows), batch_size):
            result = supabase.table("token_usage_log").insert(rows[i:i+batch_size]).execute()
            total += len(result.data)
        logging.info(f"Inserted {total} rows into 'token_usage_log'")


if __name__ == "__main__":
    if DRY_RUN:
        logging.info("=== DRY RUN MODE — no data will be written ===")
    migrate_tasks()
    migrate_push_subscriptions()
    migrate_app_settings()
    migrate_token_usage_log()
    logging.info("Migration complete." if not DRY_RUN else "Dry run complete.")
