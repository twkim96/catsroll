(function (root) {
  "use strict";
  var doc = root.document;
  var claudeHost = doc.documentElement.getAttribute("data-catsroll-ui-host") === "claude";
  var $ = function (id) { return doc.getElementById(id); };
  var state = {connected: false, parentOrigin: null, initId: null, nextRpcId: 1,
    pending: Object.create(null), localRequestId: 0, bootstrap: null, mounted: false,
    request: null, generation: 0, seekRun: null, seekPayload: null, seekRolls: [],
    seekResult: null, dataVersion: null, uiData: null, applying: false, pendingPlanMode: false,
    seekPrepTimer: null};
  var els = {bridge: $("bridge-state"), contextActions: $("send-context")};
  var store = Object.create(null);
  var host = root.CatsrollMultiHost = {
    started: false, findEnabled: false, track: {seed: 0, last: 0, count: 300, rows: []},
    apply: calculateMulti,
    findSettings: {targets: []},
    storage: {getItem: function (key) { return store[key] || null; },
      setItem: function (key, value) { store[key] = String(value); }},
    loadPool: async function (row) {
      var args={section: "pool", lang: row.lang, event: row.event};
      if(row.previewFor)args.previewFor=row.previewFor;
      var pool = await uiData(args);
      if (!pool || !pool.exist) throw new Error("배너 풀이 없습니다.");
      return pool;
    },
    loadSeries: function (lang) { return uiData({section: "series", lang: lang}); },
    createFindWorker: function () {
      var source = JSON.parse($("catsroll-find-worker-source").textContent);
      var url = root.URL.createObjectURL(new root.Blob([source], {type: "application/javascript"}));
      try { var worker = new root.Worker(url); root.URL.revokeObjectURL(url); return worker; }
      catch (error) { root.URL.revokeObjectURL(url); throw error; }
    }
  };
  function text(value) { return value == null ? "" : String(value); }
  function setStatus(message, kind) { $("status").textContent = message || ""; $("status").className = "status-message" + (kind ? " is-" + kind : ""); }
  function setBridge(message) { els.bridge.textContent = message; }
  function observeHostSize() {
    var frame = null, previousWidth = 0, previousHeight = 0;
    function schedule() {
      if (frame != null) return;
      frame = root.requestAnimationFrame(function () {
        frame = null;
        if (!state.connected || !state.parentOrigin) return;
        // Measure content rather than the iframe viewport so shrinking works too.
        var width = doc.documentElement.clientWidth;
        var height = Math.ceil(doc.body.getBoundingClientRect().height);
        if (width === previousWidth && height === previousHeight) return;
        previousWidth = width; previousHeight = height;
        root.parent.postMessage({jsonrpc: "2.0", method: "ui/notifications/size-changed",
          params: {width: width, height: height}}, state.parentOrigin);
      });
    }
    if (root.ResizeObserver) {
      var observer = new root.ResizeObserver(schedule);
      observer.observe(doc.body);
    }
    root.addEventListener("resize", schedule);
    schedule();
  }
  function node(tag, value) { var item = doc.createElement(tag); if (value != null) item.textContent = value; return item; }
  function payloadFromResult(result) { return result && result._meta && result._meta["catsroll/data"]; }
  function resultError(result) { return result && result.isError ? (result.content || []).map(function (part) { return part.text || ""; }).join("\n") || "도구 요청 오류" : ""; }
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
      observeHostSize();
      bootstrap();
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
      cancelCalculation();
      setStatus("호스트에서 도구 실행을 취소했습니다.");
    }
  }

  function initializeHost() {
    if (root.parent === root) {
      state.connected = false;

      setBridge("로컬 미리보기", "ready");
      bootstrap();
      return;
    }
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


  async function uiData(args) {
    var result = await callTool("catsroll_multi_data", args);
    var error = resultError(result);
    if (error) throw new Error(error);
    var data = result && result._meta && result._meta["catsroll/multi"];
    if (!data) throw new Error("Multi 화면 데이터를 받지 못했습니다.");
    if (args.section === "bootstrap") state.dataVersion = result.structuredContent && result.structuredContent.dataVersion;
    return data;
  }
  function bootstrap() {
    if (state.bootstrap) return state.bootstrap;
    $("multi-container").hidden = true;
    setStatus("배너와 캐릭터 목록을 불러오는 중…");
    state.bootstrap = uiData({section: "bootstrap"}).then(function (data) {
      state.uiData = data;
      data.initial.seed = 0;
      if (state.request && state.request.rows) host.track = state.request;
      else host.track = {seed: 0, last: 0, count: 300, rows: [{lang: data.initial.lang, event: data.initial.event}]};
      var script = node("script"); script.type = "application/json"; script.id = "multi_track_data";
      script.textContent = JSON.stringify(data); $("multi-track-app").appendChild(script);
      // A compact shell around the same maintained Multi controls and rules.
      compactLayout();
      root.CatsrollMountMulti();
      state.mounted = true;
      inputs.setCatalog(data);
      $("multi-container").hidden = false;
      bindMulti();
      // The host can deliver its prepared result while bootstrap is still in flight.
      var preparedPayload = state.seekPayload;
      if (state.request) applyHostArguments(state.request);
      else { setMode(); setStatus("시드와 배너를 고른 뒤 계산하기를 누르세요."); }
      if (preparedPayload) applyPreparedPayload(preparedPayload);
      queueSeekPreparation();
      return data;
    }).catch(function (error) {
      state.bootstrap = null; setStatus(error.message, "error"); throw error;
    });
    // Bootstrap is also launched by host notifications, without an awaiting caller.
    state.bootstrap.catch(function () {});
    return state.bootstrap;
  }
  function detailsAround(element, title, opened) {
    var details = node("details"); details.className = "gpt-settings"; details.open = !!opened;
    details.appendChild(node("summary", title)); element.parentNode.insertBefore(details, element); details.appendChild(element);
    return details;
  }
  function compactLayout() {
    $("multi-track-app").classList.add("gpt-multi");
    doc.querySelector(".multi-hero").hidden=true;
    doc.querySelector(".multi-controls").hidden=true;
    doc.querySelector(".multi-list-panel").hidden=true;
    detailsAround($("multi_find_panel"),"Find 설정 · 목표 선택",false).id="gpt-find-settings";
    detailsAround($("multi_plan_panel"),"플랜",false).id="gpt-plan-settings";
    var findTools=node("div");findTools.className="gpt-find-tools";
    var findControls=doc.querySelector(".multi-find-controls");findControls.prepend(findTools);
    ["multi_find_schedule","multi_find_filter","multi_find_reset","multi_find_help"].forEach(function(id){findTools.appendChild($(id));});
    var planTools=node("div");planTools.className="gpt-plan-tools";
    var planControls=doc.querySelector(".multi-plan-controls");planControls.prepend(planTools);
    planTools.appendChild(doc.querySelector(".multi-plan-toggle-field"));
    ["multi_plan_auto_draw","multi_plan_load"].forEach(function(id,index){
      var button=$(id),oldWrapper=button.parentNode;button.classList.add("gpt-icon-action",index?"gpt-load-icon":"gpt-draw-icon");
      button.setAttribute("aria-label",index?"플랜 불러오기":"플랜 그리기");
      button.title=index?"플랜 불러오기":"Find 경로를 플랜에 그리기";
      planTools.appendChild(button);
      oldWrapper.remove();
    });
    var toggle=doc.querySelector(".multi-plan-toggle-field");
    toggle.querySelector(".multi-plan-label").classList.add("visually-hidden");
    $("multi_plan_mode").setAttribute("aria-label","플랜 모드");
    var planBody=node("div");planBody.className="gpt-plan-body";
    Array.prototype.slice.call(planControls.children).forEach(function(child){if(child!==planTools)planBody.appendChild(child);});
    planControls.appendChild(planBody);
    var planWarning=node("p","먼저 계산하기를 눌러 배열을 계산해 주세요.");
    planWarning.id="gpt-plan-warning";planWarning.className="gpt-plan-warning";planWarning.setAttribute("role","status");
    planBody.appendChild(planWarning);
    ["multi_plan_reset","multi_plan_save"].forEach(function(id,index){
      var button=$(id),title=index?"플랜 저장":"플랜 초기화";
      button.setAttribute("aria-label",title);button.title=title;
      button.classList.add("gpt-icon-action");
      var svg=doc.createElementNS("http://www.w3.org/2000/svg","svg");
      svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");
      var path=doc.createElementNS("http://www.w3.org/2000/svg","path");
      path.setAttribute("d",index?"M5 3h12l4 4v14H3V3h2zm2 0v6h10V3M7 21v-8h10v8":"M4 10a8 8 0 1 1 1 8M4 4v6h6");
      svg.appendChild(path);button.replaceChildren(svg);planTools.appendChild(button);
    });
  }
  function syncPlanVisual() {
    if(!state.mounted)return;
    var snapshot=root.MultiTrackApp.getFindSnapshot();
    var ready=!!(host.started&&snapshot&&snapshot.ready&&!root.MultiTrackApp.isDirty());
    var active=ready&&$("multi_plan_mode").checked;
    $("multi_plan_panel").classList.toggle("is-plan-off",!active);
    $("gpt-plan-warning").hidden=ready;
    inputs.lock(active);
    // The shared controller may reject and revert a requested switch-on.
    // Read its final checkbox value, after its change handler has run.
    $("multi_plan_status").hidden=!ready;
  }
  function applyHostArguments(args) {
    if (!args || typeof args !== "object") return;
    cancelCalculation();
    state.request = args;
    state.seekResult = null;
    state.seekPayload = null;
    state.seekRolls = Array.isArray(args.rolls) ? args.rolls.slice() : [];
    host.started = false;
    host.findEnabled = args.mode !== "seek" && (args.findEnabled == null ? args.mode === "find" || !!(args.targets && args.targets.length) : args.findEnabled);
    host.findSettings = args;
    host.track = args;
    state.pendingPlanMode = !!args.planMode;
    inputs.apply(args);
    inputs.lock(false);
    $("find-enabled").checked = host.findEnabled;
    $("mode").value = args.mode === "seek" ? "seek" : "multi";
    setMode();
    if (!state.mounted) return;
    state.applying = true;
    try {
      root.MultiTrackApp.applyHostState(args);
      root.MultiFindApp.applyHostSettings(args);
      root.MultiPlanApp.applyHostState({enabled: false, name: args.planName || ""});
    } finally { state.applying = false; }
    $("gpt-find-settings").open = host.findEnabled;
    $("gpt-plan-settings").open = !!args.planMode;
    renderSeek();
    syncPlanVisual();
    setStatus("설정을 불러왔습니다. 계산하기를 누르세요.");
    updateShare();
    queueSeekPreparation();
  }
  function applyPreparedPayload(payload, origin) {
    if (!payload || !payload.request) return;
    if (origin === "host") applyHostArguments(payload.request);
    state.dataVersion = payload.dataVersion;
    state.seekPayload = payload.seeker ? payload : null;
    if (state.mounted) {
      // Canonical names come from the shared Multi catalog, including ID545.
      renderSeek();
      if (payload.seeker) setStatus("관측 결과를 순서대로 선택하고 시드 계산을 누르세요.");
    }
  }
  function installPreparedPools(payload) {
    var data = root.MultiTrackApp.getInitialData();
    (payload.events || []).forEach(function (event) {
      var region = data.regions[event.lang];
      var item = region && region.events.find(function (candidate) { return candidate.event === event.event; });
      if (item) { item.pool = event.pool; item.error = null; item.loading = false; }
    });
    (payload.tickets || []).forEach(function (ticket) {
      var lang = ticket.lang || payload.request.rows[0].lang;
      if (data.regions[lang]) data.regions[lang].tickets[ticket.kind] = ticket;
    });
  }
  function setMode() {
    var seeking = $("mode").value === "seek";
    inputs.setMode(seeking ? "seek" : "multi");
    $("seek-panel").hidden = !seeking;
    $("seed-fields").hidden = seeking;
    $("multi-actions-panel").hidden = seeking;
    $("calculate").hidden = seeking;
    $(seeking ? "seek-actions" : "multi-actions").appendChild($("cancel"));
    if (seeking) $("seek-actions").after($("status"));
    else $("multi-actions-panel").appendChild($("status"));
    $("row-help").textContent = seeking ? "실제로 뽑은 배너를 선택하세요." : "계산에 사용할 배너와 풀 설정을 선택하세요.";
    var resultStart = $(seeking ? "seek-result" : "multi_tables");
    resultStart.before(doc.querySelector(".gpt-share"));
    $("find-toggle-label").hidden = seeking;
    var app = $("multi-track-app"); app.classList.toggle("is-seeking", seeking);
    if ($("gpt-find-settings")) $("gpt-find-settings").hidden = seeking || !host.findEnabled;
    ["multi_found", "gpt-plan-settings", "multi_find_result", "multi_plan_route", "multi_tables"].forEach(function (id) {
      var el = $(id); if (!el) return;
      if (seeking && el.dataset.seekHidden == null) el.dataset.seekHidden = el.hidden ? "true" : "false";
      if (seeking) el.hidden = true;
      else if (el.dataset.seekHidden != null) { el.hidden = el.dataset.seekHidden === "true"; delete el.dataset.seekHidden; }
    });
    host.findEnabled = !seeking && $("find-enabled").checked;
  }
  function bindMulti() {
    var app = $("multi-track-app");
    app.addEventListener("multi-track:updated", function () {
      updateShare();
      var snapshot=root.MultiTrackApp.getFindSnapshot();
      if(snapshot&&snapshot.ready&&!root.MultiTrackApp.isDirty()) inputs.apply(root.MultiTrackApp.getShareState());
      syncPlanVisual();
      if(snapshot&&snapshot.ready&&!host.findEnabled)$("cancel").hidden=true;
    });
    $("multi_plan_mode").addEventListener("change",function(){state.pendingPlanMode=false;syncPlanVisual();root.setTimeout(syncPlanVisual,0);});
    app.addEventListener("multi-track:dirty",function(){syncPlanVisual();updateShare();});
    app.addEventListener("multi-find:result", updateShare);
    app.addEventListener("multi-find:running", function (event) {
      $("cancel").hidden = !event.detail;
      updateShare();
    });
    app.addEventListener("change", function (event) {
      if ($("mode").value === "seek" && event.target.closest("#multi_rows")) {
        cancelCalculation(); state.seekPayload = null; state.seekResult = null;
        $("seek-result").replaceChildren(); renderSeek();
      }
      root.setTimeout(updateShare, 0);
    });
    app.addEventListener("input", updateShare);
    $("find-enabled").addEventListener("change", function () {
      host.findEnabled = this.checked; $("gpt-find-settings").hidden = !this.checked;
      $("gpt-find-settings").open = this.checked;
      root.MultiFindApp.cancel();
      root.MultiTrackApp.markFindDirty();
    });
    $("mode").addEventListener("change", function () { cancelCalculation();state.seekResult=null;$("seek-result").replaceChildren();setMode();renderSeek();queueSeekPreparation();updateShare(); });
    app.addEventListener("click", function () { root.setTimeout(updateShare, 0); });
  }
  function rowsFromTrack() { return inputs.read().rows; }
  async function calculateMulti() {
    if (!state.mounted) { setStatus("목록을 불러오는 중입니다."); return; }
    if ($("mode").value === "seek") { await calculateSeek(); return; }
    var entered=inputs.read();
    if (!Number.isInteger(entered.seed)||entered.seed<1||entered.seed>4294967295) {setStatus("시드를 확인하세요.","error");return;}
    if (!Number.isInteger(entered.count)||entered.count<1||entered.count>999) {setStatus("횟수는 1~999로 입력하세요.","error");return;}
    if (entered.rows.some(function(row){return !row.event;})) {setStatus("배너를 선택하세요.","error");return;}
    var settings=root.MultiFindApp.getShareSettings();
    if(host.findEnabled&&!settings.targets.length){setStatus("Find 목표 캐릭터를 선택하세요.","error");return;}
    var plan=root.MultiPlanApp.getState();
    if(state.pendingPlanMode)plan.enabled=true;
    var args=Object.assign({},entered,settings,{mode:"multi",findEnabled:host.findEnabled,planMode:plan.enabled,planName:plan.name});
    args.targets=args.targets.map(function(target){var cat=(state.uiData.find_cats||[]).find(function(c){return c.id===target.cat_id;});return Object.assign({},target,cat?{cat_name:cat.name}:{});});
    cancelCalculation();
    var generation=++state.generation;
    $("calculate").disabled=true;$("cancel").hidden=false;
    setStatus("계산 데이터를 준비하고 있습니다…");
    try {
      var reply=await callTool("catsroll_prepare",args);
      if(generation!==state.generation)return;
      var error=resultError(reply);if(error)throw new Error(error);
      var payload=payloadFromResult(reply);if(!payload)throw new Error("계산 데이터를 받지 못했습니다.");
      // Only the user Calculate click reaches this branch. Incoming tool results stay pending.
      state.dataVersion=payload.dataVersion;
      root.MultiTrackApp.applyHostState(payload.request);
      installPreparedPools(payload);
      root.MultiFindApp.applyHostSettings(payload.request);
      root.MultiPlanApp.applyHostState({enabled:plan.enabled,name:plan.name});
      state.pendingPlanMode=false;
      root.MultiTrackApp.apply();
      setStatus("배열을 계산했습니다. Find를 켰다면 경로 탐색도 진행합니다.");
    } catch(error) {if(generation===state.generation)setStatus(error.message,"error");}
    finally {if(generation===state.generation){$("calculate").disabled=false;updateShare();}}
  }
  function queueSeekPreparation() {
    root.clearTimeout(state.seekPrepTimer);
    state.seekPrepTimer = root.setTimeout(function () {
      if (state.mounted && $("mode").value === "seek" && !state.seekPayload) prepareSeek();
    }, 0);
  }
  async function prepareSeek() {
    if (!state.mounted || $("mode").value !== "seek") return;
    var generation = ++state.generation;
    var rows = rowsFromTrack();
    if (rows.length !== 1) { setStatus("시드 찾기는 배너 하나를 선택하세요.", "error"); return; }
    if (!rows[0].event) { renderSeek(); setStatus("실제로 뽑은 배너를 선택하세요."); return; }
    setStatus("관측 캐릭터 목록을 불러오는 중…");
    $("calculate-seek").disabled = true;
    try {
      var response = await callTool("catsroll_prepare", {mode: "seek", rows: rows, rolls: []});
      var error = resultError(response); if (error) throw new Error(error);
      if (generation !== state.generation) return;
      state.seekPayload = payloadFromResult(response);
      var choices = state.seekPayload && state.seekPayload.seeker && state.seekPayload.seeker.choices || [];
      state.seekRolls = state.seekRolls.map(function (id) { return choices.some(function (cat) { return cat.id === id; }) ? id : 0; });
      renderSeek();
      setStatus("실제로 뽑은 결과를 순서대로 선택하세요.");
    } catch (error) { if (generation === state.generation) setStatus(error.message, "error"); }
  }
  function renderSeek() {
    var container = $("seek-rolls"); container.replaceChildren();
    var choices = state.seekPayload && state.seekPayload.seeker && state.seekPayload.seeker.choices || [];
    $("add-roll").disabled = !choices.length || state.seekRolls.length >= 10;
    $("calculate-seek").disabled = !choices.length;
    if (!choices.length) { container.appendChild(node("p", "배너를 선택하면 관측 캐릭터 목록을 불러옵니다.")); return; }
    if (!state.seekRolls.length) state.seekRolls = [0];
    state.seekRolls.forEach(function (id, index) {
      var row = node("div"); row.className = "seek-roll";
      var label = node("label"); label.className = "seek-choice";
      var ordinal = node("span", (index + 1) + "번째"); ordinal.className = "seek-index"; label.appendChild(ordinal);
      var select = node("select"); var placeholder = node("option", "고양이 선택"); placeholder.value = ""; select.appendChild(placeholder);
      choices.forEach(function (cat) { var option = node("option", cat.name + " · #" + cat.id); option.value = cat.id; select.appendChild(option); });
      select.value = id || "";
      select.addEventListener("change", function () { cancelCalculation(); state.seekRolls[index] = Number(this.value); state.seekResult = null; $("seek-result").replaceChildren(); updateShare(); });
      label.appendChild(select);
      row.appendChild(label);
      var remove = node("button", "×"); remove.type = "button"; remove.className = "button button-icon button-secondary seek-remove";
      remove.setAttribute("aria-label", (index + 1) + "번째 삭제"); remove.title = (index + 1) + "번째 삭제";
      remove.onclick = function () { cancelCalculation(); state.seekRolls.splice(index, 1); state.seekResult = null; $("seek-result").replaceChildren(); renderSeek(); updateShare(); };
      row.appendChild(remove); container.appendChild(row);
    });
  }
  async function calculateSeek() {
    if (!state.seekPayload || !state.seekPayload.seeker) { await prepareSeek(); return; }
    if (!state.seekRolls.length || state.seekRolls.some(function (id) { return !(id > 0); })) { setStatus("관측한 고양이를 모두 선택하세요.", "error"); return; }
    cancelCalculation(); var generation = ++state.generation;
    $("cancel").hidden = false; $("calculate-seek").disabled = true;
    state.seekResult = null; $("seek-result").replaceChildren();
    try {
      var response = await callTool("catsroll_prepare", {mode: "seek", rows: rowsFromTrack(), rolls: state.seekRolls});
      if (generation !== state.generation) return;
      var error = resultError(response); if (error) throw new Error(error);
      var payload = payloadFromResult(response);
      state.seekRun = root.CatsrollGptRuntime.start("seek", payload, {source: JSON.parse($("catsroll-worker-source").textContent)});
      setStatus("시드를 찾고 있습니다…");
      var result = await state.seekRun.promise;
      if (generation !== state.generation) return;
      state.seekResult = result; state.seekPayload = payload;
      var output = $("seek-result");
      if (Number(result.status) === 1 && Number(result.count) === 1) {
        output.appendChild(node("p", "시작 시드: " + result.begin));
        output.appendChild(node("p", "관측 후 시드: " + result.end));
      } else output.appendChild(node("p", Number(result.count) > 1 ? "후보가 여러 개입니다. 관측을 추가해 주세요." : "일치하는 시드가 없습니다. 입력을 확인해 주세요."));
      setStatus("기기 계산이 끝났습니다.");
    } catch (error) { if (generation === state.generation) setStatus(error.message, "error"); }
    finally { if (generation === state.generation) { state.seekRun = null; $("cancel").hidden = true; $("calculate-seek").disabled = false; updateShare(); } }
  }
  function cancelCalculation(message) {
    state.generation += 1;
    if (state.seekRun) state.seekRun.cancel();
    state.seekRun = null;
    if (root.MultiFindApp && root.MultiFindApp.cancel) root.MultiFindApp.cancel();
    $("cancel").hidden = true; $("calculate").disabled=false; $("calculate-seek").disabled = false;
    if (message) setStatus(message);
  }
  function updateShare() {
    var seeking = $("mode").value === "seek";
    var ready = seeking ? !!state.seekResult : state.mounted && host.started &&
      !root.MultiTrackApp.isDirty() && root.MultiTrackApp.getFindSnapshot() && root.MultiTrackApp.getFindSnapshot().ready;
    $("send-context").disabled = !state.connected || !ready;
    if(state.mounted && !seeking && $("cancel").hidden) {
      $("calculate").disabled=!!(ready&&root.MultiPlanApp.getState().enabled);
    }
  }
  function summary() {
    if ($("mode").value !== "seek") {
      return root.CatsrollGptResultSummary.build({
        track: root.MultiTrackApp.getShareState(),
        find: root.MultiFindApp.getResult(),
        findEnabled: host.findEnabled,
        findSettings: root.MultiFindApp.getShareSettings(),
        plan: root.MultiPlanApp.getState(),
        outputs: root.MultiTrackApp.getOutputs() || [],
        dataVersion: state.dataVersion || state.uiData && state.uiData.dataVersion
      });
    }
    var result = state.seekResult;
    var lines = ["Catsroll 기기 계산 결과", "사용자가 계산 후 공유한 스냅샷입니다. 이전 catsroll_prepare의 prepared는 계산 전 상태이며 아래는 그 이후의 결과입니다.", "데이터 버전: " + text(state.dataVersion || state.seekPayload && state.seekPayload.dataVersion || "현재 Multi 데이터")];
    lines.push("시드 찾기 입력: " + JSON.stringify({rows: rowsFromTrack(), rolls: state.seekRolls}));
    if (Number(result.count) === 1 && Number(result.status) === 1) lines.push("시작 시드 " + result.begin + ", 관측 후 시드 " + result.end);
    else lines.push(Number(result.count) > 1 ? "모호한 후보 2개 이상. 확정 시드가 아닙니다." : "일치하는 시드 없음.");
    lines.push("표시한 계산 결과만 설명하고, 모호한 시드를 확정하지 마세요.");
    return lines.join("\n");
  }
  async function sendContext() {
    if (!state.connected || $("send-context").disabled) return;
    $("send-context").disabled = true;
    try {
      var snapshot = summary();
      var shareMessage = "현재 Catsroll 앱의 계산 결과와 플랜을 설명해 주세요. 표시된 상태와 생략 범위를 그대로 밝혀 주세요.";
      if (claudeHost) {
        // Claude may acknowledge hidden context without including it in the next turn.
        try { await rpcRequest("ui/update-model-context", {content: [{type: "text", text: snapshot}]}, 15000); }
        catch (_) { /* The visible message still carries the same computed data. */ }
        shareMessage = "아래는 Catsroll 앱에서 계산 후 공유한 결과입니다. 이 결과와 플랜을 설명해 주세요. 표시된 상태와 생략 범위를 그대로 밝혀 주세요.\n\n" + snapshot;
      } else {
        await rpcRequest("ui/update-model-context", {content: [{type: "text", text: snapshot}]}, 15000);
      }
      var delivered = await rpcRequest("ui/message", {role: "user", content: [{type: "text", text:
        shareMessage}]}, 15000);
      if (delivered && delivered.isError) throw new Error("계산 결과 메시지를 전달하지 못했습니다. 다시 시도해 주세요.");
      setStatus("계산 요약을 GPT에 전달했습니다.");
    } catch (error) { setStatus(error.message, "error"); }
    finally { updateShare(); }
  }
  var inputs = root.CatsrollGptInputs({onError:function(message){setStatus(message,"error");},onChange:function(){
    cancelCalculation();state.seekResult=null;state.seekPayload=null;state.seekRolls=[];$("seek-result").replaceChildren();
    renderSeek();queueSeekPreparation();
    if(state.mounted)root.MultiTrackApp.markFindDirty();updateShare();
  }});
  $("calculate").onclick=calculateMulti;
  $("add-roll").onclick = function () { if (state.seekRolls.length >= 10) return; cancelCalculation(); state.seekRolls.push(0); state.seekResult = null; $("seek-result").replaceChildren(); renderSeek(); updateShare(); };
  $("calculate-seek").onclick = calculateSeek;
  $("cancel").onclick = function () { cancelCalculation("계산을 중단했습니다."); updateShare(); };
  $("send-context").onclick = sendContext;
  initializeHost();
})(typeof globalThis !== "undefined" ? globalThis : this);
