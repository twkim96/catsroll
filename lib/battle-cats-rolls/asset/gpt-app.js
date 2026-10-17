(function () {
  "use strict";

  var doc = document;
  var root = window;
  var $ = function (id) { return doc.getElementById(id); };
  var els = {
    bridge: $("bridge-state"), mode: $("mode"), seed: $("seed"), count: $("count"), last: $("last"),
    seedField: $("seed-field"), countField: $("count-field"), lastField: $("last-field"), rowsPanel: $("rows-panel"), rows: $("rows"),
    rowHelp: $("row-help"), addRow: $("add-row"), findPanel: $("find-panel"), seekPanel: $("seek-panel"),
    catQuery: $("cat-query"), catLang: $("cat-lang"), searchCats: $("search-cats"), catResults: $("cat-results"),
    manualCatId: $("manual-cat-id"), addTarget: $("add-target"), targets: $("targets"),
    optimization: $("optimization"), maxGuaranteed: $("max-guaranteed"), maxPlatinum: $("max-platinum"),
    maxLegend: $("max-legend"), scheduleAware: $("schedule-aware"), seekRolls: $("seek-rolls"), addRoll: $("add-roll"),
    calculate: $("calculate"), cancel: $("cancel"), progressWrap: $("progress-wrap"), progressBar: $("progress-bar"),
    progressTrack: doc.querySelector(".progress-track"), progressLabel: $("progress-label"), status: $("status"),
    results: $("results-panel"), resultCaption: $("result-caption"), resultContent: $("result-content"),
    contextActions: $("context-actions"), sendContext: $("send-context")
  };

  var state = {
    mode: "multi",
    rows: [{ lang: "kr", event: "", label: "", ubers: 0, forceGuaranteed: 0, query: "", results: [], nextOffset: null }],
    targets: [],
    catResults: [],
    catNextOffset: null,
    seekRollIds: [],
    payload: null,
    lastResult: null,
    working: false,
    currentRun: null,
    runGeneration: 0,
    parentOrigin: null,
    connected: false,
    initId: null,
    nextRpcId: 1,
    pending: Object.create(null),
    localRequestId: 0
  };
  var disabledBeforeWork = new WeakMap();

  function text(value) { return value == null ? "" : String(value); }
  function setStatus(message, kind) {
    els.status.textContent = message || "";
    els.status.className = "status-message" + (kind ? " is-" + kind : "");
  }
  function setBridge(message, kind) {
    els.bridge.textContent = message;
    els.bridge.className = "bridge-pill" + (kind ? " is-" + kind : "");
  }
  function syncWorkingControls() {
    var app = $("catsroll-app");
    if (!app) return;
    Array.prototype.forEach.call(app.querySelectorAll("input, select, textarea, button"), function (control) {
      if (control === els.cancel) { control.disabled = false; return; }
      if (state.working) {
        if (!disabledBeforeWork.has(control)) disabledBeforeWork.set(control, !!control.disabled);
        control.disabled = true;
      } else if (disabledBeforeWork.has(control)) {
        control.disabled = disabledBeforeWork.get(control);
        disabledBeforeWork.delete(control);
      }
    });
  }
  function clearResultOnEdit(event) {
    if (state.working || !event.target || !event.target.closest) return;
    if (event.target.closest("#results-panel, #context-actions, #calculate, #cancel")) return;
    invalidateLastResult();
  }
  function invalidateLastResult() {
    state.lastResult = null;
    els.results.hidden = true;
    els.contextActions.hidden = true;
  }
  function node(tag, className, content) {
    var item = doc.createElement(tag);
    if (className) item.className = className;
    if (content != null) item.textContent = content;
    return item;
  }
  function button(label, className, action) {
    var item = node("button", "button " + (className || ""), label);
    item.type = "button";
    if (action) item.addEventListener("click", action);
    return item;
  }
  function normalizedPositive(value) {
    var number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : null;
  }
  function setMode(mode) {
    state.mode = mode === "find" || mode === "seek" ? mode : "multi";
    els.mode.value = state.mode;
    els.findPanel.hidden = state.mode !== "find";
    els.seekPanel.hidden = state.mode !== "seek";
    els.seedField.hidden = state.mode === "seek";
    els.countField.hidden = state.mode === "seek";
    els.lastField.hidden = state.mode === "seek";
    els.rowHelp.textContent = state.mode === "seek" ?
      "시커 계산에 사용할 지역과 배너 풀 하나를 선택하세요." :
      "계산에 사용할 배너와 풀 설정을 선택하세요.";
    els.addRow.hidden = state.mode === "seek";
    renderRows();
    renderSeekRolls();
  }

  function renderRows() {
    els.rows.replaceChildren();
    state.rows.forEach(function (row, index) {
      var card = node("article", "banner-row");
      var top = node("div", "row-top");
      var langLabel = node("label", "field lang-field");
      langLabel.appendChild(node("span", "", "지역"));
      var lang = node("select");
      lang.setAttribute("aria-label", "배너 " + (index + 1) + " 지역");
      [["kr", "한국"], ["jp", "일본"]].forEach(function (option) {
        var item = node("option", "", option[1]); item.value = option[0]; lang.appendChild(item);
      });
      lang.value = row.lang;
      lang.addEventListener("change", function () {
        row.lang = lang.value; row.event = ""; row.label = ""; row.results = []; row.nextOffset = null;
        renderRows();
      });
      langLabel.appendChild(lang); top.appendChild(langLabel);

      var eventLabel = node("label", "field event-field");
      eventLabel.appendChild(node("span", "", "배너 검색"));
      var query = node("input"); query.value = row.query || ""; query.autocomplete = "off";
      query.placeholder = "배너 이름 또는 ID"; query.setAttribute("aria-label", "배너 " + (index + 1) + " 검색어");
      query.addEventListener("input", function () { row.query = query.value; });
      query.addEventListener("keydown", function (event) {
        if (event.key === "Enter") { event.preventDefault(); searchEvents(index, 0); }
      });
      eventLabel.appendChild(query); top.appendChild(eventLabel);
      top.appendChild(button("검색", "button-secondary button-small search-button", function () { searchEvents(index, 0); }));
      if (state.mode !== "seek" || state.rows.length > 1) {
        var remove = button("삭제", "button-small button-secondary remove-row", function () {
          if (state.rows.length < 2) { setStatus("배너는 최소 하나 필요합니다.", "error"); return; }
          state.rows.splice(index, 1); renderRows();
        });
        remove.setAttribute("aria-label", "배너 " + (index + 1) + " 삭제"); top.appendChild(remove);
      }
      card.appendChild(top);

      if (row.label || row.event) {
        card.appendChild(node("p", "selected-event", "선택됨 · " + (row.label || row.event) + " · " + row.lang.toUpperCase() + " / " + row.event));
      }
      if (row.results && row.results.length) {
        var options = node("div", "event-results");
        row.results.forEach(function (event) {
          var choose = node("button", "event-option"); choose.type = "button";
          choose.setAttribute("aria-pressed", String(String(row.event) === String(event.event)));
          choose.appendChild(node("strong", "", event.label || event.event));
          choose.appendChild(node("small", "", event.event + (event.start_on ? " · " + event.start_on : "")));
          choose.addEventListener("click", function () {
            row.event = String(event.event); row.label = text(event.label || event.event);
            renderRows(); setStatus("배너를 선택했습니다.", "good");
          });
          options.appendChild(choose);
        });
        if (row.nextOffset != null) {
          options.appendChild(button("더 불러오기", "button-small button-secondary", function () { searchEvents(index, row.nextOffset); }));
        }
        card.appendChild(options);
      }
      {
        var bottom = node("div", "row-bottom");
        var uberLabel = node("label", "field"); uberLabel.appendChild(node("span", "", "미래 울슈레 수"));
        var ubers = node("input"); ubers.type = "number"; ubers.min = "0"; ubers.max = "100"; ubers.value = row.ubers == null ? "0" : String(row.ubers);
        ubers.setAttribute("aria-label", "배너 " + (index + 1) + " 미래 울슈레 수");
        ubers.addEventListener("input", function () { row.ubers = ubers.value; });
        uberLabel.appendChild(ubers); bottom.appendChild(uberLabel);
        var forceLabel = node("label", "field"); forceLabel.appendChild(node("span", "", "확정 뽑기"));
        var force = node("select"); force.setAttribute("aria-label", "배너 " + (index + 1) + " 확정 뽑기");
        [[0, "배너 기본값"], [11, "11회 확정"], [15, "15회 확정"]].forEach(function (option) {
          var item = node("option", "", option[1]); item.value = String(option[0]); force.appendChild(item);
        });
        var forceValue = row.forceGuaranteed == null ? 0 : Number(row.forceGuaranteed);
        if ([0, 11, 15].indexOf(forceValue) === -1) {
          var invalidForce = node("option", "", "확정 설정 확인 필요 (" + text(row.forceGuaranteed) + ")");
          invalidForce.value = text(row.forceGuaranteed); force.appendChild(invalidForce);
        }
        force.value = String(forceValue);
        force.addEventListener("change", function () { row.forceGuaranteed = Number(force.value); });
        forceLabel.appendChild(force); bottom.appendChild(forceLabel);
        card.appendChild(bottom);
      }
      els.rows.appendChild(card);
    });
    syncWorkingControls();
  }

  function renderTargets() {
    els.targets.replaceChildren();
    if (!state.targets.length) {
      els.targets.appendChild(node("p", "hint", "선택한 목표가 없습니다."));
      return;
    }
    state.targets.forEach(function (target) {
      var chip = node("div", "target-chip");
      chip.appendChild(node("span", "target-name", (target.name || "고양이") + " · ID " + target.cat_id));
      var ticketLabel = node("label"); var ticket = node("input"); ticket.type = "checkbox";
      ticket.checked = !!target.allow_ticket;
      ticket.addEventListener("change", function () { target.allow_ticket = ticket.checked; });
      ticketLabel.appendChild(ticket); ticketLabel.appendChild(doc.createTextNode("티켓 허용")); chip.appendChild(ticketLabel);
      var remove = node("button", "target-remove", "삭제"); remove.type = "button";
      remove.setAttribute("aria-label", (target.name || target.cat_id) + " 목표 삭제");
      remove.addEventListener("click", function () {
        state.targets = state.targets.filter(function (item) { return item.cat_id !== target.cat_id; });
        renderTargets(); renderCatResults();
      });
      chip.appendChild(remove); els.targets.appendChild(chip);
    });
    syncWorkingControls();
  }

  function renderCatResults() {
    els.catResults.replaceChildren();
    state.catResults.forEach(function (cat) {
      var row = node("div", "catalog-option");
      row.appendChild(node("span", "", (cat.name || "이름 미상") + " · ID " + cat.id));
      row.appendChild(node("span", "rarity", rarityName(cat.rarity)));
      var already = state.targets.some(function (target) { return target.cat_id === Number(cat.id); });
      row.appendChild(button(already ? "추가됨" : "목표 추가", "button-small button-secondary", function () {
        addTarget(cat.id, cat.name); renderCatResults();
      }));
      row.lastChild.disabled = already;
      els.catResults.appendChild(row);
    });
    if (state.catNextOffset != null) {
      els.catResults.appendChild(button("더 불러오기", "button-small button-secondary", function () { searchCats(state.catNextOffset); }));
    }
    syncWorkingControls();
  }

  function rarityName(value) {
    var names = { 2: "레어", 3: "슈퍼레어", 4: "울슈레", 5: "레전드레어" };
    return names[Number(value)] || "등급 " + text(value);
  }

  function addTarget(idValue, name) {
    var id = normalizedPositive(idValue);
    if (!id) { setStatus("고양이 ID는 1 이상의 정수여야 합니다.", "error"); return; }
    if (state.targets.some(function (target) { return target.cat_id === id; })) return;
    if (state.targets.length >= 30) { setStatus("Find 목표는 최대 30명까지 선택할 수 있습니다.", "error"); return; }
    state.targets.push({ cat_id: id, allow_ticket: false, name: text(name || "고양이 #" + id) });
    renderTargets();
  }

  function renderSeekRolls() {
    els.seekRolls.replaceChildren();
    var choices = state.payload && state.payload.seeker && Array.isArray(state.payload.seeker.choices) ?
      state.payload.seeker.choices : [];
    state.seekRollIds.forEach(function (selectedId, index) {
      var line = node("div", "seek-roll"); line.appendChild(node("span", "", String(index + 1) + "."));
      var select = node("select"); select.setAttribute("aria-label", "관측한 " + (index + 1) + "번째 고양이");
      var placeholder = node("option", "", choices.length ? "고양이를 선택하세요" : "먼저 배너 풀을 준비하세요");
      placeholder.value = ""; select.appendChild(placeholder);
      choices.forEach(function (cat) {
        var option = node("option", "", (cat.name || "고양이") + " · " + rarityName(cat.rarity) + " · 슬롯 " + cat.slot + " · ID " + cat.id);
        option.value = String(cat.id); select.appendChild(option);
      });
      select.value = selectedId == null ? "" : String(selectedId);
      select.disabled = choices.length === 0;
      select.addEventListener("change", function () { state.seekRollIds[index] = select.value ? Number(select.value) : null; });
      line.appendChild(select);
      line.appendChild(button("삭제", "button-small button-secondary remove-row", function () {
        state.seekRollIds.splice(index, 1); renderSeekRolls();
      }));
      els.seekRolls.appendChild(line);
    });
    syncWorkingControls();
  }

  function payloadFromResult(result) {
    if (!result || typeof result !== "object") return null;
    var meta = result._meta || (result.result && result.result._meta);
    return meta && meta["catsroll/data"] ? meta["catsroll/data"] : null;
  }
  function structuredFromResult(result) {
    if (!result || typeof result !== "object") return {};
    if (result.structuredContent) return result.structuredContent;
    if (result.result && result.result.structuredContent) return result.result.structuredContent;
    return {};
  }
  function resultError(result) {
    if (result && result.isError) {
      var content = (result.content || []).map(function (part) { return part.text || ""; }).filter(Boolean).join("\n");
      return content || "도구 호출이 실패했습니다.";
    }
    return "";
  }

  function rpcRequest(method, params, timeoutMs) {
    if (!state.connected || !state.parentOrigin) return Promise.reject(new Error("ChatGPT 연결이 준비되지 않았습니다."));
    var id = state.nextRpcId++;
    return new Promise(function (resolve, reject) {
      var timer = root.setTimeout(function () {
        delete state.pending[id];
        reject(new Error("ChatGPT 연결 응답 시간이 초과됐습니다. 연결 상태를 확인하고 다시 시도해 주세요."));
      }, timeoutMs || 20000);
      state.pending[id] = { resolve: resolve, reject: reject, timer: timer, method: method };
      try {
        root.parent.postMessage({ jsonrpc: "2.0", id: id, method: method, params: params || {} }, state.parentOrigin);
      } catch (error) {
        root.clearTimeout(timer); delete state.pending[id]; reject(error);
      }
    });
  }

  function parseSseOrJson(raw) {
    var trimmed = String(raw || "").trim();
    if (!trimmed) throw new Error("MCP 응답이 비어 있습니다.");
    try { return JSON.parse(trimmed); } catch (_) {}
    var dataBlocks = trimmed.split(/\r?\n\r?\n/).map(function (block) {
      return block.split(/\r?\n/).filter(function (line) { return line.slice(0, 5) === "data:"; })
        .map(function (line) { return line.slice(5).trim(); }).join("\n");
    }).filter(Boolean);
    for (var i = dataBlocks.length - 1; i >= 0; i -= 1) {
      try { return JSON.parse(dataBlocks[i]); } catch (_) {}
    }
    throw new Error("MCP 응답 형식을 읽을 수 없습니다.");
  }

  async function standaloneRequest(method, params) {
    var controller = new AbortController();
    var timer = root.setTimeout(function () { controller.abort(); }, 20000);
    var id = ++state.localRequestId;
    try {
      var response = await root.fetch("/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: id, method: method, params: params || {} }),
        signal: controller.signal
      });
      var raw = await response.text();
      if (!response.ok) throw new Error("/mcp 요청 실패 (HTTP " + response.status + ")");
      var envelope = parseSseOrJson(raw);
      if (envelope.error) throw new Error(envelope.error.message || "MCP 요청이 실패했습니다.");
      return envelope.result;
    } catch (error) {
      if (error && error.name === "AbortError") throw new Error("/mcp 응답 시간이 초과됐습니다.");
      throw error;
    } finally { root.clearTimeout(timer); }
  }

  function callTool(name, args) {
    var params = { name: name, arguments: args || {} };
    return root.parent === root ? standaloneRequest("tools/call", params) : rpcRequest("tools/call", params, 30000);
  }

  function handleRpcResponse(message) {
    var pending = state.pending[message.id];
    if (!pending) return false;
    delete state.pending[message.id]; root.clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message || "ChatGPT 요청이 실패했습니다."));
    else pending.resolve(message.result);
    return true;
  }

  function applyHostArguments(args) {
    if (!args || typeof args !== "object") return;
    if (state.currentRun) cancelCalculation("새 도구 입력을 받아 계산을 중단했습니다. 입력을 확인한 뒤 다시 실행해 주세요.");
    invalidateLastResult();
    state.payload = null;
    if (args.mode) setMode(args.mode);
    if (args.seed != null) els.seed.value = text(args.seed);
    if (args.count != null) els.count.value = text(args.count);
    if (args.last != null) els.last.value = text(args.last);
    if (Array.isArray(args.rows) && args.rows.length) {
      state.rows = args.rows.map(function (row) {
        return {
          lang: row.lang === "jp" ? "jp" : "kr", event: text(row.event), label: text(row.label || row.event),
        ubers: row.ubers == null ? 0 : row.ubers, forceGuaranteed: row.forceGuaranteed == null ? 0 : row.forceGuaranteed,
          query: "", results: [], nextOffset: null
        };
      });
      renderRows();
    }
    if (Array.isArray(args.targets)) {
      state.targets = args.targets.map(function (target) {
        var old = state.targets.find(function (item) { return item.cat_id === Number(target.cat_id); });
        return { cat_id: Number(target.cat_id), allow_ticket: !!target.allow_ticket, name: old && old.name || "고양이 #" + target.cat_id };
      }).filter(function (target) { return normalizedPositive(target.cat_id); });
      renderTargets();
    }
    if (args.optimization) els.optimization.value = args.optimization;
    if (args.maxGuaranteed != null) els.maxGuaranteed.value = text(args.maxGuaranteed);
    if (args.maxPlatinum != null) els.maxPlatinum.value = text(args.maxPlatinum);
    if (args.maxLegendTicket != null) els.maxLegend.value = text(args.maxLegendTicket);
    if (args.scheduleAware != null) els.scheduleAware.checked = !!args.scheduleAware;
    if (Array.isArray(args.rolls)) state.seekRollIds = args.rolls.map(Number);
    renderSeekRolls();
    setStatus("도구 입력을 불러왔습니다. 기기 계산은 버튼을 눌렀을 때 시작합니다.");
  }

  function applyPreparedPayload(payload, origin) {
    if (!payload || typeof payload !== "object") {
      setStatus("도구 결과에 기기 계산용 데이터가 없습니다. 다시 준비해 주세요.", "error"); return false;
    }
    state.payload = payload;
    if (payload.request && origin === "host") applyHostArguments(payload.request);
    if (Array.isArray(payload.events)) {
      payload.events.forEach(function (event, index) {
        if (state.rows[index] && String(state.rows[index].event) === String(event.event)) {
          state.rows[index].label = text(event.label || event.event);
        }
      });
      renderRows();
    }
    renderSeekRolls();
    els.contextActions.hidden = !state.connected;
    if (state.mode === "seek" && payload.seeker) {
      setStatus("배너 풀이 준비됐습니다. 관측 결과를 순서대로 선택한 뒤 다시 계산을 누르세요.", "good");
    } else {
      setStatus("기기 계산 데이터가 준비됐습니다. 계속하려면 ‘기기에서 계산’을 누르세요.", "good");
    }
    return true;
  }

  function onHostMessage(event) {
    if (event.source !== root.parent) return;
    var message = event.data;
    if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") return;

    if (!state.parentOrigin) {
      if (message.id !== state.initId || (!Object.prototype.hasOwnProperty.call(message, "result") && !message.error)) return;
      if (!event.origin || event.origin === "null") {
        setBridge("호스트 출처 확인 실패", "error");
        setStatus("ChatGPT 호스트의 보안 출처를 확인할 수 없습니다.", "error");
        return;
      }
      state.parentOrigin = event.origin;
      var pending = state.pending[message.id];
      if (pending) handleRpcResponse(message);
      if (message.error) {
        state.connected = false; setBridge("연결 실패", "error");
        setStatus(message.error.message || "ChatGPT 연결을 시작하지 못했습니다.", "error"); return;
      }
      state.connected = true;
      root.parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} }, state.parentOrigin);
      setBridge("ChatGPT 연결됨", "ready");
      els.contextActions.hidden = false;
      return;
    }
    if (event.origin !== state.parentOrigin) return;
    if (Object.prototype.hasOwnProperty.call(message, "id") && handleRpcResponse(message)) return;

    if (message.method === "ui/notifications/tool-input") {
      applyHostArguments(message.params && message.params.arguments);
    } else if (message.method === "ui/notifications/tool-result") {
      var payload = payloadFromResult(message.params);
      if (payload) applyPreparedPayload(payload, "host");
      else {
        var errorMessage = resultError(message.params);
        if (errorMessage) setStatus(errorMessage, "error");
      }
    } else if (message.method === "ui/notifications/tool-cancelled") {
      setStatus("호스트에서 도구 실행을 취소했습니다.");
    }
  }

  function initializeHost() {
    if (root.parent === root) { state.connected = false; setBridge("로컬 미리보기", "ready"); return; }
    root.addEventListener("message", onHostMessage);
    var id = state.nextRpcId++;
    state.initId = id;
    var timer = root.setTimeout(function () {
      if (state.connected) return;
      delete state.pending[id]; setBridge("연결 응답 없음", "error");
      setStatus("ChatGPT 호스트가 초기화에 응답하지 않았습니다. 앱을 다시 열어 주세요.", "error");
    }, 10000);
    state.pending[id] = { resolve: function () {}, reject: function () {}, timer: timer, method: "ui/initialize" };
    try {
      root.parent.postMessage({ jsonrpc: "2.0", id: id, method: "ui/initialize", params: {
        protocolVersion: "2026-01-26",
        appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
        appInfo: { name: "Catsroll", version: "1.0.0" }
      } }, "*");
    } catch (error) {
      root.clearTimeout(timer); delete state.pending[id];
      setBridge("연결 실패", "error"); setStatus(error.message || String(error), "error");
    }
  }

  async function searchEvents(index, offset) {
    var row = state.rows[index]; if (!row) return;
    setStatus("배너 목록을 불러오는 중…");
    try {
      var result = await callTool("catsroll_events", { lang: row.lang, query: (row.query || "").trim() || undefined, offset: offset || 0, limit: 50 });
      var error = resultError(result); if (error) throw new Error(error);
      var data = structuredFromResult(result);
      var events = Array.isArray(data.events) ? data.events : [];
      row.results = offset ? row.results.concat(events) : events;
      row.nextOffset = data.nextOffset == null ? null : data.nextOffset;
      renderRows(); setStatus("배너 " + row.results.length + "개를 불러왔습니다." + (data.total != null ? " · 전체 " + data.total + "개" : ""), "good");
    } catch (error) { setStatus(error.message || String(error), "error"); }
  }

  async function searchCats(offset) {
    var query = els.catQuery.value.trim();
    setStatus("고양이 목록을 불러오는 중…");
    try {
      var result = await callTool("catsroll_cats", { lang: els.catLang.value, query: query || undefined, offset: offset || 0, limit: 50 });
      var error = resultError(result); if (error) throw new Error(error);
      var data = structuredFromResult(result);
      var cats = Array.isArray(data.cats) ? data.cats : [];
      state.catResults = offset ? state.catResults.concat(cats) : cats;
      state.catNextOffset = data.nextOffset == null ? null : data.nextOffset;
      renderCatResults(); setStatus("고양이 " + state.catResults.length + "개를 불러왔습니다." + (data.total != null ? " · 전체 " + data.total + "개" : ""), "good");
    } catch (error) { setStatus(error.message || String(error), "error"); }
  }

  function readForm() {
    var mode = state.mode;
    var rows = state.rows.map(function (row) {
      if (row.ubers === "") throw new Error("미래 울슈레 수를 입력해 주세요. 0도 입력할 수 있습니다.");
      var ubers = Number(row.ubers == null ? 0 : row.ubers);
      var forceGuaranteed = Number(row.forceGuaranteed == null ? 0 : row.forceGuaranteed);
      if (!Number.isInteger(ubers) || ubers < 0 || ubers > 100) throw new Error("미래 울슈레 수는 0부터 100 사이의 정수여야 합니다.");
      if ([0, 11, 15].indexOf(forceGuaranteed) === -1) throw new Error("확정 뽑기 설정을 확인해 주세요.");
      if (mode === "seek" && (ubers !== 0 || forceGuaranteed !== 0)) throw new Error("시드 찾기는 미래 울슈레와 확정 설정이 없는 일반 배너만 지원합니다.");
      return { lang: row.lang, event: row.event, ubers: ubers, forceGuaranteed: forceGuaranteed };
    });
    if (!rows.length || rows.some(function (row) { return !row.event; })) throw new Error("계산할 지역과 배너를 모두 선택해 주세요.");
    if (mode === "seek" && rows.length !== 1) throw new Error("시드 찾기는 배너 풀 하나만 선택해 주세요.");
    var args = { mode: mode, rows: rows };
    if (mode !== "seek") {
      var seed = Number(els.seed.value);
      if (!Number.isInteger(seed) || seed < 1 || seed > 4294967295) throw new Error("시드는 1부터 4,294,967,295 사이의 정수여야 합니다.");
      args.seed = seed;
      var count = Number(els.count.value);
      if (!Number.isInteger(count) || count < 1 || count > 999) throw new Error("횟수는 1부터 999까지의 정수여야 합니다.");
      args.count = count;
      if (els.last.value.trim()) {
        var last = Number(els.last.value);
        if (!Number.isInteger(last) || last < 0 || last > 1000000) throw new Error("마지막 고양이 ID는 0부터 1,000,000 사이의 정수여야 합니다.");
        args.last = last;
      }
    }
    if (mode === "find") {
      if (!state.targets.length) throw new Error("Find 목표 고양이를 한 명 이상 선택해 주세요.");
      if (rows.some(function (row) { return row.lang !== rows[0].lang; })) throw new Error("Find는 한국 또는 일본 중 한 지역의 배너만 함께 선택할 수 있습니다.");
      args.targets = state.targets.map(function (target) { return { cat_id: target.cat_id, allow_ticket: !!target.allow_ticket }; });
      args.optimization = els.optimization.value;
      if (!els.maxGuaranteed.value.trim() || !els.maxPlatinum.value.trim() || !els.maxLegend.value.trim()) throw new Error("티켓 및 확뽑 횟수 제한을 모두 입력해 주세요.");
      args.maxGuaranteed = Number(els.maxGuaranteed.value);
      args.maxPlatinum = Number(els.maxPlatinum.value);
      args.maxLegendTicket = Number(els.maxLegend.value);
      [[args.maxGuaranteed, "확뽑 최대"], [args.maxPlatinum, "플래티넘 티켓 최대"], [args.maxLegendTicket, "레전드 티켓 최대"]].forEach(function (entry) {
        if (!Number.isInteger(entry[0]) || entry[0] < 0 || entry[0] > 20) throw new Error(entry[1] + "은 0부터 20 사이의 정수여야 합니다.");
      });
      args.scheduleAware = els.scheduleAware.checked;
    }
    if (mode === "seek") {
      var observed = state.seekRollIds.map(function (id) { return normalizedPositive(id); });
      var lastObserved = -1;
      observed.forEach(function (id, index) { if (id) lastObserved = index; });
      if (observed.slice(0, lastObserved + 1).some(function (id) { return !id; })) {
        throw new Error("관측 결과 중간을 비울 수 없습니다. 앞선 결과를 선택하거나 뒤쪽 빈 항목을 삭제해 주세요.");
      }
      args.rolls = observed.slice(0, lastObserved + 1).map(Number);
    }
    return args;
  }

  function showWorking(working) {
    state.working = working;
    els.cancel.hidden = !working || !state.currentRun;
    if (!working) { els.progressWrap.hidden = true; els.progressTrack.classList.remove("is-indeterminate"); }
    syncWorkingControls();
  }

  function updateProgress(progress) {
    if (!progress || typeof progress !== "object") return;
    els.progressWrap.hidden = false;
    var explored = Number(progress.explored) || 0;
    var offset = Number(progress.offset) || 0;
    els.progressTrack.classList.add("is-indeterminate");
    els.progressLabel.textContent = "탐색 중 · " + explored.toLocaleString() + " 상태 · 위치 " + offset + (progress.phase === "pareto" ? " · 파레토 단계" : "");
  }

  function parseWorkerSource() {
    var sourceElement = $("catsroll-worker-source");
    if (!sourceElement) throw new Error("WASM 작업자 코드가 포함되지 않았습니다.");
    var source = JSON.parse(sourceElement.textContent || "null");
    if (typeof source !== "string" || !source) throw new Error("WASM 작업자 코드를 읽을 수 없습니다.");
    return source;
  }

  async function runCalculation() {
    if (state.working) return;
    var args;
    try { args = readForm(); }
    catch (error) { setStatus(error.message, "error"); return; }
    var run = {
      generation: ++state.runGeneration,
      cancelled: false,
      workerRun: null,
      cancel: function () {
        run.cancelled = true;
        if (run.workerRun && typeof run.workerRun.cancel === "function") run.workerRun.cancel();
      }
    };
    function isCurrentRun() {
      return state.currentRun === run && !run.cancelled && state.runGeneration === run.generation;
    }
    state.currentRun = run;
    state.payload = null;
    invalidateLastResult();
    showWorking(true); els.progressWrap.hidden = false; els.progressTrack.classList.add("is-indeterminate");
    els.progressLabel.textContent = "계산 데이터를 준비하는 중…";
    setStatus("배너와 캐릭터 풀을 준비하고 있습니다.");
    try {
      var prepared = await callTool("catsroll_prepare", args);
      if (!isCurrentRun()) return;
      var toolFailure = resultError(prepared); if (toolFailure) throw new Error(toolFailure);
      var payload = payloadFromResult(prepared);
      if (!payload) throw new Error("준비 결과에 _meta['catsroll/data']가 없습니다.");
      state.payload = payload;
      if (args.mode === "seek" && !args.rolls.length) {
        applyPreparedPayload(payload, "local");
        showWorking(false); state.currentRun = null; els.progressWrap.hidden = true;
        return;
      }
      if (args.mode === "seek" && (!payload.seeker || !Array.isArray(payload.seeker.rolls) || !payload.seeker.rolls.length)) {
        applyPreparedPayload(payload, "local");
        throw new Error("관측 결과가 시커 입력으로 준비되지 않았습니다. 고양이 선택과 배너 풀을 확인해 주세요.");
      }
      applyPreparedPayload(payload, "local");
      els.progressLabel.textContent = "현재 기기에서 계산 중…";
      var runtime = root.CatsrollGptRuntime;
      if (!runtime || typeof runtime.start !== "function") throw new Error("기기 계산 runtime이 로드되지 않았습니다.");
      var source = parseWorkerSource();
      var active = runtime.start(args.mode, payload, { source: source, onProgress: updateProgress });
      run.workerRun = active;
      els.cancel.hidden = false;
      var result = await active.promise;
      if (!isCurrentRun()) return;
      state.currentRun = null;
      showWorking(false);
      var preparedRequest = payload.request && typeof payload.request === "object" ? payload.request : args;
      state.lastResult = {
        mode: args.mode,
        request: JSON.parse(JSON.stringify(preparedRequest)),
        targetNames: args.mode === "find" ? state.targets.map(function (target) {
          return { cat_id: target.cat_id, name: target.name };
        }) : [],
        dataVersion: result && result.dataVersion != null ? result.dataVersion : payload.dataVersion,
        result: result,
        payload: payload
      };
      renderResult(args.mode, result);
      setStatus("기기 계산이 끝났습니다.", "good");
    } catch (error) {
      if (!isCurrentRun()) return;
      state.currentRun = null; showWorking(false);
      if (error && error.name === "AbortError") {
        setStatus("계산을 중단했습니다. 이 작업의 결과는 폐기했습니다.");
        return;
      }
      els.results.hidden = true;
      setStatus(error.message || String(error), "error");
    }
  }

  function renderResult(mode, result) {
    els.resultContent.replaceChildren(); els.results.hidden = false; els.contextActions.hidden = !state.connected;
    if (mode === "multi") renderMultiResult(result || {});
    else if (mode === "find") renderFindResult(result || {});
    else renderSeekResult(result || {});
  }

  function renderMultiResult(result) {
    var rows = Array.isArray(result.rows) ? result.rows : [];
    els.resultCaption.textContent = "시드 " + text(result.seed) + " · " + text(result.count) + "회 · " + rows.length + "개 배너";
    var badges = node("div", "result-summary");
    badges.appendChild(node("span", "summary-badge", "계산 배너 " + rows.length));
    els.resultContent.appendChild(badges);
    var wrap = node("div", "result-table-wrap"); var table = node("table");
    var head = node("thead"); var bannerHead = node("tr");
    var positionHead = node("th", "position-head", "위치");
    positionHead.rowSpan = 2; bannerHead.appendChild(positionHead);
    rows.forEach(function (row) {
      var th = node("th", "banner-head", row.label || row.event || "배너");
      th.colSpan = 2; th.title = (row.lang || "").toUpperCase() + " · " + text(row.event);
      bannerHead.appendChild(th);
    });
    head.appendChild(bannerHead);
    var trackHead = node("tr");
    rows.forEach(function () {
      trackHead.appendChild(node("th", "track-head", "A"));
      trackHead.appendChild(node("th", "track-head", "B"));
    });
    head.appendChild(trackHead); table.appendChild(head);
    var maxRows = rows.reduce(function (maximum, row) {
      return Math.max(maximum, row.tracks && row.tracks.A && row.tracks.A.length || 0,
        row.tracks && row.tracks.B && row.tracks.B.length || 0);
    }, 0);
    var body = node("tbody");
    function conditionalEntries(row, position) {
      var atPosition = row.alternatives && row.alternatives[String(position)];
      return Array.isArray(atPosition) ? atPosition : [];
    }
    function describeCat(cat) {
      if (!cat) return "";
      return (cat.name || "고양이 #" + text(cat.id)) + " · ID " + text(cat.id) +
        " · " + rarityName(cat.rarity) + (cat.next != null ? " → " + cat.next : "");
    }
    function renderTrackCell(row, track, index) {
      var cell = node("td", "track-cell");
      var entries = row.tracks && Array.isArray(row.tracks[track]) ? row.tracks[track] : [];
      var entry = entries[index];
      if (!entry) { cell.textContent = "—"; return cell; }
      cell.appendChild(node("small", "entry-position", text(entry.position || entry.start || "위치 미상")));
      cell.appendChild(node("strong", "", (entry.name || "고양이 #" + entry.id) + " · " + rarityName(entry.rarity)));
      cell.appendChild(node("small", "", "ID " + text(entry.id) + (entry.next != null ? " · 다음 " + entry.next : "")));
      [["R", entry.rerolled], ["G", entry.guaranteed], ["RG", entry.rerolled && entry.rerolled.guaranteed]].forEach(function (variant) {
        var cat = variant[1];
        if (!cat) return;
        cell.appendChild(node("small", "track-variant", variant[0] + " · " + describeCat(cat)));
      });
      var choices = conditionalEntries(row, entry.position);
      if (choices.length) {
        var details = node("details", "conditional-details");
        details.appendChild(node("summary", "", "조건부 R/G " + choices.length + "개"));
        var list = node("ul", "conditional-list");
        choices.slice(0, 8).forEach(function (wrapped) {
          var alternative = wrapped || {}; var pull = alternative.pull || {};
          var kind = alternative.kind === "guaranteed" ? (alternative.variant === "rerolled" ? "RG" : "G") : (alternative.kind === "reroll" ? "R" : "일반");
          var label = kind + " · " + (pull.name || "고양이 #" + text(pull.id));
          if (pull.id != null) label += " · ID " + pull.id;
          if (alternative.next != null) label += " → " + alternative.next;
          var prerequisite = alternative.prerequisite;
          if (prerequisite) {
            var sourceRow = rows[prerequisite.column];
            label += " · " + (sourceRow && (sourceRow.label || sourceRow.event) || "배너 " + (Number(prerequisite.column) + 1)) + " " + text(prerequisite.position) + " " + text(prerequisite.name) + " 이후";
          } else label += " · 시작 상태에서 가능";
          list.appendChild(node("li", "", label));
        });
        if (choices.length > 8) list.appendChild(node("li", "", "추가 조건부 결과 " + (choices.length - 8) + "개 생략"));
        details.appendChild(list); cell.appendChild(details);
      }
      return cell;
    }
    for (var index = 0; index < maxRows; index += 1) {
      var line = node("tr");
      var position = null;
      rows.some(function (row) {
        var entry = row.tracks && row.tracks.A && row.tracks.A[index] || row.tracks && row.tracks.B && row.tracks.B[index];
        if (entry) { position = entry.position; return true; }
        return false;
      });
      line.appendChild(node("th", "position-cell", String(index + 1) + (position ? "회 · " + position : "회")));
      rows.forEach(function (row) {
        line.appendChild(renderTrackCell(row, "A", index));
        line.appendChild(renderTrackCell(row, "B", index));
      });
      body.appendChild(line);
    }
    table.appendChild(body); wrap.appendChild(table); els.resultContent.appendChild(wrap);
  }

  function findActionName(action) {
    return action && (action.name || action.catName) || "";
  }

  function findActionId(action) {
    if (!action) return null;
    return action.id != null ? action.id : (action.catId != null ? action.catId : null);
  }

  function acquiredName(value) {
    var id = null; var name = "";
    if (value && typeof value === "object") {
      id = value.id != null ? value.id : (value.cat_id != null ? value.cat_id : (value.catId != null ? value.catId : null));
      name = value.name || value.catName || "";
    } else if (typeof value === "number" || /^\d+$/.test(text(value))) id = Number(value);
    else name = text(value);
    var target = id == null ? null : state.targets.find(function (item) { return item.cat_id === Number(id); });
    if (!name && target) name = target.name;
    return (name || (id == null ? "목표" : "ID " + id)) + (id == null ? "" : " (#" + id + ")");
  }

  function renderFindResult(result) {
    var status = text(result.status || "unknown");
    var names = { success: "완료", partial: "부분 결과 · 최적성 미확인", impossible: "가능한 경로 없음", limit: "탐색 한도 초과", invalid: "입력 확인 필요", idle: "목표 필요", cancelled: "중단됨" };
    els.resultCaption.textContent = names[status] || "Find 결과";
    var warning = status === "partial" || status === "impossible" || status === "limit" || status === "invalid";
    if (warning) els.resultContent.appendChild(node("p", "result-note is-warning", result.message || (status === "partial" ? "현재까지 찾은 경로이며 최적성은 보장되지 않습니다." : "계산된 경로가 없습니다.")));
    if (status === "success" || status === "partial") {
      var summary = node("div", "result-summary");
      summary.appendChild(node("span", "summary-badge", "목표 " + text(result.targetAcquired) + "/" + text(result.targetTotal)));
      summary.appendChild(node("span", "summary-badge", "다음 위치 " + text(result.destination)));
      summary.appendChild(node("span", "summary-badge", "코스트 " + Number(result.cost || 0).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")));
      els.resultContent.appendChild(summary);
      var actions = Array.isArray(result.actions) ? result.actions : [];
      var list = node("ol", "route-list");
      actions.slice(0, 80).forEach(function (action) {
        var pieces = [];
        if (action.type === "roll") {
          pieces.push(action.resultLabel || action.start || "레어티켓"); pieces.push(action.eventLabel || action.event || "배너");
          var name = findActionName(action); var id = findActionId(action);
          pieces.push(name || "고양이 #" + text(id));
          if (id != null) pieces.push("ID " + id);
          if (action.rerolled) pieces.push("R 열변경 " + (action.originalCatName || "") + (name ? " → " + name : ""));
        } else if (action.type === "ticket") {
          var ticketName = findActionName(action); var ticketId = findActionId(action);
          pieces.push(action.ticketKind === "legend" ? "레전드 티켓" : "플래티넘 티켓"); pieces.push(ticketName || "고양이 #" + text(ticketId));
          if (ticketId != null) pieces.push("ID " + ticketId);
          pieces.push(action.start || "");
        } else if (action.type === "guaranteed") {
          pieces.push("확뽑 · " + (action.eventLabel || action.event || "배너")); pieces.push(action.start + "~" + action.guaranteedLabel);
        } else { pieces.push(text(action.type || "행동")); }
        if (action.acquired && action.acquired.length) pieces.push("목표 획득: " + action.acquired.map(acquiredName).join(", "));
        if (action.next != null) pieces.push("다음 " + action.next);
        list.appendChild(node("li", "", pieces.filter(Boolean).join(" · ")));
      });
      if (actions.length > 80) els.resultContent.appendChild(node("p", "hint", "경로 " + actions.length + "개 중 첫 80개만 표시했습니다."));
      els.resultContent.appendChild(list);
      if (status === "partial") els.resultContent.appendChild(node("p", "result-note is-warning", "상태 한도에 도달했습니다. 이 경로는 현재까지의 결과이며 최적 경로로 확정할 수 없습니다."));
    } else if (!warning) {
      els.resultContent.appendChild(node("p", "result-note", result.message || "Find 결과를 표시할 수 없습니다."));
    }
    if (result.explored != null) els.resultContent.appendChild(node("p", "hint", Number(result.explored).toLocaleString() + "개 상태 탐색 · " + ((Number(result.elapsedMs) || 0) / 1000).toFixed(2) + "초"));
  }

  function renderSeekResult(result) {
    var status = Number(result.status);
    els.resultCaption.textContent = result.ok === false ? "계산 오류" : (status === 0 ? "일치하는 시드 없음" : status === 1 ? "시드 후보 1개" : "여러 시드 후보");
    if (result.ok === false) {
      els.resultContent.appendChild(node("p", "result-note is-warning", result.error || "WASM 시드 검색에 실패했습니다.")); return;
    }
    if (status === 0) {
      els.resultContent.appendChild(node("p", "result-note is-warning", "입력한 결과와 일치하는 시드를 찾지 못했습니다. 지역, 배너, 관측 순서를 확인해 주세요.")); return;
    }
    if (status === 1 && Number(result.count) === 1) {
      els.resultContent.appendChild(node("p", "result-note", "시작 시드: " + text(result.begin)));
      els.resultContent.appendChild(node("p", "result-note", "입력한 뽑기 후 시드: " + text(result.end)));
      els.resultContent.appendChild(node("p", "result-note", "후보 수: 1개"));
    } else {
      els.resultContent.appendChild(node("p", "result-note", "후보 수: 2개 이상 (탐색이 두 번째 후보에서 멈췄습니다.)"));
    }
    if (status > 1 || Number(result.count) > 1) {
      els.resultContent.appendChild(node("p", "result-note is-warning", "후보가 여러 개입니다. 실제 시드를 확정하려면 뽑기 결과를 더 입력해 다시 검색하세요."));
    }
  }

  function compactContext(last) {
    var mode = last.mode; var result = last.result || {}; var lines = ["Catsroll 기기 계산 결과", "계산 종류: " + (mode === "multi" ? "Multi 배열" : mode === "find" ? "Find 경로" : "시드 찾기"), "데이터 버전: " + text(last.dataVersion || "미제공") + ".", "입력: " + JSON.stringify(last.request || {})];
    if (mode === "multi") {
      var rows = Array.isArray(result.rows) ? result.rows : [];
      var request = last.request || {};
      var totalEntries = rows.reduce(function (sum, row) {
        return sum + (row.tracks && row.tracks.A || []).length + (row.tracks && row.tracks.B || []).length;
      }, 0);
      lines.push("입력: 시드 " + text(request.seed) + ", " + text(request.count) + "회, 마지막 고양이 ID " + text(request.last == null ? 0 : request.last) + ".");
      lines.push("계산한 배너 " + rows.length + "개.");
      var bannerInputs = Array.isArray(request.rows) ? request.rows.map(function (row) {
        return text(row.lang).toUpperCase() + "/" + text(row.event) + " 울슈레 " + text(row.ubers == null ? 0 : row.ubers) +
          " 확정 " + (Number(row.forceGuaranteed) === 0 ? "배너 기본값" : text(row.forceGuaranteed) + "회");
      }).join("; ") : "미제공";
      lines.push("배너 입력: " + bannerInputs + ".");
      function entryText(entry) {
        if (!entry) return "—";
        var value = text(entry.position || "위치 미상") + " " + (entry.name || "고양이") + "#" + text(entry.id);
        if (entry.next != null) value += "→" + entry.next;
        if (entry.rerolled) value += " R:" + (entry.rerolled.name || "고양이") + "#" + text(entry.rerolled.id) + (entry.rerolled.next != null ? "→" + entry.rerolled.next : "");
        if (entry.guaranteed) value += " G:" + (entry.guaranteed.name || "고양이") + "#" + text(entry.guaranteed.id) + (entry.guaranteed.next != null ? "→" + entry.guaranteed.next : "");
        if (entry.rerolled && entry.rerolled.guaranteed) value += " RG:" + (entry.rerolled.guaranteed.name || "고양이") + "#" + text(entry.rerolled.guaranteed.id) + (entry.rerolled.guaranteed.next != null ? "→" + entry.rerolled.guaranteed.next : "");
        return value;
      }
      var outputLines = [];
      var omittedEntries = 0;
      rows.forEach(function (row) {
        var a = row.tracks && row.tracks.A || []; var b = row.tracks && row.tracks.B || [];
        var positions = Math.min(Math.max(a.length, b.length), 18);
        outputLines.push({text: "배너 " + (row.label || row.event || "미상") + " (" + text(row.lang).toUpperCase() + ")", count: 0});
        for (var index = 0; index < positions; index += 1) {
          outputLines.push({text: (index + 1) + "회 A " + entryText(a[index]) + " | B " + entryText(b[index]), count: (a[index] ? 1 : 0) + (b[index] ? 1 : 0)});
          var position = a[index] && a[index].position || b[index] && b[index].position;
          var alternatives = row.alternatives && row.alternatives[String(position)];
          if (Array.isArray(alternatives) && alternatives.length) {
            alternatives.slice(0, 3).forEach(function (alternative) {
              var pull = alternative.pull || {};
              var kind = alternative.kind === "guaranteed" ? (alternative.variant === "rerolled" ? "조건부 RG" : "조건부 G") : alternative.kind === "reroll" ? "조건부 R" : "조건부 일반";
              var prerequisite = alternative.prerequisite;
              outputLines.push({text: kind + " " + text(position) + " " + (pull.name || "고양이") + "#" + text(pull.id) +
                (alternative.next != null ? "→" + alternative.next : "") + (prerequisite ? " (" + text(prerequisite.name) + " 이후)" : " (시작 상태)"), count: 0});
            });
          }
        }
        if (Math.max(a.length, b.length) > positions) {
          var restA = a.slice(positions).filter(Boolean).length;
          var restB = b.slice(positions).filter(Boolean).length;
          omittedEntries += restA + restB;
          outputLines.push({text: "이 배너의 나머지 위치 " + (Math.max(a.length, b.length) - positions) + "개 생략 (기본 결과 " + (restA + restB) + "개).", count: 0});
        }
      });
      var maxLength = 5600;
      var used = lines.join("\n").length;
      var includedLines = [];
      var omittedLines = 0;
      outputLines.forEach(function (line) {
        if (used + line.text.length + 1 <= maxLength) { includedLines.push(line.text); used += line.text.length + 1; }
        else { omittedLines += 1; omittedEntries += line.count; }
      });
      lines = lines.concat(includedLines);
      lines.push("데이터 요약 잘림: " + (omittedEntries > 0 || omittedLines > 0 ? "예" : "아니요") +
        ". 전체 기본 결과 " + totalEntries + "개; 생략된 기본 결과 " + omittedEntries + "개; 생략된 설명 행 " + omittedLines + "개.");
      lines.push("계산된 배열과 조건부 R/G만 설명하세요. 요약에서 생략된 값이나 목록에 없는 결과를 만들어내지 마세요.");
    } else if (mode === "find") {
      lines.push("상태: " + text(result.status) + (result.message ? " · " + text(result.message) : ""));
      if (result.status === "success") {
        lines.push("목표 " + text(result.targetAcquired) + "/" + text(result.targetTotal) + ", 다음 위치 " + text(result.destination) + ", 코스트 " + text(result.cost) + ".");
        (result.actions || []).slice(0, 24).forEach(function (action) {
          lines.push([action.type, action.resultLabel || action.start, action.eventLabel, action.catName || action.name, action.catId != null || action.id != null ? "ID " + (action.catId == null ? action.id : action.catId) : "", action.next != null ? "다음 " + action.next : ""].filter(Boolean).join(" · "));
        });
        if ((result.actions || []).length > 24) lines.push("나머지 행동 " + (result.actions.length - 24) + "개 생략.");
        lines.push("성공 결과만 근거로 경로를 설명하세요. 새 경로를 계산하거나 추정하지 마세요.");
      } else if (result.status === "partial") {
        lines.push("부분 경로이며 최적성은 확인되지 않았습니다. 이를 명시해 설명하고 최적 결과라고 주장하지 마세요.");
      } else {
        lines.push("계산된 경로가 없습니다. 원인을 추측해 경로를 제안하지 말고 이 상태와 메시지만 설명하세요.");
      }
    } else {
      if (Number(result.status) > 1 || Number(result.count) > 1) lines.push("상태 코드 " + text(result.status) + ", 후보 수 2개 이상. 탐색은 두 번째 후보에서 멈췄으므로 실제 개수는 더 클 수 있습니다. 시작/종료 시드를 확정값처럼 전달하지 마세요.");
      else if (Number(result.status) === 1 && Number(result.count) === 1) lines.push("후보 수 1개, 시작 시드 " + text(result.begin) + ", 관측 후 시드 " + text(result.end) + ".");
      else lines.push("후보 수가 없습니다. 결과 시드를 제시하지 마세요.");
      if (Number(result.status) > 1 || Number(result.count) > 1) lines.push("후보가 여러 개이므로 시드가 확정되지 않았습니다. 추가 관측을 통한 재검색이 필요하다고 설명하세요.");
      else if (Number(result.status) === 0) lines.push("일치 후보가 없습니다. 결과를 임의로 만들지 말고 입력 재확인이 필요하다고 설명하세요.");
      else lines.push("찾은 시드 후보를 그대로 설명하세요.");
    }
    var summary = lines.join("\n");
    return summary.length > 6500 ? summary.slice(0, 6350) + "\n요약 잘림: 예. 뒤쪽 내용이 생략됐습니다." : summary;
  }

  async function sendContext() {
    if (!state.connected || !state.lastResult) return;
    els.sendContext.disabled = true;
    try {
      var summary = compactContext(state.lastResult);
      await rpcRequest("ui/update-model-context", { content: [{ type: "text", text: summary }] }, 15000);
      await rpcRequest("ui/message", {
        role: "user",
        content: [{ type: "text", text: "현재 미니 앱의 계산 결과를 설명해 주세요. 결과에 없는 값을 만들지 말고, 표시된 상태와 한계를 그대로 밝혀 주세요." }]
      }, 15000);
      setStatus("요약 결과를 대화에 전달하고 설명을 요청했습니다.", "good");
    } catch (error) { setStatus(error.message || String(error), "error"); }
    finally { els.sendContext.disabled = false; }
  }

  function cancelCalculation(message) {
    var active = state.currentRun;
    if (!active) return;
    state.runGeneration += 1;
    state.currentRun = null;
    try { if (typeof active.cancel === "function") active.cancel(); } catch (_) {}
    state.working = false; showWorking(false);
    invalidateLastResult();
    setStatus(message || "계산을 중단했습니다. 이 작업의 결과는 폐기했습니다.");
  }

  els.mode.addEventListener("change", function () { setMode(els.mode.value); state.payload = null; });
  els.addRow.addEventListener("click", function () {
    if (state.rows.length >= 8) { setStatus("배너는 최대 8개까지 추가할 수 있습니다.", "error"); return; }
    state.rows.push({ lang: "kr", event: "", label: "", ubers: 0, forceGuaranteed: 0, query: "", results: [], nextOffset: null });
    renderRows();
  });
  els.searchCats.addEventListener("click", function () { searchCats(0); });
  els.catQuery.addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); searchCats(0); } });
  els.addTarget.addEventListener("click", function () {
    addTarget(els.manualCatId.value, "고양이 #" + els.manualCatId.value.trim()); els.manualCatId.value = "";
  });
  els.manualCatId.addEventListener("keydown", function (event) { if (event.key === "Enter") { event.preventDefault(); els.addTarget.click(); } });
  els.addRoll.addEventListener("click", function () {
    if (state.seekRollIds.length >= 10) { setStatus("시드 찾기는 최대 10회 관측까지 지원합니다.", "error"); return; }
    state.seekRollIds.push(null); renderSeekRolls();
  });
  els.calculate.addEventListener("click", runCalculation);
  els.cancel.addEventListener("click", cancelCalculation);
  els.sendContext.addEventListener("click", sendContext);
  $("catsroll-app").addEventListener("input", clearResultOnEdit);
  $("catsroll-app").addEventListener("change", clearResultOnEdit);
  $("catsroll-app").addEventListener("click", function (event) {
    if (!event.target || !event.target.closest) return;
    var control = event.target.closest("button");
    if (!control || control === els.calculate || control === els.cancel || control === els.sendContext || control.disabled) return;
    invalidateLastResult();
  });

  renderTargets(); renderRows(); renderSeekRolls(); initializeHost();
})();
