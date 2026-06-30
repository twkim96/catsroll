// Service Worker for "내 기기 연산" offline support (Feature B, Stage 2).
//
// Strategy: precache the app shell + core assets on install (the install runs
// online on the first visit, so this is reliable even though the SW does not
// yet control that first page). At runtime, network-first with cache fallback
// for same-origin GETs.
//  - Online behavior is UNCHANGED (always tries the network first). With a
//    compute=client URL the server already skips prepare_tracks.
//  - Offline (reload / airplane mode): navigations fall back to the precached
//    shell ("/"), assets come from the cache (query string ignored so digested
//    URLs still match), and the track renders from cached /track.json (or the
//    in-tab sessionStorage cache).
//
// Safety: install-once + kept (registration is decoupled from the toggle).
// KILL is a remote off-switch: set it true and deploy, and the next activation
// self-unregisters and clears all caches.

var CACHE = 'bcr-client-v3';
var SHELL = '__bcr_shell__';
var KILL = false;

var PRECACHE = [
  '/',
  '/asset/style/tacit.css',
  '/asset/recent-seeds.js',
  '/asset/track-compare.js',
  '/asset/track-data.js',
  '/asset/track-engine.js',
  '/asset/track-render.js',
  '/asset/track-client.js'
];

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil((async function () {
    var cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async function (url) {
      try {
        var res = await fetch(url, { cache: 'no-cache' });
        if (res && res.ok) {
          await cache.put(url, res.clone());
          if (url === '/') await cache.put(SHELL, res.clone());
        }
      } catch (e) { /* best-effort precache */ }
    }));
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    if (KILL) {
      var all = await caches.keys();
      await Promise.all(all.map(function (k) { return caches.delete(k); }));
      await self.registration.unregister();
      return;
    }
    var keys = await caches.keys();
    await Promise.all(keys
      .filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || KILL) return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(networkFirstNav(req));
  } else {
    event.respondWith(networkFirst(req));
  }
});

async function networkFirst(req) {
  var cache = await caches.open(CACHE);
  try {
    var res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    var cached = await cache.match(req);
    if (cached) return cached;
    // Query-insensitive fallback only for static assets (query = cache-busting
    // digest). NEVER for /track.json etc. where the query is semantic.
    if (new URL(req.url).pathname.indexOf('/asset/') === 0) {
      var loose = await cache.match(req, { ignoreSearch: true });
      if (loose) return loose;
    }
    throw e;
  }
}

async function networkFirstNav(req) {
  var cache = await caches.open(CACHE);
  try {
    var res = await fetch(req);
    if (res && res.ok) {
      cache.put(req, res.clone());
      // Only the home page is a valid generic offline shell (not /cats/... etc.).
      if (new URL(req.url).pathname === '/') cache.put(SHELL, res.clone());
    }
    return res;
  } catch (e) {
    return (await cache.match(req)) ||
      (await cache.match(SHELL)) ||
      (await cache.match('/')) ||
      new Response('Offline', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
  }
}
