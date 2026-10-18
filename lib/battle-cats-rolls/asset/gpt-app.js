(function (root) {
  "use strict";
  var doc = root.document;
  var $ = function (id) { return doc.getElementById(id); };
  var diagnostic = root.CatsrollRecordDiagnostic;
  diagnostic("app-start");
  var state = {bootstrap: null, mounted: false, mountStarted: false, uiReady: false,
    request: null, seekPayload: null, seekRolls: [],
    seekResult: null, seekSnapshot: null, dataVersion: null, uiData: null, applying: false, pendingPlanMode: false,
    seekPrepTimer: null, hostPreparation: null, preparationIssue: null, recoveryJob: null, closed: false};
  var application = root.CatsrollApplicationState();
  var run = application.calculation;
  var planSignature = null;
  function currentPlanRevision() {
    if (state.mounted && root.MultiPlanApp) {
      var signature = JSON.stringify(root.MultiPlanApp.getState());
      if (planSignature !== null && signature !== planSignature) application.planChanged();
      planSignature = signature;
    }
    return application.planRevision();
  }
  var els = {bridge: $("bridge-state"), contextActions: $("send-context")};
  var bridge = root.CatsrollHostBridge({
    onConnection: setBridge, onError: setStatus,
    onDiagnostic: diagnostic,
    onHostContext: applyHostContext,
    onTeardown: function () {
      state.closed = true; state.hostPreparation = null;
      root.clearTimeout(state.seekPrepTimer); cancelCalculation();
      $("calculate").disabled = true; $("calculate-seek").disabled = true;
      $("send-context").disabled = true;
      $("retry-connection").hidden = true; $("retry-bootstrap").hidden = true;
    },
    onReady: function () { els.contextActions.hidden = false; updateShare(); bootstrap(); },
    onNotification: function (message) {
      if (message.method === "ui/notifications/tool-input") {
        var args = message.params && message.params.arguments;
        if (!args || typeof args !== "object") return;
        applyHostArguments(args);
        state.hostPreparation = {arguments: JSON.parse(JSON.stringify(args)),
          inputRevision: application.inputRevision(), planRevision: currentPlanRevision()};
      }
      else if (message.method === "ui/notifications/tool-result") {
        receiveHostPreparation(message.params);
      } else if (message.method === "ui/notifications/tool-cancelled") {
        state.hostPreparation = null;
        cancelCalculation(); setStatus("호스트에서 도구 실행을 취소했습니다.");
      }
    }
  });
  var sharing = root.CatsrollShare({bridge: bridge,
    profile: doc.documentElement.getAttribute("data-catsroll-ui-host") === "claude" ? "claude" : "chatgpt",
    capture: captureForShare,
    project: function (snapshot, limit) { return root.CatsrollGptResultSummary.buildCaptured(snapshot, limit); },
    inputRevision: application.inputRevision, planRevision: currentPlanRevision,
    resultError: resultError, onStatus: setStatus, onRecovery: showRecovery, onChange: updateShare});
  var store = Object.create(null);
  var host = root.CatsrollMultiHost = {
    started: false, findEnabled: false, track: {seed: 0, last: 0, count: 100, rows: []},
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
  function setBridge(message, kind) {
    els.bridge.textContent = message;
    $("retry-connection").hidden = kind !== "error" || state.closed;
  }
  function applyHostContext(context) {
    context = context || {};
    var mode = context.displayMode === "fullscreen" ? "fullscreen" : "inline";
    doc.documentElement.dataset.displayMode = mode;
    var insets = context.safeAreaInsets || {};
    ["top", "right", "bottom", "left"].forEach(function (side) {
      var value = insets[side];
      doc.documentElement.style.setProperty("--host-safe-" + side,
        (typeof value === "number" && isFinite(value) ? Math.max(0, value) : 0) + "px");
    });
    var dims = context.containerDimensions || {};
    ["width", "height"].forEach(function (axis) {
      var value = dims[axis] == null ? dims[axis === "width" ? "maxWidth" : "maxHeight"] : dims[axis];
      if (typeof value === "number" && isFinite(value) && value > 0) {
        doc.documentElement.style.setProperty("--host-" + axis, value + "px");
      } else doc.documentElement.style.removeProperty("--host-" + axis);
    });
  }
  function snapshotIsStale(job) {
    return sharing.isStale(job);
  }
  function refreshRecoveryProvenance() {
    var job = state.recoveryJob;
    if (!job || $("share-recovery").hidden) return;
    $("share-recovery-provenance").textContent = job.inputRevision !== application.inputRevision() ?
      "이 스냅샷을 만든 뒤 입력이 바뀌었습니다. 아래 파일과 내용은 계산 당시 결과를 보존합니다." :
      job.planRevision !== currentPlanRevision() ?
      "이 스냅샷을 만든 뒤 플랜이 바뀌었습니다. 아래 파일과 내용은 공유 당시 플랜을 보존합니다." :
      "아래 내용은 계산 당시 결과를 그대로 보존한 스냅샷입니다.";
  }
  function markInputsChanged() {
    var active = run.phase() === "preparing" || run.phase() === "running";
    application.inputsChanged();
    state.preparationIssue = null;
    if (active) resetCalculationControls();
    refreshRecoveryProvenance();
  }
  function node(tag, value) { var item = doc.createElement(tag); if (value != null) item.textContent = value; return item; }
  function payloadFromResult(result) { return result && result._meta && result._meta["catsroll/data"]; }
  function resultError(result) { return result && result.isError ? (result.content || []).map(function (part) { return part.text || ""; }).join("\n") || "도구 요청 오류" : ""; }
  function interpretPreparation(reply) {
    var error = resultError(reply);
    if (error) return {kind: "error", message: error};
    var content = reply && reply.structuredContent || {};
    var payload = payloadFromResult(reply);
    if (content.status === "needs_input") return {kind: "needs_input", content: content, payload: payload};
    if ((content.status === "prepared" || content.status == null) && payload && payload.request) {
      return {kind: "prepared", payload: payload};
    }
    return {kind: "error", message: "준비 응답의 상태나 입력을 확인할 수 없습니다. 다시 준비해 주세요."};
  }
  function requirePreparation(reply) {
    var interpreted = interpretPreparation(reply);
    if (interpreted.kind !== "prepared") {
      showPreparationIssue(interpreted);
      return null;
    }
    state.preparationIssue = null;
    return interpreted.payload;
  }
  function showPreparationIssue(result) {
    cancelCalculation(); state.seekResult = null; state.seekSnapshot = null; state.seekPayload = null;
    host.started = false;
    if (state.mounted) {
      root.MultiTrackApp.applyHostState(host.track);
      root.MultiFindApp.cancel();
    }
    var content = result.content || {}, selection = content.targetSelection || result.payload && result.payload.targetSelection || {};
    var message = result.message;
    if (result.kind === "needs_input") {
      message = content.reason === "no_remaining_targets" ?
        "보유 캐릭터를 제외하면 남은 목표가 없습니다. 보유 제외 목록이나 목표를 변경해 주세요." :
        content.reason === "target_limit_exceeded" ?
        "선택한 목표 " + (selection.included_count == null ? content.matched_count : selection.included_count) +
          "종이 한도 " + (content.maximum || 30) + "종을 넘었습니다. 목표나 보유 제외 목록을 조정해 주세요." :
        "추가 입력이 필요합니다. 목표와 보유 제외 목록을 확인해 주세요.";
    }
    state.preparationIssue = result;
    setStatus(message, "error"); updateShare();
    $("calculate").disabled = true; $("calculate-seek").disabled = true;
  }
  function requestMatches(arguments_, payload) {
    // Notifications have no call ID in the standard protocol. Match the latest
    // input's explicit fields against the canonical request and selector echo.
    function matches(expected, actual, key) {
      if (key === "cat_name") return true;
      if (key === "mode") return expected === actual || expected === "find" && actual === "multi";
      // Owned IDs are a set; Ruby removes duplicates while preserving order.
      // Other arrays (banner rows, observations, ordered targets) remain ordered.
      if (key === "excludeOwnedIds" && Array.isArray(expected) && Array.isArray(actual)) {
        var ids = Array.from(new Set(expected));
        return ids.length === new Set(actual).size && ids.every(function (id) { return actual.indexOf(id) >= 0; });
      }
      if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length &&
        expected.every(function (item, index) { return matches(item, actual[index]); });
      if (expected && typeof expected === "object") return !!actual && Object.keys(expected).every(function (field) {
        return matches(expected[field], actual[field], field);
      });
      return expected === actual;
    }
    return !!payload && Object.keys(arguments_).every(function (key) {
      if (key === "targetSelection") return matches(arguments_[key], payload.targetSelection);
      return matches(arguments_[key], payload.request && payload.request[key], key);
    });
  }
  function receiveHostPreparation(reply) {
    var operation = state.hostPreparation;
    if (!operation || operation.inputRevision !== application.inputRevision() ||
        operation.planRevision !== currentPlanRevision()) {
      setStatus("이전 준비 결과가 도착했습니다. 현재 입력을 유지했습니다. 필요하면 다시 준비해 주세요."); return;
    }
    var interpreted = interpretPreparation(reply);
    if (interpreted.kind === "error") {
      // Standard error notifications have no call identity or echoed arguments.
      // Keep a newer pending preparation alive rather than attributing this to it.
      setStatus(interpreted.message, "error"); return;
    }
    if (interpreted.kind === "needs_input" && (!operation.arguments.targetSelection ||
        !requestMatches({targetSelection: operation.arguments.targetSelection}, interpreted.payload))) {
      setStatus("현재 요청과 다른 준비 결과가 도착했습니다. 현재 입력을 유지했습니다."); return;
    }
    if (interpreted.kind === "prepared" && !requestMatches(operation.arguments, interpreted.payload)) {
      setStatus("현재 요청과 다른 준비 결과가 도착했습니다. 현재 입력을 유지했습니다."); return;
    }
    state.hostPreparation = null;
    if (interpreted.kind !== "prepared") { showPreparationIssue(interpreted); return; }
    applyPreparedPayload(interpreted.payload, "host");
  }


  async function uiData(args) {
    var result = await bridge.callTool("catsroll_multi_data", args);
    var error = resultError(result);
    if (error) throw new Error(error);
    var data = result && result._meta && result._meta["catsroll/multi"];
    if (!data) throw new Error("Multi 화면 데이터를 받지 못했습니다.");
    if (args.section === "bootstrap") state.dataVersion = result.structuredContent && result.structuredContent.dataVersion;
    return data;
  }
  function bootstrap() {
    if (state.bootstrap) return state.bootstrap;
    // A transport/data retry must never repeat DOM moves or event registration.
    if (state.closed || state.mountStarted) return Promise.resolve();
    $("retry-bootstrap").hidden = true;
    $("calculate").disabled = true; $("calculate-seek").disabled = true;
    $("multi-container").hidden = true;
    setStatus("배너와 캐릭터 목록을 불러오는 중…");
    diagnostic("bootstrap-start");
    state.bootstrap = uiData({section: "bootstrap"}).then(function (data) {
      if (state.closed) return;
      diagnostic("bootstrap-ready");
      state.uiData = data;
      data.initial.seed = 0;
      if (state.request && state.request.rows) host.track = state.request;
      else host.track = {seed: 0, last: 0, count: 100, rows: [{lang: data.initial.lang, event: data.initial.event}]};
      var script = node("script"); script.type = "application/json"; script.id = "multi_track_data";
      script.textContent = JSON.stringify(data); $("multi-track-app").appendChild(script);
      // A compact shell around the same maintained Multi controls and rules.
      state.mountStarted = true;
      diagnostic("ui-mount-start");
      compactLayout();
      root.CatsrollMountMulti();
      state.mounted = true;
      inputs.setCatalog(data);
      $("multi-container").hidden = false;
      bindMulti();
      // The host can deliver its prepared result while bootstrap is still in flight.
      var preparedPayload = state.seekPayload;
      var preparationIssue = state.preparationIssue;
      var pendingHost = state.hostPreparation;
      var unchanged = pendingHost && pendingHost.inputRevision === application.inputRevision() && pendingHost.planRevision === currentPlanRevision();
      if (state.request) applyHostArguments(state.request);
      else { setMode(); setStatus("시드와 배너를 고른 뒤 계산하기를 누르세요."); }
      if (unchanged) {
        pendingHost.inputRevision = application.inputRevision();
        pendingHost.planRevision = currentPlanRevision(); state.hostPreparation = pendingHost;
      }
      if (preparedPayload) applyPreparedPayload(preparedPayload);
      if (preparationIssue) showPreparationIssue(preparationIssue);
      state.uiReady = true;
      diagnostic("ui-mounted");
      updateShare();
      queueSeekPreparation();
      if (root.parent === root) restoreHashRequest();
      return data;
    }).catch(function (error) {
      if (state.closed) return;
      diagnostic(state.mountStarted ? "ui-mount-failed" : "bootstrap-failed");
      state.bootstrap = null;
      $("retry-bootstrap").hidden = state.mountStarted;
      setStatus(state.mountStarted ? "화면 초기화에 실패했습니다. 앱을 다시 열어 주세요." : error.message, "error");
      throw error;
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
  function applyHostArguments(args, skipSeekPreparation) {
    if (!args || typeof args !== "object") return;
    markInputsChanged();
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
    if (!skipSeekPreparation) queueSeekPreparation();
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
    app.addEventListener("multi-find:result", function () {
      var result = root.MultiFindApp.getResult();
      if (result) run.move(run.current(), result.status === "partial" ? "partial" :
        result.status === "success" ? "completed" : "failed");
      updateShare();
    });
    app.addEventListener("multi-find:running", function (event) {
      $("cancel").hidden = !event.detail;
      updateShare();
    });
    app.addEventListener("multi-find:settings-changed", function () {
      markInputsChanged();
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
    state.hostPreparation = null;
    if (state.closed || state.preparationIssue) return;
    if (!state.mounted) { setStatus("목록을 불러오는 중입니다."); return; }
    if ($("mode").value === "seek") { await calculateSeek(); return; }
    var entered=inputs.read();
    if (!Number.isInteger(entered.seed)||entered.seed<1||entered.seed>4294967295) {setStatus("시드를 확인하세요.","error");return;}
    if (!Number.isInteger(entered.count)||entered.count<1||entered.count>300) {setStatus("횟수는 1~300으로 입력하세요.","error");return;}
    if (entered.rows.some(function(row){return !row.event;})) {setStatus("배너를 선택하세요.","error");return;}
    var settings=root.MultiFindApp.getShareSettings();
    if(host.findEnabled&&!settings.targets.length){setStatus("Find 목표 캐릭터를 선택하세요.","error");return;}
    var plan=root.MultiPlanApp.getState();
    if(state.pendingPlanMode)plan.enabled=true;
    var args=Object.assign({},entered,settings,{mode:"multi",findEnabled:host.findEnabled,planMode:plan.enabled,planName:plan.name});
    args.targets=args.targets.map(function(target){var cat=(state.uiData.find_cats||[]).find(function(c){return c.id===target.cat_id;});return Object.assign({},target,cat?{cat_name:cat.name}:{});});
    cancelCalculation();
    var generation=run.begin();
    $("calculate").disabled=true;$("cancel").hidden=false;
    setStatus("계산 데이터를 준비하고 있습니다…");
    try {
      var reply=await bridge.callTool("catsroll_prepare",args);
      if(!run.isCurrent(generation))return;
      var payload=requirePreparation(reply);if(!payload)return;
      // Only the user Calculate click reaches this branch. Incoming tool results stay pending.
      state.dataVersion=payload.dataVersion;
      root.MultiTrackApp.applyHostState(payload.request);
      installPreparedPools(payload);
      root.MultiFindApp.applyHostSettings(payload.request);
      root.MultiPlanApp.applyHostState({enabled:plan.enabled,name:plan.name});
      state.pendingPlanMode=false;
      run.move(generation, "running");
      root.MultiTrackApp.apply();
      if (!host.findEnabled) run.move(generation, "completed");
      setStatus("배열을 계산했습니다. Find를 켰다면 경로 탐색도 진행합니다.");
    } catch(error) {if(run.isCurrent(generation)){run.move(generation,"failed");setStatus(error.message,"error");}}
    finally {if(run.isCurrent(generation)){$("calculate").disabled=false;updateShare();}}
  }
  function queueSeekPreparation() {
    root.clearTimeout(state.seekPrepTimer);
    state.seekPrepTimer = root.setTimeout(function () {
      if (!state.closed && !state.preparationIssue && state.mounted && $("mode").value === "seek" && !state.seekPayload) prepareSeek();
    }, 0);
  }
  async function prepareSeek() {
    if (!state.mounted || $("mode").value !== "seek") return;
    var generation = run.begin();
    var rows = rowsFromTrack();
    if (rows.length !== 1) { setStatus("시드 찾기는 배너 하나를 선택하세요.", "error"); return; }
    if (!rows[0].event) { renderSeek(); setStatus("실제로 뽑은 배너를 선택하세요."); return; }
    setStatus("관측 캐릭터 목록을 불러오는 중…");
    $("calculate-seek").disabled = true;
    try {
      var response = await bridge.callTool("catsroll_prepare", {mode: "seek", rows: rows, rolls: []});
      if (!run.isCurrent(generation)) return;
      var payload = requirePreparation(response); if (!payload) return;
      state.seekPayload = payload;
      var choices = state.seekPayload && state.seekPayload.seeker && state.seekPayload.seeker.choices || [];
      state.seekRolls = state.seekRolls.map(function (id) { return choices.some(function (cat) { return cat.id === id; }) ? id : 0; });
      run.move(generation, "prepared");
      renderSeek();
      setStatus("실제로 뽑은 결과를 순서대로 선택하세요.");
    } catch (error) { if (run.isCurrent(generation)) {
      run.move(generation, "failed"); setStatus(error.message, "error"); $("calculate-seek").disabled = false;
    } }
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
    state.hostPreparation = null;
    if (state.closed || state.preparationIssue) return;
    if (!state.seekPayload || !state.seekPayload.seeker) { await prepareSeek(); return; }
    if (!state.seekRolls.length || state.seekRolls.some(function (id) { return !(id > 0); })) { setStatus("관측한 고양이를 모두 선택하세요.", "error"); return; }
    cancelCalculation(); var generation = run.begin();
    $("cancel").hidden = false; $("calculate-seek").disabled = true;
    state.seekResult = null; $("seek-result").replaceChildren();
    try {
      var response = await bridge.callTool("catsroll_prepare", {mode: "seek", rows: rowsFromTrack(), rolls: state.seekRolls});
      if (!run.isCurrent(generation)) return;
      var payload = requirePreparation(response); if (!payload) return;
      var seekRun = root.CatsrollGptRuntime.start("seek", payload, {source: JSON.parse($("catsroll-worker-source").textContent)});
      diagnostic("seek-worker-start");
      setStatus("시드를 찾고 있습니다…");
      run.attach(generation, seekRun);
      var result = await seekRun.promise;
      if (!run.isCurrent(generation)) return;
      diagnostic("seek-worker-completed");
      run.move(generation, "completed");
      state.seekResult = result; state.seekPayload = payload;
      state.seekSnapshot = root.CatsrollSnapshot.captureSeek({request: payload.request,
        result: result, dataVersion: payload.dataVersion});
      var output = $("seek-result");
      if (Number(result.status) === 1 && Number(result.count) === 1) {
        output.appendChild(node("p", "시작 시드: " + result.begin));
        output.appendChild(node("p", "관측 후 시드: " + result.end));
      } else output.appendChild(node("p", Number(result.count) > 1 ? "후보가 여러 개입니다. 관측을 추가해 주세요." : "일치하는 시드가 없습니다. 입력을 확인해 주세요."));
      setStatus("기기 계산이 끝났습니다.");
    } catch (error) { if (run.isCurrent(generation)) { run.move(generation, "failed"); setStatus(error.message, "error"); } }
    finally { if (run.isCurrent(generation)) {  $("cancel").hidden = true; $("calculate-seek").disabled = false; updateShare(); } }
  }
  function resetCalculationControls() {
    if (root.MultiFindApp && root.MultiFindApp.cancel) root.MultiFindApp.cancel();
    $("cancel").hidden = true; $("calculate").disabled=false; $("calculate-seek").disabled = false;
  }
  function cancelCalculation(message) {
    run.cancel();
    resetCalculationControls();
    if (sharing.isBusy()) markInputsChanged();
    if (message) setStatus(message);
  }
  function updateShare() {
    var seeking = $("mode").value === "seek";
    var ready = seeking ? !!state.seekResult : state.mounted && host.started &&
      !root.MultiTrackApp.isDirty() && root.MultiTrackApp.getFindSnapshot() && root.MultiTrackApp.getFindSnapshot().ready;
    var canSend = bridge.isConnected() && bridge.supports("message", "text");
    $("send-context").disabled = state.closed || !!state.preparationIssue || sharing.isBusy() || !ready;
    $("send-context").textContent = canSend ? "결과를 GPT에 전달" : "결과 내보내기";
    $("send-context").title = canSend ? "계산 결과를 호스트에 공유합니다." :
      "계산 결과를 전체 스냅샷으로 복사하거나 JSON 파일로 저장합니다.";
    if(state.mounted && !seeking && $("cancel").hidden) {
      $("calculate").disabled=!state.uiReady || state.closed || !!state.preparationIssue || !!(ready&&root.MultiPlanApp.getState().enabled);
    }
  }
  function resultInput() {
    return {
      track: root.MultiTrackApp.getShareState(),
      find: root.MultiFindApp.getResult(), findEnabled: host.findEnabled,
      findSettings: root.MultiFindApp.getShareSettings(),
      plan: root.MultiPlanApp.getState(), outputs: root.MultiTrackApp.getOutputs() || [],
      dataVersion: state.dataVersion || state.uiData && state.uiData.dataVersion
    };
  }
  function captureForShare() {
    var seeking = $("mode").value === "seek";
    if (!seeking) return {snapshot: root.CatsrollGptResultSummary.capture(resultInput()), serverShare: true};
    return {serverShare: false, snapshot: state.seekSnapshot};
  }
  function showRecovery(job, message, kind) {
    if (sharing.current() !== job) return;
    state.recoveryJob = job;
    $("share-recovery").hidden = false;
    var reference = job.resultId ? "저장된 결과 ID: " + job.resultId + " · 재시도는 같은 스냅샷 키를 사용합니다.\n" : "";
    $("share-recovery-status").textContent = reference + (message || "결과 스냅샷을 내려받거나 복사할 수 있습니다.");
    $("share-recovery-status").className = "status-message" + (kind ? " is-" + kind : "");
    refreshRecoveryProvenance();
    $("share-recovery-json").value = job.serialized;
    $("share-recovery-text").value = job.fullText || "";
  }
  function saveBlob(name, content, type) {
    var url = root.URL.createObjectURL(new root.Blob([content], {type: type}));
    var link = node("a", "");
    link.href = url; link.download = name; link.hidden = true;
    doc.body.appendChild(link); link.click(); link.remove();
    root.setTimeout(function () { root.URL.revokeObjectURL(url); }, 1000);
  }
  async function restoreHashRequest() {
    try {
      var envelope = root.CatsrollGptInputTransfer.decode(root.location.hash);
      if (!envelope) return;
      applyHostArguments(envelope.arguments, true);
      root.clearTimeout(state.seekPrepTimer);
      var generation = run.current();
      var reply = await bridge.callTool("catsroll_prepare", envelope.arguments);
      if (!run.isCurrent(generation)) return;
      var payload = requirePreparation(reply); if (!payload) return;
      applyHostArguments(payload.request, true);
      applyPreparedPayload(payload);
      installPreparedPools(payload);
      setStatus("링크의 모든 계산 조건을 복원했습니다. 계산 버튼을 눌러 실행하세요.");
    } catch (error) { setStatus("입력 복원 실패: " + error.message, "error"); }
  }
  var inputs = root.CatsrollGptInputs({onError:function(message){setStatus(message,"error");},onChange:function(){
    if (state.request) state.request = Object.assign({}, state.request, inputs.read());
    cancelCalculation();state.seekResult=null;state.seekPayload=null;state.seekRolls=[];$("seek-result").replaceChildren();
    renderSeek();queueSeekPreparation();
    if(state.mounted)root.MultiTrackApp.markFindDirty();updateShare();
  }});
  $("calculate").onclick=calculateMulti;
  $("retry-connection").onclick = function () { if (!state.closed) bridge.connect(); };
  $("retry-bootstrap").onclick = function () { if (!state.closed) bootstrap(); };
  $("add-roll").onclick = function () { if (state.seekRolls.length >= 10) return; cancelCalculation(); state.seekRolls.push(0); state.seekResult = null; $("seek-result").replaceChildren(); renderSeek(); updateShare(); };
  $("calculate-seek").onclick = calculateSeek;
  $("cancel").onclick = function () { cancelCalculation("계산을 중단했습니다."); updateShare(); };
  $("send-context").onclick = function () { if (!this.disabled) sharing.send(); };
  ["input", "change"].forEach(function (eventName) {
    doc.addEventListener(eventName, function (event) {
      if (event.target.closest("#share-recovery")) return;
      // Picker filtering changes neither calculation inputs nor shared results.
      // Find settings also change through buttons, so use its semantic event.
      if (event.target.matches('input[type="search"]') ||
          event.target.closest("#multi_find_panel, #multi_find_dialog")) return;
      if (event.target.closest("#multi_plan_panel, #multi_plan_dialog")) { currentPlanRevision(); refreshRecoveryProvenance(); }
      else markInputsChanged();
    });
  });
  $("copy-share-json").onclick = async function () {
    if (!state.recoveryJob) return;
    var textarea = $("share-recovery-json");
    textarea.focus(); textarea.select();
    try {
      if (!root.navigator.clipboard || !root.navigator.clipboard.writeText) throw new Error("Clipboard unavailable");
      await root.navigator.clipboard.writeText(textarea.value);
      $("share-recovery-status").textContent = "전체 JSON을 복사했습니다. 공유할 대화에 붙여 넣으세요.";
    } catch (_) { $("share-recovery-status").textContent = "자동 복사가 차단됐습니다. 선택된 JSON을 직접 복사하세요."; }
  };
  $("download-share-json").onclick = function () {
    if (state.recoveryJob) saveBlob("catsroll-result.json", state.recoveryJob.serialized, "application/json;charset=utf-8");
  };
  if (root.parent === root) root.addEventListener("hashchange", function () {
    if (state.mounted) restoreHashRequest();
  });
  root.addEventListener("pagehide", function (event) {
    // A BFCache page resumes these same objects rather than rerunning scripts.
    if (!event.persisted) { bridge.close(); run.cancel(); }
  });
  bridge.connect();
})(typeof globalThis !== "undefined" ? globalThis : this);
