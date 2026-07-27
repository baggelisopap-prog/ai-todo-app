-- Supabase/Postgres schema derived from Airtable Metadata API ground truth
-- Base: appltfhiUjBTEsd9w
-- Source tables: Tasks, push_subscriptions, app_settings, token_usage_log

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- Tasks
-- =========================================================
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_name TEXT,
    description TEXT,
    category TEXT CHECK (category IN ('Business', 'Personal', 'Unknown', 'Hostaway')),
    priority TEXT CHECK (priority IN ('P1', 'P2', 'P3')),
    due_date TEXT,
    due_time TEXT,
    checklist JSONB,
    approval_status BOOLEAN,
    is_completed BOOLEAN,
    created_time TIMESTAMPTZ,
    ai_suggested_category TEXT CHECK (ai_suggested_category IN ('Business', 'Personal', 'Unknown', 'Hostaway')),
    ai_suggested_priority TEXT CHECK (ai_suggested_priority IN ('P1', 'P2', 'P3')),
    is_rejected BOOLEAN,
    notify_enabled BOOLEAN,
    notification_sent BOOLEAN,
    hostaway_created_at TEXT,
    hostaway_last_notified_at TEXT,
    hostaway_notify_stage INTEGER,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =========================================================
-- push_subscriptions
-- =========================================================
CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint TEXT,
    p256dh TEXT,
    auth TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =========================================================
-- app_settings
-- (Airtable field 'Name' -> lowercased to 'name' per Postgres convention)
-- =========================================================
CREATE TABLE app_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT,
    notifications_enabled BOOLEAN,
    daily_summary_enabled BOOLEAN,
    daily_summary_mode TEXT,
    daily_summary_time TEXT,
    daily_summary_last_sent_date TEXT,
    send_all_enabled BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =========================================================
-- token_usage_log
-- =========================================================
CREATE TABLE token_usage_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_type TEXT,
    "timestamp" TEXT,
    prompt_tokens INTEGER,
    output_tokens INTEGER,
    thinking_tokens INTEGER,
    total_tokens INTEGER,
    model TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);
