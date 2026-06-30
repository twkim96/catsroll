// Client-side ("내 기기 연산") main-page controller — Feature B, steps B-6 + opt-1.
//
// When the toggle is on:
//  - the URL carries compute=client, so the server SKIPS prepare_tracks (even
//    on refresh / direct link) and the browser renders the track instead;
//  - seed form submit, option changes (roll), pick(), in-page track links and
//    popstate are intercepted and rendered locally (TrackData + TrackEngine +
//    TrackRender) with history.pushState.
// With the toggle off, compute=client is removed and the page behaves exactly
// as the server-rendered version.

(function (global) {
  'use strict';

  var KEY = 'bcr_client_compute';
  var doc = global.document;

  function enabled() {
    try { return global.localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }
  function setEnabled(on) {
    try { global.localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
  }

  function intParam(sp, key, dflt) {
    var v = parseInt(sp.get(key), 10);
    return isNaN(v) ? dflt : v;
  }
  function status(text) {
    var el = doc.getElementById('client-compute-status');
    if (el) el.textContent = text;
  }

  // ---- Service Worker (Stage 2): offline support, decoupled from the toggle ----
  var swTried = false;
  function registerSW() {
    if (swTried || !('serviceWorker' in global.navigator)) return;
    swTried = true; // register at most once per page load (no churn on toggling)
    global.navigator.serviceWorker.register('/sw.js').catch(function () {});
  }
  function clearSW() {
    if (!('serviceWorker' in global.navigator)) return Promise.resolve();
    var p = global.navigator.serviceWorker.getRegistrations().then(function (rs) {
      return Promise.all(rs.map(function (r) { return r.unregister(); }));
    });
    if (global.caches) {
      global.caches.keys().then(function (ks) {
        ks.forEach(function (k) { global.caches.delete(k); });
      });
    }
    return p;
  }

  function renderNow(sp) {
    sp = sp || new URLSearchParams(global.location.search);
    var seed = intParam(sp, 'seed', 0);
    if (!seed) { status(''); return Promise.resolve(); }

    var params = {
      event: sp.get('event'), lang: sp.get('lang'), name: sp.get('name'),
      custom: sp.get('custom'), ubers: sp.get('ubers')
    };
    status('');

    return global.TrackData.load(params).then(function (pool) {
      if (!pool || !pool.exist) { status('트랙 데이터 없음'); return; }

      var pos = sp.get('pos') || '1A';
      var out = global.TrackEngine.buildTracks(pool, seed, {
        count: intParam(sp, 'count', 100), position: pos,
        last: intParam(sp, 'last', 0), pick: sp.get('pick') || undefined,
        find: intParam(sp, 'find', 0), guaranteedRolls: pool.guaranteed_rolls
      });
      var ctx = {
        name: intParam(sp, 'name', 0), lang: sp.get('lang') || 'en',
        display: sp.get('display') || 'text', details: sp.get('details') === 'true',
        find: intParam(sp, 'find', 0), pos: pos, count: intParam(sp, 'count', 100),
        seed: seed, path: global.location.pathname, params: sp.toString()
      };
      var html = global.TrackRender.renderTable(out, ctx);
      var foundHtml = global.TrackRender.renderFoundCats(out, ctx);

      var content = doc.getElementById('content');
      if (!content) return;

      // Table: replace the existing one, or append if absent (compute=client).
      var tbl = content.querySelector('.table');
      if (tbl) tbl.outerHTML = html;
      else content.insertAdjacentHTML('beforeend', html);

      // found_cats panel goes right before the table.
      var fc = content.querySelector('.found_cats');
      if (fc) {
        fc.outerHTML = foundHtml;
      } else {
        var tblEl = content.querySelector('.table');
        if (tblEl) tblEl.insertAdjacentHTML('beforebegin', foundHtml);
      }

      status('\u2713');
    }).catch(function (err) {
      status('계산 실패');
    });
  }

  // Build a query string with compute=client guaranteed present.
  function withCompute(sp) {
    sp.set('compute', 'client');
    return sp.toString();
  }

  function navigate(search) {
    var sp = new URLSearchParams(search);
    if (enabled()) sp.set('compute', 'client');
    var qs = sp.toString();
    global.history.pushState(null, '', global.location.pathname + (qs ? '?' + qs : ''));
    renderNow(sp);
  }

  // Region change: full navigation so the server rebuilds the event list.
  // Keep client mode (compute=client) only if the current event exists in the
  // new region; otherwise auto-uncheck and let the server pick a valid event.
  function handleRegionChange(element) {
    var newLang = element.value;
    var sp = new URLSearchParams(global.location.search);
    sp.set('lang', newLang);
    var event = sp.get('event');
    status('지역 변경\u2026');

    global.TrackData.load({
      event: event, lang: newLang, name: sp.get('name'),
      custom: sp.get('custom'), ubers: sp.get('ubers')
    }).then(function (pool) {
      if (pool && pool.exist) {
        sp.set('compute', 'client'); // event valid in new region: stay local
      } else {
        setEnabled(false);           // no data: defer to server, uncheck toggle
        sp.delete('compute');
        sp.delete('event');          // let the server pick the region default
        sp.delete('pick');
      }
    }, function () {
      sp.set('compute', 'client');   // network error: best-effort keep client mode
    }).then(function () {
      global.location.assign(global.location.pathname + '?' + sp.toString());
    });
  }

  function trackSearchFromHref(href) {
    var u;
    try { u = new URL(href, global.location.href); } catch (e) { return null; }
    if (u.origin !== global.location.origin) return null;
    if (u.pathname !== global.location.pathname) return null;
    if (!u.searchParams.get('seed')) return null;
    return u.searchParams.toString();
  }

  function turnOn() {
    setEnabled(true);
    registerSW(); // install once for offline support (kept across toggles)
    // Persist compute=client into the current URL so refresh also skips server.
    var sp = new URLSearchParams(global.location.search);
    sp.set('compute', 'client');
    global.history.replaceState(null, '', global.location.pathname + '?' + sp.toString());
    renderNow(sp);
  }

  function turnOff() {
    setEnabled(false);
    var sp = new URLSearchParams(global.location.search);
    sp.delete('compute');
    var qs = sp.toString();
    // Full load so the server renders the track again.
    global.location.assign(global.location.pathname + (qs ? '?' + qs : ''));
  }

  function init() {
    var toggle = doc.getElementById('client-compute-toggle');
    if (toggle) {
      toggle.checked = enabled();
      toggle.addEventListener('change', function () {
        if (toggle.checked) turnOn(); else turnOff();
      });
    }

    var clear = doc.getElementById('client-compute-clear');
    if (clear) {
      clear.addEventListener('click', function (e) {
        e.preventDefault();
        clearSW().then(function () { status('캐시 제거됨'); });
      });
    }

    // Always install interception; each handler is gated by enabled() at runtime
    // so turning the toggle on takes effect immediately (no reload needed).
    var originalRoll = global.roll;
    var originalPick = global.pick;

    global.roll = function (element) {
      if (!enabled()) return originalRoll && originalRoll(element);
      // Region (lang) change can't be done purely client-side: the event list
      // is region-specific and server-owned. So do a full navigation that lets
      // the server rebuild the event list, keeping client mode only if the
      // current event has data in the new region (else auto-uncheck).
      if (element && element.name === 'lang') return handleRegionChange(element);
      var form = element && element.form;
      navigate(form ? new URLSearchParams(new FormData(form)).toString() : global.location.search);
    };
    global.pick = function (position) {
      if (!enabled()) return originalPick && originalPick(position);
      var sp = new URLSearchParams(global.location.search);
      sp.set('pick', position);
      navigate(sp.toString());
      var anchor = doc.getElementById('N' + String(position).replace(/[RGX]/g, ''));
      if (anchor) anchor.scrollIntoView();
    };

    var form = doc.querySelector('#content form');
    if (form) {
      form.addEventListener('submit', function (e) {
        if (!enabled()) return;
        e.preventDefault();
        navigate(new URLSearchParams(new FormData(form)).toString());
      });
    }

    doc.addEventListener('click', function (e) {
      if (!enabled()) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var content = doc.getElementById('content');
      if (!content || !content.contains(a)) return;
      var search = trackSearchFromHref(a.getAttribute('href'));
      if (search == null) return;
      e.preventDefault();
      navigate(search);
      var hash = a.getAttribute('href').split('#')[1];
      if (hash) { var t = doc.getElementById(hash); if (t) t.scrollIntoView(); }
    });

    global.addEventListener('popstate', function () {
      if (enabled()) renderNow();
    });

    if (enabled()) {
      registerSW(); // returning user with client mode on: ensure SW is present
      // Ensure the URL carries compute=client, then render (the server may have
      // skipped the table already, or we overwrite an identical server render).
      var sp = new URLSearchParams(global.location.search);
      if (sp.get('compute') !== 'client') {
        sp.set('compute', 'client');
        global.history.replaceState(null, '',
          global.location.pathname + '?' + sp.toString());
      }
      renderNow(sp);
    }
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof self !== 'undefined' ? self : this);
