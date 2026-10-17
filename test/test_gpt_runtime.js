"use strict";
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const base = path.join(__dirname, "../lib/battle-cats-rolls/asset");
const runtime = require(path.join(base, "gpt-runtime.js"));
const track = require(path.join(base, "track-engine.js")).TrackEngine;
const find = require(path.join(base, "multi-find-engine.js"));
const fixture = require("./fixtures/multi-cross-banner.json");
const payload = {
  dataVersion: "fixture", request: {mode: "multi", seed: fixture.seed,
    last: fixture.last, count: 30},
  events: fixture.rows.map(row => ({lang: "kr", event: row.event,
    label: row.label || "banner", pool: row.pool})), tickets: []
};
const before = JSON.stringify(payload);
const actual = runtime.compute("multi", payload, {track, find});
for (let i = 0; i < payload.events.length; i++) {
  const expected = track.buildTracks(payload.events[i].pool, fixture.seed,
    {count: 30, last: fixture.last, guaranteedRolls: 11, guaranteed: true, findCat: true});
  for (let n = 0; n < 30; n++) {
    for (const [column, letter] of [[0, "A"], [1, "B"]]) {
      const cat = expected.cats[n][column];
      const item = actual.rows[i].tracks[letter][n];
      assert.equal(item.id, cat.id);
      assert.equal(item.position, cat.number());
      assert.equal(item.next, cat.next ? cat.next.number() : null);
      assert.equal(item.name, cat.pickName(0));
      assert.equal(item.rarityLabel, cat.scoreRarityLabel());
      assert.equal(item.title, cat.pickTitle(0));
    }
  }
}
assert(actual.rows[0].alternatives["2A"].some(item =>
  item.kind === "guaranteed" && item.variant === "rerolled" && item.pull.id === 866),
  "the real cross-banner conditional RG result survives the GPT adapter");
assert.equal(JSON.stringify(payload), before, "shared pools remain immutable");
assert.deepEqual(actual.exclusiveIds, track.EXCLUSIVES);
const changed = runtime.modifiedPool({...payload.events[0], ubers: 2, forceGuaranteed: 15});
assert.deepEqual(changed.slots[4].slice(0, 2), [-2, -1]);
assert.equal(changed.guaranteed_rolls, 15);
assert.equal(JSON.stringify(payload), before);

// Every S/G choice used by the existing Multi page must retain the exact G/RG
// result and following position through the worker's plain-data boundary.
for (const rolls of [2, 7, 11, 15]) {
  const forced = {...payload, events: payload.events.map(event => ({...event, forceGuaranteed: rolls}))};
  const result = runtime.compute('multi', forced, {track, find});
  const source = track.buildTracks({...payload.events[0].pool, guaranteed_rolls: rolls},
    fixture.seed, {count: 30, last: fixture.last, guaranteedRolls: rolls});
  for (const [trackIndex, letter] of [[0, 'A'], [1, 'B']]) {
    for (let index = 0; index < 30; index++) {
      const expected = source.cats[index][trackIndex];
      const actual = result.rows[0].tracks[letter][index];
      for (const [input, output] of [[expected, actual], [expected.rerolled, actual.rerolled]]) {
        if (!input) { assert.equal(output, undefined); continue; }
        assert.equal(!!output.guaranteed, !!input.guaranteed);
        if (!input.guaranteed) continue;
        assert.equal(output.guaranteed.id, input.guaranteed.id);
        assert.equal(output.guaranteed.rarity, input.guaranteed.rarity);
        assert.equal(output.guaranteed.position, input.guaranteed.number());
        assert.equal(output.guaranteed.next, input.guaranteed.next ? input.guaranteed.next.number() : null);
      }
    }
  }
}
assert.equal(JSON.stringify(payload), before, 'all S/G variants preserve the source pools');

const first = find.simulateRegular(payload.events[0].pool, payload.request.seed, 0, fixture.last, 0);
const target = {cat_id: first.id, allow_ticket: false};
const findPayload = {...payload, request: {...payload.request, mode: "find", optimization: "distance",
  maxGuaranteed: 0, maxPlatinum: 0, maxLegendTicket: 0, targets: [target]}};
const routed = runtime.compute("find", findPayload, {track, find});
const direct = find.search({...findPayload.request, formIndex: 0,
  events: payload.events, tickets: []});
assert.equal(routed.status, direct.status);
assert.deepEqual(routed.actions, direct.actions);
assert.equal(routed.destination, direct.destination);
let received;
runtime.compute('find', {...findPayload, tickets: [{kind: 'platinum', ubers: 2,
  pool: {...payload.events[0].pool, platinum: 'platinum'}}]},
  {track, find: {search(input) { received = input; return {status: 'idle'}; }}});
assert.deepEqual(received.tickets[0].pool.slots[4].slice(0, 2), [-2, -1],
  'selected special-ticket future settings also reach the actual search');
assert.throws(() => runtime.compute("seek", payload, {track, find}), /일치/);
const workerMessages = [];
const workerContext = {self: {postMessage: message => workerMessages.push(message)}};
vm.runInNewContext(fs.readFileSync(path.join(base, 'gpt-worker.js'), 'utf8'), workerContext);
workerContext.self.onmessage({data: {mode: 'seek', payload}});
assert.equal(workerMessages[1].type, 'error');
assert.match(workerMessages[1].message, /일치/);

(async () => {
  // A rare Legend first draw makes a full-space search short while retaining
  // actual existing WASM and ten regular draws as the acceptance case.
  const pool = {exist: true, base: 10000, guaranteed_rolls: 0,
    rates: {rare: 7000, supa: 2000, uber: 900, legend: 100},
    slots: {2: Array.from({length: 25}, (_, i) => 38 + i),
      3: Array.from({length: 15}, (_, i) => 150 + i),
      4: Array.from({length: 40}, (_, i) => 300 + i), 5: [200,201,202]},
    cats: {}};
  for (const [rarity, ids] of Object.entries(pool.slots)) {
    for (const id of ids) pool.cats[id] = {name: [String(id)], rarity: Number(rarity)};
  }
  let seed = 1, simulated;
  while (seed < 100000) {
    simulated = find.simulateRegular(pool, seed, 0, 0, 0);
    if (simulated.rarity === 5) break;
    seed++;
  }
  assert(seed < 100000, "fixture has a legend first-draw seed");
  let offset = 0, last = 0;
  const rolls = [];
  let expectedEnd = seed;
  for (let n = 0; n < 10; n++) {
    const out = find.simulateRegular(pool, seed, offset, last, 0);
    const slots = pool.slots[out.rarity];
    rolls.push(out.rarity, slots.indexOf(out.id));
    offset = out.nextOffset;
    last = out.lastRareId;
  }
  for (let n = 0; n < offset; n++) expectedEnd = find.advanceSeed(expectedEnd);
  const context = {self: {location: {href: "https://example.test/worker.js"}}, console,
    Uint8Array, WebAssembly, TextDecoder, setTimeout, clearTimeout};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(base, "seeker-vampireflower.js"), "utf8"), context);
  const seeker = {rates: [pool.rates.rare, pool.rates.supa, pool.rates.uber, pool.rates.legend],
    slots: [2,3,4,5].map(rarity => pool.slots[rarity].length), rolls};
  const result = await runtime.seek(seeker, context.createSeekerModule,
    fs.readFileSync(path.join(base, "seeker-vampireflower.wasm")));
  assert.equal(result.status, 1, "ten real simulated draws resolve uniquely");
  assert.equal(result.begin, seed);
  assert.equal(result.end, expectedEnd);
  await assert.rejects(runtime.seek({...seeker, rolls: []}), /入力|입력/);
  console.log("GPT adapter: original arrays, cross-banner RG, Find parity, immutable pools and real WASM seed recovery passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
