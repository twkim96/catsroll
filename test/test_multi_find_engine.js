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
// ticket result costs +2 and only wins when the primary destination improves.
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
assert.strictEqual(result.cost, 2);
assert.strictEqual(result.ticketUses, 1);
assert.strictEqual(result.actions[0].type, "ticket");

result = search({
  targets: [{cat_id: 200, allow_ticket: false}]
});
assert.strictEqual(result.status, "impossible");

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
assert.strictEqual(result.cost, 2,
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
// masquerade as an ordinary rare-ticket event, and both retain a +2 base cost.
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
assert.strictEqual(result.cost, 4);
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
assert.strictEqual(result.rawCost, -1.98);
assert.strictEqual(result.cost, 0,
  "balanced score is floored at zero to avoid farming negative cost");

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
        costUnits: state.costUnits + 200,
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
