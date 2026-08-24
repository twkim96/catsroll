(function (global) {
  "use strict";

  var storageKey = "battle-cats-rolls.multiTrack.v1";
  var applyNotice = "Press Apply to update tracks.";
  var doc = global.document;
  var root = doc.getElementById("multi-track-app");
  if (!root || !global.TrackEngine) {
    return;
  }

  var virtualApi = global.MultiTrackVirtual;
  var appleSafariDevice = virtualApi ?
    virtualApi.appleSafariDevice(global.navigator || {}) : "";
  var virtualizedAppleSafariDevices = { ipad: true, iphone: true };
  var useChunkVirtualization = !!(virtualApi &&
    virtualApi.enabledFor(appleSafariDevice, virtualizedAppleSafariDevices));
  root.setAttribute("data-apple-safari-device", appleSafariDevice || "other");
  root.classList.toggle("is-chunk-virtualized", useChunkVirtualization);

  var data = JSON.parse(doc.getElementById("multi_track_data").textContent);
  var limits = data.limits || { rows: 8, count: 500 };
  var formIndex = parseInt(data.initial.name, 10) || 0;
  var regionKeys = Object.keys(data.regions);
  var defaultLang = data.regions[data.initial.lang] ?
    data.initial.lang : regionKeys[0];
  var exclusiveSet = {};
  (global.TrackEngine.EXCLUSIVES || []).forEach(function (id) {
    exclusiveSet[id] = true;
  });

  var els = {
    form: doc.getElementById("multi_form"),
    seed: doc.getElementById("multi_seed"),
    count: doc.getElementById("multi_count"),
    last: doc.getElementById("multi_last"),
    lastHint: doc.getElementById("multi_last_hint"),
    apply: doc.getElementById("multi_apply"),
    add: doc.getElementById("multi_add"),
    rows: doc.getElementById("multi_rows"),
    foundCats: doc.getElementById("multi_found_cats"),
    tables: doc.getElementById("multi_tables"),
    notice: doc.getElementById("multi_notice"),
    summary: doc.getElementById("multi_summary"),
    filterDialog: doc.getElementById("multi_event_filter_dialog"),
    filterTitle: doc.getElementById("multi_event_filter_title"),
    filterSearch: doc.getElementById("multi_event_filter_search")
  };

  function h(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function intValue(value, fallback) {
    var parsed = parseInt(value, 10);
    return isNaN(parsed) ? fallback : parsed;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function validSeriesIds(values) {
    return (Array.isArray(values) ? values : []).map(function (value) {
      return parseInt(value, 10);
    }).filter(function (id) {
      return !isNaN(id) && id >= 0;
    }).filter(function (id, index, ids) {
      return ids.indexOf(id) === index;
    }).sort(function (a, b) { return a - b; });
  }

  function sameSeriesIds(a, b) {
    return a.length === b.length && a.every(function (id, index) {
      return id === b[index];
    });
  }

  function region(lang) {
    return data.regions[lang] || data.regions[defaultLang];
  }

  function defaultEvent(lang) {
    var r = region(lang);
    return r.current || (r.events[0] && r.events[0].event) || "";
  }

  function eventData(lang, event) {
    var events = region(lang).events;
    for (var i = 0; i < events.length; i++) {
      if (events[i].event === event) {
        return events[i];
      }
    }
    return events[0];
  }

  function filteredEvents(row) {
    var ids = validSeriesIds(row.seriesIds);
    return region(row.lang).events.filter(function (event) {
      return !ids.length || ids.indexOf(intValue(event.series_id, -1)) !== -1;
    });
  }

  function lastRollText(id) {
    if (!(id > 0)) return "";
    var info = data.last_cats && data.last_cats[id];
    if (!info) return "";
    var kr = info.kr || "?";
    var jp = info.jp || "?";
    return "KR: " + kr + ", JP: " + jp;
  }

  function renderLastHint(value) {
    if (els.lastHint) {
      els.lastHint.value = lastRollText(value == null ? state.last : value);
    }
  }

  function validRow(row) {
    var lang = data.regions[row.lang] ? row.lang : defaultLang;
    var customName = String(row.customName || "");
    var customNameAuto = row.customNameAuto === true ||
      (row.customNameAuto !== false && !customName);
    var normalized = {
      lang: lang,
      event: row.event,
      ubers: clamp(intValue(row.ubers, 0), 0, 20),
      customName: customNameAuto ? "" : customName,
      customNameAuto: customNameAuto,
      seriesIds: validSeriesIds(row.seriesIds)
    };
    var events = filteredEvents(normalized);
    if (!events.length && normalized.seriesIds.length) {
      normalized.seriesIds = [];
      events = filteredEvents(normalized);
    }
    normalized.event = events.some(function (event) {
      return event.event === row.event;
    }) ? row.event : ((events[0] && events[0].event) || defaultEvent(lang));
    return normalized;
  }

  function readSaved() {
    if (global.MultiShareApp && global.MultiShareApp.isActive()) return null;
    try {
      return JSON.parse(global.localStorage.getItem(storageKey) || "null");
    } catch (_error) {
      return null;
    }
  }

  function writeSaved(state) {
    if (isolatedPlanSession ||
        (global.MultiShareApp && global.MultiShareApp.isActive())) return;
    try {
      global.localStorage.setItem(storageKey, JSON.stringify({
        seed: state.seed,
        count: state.count,
        rows: state.rows
      }));
    } catch (_error) {
      // Ignore private browsing or full storage.
    }
  }

  function queryState() {
    var params = new URLSearchParams(global.location.search);
    var seed = intValue(params.get("seed"), data.initial.seed || 1);
    var count = intValue(params.get("count"), data.initial.count || 100);
    var last = intValue(params.get("last"), 0);
    var lang = params.get("lang") || defaultLang;
    var event = params.get("event") || data.initial.event || defaultEvent(lang);

    return {
      seed: seed >>> 0,
      last: last,
      count: clamp(count, 1, limits.count),
      rows: [validRow({
        lang: lang, event: event, ubers: 0, customName: "",
        customNameAuto: true, seriesIds: []
      })]
    };
  }

  function initialState(resetFirstFilter) {
    if (global.MultiShareApp && global.MultiShareApp.isActive()) {
      var shared = global.MultiShareApp.getTrackState();
      if (shared && shared.rows && shared.rows.length) {
        formIndex = intValue(shared.formIndex, formIndex);
        return shared;
      }
      return queryState();
    }
    var fromQuery = queryState();
    var saved = readSaved();
    var params = new URLSearchParams(global.location.search);
    if (saved) {
      saved.seed = params.has("seed") ?
        fromQuery.seed : intValue(saved.seed, fromQuery.seed) >>> 0;
      saved.last = params.has("last") ? fromQuery.last : 0;
      saved.count = params.has("count") ?
        fromQuery.count : clamp(intValue(saved.count, fromQuery.count), 1, limits.count);
      saved.rows = (saved.rows || []).slice(0, limits.rows).map(validRow);
      if (!saved.rows.length) saved.rows = fromQuery.rows;

      if (params.has("lang") || params.has("event")) {
        var first = saved.rows[0] || fromQuery.rows[0];
        var lang = params.get("lang") || first.lang || defaultLang;
        saved.rows[0] = validRow({
          lang: lang,
          event: params.get("event") || first.event || defaultEvent(lang),
          ubers: first.ubers,
          customName: first.customName,
          customNameAuto: first.customNameAuto,
          seriesIds: first.seriesIds
        });
      }
      if (resetFirstFilter && saved.rows[0]) {
        saved.rows[0].seriesIds = [];
        saved.rows[0] = validRow(saved.rows[0]);
      }
      return saved;
    }
    return fromQuery;
  }

  function cloneState(source) {
    return {
      seed: intValue(source.seed, data.initial.seed || 1) >>> 0,
      last: Math.max(0, intValue(source.last, 0)),
      count: clamp(intValue(source.count, 100), 1, limits.count),
      rows: (source.rows || []).slice(0, limits.rows).map(validRow)
    };
  }

  var state = cloneState(initialState(true));
  var draft = cloneState(state);
  var dirty = false;
  var syncHandle = 0;
  var scrollUiHandle = 0;
  var trackPage = 0;
  var trackWheelUntil = 0;
  var trackSwipeStartX = null;
  var filterCatalogs = {};
  var filterCatalogPromises = {};
  var filterRowIndex = null;
  var filterOriginal = [];
  var filterDraft = [];
  var lastFindSnapshot = null;
  var lastOutputs = null;
  var virtualModel = null;
  var virtualRange = null;
  var virtualScrollHandle = 0;
  var shareChangeHandle = 0;
  var isolatedPlanSession = false;

  function multiUrl() {
    var first = state.rows[0] || {};
    var params = new URLSearchParams();
    if (state.seed) params.set("seed", state.seed);
    if (state.last) params.set("last", state.last);
    params.set("count", state.count);
    if (first.lang) params.set("lang", first.lang);
    if (first.event) params.set("event", first.event);
    return "/multi?" + params.toString();
  }

  function updateUrl(mode) {
    if (isolatedPlanSession) return;
    if (global.MultiShareApp && global.MultiShareApp.isActive()) {
      global.MultiShareApp.setTrackState(state, formIndex, mode);
      return;
    }
    var historyState = {
      multi: true,
      seed: state.seed,
      last: state.last,
      count: state.count
    };
    if (mode === "push") {
      global.history.pushState(historyState, "", multiUrl());
    } else if (mode !== false) {
      global.history.replaceState(historyState, "", multiUrl());
    }
  }

  function rowTitle(row) {
    var ev = eventData(row.lang, row.event);
    var regionLabel = region(row.lang).label;
    var customName = displayedCustomName(row);
    if (customName) return customName;
    return regionLabel + " " + (ev ? ev.label : row.event);
  }

  function shortRowTitle(row) {
    var customName = displayedCustomName(row);
    if (customName) return customName;
    var ev = eventData(row.lang, row.event);
    var label = ev ? ev.label : row.event;
    return region(row.lang).label + " " + label.replace(/:.*$/, "");
  }

  function displayedCustomName(row) {
    if (!row.customNameAuto) return row.customName;
    var ev = eventData(row.lang, row.event);
    var names = region(row.lang).series_names || {};
    return ev ? String(names[ev.series_id] || "") : "";
  }

  function renderRegionOptions(selected) {
    return Object.keys(data.regions).map(function (lang) {
      return '<option value="' + h(lang) + '"' +
        (lang === selected ? " selected" : "") + ">" +
        h(data.regions[lang].label) + "</option>";
    }).join("");
  }

  function renderEventOptions(row) {
    var groups = [
      { key: "upcoming", label: "Upcoming:" },
      { key: "past", label: "Past:" }
    ];
    return groups.map(function (group) {
      var options = filteredEvents(row).filter(function (event) {
        return event.group === group.key;
      }).map(function (event) {
        return '<option value="' + h(event.event) + '"' +
          (event.event === row.event ? " selected" : "") + ">" +
          h(event.label) + "</option>";
      }).join("");
      return options ? '<optgroup label="' + group.label + '">' +
        options + "</optgroup>" : "";
    }).join("");
  }

  function renderRows() {
    els.rows.innerHTML = draft.rows.map(function (row, index) {
      return [
        '<div class="multi-row" data-index="' + index + '">',
        '<button type="button" data-action="remove" title="Remove" aria-label="Remove track"' +
          (draft.rows.length <= 1 ? " disabled" : "") + ">",
          '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="2">',
            '<path d="M3 6h18"></path>',
            '<path d="M8 6V4h8v2"></path>',
            '<path d="M6 6l1 15h10l1-15"></path>',
            '<path d="M10 11v6"></path>',
            '<path d="M14 11v6"></path>',
          '</svg>',
        '</button>',
        '<button type="button" class="multi-filter-button',
          row.seriesIds.length ? ' is-active' : '',
          '" data-action="filter" title="Series filter" aria-label="Filter track ',
          index + 1, '" aria-haspopup="dialog" aria-controls="multi_event_filter_dialog">',
          '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="none">',
            '<path d="M4 5h16l-6.5 7.2v5.3l-3 1.5v-6.8z"></path>',
          '</svg>',
          '<span class="event-filter-count"',
            row.seriesIds.length ? '' : ' hidden', '>', row.seriesIds.length, '</span>',
        '</button>',
        '<label><span>Region</span><select data-field="lang">',
          renderRegionOptions(row.lang), '</select></label>',
        '<label><span>Event</span><select data-field="event">',
          renderEventOptions(row), '</select></label>',
        '<label><span>F/U</span>',
          '<input data-field="ubers" type="number" min="0" max="20" value="',
          h(row.ubers), '"></label>',
        '<label><span>Custom name</span>',
          '<input data-field="customName" value="', h(displayedCustomName(row)),
          '" placeholder="Custom name"></label>',
        '</div>'
      ].join("");
    }).join("");
  }

  function normalizeFilterText(value) {
    var text = String(value || "");
    if (text.normalize) text = text.normalize("NFKC");
    return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  }

  function loadFilterCatalog(lang) {
    if (filterCatalogs[lang]) return Promise.resolve(filterCatalogs[lang]);
    if (filterCatalogPromises[lang]) return filterCatalogPromises[lang];

    var url = "/events.json?lang=" + encodeURIComponent(lang) + "&catalog=series";
    filterCatalogPromises[lang] = global.fetch(url, { credentials: "same-origin" })
      .then(function (response) {
        if (!response.ok) throw new Error("events " + response.status);
        return response.json();
      }).then(function (payload) {
        var catalog = Array.isArray(payload.series) ? payload.series : [];
        filterCatalogs[lang] = catalog.map(function (item) {
          item.id = parseInt(item.id, 10);
          item._search = normalizeFilterText(
            [item.id, item.label].concat(item.aliases || []).join(" ")
          );
          item._searchCompact = item._search.replace(/\s+/g, "");
          return item;
        }).filter(function (item) {
          return !isNaN(item.id) && item.count > 0;
        });
        delete filterCatalogPromises[lang];
        return filterCatalogs[lang];
      }).catch(function (error) {
        delete filterCatalogPromises[lang];
        throw error;
      });
    return filterCatalogPromises[lang];
  }

  function filterCatalog() {
    var row = filterRowIndex == null ? null : draft.rows[filterRowIndex];
    return row ? (filterCatalogs[row.lang] || []) : [];
  }

  function filterItem(id) {
    var catalog = filterCatalog();
    for (var i = 0; i < catalog.length; i++) {
      if (catalog[i].id === id) return catalog[i];
    }
    return null;
  }

  function toggleFilterId(id) {
    var index = filterDraft.indexOf(id);
    if (index === -1) filterDraft.push(id);
    else filterDraft.splice(index, 1);
    filterDraft = validSeriesIds(filterDraft);
    renderFilterModal();
  }

  function filterTag(item, selectedArea) {
    var id = item.id;
    var label = item.label || ("시리즈 " + id);
    var button = doc.createElement("button");
    button.type = "button";
    button.className = "event-filter-tag";
    button.title = label;
    button.dataset.seriesId = id;
    if (selectedArea) {
      button.classList.add("is-selected", "event-filter-selected-tag");
      button.textContent = label + " ×";
      button.setAttribute("aria-label", label + " 필터 해제");
    } else {
      var selected = filterDraft.indexOf(id) !== -1;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
      button.textContent = label + (item.count ? " (" + item.count + ")" : "");
    }
    button.addEventListener("click", function () { toggleFilterId(id); });
    return button;
  }

  function renderFilterModal() {
    if (!els.filterDialog || filterRowIndex == null) return;
    var selectedWrap = els.filterDialog.querySelector("[data-multi-filter-selected]");
    var selectedEmpty = els.filterDialog.querySelector("[data-multi-filter-selected-empty]");
    var availableWrap = els.filterDialog.querySelector("[data-multi-filter-available]");
    var noResults = els.filterDialog.querySelector("[data-multi-filter-no-results]");
    var reset = els.filterDialog.querySelector("[data-multi-filter-reset]");
    var status = els.filterDialog.querySelector("[data-multi-filter-status]");
    var catalog = filterCatalog();

    selectedWrap.innerHTML = "";
    filterDraft.forEach(function (id) {
      selectedWrap.appendChild(filterTag(filterItem(id) || {
        id: id, label: "시리즈 " + id, count: 0
      }, true));
    });
    selectedEmpty.hidden = filterDraft.length !== 0;
    reset.disabled = filterDraft.length === 0;

    availableWrap.innerHTML = "";
    if (!catalog.length) {
      noResults.hidden = true;
      status.hidden = false;
      status.textContent = filterCatalogPromises[draft.rows[filterRowIndex].lang] ?
        "불러오는 중…" : "시리즈 목록을 불러오지 못했습니다.";
      return;
    }

    status.hidden = true;
    var normalizedQuery = normalizeFilterText(els.filterSearch.value);
    var tokens = normalizedQuery.split(" ").filter(Boolean);
    var compactQuery = normalizedQuery.replace(/\s+/g, "");
    var visible = catalog.filter(function (item) {
      return tokens.every(function (token) {
        return item._search.indexOf(token) !== -1;
      }) || item._searchCompact.indexOf(compactQuery) !== -1;
    });
    visible.forEach(function (item) {
      availableWrap.appendChild(filterTag(item, false));
    });
    noResults.hidden = visible.length !== 0;
  }

  function openFilter(index) {
    if (!els.filterDialog || !draft.rows[index]) return;
    filterRowIndex = index;
    filterOriginal = validSeriesIds(draft.rows[index].seriesIds);
    filterDraft = filterOriginal.slice();
    els.filterTitle.textContent = "시리즈 필터 · Track " + (index + 1);
    els.filterSearch.value = "";
    var lang = draft.rows[index].lang;
    var catalogPromise = loadFilterCatalog(lang);
    renderFilterModal();
    els.filterDialog.showModal();
    catalogPromise.then(function () {
      if (filterRowIndex === index && els.filterDialog.open) renderFilterModal();
    }).catch(function () {
      if (filterRowIndex === index && els.filterDialog.open) renderFilterModal();
    });
    els.filterSearch.focus();
  }

  function applyFilter() {
    if (filterRowIndex == null || !draft.rows[filterRowIndex]) return;
    var changed = !sameSeriesIds(filterOriginal, filterDraft);
    if (changed) {
      draft.rows[filterRowIndex].seriesIds = filterDraft.slice();
      draft.rows[filterRowIndex] = validRow(draft.rows[filterRowIndex]);
      renderRows();
      setDirty(true);
      setNotice(applyNotice);
    }
    filterRowIndex = null;
    filterOriginal = [];
    filterDraft = [];
  }

  function futureInfo(id) {
    return { name: ["(" + id + "?)"], desc: ["An unknown future uber"] };
  }

  function poolWithFuture(pool, amount) {
    var cloned = JSON.parse(JSON.stringify(pool));
    var slots = cloned.slots["4"] || cloned.slots[4] || [];
    cloned.slots["4"] = slots;
    cloned.slots[4] = slots;
    for (var n = -1; n >= -amount; n--) {
      slots.unshift(n);
      cloned.cats[n] = futureInfo(n);
    }
    return cloned;
  }

  function poolUrl(row) {
    var params = new URLSearchParams();
    params.set("lang", row.lang);
    params.set("event", row.event);
    params.set("name", data.initial.name || 0);
    return "/track.json?" + params.toString();
  }

  function loadPool(row) {
    var ev = eventData(row.lang, row.event);
    if (!ev || ev.pool || ev.loading) return;
    ev.loading = true;
    global.fetch(poolUrl(row), { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("track.json " + res.status);
        return res.json();
      })
      .then(function (pool) {
        ev.pool = pool;
        ev.loading = false;
        renderTables();
      })
      .catch(function () {
        ev.loading = false;
        ev.error = "No data";
        renderTables();
      });
  }

  function buildOutputs() {
    return state.rows.map(function (row) {
      var ev = eventData(row.lang, row.event);
      if (ev && !ev.pool) {
        loadPool(row);
        return {
          row: row,
          label: shortRowTitle(row),
          title: rowTitle(row),
          error: ev.error || "Loading..."
        };
      }
      if (!ev || !ev.pool || !ev.pool.exist) {
        return { row: row, label: shortRowTitle(row), error: "No data" };
      }
      var pool = poolWithFuture(ev.pool, row.ubers);
      return {
        row: row,
        label: shortRowTitle(row),
        title: rowTitle(row),
        pool: pool,
        out: global.TrackEngine.buildTracks(pool, state.seed, {
          count: state.count,
          position: "1A",
          last: state.last || 0,
          guaranteedRolls: pool.guaranteed_rolls,
          guaranteed: true,
          findCat: true
        })
      };
    });
  }

  function nextLabel(cat) {
    if (!cat || !cat.next || cat.next.track === cat.track) return "";
    return cat.next.track === 0 ? "<- " + cat.next.number() : "-> " + cat.next.number();
  }

  function multiRollUrl(cat, row) {
    if (!cat || cat.slot_seed == null || !(cat.id > 0)) return "";
    var params = new URLSearchParams();
    params.set("seed", cat.slot_seed);
    params.set("last", cat.id);
    params.set("count", state.count);
    params.set("lang", row.lang);
    params.set("event", row.event);
    return "/multi?" + params.toString();
  }

  function catNameHtml(cat, row) {
    var name = h(cat.pickName(formIndex));
    var url = multiRollUrl(cat, row);
    if (!url) return name;
    return '<a href="' + h(url) + '" data-action="advance" data-seed="' +
      h(cat.slot_seed) + '" data-last="' + h(cat.id) + '" data-lang="' +
      h(row.lang) + '" data-event="' + h(row.event) + '" title="' +
      h(cat.pickTitle(formIndex)) + '">' + name + '</a>';
  }

  function cellHtml(cat, row) {
    if (!cat) return "";
    var parts = ['<span class="multi-cat-name',
      exclusiveSet[cat.id] ? ' multi-inline-exclusive' : '',
      '" data-plan-pick-kind="regular">',
      catNameHtml(cat, row), '</span>'];
    var next = nextLabel(cat);
    if (next) parts.push('<span class="multi-cat-next">', h(next), '</span>');
    if (cat.rerolled) {
      parts.push('<span class="multi-cat-guaranteed',
        exclusiveSet[cat.rerolled.id] ? ' multi-inline-exclusive' : '',
        '" data-plan-pick-kind="reroll">R: ',
        catNameHtml(cat.rerolled, row));
      var rerollNext = nextLabel(cat.rerolled);
      if (rerollNext) parts.push(' ', h(rerollNext));
      parts.push('</span>');
    }
    if (cat.guaranteed) {
      parts.push('<span class="multi-cat-guaranteed',
        exclusiveSet[cat.guaranteed.id] ? ' multi-inline-exclusive' : '',
        '" data-plan-pick-kind="guaranteed">G: ',
        catNameHtml(cat.guaranteed, row));
      var guaranteedNext = nextLabel(cat.guaranteed);
      if (guaranteedNext) parts.push(' ', h(guaranteedNext));
      parts.push('</span>');
    }
    return parts.join("");
  }

  function cellClass(cat) {
    var label = cat && exclusiveSet[cat.id] ?
      "exclusive" : (cat ? cat.scoreRarityLabel() : "");
    var cls = label ? "position minor_" + label + " major_" + label : "";
    if (cat && cat.next && cat.next.track !== cat.track) {
      cls += " multi-cat-switch";
    }
    return cls;
  }

  function planSelectedCats(marks) {
    var selected = [];
    if (!lastOutputs) return selected;
    (Array.isArray(marks) ? marks : []).slice().sort(function (left, right) {
      return intValue(left && left.column, -1) -
        intValue(right && right.column, -1);
    }).forEach(function (mark) {
      var column = intValue(mark && mark.column, -1);
      var match = /^(\d{1,3})([AB])$/.exec(String(
        mark && mark.position || "").toUpperCase());
      var item = lastOutputs[column];
      if (!match || !item || !item.out || !item.out.cats) return;
      var index = parseInt(match[1], 10) - 1;
      var track = match[2] === "B" ? 1 : 0;
      var cat = item.out.cats[index] && item.out.cats[index][track];
      var picked = mark.kind === "guaranteed" ? cat && cat.guaranteed :
        (mark.kind === "reroll" ? cat && cat.rerolled : cat);
      [picked].forEach(function (selectedCat) {
        if (!selectedCat || [4, 5].indexOf(selectedCat.rarity) === -1) return;
        selected.push({
          id: selectedCat.id,
          name: String(selectedCat.pickName(formIndex)),
          rarity: selectedCat.rarity,
          guaranteed: mark.kind === "guaranteed"
        });
      });
    });
    return selected;
  }

  function renderTrackCells(outputs, index, track) {
    var position = (index + 1) + (track === 0 ? "A" : "B");
    return outputs.map(function (item, columnIndex) {
      var cat = item.out && item.out.cats[index] && item.out.cats[index][track];
      return '<td class="' + h(cellClass(cat)) + '" data-route-event="' +
        h(item.row.event) + '" data-route-position="' + h(position) +
        '" data-plan-column-index="' + columnIndex + '">' +
        (item.error ? h(item.error) : cellHtml(cat, item.row)) + '</td>';
    }).join("");
  }

  function renderTrackHeaders(outputs) {
    return outputs.map(function (item) {
      return '<th title="' + h(item.title || item.label) + '">' +
        h(item.label) + "</th>";
    }).join("");
  }

  function renderTrackScrollControls(count) {
    if (count <= 5) return "";
    return [
      '<div class="multi-track-scroll-controls" aria-label="Track 이동">',
      '<button type="button" data-action="scroll-tracks" data-direction="-1"',
      ' aria-label="Track A 보기">&lsaquo;</button>',
      '<span data-multi-scroll-range>1 / 2</span>',
      '<button type="button" data-action="scroll-tracks" data-direction="1"',
      ' aria-label="Track B 보기">&rsaquo;</button>',
      '</div>'
    ].join("");
  }

  function renderTrackRow(outputs, index, track, label) {
    return '<tr class="multi-track-row" data-row-index="' + index + '">' +
      '<td id="multi-N' + (index + 1) + label +
      '" data-route-number-position="' + (index + 1) + label + '">' +
      (index + 1) + label + '</td>' + renderTrackCells(outputs, index, track) +
      '</tr>';
  }

  function renderTrackRows(outputs, track, label, start, end) {
    var html = [];
    for (var i = start; i < end; i++) {
      html.push(renderTrackRow(outputs, i, track, label));
    }
    return html.join("");
  }

  function virtualSpacerHtml(kind, height, columns) {
    if (!(height > 0)) return "";
    return '<tr class="multi-virtual-spacer is-' + kind +
      '" data-virtual-spacer="' + kind + '" aria-hidden="true">' +
      '<td colspan="' + columns + '" style="height:' +
      Math.max(0, Math.round(height)) + 'px"></td></tr>';
  }

  function renderTrackBody(outputs, track, label) {
    if (!useChunkVirtualization || !virtualModel || !virtualRange) {
      return renderTrackRows(outputs, track, label, 0, state.count);
    }
    var top = virtualApi.offsetForIndex(virtualModel, virtualRange.start);
    var bottom = virtualApi.offsetForIndex(virtualModel, state.count) -
      virtualApi.offsetForIndex(virtualModel, virtualRange.end);
    return virtualSpacerHtml("top", top, outputs.length + 1) +
      renderTrackRows(outputs, track, label,
        virtualRange.start, virtualRange.end) +
      virtualSpacerHtml("bottom", bottom, outputs.length + 1);
  }

  function renderTrackTable(outputs, track, label) {
    var html = [
      '<section class="multi-track-section">',
      '<div class="multi-track-heading"><h2>Track ', label, '</h2>',
      renderTrackScrollControls(outputs.length), '</div>',
      '<div class="multi-table-wrap">',
      '<table class="multi-track-table">',
      '<thead><tr><th>No.</th>', renderTrackHeaders(outputs),
      '</tr></thead><tbody>', renderTrackBody(outputs, track, label)
    ];

    html.push('</tbody></table></div></section>');
    return html.join("");
  }

  function foundNumberHtml(number) {
    var anchor = String(number).replace(/[RGX]/g, "");
    var sequence = parseInt(anchor, 10);
    if (sequence >= 1 && sequence <= state.count) {
      return '<a href="#multi-N' + h(anchor) + '">' + h(number) + '</a>';
    }
    return h(number);
  }

  function renderFoundCats(outputs) {
    if (!els.foundCats) return;
    var loading = outputs.some(function (item) {
      return item.error === "Loading...";
    });
    var groups = outputs.filter(function (item) {
      return item.out && item.out.foundCats && item.out.foundCats.length;
    }).map(function (item) {
      var items = item.out.foundCats.map(function (result) {
        var cat = result.cat;
        var label = cat.scoreRarityLabel();
        var numbers = result.numbers.map(foundNumberHtml).join(", ");
        return '<li><span class="' + h(label) + '">' +
          catNameHtml(cat, item.row) + '</span>: ' + numbers + '</li>';
      }).join("");
      return '<section class="multi-found-group"><h3>' + h(item.label) +
        '</h3><ul>' + items + '</ul></section>';
    });

    if (groups.length) {
      els.foundCats.innerHTML = groups.join("");
    } else if (loading) {
      els.foundCats.innerHTML = '<p class="multi-found-loading">Loading...</p>';
    } else {
      els.foundCats.innerHTML = '<p class="multi-found-empty">No found cats.</p>';
    }
  }

  function updateVirtualSpacers() {
    if (!useChunkVirtualization || !virtualModel || !virtualRange) return;
    var heights = {
      top: virtualApi.offsetForIndex(virtualModel, virtualRange.start),
      bottom: virtualApi.offsetForIndex(virtualModel, state.count) -
        virtualApi.offsetForIndex(virtualModel, virtualRange.end)
    };
    els.tables.querySelectorAll("[data-virtual-spacer]").forEach(function (row) {
      var height = Math.max(0, Math.round(heights[row.dataset.virtualSpacer] || 0));
      row.style.height = height + "px";
      if (row.firstElementChild) {
        row.firstElementChild.style.height = height + "px";
      }
    });
  }

  function syncRowsIn(container, recordVirtualHeights) {
    if (!container) return;
    var bodies = container.querySelectorAll(".multi-track-table tbody");
    if (bodies.length < 2) return;

    var aRows = bodies[0].querySelectorAll(".multi-track-row");
    var bRows = bodies[1].querySelectorAll(".multi-track-row");
    var length = Math.min(aRows.length, bRows.length);
    var measurements = [];

    for (var i = 0; i < length; i++) {
      aRows[i].style.height = "";
      bRows[i].style.height = "";
    }

    for (var j = 0; j < length; j++) {
      var height = Math.max(aRows[j].offsetHeight, bRows[j].offsetHeight);
      if (height > 0) {
        aRows[j].style.height = height + "px";
        bRows[j].style.height = height + "px";
        measurements.push({
          index: intValue(aRows[j].dataset.rowIndex, j),
          height: height
        });
      }
    }

    if (recordVirtualHeights && useChunkVirtualization && virtualModel) {
      virtualApi.updateHeights(virtualModel, measurements);
      updateVirtualSpacers();
    }
  }

  function syncTrackRowHeights() {
    syncHandle = 0;
    syncRowsIn(els.tables, true);
  }

  function scheduleTrackRowSync() {
    if (syncHandle) {
      global.cancelAnimationFrame(syncHandle);
    }
    syncHandle = global.requestAnimationFrame(syncTrackRowHeights);
  }

  function renderVirtualWindow(range) {
    if (!useChunkVirtualization || !lastOutputs || !virtualModel ||
        virtualApi.sameRange(virtualRange, range)) return false;
    var bodies = els.tables.querySelectorAll(".multi-track-table tbody");
    if (bodies.length < 2) return false;

    virtualRange = range;
    bodies[0].innerHTML = renderTrackBody(lastOutputs, 0, "A");
    bodies[1].innerHTML = renderTrackBody(lastOutputs, 1, "B");
    if (syncHandle) {
      global.cancelAnimationFrame(syncHandle);
      syncHandle = 0;
    }
    syncRowsIn(els.tables, true);
    root.dispatchEvent(new CustomEvent("multi-track:window-updated", {
      detail: { start: virtualRange.start, end: virtualRange.end }
    }));
    return true;
  }

  function renderVirtualWindowForIndex(index) {
    if (!useChunkVirtualization || !virtualModel) return false;
    return renderVirtualWindow(virtualApi.rangeForIndex(virtualModel, index));
  }

  function virtualViewportIndex() {
    if (!useChunkVirtualization || !virtualModel) return 0;
    var body = els.tables.querySelector(".multi-track-table tbody");
    if (!body) return 0;
    var bodyTop = body.getBoundingClientRect().top + global.pageYOffset;
    var probe = global.pageYOffset + Math.max(0, global.innerHeight * 0.45);
    return virtualApi.indexAtOffset(virtualModel, Math.max(0, probe - bodyTop));
  }

  function updateVirtualWindow() {
    virtualScrollHandle = 0;
    renderVirtualWindowForIndex(virtualViewportIndex());
  }

  function scheduleVirtualWindow() {
    if (!useChunkVirtualization || virtualScrollHandle) return;
    virtualScrollHandle = global.requestAnimationFrame(updateVirtualWindow);
  }

  function trackScrollContainer() {
    return els.tables.querySelector(".multi-track-pair.is-scrollable");
  }

  function updateTrackScrollControls() {
    scrollUiHandle = 0;
    var scroller = trackScrollContainer();
    if (!scroller) return;
    var sections = scroller.querySelectorAll(".multi-track-section");
    if (!sections.length) return;
    trackPage = clamp(trackPage, 0, sections.length - 1);
    scroller.style.transform = "translate3d(" +
      (-sections[trackPage].offsetLeft) + "px, 0, 0)";

    els.tables.querySelectorAll("[data-multi-scroll-range]").forEach(function (node) {
      node.textContent = (trackPage + 1) + " / " + sections.length;
    });
    els.tables.querySelectorAll("[data-action='scroll-tracks']").forEach(function (button) {
      var direction = intValue(button.dataset.direction, 0);
      button.disabled = direction < 0 ? trackPage === 0 :
        trackPage === sections.length - 1;
    });
  }

  function scheduleTrackScrollUi() {
    if (scrollUiHandle) global.cancelAnimationFrame(scrollUiHandle);
    scrollUiHandle = global.requestAnimationFrame(updateTrackScrollControls);
  }

  function scrollTrackPage(direction) {
    var scroller = trackScrollContainer();
    if (!scroller || !direction) return;
    var sections = scroller.querySelectorAll(".multi-track-section");
    if (sections.length < 2) return;
    trackPage = clamp(trackPage + direction, 0, sections.length - 1);
    updateTrackScrollControls();
  }

  function renderTables() {
    var outputs = buildOutputs();
    lastOutputs = outputs;
    if (useChunkVirtualization) {
      virtualModel = virtualApi.create(state.count, {
        chunkSize: 40,
        bufferChunks: 2,
        estimatedRowHeight: 64
      });
      virtualRange = virtualApi.rangeForIndex(virtualModel, 0);
    } else {
      virtualModel = null;
      virtualRange = null;
    }
    var scrollable = outputs.length > 5;
    var pairClass = "multi-track-pair" + (scrollable ? " is-scrollable" : "");
    trackPage = 0;
    els.tables.classList.toggle("is-track-paged", scrollable);
    els.summary.textContent = state.rows.length + " banners / " +
      state.count + " rows" + (state.last ? " / last " + state.last : "");
    renderFoundCats(outputs);
    els.tables.innerHTML = '<div class="' + pairClass +
      '" data-multi-track-scroll>' +
      renderTrackTable(outputs, 0, "A") +
      renderTrackTable(outputs, 1, "B") +
      '</div>';
    lastFindSnapshot = {
      seed: state.seed,
      last: state.last,
      count: state.count,
      formIndex: formIndex,
      ready: outputs.every(function (item) { return !!item.pool; }),
      rows: outputs.map(function (item) {
        return {
          lang: item.row.lang,
          event: item.row.event,
          label: item.label,
          title: item.title,
          pool: item.pool || null,
          error: item.error || null
        };
      })
    };
    root.dispatchEvent(new CustomEvent("multi-track:updated", {
      detail: lastFindSnapshot
    }));
    scheduleTrackRowSync();
    scheduleTrackScrollUi();
    scheduleVirtualWindow();
  }

  function setNotice(text) {
    var message = text || "";
    var actionable = message === applyNotice;
    els.notice.textContent = message;
    els.notice.classList.toggle("is-action", actionable);
    if (actionable) {
      els.notice.setAttribute("role", "button");
      els.notice.setAttribute("tabindex", "0");
      els.notice.setAttribute("aria-label", applyNotice);
      els.notice.setAttribute("title", applyNotice);
    } else {
      els.notice.setAttribute("role", "status");
      els.notice.removeAttribute("tabindex");
      els.notice.removeAttribute("aria-label");
      els.notice.removeAttribute("title");
    }
  }

  function readControlInputs() {
    var count = intValue(els.count.value, draft.count);
    var clamped = clamp(count, 1, limits.count);
    return {
      seed: intValue(els.seed.value, draft.seed) >>> 0,
      count: clamped,
      last: Math.max(0, intValue(els.last.value, 0)),
      countWasClamped: count !== clamped
    };
  }

  function setDirty(value) {
    dirty = !!value;
    root.classList.toggle("is-dirty", dirty);
    if (els.apply) {
      els.apply.disabled = !dirty;
      els.apply.textContent = dirty ? "Apply" : "Applied";
    }
    if (dirty) {
      root.dispatchEvent(new CustomEvent("multi-track:dirty"));
    }
  }

  function renderAll(options) {
    options = options || {};
    state = cloneState(state);
    draft = cloneState(state);
    state.count = clamp(intValue(state.count, 100), 1, limits.count);
    state.rows = state.rows.slice(0, limits.rows).map(validRow);
    els.seed.value = state.seed || "";
    els.count.value = state.count;
    els.last.value = state.last || "";
    renderLastHint();
    renderRows();
    renderTables();
    updateUrl(options.history);
    writeSaved(state);
    setDirty(false);
  }

  function scrollToTrackStart(behavior) {
    var title = els.tables.querySelector(".multi-track-section h2");
    var target = title || els.tables;
    var top = target.getBoundingClientRect().top + global.pageYOffset - 8;
    global.scrollTo({ top: Math.max(0, top), behavior: behavior });
  }

  function applyControlInputs() {
    var inputs = readControlInputs();
    draft.seed = inputs.seed;
    draft.count = inputs.count;
    draft.last = inputs.last;
    state = cloneState(draft);
    renderAll();
    if (inputs.countWasClamped) {
      els.count.value = inputs.count;
      setNotice("Count is limited to " + limits.count + ".");
    } else {
      setNotice("");
    }
  }

  function markControlDirty() {
    var inputs = readControlInputs();
    draft.seed = inputs.seed;
    draft.count = inputs.count;
    draft.last = inputs.last;
    renderLastHint(draft.last);
    setDirty(true);
    setNotice(applyNotice);
  }

  function updateDraftRow(target) {
    var rowEl = target.closest(".multi-row");
    if (!rowEl || !target.dataset.field) return false;
    var index = parseInt(rowEl.dataset.index, 10);
    var field = target.dataset.field;
    if (!draft.rows[index]) return false;

    draft.rows[index][field] = target.value;
    if (field === "customName") {
      draft.rows[index].customNameAuto = false;
    } else if (field === "lang") {
      draft.rows[index].seriesIds = [];
      draft.rows[index].event = defaultEvent(target.value);
      draft.rows[index] = validRow(draft.rows[index]);
      renderRows();
    } else if (field === "ubers") {
      draft.rows[index].ubers = clamp(intValue(target.value, 0), 0, 20);
    } else if (field === "event") {
      draft.rows[index].customName = "";
      draft.rows[index].customNameAuto = true;
      draft.rows[index] = validRow(draft.rows[index]);
      renderRows();
    }
    setDirty(true);
    setNotice(applyNotice);
    return true;
  }

  els.form.addEventListener("submit", function (event) {
    event.preventDefault();
    applyControlInputs();
  });
  els.seed.addEventListener("input", markControlDirty);
  els.count.addEventListener("input", markControlDirty);
  els.last.addEventListener("input", markControlDirty);
  els.add.addEventListener("click", function () {
    if (draft.rows.length >= limits.rows) {
      setNotice("Track limit is " + limits.rows + ".");
      return;
    }
    var base = draft.rows[draft.rows.length - 1] || draft.rows[0];
    draft.rows.push(validRow({
      lang: base.lang,
      event: base.event,
      ubers: 0,
      customName: "",
      customNameAuto: true,
      seriesIds: []
    }));
    renderRows();
    setDirty(true);
    setNotice(applyNotice);
  });

  els.rows.addEventListener("input", function (event) {
    var target = event.target;
    if (target.tagName === "SELECT") return;
    updateDraftRow(target);
  });

  els.rows.addEventListener("change", function (event) {
    var target = event.target;
    if (target.tagName !== "SELECT") return;
    updateDraftRow(target);
  });

  els.rows.addEventListener("click", function (event) {
    var filterButton = event.target.closest("button[data-action='filter']");
    if (filterButton) {
      var filterRow = filterButton.closest(".multi-row");
      openFilter(parseInt(filterRow.dataset.index, 10));
      return;
    }

    var button = event.target.closest("button[data-action='remove']");
    if (!button) return;
    var rowEl = button.closest(".multi-row");
    var index = parseInt(rowEl.dataset.index, 10);
    if (draft.rows.length <= 1) return;
    draft.rows.splice(index, 1);
    renderRows();
    setDirty(true);
    setNotice(applyNotice);
  });

  if (els.foundCats) {
    els.foundCats.addEventListener("click", function (event) {
      if (!useChunkVirtualization) return;
      var link = event.target.closest("a[href^='#multi-N']");
      if (!link) return;
      var match = /^#multi-N(\d+)([AB])$/.exec(link.getAttribute("href") || "");
      if (!match) return;
      event.preventDefault();
      var index = clamp(intValue(match[1], 1) - 1, 0, state.count - 1);
      renderVirtualWindowForIndex(index);
      if (trackScrollContainer()) {
        trackPage = match[2] === "B" ? 1 : 0;
        updateTrackScrollControls();
      }
      global.requestAnimationFrame(function () {
        var target = doc.getElementById("multi-N" + match[1] + match[2]);
        if (target) target.scrollIntoView({ behavior: "auto", block: "center" });
      });
    });
  }

  if (els.filterDialog) {
    var filterClose = els.filterDialog.querySelector("[data-multi-filter-close]");
    var filterBackdrop = els.filterDialog.querySelector("[data-multi-filter-backdrop]");
    var filterReset = els.filterDialog.querySelector("[data-multi-filter-reset]");
    els.filterSearch.addEventListener("input", renderFilterModal);
    filterReset.addEventListener("click", function () {
      filterDraft = [];
      renderFilterModal();
    });
    filterClose.addEventListener("click", function () { els.filterDialog.close(); });
    filterBackdrop.addEventListener("click", function () { els.filterDialog.close(); });
    els.filterDialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      els.filterDialog.close();
    });
    els.filterDialog.addEventListener("close", applyFilter);
  }

  els.notice.addEventListener("click", function () {
    if (!dirty || els.notice.textContent !== applyNotice) return;
    applyControlInputs();
  });

  els.notice.addEventListener("keydown", function (event) {
    if (!dirty || els.notice.textContent !== applyNotice) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    applyControlInputs();
  });

  els.tables.addEventListener("click", function (event) {
    var scrollButton = event.target.closest("[data-action='scroll-tracks']");
    if (scrollButton) {
      var direction = intValue(scrollButton.dataset.direction, 0);
      scrollTrackPage(direction);
      return;
    }

    var link = event.target.closest("a[data-action='advance']");
    if (!link) return;
    event.preventDefault();

    state.seed = intValue(link.dataset.seed, state.seed) >>> 0;
    state.last = intValue(link.dataset.last, 0);
    setNotice("");
    renderAll({ history: "push" });
    scrollToTrackStart("smooth");
  });

  els.tables.addEventListener("wheel", function (event) {
    if (!trackScrollContainer()) return;
    var delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ?
      event.deltaX : (event.shiftKey ? event.deltaY : 0);
    if (Math.abs(delta) < 12) return;
    event.preventDefault();
    var now = Date.now();
    if (now < trackWheelUntil) return;
    trackWheelUntil = now + 350;
    scrollTrackPage(delta > 0 ? 1 : -1);
  }, { passive: false });

  els.tables.addEventListener("touchstart", function (event) {
    if (!trackScrollContainer() || event.touches.length !== 1) return;
    trackSwipeStartX = event.touches[0].clientX;
  }, { passive: true });

  els.tables.addEventListener("touchend", function (event) {
    if (trackSwipeStartX == null || !event.changedTouches.length) return;
    var distance = trackSwipeStartX - event.changedTouches[0].clientX;
    trackSwipeStartX = null;
    if (Math.abs(distance) < 50) return;
    scrollTrackPage(distance > 0 ? 1 : -1);
  }, { passive: true });

  doc.addEventListener("click", function (event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.button !== 0) return;
    var link = event.target.closest && event.target.closest("#recent-seeds a[href]");
    if (!link) return;
    var recentUrl = new URL(link.href, global.location.href);
    var recentSeed = intValue(recentUrl.searchParams.get("seed"), 0) >>> 0;
    if (!recentSeed) return;

    event.preventDefault();
    state.seed = recentSeed;
    setNotice("");
    renderAll({ history: "push" });
  });

  global.addEventListener("multi-share:changed", function () {
    isolatedPlanSession = false;
    global.clearTimeout(shareChangeHandle);
    shareChangeHandle = global.setTimeout(function () {
      shareChangeHandle = 0;
      state = cloneState(initialState(false));
      setNotice("");
      renderAll({ history: false });
    }, 0);
  });

  global.addEventListener("popstate", function () {
    isolatedPlanSession = false;
    global.clearTimeout(shareChangeHandle);
    shareChangeHandle = 0;
    state = cloneState(initialState(false));
    setNotice("");
    renderAll({ history: false });
    global.scrollTo({ top: root.offsetTop, behavior: "auto" });
  });

  global.addEventListener("resize", function () {
    scheduleTrackRowSync();
    scheduleTrackScrollUi();
    scheduleVirtualWindow();
  });

  if (useChunkVirtualization) {
    global.addEventListener("scroll", scheduleVirtualWindow, { passive: true });
  }

  function populateCaptureClone(copy, limit) {
    if (!useChunkVirtualization || !copy || !lastOutputs) return false;
    limit = clamp(intValue(limit, state.count), 1, state.count);
    var bodies = copy.querySelectorAll(".multi-track-table tbody");
    if (bodies.length < 2) return false;
    bodies[0].innerHTML = renderTrackRows(lastOutputs, 0, "A", 0, limit);
    bodies[1].innerHTML = renderTrackRows(lastOutputs, 1, "B", 0, limit);
    if (global.MultiFindApp &&
        typeof global.MultiFindApp.decorateRouteMarks === "function") {
      global.MultiFindApp.decorateRouteMarks(copy);
    }
    if (global.MultiPlanApp &&
        typeof global.MultiPlanApp.decorateMarks === "function") {
      global.MultiPlanApp.decorateMarks(copy);
    }
    return true;
  }

  global.MultiTrackApp = {
    getFindSnapshot: function () { return lastFindSnapshot; },
    getRowCount: function () { return state.count; },
    isVirtualized: function () { return useChunkVirtualization; },
    populateCaptureClone: populateCaptureClone,
    syncCaptureRows: function (container) {
      syncRowsIn(container, false);
    },
    getShareState: function () {
      var shared = cloneState(state);
      shared.formIndex = formIndex;
      return shared;
    },
    getPlanSelectedCats: function (marks) {
      return planSelectedCats(marks);
    },
    loadPlanState: function (saved) {
      if (!saved || !Array.isArray(saved.rows) || !saved.rows.length) {
        return false;
      }
      var nextState = cloneState(saved);
      if (!nextState.rows.length) return false;
      isolatedPlanSession = true;
      formIndex = intValue(saved.formIndex, formIndex);
      state = nextState;
      setNotice("");
      renderAll({ history: false });
      return true;
    },
    isPlanSessionActive: function () {
      return isolatedPlanSession;
    },
    markFindDirty: function () {
      setDirty(true);
      setNotice(applyNotice);
    }
  };

  renderAll();
})(typeof self !== "undefined" ? self : this);
