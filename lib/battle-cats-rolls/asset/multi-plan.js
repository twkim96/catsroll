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
    reset: doc.getElementById("multi_plan_reset"),
    save: doc.getElementById("multi_plan_save"),
    status: doc.getElementById("multi_plan_status"),
    selectedCats: doc.getElementById("multi_plan_selected_cats"),
    tables: doc.getElementById("multi_tables"),
    dialog: doc.getElementById("multi_plan_dialog"),
    list: doc.getElementById("multi_plan_list"),
    empty: doc.getElementById("multi_plan_empty"),
    catsDialog: doc.getElementById("multi_plan_cats_dialog"),
    catsList: doc.getElementById("multi_plan_cats_list"),
    catsEmpty: doc.getElementById("multi_plan_cats_empty"),
    confirmDialog: doc.getElementById("multi_plan_confirm_dialog"),
    confirmTitle: doc.getElementById("multi_plan_confirm_title"),
    confirmMessage: doc.getElementById("multi_plan_confirm_message"),
    confirmAccept: doc.getElementById("multi_plan_confirm_accept")
  };
  if (!els.mode || !els.load || !els.name || !els.reset || !els.save ||
      !els.status ||
      !els.selectedCats || !els.tables ||
      !els.dialog || !els.list || !els.empty || !els.confirmDialog ||
      !els.catsDialog || !els.catsList || !els.catsEmpty ||
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
  var savedDraftSignature = null;
  var selectedCatEntries = [];
  var pendingSharedPlan = null;

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
    return mark.column + ":" + mark.position + ":" + mark.kind + ":" +
      (mark.variant || "");
  }

  function copyMark(mark) {
    var result = {
      column: mark.column, position: mark.position, kind: mark.kind
    };
    if (mark.variant) result.variant = mark.variant;
    return result;
  }

  function copyMarks(values) {
    return (Array.isArray(values) ? values : []).map(copyMark);
  }

  function sharePlanState() {
    if (!els.mode.checked) return null;
    var name = String(els.name.value || "").trim();
    if (!name && !marks.length) return null;
    return { name: name, marks: copyMarks(marks) };
  }

  function syncSharedPlanState() {
    if (!root.MultiShareApp || !root.MultiShareApp.isActive() ||
        typeof root.MultiShareApp.setPlanState !== "function") return;
    root.MultiShareApp.setPlanState(sharePlanState());
  }

  function coordinateKey(mark) {
    return mark.column + ":" + mark.position;
  }

  function markFromCell(cell, kind, variant) {
    return helpers.normalizeMark({
      column: cell && cell.getAttribute("data-plan-column-index"),
      position: cell && cell.getAttribute("data-route-position"),
      kind: kind,
      variant: variant
    });
  }

  function calculateRoutePlan(items, preferredAuto, routeOptions) {
    routeOptions = routeOptions || {};
    var snapshot = trackApp.getFindSnapshot && trackApp.getFindSnapshot();
    return helpers.buildRoutePlan(root.MultiFindEngine, snapshot, items, {
      preferredAuto: preferredAuto,
      allowAutomaticSpecial: routeOptions.allowAutomaticSpecial === true,
      pruneInvalid: routeOptions.pruneInvalid === true
    });
  }

  function calculateSpecialTicketHint(items, preferredAuto) {
    var snapshot = trackApp.getFindSnapshot && trackApp.getFindSnapshot();
    if (!snapshot || !Array.isArray(snapshot.rows) ||
        !snapshot.rows.some(function (row) {
          return row && row.pool && row.pool.platinum;
        })) return "";
    var hinted = helpers.buildRoutePlan(root.MultiFindEngine, snapshot, items, {
      preferredAuto: preferredAuto,
      allowAutomaticSpecial: true
    });
    return helpers.specialTicketRouteHint(snapshot, hinted);
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

  function showCellNotice(cell, message, duration) {
    clearCellNotice();
    duration = duration || 1900;
    var notice = doc.createElement("span");
    notice.className = "multi-plan-cell-notice";
    notice.setAttribute("role", "status");
    notice.textContent = message;
    notice.style.setProperty("--multi-plan-notice-duration",
      (duration / 1000) + "s");
    cell.appendChild(notice);
    cellNoticeTimer = root.setTimeout(function () {
      notice.remove();
      cellNoticeTimer = 0;
    }, duration);
  }

  function decorateMarks(container) {
    if (!container || !container.querySelectorAll) return;
    var visible = !!els.mode.checked;
    var selected = Object.create(null);
    var selectedPositions = Object.create(null);
    var route = Object.create(null);
    var destinations = Object.create(null);
    var destinationPositions = Object.create(null);
    var selectionVariants = Object.create(null);
    marks.forEach(function (mark) {
      selected[coordinateKey(mark)] = mark;
      selectedPositions[mark.position] = true;
    });
    routePlan.auto.forEach(function (item) { route[coordinateKey(item)] = item; });
    routePlan.destinations.forEach(function (item) {
      destinations[coordinateKey(item)] = item.kind;
      destinationPositions[item.position] = true;
    });
    routePlan.selections.forEach(function (item) {
      selectionVariants[coordinateKey(item)] = item.variant;
    });
    container.querySelectorAll("[data-plan-pick-kind]").forEach(function (line) {
      line.classList.remove("multi-plan-picked-line");
      line.classList.remove("multi-plan-route-line");
    });
    container.querySelectorAll(
      "td[data-plan-column-index][data-route-position]").forEach(function (cell) {
        var coordinate = markFromCell(cell, "regular");
        var key = coordinate && coordinateKey(coordinate);
        var selectedMark = key && selected[key];
        var routeStep = key && route[key];
        var destinationKind = key && destinations[key];
        var decoration = helpers.routeDecorationState({
          visible: visible,
          active: !!selectedMark,
          positionSelected: !!(coordinate && selectedPositions[coordinate.position]),
          destinationKind: destinationKind,
          positionHasDestination: !!(coordinate &&
            destinationPositions[coordinate.position]),
          routeStep: routeStep
        });
        var active = decoration.selected;
        var showDestination = decoration.destination;
        var showRoute = decoration.route;
        cell.classList.toggle("multi-plan-marked", active);
        cell.classList.toggle("multi-plan-route", showRoute);
        cell.classList.toggle("multi-plan-next", showDestination);
        if (showDestination) {
          cell.setAttribute("data-plan-next-kind", destinationKind);
        } else {
          cell.removeAttribute("data-plan-next-kind");
        }
        if (active) {
          cell.setAttribute("aria-selected", "true");
          var pickedSelector = '[data-plan-pick-kind="' +
            selectedMark.kind + '"]';
          if (selectedMark.kind === "guaranteed") {
            var pickedVariant = selectionVariants[key] ||
              selectedMark.variant || "base";
            pickedSelector += '[data-plan-pick-variant="' +
              pickedVariant + '"]';
          }
          var pickedLine = cell.querySelector(pickedSelector);
          if (pickedLine) pickedLine.classList.add("multi-plan-picked-line");
        } else if (showRoute) {
          var routeLine = cell.querySelector(
            '[data-plan-pick-kind="' + routeStep.kind + '"]');
          if (routeLine) routeLine.classList.add("multi-plan-route-line");
        } else {
          cell.removeAttribute("aria-selected");
        }
      });
    if (container === els.tables) renderSelectedCats();
  }

  function selectedCatsGroupHtml(rarity, label, className) {
    var entries = selectedCatEntries.filter(function (entry) {
      return entry.rarity === rarity;
    });
    if (!entries.length) return "";
    var pulls = entries.reduce(function (sum, entry) { return sum + entry.count; }, 0);
    return [
      '<section class="multi-plan-cats-group">',
      '<div class="multi-plan-cats-group-header"><h3>', h(label), '</h3>',
      '<span>', entries.length, '종 · ', pulls, '회</span></div>',
      '<div class="multi-plan-cats-tags">', entries.map(function (entry) {
        return '<span class="multi-plan-cat-tag ' + className + '" title="' +
          h(entry.name) + '">' +
          '<span>' + h(entry.name) + '</span>' +
          (entry.count > 1 ? '<span class="multi-plan-cat-count">×' +
            entry.count + '</span>' : '') + '</span>';
      }).join(""), '</div></section>'
    ].join("");
  }

  function renderSelectedCatsDialog() {
    els.catsList.innerHTML = selectedCatsGroupHtml(
      5, "레전드레어", "is-legend") + selectedCatsGroupHtml(
      4, "울트라 슈퍼 레어", "is-uber");
    els.catsEmpty.hidden = selectedCatEntries.length > 0;
  }

  function renderSelectedCats() {
    var cats = routePlan.ready ? routePlan.cats :
      (typeof trackApp.getPlanSelectedCats === "function" ?
        trackApp.getPlanSelectedCats(marks) : []);
    selectedCatEntries = helpers.catSummaryEntries(cats);
    var summary = helpers.summarizeCats(cats);
    els.selectedCats.textContent = summary || "선택 없음";
    els.selectedCats.title = summary || "선택된 울슈레·레전드레어가 없습니다.";
    els.selectedCats.disabled = !selectedCatEntries.length;
    els.selectedCats.classList.toggle("is-empty", !summary);
    els.selectedCats.setAttribute("aria-label", summary ?
      "선택 울슈레·레전드레어 전체 보기: " + summary :
      "선택된 울슈레·레전드레어가 없습니다.");
    renderSelectedCatsDialog();
  }

  function openSelectedCatsDialog() {
    if (!selectedCatEntries.length) return;
    renderSelectedCatsDialog();
    if (typeof els.catsDialog.showModal === "function") {
      els.catsDialog.showModal();
    } else {
      els.catsDialog.setAttribute("open", "");
    }
  }

  function closeSelectedCatsDialog() {
    if (typeof els.catsDialog.close === "function") {
      els.catsDialog.close();
    } else {
      els.catsDialog.removeAttribute("open");
    }
  }

  function toggleMark(cell, kind, variant) {
    clearCellNotice();
    var mark = markFromCell(cell, kind, variant);
    if (!mark) return;
    var key = markKey(mark);
    var index = marks.findIndex(function (item) {
      return markKey(item) === key;
    });
    var previousMarks = marks.slice();
    var previousRoutePlan = routePlan;
    if (index === -1) {
      marks = marks.filter(function (item) {
        return item.position !== mark.position;
      });
      marks.push(mark);
    } else {
      marks.splice(index, 1);
    }
    var removing = index !== -1;
    routePlan = calculateRoutePlan(marks,
      previousRoutePlan.valid ? previousRoutePlan.auto : [], {
        pruneInvalid: removing
      });
    var prunedCount = 0;
    if (removing && routePlan.ready && routePlan.pruned.length) {
      var pruned = Object.create(null);
      routePlan.pruned.forEach(function (item) {
        pruned[markKey(item)] = true;
      });
      marks = marks.filter(function (item) {
        return !pruned[markKey(item)];
      });
      prunedCount = routePlan.pruned.length;
      routePlan = calculateRoutePlan(marks,
        routePlan.valid ? routePlan.auto : []);
    }
    if (index === -1 && (!routePlan.ready || routePlan.invalid)) {
      var rejectedRoutePlan = routePlan;
      var specialHint = rejectedRoutePlan.ready ?
        calculateSpecialTicketHint(marks,
          previousRoutePlan.valid ? previousRoutePlan.auto : []) : "";
      marks = previousMarks;
      routePlan = previousRoutePlan;
      decorateMarks(els.tables);
      var rejectionMessage = specialHint || (rejectedRoutePlan.ready ?
        "현재 구성으로 도달 불가" : "경로 데이터 불러오는 중");
      showCellNotice(cell, rejectionMessage, specialHint ? 3200 : 1900);
      if (specialHint) setStatus(specialHint);
      return;
    }
    marksFingerprint = marks.length ?
      (marksFingerprint || currentFingerprint()) : null;
    decorateMarks(els.tables);
    setStatus((prunedCount ? "앞선 선택 취소로 도달할 수 없는 뒤쪽 좌표 " +
      prunedCount + "개도 해제했습니다. · " : "") + "강조 좌표 " +
      marks.length + "개 · 자동 경로 " + routePlan.auto.length +
      "칸 · 아직 플랜에 저장되지 않았습니다.");
    syncSharedPlanState();
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

  function currentDraftSignature() {
    var track = trackApp.getShareState && trackApp.getShareState();
    var normalizedTrack = helpers.normalizeTrack(track);
    if (!normalizedTrack) return null;
    var normalizedMarks = marks.map(function (mark) {
      return helpers.normalizeMark(mark, normalizedTrack);
    }).filter(Boolean).sort(function (left, right) {
      var distance = helpers.positionOffset(left.position) -
        helpers.positionOffset(right.position);
      return distance || left.column - right.column ||
        left.kind.localeCompare(right.kind);
    });
    return JSON.stringify({
      name: String(els.name.value || "").trim(),
      track: normalizedTrack,
      marks: normalizedMarks
    });
  }

  function rememberSavedDraft() {
    savedDraftSignature = currentDraftSignature();
  }

  function hasUnsavedDraft() {
    var hasContent = !!(currentPlanId || marks.length ||
      String(els.name.value || "").trim());
    if (!hasContent) return false;
    return currentDraftSignature() !== savedDraftSignature;
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
    if (pendingSharedPlan) {
      var shared = pendingSharedPlan;
      pendingSharedPlan = null;
      applySharedPlan(shared);
      return;
    }
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
      savedDraftSignature = null;
    }
    if (cleared) {
      marks = [];
      marksFingerprint = null;
      savedDraftSignature = null;
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
    marks = copyMarks(plan.marks);
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
    rememberSavedDraft();
    closeDialog();
    setStatus("격리된 플랜을 불러왔습니다. 변경 내용은 플랜 저장을 누를 때만 반영됩니다.");
    syncSharedPlanState();
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
    marks = copyMarks(saved.plan.marks);
    els.name.value = saved.plan.name;
    planFingerprint = currentFingerprint();
    marksFingerprint = marks.length ? planFingerprint : null;
    refreshRoutePlan();
    decorateMarks(els.tables);
    rememberSavedDraft();
    setStatus("‘" + saved.plan.name + "’ 저장 완료 · 강조 " +
      saved.plan.marks.length + "개");
    syncSharedPlanState();
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

  function clearCurrentPlan() {
    currentPlanId = null;
    loadedSession = false;
    marks = [];
    planFingerprint = null;
    marksFingerprint = null;
    applyingPlan = false;
    routePlan = helpers.emptyRoutePlan();
    savedDraftSignature = null;
    clearCellNotice();
    if (els.catsDialog.open) closeSelectedCatsDialog();
    els.name.value = "";
    syncPlanMode();
    decorateMarks(els.tables);
    setStatus("현재 플랜을 초기화했습니다. 저장된 플랜은 변경되지 않았습니다.");
    syncSharedPlanState();
  }

  function requestPlanReset() {
    if (!currentPlanId && !marks.length &&
        !String(els.name.value || "").trim()) {
      setStatus("초기화할 현재 플랜이 없습니다.");
      return;
    }
    openConfirm({
      title: "플랜 초기화",
      message: "현재 플랜명과 강조 좌표를 모두 비웁니다.\n" +
        "브라우저에 저장된 플랜은 삭제되지 않습니다.",
      acceptLabel: "초기화",
      danger: true,
      accept: clearCurrentPlan
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
      savedDraftSignature = null;
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
    savedDraftSignature = null;
    clearCellNotice();
    if (els.catsDialog.open) closeSelectedCatsDialog();
    els.name.value = "";
    els.mode.checked = false;
    syncPlanMode();
    decorateMarks(els.tables);
    setStatus("");
  }

  function applySharedPlan(shared) {
    if (!shared || typeof shared !== "object") return false;
    var track = helpers.normalizeTrack(trackApp.getShareState &&
      trackApp.getShareState());
    if (!track) return false;
    currentPlanId = null;
    loadedSession = true;
    marks = helpers.normalizeMarks(shared.marks, track);
    planFingerprint = helpers.trackFingerprint(track);
    marksFingerprint = marks.length ? planFingerprint : null;
    applyingPlan = false;
    routePlan = helpers.emptyRoutePlan();
    savedDraftSignature = null;
    els.name.value = String(shared.name || "").slice(0, 80);
    els.mode.checked = true;
    syncPlanMode();
    refreshRoutePlan();
    decorateMarks(els.tables);
    setStatus("공유받은 임시 플랜입니다. 플랜 저장을 누르기 전에는 " +
      "이 브라우저의 저장 플랜에 반영되지 않습니다.");
    return true;
  }

  function handleShareChange() {
    var shared = root.MultiShareApp && root.MultiShareApp.isActive() &&
      typeof root.MultiShareApp.getPlanState === "function" ?
      root.MultiShareApp.getPlanState() : null;
    resetUiSession();
    pendingSharedPlan = shared;
  }

  els.mode.addEventListener("change", function () {
    if (els.mode.checked && app.classList.contains("is-dirty")) {
      els.mode.checked = false;
      syncPlanMode();
      setStatus("먼저 Apply를 눌러 배열 변경을 적용한 뒤 플랜 모드를 켜 주세요.", true);
      return;
    }
    syncPlanMode();
    clearCellNotice();
    decorateMarks(els.tables);
    if (els.mode.checked) {
      setStatus("플랜 모드에서는 배열이 잠기며 좌표 강조만 편집할 수 있습니다.");
    } else if (hasUnsavedDraft()) {
      setStatus("저장되지 않은 플랜 변경사항이 있습니다. 필요하면 플랜 저장을 눌러 주세요.", true);
    } else {
      setStatus("플랜 테두리를 숨겼습니다. 배열 편집이 가능합니다.");
    }
    syncSharedPlanState();
  });
  els.load.addEventListener("click", openDialog);
  els.reset.addEventListener("click", requestPlanReset);
  els.save.addEventListener("click", savePlan);
  els.name.addEventListener("change", syncSharedPlanState);
  els.selectedCats.addEventListener("click", openSelectedCatsDialog);
  els.tables.addEventListener("click", function (event) {
    if (!els.mode.checked) return;
    var cell = event.target.closest && event.target.closest(
      "td[data-plan-column-index][data-route-position]");
    if (!cell) return;
    var pickedLine = event.target.closest("[data-plan-pick-kind]");
    var kind = pickedLine && cell.contains(pickedLine) ?
      pickedLine.getAttribute("data-plan-pick-kind") : "regular";
    var variant = pickedLine && cell.contains(pickedLine) ?
      pickedLine.getAttribute("data-plan-pick-variant") : null;
    event.preventDefault();
    event.stopPropagation();
    toggleMark(cell, kind, variant);
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
  els.catsDialog.querySelector("[data-multi-plan-cats-close]").addEventListener(
    "click", closeSelectedCatsDialog);
  els.catsDialog.querySelector("[data-multi-plan-cats-backdrop]").addEventListener(
    "click", closeSelectedCatsDialog);
  els.catsDialog.addEventListener("cancel", function (event) {
    event.preventDefault();
    closeSelectedCatsDialog();
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
  root.addEventListener("multi-share:changed", handleShareChange);
  root.addEventListener("popstate", function () {
    if (root.MultiShareApp && root.MultiShareApp.isActive()) return;
    resetUiSession();
  });
  root.addEventListener("storage", function (event) {
    if (event.key !== helpers.storageKey) return;
    plans = readLibrary();
    if (els.dialog.open) renderPlans();
  });

  root.MultiPlanApp = {
    decorateMarks: decorateMarks,
    isSessionActive: function () { return loadedSession; },
    getMarks: function () { return copyMarks(marks); },
    getShareState: sharePlanState
  };
  var initialSharedPlan = root.MultiShareApp && root.MultiShareApp.isActive() &&
    typeof root.MultiShareApp.getPlanState === "function" ?
    root.MultiShareApp.getPlanState() : null;
  if (!applySharedPlan(initialSharedPlan)) {
    syncPlanMode();
    refreshRoutePlan();
    decorateMarks(els.tables);
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var version = 1;
  var storageKey = "battle-cats-rolls.multiPlans.v1";
  var maxPlans = 100;
  var regularRouteCost = 3;
  var guaranteedRouteCost = 100;
  var specialTicketRouteCost = 200;

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
    var result = { column: column, position: sequence + match[2], kind: kind };
    if (kind === "guaranteed" && ["base", "rerolled"].indexOf(mark.variant) !== -1) {
      result.variant = mark.variant;
    }
    return result;
  }

  function normalizeMarks(values, track) {
    var chosen = [];
    (Array.isArray(values) ? values : []).slice(0, 8000)
      .map(function (mark) { return normalizeMark(mark, track); })
      .forEach(function (mark) {
        if (!mark) return;
        chosen = chosen.filter(function (selected) {
          return selected.position !== mark.position;
        });
        chosen.push(mark);
      });
    return chosen.sort(function (left, right) {
      var distance = positionOffset(left.position) - positionOffset(right.position);
      return distance || left.column - right.column;
    });
  }

  function catSummaryEntries(cats) {
    var entries = [];
    var byKey = Object.create(null);
    (Array.isArray(cats) ? cats : []).forEach(function (cat) {
      var rarity = parseInt(cat && cat.rarity, 10);
      var name = limitedText(cat && cat.name, 160).trim();
      if ([4, 5].indexOf(rarity) === -1 || !name) return;
      var id = parseInt(cat.id, 10);
      var key = rarity + ":" + (id > 0 ? id : name);
      if (!byKey[key]) {
        byKey[key] = { id: id > 0 ? id : null, name: name, rarity: rarity,
          count: 0 };
        entries.push(byKey[key]);
      }
      byKey[key].count += 1;
    });
    return entries;
  }

  function summarizeCats(cats) {
    return catSummaryEntries(cats).map(function (entry) {
      return entry.name + (entry.count > 1 ? " ×" + entry.count : "");
    }).join(", ");
  }

  function emptyRoutePlan() {
    return {
      ready: false,
      valid: false,
      auto: [],
      destinations: [],
      selections: [],
      cats: [],
      pruned: [],
      invalid: null,
      explored: 0,
      costUnits: 0
    };
  }

  function routeDecorationState(options) {
    options = options || {};
    var visible = !!options.visible;
    var positionSelected = !!options.positionSelected;
    var positionHasDestination = !!options.positionHasDestination;
    return {
      selected: visible && !!options.active,
      destination: visible && !positionSelected && !!options.destinationKind,
      route: visible && !positionSelected && !positionHasDestination &&
        !!options.routeStep
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
    var keys = ["costUnits", "changes", "deviation", "draws"];
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
      costUnits: parent.costUnits + (attrs.costUnits || 0),
      changes: parent.changes + (attrs.changes || 0),
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

  function usableRouteRows(snapshot, allowAutomaticSpecial) {
    return (snapshot && Array.isArray(snapshot.rows) ? snapshot.rows : [])
      .map(function (row, column) {
        return { column: column, pool: row && row.pool };
      }).filter(function (row) {
        return row.pool && row.pool.exist !== false &&
          (allowAutomaticSpecial || !row.pool.platinum);
      });
  }

  function preferredRouteSteps(values, track) {
    var result = Object.create(null);
    (Array.isArray(values) ? values : []).forEach(function (value) {
      var step = normalizeMark(value, track);
      if (step) result[step.position] = step;
    });
    return result;
  }

  function routeStepChange(preferredSteps, position, column, kind) {
    var preferred = preferredSteps[position];
    if (!preferred) return 0;
    return preferred.column === column && preferred.kind === kind ? 0 : 1;
  }

  function regularActionCost(pool) {
    return pool && pool.platinum ? specialTicketRouteCost : regularRouteCost;
  }

  function advanceRouteCandidates(engine, snapshot, starts, targetOffset,
    preferredColumn, preferredSteps, order, explored, allowAutomaticSpecial) {
    var buckets = [];
    starts.forEach(function (candidate) {
      if (candidate.offset > targetOffset) return;
      buckets[candidate.offset] = buckets[candidate.offset] || Object.create(null);
      addRouteCandidate(buckets[candidate.offset], candidate);
    });
    var rows = usableRouteRows(snapshot, allowAutomaticSpecial);
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
          var position = routePosition(engine, offset);
          var kind = rolled.rerolled ? "reroll" : "regular";
          var child = routeChild(candidate, {
            offset: nextOffset,
            lastRareId: rolled.lastRareId,
            costUnits: regularActionCost(row.pool),
            changes: routeStepChange(preferredSteps, position,
              row.column, kind),
            deviation: row.column === preferredColumn ? 0 : 1,
            draws: 1
          }, {
            auto: [{
              column: row.column,
              position: position,
              kind: kind
            }],
            destinations: rolled.rerolled ? [{
              column: row.column,
              position: rolled.next || routePosition(engine, nextOffset),
              kind: "reroll"
            }] : [],
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
      var guaranteedVariant = /RG$/.test(String(guaranteed.guaranteedLabel || "")) ?
        "rerolled" : "base";
      if (mark.variant && mark.variant !== guaranteedVariant) return null;
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
        costUnits: guaranteedRouteCost,
        draws: (guaranteed.pulls || []).length
      }, {
        auto: routePulls,
        destinations: [{
          column: mark.column,
          position: guaranteed.next || routePosition(engine, guaranteed.nextOffset),
          kind: "guaranteed"
        }],
        selections: [{
          column: mark.column,
          position: mark.position,
          kind: "guaranteed",
          variant: guaranteedVariant
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
      costUnits: regularActionCost(pool),
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
      result.selections = result.selections.concat(step.selections || []);
      result.cats = result.cats.concat((step.cats || []).filter(Boolean));
      return result;
    }, { auto: [], destinations: [], selections: [], cats: [] });
  }

  function specialTicketRouteHint(snapshot, routePlan) {
    if (!routePlan || !routePlan.valid || !snapshot ||
        !Array.isArray(snapshot.rows)) return "";
    var seen = Object.create(null);
    var positions = [];
    (routePlan.auto || []).forEach(function (step) {
      var row = snapshot.rows[step.column];
      if (!row || !row.pool || !row.pool.platinum || seen[step.position]) return;
      seen[step.position] = true;
      positions.push(step.position);
    });
    if (!positions.length) return "";
    return positions.join("·") + " 구간에서 특수뽑기 시 도달 가능";
  }

  function buildRoutePlan(engine, snapshot, marks, options) {
    var result = emptyRoutePlan();
    if (!engine || typeof engine.simulateRegular !== "function" ||
        !snapshot || !snapshot.ready || !Array.isArray(snapshot.rows)) return result;
    result.ready = true;
    options = options || {};
    var allowAutomaticSpecial = options.allowAutomaticSpecial === true;
    var pruneInvalid = options.pruneInvalid === true;
    var trackShape = { rows: snapshot.rows, count: snapshot.count };
    var preferredSteps = preferredRouteSteps(options.preferredAuto, trackShape);
    var orderedMarks = normalizeMarks(marks, trackShape).slice().sort(
      function (left, right) {
        var distance = positionOffset(left.position) - positionOffset(right.position);
        return distance || left.column - right.column;
      });
    if (!orderedMarks.length) {
      result.valid = true;
      return result;
    }
    var routePreferredColumn = orderedMarks[orderedMarks.length - 1].column;

    var order = { value: 1 };
    var explored = { count: 0, limit: 200000 };
    var candidates = [{
      offset: 0,
      lastRareId: Math.max(0, parseInt(snapshot.last, 10) || 0),
      costUnits: 0,
      changes: 0,
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
        positionOffset(mark.position), routePreferredColumn, preferredSteps,
        order, explored, allowAutomaticSpecial);
      var applied = reached.map(function (candidate) {
        return applyRouteMark(engine, snapshot, candidate, mark, order);
      }).filter(Boolean);
      candidates = dedupeRouteCandidates(applied);
      if (!candidates.length) {
        if (pruneInvalid) {
          result.pruned.push(mark);
          candidates = beforeCandidates;
          continue;
        }
        var previous = bestRouteCandidate(beforeCandidates);
        var partial = previous ? materializeRoute(previous) :
          { auto: [], destinations: [], selections: [], cats: [] };
        result.auto = partial.auto;
        result.destinations = partial.destinations;
        result.selections = partial.selections;
        result.cats = partial.cats;
        result.invalid = mark;
        result.explored = explored.count;
        result.costUnits = previous ? previous.costUnits : 0;
        return result;
      }
    }
    var best = bestRouteCandidate(candidates);
    var materialized = materializeRoute(best);
    result.valid = true;
    result.auto = materialized.auto;
    result.destinations = materialized.destinations;
    result.selections = materialized.selections;
    result.cats = materialized.cats;
    result.explored = explored.count;
    result.costUnits = best ? best.costUnits : 0;
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
    normalizeMarks: normalizeMarks,
    normalizeTrack: normalizeTrack,
    normalizePlan: normalizePlan,
    normalizeLibrary: normalizeLibrary,
    catSummaryEntries: catSummaryEntries,
    summarizeCats: summarizeCats,
    emptyRoutePlan: emptyRoutePlan,
    specialTicketRouteHint: specialTicketRouteHint,
    routeDecorationState: routeDecorationState,
    positionOffset: positionOffset,
    buildRoutePlan: buildRoutePlan,
    findPlanByName: findPlanByName,
    removePlan: removePlan,
    trackFingerprint: trackFingerprint,
    upsertPlan: upsertPlan
  };
});
