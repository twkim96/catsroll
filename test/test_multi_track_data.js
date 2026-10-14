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
console.log("multi-track-data: ok");
