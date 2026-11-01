"use strict";

const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const tracks = require("../lib/battle-cats-rolls/asset/track-engine.js").TrackEngine;
const find = require("../lib/battle-cats-rolls/asset/multi-find-engine.js");
const source = fs.readFileSync(require.resolve(
  "../lib/battle-cats-rolls/asset/multi-track.js"), "utf8");

function functions(from, to, context) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert(start >= 0 && end > start);
  vm.runInNewContext(source.slice(start, end), context);
  return context;
}

const kr = {name: ["한국어", "진화형"], desc: ["설명", "진화형 설명"], rarity: 4, img: null};
const jp = {name: ["日本語"], desc: ["説明"], rarity: 4, img: null};
const ticket = {name: kr.name, rarity: 4};
const payload = {
  cat_metadata: [kr, jp, ticket],
  regions: {
    kr: {events: [{pool: {cats: {1: 0}}}, {pool: {cats: {1: 0}}}, {event: "lazy"}],
      tickets: {platinum: {pool: {cats: {1: 2}}}}},
    jp: {events: [{pool: {cats: {1: 1}}}], tickets: {}}
  }
};
let parses = 0;
const decode = functions("  function readInitialData()", "  var data = readInitialData();", {
  doc: {getElementById() { return {textContent: JSON.stringify(payload)}; }},
  JSON: {parse(text) { parses++; return JSON.parse(text); }}
});
const restored = decode.readInitialData();
assert.strictEqual(parses, 1);
assert.deepStrictEqual(restored.regions.kr.events[0].pool.cats[1], kr);
assert.deepStrictEqual(restored.regions.jp.events[0].pool.cats[1], jp);
assert.deepStrictEqual(restored.regions.kr.tickets.platinum.pool.cats[1], ticket);
assert.strictEqual(restored.regions.kr.events[0].pool.cats[1],
  restored.regions.kr.events[1].pool.cats[1]);
assert.strictEqual(restored.regions.kr.events[2].pool, undefined);

const future = functions("  function futureInfo(id)", "  function poolUrl(row)", {});
const fixture = require("./fixtures/multi-cross-banner.json");
const original = fixture.rows[0].pool;
const before = JSON.stringify(original);
const added = future.poolWithFuture(original, 3);
added.guaranteed_rolls = 11;
const clean = future.poolWithFuture(original, 0);
assert.deepStrictEqual(Array.from(added.slots[4].slice(0, 3)), [-3, -2, -1]);
assert.strictEqual(clean.cats[-1], undefined);
assert.strictEqual(JSON.stringify(original), before);

// Compare real outcomes/tooltips and conditional branches against the former
// full-copy implementation, including future cats and forced guarantees.
for (const amount of [0, 3]) {
  const expected = JSON.parse(before);
  for (let id = -1; id >= -amount; id--) {
    expected.slots[4].unshift(id);
    expected.cats[id] = {name: ["(" + id + "?)"], desc: ["An unknown future uber"]};
  }
  expected.guaranteed_rolls = 11;
  const actual = future.poolWithFuture(original, amount);
  actual.guaranteed_rolls = 11;
  const options = {count: 300, last: 0, guaranteedRolls: 11, guaranteed: true, findCat: true};
  function summary(pool) {
    return tracks.buildTracks(pool, fixture.seed, options).cats.map(ab =>
      ab.map(cat => [cat.id, cat.slot_seed, cat.next && cat.next.number(),
        cat.pickTitle(1), cat.rerolled && cat.rerolled.id,
        cat.guaranteed && cat.guaranteed.id,
        cat.rerolled && cat.rerolled.guaranteed && cat.rerolled.guaranteed.id]));
  }
  assert.deepStrictEqual(summary(actual), summary(expected));
  assert.deepStrictEqual(find.buildTrackAlternatives([actual], fixture.seed, options),
    find.buildTrackAlternatives([expected], fixture.seed, options));
}
assert.strictEqual(JSON.stringify(original), before, "calculations must not mutate shared metadata");

// Multi's selected Find targets extend the existing automatic Found list.
// Legend/exclusive targets and duplicate selections must remain single entries.
const foundPool = fixture.rows[1].pool;
const foundOptions = {count:100,last:fixture.last,guaranteedRolls:11};
const defaults = tracks.buildTracks(foundPool, fixture.seed, foundOptions).foundCats;
const selected = tracks.buildTracks(foundPool, fixture.seed,
  {...foundOptions,find:[479,479,720,720,402,999999]}).foundCats;
assert(selected.some(item=>item.cat.id===720));
assert(selected.some(item=>item.cat.id===402));
assert(!selected.some(item=>item.cat.id===999999),'targets outside this banner are ignored');
assert.deepStrictEqual(selected.filter(item=>item.cat.id===479).map(item=>item.numbers),
  defaults.filter(item=>item.cat.id===479).map(item=>item.numbers),'existing automatic targets retain their occurrences');
assert.strictEqual(selected.filter(item=>item.cat.id===720).length,1);
assert.strictEqual(selected.filter(item=>item.cat.id===479).length,1);
const scalar = tracks.buildTracks(foundPool, fixture.seed,{...foundOptions,find:720}).foundCats;
assert.deepStrictEqual(selected.find(item=>item.cat.id===720).numbers,
  scalar.find(item=>item.cat.id===720).numbers,'ordinary single-target API remains compatible');

// Exercise automatic discovery using a real pool and the engine's rolling path.
const exclusivePool = JSON.parse(JSON.stringify(foundPool));
for (const slot of Object.keys(exclusivePool.slots)) {
  exclusivePool.slots[slot] = exclusivePool.slots[slot].map(id => id === 479 ? 874 : id);
}
exclusivePool.cats[874] = exclusivePool.cats[479];
delete exclusivePool.cats[479];
assert(tracks.buildTracks(exclusivePool, fixture.seed, foundOptions).foundCats
  .some(item => item.cat.id === 874), '874 is discovered automatically');

const chosen = selected.find(item => item.cat.id === 479);
const automatic = selected.find(item => item.cat.id !== 479);
const sample = [{cat: chosen.cat, numbers: ['1A', '2B']},
  {cat: automatic.cat, numbers: ['3A']}];
const grouped = tracks.partitionFoundCats(sample, [479, 479]);
assert.strictEqual(grouped.found.length, 1);
assert.strictEqual(grouped.automatic.length, 1);

const renderContext = {TrackEngine: tracks, URLSearchParams};
vm.runInNewContext(fs.readFileSync(require.resolve(
  '../lib/battle-cats-rolls/asset/track-render.js'), 'utf8'), renderContext);
const ordinary = renderContext.TrackRender.renderFoundCats({foundCats: sample},
  {find: 479, count: 100});
assert(ordinary.indexOf('Found cats:') < ordinary.indexOf('Exclusive and legend cats:'));
assert(ordinary.includes('href="#N1A"') && ordinary.includes('href="#N2B"'));
assert.strictEqual((ordinary.match(/<li>/g) || []).length, 2);
assert(!renderContext.TrackRender.renderFoundCats({foundCats: [sample[1]]},
  {find: 479, count: 100}).includes('Found cats:'));

let draftTargets = [479];
const outputContext = functions('  function buildOutputs()', '  function nextLabel(', {
  global: {TrackEngine: tracks, MultiFindApp: {getTargetIds: () => draftTargets},
    MultiFindEngine: {buildTrackAlternatives: () => []}},
  state: {rows: [{}], seed: fixture.seed, count: 100, last: fixture.last},
  eventData: () => ({pool: foundPool}), poolWithFuture: pool => pool,
  shortRowTitle: () => 'Banner', rowTitle: () => 'Banner', formIndex: 0
});
const outputs = outputContext.buildOutputs();
draftTargets.push(720);
assert(outputs[0].foundGroups.found.some(item => item.cat.id === 479));
assert(!outputs[0].foundGroups.found.some(item => item.cat.id === 720),
  'later target edits must not reclassify calculated results');

const panel = {innerHTML: ''};
const renderer = functions('  function foundNumberHtml(', '  function updateVirtualSpacers()', {
  els: {foundCats: panel}, state: {count: 100}, h: String,
  catNameHtml: cat => String(cat.id)
});
renderer.renderFoundCats([{label: 'Banner', row: {}, out: {foundCats: sample},
  foundGroups: grouped}]);
assert(panel.innerHTML.includes('Found cats:') && panel.innerHTML.includes('Exclusive and legend cats:'));
assert(panel.innerHTML.includes('href="#multi-N1A"') && panel.innerHTML.includes('href="#multi-N2B"'));
assert.strictEqual((panel.innerHTML.match(/<li>/g) || []).length, 2);
renderer.renderFoundCats([{error: 'Loading...'}]);
assert(panel.innerHTML.includes('Loading...'));
renderer.renderFoundCats([]);
assert(panel.innerHTML.includes('No found cats.'));
renderer.renderFoundCats([{label: 'Banner', row: {}, out: {foundCats: [sample[1]]},
  foundGroups: tracks.partitionFoundCats([sample[1]], [479])}]);
assert(!panel.innerHTML.includes('Found cats:'));
console.log("multi-track-data: ok");
