(function (root) {
  "use strict";
  root.CatsrollHostBridge = function (options) {
  options = options || {};
  var doc = root.document, cleanup = [], messageListenerAttached = false;
  var state = {phase: "disconnected", connected: false, parentOrigin: null, initId: null, nextRpcId: 1,
    pending: Object.create(null), localRequestId: 0, hostCapabilities: null,
    hostCapabilitiesAdvertised: false, hostContext: {}, closed: false};
  var setBridge = options.onConnection || function () {};
  var setStatus = options.onError || function () {};
  function diagnostic(stage) {
    if (typeof options.onDiagnostic !== "function") return;
    try { options.onDiagnostic(stage); } catch (_) {}
  }
  function has(value, key) { return Object.prototype.hasOwnProperty.call(value, key); }
  function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
  function isHttpOrigin(origin) {
    if (typeof origin !== "string" || !origin || origin === "null") return false;
    try {
      var parsed = new root.URL(origin);
      return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.origin === origin;
    } catch (_) { return false; }
  }
  function messageKind(message) {
    if (!isObject(message) || message.jsonrpc !== "2.0") return null;
    var hasId = has(message, "id"), hasResult = has(message, "result"), hasError = has(message, "error");
    if (hasId && typeof message.id !== "string" &&
        !(typeof message.id === "number" && Number.isFinite(message.id))) return null;
    if (has(message, "method")) {
      if (typeof message.method !== "string" || !message.method || hasResult || hasError) return null;
      if (has(message, "params") && (!message.params || typeof message.params !== "object")) return null;
      return hasId ? "request" : "notification";
    }
    if (!hasId || hasResult === hasError) return null;
    if (hasError && (!isObject(message.error) || !Number.isInteger(message.error.code) ||
        typeof message.error.message !== "string")) return null;
    return "response";
  }
  function updateHostContext(context) {
    if (!isObject(context)) return;
    var merged = {};
    // Preserve protocol fields without invoking special setters such as __proto__.
    [state.hostContext, context].forEach(function (part) {
      Object.keys(part).forEach(function (key) {
        Object.defineProperty(merged, key, {value: part[key], enumerable: true, writable: true, configurable: true});
      });
    });
    state.hostContext = merged;
    if (options.onHostContext) options.onHostContext(merged);
  }
  function hostSupports(name, modality) {
    if (!state.hostCapabilitiesAdvertised) return true;
    var capabilities = state.hostCapabilities;
    if (!capabilities || !Object.prototype.hasOwnProperty.call(capabilities, name)) return false;
    var feature = capabilities[name];
    if (!feature || typeof feature !== "object") return false;
    return modality ? Object.prototype.hasOwnProperty.call(feature, modality) : true;
  }
  function observeHostSize() {
    var frame = null, previousWidth = 0, previousHeight = 0;
    function schedule() {
      if (state.closed || frame != null) return;
      frame = root.requestAnimationFrame(function () {
        frame = null;
        if (state.closed || !state.connected || !state.parentOrigin) return;
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
      cleanup.push(function () { observer.disconnect(); });
    }
    root.addEventListener("resize", schedule);
    cleanup.push(function () { root.removeEventListener("resize", schedule); if (frame != null) root.cancelAnimationFrame(frame); });
    schedule();
  }
  function rpcRequest(method, params, timeoutMs) {
    if (state.closed) return Promise.reject(new Error("Connection closed"));
    if (method === "tools/call" && !hostSupports("serverTools")) {
      return Promise.reject(new Error("호스트가 서버 도구 호출을 지원하지 않습니다."));
    }
    if (method === "ui/update-model-context" && !hostSupports("updateModelContext", "text")) {
      return Promise.reject(new Error("호스트가 텍스트 문맥 갱신을 지원하지 않습니다."));
    }
    if (method === "ui/message" && !hostSupports("message", "text")) {
      return Promise.reject(new Error("호스트가 텍스트 메시지를 지원하지 않습니다."));
    }
    if (!state.connected || !state.parentOrigin) return Promise.reject(new Error("ChatGPT 연결이 준비되지 않았습니다."));
    var id = state.nextRpcId++;
    return new Promise(function (resolve, reject) {
      var timer = root.setTimeout(function () {
        delete state.pending[id];
        reject(new Error("ChatGPT 연결 응답 시간이 초과됐습니다. 연결 상태를 확인하고 다시 시도해 주세요."));
      }, timeoutMs || 20000);
      state.pending[id] = { id: id, resolve: resolve, reject: reject, timer: timer, method: method };
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
    var controller = new root.AbortController();
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
    if (state.closed) return Promise.reject(new Error("Connection closed"));
    var params = { name: name, arguments: args || {} };
    return root.parent === root ? standaloneRequest("tools/call", params) : rpcRequest("tools/call", params, 30000);
  }

  function handleRpcResponse(message) {
    var pending = state.pending[message.id];
    if (!pending || message.id !== pending.id) return false;
    delete state.pending[message.id]; root.clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message || "ChatGPT 요청이 실패했습니다."));
    else pending.resolve(message.result);
    return true;
  }

  function clearConnectionResources() {
    if (messageListenerAttached) {
      root.removeEventListener("message", onHostMessage);
      messageListenerAttached = false;
    }
    cleanup.forEach(function (fn) { fn(); });
    cleanup = [];
  }

  function clearPending(id, error) {
    var pending = state.pending[id];
    if (!pending) return;
    delete state.pending[id];
    root.clearTimeout(pending.timer);
    if (error) pending.reject(error);
  }

  function clearAllPending(error) {
    Object.keys(state.pending).forEach(function (id) { clearPending(id, error); });
  }

  function resetConnectionAttempt() {
    clearConnectionResources();
    clearAllPending(new Error("ChatGPT 연결을 다시 시작했습니다."));
    state.initId = null;
    state.parentOrigin = null;
    state.hostCapabilities = null;
    state.hostCapabilitiesAdvertised = false;
    var hadHostContext = Object.keys(state.hostContext).length > 0;
    state.hostContext = {};
    if (hadHostContext && typeof options.onHostContext === "function") {
      options.onHostContext(state.hostContext);
    }
    state.connected = false;
  }

  function failInitialization(label, message, id, diagnosticStage) {
    if (id != null) clearPending(id, new Error(message));
    clearAllPending(new Error(message));
    clearConnectionResources();
    state.initId = null;
    state.parentOrigin = null;
    state.hostCapabilities = null;
    state.hostCapabilitiesAdvertised = false;
    state.hostContext = {};
    state.connected = false;
    state.phase = "failed";
    setBridge(label, "error");
    if (diagnosticStage) diagnostic(diagnosticStage);
    setStatus(message, "error");
  }

  function onHostMessage(event) {
    if (state.closed) return;
    if (event.source !== root.parent) return;
    var message = event.data;
    var kind = messageKind(message);
    if (!kind) return;

    if (!state.parentOrigin) {
      if (state.phase === "connecting" && kind === "request" && message.method === "ping" &&
          (!has(message, "params") || isObject(message.params)) &&
          (typeof message.id === "string" || (typeof message.id === "number" &&
            Number.isFinite(message.id) && Number.isInteger(message.id))) && isHttpOrigin(event.origin)) {
        root.parent.postMessage({jsonrpc: "2.0", id: message.id, result: {}}, event.origin);
        return;
      }
      if (kind !== "response" || !state.pending[state.initId] || message.id !== state.initId) return;
      if (has(message, "result") && !isObject(message.result)) return;
      if (!event.origin || event.origin === "null") {
        failInitialization("호스트 출처 확인 실패",
          "ChatGPT 호스트의 보안 출처를 확인할 수 없습니다.", message.id);
        return;
      }
      state.parentOrigin = event.origin;
      var pending = state.pending[message.id];
      if (pending) handleRpcResponse(message);
      if (message.error) {
        failInitialization("연결 실패",
          message.error.message || "ChatGPT 연결을 시작하지 못했습니다.", message.id);
        return;
      }
      var initResult = message.result || {};
      if (Object.prototype.hasOwnProperty.call(initResult, "hostCapabilities")) {
        state.hostCapabilitiesAdvertised = true;
        state.hostCapabilities = initResult.hostCapabilities &&
          typeof initResult.hostCapabilities === "object" ? initResult.hostCapabilities : null;
      }
      state.connected = true;
      state.phase = "ready";
      updateHostContext(initResult.hostContext || {});
      if (state.closed) return;

      root.parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} }, state.parentOrigin);
      setBridge("ChatGPT 연결됨", "ready");
      observeHostSize();
      diagnostic("initialize-ready");
      if (options.onReady) options.onReady();
      return;
    }
    if (event.origin !== state.parentOrigin) return;
    if (kind === "response") { handleRpcResponse(message); return; }
    if (kind === "request") {
      if (message.method === "ping") {
        root.parent.postMessage({jsonrpc: "2.0", id: message.id, result: {}}, state.parentOrigin);
        return;
      }
      if (message.method === "ui/resource-teardown") {
        // Fence new calls before the synchronous device cancellation callback.
        state.closed = true; state.connected = false;
        try {
          diagnostic("teardown");
          if (options.onTeardown) options.onTeardown(message.params || {});
        } finally {
          try {
            root.parent.postMessage({jsonrpc: "2.0", id: message.id, result: {}}, state.parentOrigin);
          } finally { close(); }
        }
      } else {
        root.parent.postMessage({jsonrpc: "2.0", id: message.id,
          error: {code: -32601, message: "Method not found"}}, state.parentOrigin);
      }
      return;
    }
    if (message.method === "ui/notifications/host-context-changed") {
      if (!isObject(message.params)) return;
      updateHostContext(message.params);
      if (state.closed) return;
    }

    if (options.onNotification) options.onNotification(message);
  }

  function initializeHost() {
    if (state.closed) throw new Error("Connection closed");
    if (state.phase === "connecting" || state.phase === "ready") return;
    resetConnectionAttempt();
    diagnostic("bridge-start");
    if (root.parent === root) {
      state.connected = false;
      state.phase = "ready";

      setBridge("로컬 미리보기", "ready");
      if (options.onReady) options.onReady();
      return;
    }
    root.addEventListener("message", onHostMessage);
    messageListenerAttached = true;
    state.phase = "connecting";
    setBridge("ChatGPT 연결 중", "connecting");
    var id = state.nextRpcId++;
    state.initId = id;
    var timer = root.setTimeout(function () {
      if (state.phase !== "connecting" || state.initId !== id) return;
      failInitialization("연결 응답 없음",
        "ChatGPT 호스트가 초기화에 응답하지 않았습니다. 연결 버튼으로 다시 시도해 주세요.", id,
        "initialize-timeout");
    }, 10000);
    state.pending[id] = { id: id, resolve: function () {}, reject: function () {}, timer: timer, method: "ui/initialize" };
    try {
      root.parent.postMessage({ jsonrpc: "2.0", id: id, method: "ui/initialize", params: {
        protocolVersion: "2026-01-26",
        appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
        appInfo: { name: "Catsroll", version: "1.0.0" }
      } }, "*");
      diagnostic("initialize-sent");
    } catch (error) {
      failInitialization("연결 실패", error.message || String(error), id);
    }
  }

  function close() {
    state.closed = true; state.connected = false; state.phase = "disconnected";
    state.initId = null;
    clearConnectionResources();
    clearAllPending(new Error("Connection closed"));
  }
  return {connect: initializeHost, close: close, callTool: callTool,
    getHostContext: function () { return state.hostContext; },
    supports: hostSupports, isConnected: function () { return state.connected; },
    phase: function () { return state.phase; },
    updateContext: function (value) { return rpcRequest("ui/update-model-context", {content: [{type: "text", text: value}]}, 15000); },
    sendMessage: function (value) { return rpcRequest("ui/message", {role: "user", content: [{type: "text", text: value}]}, 15000); }};
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
