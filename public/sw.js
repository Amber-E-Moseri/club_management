// BLW York Hub Portal — Service Worker
// Strategy: network-first for API/auth, cache-first for static assets

const CACHE_NAME = 'cc-portal-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg',
];

const API_DOMAINS = ['supabase.co', 'supabase.in'];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Non-fatal: first install may not have all assets built yet
      });
    })
  );
  self.skipWaiting();
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip browser extensions
  if (!url.protocol.startsWith('http')) return;

  // Network-first for Supabase API calls
  const isAPI = API_DOMAINS.some((d) => url.hostname.includes(d));
  if (isAPI) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Cache-first for static assets (JS, CSS, images, fonts)
  const isStatic = /\.(js|css|woff2?|png|jpg|jpeg|svg|ico|webp)$/.test(url.pathname);
  if (isStatic) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Network-first with offline fallback for HTML navigation
  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(request));
    return;
  }

  // Default: network-first
  event.respondWith(networkFirst(request));
});

// ─── Strategies ───────────────────────────────────────────────────────────────
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached ?? new Response('Offline', { status: 503 });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function navigationHandler(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    // Offline: serve cached shell
    const cached = await caches.match('/index.html');
    if (cached) return cached;
    return new Response('You are offline. Please reconnect.', {
      headers: { 'Content-Type': 'text/html' },
    });
  }
}

// ─── Background Sync ──────────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-testimonies') {
    event.waitUntil(syncQueuedRequests('testimony-queue'));
  }
});

async function syncQueuedRequests(storeName) {
  // Minimal background sync: retry stored requests from IndexedDB
  // Full implementation requires idb-keyval or similar library
  console.log('[SW] Background sync triggered:', storeName);
}

// ─── Push Notifications ───────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  const data = event.data.json();

  // Build action buttons based on notification type
  const actions = [];
  if (data.type === 'meeting_reminder') {
    actions.push({ action: 'confirm', title: 'Confirm Attendance' });
    actions.push({ action: 'dismiss', title: 'Dismiss' });
  }

  event.waitUntil(
    self.registration.showNotification(data.title ?? 'BLW York Hub', {
      body: data.body ?? '',
      icon: '/icon-192.svg',
      badge: '/icon-192.svg',
      tag: data.tag ?? 'cc-notification',
      renotify: !!data.renotify,
      requireInteraction: data.type === 'meeting_reminder',
      actions,
      data: {
        url: data.url ?? '/',
        type: data.type ?? '',
        id: data.id ?? '',
      },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const { url, type, id } = event.notification.data ?? {};
  const action = event.action;

  // Handle action buttons
  let targetUrl = url ?? '/';
  if (action === 'confirm' && type === 'meeting_reminder' && id) {
    targetUrl = `/meetings?confirm=${id}`;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.startsWith(self.registration.scope));
      if (existing) {
        existing.navigate(targetUrl);
        existing.focus();
      } else {
        self.clients.openWindow(targetUrl);
      }
    })
  );
});
