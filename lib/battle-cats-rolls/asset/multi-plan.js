(function (root, factory) {
  "use strict";

  var helpers = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = helpers;
  }
  if (!root || !root.document) return;

  var doc = root.document;
  var app = doc.getElementById("multi-track-app");
  var trackApp = root.MultiTrackApp;
  if (!app || !trackApp) return;

  var els = {
    mode: doc.getElementById("multi_plan_mode"),
    load: doc.getElementById("multi_plan_load"),
    name: doc.getElementById("multi_plan_name"),
    save: doc.getElementById("multi_plan_save"),
    status: doc.getElementById("multi_plan_status"),
    selectedCats: doc.getElementById("multi_plan_selected_cats"),
    tables: doc.getElementById("multi_tables"),
    dialog: doc.getElementById("multi_plan_dialog"),
    list: doc.getElementById("multi_plan_list"),
    empty: doc.getElementById("multi_plan_empty"),
    confirmDialog: doc.getElementById("multi_plan_confirm_dialog"),
    confirmTitle: doc.getElementById("multi_plan_confirm_title"),
    confirmMessage: doc.getElementById("multi_plan_confirm_message"),
    confirmAccept: doc.getElementById("multi_plan_confirm_accept")
  };
  if (!els.mode || !els.load || !els.name || !els.save || !els.status ||
      !els.selectedCats || !els.tables ||
      !els.dialog || !els.list || !els.empty || !els.confirmDialog ||
      !els.confirmTitle || !els.confirmMessage || !els.confirmAccept) return;

  var plans = readLibrary();
  var currentPlanId = null;
  var loadedSession = false;
  var marks = [];
  var planFingerprint = null;
  var marksFingerprint = null;
  var applyingPlan = false;
  var pendingConfirm = null;
  var routePlan = helpers.emptyRoutePlan();
  var cellNoticeTimer = 0;

  function h(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function readLibrary() {
    try {
      return helpers.normalizeLibrary(JSON.parse(
        root.localStorage.getItem(helpers.storageKey) || "null"));
    } catch (_error) {
      return helpers.emptyLibrary();
    }
  }

  function writeLibrary(library) {
    try {
      root.localStorage.setItem(helpers.storageKey, JSON.stringify(library));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function setStatus(message, error) {
    if (!els.status) return;
    els.status.textContent = message || "";
    els.status.hidden = !message;
    els.status.classList.toggle("is-error", !!error);
  }

  function markKey(mark) {
    return mark.column + ":" + mark.position + ":" + mark.kind;
  }

  function coordinateKey(mark) {
    return mark.column + ":" + mark.position;
  }

  function markFromCell(cell, kind) {
    return helpers.normalizeMark({
      column: cell && cell.getAttribute("data-plan-column-index"),
      position: cell && cell.getAttribute("data-route-position"),
      kind: kind
    });
  }

  function calculateRoutePlan(items) {
    var snapshot = trackApp.getFindSnapshot && trackApp.getFindSnapshot();
    return helpers.buildRoutePlan(root.MultiFindEngine, snapshot, items);
  }

  function refreshRoutePlan() {
    routePlan = calculateRoutePlan(marks);
  }

  function clearCellNotice() {
    if (cellNoticeTimer) root.clearTimeout(cellNoticeTimer);
    cellNoticeTimer = 0;
    els.tables.querySelectorAll(".multi-plan-cell-notice").forEach(function (notice) {
      notice.remove();
    });
  }

  function showCellNotice(cell, message) {
    clearCellNotice();
    var notice = doc.createElement("span");
    notice.className = "multi-plan-cell-notice";
    notice.setAttribute("role", "status");
    notice.textContent = message;
    cell.appendChild(notice);
    cellNoticeTimer = root.setTimeout(function () {
      notice.remove();
      cellNoticeTimer = 0;
    }, 1900);
  }

  function decorateMarks(container) {
    if (!container || !container.querySelectorAll) return;
    var selected = Object.create(null);
    var route = Object.create(null);
    var destinations = Object.create(null);
    marks.forEach(function (mark) { selected[coordinateKey(mark)] = mark; });
    routePlan.auto.forEach(function (item) { route[coordinateKey(item)] = true; });
    routePlan.destinations.forEach(function (item) {
      destinations[coordinateKey(item)] = item.kind;
    });
    container.querySelectorAll("[data-plan-pick-kind]").forEach(function (line) {
      line.classList.remove("multi-plan-picked-line");
    });
    container.querySelectorAll(
      "td[data-plan-column-index][data-route-position]").forEach(function (cell) {
        var coordinate = markFromCell(cell, "regular");
        var key = coordinate && coordinateKey(coordinate);
        var selectedMark = key && selected[key];
        var active = !!selectedMark;
        cell.classList.toggle("multi-plan-marked", active);
        cell.classList.toggle("multi-plan-route", !!(key && route[key]));
        cell.classList.toggle("multi-plan-next", !!(key && destinations[key]));
        if (key && destinations[key]) {
          cell.setAttribute("data-plan-next-kind", destinations[key]);
        } else {
          cell.removeAttribute("data-plan-next-kind");
        }
        if (active) {
          cell.setAttribute("aria-selected", "true");
          var pickedLine = cell.querySelector(
            '[data-plan-pick-kind="' + selectedMark.kind + '"]');
          if (pickedLine) pickedLine.classList.add("multi-plan-picked-line");
        } else {
          cell.removeAttribute("aria-selected");
        }
      });
    if (container === els.tables) renderSelectedCats();
  }

  function renderSelectedCats() {
    var cats = routePlan.ready ? routePlan.cats :
      (typeof trackApp.getPlanSelectedCats === "function" ?
        trackApp.getPlanSelectedCats(marks) : []);
    var summary = helpers.summarizeCats(cats);
    els.selectedCats.textContent = summary || "선택 없음";
    els.selectedCats.title = summary || "선택된 울슈레·레전드레어가 없습니다.";
    els.selectedCats.classList.toggle("is-empty", !summary);
  }

  function toggleMark(cell, kind) {
    clearCellNotice();
    var mark = markFromCell(cell, kind);
    if (!mark) return;
    var key = markKey(mark);
    var index = marks.findIndex(function (item) {
      return markKey(item) === key;
    });
    var previousMarks = marks.slice();
    var previousRoutePlan = routePlan;
    if (index === -1) {
      marks = marks.filter(function (item) {
        return item.column !== mark.column;
      });
      marks.push(mark);
    } else {
      marks.splice(index, 1);
    }
    routePlan = calculateRoutePlan(marks);
    if (index === -1 && (!routePlan.ready || routePlan.invalid)) {
      var rejectedRoutePlan = routePlan;
      marks = previousMarks;
      routePlan = previousRoutePlan;
      decorateMarks(els.tables);
      showCellNotice(cell, rejectedRoutePlan.ready ?
        "현재 구성으로 도달 불가" : "경로 데이터 불러오는 중");
      return;
    }
    marksFingerprint = marks.length ?
      (marksFingerprint || currentFingerprint()) : null;
    decorateMarks(els.tables);
    setStatus("강조 좌표 " + marks.length + "개 · 자동 경로 " +
      routePlan.auto.length + "칸 · 아직 플랜에 저장되지 않았습니다.");
  }

  function formatUpdated(value) {
    var date = new Date(value);
    if (isNaN(date.getTime())) return "";
    try {
      return date.toLocaleString("ko-KR", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit"
      });
    } catch (_error) {
      return date.toISOString();
    }
  }

  function renderPlans() {
    plans = readLibrary();
    els.empty.hidden = plans.plans.length > 0;
    els.list.innerHTML = plans.plans.map(function (plan) {
      var current = plan.id === currentPlanId;
      return [
        '<div class="multi-plan-card-row">',
        '<button type="button" class="multi-plan-card',
        current ? ' is-current' : '', '" data-plan-id="', h(plan.id), '">',
        '<span class="multi-plan-card-title">', h(plan.name),
        current ? '<small>현재</small>' : '', '</span>',
        '<span class="multi-plan-card-meta">Seed ', h(plan.track.seed),
        ' · ', plan.track.rows.length, ' banners · ', plan.track.count,
        ' rows · 강조 ', plan.marks.length, '개</span>',
        '<span class="multi-plan-card-time">', h(formatUpdated(plan.updatedAt)),
        '</span></button>',
        '<button type="button" class="multi-plan-delete" data-plan-delete-id="',
        h(plan.id), '" aria-label="', h(plan.name), ' 삭제">',
        '<svg viewBox="0 0 24 24" aria-hidden="true">',
        '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 11v6M14 11v6">',
        '</path></svg></button></div>'
      ].join("");
    }).join("");
  }

  function openDialog() {
    renderPlans();
    if (typeof els.dialog.showModal === "function") {
      els.dialog.showModal();
    } else {
      els.dialog.setAttribute("open", "");
    }
  }

  function closeDialog() {
    if (typeof els.dialog.close === "function") {
      els.dialog.close();
    } else {
      els.dialog.removeAttribute("open");
    }
  }

  function closeConfirm() {
    pendingConfirm = null;
    if (typeof els.confirmDialog.close === "function") {
      els.confirmDialog.close();
    } else {
      els.confirmDialog.removeAttribute("open");
    }
  }

  function openConfirm(options) {
    pendingConfirm = options && options.accept;
    els.confirmTitle.textContent = options.title;
    els.confirmMessage.textContent = options.message;
    els.confirmAccept.textContent = options.acceptLabel || "확인";
    els.confirmAccept.classList.toggle("is-danger", options.danger !== false);
    els.confirmAccept.classList.toggle("is-primary", options.danger === false);
    if (typeof els.confirmDialog.showModal === "function") {
      els.confirmDialog.showModal();
    } else {
      els.confirmDialog.setAttribute("open", "");
    }
  }

  function currentFingerprint() {
    var track = trackApp.getShareState && trackApp.getShareState();
    return track ? helpers.trackFingerprint(track) : null;
  }

  function syncPlanMode() {
    var active = !!els.mode.checked;
    app.classList.toggle("is-plan-mode", active);
    app.querySelectorAll([
      "#multi_form input:not([readonly])",
      "#multi_form button",
      "#multi_rows button",
      "#multi_rows input",
      "#multi_rows select",
      "#multi_add"
    ].join(",")).forEach(function (control) {
      if (active) {
        if (!control.disabled) {
          control.disabled = true;
          control.setAttribute("data-plan-locked", "true");
        }
      } else if (control.hasAttribute("data-plan-locked")) {
        control.removeAttribute("data-plan-locked");
        control.disabled = control.id === "multi_apply" ?
          !app.classList.contains("is-dirty") : false;
      }
    });
  }

  function handleTrackUpdate() {
    syncPlanMode();
    if (applyingPlan) {
      refreshRoutePlan();
      decorateMarks(els.tables);
      return;
    }
    var fingerprint = currentFingerprint();
    var detached = !!(currentPlanId && planFingerprint &&
      fingerprint !== planFingerprint);
    var cleared = !!(marks.length && marksFingerprint &&
      fingerprint !== marksFingerprint);
    if (detached) {
      currentPlanId = null;
      planFingerprint = null;
    }
    if (cleared) {
      marks = [];
      marksFingerprint = null;
    }
    refreshRoutePlan();
    decorateMarks(els.tables);
    if (detached || cleared) {
      setStatus("배열이 변경되어 기존 플랜과 분리하고 강조 좌표를 초기화했습니다.");
    }
  }

  function loadPlan(id) {
    plans = readLibrary();
    var plan = plans.plans.find(function (item) { return item.id === id; });
    if (!plan) {
      setStatus("저장된 플랜을 찾지 못했습니다.", true);
      renderPlans();
      return;
    }

    var previousMode = els.mode.checked;
    currentPlanId = plan.id;
    loadedSession = true;
    marks = plan.marks.map(function (mark) {
      return { column: mark.column, position: mark.position, kind: mark.kind };
    });
    els.name.value = plan.name;
    els.mode.checked = true;
    syncPlanMode();

    applyingPlan = true;
    var loaded = false;
    try {
      loaded = trackApp.loadPlanState(plan.track);
    } finally {
      applyingPlan = false;
    }
    if (!loaded) {
      currentPlanId = null;
      loadedSession = false;
      marks = [];
      planFingerprint = null;
      marksFingerprint = null;
      els.mode.checked = previousMode;
      syncPlanMode();
      setStatus("플랜 배열을 불러오지 못했습니다.", true);
      return;
    }
    planFingerprint = currentFingerprint();
    marksFingerprint = marks.length ? planFingerprint : null;
    refreshRoutePlan();
    decorateMarks(els.tables);
    closeDialog();
    setStatus("격리된 플랜을 불러왔습니다. 변경 내용은 플랜 저장을 누를 때만 반영됩니다.");
  }

  function persistPlan(name, track, existingId) {
    var saved = helpers.upsertPlan(readLibrary(), {
      name: name, track: track, marks: marks
    }, existingId);
    if (!saved.plan || !writeLibrary(saved.library)) {
      setStatus("브라우저 저장 공간에 플랜을 저장하지 못했습니다.", true);
      return false;
    }
    plans = saved.library;
    currentPlanId = saved.plan.id;
    marks = saved.plan.marks.map(function (mark) {
      return { column: mark.column, position: mark.position, kind: mark.kind };
    });
    els.name.value = saved.plan.name;
    planFingerprint = currentFingerprint();
    marksFingerprint = marks.length ? planFingerprint : null;
    refreshRoutePlan();
    decorateMarks(els.tables);
    setStatus("‘" + saved.plan.name + "’ 저장 완료 · 강조 " +
      saved.plan.marks.length + "개");
    if (els.dialog.open) renderPlans();
    return true;
  }

  function savePlan() {
    var name = String(els.name.value || "").trim();
    if (!name) {
      setStatus("플랜명을 입력해 주세요.", true);
      els.name.focus();
      return;
    }
    var track = trackApp.getShareState && trackApp.getShareState();
    if (!track) {
      setStatus("저장할 배열을 읽지 못했습니다.", true);
      return;
    }
    var existing = helpers.findPlanByName(readLibrary(), name);
    if (!existing) {
      persistPlan(name, track, null);
      return;
    }
    openConfirm({
      title: "플랜 덮어쓰기",
      message: "‘" + existing.name + "’ 플랜이 이미 있습니다.\n" +
        "기존 배열과 강조 좌표를 현재 내용으로 덮어씁니다.",
      acceptLabel: "덮어쓰기",
      danger: true,
      accept: function () { persistPlan(name, track, existing.id); }
    });
  }

  function deletePlan(id, name) {
    var next = helpers.removePlan(readLibrary(), id);
    if (!writeLibrary(next)) {
      setStatus("브라우저 저장 공간에서 플랜을 삭제하지 못했습니다.", true);
      return;
    }
    plans = next;
    var deletingCurrent = currentPlanId === id;
    if (deletingCurrent) {
      currentPlanId = null;
      planFingerprint = null;
    }
    renderPlans();
    setStatus("‘" + name + "’ 플랜을 삭제했습니다." +
      (deletingCurrent ? " 현재 화면은 저장되지 않은 임시 상태입니다." : ""));
  }

  function requestDelete(id) {
    var plan = readLibrary().plans.find(function (item) { return item.id === id; });
    if (!plan) {
      setStatus("삭제할 플랜을 찾지 못했습니다.", true);
      renderPlans();
      return;
    }
    openConfirm({
      title: "플랜 삭제",
      message: "‘" + plan.name + "’ 플랜을 삭제합니다.\n삭제 후에는 복구할 수 없습니다.",
      acceptLabel: "삭제",
      danger: true,
      accept: function () { deletePlan(plan.id, plan.name); }
    });
  }

  function resetUiSession() {
    currentPlanId = null;
    loadedSession = false;
    marks = [];
    planFingerprint = null;
    marksFingerprint = null;
    applyingPlan = false;
    pendingConfirm = null;
    routePlan = helpers.emptyRoutePlan();
    clearCellNotice();
    els.name.value = "";
    els.mode.checked = false;
    syncPlanMode();
    decorateMarks(els.tables);
    setStatus("");
  }

  els.mode.addEventListener("change", function () {
    if (els.mode.checked && app.classList.contains("is-dirty")) {
      els.mode.checked = false;
      syncPlanMode();
      setStatus("먼저 Apply를 눌러 배열 변경을 적용한 뒤 플랜 모드를 켜 주세요.", true);
      return;
    }
    syncPlanMode();
    setStatus(els.mode.checked ?
      "플랜 모드에서는 배열이 잠기며 좌표 강조만 편집할 수 있습니다." :
      "배열 편집이 가능합니다. 배열을 변경하면 기존 강조 좌표는 초기화됩니다.");
  });
  els.load.addEventListener("click", openDialog);
  els.save.addEventListener("click", savePlan);
  els.tables.addEventListener("click", function (event) {
    if (!els.mode.checked) return;
    var cell = event.target.closest && event.target.closest(
      "td[data-plan-column-index][data-route-position]");
    if (!cell) return;
    var pickedLine = event.target.closest("[data-plan-pick-kind]");
    var kind = pickedLine && cell.contains(pickedLine) ?
      pickedLine.getAttribute("data-plan-pick-kind") : "regular";
    event.preventDefault();
    event.stopPropagation();
    toggleMark(cell, kind);
  }, true);
  els.list.addEventListener("click", function (event) {
    var deleteButton = event.target.closest("button[data-plan-delete-id]");
    if (deleteButton) {
      requestDelete(deleteButton.getAttribute("data-plan-delete-id"));
      return;
    }
    var button = event.target.closest("button[data-plan-id]");
    if (button) loadPlan(button.getAttribute("data-plan-id"));
  });
  els.dialog.querySelector("[data-multi-plan-close]").addEventListener(
    "click", closeDialog);
  els.dialog.querySelector("[data-multi-plan-backdrop]").addEventListener(
    "click", closeDialog);
  els.dialog.addEventListener("cancel", function (event) {
    event.preventDefault();
    closeDialog();
  });
  els.confirmDialog.querySelector("[data-multi-plan-confirm-close]").
    addEventListener("click", closeConfirm);
  els.confirmDialog.querySelector("[data-multi-plan-confirm-cancel]").
    addEventListener("click", closeConfirm);
  els.confirmDialog.querySelector("[data-multi-plan-confirm-backdrop]").
    addEventListener("click", closeConfirm);
  els.confirmDialog.addEventListener("cancel", function (event) {
    event.preventDefault();
    closeConfirm();
  });
  els.confirmAccept.addEventListener("click", function () {
    var accept = pendingConfirm;
    closeConfirm();
    if (accept) accept();
  });
  doc.addEventListener("click", function (event) {
    if (!els.mode.checked || !event.target.closest) return;
    var recent = event.target.closest("#recent-seeds a[href]");
    if (!recent) return;
    event.preventDefault();
    event.stopPropagation();
    setStatus("플랜 모드에서는 최근 Seed 이동이 잠깁니다. 먼저 플랜 모드를 꺼 주세요.");
  }, true);
  app.addEventListener("multi-track:updated", handleTrackUpdate);
  app.addEventListener("multi-track:window-updated", function () {
    decorateMarks(els.tables);
  });
  root.addEventListener("multi-share:changed", resetUiSession);
  root.addEventListener("popstate", resetUiSession);
  root.addEventListener("storage", function (event) {
    if (event.key !== helpers.storageKey) return;
    plans = readLibrary();
    if (els.dialog.open) renderPlans();
  });

  root.MultiPlanApp = {
    decorateMarks: decorateMarks,
    isSessionActive: function () { return loadedSession; },
    getMarks: function () {
      return marks.map(function (mark) {
        return { column: mark.column, position: mark.position, kind: mark.kind };
      });
    }
  };
  syncPlanMode();
  refreshRoutePlan();
  decorateMarks(els.tables);
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var version = 1;
  var storageKey = "battle-cats-rolls.multiPlans.v1";
  var maxPlans = 100;

  function integer(value, fallback, min, max) {
    var parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) parsed = fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  function limitedText(value, maximum) {
    return String(value == null ? "" : value).slice(0, maximum);
  }

  function uniqueIntegers(values, maximum) {
    var seen = Object.create(null);
    return (Array.isArray(values) ? values : []).slice(0, maximum).map(function (value) {
      return integer(value, -1, -1, 10000000);
    }).filter(function (value) {
      if (value < 0 || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }

  function normalizeRow(row) {
    if (!row || typeof row !== "object") return null;
    var lang = limitedText(row.lang, 12);
    var event = limitedText(row.event, 180);
    if (!lang || !event) return null;
    return {
      lang: lang,
      event: event,
      ubers: integer(row.ubers, 0, 0, 20),
      customName: limitedText(row.customName, 160),
      customNameAuto: row.customNameAuto === true,
      seriesIds: uniqueIntegers(row.seriesIds, 100)
    };
  }

  function normalizeTrack(track) {
    if (!track || typeof track !== "object") return null;
    var rows = (Array.isArray(track.rows) ? track.rows : []).slice(0, 8)
      .map(normalizeRow).filter(Boolean);
    if (!rows.length) return null;
    return {
      seed: integer(track.seed, 1, 0, 4294967295),
      last: integer(track.last, 0, 0, 10000000),
      count: integer(track.count, 100, 1, 500),
      formIndex: integer(track.formIndex, 0, 0, 20),
      rows: rows
    };
  }

  function normalizeMark(mark, track) {
    if (!mark || typeof mark !== "object") return null;
    var column = parseInt(mark.column, 10);
    var position = limitedText(mark.position, 8).toUpperCase();
    var match = /^(\d{1,3})([AB])$/.exec(position);
    if (!Number.isFinite(column) || column < 0 || column > 7 || !match) return null;
    var sequence = parseInt(match[1], 10);
    if (!Number.isFinite(sequence) || sequence < 1 || sequence > 500) return null;
    if (track && (column >= track.rows.length || sequence > track.count)) return null;
    var kind = ["reroll", "guaranteed"].indexOf(mark.kind) === -1 ?
      "regular" : mark.kind;
    return { column: column, position: sequence + match[2], kind: kind };
  }

  function normalizeMarks(values, track) {
    var byColumn = Object.create(null);
    var columns = [];
    (Array.isArray(values) ? values : []).slice(0, 8000)
      .map(function (mark) { return normalizeMark(mark, track); })
      .forEach(function (mark) {
        if (!mark) return;
        if (!Object.prototype.hasOwnProperty.call(byColumn, mark.column)) {
          columns.push(mark.column);
        }
        byColumn[mark.column] = mark;
      });
    return columns.map(function (column) { return byColumn[column]; });
  }

  function summarizeCats(cats) {
    var entries = [];
    var byKey = Object.create(null);
    (Array.isArray(cats) ? cats : []).forEach(function (cat) {
      var rarity = parseInt(cat && cat.rarity, 10);
      var name = limitedText(cat && cat.name, 160).trim();
      if ([4, 5].indexOf(rarity) === -1 || !name) return;
      var id = parseInt(cat.id, 10);
      var key = rarity + ":" + (id > 0 ? id : name);
      if (!byKey[key]) {
        byKey[key] = { name: name, count: 0 };
        entries.push(byKey[key]);
      }
      byKey[key].count += 1;
    });
    return entries.map(function (entry) {
      return entry.name + (entry.count > 1 ? " ×" + entry.count : "");
    }).join(", ");
  }

  function emptyRoutePlan() {
    return {
      ready: false,
      valid: false,
      auto: [],
      destinations: [],
      cats: [],
      invalid: null,
      explored: 0
    };
  }

  function positionOffset(position) {
    var match = /^(\d{1,3})([AB])$/.exec(String(position || "").toUpperCase());
    if (!match) return -1;
    return (parseInt(match[1], 10) - 1) * 2 + (match[2] === "B" ? 1 : 0);
  }

  function routePosition(engine, offset) {
    if (engine && typeof engine.positionLabel === "function") {
      return engine.positionLabel(offset);
    }
    return (Math.floor(offset / 2) + 1) + (offset % 2 ? "B" : "A");
  }

  function routeCat(pull) {
    if (!pull) return null;
    return {
      id: pull.id,
      name: String(pull.name == null ? pull.id : pull.name),
      rarity: parseInt(pull.rarity, 10),
      guaranteed: pull.guaranteed === true
    };
  }

  function betterRouteCandidate(left, right) {
    if (!right) return true;
    var keys = ["special", "deviation", "draws"];
    for (var index = 0; index < keys.length; index += 1) {
      var key = keys[index];
      if (left[key] !== right[key]) return left[key] < right[key];
    }
    return left.order < right.order;
  }

  function routeChild(parent, attrs, step, order) {
    return {
      offset: attrs.offset,
      lastRareId: attrs.lastRareId || 0,
      special: parent.special + (attrs.special || 0),
      deviation: parent.deviation + (attrs.deviation || 0),
      draws: parent.draws + (attrs.draws || 0),
      order: order.value++,
      parent: parent,
      step: step
    };
  }

  function addRouteCandidate(bucket, candidate) {
    var key = String(candidate.lastRareId || 0);
    if (betterRouteCandidate(candidate, bucket[key])) bucket[key] = candidate;
  }

  function usableRouteRows(snapshot) {
    return (snapshot && Array.isArray(snapshot.rows) ? snapshot.rows : [])
      .map(function (row, column) {
        return { column: column, pool: row && row.pool };
      }).filter(function (row) {
        return row.pool && row.pool.exist !== false;
      });
  }

  function advanceRouteCandidates(engine, snapshot, starts, targetOffset,
    preferredColumn, order, explored) {
    var buckets = [];
    starts.forEach(function (candidate) {
      if (candidate.offset > targetOffset) return;
      buckets[candidate.offset] = buckets[candidate.offset] || Object.create(null);
      addRouteCandidate(buckets[candidate.offset], candidate);
    });
    var rows = usableRouteRows(snapshot);
    for (var offset = 0; offset < targetOffset; offset += 1) {
      var bucket = buckets[offset];
      if (!bucket) continue;
      Object.keys(bucket).forEach(function (stateKey) {
        var candidate = bucket[stateKey];
        rows.forEach(function (row) {
          if (explored.count >= explored.limit) return;
          explored.count += 1;
          var rolled;
          try {
            rolled = engine.simulateRegular(row.pool, snapshot.seed, offset,
              candidate.lastRareId, snapshot.formIndex || 0);
          } catch (_error) {
            return;
          }
          var nextOffset = parseInt(rolled && rolled.nextOffset, 10);
          if (!(nextOffset > offset) || nextOffset > targetOffset) return;
          var child = routeChild(candidate, {
            offset: nextOffset,
            lastRareId: rolled.lastRareId,
            special: row.pool.platinum ? 1 : 0,
            deviation: row.column === preferredColumn ? 0 : 1,
            draws: 1
          }, {
            auto: [{
              column: row.column,
              position: routePosition(engine, offset),
              kind: rolled.rerolled ? "reroll" : "regular"
            }],
            destinations: [],
            cats: [routeCat(rolled)]
          }, order);
          buckets[nextOffset] = buckets[nextOffset] || Object.create(null);
          addRouteCandidate(buckets[nextOffset], child);
        });
      });
      if (explored.count >= explored.limit) break;
    }
    return buckets[targetOffset] ? Object.keys(buckets[targetOffset]).map(
      function (key) { return buckets[targetOffset][key]; }) : [];
  }

  function applyRouteMark(engine, snapshot, candidate, mark, order) {
    var row = snapshot.rows[mark.column];
    var pool = row && row.pool;
    if (!pool || pool.exist === false || candidate.offset !== positionOffset(mark.position)) {
      return null;
    }
    if (mark.kind === "guaranteed") {
      if (pool.platinum || Number(pool.guaranteed_rolls) !== 11 ||
          typeof engine.simulateGuaranteed !== "function") return null;
      var guaranteed;
      try {
        guaranteed = engine.simulateGuaranteed(pool, snapshot.seed,
          candidate.offset, candidate.lastRareId,
          Math.max(1, parseInt(snapshot.count, 10) || 1) * 2 - 1,
          snapshot.formIndex || 0);
      } catch (_error) {
        return null;
      }
      if (!guaranteed || !(guaranteed.nextOffset > candidate.offset)) return null;
      var routePulls = (guaranteed.pulls || []).filter(function (pull) {
        return !pull.guaranteed && pull.start !== mark.position;
      }).map(function (pull) {
        return {
          column: mark.column,
          position: pull.start,
          kind: pull.rerolled ? "reroll" : "regular"
        };
      });
      return routeChild(candidate, {
        offset: guaranteed.nextOffset,
        lastRareId: guaranteed.lastRareId,
        draws: (guaranteed.pulls || []).length
      }, {
        auto: routePulls,
        destinations: [{
          column: mark.column,
          position: guaranteed.next || routePosition(engine, guaranteed.nextOffset),
          kind: "guaranteed"
        }],
        cats: (guaranteed.pulls || []).map(routeCat)
      }, order);
    }

    var rolled;
    try {
      rolled = engine.simulateRegular(pool, snapshot.seed, candidate.offset,
        candidate.lastRareId, snapshot.formIndex || 0);
    } catch (_error) {
      return null;
    }
    if (!rolled || (mark.kind === "reroll" ? !rolled.rerolled : rolled.rerolled)) {
      return null;
    }
    return routeChild(candidate, {
      offset: rolled.nextOffset,
      lastRareId: rolled.lastRareId,
      special: pool.platinum ? 1 : 0,
      draws: 1
    }, {
      auto: [],
      destinations: mark.kind === "reroll" ? [{
        column: mark.column,
        position: rolled.next || routePosition(engine, rolled.nextOffset),
        kind: "reroll"
      }] : [],
      cats: [routeCat(rolled)]
    }, order);
  }

  function dedupeRouteCandidates(candidates) {
    var result = Object.create(null);
    candidates.forEach(function (candidate) {
      var key = candidate.offset + ":" + (candidate.lastRareId || 0);
      if (betterRouteCandidate(candidate, result[key])) result[key] = candidate;
    });
    return Object.keys(result).map(function (key) { return result[key]; });
  }

  function bestRouteCandidate(candidates) {
    var best = null;
    candidates.forEach(function (candidate) {
      if (betterRouteCandidate(candidate, best)) best = candidate;
    });
    return best;
  }

  function materializeRoute(candidate) {
    var steps = [];
    while (candidate && candidate.parent) {
      steps.push(candidate.step);
      candidate = candidate.parent;
    }
    steps.reverse();
    return steps.reduce(function (result, step) {
      result.auto = result.auto.concat(step.auto || []);
      result.destinations = result.destinations.concat(step.destinations || []);
      result.cats = result.cats.concat((step.cats || []).filter(Boolean));
      return result;
    }, { auto: [], destinations: [], cats: [] });
  }

  function buildRoutePlan(engine, snapshot, marks) {
    var result = emptyRoutePlan();
    if (!engine || typeof engine.simulateRegular !== "function" ||
        !snapshot || !snapshot.ready || !Array.isArray(snapshot.rows)) return result;
    result.ready = true;
    var trackShape = { rows: snapshot.rows, count: snapshot.count };
    var orderedMarks = normalizeMarks(marks, trackShape).slice().sort(
      function (left, right) {
        var distance = positionOffset(left.position) - positionOffset(right.position);
        return distance || left.column - right.column;
      });
    if (!orderedMarks.length) {
      result.valid = true;
      return result;
    }

    var order = { value: 1 };
    var explored = { count: 0, limit: 200000 };
    var candidates = [{
      offset: 0,
      lastRareId: Math.max(0, parseInt(snapshot.last, 10) || 0),
      special: 0,
      deviation: 0,
      draws: 0,
      order: 0,
      parent: null,
      step: null
    }];
    for (var markIndex = 0; markIndex < orderedMarks.length; markIndex += 1) {
      var mark = orderedMarks[markIndex];
      var beforeCandidates = candidates;
      var reached = advanceRouteCandidates(engine, snapshot, beforeCandidates,
        positionOffset(mark.position), mark.column, order, explored);
      var applied = reached.map(function (candidate) {
        return applyRouteMark(engine, snapshot, candidate, mark, order);
      }).filter(Boolean);
      candidates = dedupeRouteCandidates(applied);
      if (!candidates.length) {
        var previous = bestRouteCandidate(beforeCandidates);
        var partial = previous ? materializeRoute(previous) :
          { auto: [], destinations: [], cats: [] };
        result.auto = partial.auto;
        result.destinations = partial.destinations;
        result.cats = partial.cats;
        result.invalid = mark;
        result.explored = explored.count;
        return result;
      }
    }
    var materialized = materializeRoute(bestRouteCandidate(candidates));
    result.valid = true;
    result.auto = materialized.auto;
    result.destinations = materialized.destinations;
    result.cats = materialized.cats;
    result.explored = explored.count;
    return result;
  }

  function normalizePlan(plan) {
    if (!plan || typeof plan !== "object") return null;
    var id = limitedText(plan.id, 120).trim();
    var name = limitedText(plan.name, 80).trim();
    var track = normalizeTrack(plan.track);
    if (!id || !name || !track) return null;
    return {
      id: id,
      name: name,
      createdAt: limitedText(plan.createdAt, 40),
      updatedAt: limitedText(plan.updatedAt, 40),
      track: track,
      marks: normalizeMarks(plan.marks, track)
    };
  }

  function emptyLibrary() {
    return { version: version, plans: [] };
  }

  function normalizeLibrary(library) {
    if (!library || library.version !== version || !Array.isArray(library.plans)) {
      return emptyLibrary();
    }
    var seen = Object.create(null);
    var normalized = library.plans.slice(0, maxPlans).map(normalizePlan)
      .filter(function (plan) {
        if (!plan || seen[plan.id]) return false;
        seen[plan.id] = true;
        return true;
      });
    normalized.sort(function (a, b) {
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
    return { version: version, plans: normalized };
  }

  function findPlanByName(library, name) {
    var normalizedName = limitedText(name, 80).trim();
    if (!normalizedName) return null;
    return normalizeLibrary(library).plans.find(function (plan) {
      return plan.name === normalizedName;
    }) || null;
  }

  function removePlan(library, id) {
    var normalizedId = limitedText(id, 120);
    var normalized = normalizeLibrary(library);
    return normalizeLibrary({
      version: version,
      plans: normalized.plans.filter(function (plan) {
        return plan.id !== normalizedId;
      })
    });
  }

  function trackFingerprint(track) {
    var normalized = normalizeTrack(track);
    return normalized ? JSON.stringify(normalized) : "";
  }

  function createId() {
    return "plan-" + Date.now().toString(36) + "-" +
      Math.random().toString(36).slice(2, 9);
  }

  function upsertPlan(library, input, existingId, timestamp, generatedId) {
    var normalizedLibrary = normalizeLibrary(library);
    var existing = normalizedLibrary.plans.find(function (plan) {
      return plan.id === existingId;
    });
    var now = timestamp || new Date().toISOString();
    var candidate = normalizePlan({
      id: existing ? existing.id : (generatedId || createId()),
      name: input && input.name,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      track: input && input.track,
      marks: input && input.marks
    });
    if (!candidate) return { library: normalizedLibrary, plan: null };
    var remaining = normalizedLibrary.plans.filter(function (plan) {
      return plan.id !== candidate.id && plan.name !== candidate.name;
    });
    var next = normalizeLibrary({
      version: version,
      plans: [candidate].concat(remaining).slice(0, maxPlans)
    });
    return { library: next, plan: candidate };
  }

  return {
    version: version,
    storageKey: storageKey,
    emptyLibrary: emptyLibrary,
    normalizeMark: normalizeMark,
    normalizeTrack: normalizeTrack,
    normalizePlan: normalizePlan,
    normalizeLibrary: normalizeLibrary,
    summarizeCats: summarizeCats,
    emptyRoutePlan: emptyRoutePlan,
    positionOffset: positionOffset,
    buildRoutePlan: buildRoutePlan,
    findPlanByName: findPlanByName,
    removePlan: removePlan,
    trackFingerprint: trackFingerprint,
    upsertPlan: upsertPlan
  };
});
