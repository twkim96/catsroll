"use strict";

const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

// Exercise the real registered handler without requiring a browser toolbar in CI.
const source = fs.readFileSync(require.resolve(
  "../lib/battle-cats-rolls/asset/multi-track.js"), "utf8");
const start = source.indexOf("  var trackLayoutWidth =");
const end = source.indexOf("\n  if (useChunkVirtualization)", start);
assert(start >= 0 && end > start);
const tables = { clientWidth: 1200 };
let resize;
let rowSyncs = 0;
let scrollUiUpdates = 0;
let virtualUpdates = 0;
const window = {
  innerHeight: 700,
  addEventListener(type, callback) {
    assert.strictEqual(type, "resize");
    resize = callback;
  }
};
vm.runInNewContext(source.slice(start, end), {
  global: window, els: { tables },
  scheduleTrackRowSync() { rowSyncs++; },
  scheduleTrackScrollUi() { scrollUiUpdates++; },
  scheduleVirtualWindow() { virtualUpdates++; }
});

// Address bar collapse/expansion, keyboard, and repeated identical resize events.
[780, 790, 700, 400, 700, 700].forEach(height => {
  window.innerHeight = height;
  resize();
});
assert.strictEqual(rowSyncs, 0, "height-only changes must not reset table rows");
assert.strictEqual(scrollUiUpdates, 0);
assert.strictEqual(virtualUpdates, 6, "Safari visible-window updates remain active");

tables.clientWidth = 900;
resize();
assert.strictEqual(rowSyncs, 1, "real width changes still remeasure wrapped rows");
assert.strictEqual(scrollUiUpdates, 1);
window.innerHeight = 780;
resize();
assert.strictEqual(rowSyncs, 1, "height changes after a width change remain ignored");
tables.clientWidth = 1200;
resize();
assert.strictEqual(rowSyncs, 2, "restoring the previous width also resynchronizes");

// Width changes and PNG captures share this production synchronization path.
// Simulate wrapped text and fail if a height write dirties layout while another
// row still needs measurement.
const operations = [];
function row(label, naturalHeight, index) {
  const style = {};
  Object.defineProperty(style, "height", {
    set(value) { operations.push([value ? "write" : "reset", label, value]); }
  });
  return {style, dataset: {rowIndex: String(index)},
    get offsetHeight() { operations.push(["read", label]); return naturalHeight; }};
}
const aRows = [row("a0", 40, 10), row("a1", 80, 11), row("a2", 0, 12)];
const bRows = [row("b0", 64, 10), row("b1", 32, 11), row("b2", 0, 12)];
const bodies = [aRows, bRows].map(rows => ({querySelectorAll() { return rows; }}));
let measured;
let spacers = 0;
const syncContext = {
  intValue(value, fallback) { return Number(value) || fallback; },
  useChunkVirtualization: true, virtualModel: {},
  virtualApi: {updateHeights(model, measurements) { measured = measurements; }},
  updateVirtualSpacers() { spacers++; }
};
const syncStart = source.indexOf("  function syncRowsIn(");
const syncEnd = source.indexOf("  function syncTrackRowHeights()", syncStart);
vm.runInNewContext(source.slice(syncStart, syncEnd), syncContext);
syncContext.syncRowsIn({querySelectorAll() { return bodies; }}, true);
assert.deepStrictEqual(operations.map(op => op[0]), [
  "reset", "reset", "reset", "reset", "reset", "reset",
  "read", "read", "read", "read", "read", "read",
  "write", "write", "write", "write"
]);
assert.deepStrictEqual(operations.filter(op => op[0] === "write"), [
  ["write", "a0", "64px"], ["write", "b0", "64px"],
  ["write", "a1", "80px"], ["write", "b1", "80px"]
]);
assert.deepStrictEqual(Array.from(measured, item => [item.index, item.height]), [[10, 64], [11, 80]]);
assert.strictEqual(spacers, 1);
console.log("multi-track-resize: ok");
