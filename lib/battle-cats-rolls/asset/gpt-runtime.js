(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CatsrollGptRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function modifiedPool(event) {
    var original = event.pool;
    var pool = Object.assign({}, original, {
      cats: Object.assign({}, original.cats), slots: Object.assign({}, original.slots)
    });
    pool.slots[4] = (original.slots[4] || []).slice();
    for (var id = -1; id >= -(event.ubers || 0); id--) {
      pool.slots[4].unshift(id);
      pool.cats[id] = {name: ["(" + id + "?)"], rarity: 4};
    }
    if (event.forceGuaranteed) pool.guaranteed_rolls = event.forceGuaranteed;
    return pool;
  }

  function engines(deps) {
    if (deps) return deps;
    return {track: root.TrackEngine, find: root.MultiFindEngine};
  }

  function safeCat(cat, formIndex) {
    if (!cat) return null;
    var number = function (value) { return value && typeof value.number === "function" ? value.number() : null; };
    var result = {
      position: number(cat), id: cat.id, name: cat.pickName(formIndex) || String(cat.id),
      rarity: cat.rarity, rarityLabel: cat.scoreRarityLabel(), title: cat.pickTitle(formIndex),
      next: number(cat.next), seed: cat.seed
    };
    if (cat.rerolled) result.rerolled = safeCat(cat.rerolled, formIndex);
    if (cat.guaranteed) {
      result.guaranteed = {
        id: cat.guaranteed.id, name: cat.guaranteed.pickName(formIndex) || String(cat.guaranteed.id),
        position: number(cat.guaranteed), rarity: cat.guaranteed.rarity,
        rarityLabel: cat.guaranteed.scoreRarityLabel(), title: cat.guaranteed.pickTitle(formIndex),
        next: number(cat.guaranteed.next)
      };
    }
    return result;
  }

  function compute(mode, payload, deps, progress) {
    var api = engines(deps);
    var request = payload.request;
    if (!request || request.mode !== mode) throw new Error("계산 모드와 입력이 일치하지 않습니다.");
    var events = payload.events.map(function (event) {
      return Object.assign({}, event, {pool: modifiedPool(event)});
    });
    if (mode === "multi") {
      var rows = events.map(function (event) {
        var output = api.track.buildTracks(event.pool, request.seed, {
          count: request.count, position: "1A", last: request.last || 0,
          guaranteedRolls: event.pool.guaranteed_rolls, guaranteed: true, findCat: true,
          find: (request.targets || []).map(function (target) { return target.cat_id; })
        });
        var tracks = {A: [], B: []};
        output.cats.forEach(function (pair) {
          tracks.A.push(safeCat(pair[0], 0));
          tracks.B.push(safeCat(pair[1], 0));
        });
        return {lang: event.lang, event: event.event, label: event.label,
          displayName: event.displayName, tracks: tracks};
      });
      // Multi's conditional cross-banner R/G branches matter as much as base rows.
      var alternatives = api.find.buildTrackAlternatives(events.map(function (event) {
        return event.pool;
      }), request.seed, {count: request.count, last: request.last || 0, formIndex: 0});
      rows.forEach(function (row, index) { row.alternatives = alternatives[index]; });
      return {type: "multi", seed: request.seed, count: request.count, rows: rows,
        exclusiveIds: (api.track.EXCLUSIVES || []).slice(),
        dataVersion: payload.dataVersion};
    }
    if (mode === "find") {
      return api.find.search(Object.assign({}, request, {
        formIndex: 0, events: events, tickets: (payload.tickets || []).map(function (ticket) {
          return Object.assign({}, ticket, {pool: modifiedPool(ticket)});
        })
      }), {progress: progress || function () {}});
    }
    throw new Error("지원하지 않는 계산 모드입니다.");
  }

  async function seek(input, createModule, wasmBinary) {
    if (!input || !Array.isArray(input.rolls) || input.rolls.length < 2 ||
        input.rolls.length > 20 || input.rolls.length % 2 ||
        !Array.isArray(input.rates) || input.rates.length !== 4 ||
        !Array.isArray(input.slots) || input.slots.length !== 4) {
      throw new Error("시드 검색 입력을 확인해 주세요.");
    }
    input.rolls.forEach(function (value, index) {
      if (!Number.isInteger(value)) throw new Error("잘못된 뽑기 결과입니다.");
      if (index % 2 === 0 && (value < 2 || value > 5)) throw new Error("잘못된 희귀도입니다.");
      if (index % 2 && (value < 0 || value >= input.slots[input.rolls[index - 1] - 2])) {
        throw new Error("배너에 없는 뽑기 결과입니다.");
      }
    });
    var wasm = await createModule({wasmBinary: wasmBinary});
    var rollsPtr = wasm._malloc(input.rolls.length * 4);
    var outPtr = wasm._malloc(16);
    if (!rollsPtr || !outPtr) throw new Error("검색 메모리를 확보하지 못했습니다.");
    try {
      input.rolls.forEach(function (value, index) { wasm.setValue(rollsPtr + index * 4, value, "i32"); });
      wasm.ccall("seek_seed", null, Array(11).fill("number"),
        input.rates.concat(input.slots, [rollsPtr, input.rolls.length / 2, outPtr]));
      var read = function (index) { return wasm.getValue(outPtr + index * 4, "i32") >>> 0; };
      return {ok: true, status: read(0), begin: read(1), end: read(2), count: read(3)};
    } finally {
      wasm._free(rollsPtr);
      wasm._free(outPtr);
    }
  }

  function start(mode, payload, options) {
    options = options || {};
    if (typeof root.Worker !== "function") throw new Error("이 환경에서는 기기 계산을 실행할 수 없습니다.");
    var url = root.URL.createObjectURL(new root.Blob([options.source], {type: "application/javascript"}));
    var worker;
    try { worker = new root.Worker(url); }
    catch (error) { root.URL.revokeObjectURL(url); throw error; }
    var settled = false;
    var rejectRun;
    var startupTimer;
    var clean = function () {
      root.clearTimeout(startupTimer);
      worker.terminate();
      root.URL.revokeObjectURL(url);
    };
    var promise = new Promise(function (resolve, reject) {
      rejectRun = reject;
      var finish = function (error, result) {
        if (settled) return;
        settled = true;
        clean();
        if (error) reject(error); else resolve(result);
      };
      startupTimer = root.setTimeout(function () {
        finish(new Error("계산 Worker를 시작하지 못했습니다. ChatGPT 보안 정책과 브라우저 지원을 확인해 주세요."));
      }, 15000);
      worker.onmessage = function (event) {
        var message = event.data || {};
        if (message.type === "ready") root.clearTimeout(startupTimer);
        if (message.type === "progress" && options.onProgress) options.onProgress(message.progress);
        if (message.type === "result") finish(null, message.result);
        if (message.type === "error") finish(new Error(message.message));
      };
      worker.onerror = function (event) { finish(new Error(event.message || "Worker 실행 오류")); };
      worker.postMessage({mode: mode, payload: payload});
    });
    return {promise: promise, cancel: function () {
      if (settled) return;
      settled = true;
      clean();
      var error = new Error("계산을 취소했습니다.");
      error.name = "AbortError";
      rejectRun(error);
    }};
  }

  return {compute: compute, seek: seek, start: start, modifiedPool: modifiedPool};
});
