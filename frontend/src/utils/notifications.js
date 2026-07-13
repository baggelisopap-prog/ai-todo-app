/**
 * Thin wrapper around the browser's Web Notifications API.
 * Frontend-only: notifications fire while the tab/browser process is
 * open. This does NOT use a Service Worker or backend push — that's
 * a separate, more complex feature for a future session.
 *
 * Known limitation: iOS Safari does not support the Notification API
 * for regular browser tabs (only for PWAs added to the home screen,
 * iOS 16.4+). This module still works correctly there — isSupported()
 * will simply return false and the UI should explain why.
 */

export function isNotificationSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission() {
  if (!isNotificationSupported()) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

/**
 * Must be called from within a user gesture handler (e.g. a button
 * onClick), or most browsers will silently ignore/block the prompt.
 */
export async function requestNotificationPermission() {
  if (!isNotificationSupported()) return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    return result; // 'granted' | 'denied' | 'default'
  } catch (err) {
    console.error('Notification permission request failed:', err);
    return 'denied';
  }
}

/**
 * Fires a notification immediately if permission is granted.
 * Returns true if it attempted to show, false otherwise.
 */
export function showNotification(title, options = {}) {
  if (!isNotificationSupported()) return false;
  if (Notification.permission !== 'granted') return false;

  try {
    new Notification(title, {
      body: options.body || '',
      icon: options.icon || '/favicon.svg',
      ...options,
    });
    return true;
  } catch (err) {
    console.error('Failed to show notification:', err);
    return false;
  }
}
