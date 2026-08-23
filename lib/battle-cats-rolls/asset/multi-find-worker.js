"use strict";

self.addEventListener("message", function (event) {
  var message = event.data || {};
  if (message.type !== "search") return;

  try {
    if (!self.MultiFindEngine) {
      if (!message.engineUrl) throw new Error("Find engine URL is missing");
      self.importScripts(message.engineUrl);
    }
    var result = self.MultiFindEngine.search(message.input, {
      progress: function (progress) {
        self.postMessage({ type: "progress", progress: progress });
      }
    });
    self.postMessage({ type: "result", result: result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error && error.message ? error.message : String(error)
    });
  }
});
