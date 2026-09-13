/* ═══════════════════════════════════════════════════════════════
   SW.JS — Abhyas  Service Worker
   Strategy:
   • Admin panel      → NEVER intercepted. Always live network.
   • index.html/shell → network-first, cache-bypass (no-store) so a
                         live connection is never shadowed by a stale
                         copy. Falls back to the last cached copy ONLY
                         when the network genuinely fails — that cached
                         index.html still boots normally and its own
                         resumeUserSession() logic decides whether a
                         permanent/trial user can proceed straight in,
                         or whether to show the login screen.
   • API/getFile      → network-first. Plain API calls (login, checkSession,
                         etc.) get a generic offline JSON fallback and are
                         never cached — most of them aren't safe to serve
                         stale. `action=getFile` responses (the actual
                         question-set JSON) ARE cached in Cache Storage as
                         a second offline layer alongside app.js's own
                         localStorage cache — Cache Storage's quota is far
                         higher than localStorage's ~5-10MB.
   • Stale clearance  → whenever we're confirmed online again, purge
                         any cached entries that aren't part of the
                         current SHELL, so a reconnect never leaves old
                         orphaned responses sitting in Cache Storage.
   ═══════════════════════════════════════════════════════════════ */

/* 👇 CACHE_NAME is derived from version.js's APP_VERSION, so bumping
   APP_VERSION there is now the ONLY step needed to force every open
   browser tab to drop its old cached shell on the next activation —
   no separate manual cache-name edit here. Still bump APP_VERSION for
   ANY shell change (index.html, user.html, app.js, chapters-data.js,
   shared.js, manifest.json, or the vendor/ assets), not just version
   releases — a cache-relevant file change with no version bump would
   otherwise never get picked up by an already-installed client. */
importScripts('./version.js');
const CACHE_NAME = 'abhyas-v' + APP_VERSION;

/* ── PUSH NOTIFICATIONS (Firebase Cloud Messaging) ──────────────────
   Wrapped in try/catch: these are remote CDN scripts, not part of our
   own SHELL, so a network hiccup during SW install/activation must
   never break offline caching (this SW's actual job) just because push
   notifications couldn't initialize. If firebase-config.js still has
   its placeholder values (FIREBASE_CONFIGURED === false — see that
   file), this deliberately skips initializing Firebase at all, rather
   than letting it throw on a fake API key. */
let _fcmMessaging = null;
try {
  importScripts(
    './firebase-config.js',
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js'
  );
  if (typeof FIREBASE_CONFIGURED !== 'undefined' && FIREBASE_CONFIGURED) {
    firebase.initializeApp(FIREBASE_CONFIG);
    _fcmMessaging = firebase.messaging();
  }
} catch (err) {
  console.warn('SW: push notifications unavailable (not configured yet, or offline during install)', err);
}

// Fires when a push arrives while no Abhyas tab is focused — Firebase's
// SDK handles the actual push-event parsing; this just decides how to
// display it. Tapping it is handled by the existing 'notificationclick'
// listener further down (already built for timetable reminders — reused
// as-is here, no changes needed there).
if (_fcmMessaging) {
  _fcmMessaging.onBackgroundMessage(payload => {
    const title = (payload.notification && payload.notification.title) || 'Abhyas';
    const body = (payload.notification && payload.notification.body) || '';
    self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png'
    });
  });
}

const SHELL = [
  './',
  './index.html',
  './user.html',
  './app.js',
  './version.js',
  './firebase-config.js',
  './chapters-data.js',
  './shared.js',
  './cloud-sync.js',
  './design-system.css',
  './manifest.json',
  './vendor/phosphor/phosphor-regular.css',
  './vendor/phosphor/Phosphor.woff2',
  // v1.04 — Google Identity Services client. Precached so the Personal
  // Drive Backup card's "Sign in with Google" button still works when
  // the user opens Progress while offline: CLOUD._waitForGsi() polls
  // for window.google.accounts.oauth2 and would otherwise time out
  // after 20s with "Google Identity Services didn't load".
  //
  // NOTE: this is a cross-origin URL, so addAll() may fail it
  // silently (opaque response). That's fine — the fetch handler's
  // network-first path caches it on the next online request anyway,
  // and a miss here is non-fatal for the SW install.
  'https://accounts.google.com/gsi/client'
  // NOTE: admin.html is deliberately NOT in SHELL — it must never be
  // served from cache.
];

/* Is this request/page the admin panel? */
async function isAdminOrigin(request, clientId) {
  const url = new URL(request.url);
  if (url.pathname.endsWith('admin.html')) return true;
  if (!clientId) return false;
  try {
    const client = await self.clients.get(clientId);
    return !!(client && client.url && client.url.includes('admin.html'));
  } catch (e) { return false; }
}

/* ----- INSTALL: precache the shell and skip waiting (activate immediately) ----- */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(SHELL))
      .catch(err => console.warn('SW install: some shell files could not be cached', err))
  );
  self.skipWaiting();  // ← immediate activation, no old SW left behind
});

/* ----- ACTIVATE: delete all old caches, claim all clients, and tell
   every open tab the new SW is now in control. That notification is
   what lets app.js surface a "reload to update" toast — the SW itself
   can activate mid-session (skipWaiting + clients.claim below), but the
   PAGE keeps executing the OLD JavaScript until it reloads, which is
   invisible to the user without this nudge. ── */
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => {
      try {
        client.postMessage({ type: 'SW_ACTIVATED', version: APP_VERSION });
      } catch (e) { /* client may be closing */ }
    });
  })());
});

/* Remove any cached shell entries that aren't in the current SHELL list */
async function clearStaleShellEntries() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  const shellAbs = new Set(SHELL.map(p => new URL(p, self.registration.scope).href));
  await Promise.all(keys.map(req => {
    const url = new URL(req.url);
    const isApi = url.hostname.includes('script.google.com'); // keep getFile responses
    if (isApi) return Promise.resolve();
    if (!shellAbs.has(req.url)) {
      return cache.delete(req);
    }
    return Promise.resolve();
  }));
}

/* Listen for clear‑stale message from index.html / app.js (optional) */
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'CLEAR_STALE_IF_ONLINE') {
    e.waitUntil ? e.waitUntil(clearStaleShellEntries()) : clearStaleShellEntries();
  }
});

/* Tapping a timetable reminder focuses an already-open Abhyas tab if
   there is one, otherwise opens user.html in a new one. */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if (client.url.includes('user.html') && 'focus' in client) return client.focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow('./user.html');
  })());
});

/* ----- FETCH: network-first with cache fallback, admin bypassed ----- */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  e.respondWith((async () => {
    const fromAdmin = await isAdminOrigin(e.request, e.clientId);

    /* ── ADMIN: bypass the service worker entirely ── */
    if (fromAdmin) return fetch(e.request);

    /* ── API calls: network-first ── */
    if (url.hostname.includes('script.google.com')) {
      const isGetFile = (url.searchParams.get('action') || '').toLowerCase() === 'getfile';
      try {
        const res = await fetch(e.request.clone());
        if (isGetFile && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        // v1.04 — deliberately NO clearStaleShellEntries() call here.
        // It used to fire on every getFile fetch (a full cache-key scan
        // per question-file request, so ~200 scans during a first-time
        // CACHE.autoSync of the whole library). The message-triggered
        // path above is the only place stale entries can actually
        // accumulate — index.html posts CLEAR_STALE_IF_ONLINE on every
        // reconnect — so the hot-path call was pure redundancy with a
        // real cost.
        return res;
      } catch (err) {
        if (isGetFile) {
          const cached = await caches.match(e.request);
          if (cached) return cached;
        }
        // Don’t fabricate a fake response — let the page handle the error.
        throw err;
      }
    }

    /* ── App shell: network-first with cache fallback ── */
    try {
      const res = await fetch(e.request.clone(), { cache: 'no-store' });
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    } catch (err) {
      const cached = await caches.match(e.request);
      return cached || new Response('Offline', { status: 503 });
    }
  })());
});