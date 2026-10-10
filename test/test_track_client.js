"use strict";

const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync(require.resolve(
  "../lib/battle-cats-rolls/asset/track-client.js"), "utf8");
const start = source.indexOf("    global.roll = function (element) {");
const end = source.indexOf("    global.pick = function (position)", start);
assert(start >= 0 && end > start);

let clientEnabled = true;
let assigned = null;
let navigated = null;
let regionChange = null;
let originalElement = null;
const context = {
  global: {
    location: {
      pathname: "/",
      search: "",
      assign(url) { assigned = url; }
    }
  },
  enabled() { return clientEnabled; },
  originalRoll(element) { originalElement = element; },
  handleRegionChange(element) { regionChange = element; },
  navigate(query) { navigated = query; },
  URLSearchParams,
  FormData: function (form) { return form.values; }
};
vm.runInNewContext(source.slice(start, end), context);

function form(banner, seriesIds) {
  return {
    elements: {banner: {value: banner}},
    values: [["seed", "12345"], ["banner", banner], ["lang", "kr"],
      ...seriesIds.map(id => ["event_series", String(id)])],
    querySelector() { return seriesIds.length ? {} : null; }
  };
}

context.global.roll({name: "banner", form: form("24", [24, 28])});
let params = new URL(assigned, "https://example.test").searchParams;
assert.strictEqual(params.get("banner"), "24");
assert.deepStrictEqual(params.getAll("event_series"), ["24", "28"]);
assert.strictEqual(params.get("compute"), "client");
assert.strictEqual(params.get("seed"), "12345");
assert.strictEqual(navigated, null,
  "changing Banner rebuilds the server-owned menu instead of only rerolling tracks");

assigned = null;
context.global.roll({name: "banner", form: form("", [24])});
params = new URL(assigned, "https://example.test").searchParams;
assert.strictEqual(params.get("banner"), "");
assert.deepStrictEqual(params.getAll("event_series"), ["24"],
  "clearing Banner keeps the local filter");

for (const filteredForm of [form("", [24]), form("24", [])]) {
  assigned = null;
  context.global.roll({name: "lang", form: filteredForm});
  assert(assigned, "region changes rebuild menus when either filter is active");
}
assert.strictEqual(regionChange, null);

assigned = null;
const unfilteredRegion = {name: "lang", form: form("", [])};
context.global.roll(unfilteredRegion);
assert.strictEqual(regionChange, unfilteredRegion,
  "unfiltered region changes keep the existing client path");
assert.strictEqual(assigned, null);

context.global.roll({name: "event", form: form("24", [24])});
assert(navigated, "event changes still render tracks on the client");
assert.strictEqual(assigned, null);

clientEnabled = false;
const serverBanner = {name: "banner", form: form("24", [24])};
context.global.roll(serverBanner);
assert.strictEqual(originalElement, serverBanner,
  "server compute mode keeps the original navigation handler");

console.log("track-client: ok");
