// Minimal service worker whose ONLY purpose is to unlock
// registration.showNotification() for local (non-push) notifications
// on browsers (notably Android Chrome) that require it.
//
// This service worker does NOT handle push events, does NOT intercept
// fetch requests, and does NOT cache anything. It exists purely so the
// Notifications API works consistently across platforms.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { title: 'Reminder', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Reminder';
  const options = {
    body: data.body || '',
    icon: '/favicon.svg',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});
