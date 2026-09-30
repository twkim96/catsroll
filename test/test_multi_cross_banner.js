"use strict";

const assert = require("assert");
const engine = require("../lib/battle-cats-rolls/asset/multi-find-engine.js");
const tracks = require("../lib/battle-cats-rolls/asset/track-engine.js").TrackEngine;
const plans = require("../lib/battle-cats-rolls/asset/multi-plan.js");
// Public KR pools from 2026-09-28, reduced to simulation inputs.
const fixture = require("./fixtures/multi-cross-banner.json");
fixture.ready = true;
const pools = fixture.rows.map((row) => row.pool);
const alternatives = engine.buildTrackAlternatives(pools, fixture.seed, fixture);
const hidden = alternatives[0]["2A"].find((entry) =>
  entry.kind === "guaranteed" && entry.variant === "rerolled");
assert.strictEqual(hidden.pull.id, 866);
assert.strictEqual(hidden.pull.name, "진 어새신");
assert.strictEqual(hidden.next, "13B");
assert.deepStrictEqual(hidden.prerequisite, {column: 1, position: "1A",
  name: "고양이 탐사기", kind: "regular"});
const baseline = tracks.buildTracks(pools[0], fixture.seed, {
  count: fixture.count, last: fixture.last, guaranteedRolls: 11, findCat: false
}).cats[1][0];
assert.strictEqual(baseline.guaranteed.id, 368);
assert(!baseline.rerolled, "the original single-banner table misses this branch");
const alone = engine.buildTrackAlternatives([pools[0]], fixture.seed, fixture);
assert(!alone[0]["2A"].some((entry) => entry.variant === "rerolled"),
  "unreachable predecessor states are not displayed");
assert(!alternatives[0]["1B"], "no path starts at 1B");
assert(!Object.keys(alternatives[0]).some((position) => parseInt(position) > 200));
assert(!alternatives[0]["200A"].some((entry) => entry.kind === "guaranteed"),
  "guaranteed draws must fit the displayed range");
const duplicate = engine.buildTrackAlternatives([pools[0], pools[0]], fixture.seed, fixture);
assert.deepStrictEqual(duplicate[0], duplicate[1], "duplicate banners merge states");

// Independently enumerate all predecessor states in a bounded window, then
// compare complete outcomes with the merged two-class calculation.
const small = Object.assign({}, fixture, {count: 30});
const merged = engine.buildTrackAlternatives(pools, fixture.seed, small);
const reachable = [new Set([small.last])];
const expected = pools.map(() => ({}));
function signature(entry) {
  return [entry.kind, entry.variant || "", entry.pull.id, entry.next].join(":");
}
function arrive(offset, last) {
  if (offset > 59) return;
  (reachable[offset] || (reachable[offset] = new Set())).add(last);
}
for (let offset = 0; offset < 60; offset++) {
  if (!reachable[offset]) continue;
  pools.forEach((pool, column) => {
    const results = new Set();
    reachable[offset].forEach((last) => {
      const regular = engine.simulateRegular(pool, small.seed, offset, last);
      results.add(signature({kind: regular.rerolled ? "reroll" : "regular",
        pull: regular, next: regular.next}));
      arrive(regular.nextOffset, regular.lastRareId);
      const guaranteed = engine.simulateGuaranteed(pool, small.seed, offset, last, 59);
      if (!guaranteed) return;
      results.add(signature({kind: "guaranteed",
        variant: regular.rerolled ? "rerolled" : "base",
        pull: guaranteed.pulls[10], next: guaranteed.next}));
      arrive(guaranteed.nextOffset, 0);
    });
    expected[column][engine.positionLabel(offset)] = [...results].sort();
  });
}
pools.forEach((_, column) => {
  const actual = Object.fromEntries(Object.entries(merged[column]).map(
    ([position, entries]) => [position, entries.map(signature).sort()]));
  assert.deepStrictEqual(actual, expected[column]);
});
const marks = [{column: 1, position: "1A", kind: "regular"},
  {column: 0, position: "2A", kind: "guaranteed", variant: "rerolled"}];
const saved = plans.upsertPlan(plans.emptyLibrary(), {
  name: "픽시즈 → Fate", track: fixture, marks
});
const route = plans.buildRoutePlan(engine, fixture, saved.plan.marks);
assert(route.valid, "conditional RG selections survive saving and route calculation");
assert(route.cats.some((cat) => cat.id === 866));
assert(route.destinations.some((destination) => destination.position === "13B"));
const automatic = plans.buildRoutePlan(engine, fixture, [marks[1]]);
assert(automatic.valid, "selecting RG can find the cross-banner predecessor");
assert(automatic.auto.some((step) => step.column === 1 && step.position === "1A"));
const findActions = [
  {type: "roll", event: fixture.rows[1].event, start: "1A"},
  {type: "guaranteed", event: fixture.rows[0].event, start: "2A",
    guaranteedLabel: "2ARG"}
];
const converted = plans.marksFromFindActions(fixture, findActions);
assert.deepStrictEqual(converted, {marks, missing: []},
  "automatic drawing converts Find actions into persistable plan boxes");
assert(plans.buildRoutePlan(engine, fixture, converted.marks).valid);
const labeled = Object.assign({}, fixture, {rows: fixture.rows.map((row) =>
  Object.assign({}, row, {title: "Full " + row.event, label: "Short"}))});
assert.strictEqual(plans.marksFromFindActions(labeled, [Object.assign({},
  findActions[0], {eventLabel: labeled.rows[1].title})]).marks.length, 1,
  "Find uses the full title rather than the short table label");
assert.deepStrictEqual(plans.marksFromFindActions(fixture,
  [{event: "missing-ticket", start: "1A"}]).missing, ["missing-ticket"],
  "missing ticket banners are reported instead of drawing an incomplete route");
console.log("multi-cross-banner: ok");
