"use strict";

const assert = require("assert");
const TrackEngine = require(
  "../lib/battle-cats-rolls/asset/track-engine.js").TrackEngine;
const FindEngine = require(
  "../lib/battle-cats-rolls/asset/multi-find-engine.js");

function pool(options) {
  const opts = options || {};
  const slots = opts.slots || {
    2: [1, 2, 1, 3],
    3: [10, 11],
    4: [100, 101, 102],
    5: [200]
  };
  const cats = {};
  Object.keys(slots).forEach((rarity) => {
    slots[rarity].forEach((id) => {
      cats[id] = cats[id] || {name: [`Cat ${id}`], rarity: Number(rarity)};
    });
  });
  return {
    exist: true,
    base: 10000,
    platinum: opts.platinum || false,
    rates: opts.rates || {rare: 7000, supa: 2000, uber: 900, legend: 100},
    guaranteed_rolls: opts.guaranteedRolls == null ? 11 : opts.guaranteedRolls,
    slots,
    cats
  };
}

function actualFirst(track, last) {
  const rolled = track.cats[0][0];
  if (last && rolled.id === last && rolled.rerolled) return rolled.rerolled;
  return rolled;
}

// The isolated transition engine must stay byte-for-byte aligned with the
// existing client Gacha implementation for ordinary, hidden-R, and G results.
[1, 42, 2390649859, 3671843074, 4275004160].forEach((seed) => {
  const eventPool = pool();
  const first = FindEngine.simulateRegular(eventPool, seed, 0, 0, 0);
  [0, first.originalId].forEach((last) => {
    const simulated = FindEngine.simulateRegular(eventPool, seed, 0, last, 0);
    const track = TrackEngine.buildTracks(eventPool, seed, {
      count: 40,
      last,
      guaranteedRolls: 11,
      findCat: false
    });
    const actual = actualFirst(track, last);
    assert.strictEqual(simulated.id, actual.id, `regular id seed=${seed} last=${last}`);
    assert.strictEqual(simulated.resultLabel, actual.number(),
      `regular label seed=${seed} last=${last}`);
    assert.strictEqual(simulated.next, actual.next.number().replace(/R/g, ""),
      `regular next seed=${seed} last=${last}`);

    const guaranteed = FindEngine.simulateGuaranteed(
      eventPool, seed, 0, last, 200, 0);
    assert(actual.guaranteed, `guaranteed exists seed=${seed} last=${last}`);
    assert.strictEqual(guaranteed.pulls[10].id, actual.guaranteed.id,
      `guaranteed id seed=${seed} last=${last}`);
    assert.strictEqual(guaranteed.guaranteedLabel, actual.guaranteed.number(),
      `guaranteed label seed=${seed} last=${last}`);
    assert.strictEqual(guaranteed.next, actual.guaranteed.next.number(),
      `guaranteed next seed=${seed} last=${last}`);
  });
});

const eventUber = pool({
  rates: {rare: 0, supa: 0, uber: 10000, legend: 0},
  guaranteedRolls: 0,
  slots: {2: [], 3: [], 4: [100], 5: []}
});
const platinum = pool({
  platinum: "platinum",
  rates: {rare: 0, supa: 0, uber: 10000, legend: 0},
  guaranteedRolls: 0,
  slots: {2: [], 3: [], 4: [100, 200], 5: []}
});

function search(overrides) {
  return FindEngine.search(Object.assign({
    seed: 1,
    count: 50,
    last: 0,
    optimization: "distance",
    maxPlatinum: 3,
    maxGuaranteed: 0,
    events: [{lang: "kr", event: "event", label: "Event", pool: eventUber}],
    ticket: {event: "platinum", label: "Platinum", pool: platinum},
    targets: [{cat_id: 100, allow_ticket: true}]
  }, overrides || {}));
}

// A platinum-allowed target is still satisfied by an event result first; the
// ticket result costs +1 and only wins when the primary destination improves.
let result = search();
assert.strictEqual(result.status, "success");
assert.strictEqual(result.cost, 0.02);
assert.strictEqual(result.regularUses, 1);
assert.strictEqual(result.ticketUses, 0);
assert.strictEqual(result.actions[0].type, "roll");

result = search({
  events: [{lang: "kr", event: "event", label: "Event", pool: eventUber}],
  targets: [{cat_id: 200, allow_ticket: true}]
});
assert.strictEqual(result.status, "success");
assert.strictEqual(result.cost, 1);
assert.strictEqual(result.ticketUses, 1);
assert.strictEqual(result.actions[0].type, "ticket");
assert.strictEqual(result.actions[0].cost, 1);

result = search({
  targets: [{cat_id: 200, allow_ticket: false}]
});
assert.strictEqual(result.status, "impossible");

const limitedRare = pool({
  rates: {rare: 10000, supa: 0, uber: 0, legend: 0},
  guaranteedRolls: 0,
  slots: {2: [777], 3: [], 4: [], 5: []}
});
result = search({
  maxPlatinum: 0,
  events: [{lang: "kr", event: "rare", label: "Rare", pool: limitedRare}],
  ticket: null,
  targets: [{cat_id: 777, allow_ticket: false}]
});
assert.strictEqual(result.status, "success",
  "non-regular rare targets pass preflight and can be found");
assert.strictEqual(result.actions[0].catId, 777);
assert.strictEqual(result.actions[0].rarity, FindEngine.RARE);

const rerolledRare = pool({
  rates: {rare: 10000, supa: 0, uber: 0, legend: 0},
  guaranteedRolls: 0,
  slots: {2: [1, 2], 3: [], 4: [], 5: []}
});
const rerolledTarget = FindEngine.simulateRegular(rerolledRare, 2, 0, 1, 0);
assert.strictEqual(rerolledTarget.originalId, 1);
assert.strictEqual(rerolledTarget.id, 2);
assert.strictEqual(rerolledTarget.rerolled, true);
result = search({
  seed: 2,
  count: 1,
  last: 1,
  maxPlatinum: 0,
  events: [{lang: "kr", event: "rare-r", label: "Rare R", pool: rerolledRare}],
  ticket: null,
  targets: [{cat_id: 1, allow_ticket: false}]
});
assert.strictEqual(result.status, "impossible",
  "a duplicated rare target is not credited when the actual result rerolls away");

const earlySchedulePool = pool({
  rates: {rare: 0, supa: 0, uber: 10000, legend: 0},
  guaranteedRolls: 0,
  slots: {2: [], 3: [], 4: [100, 900], 5: []}
});
const lateSchedulePool = pool({
  rates: {rare: 0, supa: 0, uber: 10000, legend: 0},
  guaranteedRolls: 0,
  slots: {2: [], 3: [], 4: [901, 200], 5: []}
});
function scheduleSearch(scheduleAware, earlyEnd) {
  return search({
    seed: 4,
    count: 2,
    optimization: "distance",
    maxPlatinum: 0,
    maxLegendTicket: 0,
    maxGuaranteed: 0,
    scheduleAware: scheduleAware,
    events: [
      {lang: "kr", event: "early", label: "Early",
        start_on: "2026-09-14", end_on: earlyEnd, pool: earlySchedulePool},
      {lang: "kr", event: "late", label: "Late",
        start_on: "2026-09-18", end_on: "2026-09-22", pool: lateSchedulePool}
    ],
    ticket: null,
    targets: [
      {cat_id: 100, allow_ticket: false},
      {cat_id: 200, allow_ticket: false}
    ]
  });
}
result = scheduleSearch(false, "2026-09-18");
assert.strictEqual(result.status, "success");
assert.deepStrictEqual(result.actions.map((action) => action.event), ["late", "early"],
  "free schedule search may look at future and earlier banners in either order");
result = scheduleSearch(true, "2026-09-18");
assert.strictEqual(result.status, "impossible",
  "same-day end/start boundaries do not overlap in sequential schedule mode");
result = scheduleSearch(true, "2026-09-19");
assert.strictEqual(result.status, "success");
assert.deepStrictEqual(result.actions.map((action) => action.event), ["late", "early"],
  "banners with at least one real overlapping date may still be mixed");
assert(result.actions.every((action) => action.scheduleDay != null &&
  action.scheduleStartDay != null && action.scheduleEndDay != null),
"schedule-aware actions carry their resolved day and banner window for route drawing");
result = search({
  seed: 4,
  count: 2,
  optimization: "distance",
  maxPlatinum: 0,
  maxLegendTicket: 0,
  maxGuaranteed: 0,
  scheduleAware: true,
  events: [{lang: "kr", event: "undated", label: "Undated",
    pool: earlySchedulePool}],
  ticket: null,
  targets: [{cat_id: 100, allow_ticket: false}]
});
assert.strictEqual(result.status, "impossible",
  "schedule-aware search fails closed when a banner has no usable date window");

const eventLater = pool({
  rates: {rare: 0, supa: 0, uber: 10000, legend: 0},
  guaranteedRolls: 0,
  slots: {2: [], 3: [], 4: [100, 200], 5: []}
});
const ticketNow = pool({
  platinum: "platinum",
  rates: {rare: 0, supa: 0, uber: 10000, legend: 0},
  guaranteedRolls: 0,
  slots: {2: [], 3: [], 4: [200], 5: []}
});
let closerSeed = 1;
for (; closerSeed < 100000; closerSeed += 1) {
  const first = FindEngine.simulateRegular(eventLater, closerSeed, 0, 0, 0);
  const second = FindEngine.simulateRegular(
    eventLater, closerSeed, first.nextOffset, first.lastRareId, 0);
  if (first.id !== 200 && second.id === 200) break;
}
result = search({
  seed: closerSeed,
  events: [{lang: "kr", event: "later", label: "Later", pool: eventLater}],
  ticket: {event: "ticket", label: "Ticket", pool: ticketNow},
  targets: [{cat_id: 200, allow_ticket: true}]
});
assert.strictEqual(result.status, "success");
assert.strictEqual(result.actions[0].type, "ticket");
assert.strictEqual(result.cost, 1,
  "a closer platinum result beats a farther low-cost event result");

result = search({
  seed: closerSeed,
  optimization: "cost",
  events: [{lang: "kr", event: "later", label: "Later", pool: eventLater}],
  ticket: {event: "ticket", label: "Ticket", pool: ticketNow},
  targets: [{cat_id: 200, allow_ticket: true}]
});
assert.strictEqual(result.status, "success");
assert.strictEqual(result.actions[0].type, "roll");
assert.strictEqual(result.ticketUses, 0);
assert.strictEqual(result.regularUses, 2);
assert.strictEqual(result.cost, 0.04,
  "minimum-cost mode prefers a farther event result over platinum");

result = search({
  seed: closerSeed,
  optimization: undefined,
  events: [{lang: "kr", event: "later", label: "Later", pool: eventLater}],
  ticket: {event: "ticket", label: "Ticket", pool: ticketNow},
  targets: [{cat_id: 200, allow_ticket: true}]
});
assert.strictEqual(result.actions[0].type, "roll",
  "minimum cost is the engine default");

result = search({
  maxPlatinum: 0,
  events: [{lang: "kr", event: "event", label: "Event", pool: eventUber}],
  targets: [{cat_id: 200, allow_ticket: true}]
});
assert.strictEqual(result.status, "impossible",
  "the platinum maximum is an actual usage limit");

// Platinum and legend-ticket banners are separate paid resources. Neither can
// masquerade as an ordinary rare-ticket event; platinum costs +1, legend +2.
const legendTicket = pool({
  platinum: "legend",
  rates: {rare: 0, supa: 0, uber: 0, legend: 10000},
  guaranteedRolls: 0,
  slots: {2: [], 3: [], 4: [], 5: [400]}
});
result = search({
  maxPlatinum: 0,
  maxLegendTicket: 0,
  events: [{lang: "kr", event: "pt-as-event", label: "PT", pool: platinum}],
  ticket: null,
  targets: [{cat_id: 100, allow_ticket: false}]
});
assert.strictEqual(result.status, "impossible",
  "a platinum banner is never treated as a regular rare-ticket event");

result = search({
  maxPlatinum: 0,
  maxLegendTicket: 1,
  tickets: [{
    lang: "kr", event: "legend-ticket", kind: "legend",
    label: "Legend Ticket", pool: legendTicket
  }],
  targets: [{cat_id: 400, allow_ticket: true}]
});
assert.strictEqual(result.status, "success");
assert.strictEqual(result.cost, 2);
assert.strictEqual(result.platinumUses, 0);
assert.strictEqual(result.legendTicketUses, 1);
assert.strictEqual(result.actions[0].ticketKind, "legend");
assert.strictEqual(result.actions[0].cost, 2);

result = search({
  maxPlatinum: 1,
  maxLegendTicket: 1,
  tickets: [
    {lang: "kr", event: "pt", kind: "platinum", label: "PT", pool: platinum},
    {lang: "kr", event: "lt", kind: "legend", label: "LT", pool: legendTicket}
  ],
  targets: [
    {cat_id: 200, allow_ticket: true},
    {cat_id: 400, allow_ticket: true}
  ]
});
assert.strictEqual(result.status, "success");
assert.strictEqual(result.cost, 3);
assert.strictEqual(result.baseCost, 3);
assert.strictEqual(result.ticketUses, 2);
assert.strictEqual(result.platinumUses, 1);
assert.strictEqual(result.legendTicketUses, 1);

const guaranteedPool = pool({
  rates: {rare: 10000, supa: 0, uber: 0, legend: 0},
  guaranteedRolls: 11,
  slots: {2: [1, 2, 3], 3: [], 4: [300], 5: []}
});
result = search({
  count: 30,
  maxPlatinum: 0,
  maxGuaranteed: 1,
  events: [{lang: "kr", event: "g", label: "Guaranteed", pool: guaranteedPool}],
  ticket: null,
  targets: [{cat_id: 300, allow_ticket: false}]
});
assert.strictEqual(result.status, "success");
assert.strictEqual(result.cost, 1);
assert.strictEqual(result.guaranteedUses, 1);
assert(result.actions.some((action) => action.type === "guaranteed"));
const guaranteedAction = result.actions.find((action) => action.type === "guaranteed");
assert.strictEqual(guaranteedAction.routePulls.length, 11);
assert.strictEqual(guaranteedAction.routePulls[10].guaranteed, true);
assert.strictEqual(guaranteedAction.routePulls[10].resultLabel,
  guaranteedAction.guaranteedLabel);

result = search({
  count: 30,
  optimization: "balance",
  maxPlatinum: 0,
  maxGuaranteed: 1,
  events: [{lang: "kr", event: "g", label: "Guaranteed", pool: guaranteedPool}],
  ticket: null,
  targets: [{cat_id: 300, allow_ticket: false}]
});
assert.strictEqual(result.status, "success");
assert.strictEqual(result.baseCost, 1);
assert.strictEqual(result.uberDraws, 1);
assert.strictEqual(result.balanceCredit, 0.14);
assert.strictEqual(result.cost, 0.86);

const legendTargetPool = pool({
  rates: {rare: 0, supa: 0, uber: 0, legend: 10000},
  guaranteedRolls: 0,
  slots: {2: [], 3: [], 4: [], 5: [400]}
});
result = search({
  optimization: "balance",
  maxPlatinum: 0,
  events: [{lang: "kr", event: "legend", label: "Legend", pool: legendTargetPool}],
  ticket: null,
  targets: [{cat_id: 400, allow_ticket: false}]
});
assert.strictEqual(result.status, "success");
assert.strictEqual(result.legendDraws, 1);
assert.strictEqual(result.balanceCredit, 0.14,
  "legend rares use the same greedy credit as ubers");
assert.strictEqual(result.rawCost, -0.12);
assert.strictEqual(result.cost, 0,
  "balanced score is floored at zero to avoid farming negative cost");

const balanceSupaPool = pool({
  rates: {rare: 0, supa: 10000, uber: 0, legend: 0},
  guaranteedRolls: 0,
  slots: {2: [], 3: [700], 4: [], 5: []}
});
const balanceUberPool = pool({
  rates: {rare: 0, supa: 0, uber: 10000, legend: 0},
  guaranteedRolls: 0,
  slots: {2: [], 3: [], 4: [800], 5: []}
});
const balanceDelayedTargetPool = pool({
  rates: {rare: 0, supa: 10000, uber: 0, legend: 0},
  guaranteedRolls: 0,
  slots: {2: [], 3: [500, 501], 4: [], 5: []}
});
const balanceBase = {
  seed: 5,
  count: 5,
  optimization: "balance",
  maxPlatinum: 0,
  maxLegendTicket: 0,
  maxGuaranteed: 0,
  ticket: null,
  targets: [{cat_id: 501, allow_ticket: false}]
};
const balanceSupaFirst = search(Object.assign({}, balanceBase, {
  events: [
    {lang: "kr", event: "supa", label: "Supa", pool: balanceSupaPool},
    {lang: "kr", event: "uber", label: "Uber", pool: balanceUberPool},
    {lang: "kr", event: "target", label: "Target", pool: balanceDelayedTargetPool}
  ]
}));
const balanceUberFirst = search(Object.assign({}, balanceBase, {
  events: [
    {lang: "kr", event: "uber", label: "Uber", pool: balanceUberPool},
    {lang: "kr", event: "supa", label: "Supa", pool: balanceSupaPool},
    {lang: "kr", event: "target", label: "Target", pool: balanceDelayedTargetPool}
  ]
}));
assert.strictEqual(balanceSupaFirst.status, "success");
assert.strictEqual(balanceUberFirst.status, "success");
assert.strictEqual(balanceSupaFirst.rawCost, -0.1);
assert.strictEqual(balanceUberFirst.rawCost, -0.1,
  "greedy equivalent-state dedupe must not depend on banner order");
assert.strictEqual(balanceSupaFirst.actions[0].event, "uber");
assert.strictEqual(balanceUberFirst.actions[0].event, "uber");

const balanceGuaranteedUberIds = Array.from({length: 20}, (_, index) => 900 + index);
const balanceGuaranteedSupaPool = pool({
  rates: {rare: 0, supa: 10000, uber: 0, legend: 0},
  guaranteedRolls: 11,
  slots: {2: [], 3: [700], 4: balanceGuaranteedUberIds, 5: []}
});
const balanceGuaranteedUberPool = pool({
  rates: {rare: 0, supa: 0, uber: 10000, legend: 0},
  guaranteedRolls: 11,
  slots: {2: [], 3: [], 4: balanceGuaranteedUberIds, 5: []}
});
const balanceGuaranteedBase = {
  seed: 5,
  count: 11,
  optimization: "balance",
  maxPlatinum: 0,
  maxLegendTicket: 0,
  maxGuaranteed: 1,
  ticket: null,
  targets: [{cat_id: 900, allow_ticket: false}]
};
const balanceGuaranteedSupaFirst = search(Object.assign({}, balanceGuaranteedBase, {
  events: [
    {lang: "kr", event: "g-supa", label: "G Supa", pool: balanceGuaranteedSupaPool},
    {lang: "kr", event: "g-uber", label: "G Uber", pool: balanceGuaranteedUberPool}
  ]
}));
const balanceGuaranteedUberFirst = search(Object.assign({}, balanceGuaranteedBase, {
  events: [
    {lang: "kr", event: "g-uber", label: "G Uber", pool: balanceGuaranteedUberPool},
    {lang: "kr", event: "g-supa", label: "G Supa", pool: balanceGuaranteedSupaPool}
  ]
}));
assert.strictEqual(balanceGuaranteedSupaFirst.status, "success");
assert.strictEqual(balanceGuaranteedUberFirst.status, "success");
assert.strictEqual(balanceGuaranteedSupaFirst.actions[0].event, "g-uber");
assert.strictEqual(balanceGuaranteedUberFirst.actions[0].event, "g-uber",
  "greedy guaranteed dedupe must not depend on banner order");
assert.strictEqual(balanceGuaranteedSupaFirst.uberDraws, 11);
assert.strictEqual(balanceGuaranteedUberFirst.rawCost, -0.54);

const paretoTargetPool = pool({
  rates: {rare: 0, supa: 0, uber: 10000, legend: 0},
  guaranteedRolls: 0,
  slots: {2: [], 3: [], 4: [500], 5: []}
});
const paretoHarvestPool = pool({
  rates: {rare: 0, supa: 0, uber: 10000, legend: 0},
  guaranteedRolls: 0,
  slots: {2: [], 3: [], 4: [900], 5: []}
});
result = search({
  count: 20,
  optimization: "pareto",
  maxPlatinum: 0,
  maxLegendTicket: 0,
  maxGuaranteed: 0,
  events: [
    {lang: "kr", event: "target", label: "Target", pool: paretoTargetPool},
    {lang: "kr", event: "harvest", label: "Harvest", pool: paretoHarvestPool}
  ],
  ticket: null,
  targets: [{cat_id: 500, allow_ticket: false}]
});
assert.strictEqual(result.status, "success");
assert.strictEqual(result.optimization, "pareto");
assert.strictEqual(result.paretoBaseCost, 0.02);
assert.strictEqual(result.paretoAllowance, 0.2);
assert.strictEqual(result.paretoBudget, 0.22);
assert.strictEqual(result.cost, 0.22);
assert(result.paretoFirstPassExplored > 0,
  "pareto first computes the minimum-cost baseline");
assert(result.paretoSecondPassExplored > 0,
  "pareto then runs a budget-constrained harvest pass");
assert.strictEqual(result.explored,
  result.paretoFirstPassExplored + result.paretoSecondPassExplored,
  "pareto reports the combined work of both passes");
assert.strictEqual(result.harvestDraws, 10,
  "pareto spends only its allowed budget to maximize non-target high-rarity pulls");
assert.strictEqual(result.actions[result.actions.length - 1].catId, 500,
  "the target pull completes the route and is excluded from harvest scoring");
assert.strictEqual(result.actions.filter((action) => action.harvestDraws).length, 10);

const paretoLegendTarget = pool({
  platinum: "legend",
  rates: {rare: 0, supa: 0, uber: 10000, legend: 0},
  guaranteedRolls: 0,
  slots: {2: [], 3: [], 4: [501], 5: []}
});
result = search({
  count: 30,
  optimization: "pareto",
  maxPlatinum: 0,
  maxLegendTicket: 1,
  maxGuaranteed: 0,
  events: [{lang: "kr", event: "harvest", label: "Harvest",
    pool: paretoHarvestPool}],
  tickets: [{event: "legend-target", label: "Legend target", kind: "legend",
    pool: paretoLegendTarget}],
  targets: [{cat_id: 501, allow_ticket: true}]
});
assert.strictEqual(result.status, "success");
assert.strictEqual(result.paretoBaseCost, 2);
assert.strictEqual(result.paretoAllowance, 0.3,
  "pareto uses 15% once it exceeds the 0.2 minimum allowance");
assert.strictEqual(result.paretoBudget, 2.3);
assert.strictEqual(result.cost, 2.3);
assert(result.paretoSecondPassExplored <= 400000,
  "pareto harvest pass stays under its dedicated safety limit");
assert.strictEqual(result.harvestDraws, 15);

const duplicateRarePool = pool({
  rates: {rare: 10000, supa: 0, uber: 0, legend: 0},
  guaranteedRolls: 0,
  slots: {2: [1], 3: [], 4: [], 5: []}
});
const safeSupaPool = pool({
  rates: {rare: 0, supa: 10000, uber: 0, legend: 0},
  guaranteedRolls: 0,
  slots: {2: [], 3: [10], 4: [], 5: []}
});
result = search({
  count: 4,
  last: 1,
  maxPlatinum: 0,
  events: [
    {lang: "kr", event: "risk", label: "Risk", pool: duplicateRarePool},
    {lang: "kr", event: "safe", label: "Safe", pool: safeSupaPool}
  ],
  ticket: null,
  targets: [{cat_id: 10, allow_ticket: false}]
});
assert.strictEqual(result.status, "success");
assert.strictEqual(result.actions[0].event, "safe");
assert.strictEqual(result.actions[0].avoidedR, true,
  "a safe banner is marked when another selected banner would trigger R");

result = search({
  count: 4,
  last: 1,
  maxPlatinum: 0,
  events: [{lang: "kr", event: "safe", label: "Safe", pool: safeSupaPool}],
  ticket: null,
  targets: [{cat_id: 10, allow_ticket: false}]
});
assert.strictEqual(result.actions[0].avoidedR, false,
  "a single banner does not show a comparison-based R defense");

const targetA = pool({
  rates: {rare: 0, supa: 10000, uber: 0, legend: 0},
  guaranteedRolls: 11,
  slots: {2: [], 3: [10], 4: [100], 5: []}
});
const targetB = pool({
  rates: {rare: 0, supa: 10000, uber: 0, legend: 0},
  guaranteedRolls: 11,
  slots: {2: [], 3: [200], 4: [100], 5: []}
});
result = search({
  count: 30,
  maxPlatinum: 0,
  maxGuaranteed: 1,
  events: [
    {lang: "kr", event: "a", label: "A", pool: targetA},
    {lang: "kr", event: "b", label: "B", pool: targetB}
  ],
  ticket: null,
  targets: [
    {cat_id: 100, allow_ticket: false},
    {cat_id: 200, allow_ticket: false}
  ]
});
assert.strictEqual(result.status, "success");
assert.strictEqual(result.actions[0].event, "b",
  "all selected cats are required and the route must collect both");

result = search({
  events: [
    {lang: "kr", event: "kr", label: "KR", pool: eventUber},
    {lang: "jp", event: "jp", label: "JP", pool: eventUber}
  ]
});
assert.strictEqual(result.status, "invalid");

// Compare the optimized search with a small exhaustive search that permits a
// platinum ticket at every position. This guards the ticket-defense pruning
// and state dominance rules, including proactive defense of the first rare in
// a duplicate pair.
const exhaustiveEventA = pool({
  guaranteedRolls: 0,
  slots: {2: [1, 2, 1, 3], 3: [10, 11], 4: [100, 101], 5: []}
});
const exhaustiveEventB = pool({
  guaranteedRolls: 0,
  slots: {2: [3, 1, 2, 1], 3: [11, 10], 4: [101, 100], 5: []}
});
const exhaustiveTicket = pool({
  platinum: "platinum",
  rates: {rare: 0, supa: 0, uber: 10000, legend: 0},
  guaranteedRolls: 0,
  slots: {2: [], 3: [], 4: [100, 101], 5: []}
});

function exhaustive(seed, count, last, optimization) {
  const maxPlatinum = 2;
  const stack = [{offset: 0, last, mask: 0, costUnits: 0, ticketUsed: 0}];
  let best = null;
  const maxStart = count * 2 - 1;
  function consider(state) {
    if ((state.mask & 3) !== 3) return false;
    const candidate = {offset: state.offset, costUnits: state.costUnits};
    const betterDistance = !best || candidate.offset < best.offset ||
      (candidate.offset === best.offset && candidate.costUnits < best.costUnits);
    const betterCost = !best || candidate.costUnits < best.costUnits ||
      (candidate.costUnits === best.costUnits && candidate.offset < best.offset);
    if (optimization === "cost" ? betterCost : betterDistance) best = candidate;
    return true;
  }
  function eventMask(mask, id) {
    if (id === 100) mask |= 1;
    if (id === 10) mask |= 2;
    return mask;
  }
  while (stack.length) {
    const state = stack.pop();
    if (consider(state) || state.offset > maxStart) continue;
    [exhaustiveEventA, exhaustiveEventB].forEach((eventPool) => {
      const rolled = FindEngine.simulateRegular(
        eventPool, seed, state.offset, state.last, 0);
      stack.push({
        offset: rolled.nextOffset,
        last: rolled.lastRareId,
        mask: eventMask(state.mask, rolled.id),
        costUnits: state.costUnits + 2,
        ticketUsed: state.ticketUsed
      });
    });
    if (state.ticketUsed < maxPlatinum) {
      const ticketRoll = FindEngine.simulateRegular(
        exhaustiveTicket, seed, state.offset, state.last, 0);
      stack.push({
        offset: ticketRoll.nextOffset,
        last: 0,
        mask: ticketRoll.id === 100 ? state.mask | 1 : state.mask,
        costUnits: state.costUnits + 100,
        ticketUsed: state.ticketUsed + 1
      });
    }
  }
  return best;
}

["distance", "cost"].forEach((optimization) => {
  for (let seed = 1; seed <= 120; seed += 1) {
    const last = seed % 2 ? 0 : 1;
    const expected = exhaustive(seed, 8, last, optimization);
    const optimized = FindEngine.search({
      seed,
      count: 8,
      last,
      optimization,
      maxPlatinum: 2,
      maxGuaranteed: 0,
      events: [
        {lang: "kr", event: "a", label: "A", pool: exhaustiveEventA},
        {lang: "kr", event: "b", label: "B", pool: exhaustiveEventB}
      ],
      ticket: {event: "pt", label: "PT", pool: exhaustiveTicket},
      targets: [
        {cat_id: 100, allow_ticket: true},
        {cat_id: 10, allow_ticket: false}
      ]
    });
    if (!expected) {
      assert.strictEqual(optimized.status, "impossible",
        `no-path parity mode=${optimization} seed=${seed}`);
      continue;
    }
    assert.strictEqual(optimized.status, "success",
      `optimized mode=${optimization} seed=${seed}`);
    assert.strictEqual(optimized.nextOffset, expected.offset,
      `destination parity mode=${optimization} seed=${seed}`);
    assert.strictEqual(optimized.costUnits, expected.costUnits,
      `cost parity mode=${optimization} seed=${seed}`);
  }
});

console.log("multi-find-engine: ok");
