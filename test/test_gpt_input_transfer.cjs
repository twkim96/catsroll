"use strict";

const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const transfer = require("../lib/battle-cats-rolls/asset/gpt-input-transfer.js");

const multiRequest = {
  mode: "multi", seed: 4294967295, last: 27, count: 999,
  optimization: "pareto", maxGuaranteed: 20, maxPlatinum: 2,
  maxLegendTicket: 3, scheduleAware: false, findEnabled: true,
  planMode: true, planName: "픽시즈 계획 🐈",
  rows: [
    {lang: "kr", event: "2026-02-13_1042", ubers: 12,
      forceGuaranteed: 11, previewFor: "jp"},
    {lang: "kr", event: "2026-02-13_1043", ubers: 4,
      forceGuaranteed: 7}
  ],
  targets: [
    {cat_id: 160, cat_name: "칼리파 α", allow_ticket: true},
    {cat_id: 870, cat_name: "変身少女", allow_ticket: false}
  ]
};

assert.equal(transfer.decode("#other=value"), null);
assert.equal(transfer.decode(""), null);

// Decode the Ruby-produced URL so both sides exercise the same serialized envelope.
const rubySource = [
  'require "json"',
  'require "battle-cats-rolls/local/gpt_input_transfer"',
  'puts BattleCatsRolls::GptInputTransfer.url("https://example.test/", JSON.parse(ARGV.fetch(0)))'
].join("; ");
function rubyUrl(request) {
  return execFileSync("ruby", ["-Ilib", "-e", rubySource,
    JSON.stringify(request)], {encoding: "utf8"}).trim();
}
const url = rubyUrl(multiRequest);
assert.equal(new URL(url).pathname, "/gpt");
assert.equal(new URL(url).search, "");
assert.deepEqual(transfer.decode(new URL(url).hash), {
  version: 1,
  arguments: multiRequest
});
const scheduledRequest = structuredClone(multiRequest);
scheduledRequest.scheduleAware = true;
scheduledRequest.rows.forEach(row => { delete row.previewFor; });
assert.deepEqual(transfer.decode(new URL(rubyUrl(scheduledRequest)).hash), {
  version: 1,
  arguments: scheduledRequest
});

const seekRequest = {
  mode: "seek", last: 0, count: 300, optimization: "cost",
  maxGuaranteed: 0, maxPlatinum: 0, maxLegendTicket: 0,
  scheduleAware: false, findEnabled: false, planMode: false,
  planName: "", rows: [{lang: "kr", event: "2019-01-23_348",
    ubers: 0, forceGuaranteed: 0}], targets: [], rolls: [38, 160, 870]
};
const seekToken = Buffer.from(JSON.stringify({version: 1, arguments: seekRequest}), "utf8").
  toString("base64url");
assert.deepEqual(transfer.decode("#catsroll-input=" + seekToken), {
  version: 1,
  arguments: seekRequest
});

function tokenFor(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}
function invalid(value, pattern) {
  assert.throws(() => transfer.decode("#catsroll-input=" + value), pattern);
}

invalid("%%%", /fragment encoding is malformed/);
invalid(tokenFor({version: 2, arguments: {}}), /unsupported version/);
invalid(tokenFor({version: 1, arguments: []}), /arguments must be an object/);
invalid(Buffer.from([0xff]).toString("base64url"), /valid UTF-8 JSON/);
assert.throws(() => transfer.decode("#catsroll-input=" + seekToken +
  "&catsroll-input=" + seekToken), /duplicate input fragments/);
invalid(tokenFor(JSON.parse('{"version":1,"arguments":{"constructor":{"x":1}}}')),
  /prototype-sensitive object key/);
invalid(Buffer.alloc(65_537, 0x61).toString("base64url"), /64 KiB/);

console.log("gpt-input-transfer: ok");
