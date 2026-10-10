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
    // task_id: the task this push is about, when it is about one — the tap
    // opens its sheet (2026-10-10). Absent on the daily summary.
    data: { view: data.view || 'today', taskId: data.task_id || null },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetView = event.notification.data?.view || 'today';
  const taskId = event.notification.data?.taskId || null;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'NAVIGATE', view: targetView, taskId });
          return;
        }
      }
      if (clients.openWindow) {
        const task = taskId ? `&task=${encodeURIComponent(taskId)}` : '';
        return clients.openWindow(`/?view=${targetView}${task}`);
      }
    })
  );
});
