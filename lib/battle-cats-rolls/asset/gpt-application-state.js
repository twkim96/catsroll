(function (root, factory) {
  "use strict";
  var create = factory();
  if (typeof module === "object" && module.exports) module.exports = create;
  if (root) root.CatsrollApplicationState = create;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  // Owns orchestration and revision fences. Engine results remain owned by the
  // existing Multi/Find controllers; this module never calculates or copies them.
  return function () {
    var revision = 0, planRevision = 0, generation = 0;
    var phase = "idle", resource = null;
    function cancel() {
      generation += 1;
      var previous = resource; resource = null;
      if (phase === "preparing" || phase === "running") phase = "cancelled";
      if (previous && previous.cancel) previous.cancel();
    }
    var calculation = {
      begin: function () { cancel(); phase = "preparing"; return generation; },
      current: function () { return generation; },
      isCurrent: function (id) { return generation === id; },
      phase: function () { return phase; },
      move: function (id, value) {
        if (id !== generation) return false;
        if (["prepared", "running", "completed", "partial", "failed", "cancelled"].indexOf(value) < 0) throw new Error("Invalid calculation phase");
        phase = value;
        if (value !== "running") resource = null;
        return true;
      },
      attach: function (id, value) {
        if (id !== generation) { if (value && value.cancel) value.cancel(); return false; }
        resource = value; phase = "running"; return true;
      },
      cancel: cancel
    };
    return {calculation: calculation,
      inputRevision: function () { return revision; },
      planRevision: function () { return planRevision; },
      inputsChanged: function () { revision += 1; cancel(); },
      planChanged: function () { planRevision += 1; }};
  };
});
