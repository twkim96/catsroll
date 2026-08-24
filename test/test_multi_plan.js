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

const multiplePerBanner = plans.normalizePlan({
  id: "multiple-per-banner",
  name: "배너당 여러 좌표",
  track: track,
  marks: [
    { column: 0, position: "2A" },
    { column: 1, position: "20B" },
    { column: 0, position: "7B" }
  ]
});
assert.deepStrictEqual(multiplePerBanner.marks, [
  { column: 0, position: "2A", kind: "regular" },
  { column: 0, position: "7B", kind: "regular" },
  { column: 1, position: "20B", kind: "regular" }
], "one banner can keep checkpoints at several different positions");

const onePerPosition = plans.normalizePlan({
  id: "one-per-position",
  name: "좌표당 하나",
  track: track,
  marks: [
    { column: 0, position: "7A" },
    { column: 1, position: "7A" }
  ]
});
assert.deepStrictEqual(onePerPosition.marks, [
  { column: 1, position: "7A", kind: "regular" }
], "choosing another banner at the same position replaces only that choice");

assert.deepStrictEqual(plans.normalizeMark({
  column: 0, position: "6B", kind: "guaranteed", variant: "rerolled"
}, track), {
  column: 0, position: "6B", kind: "guaranteed", variant: "rerolled"
}, "RG selections preserve their rerolled guaranteed variant");

assert.strictEqual(plans.summarizeCats([
  { id: 101, name: "가시루가", rarity: 4 },
  { id: 101, name: "가시루가", rarity: 4, guaranteed: true },
  { id: 202, name: "레전드 냥코", rarity: 5 },
  { id: 303, name: "슈퍼레어", rarity: 3 }
]), "가시루가 ×2, 레전드 냥코",
"uber and legend selections are counted while other rarities are ignored");

assert.deepStrictEqual(plans.routeDecorationState({
  visible: true,
  active: false,
  positionSelected: false,
  destinationKind: "guaranteed",
  positionHasDestination: true,
  routeStep: null
}), { selected: false, destination: true, route: false },
"the orange destination remains visible at its own banner cell");

assert.deepStrictEqual(plans.routeDecorationState({
  visible: true,
  active: false,
  positionSelected: false,
  destinationKind: null,
  positionHasDestination: true,
  routeStep: { column: 1, position: "12B", kind: "regular" }
}), { selected: false, destination: false, route: false },
"an orange destination anywhere in a position suppresses blue route boxes");

assert.deepStrictEqual(plans.routeDecorationState({
  visible: true,
  active: true,
  positionSelected: true,
  destinationKind: "guaranteed",
  positionHasDestination: true,
  routeStep: { column: 0, position: "12B", kind: "regular" }
}), { selected: true, destination: false, route: false },
"a manual black selection suppresses destination and route boxes in its position");

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
assert.deepStrictEqual(guaranteedRoute.selections, [
  { column: 0, position: "1A", kind: "guaranteed", variant: "base" }
], "a normal guaranteed pull selects the G line");
assert.strictEqual(plans.summarizeCats(guaranteedRoute.cats),
  "중간 울슈레, 확정 울슈레");

const guaranteedContinuation = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([safePool]), [
    { column: 0, position: "2A", kind: "guaranteed" },
    { column: 0, position: "13B", kind: "regular" }
  ]);
assert.strictEqual(guaranteedContinuation.valid, true,
  "the same banner can continue from a guaranteed destination to a later checkpoint");
assert(guaranteedContinuation.auto.some((step) => step.position === "12B"),
  "the guaranteed destination is also consumed as the next automatic draw");
assert(guaranteedContinuation.destinations.some((step) =>
  step.position === "12B" && step.kind === "guaranteed"));

const rerollRoute = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([unsafePool]), [
    { column: 0, position: "5A", kind: "reroll" }
  ]);
assert.strictEqual(rerollRoute.valid, true);
assert.deepStrictEqual(rerollRoute.destinations, [
  { column: 0, position: "6B", kind: "reroll" }
], "choosing the R line marks its next-track destination");

const guaranteedVariantEngine = Object.assign({}, fakeRouteEngine, {
  simulateGuaranteed(pool, seed, offset, lastRareId) {
    const result = fakeRouteEngine.simulateGuaranteed(pool, seed, offset);
    const rerolled = pool.key === "unsafe" && offset === 11 &&
      lastRareId === pool.id;
    result.guaranteedLabel = routeLabel(offset) + (rerolled ? "RG" : "G");
    const guaranteed = result.pulls[result.pulls.length - 1];
    guaranteed.start = result.guaranteedLabel;
    guaranteed.id = rerolled ? 138 : 770;
    guaranteed.name = rerolled ? "석공 냥돌이" : "냥꽃 할배";
    return result;
  }
});

const rerolledGuaranteedRoute = plans.buildRoutePlan(guaranteedVariantEngine,
  routeSnapshot([unsafePool]), [
    { column: 0, position: "5A", kind: "reroll" },
    { column: 0, position: "6B", kind: "guaranteed", variant: "rerolled" }
  ]);
assert.strictEqual(rerolledGuaranteedRoute.valid, true);
assert.deepStrictEqual(rerolledGuaranteedRoute.selections, [
  { column: 0, position: "6B", kind: "guaranteed", variant: "rerolled" }
], "an R-path guaranteed pull selects the RG line");
assert(plans.summarizeCats(rerolledGuaranteedRoute.cats)
  .includes("석공 냥돌이"));

const mismatchedGuaranteedRoute = plans.buildRoutePlan(guaranteedVariantEngine,
  routeSnapshot([unsafePool]), [
    { column: 0, position: "5A", kind: "reroll" },
    { column: 0, position: "6B", kind: "guaranteed", variant: "base" }
  ]);
assert.strictEqual(mismatchedGuaranteedRoute.valid, false,
  "the G line is rejected when the saved route necessarily reaches RG");
assert.strictEqual(mismatchedGuaranteedRoute.invalid.position, "6B");

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

const originalTenA = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([safePool, safePool]), [
    { column: 0, position: "10A", kind: "regular" }
  ]);
const middleOverride = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([safePool, safePool]), [
    { column: 1, position: "5A", kind: "regular" },
    { column: 0, position: "10A", kind: "regular" }
  ], { preferredAuto: originalTenA.auto });
assert.strictEqual(middleOverride.valid, true);
assert.deepStrictEqual(middleOverride.auto.filter((step) =>
  plans.positionOffset(step.position) < plans.positionOffset("5A"))
  .map((step) => step.column), [0, 0, 0, 0],
"an equal-cost middle override keeps the already drawn prefix unchanged");
assert.strictEqual(middleOverride.costUnits, 30,
  "plan routes use the same 0.03 regular-draw cost units as Find");

const reloadedMiddleOverride = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([safePool, safePool]), [
    { column: 1, position: "5A", kind: "regular" },
    { column: 0, position: "10A", kind: "regular" }
  ]);
assert.deepStrictEqual(reloadedMiddleOverride.auto.filter((step) =>
  plans.positionOffset(step.position) < plans.positionOffset("5A"))
  .map((step) => step.column), [0, 0, 0, 0],
"reloading the same checkpoints keeps the final destination banner as tie-breaker");

const specialPool = Object.assign({}, safePool, {
  key: "platinum", platinum: "platinum"
});
const minimumCostRoute = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([safePool, specialPool]), [
    { column: 0, position: "4A", kind: "regular" }
  ], { preferredAuto: [
    { column: 1, position: "1A", kind: "regular" },
    { column: 1, position: "2A", kind: "regular" },
    { column: 1, position: "3A", kind: "regular" }
  ] });
assert.strictEqual(minimumCostRoute.valid, true);
assert(minimumCostRoute.auto.every((step) => step.column === 0),
  "minimum cost beats preservation when the old path used special tickets");
assert.strictEqual(minimumCostRoute.costUnits, 12);

function switchingEngine(returnToA) {
  return {
    positionLabel: routeLabel,
    simulateRegular(pool, _seed, offset) {
      const rerolled = offset === 2 || (returnToA && offset === 13);
      const nextOffset = offset + (rerolled ? 3 : 2);
      return {
        id: pool.id,
        name: pool.name,
        rarity: 2,
        rerolled: rerolled,
        nextOffset: nextOffset,
        next: routeLabel(nextOffset),
        lastRareId: pool.id
      };
    }
  };
}

const roundTripRoute = plans.buildRoutePlan(switchingEngine(true),
  routeSnapshot([safePool, safePool]), [
    { column: 1, position: "5B", kind: "regular" },
    { column: 0, position: "10A", kind: "regular" }
  ]);
assert.strictEqual(roundTripRoute.valid, true,
  "a 5B checkpoint is compatible when rerolls later return to the 10A track");
assert(roundTripRoute.auto.some((step) =>
  step.position === "2A" && step.kind === "reroll"));
assert(roundTripRoute.auto.some((step) =>
  step.position === "7B" && step.kind === "reroll"));
assert(roundTripRoute.destinations.some((step) => step.position === "3B"));
assert(roundTripRoute.destinations.some((step) => step.position === "9A"));

const contradictoryRoute = plans.buildRoutePlan(switchingEngine(false),
  routeSnapshot([safePool, safePool]), [
    { column: 1, position: "5B", kind: "regular" },
    { column: 0, position: "10A", kind: "regular" }
  ]);
assert.strictEqual(contradictoryRoute.valid, false,
  "a middle checkpoint is rejected when the later saved choice cannot be reached");

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
