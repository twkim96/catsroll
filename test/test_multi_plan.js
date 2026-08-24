"use strict";

const assert = require("assert");
const plans = require("../lib/battle-cats-rolls/asset/multi-plan.js");

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
      customName: "울하고축",
      customNameAuto: false,
      seriesIds: [24, 42]
    },
    {
      lang: "kr",
      event: "2026-08-24_1021",
      ubers: 0,
      customName: "",
      customNameAuto: true,
      seriesIds: []
    }
  ]
};

const saved = plans.upsertPlan(plans.emptyLibrary(), {
  name: "루노스 획득 플랜",
  track: track,
  marks: [
    { column: 0, position: "2A" },
    { column: 1, position: "20B" },
    { column: 1, position: "20b" },
    { column: 7, position: "1A" },
    { column: 0, position: "501A" }
  ]
}, null, "2026-08-24T10:00:00.000Z", "plan-fixed");

assert(saved.plan, "a valid plan is saved");
assert.strictEqual(saved.plan.id, "plan-fixed");
assert.strictEqual(saved.plan.track.seed, 3671843074);
assert.strictEqual(saved.plan.track.rows.length, 2);
assert.deepStrictEqual(saved.plan.marks, [
  { column: 0, position: "2A", kind: "regular" },
  { column: 1, position: "20B", kind: "regular" }
], "marks are deduplicated and constrained to the saved array");

const onePerColumn = plans.normalizePlan({
  id: "one-per-column",
  name: "열당 하나",
  track: track,
  marks: [
    { column: 0, position: "2A" },
    { column: 1, position: "20B" },
    { column: 0, position: "7B" }
  ]
});
assert.deepStrictEqual(onePerColumn.marks, [
  { column: 0, position: "7B", kind: "regular" },
  { column: 1, position: "20B", kind: "regular" }
], "the latest mark replaces an older mark in the same banner column");

assert.strictEqual(plans.summarizeCats([
  { id: 101, name: "가시루가", rarity: 4 },
  { id: 101, name: "가시루가", rarity: 4, guaranteed: true },
  { id: 202, name: "레전드 냥코", rarity: 5 },
  { id: 303, name: "슈퍼레어", rarity: 3 }
]), "가시루가 ×2, 레전드 냥코",
"uber and legend selections are counted while other rarities are ignored");

function routeLabel(offset) {
  return (Math.floor(offset / 2) + 1) + (offset % 2 ? "B" : "A");
}

const fakeRouteEngine = {
  positionLabel: routeLabel,
  simulateRegular(pool, _seed, offset) {
    const rerolled = pool.key === "unsafe" && offset === 8;
    const nextOffset = offset + (rerolled ? 3 : 2);
    return {
      id: pool.id,
      name: pool.name,
      rarity: pool.rarity || 2,
      rerolled: rerolled,
      nextOffset: nextOffset,
      next: routeLabel(nextOffset),
      lastRareId: pool.id
    };
  },
  simulateGuaranteed(_pool, _seed, offset) {
    const pulls = [];
    for (let index = 0; index < 10; index += 1) {
      pulls.push({
        id: index === 4 ? 400 : 1,
        name: index === 4 ? "중간 울슈레" : "레어",
        rarity: index === 4 ? 4 : 2,
        start: routeLabel(offset + index * 2),
        rerolled: false
      });
    }
    pulls.push({
      id: 999,
      name: "확정 울슈레",
      rarity: 4,
      start: routeLabel(offset) + "G",
      guaranteed: true
    });
    return {
      pulls: pulls,
      nextOffset: offset + 21,
      next: routeLabel(offset + 21),
      lastRareId: 0
    };
  }
};

function routeSnapshot(pools) {
  return {
    ready: true,
    seed: 1,
    last: 0,
    count: 30,
    formIndex: 0,
    rows: pools.map((pool) => ({ pool: pool }))
  };
}

const unsafePool = {
  key: "unsafe", id: 10, name: "중복 레어", exist: true,
  guaranteed_rolls: 11
};
const safePool = {
  key: "safe", id: 20, name: "안전 레어", exist: true,
  guaranteed_rolls: 11
};

const blockedRoute = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([unsafePool]), [
    { column: 0, position: "10A", kind: "regular" }
  ]);
assert.strictEqual(blockedRoute.valid, false,
  "an unavoidable rare duplicate does not paint a misleading path");
assert.strictEqual(blockedRoute.auto.length, 0);

const defendedRoute = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([unsafePool, safePool]), [
    { column: 0, position: "10A", kind: "regular" }
  ]);
assert.strictEqual(defendedRoute.valid, true,
  "another banner can defend a rare duplicate and keep the target reachable");
assert.strictEqual(defendedRoute.auto.length, 9);
assert(defendedRoute.auto.some((step) =>
  step.position === "5A" && step.column === 1),
"the automatic route uses the safe banner at the duplicate position");

const guaranteedRoute = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([unsafePool]), [
    { column: 0, position: "1A", kind: "guaranteed" }
  ]);
assert.strictEqual(guaranteedRoute.valid, true);
assert.deepStrictEqual(guaranteedRoute.auto.map((step) => step.position),
  ["2A", "3A", "4A", "5A", "6A", "7A", "8A", "9A", "10A"],
  "a guaranteed pull paints the intervening route without replacing its start");
assert.deepStrictEqual(guaranteedRoute.destinations, [
  { column: 0, position: "11B", kind: "guaranteed" }
]);
assert.strictEqual(plans.summarizeCats(guaranteedRoute.cats),
  "중간 울슈레, 확정 울슈레");

const rerollRoute = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([unsafePool]), [
    { column: 0, position: "5A", kind: "reroll" }
  ]);
assert.strictEqual(rerollRoute.valid, true);
assert.deepStrictEqual(rerollRoute.destinations, [
  { column: 0, position: "6B", kind: "reroll" }
], "choosing the R line marks its next-track destination");

const extendedRoute = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([safePool, safePool]), [
    { column: 0, position: "7A", kind: "regular" },
    { column: 1, position: "10A", kind: "regular" }
  ]);
assert.strictEqual(extendedRoute.valid, true);
assert(extendedRoute.auto.some((step) => step.position === "8A"));
assert(extendedRoute.auto.some((step) => step.position === "9A"));
assert(!extendedRoute.auto.some((step) => step.position === "7A" ||
  step.position === "10A"), "selected checkpoints are not repainted as auto cells");

const updated = plans.upsertPlan(saved.library, {
  name: "수정한 플랜",
  track: Object.assign({}, track, { seed: 1234 }),
  marks: [{ column: 0, position: "3A" }]
}, "plan-fixed", "2026-08-24T11:00:00.000Z");

assert.strictEqual(updated.library.plans.length, 1,
  "explicitly saving a loaded plan updates instead of duplicating it");
assert.strictEqual(updated.plan.name, "수정한 플랜");
assert.strictEqual(updated.plan.track.seed, 1234);
assert.strictEqual(updated.plan.createdAt, "2026-08-24T10:00:00.000Z");
assert.strictEqual(updated.plan.updatedAt, "2026-08-24T11:00:00.000Z");

const overwriteByName = plans.upsertPlan(saved.library, {
  name: "루노스 획득 플랜",
  track: Object.assign({}, track, { seed: 999 }),
  marks: []
}, null, "2026-08-24T12:00:00.000Z", "plan-replacement");
assert.strictEqual(overwriteByName.library.plans.length, 1,
  "a saved name remains unique instead of receiving a numbered suffix");
assert.strictEqual(overwriteByName.plan.id, "plan-replacement");
assert.strictEqual(plans.findPlanByName(overwriteByName.library,
  " 루노스 획득 플랜 ").track.seed, 999,
  "name lookup trims surrounding whitespace");

const saveAs = plans.upsertPlan(overwriteByName.library, {
  name: "새 이름 플랜",
  track: track,
  marks: []
}, null, "2026-08-24T13:00:00.000Z", "plan-save-as");
assert.strictEqual(saveAs.library.plans.length, 2,
  "a different name creates a separate plan");
assert.strictEqual(plans.removePlan(saveAs.library, "plan-replacement").plans.length,
  1, "a saved plan can be removed by id");

const reorderedTrack = Object.assign({}, track, {
  rows: [track.rows[1], track.rows[0]]
});
const shortenedTrack = Object.assign({}, track, { rows: [track.rows[0]] });
assert.notStrictEqual(plans.trackFingerprint(track),
  plans.trackFingerprint(reorderedTrack),
  "banner order changes invalidate coordinate marks");
assert.notStrictEqual(plans.trackFingerprint(track),
  plans.trackFingerprint(shortenedTrack),
  "banner removal invalidates coordinate marks");

assert.deepStrictEqual(plans.normalizeLibrary({ version: 2, plans: [saved.plan] }),
  plans.emptyLibrary(), "unknown library versions fail closed");
assert.strictEqual(plans.normalizePlan({ id: "bad", name: "bad", track: {} }),
  null, "plans without a usable track are rejected");
assert.strictEqual(plans.storageKey, "battle-cats-rolls.multiPlans.v1");

console.log("multi-plan: ok");
