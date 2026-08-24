"use strict";

const assert = require("assert");
const codec = require("../lib/battle-cats-rolls/asset/multi-share.js");

const track = {
  seed: 3671843074,
  last: 523,
  count: 500,
  formIndex: 2,
  rows: [
    {
      lang: "kr",
      event: "2026-08-21_1075",
      ubers: 1,
      customName: "울하고축 한글 이름",
      customNameAuto: false,
      seriesIds: [24, 42]
    },
    {
      lang: "jp",
      event: "2026-08-24_1021",
      ubers: 0,
      customName: "",
      customNameAuto: true,
      seriesIds: []
    }
  ]
};
const find = {
  optimization: "balance",
  maxGuaranteed: 2,
  maxPlatinum: 3,
  maxLegendTicket: 1,
  targets: [
    { cat_id: 564, allow_ticket: false },
    { cat_id: 591, allow_ticket: true }
  ]
};
const plan = {
  name: "루노스 획득 플랜",
  marks: [
    { column: 0, position: "2A", kind: "regular" },
    { column: 1, position: "20B", kind: "guaranteed", variant: "rerolled" },
    { column: 0, position: "94A", kind: "regular" }
  ]
};

const payload = codec.makePayload(track, find, 93, track.formIndex, plan);
assert(payload, "payload should be created");
assert.strictEqual(payload.t[2], 93, "share count overrides rendered count");

const token = codec.encode(payload);
assert(/^[A-Za-z0-9_-]+$/.test(token), "token is URL-safe base64");
const decoded = codec.decode(token);
assert.deepStrictEqual(decoded, payload, "payload round trips");
assert.deepStrictEqual(codec.fromHash("#share=" + token), payload,
  "share hash is decoded");

const restoredTrack = codec.trackState(decoded);
assert.strictEqual(restoredTrack.count, 93);
assert.strictEqual(restoredTrack.formIndex, 2);
assert.strictEqual(restoredTrack.rows[0].customName, "울하고축 한글 이름");
assert.strictEqual(restoredTrack.rows[0].customNameAuto, false);
assert.strictEqual(restoredTrack.rows[1].customNameAuto, true);
assert.deepStrictEqual(restoredTrack.rows[0].seriesIds, [24, 42]);

const restoredFind = codec.findSettings(decoded);
assert.strictEqual(restoredFind.optimization, "balance");
assert.strictEqual(restoredFind.maxGuaranteed, 2);
assert.strictEqual(restoredFind.maxPlatinum, 3);
assert.strictEqual(restoredFind.maxLegendTicket, 1);
assert.deepStrictEqual(restoredFind.targets, find.targets);

const restoredPlan = codec.planState(decoded);
assert.strictEqual(restoredPlan.name, plan.name);
assert.deepStrictEqual(restoredPlan.marks, plan.marks.slice(0, 2),
  "plan marks round trip and coordinates beyond the shared count are removed");

const legacyPayload = codec.makePayload(track, find, 93, track.formIndex);
assert.strictEqual(codec.planState(codec.decode(codec.encode(legacyPayload))), null,
  "links without a plan remain valid and do not invent plan state");

assert.strictEqual(codec.decode("not!base64"), null);
assert.strictEqual(codec.fromHash("#unrelated=value"), null);
assert.strictEqual(codec.normalize({ v: 2, t: [], r: [] }), null,
  "unknown versions fail closed");

const nineRows = Array.from({ length: 9 }, function (_unused, index) {
  return {
    lang: "kr",
    event: "event_" + index,
    ubers: 0,
    customName: "banner " + index,
    customNameAuto: false,
    seriesIds: []
  };
});
const eightRowPayload = codec.makePayload(Object.assign({}, track, {
  rows: nineRows
}), find, 50, track.formIndex, plan);
assert.strictEqual(eightRowPayload.r.length, 8,
  "share payload keeps up to eight banners");
assert.strictEqual(codec.trackState(eightRowPayload).rows[7].event, "event_7",
  "the eighth banner survives a share round trip");

console.log("multi-share: ok");
