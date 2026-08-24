"use strict";

const assert = require("assert");
const catalog = require(
  "../lib/battle-cats-rolls/asset/multi-find-catalog.js");

const cats = [
  { id: 1, name: "나비 고양이", rarity: 3 },
  { id: 2, name: "가시루가", rarity: 4 },
  { id: 3, name: "다크 캣", rarity: 3 },
  { id: 4, name: "가네샤", rarity: 5 },
  { id: 5, name: "플래티넘 전용", rarity: 4 },
  { id: 6, name: "기타 고양이", rarity: 3 }
];
const series = [
  { id: 21, label: "플래티넘 뽑기", aliases: ["플뽑"],
    cat_ids: [1, 2, 3, 4, 5] },
  { id: 2, label: "중간 시리즈", cat_ids: [2, 3, 4] },
  { id: 1, label: "작은 시리즈", aliases: ["울소"], cat_ids: [1, 2] }
];
const selected = [
  { key: "selected:0", id: 21, label: "첫 번째 비교", aliases: ["플뽑"],
    cat_ids: [1, 2, 3, 4, 5] },
  { key: "selected:1", id: 21, label: "두 번째 비교", aliases: ["플뽑"],
    cat_ids: [1, 2] }
];

const groups = catalog.organize(cats, series, selected);
assert.deepStrictEqual(groups.map((group) => group.id),
  [21, 21, 1, 2, 21, null]);
assert.deepStrictEqual(groups.slice(0, 2).map((group) => group.label),
  ["두 번째 비교", "첫 번째 비교"]);
assert.deepStrictEqual(groups[0].cats.map((cat) => cat.id), [2, 1]);
assert.deepStrictEqual(groups[1].cats.map((cat) => cat.id), [4, 2, 5, 1, 3]);
assert.deepStrictEqual(groups[2].cats.map((cat) => cat.id), [2, 1]);
assert.deepStrictEqual(groups[3].cats.map((cat) => cat.id), [4, 2, 3]);
assert.deepStrictEqual(groups[4].cats.map((cat) => cat.id), [4, 2, 5, 1, 3]);
assert.deepStrictEqual(groups[5].cats.map((cat) => cat.id), [6]);

const renderedIds = groups.flatMap((group) => group.cats.map((cat) => cat.id));
assert.strictEqual(renderedIds.length, 18);
assert.strictEqual(new Set(renderedIds).size, cats.length);
assert.strictEqual(groups[0].selected, true);
assert.strictEqual(groups[1].selected, true);
assert.strictEqual(groups[2].selected, false);
assert.strictEqual(groups[3].selected, false);
assert.strictEqual(groups[4].selected, false);
assert.strictEqual(renderedIds.filter((id) => id === 2).length, 5);
assert.strictEqual(groups[2].search.indexOf("울소") !== -1, true);
assert.strictEqual(groups[2].cats.every((cat) =>
  catalog.matches(groups[2], cat, "울소")), true);
assert.strictEqual(catalog.matches(groups[2], groups[2].cats[0],
  "울소 가시루가"), true);
assert.strictEqual(catalog.matches(groups[2], groups[2].cats[0], "플뽑"), false);

console.log("multi-find-catalog: ok");
