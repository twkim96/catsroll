(function (global) {
  'use strict';

  var doc = global.document;

  function init() {
    var template = doc.getElementById('event_filter_template');
    var eventSelect = doc.getElementById('event_select');
    var form = eventSelect && eventSelect.form;
    var searchApi = global.EventSeriesSearch;
    if (!template || !eventSelect || !form || !searchApi) return;

    var fragment = template.content.cloneNode(true);
    var openButton = fragment.querySelector('[data-event-filter-open]');
    var dialog = fragment.getElementById('event_filter_dialog');
    var inputWrap = fragment.getElementById('event_filter_inputs');
    eventSelect.parentNode.insertBefore(openButton, eventSelect);
    form.appendChild(inputWrap);
    form.appendChild(dialog);

    var search = doc.getElementById('event_filter_search');
    var searchRoot = dialog.querySelector('[data-event-filter-query]');
    var searchChips = dialog.querySelector('[data-event-filter-search-chips]');
    var searchSuggestions = dialog.querySelector('[data-event-filter-suggestions]');
    var selectedWrap = dialog.querySelector('[data-event-filter-selected]');
    var selectedEmpty = dialog.querySelector('[data-event-filter-selected-empty]');
    var availableWrap = dialog.querySelector('[data-event-filter-available]');
    var noResults = dialog.querySelector('[data-event-filter-no-results]');
    var status = dialog.querySelector('[data-event-filter-status]');
    var reset = dialog.querySelector('[data-event-filter-reset]');
    var close = dialog.querySelector('[data-event-filter-close]');
    var backdrop = dialog.querySelector('[data-event-filter-backdrop]');
    var catalog = null;
    var catalogPromise = null;
    var applied = readApplied();
    var draft = applied.slice();
    var searchControl = searchApi.createAutocomplete({
      input: search,
      root: searchRoot,
      chips: searchChips,
      suggestions: searchSuggestions,
      onChange: render
    });

    removePaginationOptions();
    writeInputs();
    updateCount();

    function readApplied() {
      return Array.prototype.map.call(
        form.querySelectorAll('input[name="event_series"]'),
        function (input) { return parseInt(input.value, 10); }
      ).filter(function (id) { return !isNaN(id) && id >= 0; }).
        filter(function (id, index, values) { return values.indexOf(id) === index; }).
        sort(function (a, b) { return a - b; });
    }

    function sameSelection(a, b) {
      return a.length === b.length && a.every(function (id, index) {
        return id === b[index];
      });
    }

    function removePaginationOptions() {
      if (!applied.length) return;

      Array.prototype.slice.call(eventSelect.options).forEach(function (option) {
        if (option.value === 'next_page' || option.value === 'prev_page') {
          option.remove();
        }
      });
    }

    function currentLang() {
      var lang = form.elements.lang;
      return (lang && lang.value) || 'en';
    }

    function loadCatalog() {
      if (catalog) return Promise.resolve(catalog);
      if (catalogPromise) return catalogPromise;

      status.hidden = false;
      status.textContent = '불러오는 중…';
      catalogPromise = global.fetch(
        '/events.json?lang=' + encodeURIComponent(currentLang()) + '&catalog=series',
        {credentials: 'same-origin'}
      ).then(function (response) {
        if (!response.ok) throw new Error('events ' + response.status);
        return response.json();
      }).then(function (data) {
        var prepared = searchApi.prepareCatalog(data);
        catalog = prepared.series;
        searchControl.setCharacters(prepared.characters);
        status.hidden = true;
        render();
        return catalog;
      }).catch(function () {
        catalogPromise = null;
        status.hidden = false;
        status.textContent = '시리즈 목록을 불러오지 못했습니다.';
        renderSelected();
        throw new Error('event series catalog unavailable');
      });

      return catalogPromise;
    }

    function itemFor(id) {
      if (!catalog) return null;
      return catalog.find(function (item) { return item.id === id; }) || null;
    }

    function tagButton(item, isSelectedArea) {
      var id = item ? item.id : null;
      var button = doc.createElement('button');
      var label = item ? item.label : '시리즈 ' + id;
      button.type = 'button';
      button.className = 'event-filter-tag';
      button.title = label;
      button.dataset.seriesId = id;

      if (isSelectedArea) {
        button.classList.add('is-selected', 'event-filter-selected-tag');
        button.textContent = label + ' ×';
        button.setAttribute('aria-label', label + ' 필터 해제');
      } else {
        var selected = draft.indexOf(id) !== -1;
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        button.textContent = label +
          (item && item.count ? ' (' + item.count + ')' : '');
      }

      button.addEventListener('click', function () { toggle(id); });
      return button;
    }

    function toggle(id) {
      var index = draft.indexOf(id);
      if (index === -1) draft.push(id);
      else draft.splice(index, 1);
      draft.sort(function (a, b) { return a - b; });
      render();
    }

    function renderSelected() {
      selectedWrap.innerHTML = '';
      draft.forEach(function (id) {
        selectedWrap.appendChild(tagButton(itemFor(id) || {id: id, label: '시리즈 ' + id}, true));
      });
      selectedEmpty.hidden = draft.length !== 0;
      reset.disabled = draft.length === 0 && !searchControl.hasCriteria();
    }

    function renderAvailable() {
      availableWrap.innerHTML = '';
      if (!catalog) {
        noResults.hidden = true;
        return;
      }

      var visible = searchControl.filterSeries(catalog);
      visible.forEach(function (item) {
        availableWrap.appendChild(tagButton(item, false));
      });
      noResults.hidden = visible.length !== 0;
    }

    function render() {
      renderSelected();
      renderAvailable();
    }

    function updateCount() {
      var badge = openButton.querySelector('.event-filter-count');
      badge.textContent = applied.length;
      badge.hidden = applied.length === 0;
      openButton.classList.toggle('is-active', applied.length !== 0);
    }

    function writeInputs() {
      inputWrap.innerHTML = '';
      draft.forEach(function (id) {
        var input = doc.createElement('input');
        input.type = 'hidden';
        input.name = 'event_series';
        input.value = id;
        inputWrap.appendChild(input);
      });
    }

    function applyAndNavigate() {
      if (sameSelection(applied, draft)) return;

      applied = draft.slice();
      writeInputs();
      updateCount();

      var params = new URLSearchParams(new FormData(form));
      var current = new URLSearchParams(global.location.search);
      if (current.get('compute') === 'client') params.set('compute', 'client');
      global.location.assign(global.location.pathname + '?' + params.toString());
    }

    openButton.addEventListener('click', function () {
      draft = applied.slice();
      searchControl.reset(true);
      render();
      dialog.showModal();
      loadCatalog().catch(function () {});
      search.focus();
    });

    reset.addEventListener('click', function () {
      draft = [];
      searchControl.reset(true);
      render();
    });
    close.addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      dialog.close();
    });
    backdrop.addEventListener('click', function () { dialog.close(); });
    dialog.addEventListener('close', applyAndNavigate);
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof self !== 'undefined' ? self : this);
