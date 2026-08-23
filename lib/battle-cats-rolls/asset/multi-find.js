(function (global) {
  "use strict";

  var doc = global.document;
  var root = doc.getElementById("multi-track-app");
  var dataNode = doc.getElementById("multi_track_data");
  if (!root || !dataNode || !global.MultiTrackApp) return;

  var storageKey = "battle-cats-rolls.multiFind.v1";
  var data = JSON.parse(dataNode.textContent);
  var catalog = Array.isArray(data.find_cats) ? data.find_cats : [];
  var catalogById = Object.create(null);
  var latestSnapshot = global.MultiTrackApp.getFindSnapshot();
  var worker = null;
  var timer = 0;
  var runId = 0;
  var runningStartedAt = 0;
  var explored = 0;
  var lastSuccessfulResult = null;

  var els = {
    optimization: doc.getElementById("multi_find_optimization"),
    maxGuaranteed: doc.getElementById("multi_find_max_guaranteed"),
    maxPlatinum: doc.getElementById("multi_find_max_platinum"),
    maxLegendTicket: doc.getElementById("multi_find_max_legend_ticket"),
    filter: doc.getElementById("multi_find_filter"),
    help: doc.getElementById("multi_find_help"),
    helpDialog: doc.getElementById("multi_find_help_dialog"),
    count: doc.getElementById("multi_find_count"),
    targets: doc.getElementById("multi_find_targets"),
    result: doc.getElementById("multi_find_result"),
    tables: doc.getElementById("multi_tables"),
    dialog: doc.getElementById("multi_find_dialog"),
    search: doc.getElementById("multi_find_search"),
    selected: doc.getElementById("multi_find_selected"),
    selectedEmpty: doc.getElementById("multi_find_selected_empty"),
    available: doc.getElementById("multi_find_available"),
    noResults: doc.getElementById("multi_find_no_results")
  };
  if (!els.optimization || !els.maxPlatinum || !els.maxLegendTicket ||
      !els.dialog || !els.result) return;

  function h(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function normalizeText(value) {
    var text = String(value || "");
    if (text.normalize) text = text.normalize("NFKC");
    return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  catalog = catalog.map(function (cat) {
    var item = {
      id: parseInt(cat.id, 10),
      rarity: parseInt(cat.rarity, 10),
      name: String(cat.name || cat.kr || cat.jp || cat.id),
      kr: cat.kr || "",
      jp: cat.jp || ""
    };
    item.search = normalizeText([item.id, item.name, item.kr, item.jp].join(" "));
    item.searchCompact = item.search.replace(/\s+/g, "");
    catalogById[item.id] = item;
    return item;
  }).filter(function (cat) {
    return cat.id > 0 && [3, 4, 5].indexOf(cat.rarity) !== -1;
  });

  function normalizeTargets(targets) {
    var seen = Object.create(null);
    return (Array.isArray(targets) ? targets : []).map(function (target) {
      return {
        cat_id: parseInt(target.cat_id, 10),
        allow_ticket: target.allow_ticket === true ||
          target.source_policy === "ticket"
      };
    }).filter(function (target) {
      if (!catalogById[target.cat_id] || seen[target.cat_id]) return false;
      seen[target.cat_id] = true;
      return true;
    });
  }

  function defaultSettings() {
    return {
      optimization: "cost",
      maxGuaranteed: 0,
      maxPlatinum: 0,
      maxLegendTicket: 0,
      targets: []
    };
  }

  function normalizeSettings(saved) {
    if (!saved) return null;
    var optimization = saved.optimization || saved.optimization_mode;
    return {
      optimization: optimization === "distance" ? "distance" :
        (optimization === "balance" ? "balance" : "cost"),
      maxGuaranteed: clamp(parseInt(
        saved.maxGuaranteed == null ? saved.max_guaranteed : saved.maxGuaranteed,
        10) || 0, 0, 20),
      maxPlatinum: clamp(parseInt(
        saved.maxPlatinum == null ? saved.max_platinum : saved.maxPlatinum,
        10) || 0, 0, 99),
      maxLegendTicket: clamp(parseInt(
        saved.maxLegendTicket == null ?
          saved.max_legend_ticket : saved.maxLegendTicket, 10) || 0, 0, 99),
      targets: normalizeTargets(saved.targets)
    };
  }

  function readSaved() {
    if (global.MultiShareApp && global.MultiShareApp.isActive()) {
      return normalizeSettings(global.MultiShareApp.getFindSettings());
    }
    try {
      var saved = JSON.parse(global.localStorage.getItem(storageKey) || "null");
      return normalizeSettings(saved);
    } catch (_error) {
      return null;
    }
  }

  var settings = readSaved() || defaultSettings();

  function save() {
    if (global.MultiShareApp && global.MultiShareApp.isActive()) {
      global.MultiShareApp.setFindSettings(settings);
      return;
    }
    try {
      global.localStorage.setItem(storageKey, JSON.stringify({
        optimization_mode: settings.optimization,
        max_guaranteed: settings.maxGuaranteed,
        max_platinum: settings.maxPlatinum,
        max_legend_ticket: settings.maxLegendTicket,
        targets: settings.targets
      }));
    } catch (_error) {
      // Ignore private browsing or full storage.
    }
  }

  function catForTarget(target) {
    return catalogById[target.cat_id] || {
      id: target.cat_id,
      rarity: 0,
      name: String(target.cat_id)
    };
  }

  function rarityClass(rarity) {
    if (rarity === 3) return "is-supa";
    if (rarity === 4) return "is-uber";
    if (rarity === 5) return "is-legend";
    return "";
  }

  function selectedPoolIds() {
    var result = Object.create(null);
    if (!latestSnapshot || !Array.isArray(latestSnapshot.rows)) return result;
    latestSnapshot.rows.forEach(function (row) {
      if (!row.pool || !row.pool.slots) return;
      [3, 4, 5].forEach(function (rarity) {
        var slots = row.pool.slots[rarity] || row.pool.slots[String(rarity)] || [];
        slots.forEach(function (id) { if (id > 0) result[id] = true; });
      });
    });
    return result;
  }

  function selectedTarget(id) {
    for (var index = 0; index < settings.targets.length; index += 1) {
      if (settings.targets[index].cat_id === id) return settings.targets[index];
    }
    return null;
  }

  function renderSummary() {
    els.optimization.value = settings.optimization;
    els.maxGuaranteed.value = settings.maxGuaranteed;
    els.maxPlatinum.value = settings.maxPlatinum;
    els.maxLegendTicket.value = settings.maxLegendTicket;
    var names = settings.targets.map(function (target) {
      return catForTarget(target).name;
    });
    els.targets.value = names.join(", ");
    els.filter.classList.toggle("is-active", names.length > 0);
    els.count.hidden = names.length === 0;
    els.count.textContent = names.length;
  }

  function selectedRow(target) {
    var cat = catForTarget(target);
    return [
      '<div class="multi-find-selected-row" data-cat-id="', cat.id, '">',
      '<select data-field="allow_ticket" aria-label="', h(cat.name), ' 획득처">',
        '<option value="false"', target.allow_ticket ? '' : ' selected',
          '>특수 티켓 비허용</option>',
        '<option value="true"', target.allow_ticket ? ' selected' : '',
          '>특수 티켓 허용</option>',
      '</select>',
      '<span class="multi-find-selected-name" title="', h(cat.name), '">',
        h(cat.name), '</span>',
      '<button type="button" class="multi-find-selected-remove"',
        ' data-action="remove" aria-label="', h(cat.name), ' 제거">&times;</button>',
      '</div>'
    ].join("");
  }

  function renderSelected() {
    els.selected.innerHTML = settings.targets.map(selectedRow).join("");
    els.selectedEmpty.hidden = settings.targets.length !== 0;
    var reset = els.dialog.querySelector("[data-multi-find-reset]");
    if (reset) reset.disabled = settings.targets.length === 0;
  }

  function tagFor(cat, inPool) {
    var selected = !!selectedTarget(cat.id);
    var classes = ["event-filter-tag", rarityClass(cat.rarity)];
    if (inPool) classes.push("is-in-pool");
    if (selected) classes.push("is-selected");
    return '<button type="button" class="' + h(classes.join(" ")) +
      '" data-cat-id="' + cat.id + '" aria-pressed="' +
      (selected ? "true" : "false") + '" title="ID ' + cat.id +
      (cat.jp && cat.jp !== cat.name ? " · " + h(cat.jp) : "") + '">' +
      h(cat.name) + '</button>';
  }

  function renderAvailable() {
    var inPool = selectedPoolIds();
    var query = normalizeText(els.search.value);
    var compact = query.replace(/\s+/g, "");
    var tokens = query.split(" ").filter(Boolean);
    var visible = catalog.filter(function (cat) {
      if (!query) return true;
      return tokens.every(function (token) {
        return cat.search.indexOf(token) !== -1;
      }) || cat.searchCompact.indexOf(compact) !== -1;
    }).sort(function (left, right) {
      var poolOrder = Number(!!inPool[right.id]) - Number(!!inPool[left.id]);
      if (poolOrder) return poolOrder;
      if (left.rarity !== right.rarity) return right.rarity - left.rarity;
      return left.name.localeCompare(right.name, "ko");
    });
    els.available.innerHTML = visible.map(function (cat) {
      return tagFor(cat, !!inPool[cat.id]);
    }).join("");
    els.noResults.hidden = visible.length !== 0;
  }

  function renderDialog() {
    renderSelected();
    renderAvailable();
  }

  function stopWorker() {
    runId += 1;
    if (worker) worker.terminate();
    worker = null;
    if (timer) global.clearInterval(timer);
    timer = 0;
  }

  function showPending() {
    stopWorker();
    clearRouteMarks();
    lastSuccessfulResult = null;
    if (!settings.targets.length) {
      els.result.hidden = true;
      return;
    }
    els.result.hidden = false;
    els.result.className = "multi-find-result";
    els.result.innerHTML = '<h2>Find route</h2>' +
      '<p>변경 사항을 배열과 경로에 반영하려면 Apply를 누르세요.</p>' +
      (settings.targets.length >= 16 ?
        '<p class="multi-find-result-meta">목표가 16명 이상이면 정확 탐색 상태 한도를 넘을 수 있습니다.</p>' : '');
  }

  function settingsChanged() {
    save();
    renderSummary();
    showPending();
    global.MultiTrackApp.markFindDirty();
  }

  function toggleCat(id) {
    var existing = selectedTarget(id);
    if (existing) {
      settings.targets = settings.targets.filter(function (target) {
        return target.cat_id !== id;
      });
    } else if (settings.targets.length >= 30) {
      els.result.hidden = false;
      els.result.className = "multi-find-result is-error";
      els.result.innerHTML = '<h2>Find route · 입력 확인 필요</h2>' +
        '<p>목표 캐릭터는 최대 30명까지 선택할 수 있습니다.</p>';
      return;
    } else if (catalogById[id]) {
      settings.targets.push({
        cat_id: id,
        allow_ticket: false
      });
    }
    settingsChanged();
    renderDialog();
  }

  function elapsedSeconds() {
    return Math.max(0, Math.floor((Date.now() - runningStartedAt) / 1000));
  }

  function renderRunning() {
    clearRouteMarks();
    lastSuccessfulResult = null;
    els.result.hidden = false;
    els.result.className = "multi-find-result is-running";
    els.result.innerHTML = '<h2>Find route</h2><p>계산 중… ' +
      elapsedSeconds() + 's' + (explored ? ' · ' + explored.toLocaleString() +
      ' states' : '') + '</p>' + (settings.targets.length >= 16 ?
      '<p class="multi-find-result-meta">목표가 많아 계산이 오래 걸릴 수 있습니다.</p>' : '');
  }

  function targetLabel(index) {
    var target = settings.targets[index];
    if (!target) return "";
    return catForTarget(target).name;
  }

  function acquiredHtml(indexes) {
    if (!indexes || !indexes.length) return "";
    return ' · <span class="multi-find-route-target">' +
      indexes.map(function (item) {
        var index = typeof item === "number" ? item : item.targetIndex;
        var position = typeof item === "number" ? "" : " @ " + item.resultLabel;
        return h(targetLabel(index) + position);
      }).join(", ") +
      ' 획득</span>';
  }

  function pawSvg() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<ellipse cx="12" cy="16.1" rx="5.8" ry="4.7"></ellipse>' +
      '<ellipse cx="5.4" cy="10" rx="2.35" ry="2.9" transform="rotate(-24 5.4 10)"></ellipse>' +
      '<ellipse cx="9.7" cy="6.5" rx="2.3" ry="2.9" transform="rotate(-8 9.7 6.5)"></ellipse>' +
      '<ellipse cx="14.7" cy="6.5" rx="2.3" ry="2.9" transform="rotate(8 14.7 6.5)"></ellipse>' +
      '<ellipse cx="18.8" cy="10" rx="2.35" ry="2.9" transform="rotate(24 18.8 10)"></ellipse>' +
      '</svg>';
  }

  function pawHtml(kind, label) {
    return '<span class="multi-route-paw is-' + h(kind) + '" title="' +
      h(label) + '" role="img" aria-label="' + h(label) + '">' +
      pawSvg() + '</span>';
  }

  function clearRouteMarks() {
    if (!els.tables) return;
    Array.prototype.forEach.call(
      els.tables.querySelectorAll(".multi-route-marker-stack"),
      function (marker) { marker.remove(); }
    );
    Array.prototype.forEach.call(
      els.tables.querySelectorAll(".multi-route-marked"),
      function (cell) {
        cell.classList.remove("multi-route-marked", "has-multiple-route-marks");
      }
    );
  }

  function basePosition(label) {
    var match = String(label || "").match(/\d+[AB]/);
    return match ? match[0] : "";
  }

  function acquiredNames(action, resultLabel) {
    return (action.acquired || []).filter(function (item) {
      return item && item.resultLabel === resultLabel;
    }).map(function (item) {
      return targetLabel(item.targetIndex);
    }).filter(Boolean);
  }

  function ticketResourceLabel(action) {
    return action && action.ticketKind === "legend" ?
      "레전드 티켓" : "플래티넘 티켓";
  }

  function applyRouteMarks(actions) {
    clearRouteMarks();
    if (!els.tables || !actions || !actions.length) return;

    var marks = Object.create(null);

    function addMark(eventName, position, kind, title, numberCell,
      numberFallback) {
      position = basePosition(position);
      if (!position) return;
      var key = (numberCell ? "number" : String(eventName || "")) + "\n" + position;
      var mark = marks[key] || {
        event: eventName || "",
        position: position,
        numberCell: !!numberCell,
        numberFallback: !!numberFallback,
        kinds: Object.create(null)
      };
      if (kind === "route" && (mark.kinds.target || mark.kinds.switch)) return;
      if (kind !== "route") delete mark.kinds.route;
      mark.kinds[kind] = title;
      marks[key] = mark;
    }

    function markPull(action, pull) {
      var label = pull.resultLabel || action.resultLabel || action.start;
      var names = acquiredNames(action, label);
      if (names.length) {
        addMark(action.event, label, "target", "목표 획득: " + names.join(", "), false);
      }
      if (pull.rerolled || pull.guaranteed) {
        var switchLabel = pull.guaranteed ? "확뽑 열변경" : "R 열변경";
        addMark(action.event, label, "switch",
          switchLabel + " · " + action.eventLabel, false);
      } else if (!names.length) {
        addMark(action.event, label, "route", "경로 · " + action.eventLabel, false);
      }
    }

    actions.forEach(function (action) {
      if (action.type === "guaranteed") {
        (action.routePulls || [{
          resultLabel: action.start,
          guaranteed: true
        }]).forEach(function (pull) { markPull(action, pull); });
        addMark("", action.next, "route",
          "확뽑 후 도착 · " + action.next, true);
        return;
      }

      if (action.type === "ticket") {
        var ticketNames = acquiredNames(action, action.resultLabel);
        var resourceLabel = ticketResourceLabel(action);
        if (ticketNames.length) {
          addMark(action.event, action.start, "target",
            resourceLabel + " 목표 획득: " + ticketNames.join(", "),
            false, true);
        }
        if (action.defense) {
          addMark(action.event, action.start, "switch",
            resourceLabel + " · R 방어", false, true);
        } else if (!ticketNames.length) {
          addMark(action.event, action.start, "route", resourceLabel,
            false, true);
        }
        return;
      }

      markPull(action, {
        resultLabel: action.resultLabel,
        rerolled: action.rerolled,
        guaranteed: false
      });
    });

    var eventCells = Object.create(null);
    Array.prototype.forEach.call(
      els.tables.querySelectorAll("[data-route-event][data-route-position]"),
      function (cell) {
        var key = cell.dataset.routeEvent + "\n" + cell.dataset.routePosition;
        (eventCells[key] || (eventCells[key] = [])).push(cell);
      }
    );
    var numberCells = Object.create(null);
    Array.prototype.forEach.call(
      els.tables.querySelectorAll("[data-route-number-position]"),
      function (cell) {
        var key = cell.dataset.routeNumberPosition;
        (numberCells[key] || (numberCells[key] = [])).push(cell);
      }
    );

    Object.keys(marks).forEach(function (key) {
      var mark = marks[key];
      var cells = mark.numberCell ? numberCells[mark.position] :
        eventCells[mark.event + "\n" + mark.position];
      if ((!cells || !cells.length) && mark.numberFallback) {
        cells = numberCells[mark.position];
      }
      (cells || []).forEach(function (cell) {
        var stack = doc.createElement("span");
        stack.className = "multi-route-marker-stack";
        ["route", "switch", "target"].forEach(function (kind) {
          if (mark.kinds[kind]) {
            stack.insertAdjacentHTML("beforeend", pawHtml(kind, mark.kinds[kind]));
          }
        });
        if (!stack.childNodes.length) return;
        cell.classList.add("multi-route-marked");
        if (stack.childNodes.length > 1) {
          cell.classList.add("has-multiple-route-marks");
        }
        cell.appendChild(stack);
      });
    });
  }

  function routeLegendHtml() {
    return '<p class="multi-find-route-legend" aria-label="트랙 표시 범례">' +
      pawHtml("route", "일반 경로") + '<span>경로</span>' +
      pawHtml("target", "목표 획득") + '<span>목표</span>' +
      pawHtml("switch", "열변경 또는 R 방어") + '<span>열변경·방어</span></p>';
  }

  function routeLines(actions, optimization) {
    var lines = [];
    var run = null;

    function balanceBonus(action) {
      if (optimization !== "balance") return "";
      var uber = Number(action.uberDraws) || 0;
      var legend = Number(action.legendDraws) || 0;
      if (!uber && !legend) return "";
      var parts = [];
      if (uber) parts.push("울슈레 " + uber + "회 × 0.2");
      if (legend) parts.push("레전드 " + legend + "회 × 2");
      return ' · 균형 보너스 -(' + h(parts.join(" + ")) + ')';
    }

    function flushRun() {
      if (!run) return;
      var position = run.first === run.last ? run.first : run.first + "~" + run.last;
      lines.push('<li><span class="multi-find-route-position">' + h(position) +
        '</span> · 레어티켓 ' + run.count +
        '회 → ' + h(run.next) + '</li>');
      run = null;
    }

    actions.forEach(function (action) {
      var hasBalanceBonus = optimization === "balance" &&
        ((Number(action.uberDraws) || 0) > 0 ||
          (Number(action.legendDraws) || 0) > 0);
      var importantRoll = action.type === "roll" &&
        (action.rerolled || action.avoidedR ||
          hasBalanceBonus || (action.acquired && action.acquired.length));
      if (action.type === "roll" && !importantRoll) {
        if (!run) {
          run = {
            first: action.start,
            last: action.resultLabel,
            next: action.next,
            count: 1
          };
        } else {
          run.last = action.resultLabel;
          run.next = action.next;
          run.count += 1;
        }
        return;
      }

      flushRun();
      if (action.type === "roll") {
        var hasAcquired = action.acquired && action.acquired.length;
        var reroll = action.rerolled ? ' · R 열변경 (' + h(action.originalCatName) +
          ' → ' + h(action.catName) + ')' : (action.avoidedR ?
          ' · R 방어를 위해 이 배너에서 뽑기' +
            (hasAcquired ? '' : ' (' + h(action.catName) + ')') :
          (hasAcquired ? '' : ' · ' + h(action.catName)));
        lines.push('<li><span class="multi-find-route-position">' +
          h(action.resultLabel) + '</span> · ' + h(action.eventLabel) + reroll +
          acquiredHtml(action.acquired) + balanceBonus(action) + ' → ' +
          h(action.next) + '</li>');
      } else if (action.type === "ticket") {
        var defense = action.defense ? ' · R 열변경 방어' : '';
        lines.push('<li><span class="multi-find-route-position">' + h(action.start) +
          '</span> · ' + ticketResourceLabel(action) + ' · ' +
          h(action.catName) + defense +
          acquiredHtml(action.acquired) + balanceBonus(action) +
          ' · 비용 +2 → ' + h(action.next) + '</li>');
      } else if (action.type === "guaranteed") {
        lines.push('<li><span class="multi-find-route-position">' + h(action.start) +
          '~' + h(action.guaranteedLabel) + '</span> · ' + h(action.eventLabel) +
          ' · 확뽑' + acquiredHtml(action.acquired) + balanceBonus(action) +
          ' · 비용 +1 → ' + h(action.next) + '</li>');
      }
    });
    flushRun();
    return lines;
  }

  function formatCost(value) {
    return Number(value || 0).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function renderResult(result) {
    clearRouteMarks();
    els.result.hidden = false;
    els.result.className = "multi-find-result";
    if (!result || result.status !== "success") {
      lastSuccessfulResult = null;
      els.result.classList.add("is-error");
      var label = result && result.status === "limit" ? "계산 범위 초과" :
        (result && result.status === "invalid" ? "입력 확인 필요" : "불가능");
      els.result.innerHTML = '<h2>Find route · ' + h(label) + '</h2><p>' +
        h(result && result.message ? result.message : "계산하지 못했습니다.") +
        '</p><p class="multi-find-result-meta">' +
        Number(result && result.explored || 0).toLocaleString() + ' states · ' +
        ((result && result.elapsedMs || 0) / 1000).toFixed(2) + 's</p>';
      return;
    }

    var lines = routeLines(result.actions || [], result.optimization);
    var route = lines.length ? '<ol>' + lines.join("") + '</ol>' :
      '<p>' + h(result.message || "추가 행동이 필요하지 않습니다.") + '</p>';
    var costSummary = result.optimization === "balance" ?
      '<p>기본 코스트 ' + formatCost(result.baseCost) + ' - 울슈레 ' +
        result.uberDraws + '회 × 0.2 - 레전드 ' + result.legendDraws +
        '회 × 2 = 균형 코스트 ' + formatCost(result.cost) +
        (Number(result.rawCost) < 0 ? ' (0점 하한 적용)' : '') + '</p>' :
      '<p>레어티켓 ' + result.regularUses + '회 × 0.03 + 플래티넘 티켓 ' +
        (result.platinumUses || 0) + '회 × 2 + 레전드 티켓 ' +
        (result.legendTicketUses || 0) + '회 × 2 + 확뽑 ' + result.guaranteedUses +
        '회 × 1 = 총 코스트 ' + formatCost(result.cost) + '</p>';
    lastSuccessfulResult = result;
    els.result.innerHTML = '<div class="multi-find-result-heading">' +
      '<h2>Find route · 완료</h2>' +
      '<button type="button" class="multi-find-route-draw"' +
      ' data-action="draw-route" aria-pressed="false">계획표 그리기</button>' +
      '</div>' + route +
      '<p><strong>다음 위치: ' + h(result.destination) + '</strong></p>' +
      costSummary +
      '<p>목표 ' + result.targetAcquired + '/' + result.targetTotal +
      '</p>' + routeLegendHtml() + '<p class="multi-find-result-meta">' +
      (result.optimization === "distance" ? '최단거리' :
        (result.optimization === "balance" ? '균형' : '최소코스트')) + ' · ' +
      Number(result.explored || 0).toLocaleString() + ' states · ' +
      (Number(result.elapsedMs || 0) / 1000).toFixed(2) + 's</p>';
  }

  function selectedTicketPools(snapshot, region, lang) {
    var byKind = { platinum: [], legend: [] };
    snapshot.rows.forEach(function (row) {
      var kind = row.pool && row.pool.platinum;
      if (kind !== "platinum" && kind !== "legend") return;
      byKind[kind].push({
        lang: row.lang,
        event: row.event,
        label: row.title || row.label,
        kind: kind,
        pool: row.pool
      });
    });

    var result = [];
    ["platinum", "legend"].forEach(function (kind) {
      if (byKind[kind].length) {
        result = result.concat(byKind[kind]);
        return;
      }
      var fallback = region.tickets && region.tickets[kind];
      if (!fallback) return;
      result.push({
        lang: lang,
        event: fallback.event,
        label: fallback.label,
        kind: kind,
        pool: fallback.pool
      });
    });
    return result;
  }

  function startSearch(snapshot) {
    stopWorker();
    clearRouteMarks();
    latestSnapshot = snapshot || latestSnapshot;
    renderDialog();
    if (!settings.targets.length) {
      els.result.hidden = true;
      return;
    }
    if (!latestSnapshot || !latestSnapshot.ready) {
      els.result.hidden = false;
      els.result.className = "multi-find-result is-running";
      els.result.innerHTML = '<h2>Find route</h2><p>이벤트 데이터를 불러오는 중…</p>';
      return;
    }
    if (typeof global.Worker !== "function") {
      renderResult({
        status: "invalid",
        message: "이 브라우저에서는 백그라운드 경로 계산을 지원하지 않습니다.",
        explored: 0,
        elapsedMs: 0
      });
      return;
    }

    var langs = latestSnapshot.rows.map(function (row) { return row.lang; });
    var lang = langs[0];
    var region = data.regions[lang] || {};
    var input = {
      seed: latestSnapshot.seed,
      last: latestSnapshot.last,
      count: latestSnapshot.count,
      formIndex: latestSnapshot.formIndex,
      optimization: settings.optimization,
      maxGuaranteed: settings.maxGuaranteed,
      maxPlatinum: settings.maxPlatinum,
      maxLegendTicket: settings.maxLegendTicket,
      targets: settings.targets,
      tickets: selectedTicketPools(latestSnapshot, region, lang),
      events: latestSnapshot.rows.filter(function (row) {
        return row.pool && !row.pool.platinum;
      }).map(function (row) {
        return {
          lang: row.lang,
          event: row.event,
          label: row.title || row.label,
          pool: row.pool
        };
      })
    };

    var currentRun = ++runId;
    runningStartedAt = Date.now();
    explored = 0;
    renderRunning();
    timer = global.setInterval(renderRunning, 1000);
    worker = new global.Worker(root.dataset.findWorker);
    worker.addEventListener("message", function (event) {
      if (currentRun !== runId) return;
      var message = event.data || {};
      if (message.type === "progress") {
        explored = Number(message.progress && message.progress.explored) || explored;
        return;
      }
      if (message.type === "result") {
        if (timer) global.clearInterval(timer);
        timer = 0;
        worker = null;
        renderResult(message.result);
      } else if (message.type === "error") {
        if (timer) global.clearInterval(timer);
        timer = 0;
        worker = null;
        renderResult({
          status: "invalid",
          message: "경로 계산 오류: " + message.message,
          explored: explored,
          elapsedMs: Date.now() - runningStartedAt
        });
      }
    });
    worker.addEventListener("error", function (event) {
      if (currentRun !== runId) return;
      if (timer) global.clearInterval(timer);
      timer = 0;
      worker = null;
      renderResult({
        status: "invalid",
        message: "경로 계산 Worker를 실행하지 못했습니다: " + event.message,
        explored: explored,
        elapsedMs: Date.now() - runningStartedAt
      });
    });
    worker.postMessage({
      type: "search",
      engineUrl: root.dataset.findEngine,
      input: input
    });
  }

  els.optimization.addEventListener("change", function () {
    settings.optimization = els.optimization.value === "distance" ? "distance" :
      (els.optimization.value === "balance" ? "balance" : "cost");
    settingsChanged();
  });
  els.maxGuaranteed.addEventListener("input", function () {
    settings.maxGuaranteed = clamp(parseInt(els.maxGuaranteed.value, 10) || 0,
      0, 20);
    settingsChanged();
  });
  els.maxGuaranteed.addEventListener("change", function () {
    els.maxGuaranteed.value = settings.maxGuaranteed;
  });
  els.maxPlatinum.addEventListener("input", function () {
    settings.maxPlatinum = clamp(parseInt(els.maxPlatinum.value, 10) || 0,
      0, 99);
    settingsChanged();
  });
  els.maxPlatinum.addEventListener("change", function () {
    els.maxPlatinum.value = settings.maxPlatinum;
  });
  els.maxLegendTicket.addEventListener("input", function () {
    settings.maxLegendTicket = clamp(
      parseInt(els.maxLegendTicket.value, 10) || 0, 0, 99);
    settingsChanged();
  });
  els.maxLegendTicket.addEventListener("change", function () {
    els.maxLegendTicket.value = settings.maxLegendTicket;
  });
  function openFilterDialog() {
    els.search.value = "";
    renderDialog();
    els.dialog.showModal();
    els.search.focus();
  }

  els.filter.addEventListener("click", openFilterDialog);
  els.targets.addEventListener("click", openFilterDialog);
  els.targets.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openFilterDialog();
  });
  els.search.addEventListener("input", renderAvailable);
  els.available.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-cat-id]");
    if (!button) return;
    toggleCat(parseInt(button.dataset.catId, 10));
  });
  els.selected.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-action='remove']");
    if (!button) return;
    var row = button.closest("[data-cat-id]");
    toggleCat(parseInt(row.dataset.catId, 10));
  });
  els.selected.addEventListener("change", function (event) {
    var row = event.target.closest("[data-cat-id]");
    if (!row) return;
    var target = selectedTarget(parseInt(row.dataset.catId, 10));
    if (!target) return;
    if (event.target.dataset.field === "allow_ticket") {
      target.allow_ticket = event.target.value === "true";
    } else {
      return;
    }
    settingsChanged();
  });
  els.dialog.querySelector("[data-multi-find-reset]").addEventListener("click",
    function () {
      settings.targets = [];
      settingsChanged();
      renderDialog();
    });
  els.dialog.querySelector("[data-multi-find-close]").addEventListener("click",
    function () { els.dialog.close(); });
  els.dialog.querySelector("[data-multi-find-backdrop]").addEventListener("click",
    function () { els.dialog.close(); });
  els.dialog.addEventListener("cancel", function (event) {
    event.preventDefault();
    els.dialog.close();
  });
  els.result.addEventListener("click", function (event) {
    var button = event.target.closest("button[data-action='draw-route']");
    if (!button || !lastSuccessfulResult) return;
    var drawn = button.getAttribute("aria-pressed") === "true";
    if (drawn) {
      clearRouteMarks();
    } else {
      applyRouteMarks(lastSuccessfulResult.actions || []);
    }
    button.setAttribute("aria-pressed", drawn ? "false" : "true");
    button.textContent = drawn ? "계획표 그리기" : "계획표 지우기";
  });
  if (els.help && els.helpDialog) {
    els.help.addEventListener("click", function () {
      els.helpDialog.showModal();
    });
    els.helpDialog.querySelector("[data-multi-find-help-close]").
      addEventListener("click", function () { els.helpDialog.close(); });
    els.helpDialog.querySelector("[data-multi-find-help-backdrop]").
      addEventListener("click", function () { els.helpDialog.close(); });
    els.helpDialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      els.helpDialog.close();
    });
  }
  root.addEventListener("multi-track:dirty", showPending);
  root.addEventListener("multi-track:updated", function (event) {
    startSearch(event.detail);
  });
  global.addEventListener("multi-share:changed", function () {
    settings = readSaved() || defaultSettings();
    lastSuccessfulResult = null;
    clearRouteMarks();
    renderSummary();
    renderDialog();
    showPending();
  });

  global.MultiFindApp = {
    getDestination: function () {
      return lastSuccessfulResult && lastSuccessfulResult.status === "success" ?
        lastSuccessfulResult.destination : null;
    },
    getShareSettings: function () {
      return {
        optimization: settings.optimization,
        maxGuaranteed: settings.maxGuaranteed,
        maxPlatinum: settings.maxPlatinum,
        maxLegendTicket: settings.maxLegendTicket,
        targets: settings.targets.map(function (target) {
          return {
            cat_id: target.cat_id,
            allow_ticket: target.allow_ticket
          };
        })
      };
    }
  };

  renderSummary();
  renderDialog();
  startSearch(latestSnapshot);
})(typeof self !== "undefined" ? self : this);
