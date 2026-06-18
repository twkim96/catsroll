(function () {
  "use strict";

  var settingsKey = "battle-cats-rolls.trackCompare.v1";
  var cacheKey = "battle-cats-rolls.trackCompare.cache.v1";
  var maxEvents = 2;
  var ttlMs = 30 * 24 * 60 * 60 * 1000;
  var eventLangs = ["kr", "jp"];
  var eventListCache = {};

  function now() {
    return Date.now();
  }

  function currentParams() {
    return new URL(window.location.href).searchParams;
  }

  function currentLang() {
    return currentParams().get("lang") || "en";
  }

  function currentEvent() {
    var select = document.getElementById("event_select");
    return select && select.value;
  }

  function readJson(key, fallback) {
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || "null");
      return parsed || fallback;
    } catch (_error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_error) {
      // Ignore private browsing or blocked localStorage.
    }
  }

  function entryId(entry) {
    return [entry.lang, entry.event, entry.ubers || 0].join("|");
  }

  function sameMainEvent(entry) {
    return entry.lang === currentLang() && entry.event === currentEvent();
  }

  function normalizeEntry(entry) {
    if (typeof entry === "string") {
      entry = {lang: currentLang(), event: entry, ubers: 0};
    }
    if (!entry || eventLangs.indexOf(entry.lang) < 0 || !entry.event) {
      return null;
    }
    entry.ubers = Math.max(0, parseInt(entry.ubers || 0, 10) || 0);
    if (entry.event === "custom" || sameMainEvent(entry)) {
      return null;
    }
    return {
      lang: entry.lang,
      event: entry.event,
      ubers: entry.ubers,
      label: entry.label || ""
    };
  }

  function readSettings() {
    var settings = readJson(settingsKey, {events: []});
    var seen = {};
    var entries = (Array.isArray(settings.events) ? settings.events : []).
      map(normalizeEntry).
      filter(function (entry) {
        if (!entry || seen[entryId(entry)]) {
          return false;
        }
        seen[entryId(entry)] = true;
        return true;
      }).
      slice(0, maxEvents);

    return {events: entries};
  }

  function writeSettings(settings) {
    writeJson(settingsKey, {events: settings.events.slice(0, maxEvents)});
  }

  function readCache() {
    var cache = readJson(cacheKey, {version: 1, results: {}});
    return {
      version: 1,
      results: cache && cache.results ? cache.results : {}
    };
  }

  function writeCache(cache) {
    writeJson(cacheKey, {version: 1, results: cache.results});
  }

  function clearCache() {
    writeJson(cacheKey, {version: 1, results: {}});
  }

  function pruneCache(cache) {
    var threshold = now() - ttlMs;
    Object.keys(cache.results).forEach(function (key) {
      if (!cache.results[key] || cache.results[key].storedAt < threshold) {
        delete cache.results[key];
      }
    });
  }

  function injectStyle() {
    if (document.getElementById("track-compare-style")) {
      return;
    }

    var style = document.createElement("style");
    style.id = "track-compare-style";
    style.textContent = [
      ".track-compare-open{margin-left:.35rem;padding:.16rem .45rem;",
      "font-size:.86rem;line-height:1.2;border:1px solid #111;",
      "border-radius:3px;background:transparent;color:#111}",
      ".track-compare-open:hover{background:#f3f3f3}",
      ".track-compare-boxes{display:block;margin:-.35em -.45em .25em;",
      "width:auto}",
      ".track-compare-box{box-sizing:border-box;min-height:1.6em;width:100%;",
      "max-width:none;padding:1px 0;border:0;border-bottom:1px solid #b44;",
      "border-radius:0;background:transparent;color:#123;line-height:1.1;font-size:.56em;",
      "appearance:none;-webkit-appearance:none;",
      "text-align:center;overflow:hidden;display:-webkit-box;",
      "-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal;",
      "overflow-wrap:anywhere;cursor:pointer}",
      ".track-compare-box.loading{color:#777}",
      ".track-compare-box.empty{color:#999}",
      ".track-compare-box.rare{border-bottom-color:#999}",
      ".track-compare-box.supa,.track-compare-box.supa_fest{border-bottom-color:#d8b400}",
      ".track-compare-box.uber,.track-compare-box.uber_fest{border-bottom-color:#d33}",
      ".track-compare-box.legend{border-bottom-color:#7a4cb0}",
      ".track-compare-modal-backdrop{position:fixed;inset:0;z-index:40;",
      "background:rgba(0,0,0,.28);display:flex;align-items:center;",
      "justify-content:center;padding:1rem}",
      ".track-compare-modal{background:#fff;color:#222;border:1px solid #999;",
      "box-shadow:0 6px 24px rgba(0,0,0,.22);max-width:38rem;",
      "width:min(38rem,100%);max-height:80vh;overflow:auto;padding:1rem}",
      ".track-compare-modal h2{font-size:1.1rem;margin:.1rem 0 .75rem}",
      ".track-compare-slot{display:grid;grid-template-columns:4.5rem 1fr 5.5rem;",
      "gap:.45rem;align-items:center;margin:.55rem 0}",
      ".track-compare-slot select,.track-compare-slot input{box-sizing:border-box;",
      "width:100%;min-width:0}",
      ".track-compare-slot-title{font-weight:bold;margin-top:.8rem}",
      ".track-compare-modal-actions{text-align:right;margin-top:.8rem}",
      ".track-compare-modal button{margin-left:.35rem}",
      "@media (max-width:760px){.track-compare-box{font-size:.52em}",
      ".track-compare-slot{grid-template-columns:1fr}.track-compare-slot-title{",
      "margin-top:1rem}}"
    ].join("");
    document.head.appendChild(style);
  }

  function setupButton() {
    var select = document.getElementById("event_select");
    if (!select || document.getElementById("track-compare-open")) {
      return;
    }

    var button = document.createElement("button");
    button.type = "button";
    button.id = "track-compare-open";
    button.className = "track-compare-open";
    button.textContent = "확장 비교";
    button.addEventListener("click", openModal);
    var label = document.querySelector('label[for="event_select"]');
    (label || select).insertAdjacentElement("afterend", button);
  }

  function fetchEventList(lang) {
    if (eventListCache[lang]) {
      return eventListCache[lang];
    }

    var url = new URL("/expand/events", window.location.href);
    url.searchParams.set("lang", lang);
    eventListCache[lang] = fetch(url.toString(), {
      headers: {"Accept": "application/json"}
    }).
      then(function (response) {
        if (!response.ok) {
          return {lang: lang, events: []};
        }
        return response.json();
      }).
      catch(function () {
        return {lang: lang, events: []};
      });
    return eventListCache[lang];
  }

  function allEventLists() {
    return Promise.all(eventLangs.map(fetchEventList));
  }

  function optionLabel(entry) {
    if (entry.label) {
      return entry.label;
    }
    return entry.lang.toUpperCase() + " " + entry.event;
  }

  function settingsSignature(settings) {
    return settings.events.map(entryId).join("\n");
  }

  function openModal() {
    injectStyle();

    var old = document.getElementById("track-compare-modal");
    if (old) {
      old.remove();
    }

    var backdrop = document.createElement("div");
    backdrop.id = "track-compare-modal";
    backdrop.className = "track-compare-modal-backdrop";

    var modal = document.createElement("div");
    modal.className = "track-compare-modal";
    modal.addEventListener("click", function (event) {
      event.stopPropagation();
    });

    var title = document.createElement("h2");
    title.textContent = "확장 이벤트";
    modal.appendChild(title);

    var list = document.createElement("div");
    list.textContent = "Loading...";
    modal.appendChild(list);

    var actions = document.createElement("div");
    actions.className = "track-compare-modal-actions";

    var clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "선택 해제";
    clear.addEventListener("click", function () {
      Array.prototype.forEach.call(
        list.querySelectorAll("select[data-role=event]"), function (select) {
          select.value = "";
        });
    });
    actions.appendChild(clear);

    var save = document.createElement("button");
    save.type = "button";
    save.textContent = "저장";
    save.addEventListener("click", function () {
      saveSelection(list);
      backdrop.remove();
    });
    actions.appendChild(save);

    modal.appendChild(actions);
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", function () {
      backdrop.remove();
    });
    document.body.appendChild(backdrop);

    allEventLists().then(function (lists) {
      renderModalList(list, lists);
    });
  }

  function renderModalList(list, lists) {
    var settings = readSettings();
    var eventLists = lists.reduce(function (result, data) {
      result[data.lang] = data.events;
      return result;
    }, {});

    list.textContent = "";
    list._trackCompareEventLists = eventLists;

    for (var index = 0; index < maxEvents; index += 1) {
      renderSlot(list, index, settings.events[index] || null);
    }
  }

  function renderSlot(list, index, selected) {
    var title = document.createElement("div");
    title.className = "track-compare-slot-title";
    title.textContent = "확장 " + (index + 1);
    list.appendChild(title);

    var row = document.createElement("div");
    row.className = "track-compare-slot";

    var lang = document.createElement("select");
    lang.setAttribute("data-role", "lang");
    eventLangs.forEach(function (value) {
      var option = document.createElement("option");
      option.value = value;
      option.textContent = value.toUpperCase();
      lang.appendChild(option);
    });

    var event = document.createElement("select");
    event.setAttribute("data-role", "event");

    var ubers = document.createElement("input");
    ubers.type = "number";
    ubers.min = "0";
    ubers.max = "99";
    ubers.value = selected ? selected.ubers || 0 : 0;
    ubers.title = "ubers";

    lang.value = selected ? selected.lang : defaultModalLang();
    populateEventSelect(list, event, lang.value, selected && selected.event);

    lang.addEventListener("change", function () {
      populateEventSelect(list, event, lang.value, "");
    });

    row.appendChild(lang);
    row.appendChild(event);
    row.appendChild(ubers);
    list.appendChild(row);
  }

  function defaultModalLang() {
    return eventLangs.indexOf(currentLang()) >= 0 ? currentLang() : eventLangs[0];
  }

  function populateEventSelect(list, select, lang, selectedEvent) {
    var events = list._trackCompareEventLists[lang] || [];
    select.textContent = "";

    var empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "선택 안 함";
    select.appendChild(empty);

    events.forEach(function (event) {
      var entry = {lang: lang, event: event.event, ubers: 0};
      if (sameMainEvent(entry)) {
        return;
      }

      var option = document.createElement("option");
      option.value = event.event;
      option.textContent = event.label;
      option.setAttribute("data-label", event.label);
      select.appendChild(option);
    });

    select.value = selectedEvent || "";
    if (select.value !== selectedEvent) {
      select.value = "";
    }
  }

  function saveSelection(list) {
    var seen = {};
    var next = Array.prototype.slice.call(
      list.querySelectorAll(".track-compare-slot")).
      map(function (row) {
      var lang = row.querySelector("select[data-role=lang]");
      var event = row.querySelector("select[data-role=event]");
      var selectedOption = event && event.options[event.selectedIndex];
      var ubers = row.querySelector("input[type=number]");
      return {
        lang: lang && lang.value,
        event: event && event.value,
        label: selectedOption && selectedOption.getAttribute("data-label"),
        ubers: Math.max(0, parseInt((ubers && ubers.value) || 0, 10) || 0)
      };
    }).map(normalizeEntry).filter(function (entry) {
      if (!entry || seen[entryId(entry)]) {
        return false;
      }
      seen[entryId(entry)] = true;
      return true;
    }).slice(0, maxEvents);

    var previous = settingsSignature(readSettings());
    var settings = {events: next};
    writeSettings(settings);
    if (previous !== settingsSignature(settings)) {
      clearCache();
    }
    renderBoxes();
  }

  function cellKey(cell, entry) {
    return [
      entry.lang,
      entry.event,
      entry.ubers || 0,
      cell.getAttribute("data-expand-kind"),
      cell.getAttribute("data-expand-rarity-seed") || "",
      cell.getAttribute("data-expand-slot-seed"),
      currentParams().get("name") || "0"
    ].join("|");
  }

  function applyResult(button, result) {
    button.className = "track-compare-box";
    if (!result || result.available === false) {
      button.classList.add("empty");
      button.textContent = "-";
      return;
    }
    if (result.rarity) {
      button.classList.add(result.rarity);
    }
    button.textContent = result.name || "-";
  }

  function cachedResult(cell, entry) {
    var cache = readCache();
    pruneCache(cache);
    writeCache(cache);

    var result = cache.results[cellKey(cell, entry)];
    return result && result.value;
  }

  function storeResult(cell, entry, result) {
    var cache = readCache();
    pruneCache(cache);
    cache.results[cellKey(cell, entry)] = {
      storedAt: now(),
      value: result
    };
    writeCache(cache);
  }

  function resultUrl(cell, entry) {
    var url = new URL("/expand/result", window.location.href);
    var params = currentParams();
    url.searchParams.set("lang", entry.lang);
    url.searchParams.set("event", entry.event);
    url.searchParams.set("kind", cell.getAttribute("data-expand-kind"));
    url.searchParams.set(
      "slot_seed", cell.getAttribute("data-expand-slot-seed"));
    url.searchParams.set("ubers", entry.ubers || 0);
    if (cell.getAttribute("data-expand-rarity-seed")) {
      url.searchParams.set(
        "rarity_seed", cell.getAttribute("data-expand-rarity-seed"));
    }
    if (params.get("name")) {
      url.searchParams.set("name", params.get("name"));
    }
    return url.toString();
  }

  function loadCell(cell) {
    Array.prototype.forEach.call(
      cell.querySelectorAll(".track-compare-box"), function (button) {
        var entry = JSON.parse(button.getAttribute("data-entry"));
        var cached = cachedResult(cell, entry);
        if (cached) {
          applyResult(button, cached);
          return;
        }

        button.className = "track-compare-box loading";
        button.textContent = "...";
        fetch(resultUrl(cell, entry), {headers: {"Accept": "application/json"}}).
          then(function (response) {
            if (!response.ok) {
              return {available: false};
            }
            return response.json();
          }).
          then(function (result) {
            storeResult(cell, entry, result);
            applyResult(button, result);
          }).
          catch(function () {
            applyResult(button, {available: false});
          });
      });
  }

  function renderBoxes() {
    injectStyle();

    var settings = readSettings();
    var cells = document.querySelectorAll("td.cat[data-expand-slot-seed]");

    Array.prototype.forEach.call(cells, function (cell) {
      var old = cell.querySelector(".track-compare-boxes");
      if (old) {
        old.remove();
      }
      if (!settings.events.length) {
        return;
      }

      var wrap = document.createElement("div");
      wrap.className = "track-compare-boxes";
      wrap.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        loadCell(cell);
      });

      settings.events.forEach(function (entry) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "track-compare-box";
        button.setAttribute("data-entry", JSON.stringify(entry));
        button.title = entry.lang.toUpperCase() + " " + optionLabel(entry);
        var cached = cachedResult(cell, entry);
        if (cached) {
          applyResult(button, cached);
        }
        wrap.appendChild(button);
      });

      cell.insertBefore(wrap, cell.firstChild);
    });
  }

  function init() {
    if (!document.getElementById("event_select")) {
      return;
    }

    injectStyle();
    setupButton();
    writeSettings(readSettings());
    renderBoxes();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
