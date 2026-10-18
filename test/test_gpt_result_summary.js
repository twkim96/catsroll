"use strict";

const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const summary = require("../lib/battle-cats-rolls/asset/gpt-result-summary.js");
const snapshot = require("../lib/battle-cats-rolls/asset/gpt-snapshot.js");
const captureBaseline = require("./fixtures/gpt-result-summary-capture-v1.json");
const seekCapture=snapshot.captureSeek({request:{mode:'seek',rows:[{lang:'kr',event:'synthetic'}],rolls:[38,57]},
  dataVersion:'seek-v2',result:{status:1,count:1,begin:42,end:123}});
assert.equal(seekCapture.data_version,'seek-v2');
assert.deepEqual(seekCapture.result,{status:'success',engine_status:1,begin:42,end:123,count:1});
assert.deepEqual(seekCapture.input.request.rolls,[38,57]);
assert.match(summary.buildCaptured(seekCapture),/시작 시드 42, 관측 후 시드 123/);
assert.equal(snapshot.captureSeek({result:{status:1,count:2,begin:42,end:123}}).result.begin,null,
  'ambiguous seeker candidates are never exported as confirmed seeds');
const positionCapture=snapshot.capture({findEnabled:true,find:{status:'success',nextOffset:366}});
const positionProjection=JSON.parse(summary.buildCaptured(positionCapture).split('\n').find(l=>l.startsWith('Find 계산: ')).slice(9));
assert.deepEqual(positionProjection.engine_position,{next_track_offset:366});
assert.equal('nextOffset' in positionProjection,false);
assert.equal(positionCapture.find.nextOffset,366,'legacy original position remains unchanged');
for(const [override,effective,source] of [[0,11,'banner_default'],[7,7,'explicit_override']]) {
 const input={track:{rows:[{forceGuaranteed:override}]},outputs:[{row:{lang:'kr',forceGuaranteed:override},pool:{guaranteed_rolls:effective},out:{cats:[]}}]};
 const stored=snapshot.capture(input);
 assert.deepEqual(stored.banners[0].guarantee,{requested_override:override,effective_rolls:effective,source});
 assert.deepEqual(JSON.parse(summary.buildCaptured(stored).split('\n').find(l=>l.startsWith('배너 배열: ')).slice(7)).guarantee,stored.banners[0].guarantee);
}

function cat(id, position, next, options) {
  options = options || {};
  return {
    id,
    rarity: options.rarity,
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

// Freeze the pre-refactor output from one representative structured fixture.
// The baseline exercises base A/B, R/G/RG, a conditional branch, a partial
// Find route, plan data and the 24-roll + 11-pull draw count.
const legacyCat = (id, position, next, name, rarity, rerolled, guaranteed) => ({
  id, rarity, number: () => position, pickName: () => name,
  next: next ? {number: () => next} : null,
  rerolled: rerolled || null, guaranteed: guaranteed || null
});
const legacyActions = Array.from({length: 24}, (_, index) => roll(index,
  `${index + 1}A`, `${index + 2}A`)).map(action => ({...action,
  event: "synthetic42", eventLabel: "Synthetic 42"}));
const legacyPulls = Array.from({length: 10}, (_, index) => ({
  resultLabel: `${25 + index}A`, rerolled: false, guaranteed: false
}));
legacyPulls.push({resultLabel: "25AG", rerolled: false, guaranteed: true});
legacyActions.push({type: "guaranteed", lang: "kr", event: "synthetic42",
  eventLabel: "Synthetic 42", scheduleDay: "2026-10-18", start: "25A",
  guaranteedLabel: "25AG", next: "35B", pulls: 11, routePulls: legacyPulls,
  acquired: [{targetIndex: 0, catId: 870, catName: "Goal", resultLabel: "25AG"}]});
const legacyInput = {
  track: {seed: 42, last: 0, count: 300, formIndex: 0,
    rows: [{lang: "kr", event: "synthetic42", ubers: 0, seriesIds: [17, undefined]}]},
  findEnabled: true,
  find: {status: "partial", message: "search limit; best route retained",
    destination: "35B", regularUses: 24, ticketUses: 0, guaranteedUses: 1,
    targetAcquired: 1, targetTotal: 1, optimization: "cost", cost: 1.48,
    rawCost: 1.48, baseCost: 1.48, regularUnitCost: 0.02,
    balanceCredit: 0, uberDraws: 0, actions: legacyActions},
  findSettings: {optimization: "cost", maxGuaranteed: 1, scheduleAware: true,
    maxPlatinum: 0, maxLegendTicket: 0,
    targets: [{cat_id: 870, allow_ticket: false}]},
  plan: {enabled: true, name: "synthetic42 goal",
    marks: [{column: 0, position: "25AG", note: undefined}],
    route: [undefined, null], cats: [{cat_id: 870}],
    progress: {completed: undefined, drawCount: NaN}},
  dataVersion: "fixture-v1",
  outputs: [{label: "Synthetic 42", row: {lang: "kr"}, out: {cats: [[
    legacyCat(1, "1A", "2A", "Rare", 2,
      legacyCat(2, "1AR", "2B", "Reroll", 3, null,
        legacyCat(870, "1ARG", "12A", "Goal", 4)),
      legacyCat(5, "1AG", "12B", "Guaranteed Uber", 5)),
    legacyCat(6, "1B", "2B", "Super Rare", 3)]]}, alternatives: {"1AR": [{
      kind: "guaranteed", variant: "rerolled",
      pull: {id: 7, name: "Conditional Uber", rarity: 4,
        resultLabel: "1ARG", rerolled: true, guaranteed: true, next: "12A"},
      next: "12A", prerequisite: {column: 0, position: "1AR", name: "Rare", kind: "reroll"},
      lastRareId: 1}]}}]
};
assert.deepEqual(snapshot.capture(legacyInput), captureBaseline,
  "structured snapshot matches the frozen pre-refactor capture");
assert.equal(JSON.stringify(snapshot.capture(legacyInput)),
  JSON.stringify(captureBaseline), "snapshot JSON retains legacy field ordering and values");
assert.deepEqual(summary.capture(legacyInput), captureBaseline,
  "legacy summary API shares the snapshot module's capture result");
assert.strictEqual(summary.capture, snapshot.capture,
  "summary capture is the snapshot module's structured capture API");
assert.equal(captureBaseline.find.totalDraws, 35);

const browserContext = vm.createContext({});
vm.runInContext(fs.readFileSync(require.resolve("../lib/battle-cats-rolls/asset/gpt-snapshot.js"), "utf8"),
  browserContext, {filename: "gpt-snapshot.js"});
vm.runInContext(fs.readFileSync(require.resolve("../lib/battle-cats-rolls/asset/gpt-result-summary.js"), "utf8"),
  browserContext, {filename: "gpt-result-summary.js"});
assert.deepEqual(JSON.parse(JSON.stringify(
  browserContext.CatsrollSnapshot.capture(legacyInput))), captureBaseline,
  "browser UMD globals capture the same structured fixture after snapshot loads first");

// Human-readable projection remains independent of snapshot normalization.
const snapshotBeforeProse = JSON.stringify(snapshot.capture(legacyInput));
const originalProjection = summary.buildCaptured;
summary.buildCaptured = () => "display prose changed";
assert.deepEqual(summary.capture(legacyInput), captureBaseline,
  "changing display projection prose cannot change captured JSON");
summary.buildCaptured = originalProjection;
assert.equal(JSON.stringify(snapshot.capture(legacyInput)), snapshotBeforeProse);

// JSON sanitizer semantics from legacy capture: object undefined fields are
// omitted; array undefined and non-finite numbers become null.
const sanitized = snapshot.capture({track: {seed: 42}, plan: {
  progress: {completed: undefined, values: [undefined, NaN, Infinity]}}});
assert.deepEqual(sanitized.plan, {progress: {values: [null, null, null]}});
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

// Conditional detail uses only the budget left after all base A/B rows.
const manyAlternatives = Object.fromEntries(Array.from({length: 300}, (_, index) => [
  `conditional-${index}`, [{kind: "guaranteed", variant: "V".repeat(100),
    pull: {id: index + 2000, name: `Conditional ${index} ${"N".repeat(40)}`,
      resultLabel: "R".repeat(80), next: "next"}}]
]));
const priorityText = summary.build({track: {seed: 42, count: 1}, outputs: [{
  label: "Base priority", row: {lang: "kr"},
  out: {cats: [[cat(1, "1A", "2A"), cat(2, "1B", "2B")]]},
  alternatives: manyAlternatives
}]});
const priorityBanner = outputLines(priorityText, "배너 배열: ")[0];
assert.equal(priorityBanner.rowsIncluded, 1);
assert.equal(priorityBanner.rowsOmitted, 0);
assert(priorityBanner.conditionalIncluded < priorityBanner.conditionalTotal);
assert.equal(priorityBanner.conditionalIncluded + priorityBanner.conditionalOmitted,
  priorityBanner.conditionalTotal);

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

// Stored snapshots contain every row and every conditional branch, without the chat budget.
const captured = summary.capture({track: {seed: 42, count: 999, rows: []}, findEnabled: true,
  find: {status: "success", actions: routeActions}, plan: {enabled: false},
  outputs: Array.from({length: 8}, (_, n) => ({label: `Banner ${n}`, row: {lang: "kr"},
    out: {cats: longRows}, alternatives: {"999A": [{kind: "regular", pull: {id: 870, name: "Goal", resultLabel: "999A", next: "1000A"}}]}}))});
assert.equal(captured.schema_version, 1);
assert.equal(captured.banners.length, 8);
assert(captured.banners.every(b => b.rowsIncluded === 999 && b.rowsOmitted === 0 && b.conditionalOmitted === 0));
assert.equal(captured.banners[7].rows[998][1][1], "999B");
assert.equal(captured.input.track.count, 999, "legacy count stays the caller's value");
assert.equal(captured.find.totalDraws, 35);
assert(captured.banners[7].conditional.length > 0);
console.log("full snapshot capture: 999x8 rows and all branches retained, bytes=" + Buffer.byteLength(JSON.stringify(captured)));

// A route larger than the chat budget retains its state and exact export data.
const oversizedSnapshot = JSON.parse(JSON.stringify(captured));
oversizedSnapshot.find.status = 'partial';
oversizedSnapshot.find.actions = Array.from({length: 300}, (_, i) => ({type: 'roll', actionIndex: i + 1,
  catName: '한'.repeat(300), resultLabel: `${i + 1}A`, acquired: [{catId: 870, catName: '한'.repeat(300)}]}));
oversizedSnapshot.plan.marks = Array.from({length: 300}, (_, i) => ({column: 0, position: `${i + 1}A`, note: '한'.repeat(300)}));
const beforeOversized = JSON.stringify(oversizedSnapshot);
const boundedCaptured = summary.buildCaptured(oversizedSnapshot, 58000);
assert(boundedCaptured.length <= 58000);
assert.match(boundedCaptured, /"status":"partial"/);
assert.match(boundedCaptured, /omittedActions/);
assert.match(boundedCaptured, /생략/);
assert.equal(JSON.stringify(oversizedSnapshot), beforeOversized);
assert(summary.build({track: {}, outputs: [], find: {status:'partial', actions: oversizedSnapshot.find.actions}, plan: oversizedSnapshot.plan}).length <= 60000);
console.log('oversized captured route: hard transport cap, state/omissions retained, full JSON unchanged');

// Follow-up reasoning receives rarity for base, R, G, RG and conditional-only cats.
const reasoningInput = {track: {seed: 42, count: 100, rows: [{lang: 'kr', event: 'fixture'}]},
  findEnabled: false, outputs: [{label: 'Fixture', row: {lang: 'kr'}, out: {cats: [[
    cat(1, '1A', '2A', {rarity: 2, rerolled: cat(2, '1AR', '2B', {rarity: 3,
      guaranteed: cat(4, '1ARG', '12A', {rarity: 4})}),
      guaranteed: cat(5, '1AG', '12B', {rarity: 5})}),
    cat(6, '1B', '2B', {rarity: 4})]]}, alternatives: {'1A': [{kind: 'regular',
      pull: {id: 7, name: 'Conditional uber', rarity: 4, resultLabel: '1AR', next: '2B'}}]}}]};
const reasoningCapture = summary.capture(reasoningInput);
assert.deepEqual(reasoningCapture.banners[0].rarities, {'1': 2, '2': 3, '4': 4, '5': 5, '6': 4, '7': 4});
const reasoningText = summary.buildCaptured(reasoningCapture, 56000);
const reasoningBanner = outputLines(reasoningText, '배너 배열: ')[0];
assert.deepEqual(reasoningBanner.rarities, reasoningCapture.banners[0].rarities);
assert.equal(reasoningBanner.rows[0][0][3][3][0], 4);
assert.match(reasoningText, /4 울슈레, 5 레레/);
assert.match(reasoningText, /prerequisite/);
const legacyCapture = JSON.parse(JSON.stringify(reasoningCapture));
delete legacyCapture.banners[0].rarities;
assert.doesNotThrow(() => summary.buildCaptured(legacyCapture));
console.log('follow-up reasoning: base/R/G/RG/conditional rarities and legacy capture supported');
