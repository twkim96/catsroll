// Service Worker for "내 기기 연산" offline support (Feature B, Stage 2).
//
// Strategy: network-first with cache fallback for same-origin GET requests,
// caching successful responses. So:
//  - Online behavior is UNCHANGED (always tries the network first). With a
//    compute=client URL the server already skips prepare_tracks, so refreshes
//    are cheap; the SW does not change that.
//  - After one online visit, the page shell, assets and /track.json are cached,
//    so the track renders OFFLINE (airplane mode / reload) too.
//
// Safety: install-once + kept (registration is decoupled from the toggle, so
// rapid toggling never churns the SW). KILL is a remote off-switch: set it true
// and deploy, and the next activation self-unregisters and clears all caches.

var CACHE = 'bcr-client-v1';
var SHELL = '__bcr_shell__';
var KILL = false;

self.addEventListener('install', function () {
  self.skipWaiting();
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
    throw e;
  }
}

async function networkFirstNav(req) {
  var cache = await caches.open(CACHE);
  try {
    var res = await fetch(req);
    if (res && res.ok) {
      cache.put(req, res.clone());
      cache.put(SHELL, res.clone()); // generic offline fallback shell
    }
    return res;
  } catch (e) {
    return (await cache.match(req)) || (await cache.match(SHELL)) ||
      new Response('Offline', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
  }
}
