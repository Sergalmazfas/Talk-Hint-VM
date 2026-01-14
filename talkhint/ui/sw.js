// TalkHint Service Worker for Push Notifications
// VERSION: 2.0.0 - Update this to trigger cache refresh

const SW_VERSION = '2.0.0';
const CACHE_NAME = 'talkhint-v2';

// Install event - immediately take over
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker v' + SW_VERSION);
  self.skipWaiting();
});

// Activate event - clean old caches and claim clients
self.addEventListener('activate', (event) => {
  console.log('[SW] Service worker v' + SW_VERSION + ' activated');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Message handler for update checks
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: SW_VERSION });
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Push notification event
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');
  
  let data = {
    title: 'TalkHint',
    body: 'You have a notification',
    icon: '/app/icon-192.png',
    badge: '/app/badge-72.png',
    data: {}
  };
  
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      console.error('[SW] Error parsing push data:', e);
    }
  }
  
  const options = {
    body: data.body,
    icon: data.icon || '/app/icon-192.png',
    badge: data.badge || '/app/badge-72.png',
    vibrate: [200, 100, 200, 100, 200],
    tag: data.tag || 'talkhint-notification',
    requireInteraction: data.requireInteraction !== false,
    data: data.data || {},
    actions: data.data?.type === 'incoming_call' ? [
      { action: 'accept', title: 'Accept' },
      { action: 'reject', title: 'Reject' }
    ] : []
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event.action);
  event.notification.close();
  
  const notificationData = event.notification.data || {};
  const callSid = notificationData.callSid;
  
  // Handle action buttons
  if (event.action === 'accept' && callSid) {
    // Call accept API
    fetch('/api/call/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callSid }),
      credentials: 'include'
    }).catch(err => console.error('[SW] Accept failed:', err));
  } else if (event.action === 'reject' && callSid) {
    // Call reject API
    fetch('/api/call/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callSid }),
      credentials: 'include'
    }).catch(err => console.error('[SW] Reject failed:', err));
    return;
  }
  
  // Open or focus the app - include callSid in URL for new windows
  let urlToOpen = notificationData.url || '/app';
  if (callSid) {
    urlToOpen = '/app?callSid=' + encodeURIComponent(callSid) + '&from=' + encodeURIComponent(notificationData.fromNumber || '');
  }
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if there's already a window open
        for (const client of clientList) {
          if (client.url.includes('/app') && 'focus' in client) {
            // Send message to existing client about incoming call
            client.postMessage({
              type: 'INCOMING_CALL',
              callSid: callSid,
              fromNumber: notificationData.fromNumber
            });
            return client.focus();
          }
        }
        // Open new window if none exists - with callSid in URL
        if (self.clients.openWindow) {
          return self.clients.openWindow(urlToOpen);
        }
      })
  );
});

// Handle messages from the main app
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
