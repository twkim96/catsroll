(function (root) {
  "use strict";
  var started = root.performance.now(), steps = [];
  var buildId = root.document.documentElement.getAttribute("data-catsroll-build") || "unknown";
  var diagnosticId = root.crypto.randomUUID();
  root.CatsrollRecordDiagnostic = function (stage) {
    if (steps.length >= 40) steps.shift();
    steps.push({stage: stage, elapsedMs: Math.round(root.performance.now() - started)});
    var output = root.document.getElementById("connection-diagnostics");
    if (output) output.textContent = JSON.stringify(root.CatsrollDiagnostics(), null, 2);
  };
  root.CatsrollDiagnostics = function () {
    return {buildId: buildId, diagnosticId: diagnosticId, steps: steps.map(function (step) {
      return {stage: step.stage, elapsedMs: step.elapsedMs};
    })};
  };
  // Capture execution failures without exception text, URLs, arguments or stacks.
  root.addEventListener("error", function () { root.CatsrollRecordDiagnostic("script-error"); });
  root.addEventListener("unhandledrejection", function () { root.CatsrollRecordDiagnostic("unhandled-rejection"); });
  root.addEventListener("securitypolicyviolation", function () { root.CatsrollRecordDiagnostic("csp-violation"); });
  root.CatsrollRecordDiagnostic("html-start");
})(window);
