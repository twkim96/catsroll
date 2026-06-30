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

  function renderNow(sp) {
    sp = sp || new URLSearchParams(global.location.search);
    var seed = intParam(sp, 'seed', 0);
    if (!seed) { status(''); return Promise.resolve(); }

    var params = {
      event: sp.get('event'), lang: sp.get('lang'), name: sp.get('name'),
      custom: sp.get('custom'), ubers: sp.get('ubers')
    };
    status('내 기기에서 계산 중\u2026');

    return global.TrackData.load(params).then(function (pool) {
      if (!pool || !pool.exist) { status('이 이벤트는 트랙 데이터가 없어요.'); return; }

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

      status('\u2713 내 기기에서 계산함 (서버 미사용)');
    }).catch(function (err) {
      status('로컬 계산 실패: ' + (err && err.message || err));
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

    // Always install interception; each handler is gated by enabled() at runtime
    // so turning the toggle on takes effect immediately (no reload needed).
    var originalRoll = global.roll;
    var originalPick = global.pick;

    global.roll = function (element) {
      if (!enabled()) return originalRoll && originalRoll(element);
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
