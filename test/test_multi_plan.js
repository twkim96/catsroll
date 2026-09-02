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
assert.strictEqual(plans.summarizeCats([
  { id: 101, name: "가시루가", rarity: 4 },
  { id: 303, name: "한정 슈퍼레어", rarity: 3 },
  { id: 304, name: "정규 슈퍼레어", rarity: 3 }
], [303]), "가시루가, 한정 슈퍼레어",
"only Find-eligible non-regular super rares join the plan summary");
assert.deepStrictEqual(plans.catSummaryEntries([
  { id: 101, name: "가시루가", rarity: 4 },
  { id: 101, name: "가시루가", rarity: 4, guaranteed: true },
  { id: 202, name: "레전드 냥코", rarity: 5 }
]), [
  { id: 101, name: "가시루가", rarity: 4, count: 2 },
  { id: 202, name: "레전드 냥코", rarity: 5, count: 1 }
], "the expanded selected-cat view retains rarity and duplicate counts");
assert.deepStrictEqual(plans.normalizeTargetCatIds([
  101, "202", 101, null, -1, "invalid"
]), [101, 202], "plan target badges use unique valid character IDs");
assert.deepStrictEqual(plans.missingTargetCats([
  { id: 303, name: "한정 슈퍼레어", rarity: 3 },
  { id: 101, name: "가시루가", rarity: 4 },
  { id: 102, name: "바라라가", rarity: 4 },
  { id: 202, name: "레전드 냥코", rarity: 5 },
  { id: 303, name: "중복 목표", rarity: 3 }
], [
  { id: 101, name: "가시루가", rarity: 4, count: 1 }
]), [
  { id: 202, name: "레전드 냥코", rarity: 5 },
  { id: 102, name: "바라라가", rarity: 4 },
  { id: 303, name: "한정 슈퍼레어", rarity: 3 }
], "unacquired Find targets stay in one section sorted by rarity then name");

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
assert(plans.planLogEntries(
  routeSnapshot([unsafePool, safePool]), defendedRoute, [], [])
  .some((line) => /5A .*R 방어를 위해/.test(line)),
"the detailed plan route explains a banner choice that prevents an R switch");

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
assert.deepStrictEqual(plans.routeResourceUsage(
  routeSnapshot([unsafePool]), guaranteedRoute, [
    { column: 0, position: "1A", kind: "guaranteed" }
  ]), { guaranteedPulls: 1, specialTickets: 0 },
"guaranteed draws are reported separately from special tickets");
assert.deepStrictEqual(plans.planLogEntries(
  routeSnapshot([unsafePool]), guaranteedRoute, [
    { column: 0, position: "1A", kind: "guaranteed" }
  ], [999]), [
    "1A~1AG · 배너 1 · 확뽑 · 확정 울슈레 @ 1AG 획득 [목표] [선택] → 11B"
  ], "the detailed plan route keeps both target and selected badges on one pull");

const repeatedTargetRoute = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([safePool]), [
    { column: 0, position: "2A", kind: "regular" },
    { column: 0, position: "4A", kind: "regular" }
  ]);
const repeatedTargetEntries = plans.planRouteEntries(
  routeSnapshot([safePool]), repeatedTargetRoute, [], [safePool.id]);
const repeatedSelected = repeatedTargetEntries.filter((entry) =>
  entry.position === "2A" || entry.position === "4A");
assert.strictEqual(repeatedSelected.length, 2);
assert(repeatedSelected.every((entry) => entry.segments.some((segment) =>
  segment.cat && segment.target && segment.selected)),
"the same target cat selected at different coordinates keeps both badges each time");

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

const orphanedAfterGuaranteedRemoval = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([safePool]), [
    { column: 0, position: "13B", kind: "regular" },
    { column: 0, position: "14B", kind: "regular" },
    { column: 0, position: "15A", kind: "regular" }
  ], { pruneInvalid: true });
assert.strictEqual(orphanedAfterGuaranteedRemoval.valid, true);
assert.deepStrictEqual(orphanedAfterGuaranteedRemoval.pruned, [
  { column: 0, position: "13B", kind: "regular" },
  { column: 0, position: "14B", kind: "regular" }
], "removing a guaranteed switch prunes only unreachable downstream B marks");
assert(orphanedAfterGuaranteedRemoval.auto.some((step) =>
  step.position === "14A"),
"a later A mark that remains reachable survives orphan cleanup");

const contradictoryWithoutCleanup = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([safePool]), [
    { column: 0, position: "13B", kind: "regular" },
    { column: 0, position: "15A", kind: "regular" }
  ]);
assert.strictEqual(contradictoryWithoutCleanup.valid, false,
  "ordinary selection still fails closed unless cleanup is explicitly requested");

const rerollRoute = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([unsafePool]), [
    { column: 0, position: "5A", kind: "reroll" }
  ]);
assert.strictEqual(rerollRoute.valid, true);
assert.deepStrictEqual(rerollRoute.destinations, [
  { column: 0, position: "6B", kind: "reroll" }
], "choosing the R line marks its next-track destination");
assert.deepStrictEqual(plans.planLogEntries(
  routeSnapshot([unsafePool]), rerollRoute, [
    { column: 0, position: "5A", kind: "reroll" }
  ], []), [
    "1A~4A · 레어티켓 4회 → 5A",
    "5A · 배너 1 · R 열변경 (중복 레어 → 중복 레어 [선택]) → 6B"
  ], "the detailed plan route includes ticket runs and a selected R switch");

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
assert.strictEqual(middleOverride.costUnits, 20,
  "plan routes use the same 0.02 regular-draw cost units as Find");

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
assert.strictEqual(minimumCostRoute.costUnits, 8);

const automaticSpecialBlocked = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([unsafePool, specialPool]), [
    { column: 0, position: "10A", kind: "regular" }
  ]);
assert.strictEqual(automaticSpecialBlocked.valid, false,
  "plan autofill never inserts a platinum or legend ticket on its own");

const automaticSpecialHintRoute = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([unsafePool, specialPool]), [
    { column: 0, position: "10A", kind: "regular" }
  ], { allowAutomaticSpecial: true });
assert.strictEqual(automaticSpecialHintRoute.valid, true,
  "a separate hint search may inspect a special-ticket defense");
assert(automaticSpecialHintRoute.auto.some((step) =>
  step.position === "5A" && step.column === 1));
assert.strictEqual(plans.specialTicketRouteHint(
  routeSnapshot([unsafePool, specialPool]), automaticSpecialHintRoute),
"5A 구간에서 특수뽑기 시 도달 가능");

const explicitlySelectedSpecial = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([unsafePool, specialPool]), [
    { column: 1, position: "5A", kind: "regular" },
    { column: 0, position: "10A", kind: "regular" }
  ]);
assert.strictEqual(explicitlySelectedSpecial.valid, true,
  "an explicitly selected special-ticket cell remains a valid route step");
assert(!explicitlySelectedSpecial.auto.some((step) => step.column === 1),
  "the selected special-ticket step is not disguised as automatic fill");
assert.strictEqual(explicitlySelectedSpecial.costUnits, 118,
  "a manually selected platinum ticket has a cost weight of 1");
assert.deepStrictEqual(plans.routeResourceUsage(
  routeSnapshot([unsafePool, specialPool]), explicitlySelectedSpecial, [
    { column: 1, position: "5A", kind: "regular" },
    { column: 0, position: "10A", kind: "regular" }
  ]), { guaranteedPulls: 0, specialTickets: 1 },
"an explicitly selected platinum draw consumes one special ticket");
assert.deepStrictEqual(plans.planLogEntries(
  routeSnapshot([unsafePool, specialPool]), explicitlySelectedSpecial, [
    { column: 1, position: "5A", kind: "regular" },
    { column: 0, position: "10A", kind: "regular" }
  ], []), [
    "1A~4A · 레어티켓 4회 → 5A",
    "5A · 배너 2 · 플래티넘 티켓 · 안전 레어 [선택] → 6A",
    "6A~9A · 레어티켓 4회 → 10A",
    "10A · 배너 1 · 중복 레어 [선택] → 11A"
  ], "the detailed plan route includes special tickets and selected checkpoints");
assert.strictEqual(plans.planProgressSummary(
  routeSnapshot([unsafePool, specialPool]), {
    valid: true,
    auto: new Array(34).fill({ column: 0, position: "1A", kind: "regular" }),
    selections: [
      { column: 0, position: "1A", kind: "guaranteed" },
      { column: 0, position: "12B", kind: "guaranteed" }
    ]
  }, [
    { column: 0, position: "1A", kind: "guaranteed" },
    { column: 0, position: "12B", kind: "guaranteed" },
    { column: 1, position: "20A", kind: "regular" }
  ]),
"강조 좌표 3개 · 자동 경로 34칸 · 확정뽑기 2회 · 특수티켓 1회",
"the plan status includes both kinds of paid resource usage");

const legendPool = Object.assign({}, specialPool, {
  key: "legend", platinum: "legend"
});
assert.strictEqual(plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([unsafePool, legendPool]), [
    { column: 0, position: "10A", kind: "regular" }
  ]).valid, false, "legend tickets are excluded from automatic fill too");
const explicitlySelectedLegend = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([unsafePool, legendPool]), [
    { column: 1, position: "5A", kind: "regular" },
    { column: 0, position: "10A", kind: "regular" }
  ]);
assert.strictEqual(explicitlySelectedLegend.valid, true,
  "an explicitly selected legend-ticket cell remains valid");
assert.strictEqual(explicitlySelectedLegend.costUnits, 218,
  "legend tickets retain their cost weight of 2");

const orphanedAfterSpecialRemoval = plans.buildRoutePlan(fakeRouteEngine,
  routeSnapshot([unsafePool, specialPool]), [
    { column: 0, position: "10A", kind: "regular" }
  ], { pruneInvalid: true });
assert.strictEqual(orphanedAfterSpecialRemoval.valid, true);
assert.deepStrictEqual(orphanedAfterSpecialRemoval.pruned, [
  { column: 0, position: "10A", kind: "regular" }
], "removing a manual special-ticket defense prunes its unreachable target");

assert.strictEqual(plans.specialTicketRouteHint(
  routeSnapshot([unsafePool, safePool]), defendedRoute), "",
"ordinary banners with different pools remain valid defenses without a special hint");

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
