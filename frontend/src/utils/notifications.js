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
 * Uses the Service Worker's registration.showNotification() when
 * available (required on Android Chrome), falling back to the direct
 * Notification constructor for browsers without Service Worker support.
 * Returns a Promise<boolean> — true if it attempted to show, false otherwise.
 */
export async function showNotification(title, options = {}) {
  if (!isNotificationSupported()) return false;
  if (Notification.permission !== 'granted') return false;

  const notificationOptions = {
    body: options.body || '',
    icon: options.icon || '/favicon.svg',
    ...options,
  };

  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, notificationOptions);
      return true;
    }
    // Fallback for browsers without Service Worker support at all
    new Notification(title, notificationOptions);
    return true;
  } catch (err) {
    console.error('Failed to show notification via service worker:', err);
    // Last-resort fallback attempt with the direct constructor
    try {
      new Notification(title, notificationOptions);
      return true;
    } catch (err2) {
      console.error('Fallback notification also failed:', err2);
      return false;
    }
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Subscribes this browser installation to push notifications.
 * Returns the existing subscription if already subscribed, or creates
 * a new one. Returns null if push isn't supported or permission isn't granted.
 */
export async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  if (Notification.permission !== 'granted') return null;

  const registration = await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    console.error('VITE_VAPID_PUBLIC_KEY is not set');
    return null;
  }

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
}
