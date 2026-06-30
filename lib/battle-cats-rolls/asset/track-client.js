// Client-side ("내 기기 연산") main-page controller — Feature B, step B-6.
//
// When the toggle is on, track navigation (seed/pos/pick/option changes and
// track links) is computed and rendered in the browser via TrackData (fetch
// /track.json) + TrackEngine (roll) + TrackRender (table), updating the page
// in place with history.pushState. The server track route/render is never
// touched; with the toggle off, the page behaves exactly as before.

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

  // Build the track and render it into #content, replacing any existing .table.
  function renderNow(sp) {
    sp = sp || new URLSearchParams(global.location.search);
    var seed = intParam(sp, 'seed', 0);
    if (!seed) return Promise.resolve(); // nothing to render without a seed

    var params = {
      event: sp.get('event'), lang: sp.get('lang'), name: sp.get('name'),
      custom: sp.get('custom'), ubers: sp.get('ubers')
    };

    status('내 기기에서 계산 중\u2026');

    return global.TrackData.load(params).then(function (pool) {
      if (!pool || !pool.exist) { status('이 이벤트는 트랙 데이터가 없어요.'); return; }

      var pos = sp.get('pos') || '1A';
      var out = global.TrackEngine.buildTracks(pool, seed, {
        count: intParam(sp, 'count', 100),
        position: pos,
        last: intParam(sp, 'last', 0),
        pick: sp.get('pick') || undefined,
        find: intParam(sp, 'find', 0),
        guaranteedRolls: pool.guaranteed_rolls
      });

      var html = global.TrackRender.renderTable(out, {
        name: intParam(sp, 'name', 0),
        lang: sp.get('lang') || 'en',
        display: sp.get('display') || 'text',
        details: sp.get('details') === 'true',
        find: intParam(sp, 'find', 0),
        pos: pos,
        count: intParam(sp, 'count', 100),
        seed: seed,
        path: global.location.pathname,
        params: sp.toString()
      });

      var content = doc.getElementById('content');
      var existing = content && content.querySelector('.table');
      if (existing) {
        existing.outerHTML = html;
      } else if (content) {
        content.insertAdjacentHTML('beforeend', html);
      }
      status('\u2713 내 기기에서 계산함');
    }).catch(function (err) {
      status('로컬 계산 실패: ' + (err && err.message || err));
    });
  }

  function navigate(search) {
    var url = global.location.pathname + (search ? '?' + search : '');
    global.history.pushState(null, '', url);
    renderNow(new URLSearchParams(search));
  }

  // Resolve a track-navigation link to its query string, or null if it's not
  // a same-page track link (e.g. /cats/<id> stat links navigate normally).
  function trackSearchFromHref(href) {
    var u;
    try { u = new URL(href, global.location.href); } catch (e) { return null; }
    if (u.origin !== global.location.origin) return null;
    if (u.pathname !== global.location.pathname) return null;
    if (!u.searchParams.get('seed')) return null;
    return u.searchParams.toString();
  }

  function init() {
    var toggle = doc.getElementById('client-compute-toggle');
    if (toggle) {
      toggle.checked = enabled();
      toggle.addEventListener('change', function () {
        setEnabled(toggle.checked);
        if (toggle.checked) {
          renderNow();
        } else {
          global.location.reload(); // back to the server-rendered track
        }
      });
    }

    if (!enabled()) return;

    // Override the inline roll()/pick() (defined in layout) for local rendering.
    var originalRoll = global.roll;
    var originalPick = global.pick;

    global.roll = function (element) {
      if (!enabled()) return originalRoll && originalRoll(element);
      var form = element && element.form;
      if (!form) return renderNow();
      var sp = new URLSearchParams(new FormData(form));
      navigate(sp.toString());
    };

    global.pick = function (position) {
      if (!enabled()) return originalPick && originalPick(position);
      var sp = new URLSearchParams(global.location.search);
      sp.set('pick', position);
      navigate(sp.toString());
      var anchor = doc.getElementById('N' + String(position).replace(/[RGX]/g, ''));
      if (anchor) anchor.scrollIntoView();
    };

    // Intercept clicks on same-page track links (roll links, No. cells, backtrack).
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

    global.addEventListener('popstate', function () { renderNow(); });

    // Seamlessly re-render on load (identical to the server output, verified).
    renderNow();
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof self !== 'undefined' ? self : this);
