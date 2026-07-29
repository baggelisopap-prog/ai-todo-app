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
 * PATCH /tasks/{record_id} — toggles this task's per-task Google Calendar
 * sync opt-in. Thin wrapper over updateTask for a single named field.
 * Returns the updated task object.
 */
export async function toggleTaskCalendarSync(recordId, enabled) {
  return updateTask(recordId, { calendar_sync_enabled: enabled });
}

/**
 * DELETE /tasks/{record_id} — permanently delete a task.
 * Returns void on success (204 No Content).
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
 * POST /agent/query — asks the read-only task Q&A agent a natural-language
 * question. Returns { answer }.
 */
export async function askAgent(question) {
  return request('/agent/query', {
    method: 'POST',
    body: JSON.stringify({ question }),
  });
}

/**
 * GET /dev/token-usage — developer-only Gemini token usage summary
 * (recent calls plus today/this-week totals and estimated cost).
 */
export async function getTokenUsage() {
  return request('/dev/token-usage');
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
 * GET /calendar/events — Google Calendar events pulled in by the scheduler
 * that this app didn't create and haven't been converted to a task yet.
 * Returns a list of event records.
 */
export async function getGoogleCalendarEvents() {
  return request('/calendar/events');
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