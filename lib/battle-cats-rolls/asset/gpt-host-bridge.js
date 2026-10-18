(function (root) {
  "use strict";
  root.CatsrollHostBridge = function (options) {
  options = options || {};
  var doc = root.document, cleanup = [];
  var state = {phase: "disconnected", connected: false, parentOrigin: null, initId: null, nextRpcId: 1,
    pending: Object.create(null), localRequestId: 0, hostCapabilities: null,
    hostCapabilitiesAdvertised: false, closed: false};
  var setBridge = options.onConnection || function () {};
  var setStatus = options.onError || function () {};
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
      cleanup.push(function () { observer.disconnect(); });
    }
    root.addEventListener("resize", schedule);
    cleanup.push(function () { root.removeEventListener("resize", schedule); if (frame != null) root.cancelAnimationFrame(frame); });
    schedule();
  }
  function rpcRequest(method, params, timeoutMs) {
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
    if (!pending) return false;
    delete state.pending[message.id]; root.clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error.message || "ChatGPT 요청이 실패했습니다."));
    else pending.resolve(message.result);
    return true;
  }

  function onHostMessage(event) {
    if (state.closed) return;
    if (event.source !== root.parent) return;
    var message = event.data;
    if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") return;

    if (!state.parentOrigin) {
      if (!state.pending[state.initId] || message.id !== state.initId || (!Object.prototype.hasOwnProperty.call(message, "result") && !message.error)) return;
      if (!event.origin || event.origin === "null") {
        state.phase = "failed";
        setBridge("호스트 출처 확인 실패", "error");
        setStatus("ChatGPT 호스트의 보안 출처를 확인할 수 없습니다.", "error");
        return;
      }
      state.parentOrigin = event.origin;
      var pending = state.pending[message.id];
      if (pending) handleRpcResponse(message);
      if (message.error) {
        state.phase = "failed";
        state.connected = false; setBridge("연결 실패", "error");
        setStatus(message.error.message || "ChatGPT 연결을 시작하지 못했습니다.", "error"); return;
      }
      var initResult = message.result || {};
      if (Object.prototype.hasOwnProperty.call(initResult, "hostCapabilities")) {
        state.hostCapabilitiesAdvertised = true;
        state.hostCapabilities = initResult.hostCapabilities &&
          typeof initResult.hostCapabilities === "object" ? initResult.hostCapabilities : null;
      }
      state.connected = true;
      state.phase = "ready";

      root.parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} }, state.parentOrigin);
      setBridge("ChatGPT 연결됨", "ready");
      observeHostSize();
      if (options.onReady) options.onReady();
      return;
    }
    if (event.origin !== state.parentOrigin) return;
    if (Object.prototype.hasOwnProperty.call(message, "id") && handleRpcResponse(message)) return;

    if (options.onNotification) options.onNotification(message);
  }

  function initializeHost() {
    if (state.closed) throw new Error("Connection closed");
    if (root.parent === root) {
      state.connected = false;
      state.phase = "ready";

      setBridge("로컬 미리보기", "ready");
      if (options.onReady) options.onReady();
      return;
    }
    root.addEventListener("message", onHostMessage);
    state.phase = "connecting";
    var id = state.nextRpcId++;
    state.initId = id;
    var timer = root.setTimeout(function () {
      if (state.connected) return;
      state.phase = "failed";
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
      state.phase = "failed";
      root.clearTimeout(timer); delete state.pending[id];
      setBridge("연결 실패", "error"); setStatus(error.message || String(error), "error");
    }
  }

  function close() {
    state.closed = true; state.connected = false; state.phase = "disconnected";
    root.removeEventListener("message", onHostMessage);
    cleanup.forEach(function (fn) { fn(); }); cleanup = [];
    Object.keys(state.pending).forEach(function (id) {
      var pending = state.pending[id]; root.clearTimeout(pending.timer);
      pending.reject(new Error("Connection closed")); delete state.pending[id];
    });
  }
  return {connect: initializeHost, close: close, callTool: callTool,
    supports: hostSupports, isConnected: function () { return state.connected; },
    phase: function () { return state.phase; },
    updateContext: function (value) { return rpcRequest("ui/update-model-context", {content: [{type: "text", text: value}]}, 15000); },
    sendMessage: function (value) { return rpcRequest("ui/message", {role: "user", content: [{type: "text", text: value}]}, 15000); }};
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
