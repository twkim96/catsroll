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
  var CLIENT_MAX_COUNT = 999;
  var doc = global.document;
  var renderGeneration = 0;
  var rendering = false;
  var formDirty = false;
  var pendingRegion = null;

  function cancelPendingRegion() {
    if (!pendingRegion) return;
    pendingRegion.element.value = pendingRegion.oldLang;
    pendingRegion = null;
  }

  function discardTracks() {
    var content = doc.getElementById('content');
    if (!content) return;
    content.querySelectorAll('.table, .found_cats, .multi_track_prompt').forEach(function (node) { node.remove(); });
  }

  function beginRender() {
    cancelPendingRegion();
    rendering = true;
    discardTracks();
    status('불러오는 중…');
    return ++renderGeneration;
  }

  function currentRender(generation) {
    return generation === renderGeneration && enabled();
  }

  function finishRender(generation, text) {
    if (!currentRender(generation)) return false;
    rendering = false;
    status(text);
    return true;
  }

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
  // options, etc. reflect a local navigation / popstate (they aren't
  // re-rendered). Covers every form-backed track param so a later submit
  // can't reintroduce stale options.
  function syncForm(sp) {
    var form = doc.querySelector('#content form');
    if (!form) return;

    // value fields; a few get a default when the param is absent
    var values = {
      seed: sp.get('seed'), count: sp.get('count') || '100',
      pos: sp.get('pos') || '1A', last: sp.get('last') || '0',
      event: sp.get('event'), find: sp.get('find') || '',
      ubers: sp.get('ubers') || '0', force_guaranteed: sp.get('force_guaranteed') || '',
      rate: sp.get('rate'), c_rare: sp.get('c_rare'),
      c_supa: sp.get('c_supa'), c_uber: sp.get('c_uber'),
      name: sp.get('name'), display: sp.get('display'), lang: sp.get('lang'),
      highlighting: sp.get('highlighting') || 'basic'
    };
    Object.keys(values).forEach(function (n) {
      var el = form.elements[n];
      if (el && values[n] != null) el.value = values[n];
    });

    // boolean 'true' checkboxes (absence = unchecked)
    ['details', 'no_guaranteed'].forEach(function (n) {
      var el = form.elements[n];
      if (el) el.checked = sp.get(n) === 'true';
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
    var tasks = [];
    if ('serviceWorker' in global.navigator) {
      tasks.push(global.navigator.serviceWorker.getRegistrations().then(function (rs) {
        return Promise.all(rs.map(function (r) { return r.unregister(); }));
      }));
    }
    if (global.caches) {
      tasks.push(global.caches.keys().then(function (ks) {
        return Promise.all(ks.map(function (k) { return global.caches.delete(k); }));
      }));
    }
    return Promise.all(tasks);
  }

  function renderNow(sp, generation) {
    generation = generation == null ? beginRender() : generation;
    if (!currentRender(generation)) return Promise.resolve(false);
    sp = new URLSearchParams(sp || global.location.search);
    var count = Math.min(Math.max(intParam(sp, 'count', 100), 1), CLIENT_MAX_COUNT);
    if (sp.has('count') && sp.get('count') !== String(count)) {
      sp.set('count', count);
      global.history.replaceState(null, '',
        global.location.pathname + '?' + sp.toString() + global.location.hash);
    }
    syncForm(sp);
    formDirty = false;
    var unknownNotice = doc.getElementById('last-unknown-notice');
    if (unknownNotice) unknownNotice.hidden = !sp.has('last_unknown');
    if (sp.has('last_unknown')) {
      var lastSelect = doc.getElementById('last_select');
      if (lastSelect) lastSelect.value = '';
      finishRender(generation, 'Last roll을 확인해 주세요.');
      return Promise.resolve(false);
    }
    var seed = intParam(sp, 'seed', 0);
    if (!seed) { finishRender(generation, ''); return Promise.resolve(false); }

    var params = {
      event: sp.get('event'), lang: sp.get('lang'), name: sp.get('name'),
      custom: sp.get('custom'), ubers: sp.get('ubers'),
      rate: sp.get('rate'), c_rare: sp.get('c_rare'),
      c_supa: sp.get('c_supa'), c_uber: sp.get('c_uber')
    };
    return global.TrackData.load(params).then(function (pool) {
      if (!currentRender(generation)) return false;
      if (!pool || !pool.exist) { finishRender(generation, '트랙 데이터 없음'); return false; }

      var pos = sp.get('pos') || '1A';
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
        seed: seed, path: global.location.pathname, params: sp.toString(),
        highlighting: sp.get('highlighting') || 'basic', platinum: !!pool.platinum,
        owned: sp.getAll('t').map(function (id) { return parseInt(id, 10); })
      };
      var html = global.TrackRender.renderTable(out, ctx);
      var foundHtml = global.TrackRender.renderFoundCats(out, ctx);
      if (!currentRender(generation)) return false;

      var content = doc.getElementById('content');
      if (!content) return false;

      // Keep the server's usage notes below the table after a local rerender.
      var tbl = content.querySelector('.table');
      if (tbl) tbl.outerHTML = html;
      else {
        var notes = content.querySelector('.note');
        if (notes) notes.insertAdjacentHTML('beforebegin', html);
        else content.insertAdjacentHTML('beforeend', html);
      }

      // found_cats panel goes right before the table.
      var fc = content.querySelector('.found_cats');
      if (fc) {
        fc.outerHTML = foundHtml;
      } else {
        var tblEl = content.querySelector('.table');
        if (tblEl) tblEl.insertAdjacentHTML('beforebegin', foundHtml);
      }

      // A direct client-mode page starts with the server's introduction.
      // Replace it only after successfully inserting a calculated result.
      var introduction = content.querySelector(':scope > p.section');
      if (introduction) {
        var help = introduction.nextElementSibling;
        if (help && help.matches('p') && help.querySelector('a[href*="/help"]')) {
          help.remove();
        }
        introduction.remove();
      }

      return finishRender(generation, '\u2713');
    }).catch(function (err) {
      finishRender(generation, '계산 실패');
      return false;
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
    var previousParams = new URLSearchParams(global.location.search);
    var previousSeed = previousParams.get('seed');
    global.history.pushState(null, '', global.location.pathname + (qs ? '?' + qs : ''));
    var nextSeed = sp.get('seed');
    if (nextSeed !== previousSeed || sp.get('last') !== previousParams.get('last')) {
      global.dispatchEvent(new global.CustomEvent('catsroll:track-seed-change', {
        detail: {seed: nextSeed, last: intParam(sp, 'last', 0)}
      }));
    }
    return renderNow(sp).then(function (applied) {
      if (!applied) return;
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
    var generation = beginRender();
    var sp = new URLSearchParams(global.location.search);
    var oldLang = sp.get('lang') || 'en';
    var oldEvent = sp.get('event');
    element.value = newLang;
    pendingRegion = {element: element, oldLang: oldLang};
    status('지역 변경\u2026');

    fetch('/events.json?lang=' + encodeURIComponent(newLang), { credentials: 'same-origin' })
      .then(function (res) { if (!res.ok) throw new Error('events ' + res.status); return res.json(); })
      .then(function (ev) {
        if (!currentRender(generation)) return;
        pendingRegion = null;
        var ids = ev.upcoming.concat(ev.past).map(function (o) { return o.value; });
        var chosen = (oldEvent && ids.indexOf(oldEvent) !== -1) ? oldEvent : ev.current;

        var sel = doc.getElementById('event_select');
        if (sel) rebuildEventSelect(sel, ev, chosen);

        sp.set('lang', newLang);
        sp.set('event', chosen);
        sp.set('compute', 'client');
        global.history.pushState(null, '', global.location.pathname + '?' + sp.toString());
        return renderNow(sp, generation).then(function (applied) {
          if (applied) global.scrollTo(0, 0);
        });
      })
      .catch(function () {
        if (!currentRender(generation)) return;
        pendingRegion = null;
        // Offline or failed: keep the current region, don't uncheck.
        element.value = oldLang;
        finishRender(generation, '오프라인: 지역 변경 불가');
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
    ++renderGeneration;
    rendering = false;
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

    function needsLastConfirmation() {
      var last = doc.getElementById('last_select');
      return new URLSearchParams(global.location.search).has('last_unknown') &&
        (!last || last.value === '');
    }

    global.roll = function (element) {
      if (needsLastConfirmation()) return;
      if (!enabled()) return originalRoll && originalRoll(element);
      var form = element && element.form;
      if (!element || element.name !== 'lang') cancelPendingRegion();
      // Banner/series menus are server-owned. Rebuild them when their filters
      // change, preserving client-side track calculation after navigation.
      if (element && form && (element.name === 'text_bg' ||
          element.name === 'banner' || (element.name === 'lang' &&
            (form.querySelector('input[name="event_series"]') ||
              (form.elements.banner && form.elements.banner.value))))) {
        ++renderGeneration;
        discardTracks();
        var visualParams = new URLSearchParams(new FormData(form));
        visualParams.set('compute', 'client');
        return global.location.assign(global.location.pathname + '?' + visualParams.toString());
      }
      if (element && element.name === 'lang') return handleRegionChange(element);
      navigate(form ? new URLSearchParams(new FormData(form)).toString() : global.location.search);
    };
    global.pick = function (position) {
      if (!enabled()) return originalPick && originalPick(position);
      if (rendering) return;
      var sp = new URLSearchParams(global.location.search);
      sp.set('pick', position);
      navigate(sp.toString(), 'N' + String(position).replace(/[RGX]/g, ''));
    };

    var form = doc.querySelector('#content form');
    if (form) {
      form.addEventListener('input', function (event) {
        if (!enabled()) return;
        // The change handler owns the region/list pair. A select emits input
        // before change; don't cancel a newer region selection here.
        if (event.target.name === 'lang') return;
        cancelPendingRegion();
        formDirty = true;
        ++renderGeneration;
        rendering = true;
        discardTracks();
        status('입력이 바뀌었습니다. Roll을 눌러 다시 계산하세요.');
      });
      form.addEventListener('submit', function (e) {
        if (needsLastConfirmation()) { e.preventDefault(); return; }
        if (!enabled()) return;
        e.preventDefault();
        cancelPendingRegion();
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
    global.addEventListener('pagehide', function () {
      cancelPendingRegion();
      ++renderGeneration;
      rendering = false;
    });
    global.addEventListener('pageshow', function (event) {
      if (!event.persisted || !enabled()) return;
      if (formDirty) {
        rendering = true;
        discardTracks();
        status('입력이 바뀌었습니다. Roll을 눌러 다시 계산하세요.');
      } else renderNow();
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
      if (new URL(a.href).searchParams.has('last_unknown')) return;
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
