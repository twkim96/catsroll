"use strict";

const assert = require("assert");
const search = require(
  "../lib/battle-cats-rolls/asset/event-series-search.js");

const prepared = search.prepareCatalog({
  series: [
    { id: 1, label: "다이너마이트 군단",
      aliases: ["고양이 아이스 크리스탈"] },
    { id: 2, label: "울트라 하이퍼 고양이 축제",
      aliases: ["고양이 아이스 크리스탈", "에이전트 스탈"] },
    { id: 3, label: "에이전트 스탈 특별 뽑기",
      aliases: ["에이전트 스탈"] }
  ],
  characters: [
    { id: 43, rarity: 4, name: "고양이 아이스",
      names: ["고양이 아이스", "고양이 아이스 크리스탈"],
      aliases: ["얼음냥이"],
      series_ids: [1, 2] },
    { id: 811, rarity: 4, name: "에이전트 스탈",
      names: ["에이전트 스탈", "블레이드 마스터 스탈"],
      series_ids: [2, 3] }
  ]
});

assert.deepStrictEqual(
  search.filterSeries(prepared.series, "스탈", []).map((item) => item.id),
  [1, 2, 3],
  "plain text keeps the existing partial-match behavior");

const suggestions = search.suggestCharacters(
  prepared.characters, "스탈", [], 10);
assert.deepStrictEqual(suggestions.map((item) => item.character.id), [811, 43],
  "a word-start character match sorts ahead of an inner-word match");
assert.strictEqual(suggestions[0].name, "에이전트 스탈");
assert.strictEqual(suggestions[1].name, "고양이 아이스 크리스탈");
const nickname = search.suggestCharacters(prepared.characters, "얼음냥이", [], 10);
assert.deepStrictEqual(nickname.map(item => item.character.id), [43]);
assert.strictEqual(nickname[0].name, "고양이 아이스", "aliases preserve the canonical display name");

const festivals = search.prepareCatalog({series:[
  {id:27,label:"하이퍼 고양이 축제",aliases:["하고축"]},
  {id:42,label:"울트라 하이퍼 고양이 축제",aliases:["울하고축"]}
]}).series;
assert.deepStrictEqual(search.filterSeries(festivals,"하고축",[]).map(item=>item.id),[27]);
assert.deepStrictEqual(search.filterSeries(festivals,"울하고축",[]).map(item=>item.id),[42]);
assert.deepStrictEqual(search.filterSeries(festivals,"고축",[]).map(item=>item.id),[27,42],
  "partial searches remain available when no exact alias matches");
assert.deepStrictEqual(search.filterSeries(festivals,"하고축",[{seriesIds:[42]}]),[],
  "a conflicting character selection must not fall back to a different festival");

const agent = prepared.characters.find((item) => item.id === 811);
const ice = prepared.characters.find((item) => item.id === 43);
assert.deepStrictEqual(
  search.filterSeries(prepared.series, "", [agent]).map((item) => item.id),
  [2, 3],
  "a selected character uses its exact id membership");
assert.deepStrictEqual(
  search.filterSeries(prepared.series, "", [agent, ice]).map((item) => item.id),
  [2],
  "multiple selected character chips use AND semantics");
assert.deepStrictEqual(
  search.filterSeries(prepared.series, "특별", [agent]).map((item) => item.id),
  [3],
  "free text is ANDed with exact character chips");

console.log("event-series-search: ok");
