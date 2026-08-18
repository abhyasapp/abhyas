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

/* 👇 Bump this name whenever you update any shell file (index.html,
   user.html, app.js, chapters-data.js, shared.js, manifest.json, or the
   vendor/ assets). All previous caches will be deleted immediately on
   activation. */
const CACHE_NAME = 'abhyas-v3';   // bumped: self-hosted Phosphor icon font added to the shell

const SHELL = [
  './',
  './index.html',
  './user.html',
  './app.js',
  './chapters-data.js',
  './shared.js',
  './manifest.json',
  './vendor/phosphor/phosphor-regular.css',
  './vendor/phosphor/Phosphor.woff2'
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

/* ----- ACTIVATE: delete all old caches and claim all clients ----- */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();  // ← take control of every open tab/pwa instantly
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
        clearStaleShellEntries();
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
