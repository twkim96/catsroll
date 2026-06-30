// Client-side ("내 기기 연산") seed seeking controller.
//
// Stage 1: when the "내 기기 연산" radio is selected, intercept the seek form
// submission and run the search in a Web Worker (WebAssembly) instead of
// posting to the server. The server flow (서버 연산) is left completely
// untouched and remains the default.

(function () {
  'use strict';

  function init() {
    var form = document.querySelector('.form form[action*="/seek/enqueue"]');
    if (!form) return;

    var result = document.getElementById('client-seek-result');
    var rates = (form.dataset.rates || '').split(' ').map(Number);
    var slots = (form.dataset.slots || '').split(' ').map(Number);
    var trackBase = form.dataset.trackBase || '/';

    function selectedCompute() {
      var checked = form.querySelector('input[name="compute"]:checked');
      return checked ? checked.value : 'server';
    }

    function collectRolls() {
      var rolls = [];
      form.querySelectorAll('select[name="rolls"]').forEach(function (select) {
        var value = select.value.trim();
        if (!value) return;
        var parts = value.split(' ');
        rolls.push(parseInt(parts[0], 10)); // rarity (2..5)
        rolls.push(parseInt(parts[1], 10)); // slot
      });
      return rolls;
    }

    function seedLink(seed) {
      var sep = trackBase.indexOf('?') === -1 ? '?' : '&';
      var url = trackBase + sep + 'seed=' + seed;
      return '<a href="' + url + '">' + seed + '</a>';
    }

    function render(html) {
      if (result) result.innerHTML = html;
    }

    function renderResult(data) {
      if (!data.ok) {
        render('<ul><li>Seeking failed on this device: ' +
          escapeHtml(data.error) + '</li></ul>');
        return;
      }

      if (data.status === 0) {
        render('<ul><li>Unfortunately we didn\'t find your seed on this ' +
          'device. The first rare cat might be a duplicated rare cat, the ' +
          'cats/event might be wrong, or there could be a bug.</li></ul>');
        return;
      }

      var html =
        '<ul>' +
        '<li>Your starting seed is:<ul><li>' + seedLink(data.begin) +
        '</li></ul></li>' +
        '<li>After rolling the cats you entered, your last seed is:<ul><li>' +
        seedLink(data.end) + '</li></ul></li>';

      if (data.count > 1) {
        html += '<li><strong>This might not be your actual seed</strong> ' +
          'because more than one seed was found. Verify and seek again with ' +
          'more rolls if it\'s not the right one.</li>';
      }

      html += '<li>Note that <strong>you only need to find the seed once</strong>. ' +
        'Save the URL.</li></ul>';

      render(html);
    }

    function escapeHtml(text) {
      var div = document.createElement('div');
      div.appendChild(document.createTextNode(text));
      return div.innerHTML;
    }

    form.addEventListener('submit', function (event) {
      if (selectedCompute() !== 'client') return; // 서버 연산: leave as-is

      event.preventDefault();

      var rolls = collectRolls();
      if (rolls.length === 0) {
        render('<ul><li>Please pick at least one roll.</li></ul>');
        return;
      }

      render('<ul><li>Seeking your seed on this device...</li></ul>');

      var worker = new Worker('/asset/seeker-worker.js');
      worker.onmessage = function (e) {
        renderResult(e.data);
        worker.terminate();
      };
      worker.onerror = function (e) {
        render('<ul><li>Seeking failed on this device: ' +
          escapeHtml(e.message || 'worker error') + '</li></ul>');
        worker.terminate();
      };
      worker.postMessage({ rates: rates, slots: slots, rolls: rolls });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
