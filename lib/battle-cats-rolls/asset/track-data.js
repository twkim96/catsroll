// Client-side ("내 기기 연산") track data loader — Feature B, step B-1.
//
// Fetches the read-only pool JSON (/track.json) for an event/lang and caches it
// so subsequent local rolling/rendering needs no further server round-trips.
// This is the data layer only; rolling (B-2) and rendering (B-4) build on it.
//
// Cache: sessionStorage keyed by event+lang (pool data is static per event).
//
// Usage:
//   TrackData.load({ event, lang, name, custom, ubers })
//     -> Promise(pool)   // pool: { exist, version, rates, base,
//                        //         guaranteed_rolls, slots, cats }

(function (global) {
  'use strict';

  var memory = {};

  function present(v) { return (v != null && v !== '') ? String(v) : undefined; }

  // Normalize params so equivalent requests share a cache key / URL. ubers=0
  // (always sent by the form) is treated as empty. Custom-gacha rate params
  // (rate/c_rare/c_supa/c_uber) are included so custom-rate tracks don't fall
  // back to default rates.
  function normalize(params) {
    params = params || {};
    var ubers = (params.ubers != null && String(params.ubers) !== '0')
      ? String(params.ubers) : undefined;
    return {
      event: params.event || undefined,
      lang: params.lang || undefined,
      name: params.name,
      custom: params.custom || undefined,
      ubers: ubers,
      rate: present(params.rate),
      c_rare: present(params.c_rare),
      c_supa: present(params.c_supa),
      c_uber: present(params.c_uber)
    };
  }

  function cacheKey(params) {
    return [
      'track',
      params.event || '', params.lang || '', params.custom || '',
      params.ubers || '', params.rate || '',
      params.c_rare || '', params.c_supa || '', params.c_uber || ''
    ].join('|');
  }

  function buildUrl(params) {
    var q = [];
    ['event', 'lang', 'name', 'custom', 'ubers',
     'rate', 'c_rare', 'c_supa', 'c_uber'].forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
        q.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
      }
    });
    return '/track.json' + (q.length ? '?' + q.join('&') : '');
  }

  function readSession(key) {
    try {
      var raw = global.sessionStorage && global.sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeSession(key, value) {
    try {
      if (global.sessionStorage) {
        global.sessionStorage.setItem(key, JSON.stringify(value));
      }
    } catch (e) {
      // sessionStorage full or unavailable: ignore, memory cache still works.
    }
  }

  function load(params) {
    params = normalize(params);
    var key = cacheKey(params);

    if (memory[key]) return Promise.resolve(memory[key]);

    var cached = readSession(key);
    if (cached) {
      memory[key] = cached;
      return Promise.resolve(cached);
    }

    return fetch(buildUrl(params), { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('track.json HTTP ' + res.status);
        return res.json();
      })
      .then(function (pool) {
        memory[key] = pool;
        writeSession(key, pool);
        return pool;
      });
  }

  // Clear cached pools (memory + sessionStorage 'track|' keys) so [캐시 제거]
  // doesn't leave a stale pool in use within the same tab.
  function clear() {
    memory = {};
    try {
      var ss = global.sessionStorage;
      if (ss) {
        var keys = [];
        for (var i = 0; i < ss.length; i++) {
          var k = ss.key(i);
          if (k && k.indexOf('track|') === 0) keys.push(k);
        }
        keys.forEach(function (k) { ss.removeItem(k); });
      }
    } catch (e) { /* ignore */ }
  }

  global.TrackData = { load: load, buildUrl: buildUrl, clear: clear };
})(typeof self !== 'undefined' ? self : this);
