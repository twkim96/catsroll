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
console.log("multi-track-resize: ok");
