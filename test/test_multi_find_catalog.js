"use strict";

const assert = require("assert");
const catalog = require(
  "../lib/battle-cats-rolls/asset/multi-find-catalog.js");

const cats = [
  { id: 1, name: "나비 고양이" },
  { id: 2, name: "가시루가" },
  { id: 3, name: "다크 캣" },
  { id: 4, name: "가네샤" },
  { id: 5, name: "플래티넘 전용" },
  { id: 6, name: "기타 고양이" }
];
const series = [
  { id: 21, label: "플래티넘 뽑기", cat_ids: [1, 2, 3, 4, 5] },
  { id: 2, label: "중간 시리즈", cat_ids: [2, 3, 4] },
  { id: 1, label: "작은 시리즈", cat_ids: [1, 2] }
];

const groups = catalog.organize(cats, series, [21], [1, 2, 3, 4, 5]);
assert.deepStrictEqual(groups.map((group) => group.id), [1, 2, 21, null]);
assert.deepStrictEqual(groups[0].cats.map((cat) => cat.id), [2, 1]);
assert.deepStrictEqual(groups[1].cats.map((cat) => cat.id), [4, 3]);
assert.deepStrictEqual(groups[2].cats.map((cat) => cat.id), [5]);
assert.deepStrictEqual(groups[3].cats.map((cat) => cat.id), [6]);

const renderedIds = groups.flatMap((group) => group.cats.map((cat) => cat.id));
assert.strictEqual(renderedIds.length, cats.length);
assert.strictEqual(new Set(renderedIds).size, cats.length);
assert.strictEqual(groups[0].selected, true);
assert.strictEqual(groups[1].selected, true);
assert.strictEqual(groups[2].selected, true);
assert.strictEqual(groups[3].selected, false);

console.log("multi-find-catalog: ok");
