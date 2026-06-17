// Centralized API client. All backend HTTP calls go through this file.
// If the backend URL or auth requirements change, update here only.

const API_BASE_URL = 'http://localhost:8000';

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
 * PATCH /tasks/{record_id} — updates specific fields of a task.
 * Returns the updated task object.
 */
export async function updateTask(recordId, updates) {
  return request(`/tasks/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}