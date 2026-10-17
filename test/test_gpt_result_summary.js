"use strict";

const assert = require("assert");
const summary = require("../lib/battle-cats-rolls/asset/gpt-result-summary.js");

function cat(id, position, next, options) {
  options = options || {};
  return {
    id,
    number: () => position,
    pickName: () => options.name || `Cat ${id}`,
    next: next ? {number: () => next} : null,
    rerolled: options.rerolled || null,
    guaranteed: options.guaranteed || null
  };
}

function outputLines(text, prefix) {
  return text.split("\n").filter(line => line.startsWith(prefix)).map(line =>
    JSON.parse(line.slice(prefix.length)));
}

function roll(index, start, next, extra) {
  return Object.assign({type: "roll", lang: "kr", event: "event-1",
    eventLabel: "Banner", scheduleDay: "2026-10-18", start, next,
    resultLabel: start, rarity: 2, catId: 1, catName: "Rare"}, extra || {});
}

// Full route preservation: 24 ordinary actions batch, then all eleven pulls
// and the target at the actual G result label remain present.
const routeActions = [];
for (let index = 0; index < 24; index++) {
  routeActions.push(roll(index, `${index + 1}A`, `${index + 2}A`));
}
const guaranteedPulls = Array.from({length: 10}, (_, index) => ({
  resultLabel: `${25 + index}A`, rerolled: false, guaranteed: false
}));
guaranteedPulls.push({resultLabel: "25AG", rerolled: false, guaranteed: true});
routeActions.push({type: "guaranteed", lang: "kr", event: "event-1",
  eventLabel: "Banner", scheduleDay: "2026-10-18", start: "25A",
  guaranteedLabel: "25AG", next: "35B", pulls: 11,
  routePulls: guaranteedPulls,
  acquired: [{targetIndex: 0, catId: 870, catName: "Goal", resultLabel: "25AG"}]});
const routeFind = {status: "success", message: null, destination: "35B",
  regularUses: 24, ticketUses: 0, guaranteedUses: 1, targetAcquired: 1,
  targetTotal: 1, optimization: "cost", cost: 1.48, rawCost: 1.48,
  baseCost: 1.48, regularUnitCost: 0.02, balanceCredit: 0,
  uberDraws: 0, actions: routeActions};
const routeInput = {
  track: {seed: 42, last: 0, count: 300, formIndex: 0,
    rows: [{lang: "kr", event: "event-1", ubers: 0}]},
  find: routeFind, findEnabled: true,
  findSettings: {optimization: "cost", targets: [{cat_id: 870, allow_ticket: false}]},
  plan: {enabled: true, name: "goal", marks: [], route: [], cats: [], progress: {}},
  dataVersion: "fixture-v1", outputs: []
};
const routeBefore = JSON.stringify(routeInput);
const routeText = summary.build(routeInput);
const routeLine = routeText.split("\n").find(line => line.startsWith("Find 계산: "));
assert.match(routeLine, /"status":"success"/);
const route = JSON.parse(routeLine.slice("Find 계산: ".length));
assert.equal(route.totalDraws, 35, "counts 24 rolls and eleven guaranteed pulls");
assert.equal(route.regularActions, 24);
assert.equal(route.guaranteedActions, 1);
assert.equal(route.actions.length, 2, "plain connected rolls are batched");
assert.deepEqual(route.actions[0], {
  type: "rollBatch", lang: "kr", event: "event-1", eventLabel: "Banner",
  scheduleDay: "2026-10-18", count: 24, start: "1A", next: "25A",
  actionStart: 1, actionEnd: 24
});
assert.equal(route.actions[1].guaranteedLabel, "25AG");
assert.equal(route.actions[1].pulls, 11);
assert.equal(route.actions[1].routePulls.length, 11);
assert.equal(route.actions[1].routePulls[10].resultLabel, "25AG");
assert.deepEqual(route.targetsAcquired[0], {actionIndex: 25, targetIndex: 0,
  catId: 870, catName: "Goal", resultLabel: "25AG", drawNumber: 35});
assert.equal(route.cost, 1.48);
assert.equal(route.rawCost, 1.48);
assert.equal(route.uberDraws, 0);
assert.match(routeText, /cost 계열은 엔진의 상대 비교 가중치이며 게임 재화가 아닙니다/);
assert.match(routeText, /uberDraws는 경로에서 얻은 울슈레 수/);
assert.match(routeText, /예상 배열 계산 상태: completed/);
assert.match(routeText, /플랜: \{"enabled":true/);
assert.equal(JSON.stringify(routeInput), routeBefore, "does not mutate inputs");

// All 300 base rows survive an ordinary single-banner share.
const rows300 = Array.from({length: 300}, (_, index) => [
  cat(index + 1, `${index + 1}A`, `${index + 1}B`),
  cat(index + 1001, `${index + 1}B`, `${index + 2}A`)
]);
const fullText = summary.build({track: {seed: 42, count: 300, rows: []},
  findEnabled: false, outputs: [{label: "A", row: {lang: "kr"},
    out: {cats: rows300}, alternatives: {}}]});
const fullBanner = outputLines(fullText, "배너 배열: ")[0];
assert.equal(fullBanner.rowsTotal, 300);
assert.equal(fullBanner.rowsIncluded, 300);
assert.equal(fullBanner.rowsOmitted, 0);
assert.equal(fullBanner.rows[249][0][0], 250, "row 250 remains present");
assert.equal(fullBanner.rows[299][1][0], 1300);

// Output cap keeps complete JSON records and per-banner omission counts,
// while retaining the complete route and plan ahead of array details.
const longRows = Array.from({length: 999}, (_, index) => [
  cat(index + 1, `${index + 1}A`, `${index + 1}B`, {name: `Character ${index + 1}`}),
  cat(index + 1001, `${index + 1}B`, `${index + 2}A`, {name: `Character ${index + 1001}`})
]);
const manyText = summary.build({track: {seed: 42, count: 999, rows: []},
  findEnabled: true, find: {status: "partial", message: "best so far",
    targetAcquired: 1, targetTotal: 2, actions: routeActions},
  plan: {enabled: true, name: "kept", marks: [{column: 0, position: "999A"}]},
  outputs: ["A", "B"].map(label => ({label, row: {lang: "kr"},
    out: {cats: longRows}, alternatives: {}}))});
assert(manyText.length <= 60000, `large summary is bounded (${manyText.length})`);
const manyBanners = outputLines(manyText, "배너 배열: ");
assert.equal(manyBanners.length, 2);
for (const banner of manyBanners) {
  assert.equal(banner.rowsTotal, 999);
  assert.equal(banner.rowsIncluded + banner.rowsOmitted, 999);
  assert.equal(banner.rows.length, banner.rowsIncluded);
  assert.equal(banner.conditionalIncluded + banner.conditionalOmitted,
    banner.conditionalTotal);
}
assert.match(manyText, /"status":"partial"/);
assert.match(manyText, /"name":"kept"/);
manyBanners.forEach(banner => assert(Array.isArray(banner.rows)));

// Failed statuses and their messages are retained without inventing a route.
for (const [status, message] of [["partial", "not proven optimal"],
  ["impossible", "no path"]]) {
  const text = summary.build({track: {seed: 42, rows: []}, findEnabled: true,
    find: {status, message, actions: []}, plan: null});
  const line = text.split("\n").find(value => value.startsWith("Find 계산: "));
  const result = JSON.parse(line.slice("Find 계산: ".length));
  assert.equal(result.status, status);
  assert.equal(result.message, message);
  assert.deepEqual(result.actions, []);
}

// Ticket and rerolled/guaranteed details remain detailed, and acquired draw
// positions are inferred only by matching the exact route result label.
const rcat = cat(44, "7A", "8B", {name: "Rare",
  rerolled: cat(45, "7AR", "8B", {name: "Reroll",
    guaranteed: cat(870, "7ARG", "18A", {name: "Goal"})})});
const actionDetails = [
  {type: "ticket", ticketKind: "platinum", start: "7A", resultLabel: "7AR",
    next: "8B", catId: 44, catName: "Reroll", rarity: 2,
    acquired: [{targetIndex: 0, catId: 44, catName: "Reroll", resultLabel: "7AR"}]},
  {type: "guaranteed", start: "7A", guaranteedLabel: "7ARG", next: "18A",
    pulls: 11, routePulls: guaranteedPulls.map((pull, index) => ({
      resultLabel: index === 10 ? "7ARG" : pull.resultLabel,
      rerolled: index === 0, guaranteed: index === 10
    })), acquired: [{targetIndex: 1, catId: 870, catName: "Goal", resultLabel: "unknown"}]}
];
const details = summary.build({track: {seed: 42, rows: []}, findEnabled: true,
  find: {status: "success", actions: actionDetails}, outputs: [{label: "A",
    row: {lang: "kr"}, out: {cats: [[rcat, null]]}, alternatives: {
      "7AR": [{kind: "guaranteed", variant: "rerolled",
        pull: {id: 870, name: "Goal", resultLabel: "7ARG", next: "18A"},
        next: "18A", prerequisite: {column: 0, position: "7AR", kind: "reroll"},
        lastRareId: 44}]
    }}]});
const detailFind = JSON.parse(details.split("\n").find(line =>
  line.startsWith("Find 계산: ")).slice("Find 계산: ".length));
assert.equal(detailFind.ticketActions, 1);
assert.equal(detailFind.guaranteedActions, 1);
assert.equal(detailFind.totalDraws, 12);
assert.equal(detailFind.actions[0].resultLabel, "7AR");
assert.equal(detailFind.targetsAcquired[0].drawNumber, 1);
assert.deepEqual(detailFind.targetsAcquired[1].drawRange, [2, 12],
  "unmatched result identity yields the action draw range");
assert.equal(detailFind.actions[1].routePulls[10].resultLabel, "7ARG");
const detailBanner = outputLines(details, "배너 배열: ")[0];
assert.equal(detailBanner.rows[0][0][3][3][0], 870,
  "a rerolled cell keeps its conditional guaranteed result");
assert.equal(detailBanner.conditional[0][1][2], 870);
assert.equal(detailBanner.names["870"], "Goal");

// The final goal at action/draw 300 survives both batching and dense routes.
const route300 = Array.from({length: 300}, (_, i) => roll(i, `${i + 1}A`, `${i + 2}A`,
  i === 299 ? {catId: 870, catName: "Goal", rarity: 4,
    acquired: [{targetIndex: 0, catId: 870, catName: "Goal", resultLabel: "300A"}]} : {}));
for (const dense of [false, true]) {
  const actions = route300.map(action => dense ? {...action, rarity: 4} : action);
  const before = JSON.stringify(actions);
  const text = summary.build({track: {seed: 42, count: 300, rows: []}, findEnabled: true,
    find: {status: "success", destination: "301A", targetAcquired: 1, targetTotal: 1, actions},
    plan: {enabled: false}, outputs: [{label: "A", row: {lang: "kr"}, out: {cats: rows300}}]});
  const result = outputLines(text, "Find 계산: ")[0];
  assert.equal(result.totalDraws, 300);
  assert.equal(result.regularActions, 300);
  assert.equal(result.targetsAcquired[0].drawNumber, 300);
  assert.equal(result.targetsAcquired[0].actionIndex, 300);
  assert.equal(result.actions.at(-1).resultLabel, "300A");
  assert.equal(result.actions.reduce((n, item) => n + (item.type === "rollBatch" ? item.count : 1), 0), 300);
  const banner = outputLines(text, "배너 배열: ")[0];
  assert.equal(banner.rowsIncluded + banner.rowsOmitted, 300);
  assert.equal(banner.rowsIncluded, 300, "all300 rows fit even with 300 detailed actions");
  assert(text.length <= 60000);
  if (dense) assert.equal(result.actionContexts[result.actions.at(-1).context].event, "event-1");
  assert.equal(JSON.stringify(actions), before);
  console.log(`300-action ${dense ? "dense" : "batched"}: goal at draw300 kept, chars=${text.length}, arrayRows=${banner.rowsIncluded}`);
}
console.log("gpt result summary tests passed");
