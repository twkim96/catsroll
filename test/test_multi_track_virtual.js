"use strict";

const assert = require("assert");
const virtual = require(
  "../lib/battle-cats-rolls/asset/multi-track-virtual.js");

const ipadSafari = {
  userAgent: "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) " +
    "AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  maxTouchPoints: 5
};
const desktopModeIPadSafari = {
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) " +
    "AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  maxTouchPoints: 5
};
const iphoneSafari = {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) " +
    "AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  maxTouchPoints: 5
};
const ipadChrome = {
  userAgent: "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) " +
    "AppleWebKit/605.1.15 CriOS/140.0 Mobile/15E148 Safari/604.1",
  maxTouchPoints: 5
};
const macSafari = {
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
    "AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
  maxTouchPoints: 0
};

assert.strictEqual(virtual.appleSafariDevice(ipadSafari), "ipad");
assert.strictEqual(virtual.appleSafariDevice(desktopModeIPadSafari), "ipad");
assert.strictEqual(virtual.appleSafariDevice(iphoneSafari), "iphone");
assert.strictEqual(virtual.appleSafariDevice(ipadChrome), "");
assert.strictEqual(virtual.appleSafariDevice(macSafari), "");
assert.strictEqual(virtual.enabledFor("ipad", { ipad: true }), true);
assert.strictEqual(virtual.enabledFor("iphone", { ipad: true }), false);
assert.strictEqual(virtual.enabledFor("iphone",
  { ipad: true, iphone: true }), true);

const model = virtual.create(500, {
  chunkSize: 40,
  bufferChunks: 2,
  estimatedRowHeight: 64
});
assert.deepStrictEqual(virtual.rangeForIndex(model, 0), { start: 0, end: 120 });
assert.deepStrictEqual(virtual.rangeForIndex(model, 200),
  { start: 120, end: 320 });
assert.deepStrictEqual(virtual.rangeForIndex(model, 499),
  { start: 400, end: 500 });
assert.strictEqual(virtual.sameRange(
  { start: 120, end: 320 }, { start: 120, end: 320 }), true);

virtual.updateHeights(model, [
  { index: 0, height: 48 },
  { index: 1, height: 52 }
]);
assert.strictEqual(model.estimatedRowHeight, 50);
assert.strictEqual(virtual.offsetForIndex(model, 3), 150);
assert.strictEqual(virtual.indexAtOffset(model, 49), 1);
assert.strictEqual(virtual.indexAtOffset(model, 101), 2);

console.log("multi-track-virtual: ok");
