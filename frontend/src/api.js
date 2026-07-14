// Centralized API client. All backend HTTP calls go through this file.
// If the backend URL or auth requirements change, update here only.

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

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
    response = await fetch(url, config);
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
    response = await fetch(`${API_BASE_URL}/extract-voice`, {
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
export async function extractTasksFromImage(imageBlob) {
  const formData = new FormData();
  const extension = imageBlob.type.split('/')[1]?.split(';')[0] || 'jpg';
  formData.append('image', imageBlob, `photo.${extension}`);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/extract-image`, {
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
 * DELETE /tasks/{record_id} — permanently delete a task.
 * Returns void on success (204 No Content).
 */
export async function deleteTask(recordId) {
  const response = await fetch(`${API_BASE_URL}/tasks/${recordId}`, {
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