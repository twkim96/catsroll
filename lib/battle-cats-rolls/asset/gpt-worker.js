"use strict";

// Bundled in the widget from the same on-disk engines as the website. A blob
// worker avoids cross-origin importScripts/fetch and embeds the existing WASM.
self.onmessage = async function (event) {
  var message = event.data || {};
  self.postMessage({type: "ready"});
  try {
    if (!message.payload || !message.payload.request || message.payload.request.mode !== message.mode) {
      throw new Error("계산 모드와 입력이 일치하지 않습니다.");
    }
    var result;
    if (message.mode === "seek") {
      var bytes = Uint8Array.from(atob(self.CATSROLL_WASM_BASE64), function (char) {
        return char.charCodeAt(0);
      });
      result = await self.CatsrollGptRuntime.seek(message.payload.seeker, createSeekerModule, bytes);
    } else {
      result = self.CatsrollGptRuntime.compute(message.mode, message.payload, null, function (progress) {
        self.postMessage({type: "progress", progress: progress});
      });
    }
    self.postMessage({type: "result", result: result});
  } catch (error) {
    self.postMessage({type: "error", message: error && error.message || String(error)});
  }
};
