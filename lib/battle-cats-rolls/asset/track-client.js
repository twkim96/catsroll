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
  var CLIENT_MAX_COUNT = 9999; // cap local rendering so a huge count can't melt the phone
  var doc = global.document;

  function enabled() {
    try { if (global.localStorage.getItem(KEY) === '1') return true; } catch (e) {}
    // A ?compute=client link must render client-side even in a fresh browser
    // (localStorage off): the server already skipped the table for it.
    try {
      return new URLSearchParams(global.location.search).get('compute') === 'client';
    } catch (e) { return false; }
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

  // Sync the form controls to the current params so the seed box, position,
  // last roll, etc. reflect a local navigation (they aren't re-rendered).
  function syncForm(sp) {
    var form = doc.querySelector('#content form');
    if (!form) return;
    var fields = {
      seed: sp.get('seed'), count: sp.get('count') || '100',
      pos: sp.get('pos') || '1A', last: sp.get('last') || '0',
      event: sp.get('event'), find: sp.get('find') || '',
      ubers: sp.get('ubers') || '0'
    };
    Object.keys(fields).forEach(function (name) {
      var el = form.elements[name];
      if (!el || fields[name] == null) return;
      if (el.type === 'checkbox') el.checked = fields[name] === 'true';
      else el.value = fields[name];
    });
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
    syncForm(sp);
    var seed = intParam(sp, 'seed', 0);
    if (!seed) { status(''); return Promise.resolve(); }

    var params = {
      event: sp.get('event'), lang: sp.get('lang'), name: sp.get('name'),
      custom: sp.get('custom'), ubers: sp.get('ubers'),
      rate: sp.get('rate'), c_rare: sp.get('c_rare'),
      c_supa: sp.get('c_supa'), c_uber: sp.get('c_uber')
    };
    status('');

    return global.TrackData.load(params).then(function (pool) {
      if (!pool || !pool.exist) { status('트랙 데이터 없음'); return; }

      var pos = sp.get('pos') || '1A';
      // Server clamps count to TrackMaxCount (500); client mode has no server
      // limit, so cap it here to avoid rendering a huge table on the phone.
      var count = Math.min(Math.max(intParam(sp, 'count', 100), 1), CLIENT_MAX_COUNT);
      // Mirror route: force_guaranteed overrides the pool's guaranteed_rolls;
      // no_guaranteed excludes guaranteed cats from the find search.
      var forceG = intParam(sp, 'force_guaranteed', 0);
      var guaranteedRolls = forceG > 0 ? forceG : pool.guaranteed_rolls;
      var guaranteed = sp.get('no_guaranteed') !== 'true';
      var out = global.TrackEngine.buildTracks(pool, seed, {
        count: count, position: pos,
        last: intParam(sp, 'last', 0), pick: sp.get('pick') || undefined,
        find: intParam(sp, 'find', 0),
        guaranteedRolls: guaranteedRolls, guaranteed: guaranteed
      });
      var ctx = {
        name: intParam(sp, 'name', 0), lang: sp.get('lang') || 'en',
        display: sp.get('display') || 'text', details: sp.get('details') === 'true',
        find: intParam(sp, 'find', 0), pos: pos, count: count,
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

  // Navigate locally. After the (async) re-render, scroll to the #N anchor if
  // given, otherwise to the top so the new 1A is immediately visible.
  function navigate(search, hash) {
    var sp = new URLSearchParams(search);
    if (enabled()) sp.set('compute', 'client');
    var qs = sp.toString();
    global.history.pushState(null, '', global.location.pathname + (qs ? '?' + qs : ''));
    return renderNow(sp).then(function () {
      if (hash) {
        var t = doc.getElementById(hash);
        if (t) { t.scrollIntoView(); return; }
      }
      global.scrollTo(0, 0);
    });
  }

  // Region change: fetch just the new region's event list (small) and update
  // the dropdown in place, then render locally — no full reload, toggle stays
  // on. Offline / failure: revert the select and keep the current region.
  function optionEl(value, label, chosen) {
    var o = doc.createElement('option');
    o.value = value;
    o.textContent = label;
    if (value === chosen) o.selected = true;
    return o;
  }

  function rebuildEventSelect(sel, ev, chosen) {
    sel.innerHTML = '';
    var up = doc.createElement('optgroup'); up.label = 'Upcoming:';
    ev.upcoming.forEach(function (o) { up.appendChild(optionEl(o.value, o.label, chosen)); });
    sel.appendChild(up);
    var cu = doc.createElement('optgroup'); cu.label = 'Custom:';
    cu.appendChild(optionEl('custom', 'Customize...', chosen));
    sel.appendChild(cu);
    var pa = doc.createElement('optgroup'); pa.label = 'Past:';
    ev.past.forEach(function (o) { pa.appendChild(optionEl(o.value, o.label, chosen)); });
    sel.appendChild(pa);
  }

  function handleRegionChange(element) {
    var newLang = element.value;
    var sp = new URLSearchParams(global.location.search);
    var oldLang = sp.get('lang') || 'en';
    var oldEvent = sp.get('event');
    status('지역 변경\u2026');

    fetch('/events.json?lang=' + encodeURIComponent(newLang), { credentials: 'same-origin' })
      .then(function (res) { if (!res.ok) throw new Error('events ' + res.status); return res.json(); })
      .then(function (ev) {
        var ids = ev.upcoming.concat(ev.past).map(function (o) { return o.value; });
        var chosen = (oldEvent && ids.indexOf(oldEvent) !== -1) ? oldEvent : ev.current;

        var sel = doc.getElementById('event_select');
        if (sel) rebuildEventSelect(sel, ev, chosen);

        sp.set('lang', newLang);
        sp.set('event', chosen);
        sp.set('compute', 'client');
        global.history.pushState(null, '', global.location.pathname + '?' + sp.toString());
        renderNow(sp).then(function () { global.scrollTo(0, 0); });
      })
      .catch(function () {
        // Offline or failed: keep the current region, don't uncheck.
        element.value = oldLang;
        status('오프라인: 지역 변경 불가');
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
        if (global.TrackData && global.TrackData.clear) global.TrackData.clear();
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
      navigate(sp.toString(), 'N' + String(position).replace(/[RGX]/g, ''));
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
      if (!a) return; // not a link: let the cell's inline onclick="pick(...)" run
      var content = doc.getElementById('content');
      if (!content || !content.contains(a)) return;
      var search = trackSearchFromHref(a.getAttribute('href'));
      if (search == null) return; // e.g. /cats stat links: let them navigate
      e.preventDefault();
      // Capture phase + stop propagation so the cell's inline onclick="pick()"
      // does NOT also fire for a link click (that double-fires navigation).
      e.stopPropagation();
      var hash = a.getAttribute('href').split('#')[1];
      navigate(search, hash);
    }, true);

    global.addEventListener('popstate', function () {
      if (enabled()) renderNow();
    });

    // Recent-seeds panel lives outside #content (in <body>), so the capture
    // handler above ignores it. Intercept it in the bubble phase and respect
    // defaultPrevented so its long-press-to-pin still works (that handler runs
    // first and preventDefaults). No stopPropagation: no competing onclick.
    doc.addEventListener('click', function (e) {
      if (!enabled() || e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      var recent = doc.getElementById('recent-seeds');
      if (!recent || !recent.contains(a)) return;
      var search = trackSearchFromHref(a.getAttribute('href'));
      if (search == null) return;
      e.preventDefault();
      navigate(search);
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
