(function (global) {
  "use strict";

  var storageKey = "battle-cats-rolls.multiTrack.v1";
  var applyNotice = "Press Apply to update tracks.";
  var doc = global.document;
  var root = doc.getElementById("multi-track-app");
  if (!root || !global.TrackEngine) {
    return;
  }

  var data = JSON.parse(doc.getElementById("multi_track_data").textContent);
  var limits = data.limits || { rows: 5, count: 500 };
  var formIndex = parseInt(data.initial.name, 10) || 0;
  var regionKeys = Object.keys(data.regions);
  var defaultLang = data.regions[data.initial.lang] ?
    data.initial.lang : regionKeys[0];

  var els = {
    form: doc.getElementById("multi_form"),
    seed: doc.getElementById("multi_seed"),
    count: doc.getElementById("multi_count"),
    last: doc.getElementById("multi_last"),
    lastHint: doc.getElementById("multi_last_hint"),
    apply: doc.getElementById("multi_apply"),
    add: doc.getElementById("multi_add"),
    rows: doc.getElementById("multi_rows"),
    tables: doc.getElementById("multi_tables"),
    notice: doc.getElementById("multi_notice"),
    summary: doc.getElementById("multi_summary")
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
    var event = eventData(lang, row.event) ? row.event : defaultEvent(lang);
    return {
      lang: lang,
      event: event,
      ubers: clamp(intValue(row.ubers, 0), 0, 20),
      customName: String(row.customName || "")
    };
  }

  function readSaved() {
    try {
      return JSON.parse(global.localStorage.getItem(storageKey) || "null");
    } catch (_error) {
      return null;
    }
  }

  function writeSaved(state) {
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
      rows: [validRow({ lang: lang, event: event, ubers: 0, customName: "" })]
    };
  }

  function initialState() {
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
          customName: first.customName
        });
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

  var state = cloneState(initialState());
  var draft = cloneState(state);
  var dirty = false;
  var syncHandle = 0;

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
    if (row.customName) return row.customName;
    return regionLabel + " " + (ev ? ev.label : row.event);
  }

  function shortRowTitle(row) {
    if (row.customName) return row.customName;
    var ev = eventData(row.lang, row.event);
    var label = ev ? ev.label : row.event;
    return region(row.lang).label + " " + label.replace(/:.*$/, "");
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
      var options = region(row.lang).events.filter(function (event) {
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
        '<label><span>Region</span><select data-field="lang">',
          renderRegionOptions(row.lang), '</select></label>',
        '<label><span>Event</span><select data-field="event">',
          renderEventOptions(row), '</select></label>',
        '<label><span>F/U</span>',
          '<input data-field="ubers" type="number" min="0" max="20" value="',
          h(row.ubers), '"></label>',
        '<label><span>Custom name</span>',
          '<input data-field="customName" value="', h(row.customName),
          '" placeholder="Custom name"></label>',
        '</div>'
      ].join("");
    }).join("");
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
        out: global.TrackEngine.buildTracks(pool, state.seed, {
          count: state.count,
          position: "1A",
          last: state.last || 0,
          guaranteedRolls: pool.guaranteed_rolls,
          guaranteed: true,
          findCat: false
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
    var parts = ['<span class="multi-cat-name">', catNameHtml(cat, row), '</span>'];
    var next = nextLabel(cat);
    if (next) parts.push('<span class="multi-cat-next">', h(next), '</span>');
    if (cat.rerolled) {
      parts.push('<span class="multi-cat-guaranteed">R: ',
        catNameHtml(cat.rerolled, row));
      var rerollNext = nextLabel(cat.rerolled);
      if (rerollNext) parts.push(' ', h(rerollNext));
      parts.push('</span>');
    }
    if (cat.guaranteed) {
      parts.push('<span class="multi-cat-guaranteed">G: ',
        catNameHtml(cat.guaranteed, row));
      var guaranteedNext = nextLabel(cat.guaranteed);
      if (guaranteedNext) parts.push(' ', h(guaranteedNext));
      parts.push('</span>');
    }
    return parts.join("");
  }

  function cellClass(cat) {
    var cls = cat ? cat.rarityLabel() : "";
    if (cat && cat.next && cat.next.track !== cat.track) {
      cls += " multi-cat-switch";
    }
    return cls;
  }

  function renderTrackCells(outputs, index, track) {
    return outputs.map(function (item) {
      var cat = item.out && item.out.cats[index] && item.out.cats[index][track];
      return '<td class="' + h(cellClass(cat)) + '">' +
        (item.error ? h(item.error) : cellHtml(cat, item.row)) + '</td>';
    }).join("");
  }

  function renderTrackHeaders(outputs) {
    return outputs.map(function (item) {
      return '<th title="' + h(item.title || item.label) + '">' +
        h(item.label) + "</th>";
    }).join("");
  }

  function renderTrackTable(outputs, track, label) {
    var html = [
      '<section class="multi-track-section">',
      '<h2>Track ', label, '</h2>',
      '<div class="multi-table-wrap"><table class="multi-track-table">',
      '<thead><tr><th>No.</th>', renderTrackHeaders(outputs),
      '</tr></thead><tbody>'
    ];

    for (var i = 0; i < state.count; i++) {
      html.push('<tr><td>', i + 1, label, '</td>',
        renderTrackCells(outputs, i, track), '</tr>');
    }

    html.push('</tbody></table></div></section>');
    return html.join("");
  }

  function syncTrackRowHeights() {
    syncHandle = 0;
    var bodies = els.tables.querySelectorAll(".multi-track-table tbody");
    if (bodies.length < 2) return;

    var aRows = bodies[0].querySelectorAll("tr");
    var bRows = bodies[1].querySelectorAll("tr");
    var length = Math.min(aRows.length, bRows.length);

    for (var i = 0; i < length; i++) {
      aRows[i].style.height = "";
      bRows[i].style.height = "";
    }

    for (var j = 0; j < length; j++) {
      var height = Math.max(aRows[j].offsetHeight, bRows[j].offsetHeight);
      if (height > 0) {
        aRows[j].style.height = height + "px";
        bRows[j].style.height = height + "px";
      }
    }
  }

  function scheduleTrackRowSync() {
    if (syncHandle) {
      global.cancelAnimationFrame(syncHandle);
    }
    syncHandle = global.requestAnimationFrame(syncTrackRowHeights);
  }

  function renderTables() {
    var outputs = buildOutputs();
    els.summary.textContent = state.rows.length + " banners / " +
      state.count + " rows" + (state.last ? " / last " + state.last : "");
    els.tables.innerHTML = '<div class="multi-track-pair">' +
      renderTrackTable(outputs, 0, "A") +
      renderTrackTable(outputs, 1, "B") +
      '</div>';
    scheduleTrackRowSync();
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
    if (field === "lang") {
      draft.rows[index].event = defaultEvent(target.value);
      draft.rows[index] = validRow(draft.rows[index]);
      renderRows();
    } else if (field === "ubers") {
      draft.rows[index].ubers = clamp(intValue(target.value, 0), 0, 20);
    } else if (field === "event") {
      draft.rows[index] = validRow(draft.rows[index]);
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
      customName: ""
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
    var link = event.target.closest("a[data-action='advance']");
    if (!link) return;
    event.preventDefault();

    state.seed = intValue(link.dataset.seed, state.seed) >>> 0;
    state.last = intValue(link.dataset.last, 0);
    setNotice("");
    renderAll({ history: "push" });
    global.scrollTo({ top: root.offsetTop, behavior: "smooth" });
  });

  global.addEventListener("popstate", function () {
    state = cloneState(initialState());
    setNotice("");
    renderAll({ history: false });
    global.scrollTo({ top: root.offsetTop, behavior: "auto" });
  });

  global.addEventListener("resize", scheduleTrackRowSync);

  renderAll();
})(typeof self !== "undefined" ? self : this);
