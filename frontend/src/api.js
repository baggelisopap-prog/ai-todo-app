// Centralized API client. All backend HTTP calls go through this file.
// If the backend URL or auth requirements change, update here only.

import { supabase } from './supabaseClient';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/**
 * Attaches the current Supabase session's access token (if any) as a
 * Bearer Authorization header, then performs a normal fetch. Every
 * backend call in this file goes through this instead of raw fetch, since
 * every user-facing endpoint now requires a valid token.
 */
async function authenticatedFetch(url, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers = {
    ...options.headers,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  return fetch(url, { ...options, headers });
}

/**
 * Generic helper for HTTP requests. Handles JSON encoding, error responses,
 * and network failures. All other functions in this file delegate to this.
 */
async function request(path, options = {}) {
  const url = `${API_BASE_URL}${path}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };

  let response;
  try {
    response = await authenticatedFetch(url, config);
  } catch (error) {
    // Network failure (server down, no internet, CORS misconfigured)
    throw new Error(`Network error: ${error.message}`);
  }

  if (!response.ok) {
    // HTTP error (4xx or 5xx). Try to parse the error body for detail.
    let detail;
    try {
      const errorBody = await response.json();
      detail = errorBody.detail || JSON.stringify(errorBody);
    } catch {
      detail = response.statusText;
    }
    throw new Error(`API error ${response.status}: ${detail}`);
  }

  return response.json();
}

/**
 * GET /health — confirms the backend is reachable.
 */
export async function checkHealth() {
  return request('/health');
}

/**
 * GET /tasks — retrieves all tasks from the backend.
 * Returns { tasks: [...], count: N }
 */
export async function getAllTasks() {
  return request('/tasks');
}

/**
 * POST /extract — sends natural language text, gets back saved tasks.
 * Returns { saved_tasks: [...], count: N }
 */
export async function extractTasks(text) {
  return request('/extract', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

/**
 * POST /extract-voice — sends audio to AI, gets back saved tasks.
 * Uses FormData (multipart). Cannot go through request() which hardcodes JSON headers.
 * Returns { saved_tasks: [...], count: N }
 */
export async function extractTasksFromAudio(audioBlob) {
  const formData = new FormData();
  const extension = audioBlob.type.split('/')[1]?.split(';')[0] || 'webm';
  formData.append('audio', audioBlob, `recording.${extension}`);

  let response;
  try {
    response = await authenticatedFetch(`${API_BASE_URL}/extract-voice`, {
      method: 'POST',
      body: formData,
      // No Content-Type header — the browser sets it with the correct multipart boundary
    });
  } catch (error) {
    throw new Error(`Network error: ${error.message}`);
  }

  if (!response.ok) {
    let detail;
    try {
      const errorBody = await response.json();
      detail = errorBody.detail || JSON.stringify(errorBody);
    } catch {
      detail = response.statusText;
    }
    throw new Error(`API error ${response.status}: ${detail}`);
  }

  return response.json();
}

/**
 * POST /extract-image — sends an image to AI, gets back saved tasks.
 * Uses FormData (multipart). Cannot go through request() which hardcodes JSON headers.
 * Returns { saved_tasks: [...], count: N }
 */
export async function extractTasksFromImage(imageBlob, context = '') {
  const formData = new FormData();
  const extension = imageBlob.type.split('/')[1]?.split(';')[0] || 'jpg';
  formData.append('image', imageBlob, `photo.${extension}`);
  if (context && context.trim()) {
    formData.append('context', context.trim());
  }

  let response;
  try {
    response = await authenticatedFetch(`${API_BASE_URL}/extract-image`, {
      method: 'POST',
      body: formData,
    });
  } catch (error) {
    throw new Error(`Network error: ${error.message}`);
  }

  if (!response.ok) {
    let detail;
    try {
      const errorBody = await response.json();
      detail = errorBody.detail || JSON.stringify(errorBody);
    } catch {
      detail = response.statusText;
    }
    throw new Error(`API error ${response.status}: ${detail}`);
  }

  return response.json();
}

/**
 * POST /tasks — manually creates a task without AI extraction.
 * Returns the created task object.
 */
export async function createTaskManual(payload) {
  return request('/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * PATCH /tasks/{record_id} — updates specific fields of a task.
 * Returns the updated task object.
 */
export async function updateTask(recordId, updates) {
  return request(`/tasks/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

/**
 * POST /tasks/{record_id}/agent-edit — turns one natural-language instruction
 * about THIS task into a change to it ("βάλ' το Παρασκευή απόγευμα").
 *
 * Returns a PLAN, not a result — nothing has been written yet:
 *   { action: 'edit',    message, fields, before, invalid }  → PATCH `fields`
 *                        (`before` is the Undo payload, built server-side)
 *   { action: 'delete',  message }   → confirm, then deleteTask()
 *   { action: 'unclear', message }   → show the message, apply nothing
 *   { action: 'none',    message }   → understood, nothing to change
 *
 * The write deliberately goes back through updateTask/deleteTask rather than
 * happening inside this endpoint, so it takes the same path as editing the
 * card by hand — see the endpoint's docstring in main.py.
 */
export async function agentEditTask(recordId, instruction) {
  return request(`/tasks/${recordId}/agent-edit`, {
    method: 'POST',
    body: JSON.stringify({ instruction }),
  });
}

/**
 * PATCH /tasks/{record_id} — toggles this task's per-task Google Calendar
 * sync opt-in. Thin wrapper over updateTask for a single named field.
 * Returns the updated task object.
 */
export async function toggleTaskCalendarSync(recordId, enabled) {
  return updateTask(recordId, { calendar_sync_enabled: enabled });
}

/**
 * DELETE /tasks/{record_id} — permanently delete a task.
 * Returns { calendar } describing what happened to the linked Google Calendar
 * event: 'none' | 'deleted' | 'kept_google_origin' | 'delete_failed'. The task
 * is deleted in all four cases — 'kept_google_origin' means the event was
 * created in Google Calendar rather than here, so this app leaves it alone and
 * the user needs telling. (Was 204 No Content, which could not report any of
 * this.)
 */
export async function deleteTask(recordId) {
  const response = await authenticatedFetch(`${API_BASE_URL}/tasks/${recordId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    let detail;
    try {
      const errorBody = await response.json();
      detail = errorBody.detail || JSON.stringify(errorBody);
    } catch {
      detail = response.statusText;
    }
    throw new Error(`API error ${response.status}: ${detail}`);
  }
  // Tolerate a body-less response: an older backend still answers 204 here, and
  // the delete itself succeeded either way — only the calendar detail is missing.
  try {
    return await response.json();
  } catch {
    return { calendar: 'none' };
  }
}

/**
 * POST /push/subscribe — registers this browser's push subscription with the backend.
 * Returns { status, record_id }.
 */
export async function registerPushSubscription(subscription) {
  const subJson = subscription.toJSON();
  return request('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({
      endpoint: subJson.endpoint,
      keys: subJson.keys,
    }),
  });
}

/**
 * POST /push/send-test — asks the backend to send a real Web Push
 * notification to every registered subscription.
 * Returns { sent, failed, total }.
 */
export async function sendTestPush() {
  return request('/push/send-test', {
    method: 'POST',
  });
}

/**
 * GET /settings — retrieves app-wide settings.
 * Returns { notifications_enabled, send_all_enabled }.
 */
export async function getAppSettings() {
  return request('/settings');
}

/**
 * PATCH /settings — updates app-wide settings.
 * Accepts { notifications_enabled, send_all_enabled }. Returns the updated settings object.
 */
export async function updateAppSettings(settings) {
  return request('/settings', {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
}

/**
 * POST /agent/query — asks the task agent a natural-language question.
 * Pass the conversation_id returned by a previous call to continue that
 * conversation (lets the agent resolve follow-ups like "it"/"that one");
 * omit it (or pass null) to start a fresh one — the backend mints a new id.
 * Returns { answer, proposed_actions, conversation_id }. proposed_actions is
 * a list of agent-proposed writes (complete/update/create) that the UI
 * renders as confirmation cards — nothing changes in the app until each one
 * is confirmed individually via confirmAgentAction below.
 */
export async function askAgent(question, conversationId) {
  const body = { question };
  if (conversationId) {
    body.conversation_id = conversationId;
  }
  return request('/agent/query', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * POST /agent/confirm-action — executes one agent-proposed action after the
 * user presses Confirm on its card. Pass the exact action object as received
 * in proposed_actions. Returns { status, message, task }.
 */
export async function confirmAgentAction(action) {
  return request('/agent/confirm-action', {
    method: 'POST',
    body: JSON.stringify(action),
  });
}

/**
 * POST /agent/action-cancelled — records that the user REFUSED a proposal.
 * Executes nothing; the card is already grey by the time this is sent.
 *
 * Until 2026-08-23 pressing Cancel never left the phone, so "the AI proposed
 * this and I refused it" — the sharpest signal there is about the agent's
 * judgement — was discarded. Callers must fire this WITHOUT awaiting it and
 * swallow any failure: nothing the user can see depends on it.
 */
export async function cancelAgentAction(action) {
  return request('/agent/action-cancelled', {
    method: 'POST',
    body: JSON.stringify(action),
  });
}

/**
 * GET /agent/conversations — the past agent conversations, newest first.
 * Returns { conversations: [{ conversation_id, title, turns, proposals,
 * started_at, last_at }] }. Development test runs are excluded server-side.
 */
export async function getAgentConversations() {
  return request('/agent/conversations');
}

/**
 * GET /agent/conversations/:id — one past conversation in full: every question
 * and answer oldest-first, and under each answer the proposals it made, each
 * carrying status 'confirmed' | 'cancelled' | 'undecided'.
 */
export async function getAgentConversation(conversationId) {
  return request(`/agent/conversations/${conversationId}`);
}

/**
 * GET /dev/token-usage — developer-only Gemini token usage summary
 * (recent calls plus today/this-week totals and estimated cost).
 */
export async function getTokenUsage() {
  return request('/dev/token-usage');
}

/**
 * GET /profile — retrieves this user's profile (id, email, display_name).
 */
export async function getProfile() {
  return request('/profile');
}

/**
 * PATCH /profile — updates this user's display name. Returns the updated profile.
 */
export async function updateProfile(displayName) {
  return request('/profile', {
    method: 'PATCH',
    body: JSON.stringify({ display_name: displayName }),
  });
}

/**
 * DELETE /account — permanently deletes this user's account and all their
 * data (cascades server-side). Returns { status: 'deleted' }.
 */
export async function deleteAccount() {
  return request('/account', { method: 'DELETE' });
}

/**
 * POST /calendar/connect — sends the Google provider tokens captured right
 * after the Calendar-scope OAuth flow completes, for the backend to store.
 * Returns { status: 'connected' }.
 */
export async function connectGoogleCalendar(accessToken, refreshToken) {
  return request('/calendar/connect', {
    method: 'POST',
    body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
  });
}

/**
 * GET /calendar/status — whether this user has a stored Google Calendar connection.
 * Returns { connected: boolean }.
 */
export async function getCalendarStatus() {
  return request('/calendar/status');
}

/**
 * POST /calendar/disconnect — deletes this user's stored Google Calendar connection.
 * Returns { status: 'disconnected' }.
 */
export async function disconnectGoogleCalendar() {
  return request('/calendar/disconnect', { method: 'POST' });
}

/**
 * GET /calendar/test — verifies the stored connection by fetching the
 * user's real calendar name from Google. Returns { status, calendar_name }.
 */
export async function testCalendarConnection() {
  return request('/calendar/test');
}

/**
 * GET /integrations/hostaway — { connected, account_id, tasks_enabled, auto_close_enabled }.
 * The client secret is never returned by the backend.
 */
export async function getHostawayStatus() {
  return request('/integrations/hostaway');
}

/**
 * POST /integrations/hostaway — validates the credentials against Hostaway,
 * registers the webhook, stores the connection. 400 if Hostaway rejects them.
 */
export async function connectHostaway(accountId, clientSecret) {
  return request('/integrations/hostaway', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId, client_secret: clientSecret }),
  });
}

/** PATCH /integrations/hostaway — either switch, alone or together. */
export async function updateHostawaySwitches(switches) {
  return request('/integrations/hostaway', {
    method: 'PATCH',
    body: JSON.stringify(switches),
  });
}

/** DELETE /integrations/hostaway — removes the webhook, then the connection. */
export async function disconnectHostaway() {
  return request('/integrations/hostaway', { method: 'DELETE' });
}

/**
 * GET /calendar/events — Google Calendar events pulled in by the scheduler
 * that this app didn't create and haven't been converted to a task yet.
 * Pass a YYYY-MM-DD date to filter to just that day (e.g. for the Today
 * view's inline events section); omit it for the full list (Settings panel).
 * Returns a list of event records.
 */
export async function getGoogleCalendarEvents(date = null) {
  return request(date ? `/calendar/events?date=${date}` : '/calendar/events');
}

/**
 * GET /calendar/events?start=...&end=... — Google Calendar events whose
 * start_date falls within [startDate, endDate] (both YYYY-MM-DD, inclusive).
 * Used by the Monthly/Weekly Calendar view. Returns a list of event records.
 */
export async function getCalendarEventsInRange(startDate, endDate) {
  return request(`/calendar/events?start=${startDate}&end=${endDate}`);
}

/**
 * POST /calendar/events/{event_record_id}/convert — explicitly converts a
 * stored foreign calendar event into a real task. Returns the created task.
 */
export async function convertCalendarEventToTask(eventRecordId) {
  return request(`/calendar/events/${eventRecordId}/convert`, {
    method: 'POST',
  });
}

/**
 * POST /calendar/events/{event_record_id}/dismiss — hides a foreign
 * calendar event from the events views. Does not touch Google Calendar or
 * delete the underlying row; it just won't reappear on the next sync.
 */
export async function dismissCalendarEvent(eventRecordId) {
  return request(`/calendar/events/${eventRecordId}/dismiss`, {
    method: 'POST',
  });
}

/**
 * GET /recurrences — this user's recurrence rules.
 * Returns { recurrences: [...], count: N }
 */
export async function getRecurrences() {
  return request('/recurrences');
}

/**
 * POST /recurrences — creates a rule AND materialises its window server-side.
 * Returns { recurrence: {...}, occurrences_created: N }, status 201.
 */
export async function createRecurrence(payload) {
  return request('/recurrences', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * PATCH /recurrences/{id} — edits, pauses (is_active) or approves
 * (approval_status) a rule, regenerating from tomorrow on. This is also how
 * an AI-created rule gets approved and how a rule gets paused — there is no
 * separate endpoint for either.
 * Returns { recurrence: {...}, occurrences_created: N }
 */
export async function updateRecurrence(recurrenceId, updates) {
  return request(`/recurrences/${recurrenceId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

/**
 * DELETE /recurrences/{id} — removes the rule and every OPEN occurrence.
 * Completed and missed ones stay as ordinary tasks.
 * Returns { deleted: true, occurrences_removed: N }
 */
export async function deleteRecurrence(recurrenceId) {
  return request(`/recurrences/${recurrenceId}`, { method: 'DELETE' });
}