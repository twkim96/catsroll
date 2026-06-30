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

  function cacheKey(params) {
    return [
      'track',
      params.event || '',
      params.lang || '',
      params.custom || '',
      params.ubers || ''
    ].join('|');
  }

  function buildUrl(params) {
    var q = [];
    ['event', 'lang', 'name', 'custom', 'ubers'].forEach(function (k) {
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

  global.TrackData = { load: load, buildUrl: buildUrl };
})(typeof self !== 'undefined' ? self : this);
