// Centralized API client. All backend HTTP calls go through this file.
// If the backend URL or auth requirements change, update here only.

import { supabase } from './supabaseClient';
import { RETRY_DELAYS_MS, shouldRetryRequest } from './utils/retry';

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Told when a request has failed once and is about to be retried, so a screen
 * can say "waking up" instead of leaving a spinner with no explanation.
 *
 * A plain list rather than an event emitter: there is one subscriber (App) and
 * the alternative is a dependency for four lines of code.
 */
const wakingListeners = [];

export function onBackendWaking(listener) {
  wakingListeners.push(listener);
  return () => {
    const i = wakingListeners.indexOf(listener);
    if (i >= 0) wakingListeners.splice(i, 1);
  };
}

function announceWaking() {
  wakingListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // A broken listener must not take down the request it was told about.
    }
  });
}

/**
 * Generic helper for HTTP requests. Handles JSON encoding, error responses,
 * and network failures. All other functions in this file delegate to this.
 *
 * Reads retry themselves, writes do not — see utils/retry.js for why that
 * asymmetry is a safety rule rather than a convenience.
 */
async function request(path, options = {}) {
  const url = `${API_BASE_URL}${path}`;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  };
  const isRead = !options.method || options.method === 'GET';

  let response;
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await authenticatedFetch(url, config);
    } catch (error) {
      // Network failure (server down, no internet, CORS misconfigured)
      if (shouldRetryRequest({ attempt, isRead, status: null })) {
        announceWaking();
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw new Error(`Network error: ${error.message}`);
    }

    if (shouldRetryRequest({ attempt, isRead, status: response.status })) {
      announceWaking();
      await sleep(RETRY_DELAYS_MS[attempt]);
      continue;
    }
    break;
  }

  if (!response.ok) {
    // HTTP error (4xx or 5xx). Try to parse the error body for detail.
    let detail;
    let code;
    try {
      const errorBody = await response.json();
      detail = errorBody.detail || JSON.stringify(errorBody);
      // Sharing refusals carry a machine-readable code alongside the Greek
      // sentence, so a caller can branch without matching on Greek text.
      code = errorBody.code;
    } catch {
      detail = response.statusText;
    }
    // The message keeps its old shape so nothing that logs it changes, but the
    // pieces are attached too: a screen that wants to SHOW the reason should
    // not have to slice "API error 410: " off the front of a sentence.
    const error = new Error(`API error ${response.status}: ${detail}`);
    error.status = response.status;
    error.detail = detail;
    error.code = code;
    throw error;
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
export async function extractTasks(text, workspaceId = null) {
  // workspaceId is where the user was standing. The extractor is scoped to it
  // and is shown only that workspace's category names; null means "Όλα" and
  // the server falls back to their default workspace.
  return request('/extract', {
    method: 'POST',
    body: JSON.stringify({ text, workspace_id: workspaceId }),
  });
}

/**
 * POST /extract-voice — sends audio to AI, gets back saved tasks.
 * Uses FormData (multipart). Cannot go through request() which hardcodes JSON headers.
 * Returns { saved_tasks: [...], count: N }
 */
export async function extractTasksFromAudio(audioBlob, workspaceId = null) {
  const formData = new FormData();
  const extension = audioBlob.type.split('/')[1]?.split(';')[0] || 'webm';
  formData.append('audio', audioBlob, `recording.${extension}`);
  if (workspaceId) formData.append('workspace_id', workspaceId);

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
export async function extractTasksFromImage(imageBlob, context = '', workspaceId = null) {
  const formData = new FormData();
  const extension = imageBlob.type.split('/')[1]?.split(';')[0] || 'jpg';
  formData.append('image', imageBlob, `photo.${extension}`);
  if (workspaceId) formData.append('workspace_id', workspaceId);
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
 * DELETE /tasks/{record_id} — delete a task.
 *
 * Since 2026-09-04 this is a SOFT delete: the task leaves every list and moves
 * to Browse's History tab, where restoreTask() below brings it back. The row
 * is not removed, which is what gives the History tab something to show.
 *
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
 * POST /tasks/{record_id}/restore — undo a delete.
 *
 * Returns { calendar }: 'none' | 'kept_google_origin' | 'link_cleared'.
 *
 * 'link_cleared' MUST reach the user. It means the task is back but its Google
 * Calendar event is not — that event was removed from the calendar when the
 * task was deleted, and Google is outside this app's database, so there is no
 * undo to reach for. Showing a bare "Restored" for that case would be a lie
 * the user only discovers when they look at their calendar.
 */
export async function restoreTask(recordId) {
  return request(`/tasks/${recordId}/restore`, { method: 'POST' });
}

/**
 * POST /tasks/{record_id}/acknowledge-completion — "I have seen that somebody
 * else closed this."
 *
 * A task a colleague finished stays on its creator's and its assignee's lists,
 * struck through, until they press OK; this is that press, and the returned
 * task carries the acknowledgement so the row can leave without a refetch.
 *
 * Its own endpoint rather than a field on updateTask: the only value written is
 * the caller's own id, added by the server, and nothing in a request body can
 * reach somebody else's entry.
 *
 * 404 means the task is no longer visible to this user — deleted, or a room
 * they have left. The caller treats that as "it is gone, stop showing it"
 * rather than as an error to retry.
 */
export async function acknowledgeTaskCompletion(recordId) {
  return request(`/tasks/${recordId}/acknowledge-completion`, { method: 'POST' });
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
/**
 * GET /workspaces — this user's workspaces AND every category they own, in one
 * call. Both together because the provider needs the whole set on each app
 * open: a task chip may belong to any workspace, so fetching categories per
 * workspace would be one request per workspace on every launch.
 * Returns { workspaces: [...], categories: [...] }.
 */
export async function getWorkspaces() {
  return request('/workspaces');
}

/** POST /workspaces — { name, color?, position? }. 409 if the name is taken. */
export async function createWorkspace(payload) {
  return request('/workspaces', { method: 'POST', body: JSON.stringify(payload) });
}

/** PATCH /workspaces/{id} — any of name, color, position. 409 on a taken name. */
export async function updateWorkspace(workspaceId, updates) {
  return request(`/workspaces/${workspaceId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

/**
 * DELETE /workspaces/{id} — removes the workspace and, by cascade, its
 * categories. Tasks in it are NOT deleted; they become unfiled.
 * Returns { deleted: true, tasks_unfiled: N }.
 */
export async function deleteWorkspace(workspaceId) {
  return request(`/workspaces/${workspaceId}`, { method: 'DELETE' });
}

/** POST /categories — { workspace_id, name, color?, position? }. */
export async function createCategory(payload) {
  return request('/categories', { method: 'POST', body: JSON.stringify(payload) });
}

/**
 * PATCH /categories/{id}. 422 if the category belongs to an integration and
 * the change includes its name — colour is always allowed.
 */
export async function updateCategory(categoryId, updates) {
  return request(`/categories/${categoryId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

/**
 * DELETE /categories/{id} — 422 for an integration's category.
 * Returns { deleted: true, tasks_unfiled: N }.
 */
export async function deleteCategory(categoryId) {
  return request(`/categories/${categoryId}`, { method: 'DELETE' });
}


// ---------------------------------------------------------------- sharing
// Members, invitations, archiving and the activity log. See
// docs/superpowers/specs/2026-09-11-multi-user-workspace-sharing-design.md

/**
 * GET /workspaces/{id}/members — everyone in the room, owner included.
 * Returns { members: [{ user_id, role, notify_all, display_name, email,
 * joined_at }] }. A member's right; an outsider gets 404.
 */
export async function getWorkspaceMembers(workspaceId) {
  return request(`/workspaces/${workspaceId}/members`);
}

/**
 * DELETE /workspaces/{id}/members/{userId} — owner only.
 * Their tasks stay in the workspace and become unclaimed.
 * 409 if the target is the owner.
 */
export async function removeWorkspaceMember(workspaceId, userId) {
  return request(`/workspaces/${workspaceId}/members/${userId}`, { method: 'DELETE' });
}

/** POST /workspaces/{id}/leave — 409 for the owner, who archives instead. */
export async function leaveWorkspace(workspaceId) {
  return request(`/workspaces/${workspaceId}/leave`, { method: 'POST' });
}

/**
 * PATCH /workspaces/{id}/members/me — { notify_all }. Your own row, so no
 * ownership check: anyone may decide how loud their own phone is.
 */
export async function setWorkspaceNotifyAll(workspaceId, notifyAll) {
  return request(`/workspaces/${workspaceId}/members/me`, {
    method: 'PATCH',
    body: JSON.stringify({ notify_all: notifyAll }),
  });
}

/**
 * POST /workspaces/{id}/invites — owner only. Returns
 * { token, invite_id, expires_at }.
 *
 * THE TOKEN COMES BACK ONCE. Only a hash is stored, so this response is the
 * only place it ever exists readable — show it, let the user copy it, and do
 * not expect to fetch it again.
 */
export async function createWorkspaceInvite(workspaceId) {
  return request(`/workspaces/${workspaceId}/invites`, { method: 'POST' });
}

/**
 * Builds the link to send. The origin is ours, so no server setting decides it.
 *
 * A QUERY PARAMETER, not a path. This app has no router and a path like
 * /invite/<token> would need a Vercel SPA rewrite to serve index.html — one
 * more piece of configuration that is right locally and wrong in production.
 * The app already reads ?view= and ?dev= from the URL and cleans them up with
 * replaceState; this is the same shape.
 */
export function inviteLink(token) {
  return `${window.location.origin}/?invite=${encodeURIComponent(token)}`;
}

/** GET /workspaces/{id}/invites — never includes a token or its hash. */
export async function getWorkspaceInvites(workspaceId) {
  return request(`/workspaces/${workspaceId}/invites`);
}

/** DELETE /workspaces/{id}/invites/{inviteId} — owner only. */
export async function revokeWorkspaceInvite(workspaceId, inviteId) {
  return request(`/workspaces/${workspaceId}/invites/${inviteId}`, { method: 'DELETE' });
}

/**
 * POST /invites/{token}/accept — turns a link into a membership.
 * Returns { status: 'joined' | 'already_member', workspace_id }.
 *
 * 'already_member' is a SUCCESS: somebody tapped the link twice.
 * On failure the error carries .code — invite_used, invite_revoked,
 * invite_expired, workspace_archived, invite_not_found — and .detail, the
 * Greek sentence to show.
 */
export async function acceptWorkspaceInvite(token) {
  return request(`/invites/${token}/accept`, { method: 'POST' });
}

/**
 * POST /workspaces/{id}/archive — owner only. Replaces deleting.
 * Nothing is unlinked: tasks keep their workspace, category and assignee, so
 * restoring brings back the organisation and not just the rows.
 */
export async function archiveWorkspace(workspaceId) {
  return request(`/workspaces/${workspaceId}/archive`, { method: 'POST' });
}

/**
 * GET /workspaces/archived — the owner's own archived workspaces, newest
 * first. Categories come back empty; this list exists to press Restore.
 *
 * Its own call rather than a flag on getWorkspaces: the shared provider holds
 * what every screen filters against, and putting archived rooms in it would
 * mean every consumer had to remember to exclude them.
 */
export async function getArchivedWorkspaces() {
  return request('/workspaces/archived');
}

/** POST /workspaces/{id}/restore — owner only. */
export async function restoreWorkspace(workspaceId) {
  return request(`/workspaces/${workspaceId}/restore`, { method: 'POST' });
}

/**
 * GET /workspaces/{id}/activity — who did what in this room, newest first.
 * A member's right. The server caps limit at 500.
 */
export async function getWorkspaceActivity(workspaceId, limit = 100) {
  return request(`/workspaces/${workspaceId}/activity?limit=${limit}`);
}
