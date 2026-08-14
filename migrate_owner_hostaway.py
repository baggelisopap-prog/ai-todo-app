"""
One-off: gives the owner a hostaway_connections row from what is in .env.

Webhook 34986 already exists and already points at the deployed endpoint, so
this claims it rather than registering a second one — reusing an id is
exactly what hostaway_register_webhook does for everyone else.

Safe to run twice: upsert_hostaway_connection replaces the row.

    PYTHONIOENCODING=utf-8 ./venv/Scripts/python.exe migrate_owner_hostaway.py
"""
import os

from dotenv import load_dotenv

import crypto
import repository

load_dotenv()

OWNER_USER_ID = "fdedc7be-964b-4e75-b4a0-bd16cb6b05e7"
EXISTING_WEBHOOK_ID = 34986

account_id = os.getenv("HOSTAWAY_CLIENT_ID")
client_secret = os.getenv("HOSTAWAY_CLIENT_SECRET")

if not account_id or not client_secret:
    raise SystemExit("HOSTAWAY_CLIENT_ID / HOSTAWAY_CLIENT_SECRET are not in .env")
if not os.getenv("HOSTAWAY_ENCRYPTION_KEY"):
    raise SystemExit("HOSTAWAY_ENCRYPTION_KEY is not set — see crypto.py")

repository.upsert_hostaway_connection(
    OWNER_USER_ID, account_id, crypto.encrypt_secret(client_secret), EXISTING_WEBHOOK_ID
)

written = repository.get_hostaway_connection(OWNER_USER_ID)
print(f"account_id        = {written['account_id']}")
print(f"webhook_id        = {written['webhook_id']}")
print(f"tasks_enabled     = {written['tasks_enabled']}")
print(f"auto_close_enabled= {written['auto_close_enabled']}")
print(f"secret round-trip = {crypto.decrypt_secret(written['client_secret_encrypted']) == client_secret}")
