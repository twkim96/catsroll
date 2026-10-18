(function (root, factory) {
  "use strict";
  var snapshot = typeof module === "object" && module.exports ?
    require("./gpt-snapshot.js") : root && root.CatsrollSnapshot;
  var api = factory(snapshot);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CatsrollGptResultSummary = api;
})(typeof self !== "undefined" ? self :
  (typeof globalThis !== "undefined" ? globalThis : this), function (snapshotApi) {
  "use strict";

  var DEFAULT_LIMIT = 60000;
  var ARRAY_PREFIX = "배너 배열: ";

  if (!snapshotApi || typeof snapshotApi.capture !== "function") {
    throw new Error("CatsrollSnapshot must load before CatsrollGptResultSummary");
  }

  function safeString(value) {
    return value == null ? "" : String(value);
  }

  function countDigitDelta(total, current) {
    return String(current + 1).length + String(total - current - 1).length -
      String(current).length - String(total - current).length;
  }

  function jsonLine(label, value) {
    var stack = [];
    function plain(item, depth) {
      if (item == null || typeof item === "string" ||
          typeof item === "boolean") return item;
      if (typeof item === "number") return isFinite(item) ? item : null;
      if (typeof item === "function" || typeof item === "undefined") return null;
      if (depth > 16) return "[깊이 제한]";
      if (stack.indexOf(item) !== -1) return "[순환 참조 생략]";
      stack.push(item);
      var output;
      if (Array.isArray(item)) {
        output = item.map(function (child) { return plain(child, depth + 1); });
      } else {
        output = {};
        Object.keys(item).forEach(function (key) {
          output[key] = plain(item[key], depth + 1);
        });
      }
      stack.pop();
      return output;
    }
    return label + JSON.stringify(plain(value, 0));
  }

  function build(input) {
    input = input || {};
    return buildCaptured(snapshotApi.capture(input), input.maxChars);
  }

  function capturedBannerEnvelope(banner, rowCount, alternativeCount, includeNames) {
    return {
      banner: safeString(banner.banner),
      lang: safeString(banner.lang),
      ...(banner.guarantee ? {guarantee: banner.guarantee} : {}),
      rowsTotal: Number(banner.rowsTotal) || 0,
      rowsIncluded: rowCount,
      rowsOmitted: (Number(banner.rowsTotal) || 0) - rowCount,
      conditionalTotal: Number(banner.conditionalTotal) || 0,
      conditionalIncluded: alternativeCount,
      conditionalOmitted: (Number(banner.conditionalTotal) || 0) - alternativeCount,
      names: includeNames ? banner.names || {} : {},
      rarities: includeNames ? banner.rarities || {} : {},
      rows: (banner.rows || []).slice(0, rowCount),
      conditional: (banner.conditional || []).slice(0, alternativeCount)
    };
  }

  function appendCapturedArrays(lines, banners, limit, essentialLength) {
    var suffix = "\n상태와 생략 수는 위에 표시한 계산 결과를 기준으로 설명하세요. 생략된 배열이나 경로를 추정하지 마세요.";
    var records = banners.map(function (banner) {
      return {banner: banner, rows: 0, alternatives: 0};
    });
    var fixed = records.reduce(function (sum, record) {
      return sum + ARRAY_PREFIX.length + JSON.stringify(capturedBannerEnvelope(
        record.banner, 0, 0, true)).length + 1;
    }, 0);
    var available = limit - essentialLength - fixed - suffix.length;
    var spent = 0;
    function tryAdd(record, key, value, total) {
      var old = record[key];
      var delta = JSON.stringify(value).length + (old ? 1 : 0) +
        countDigitDelta(total, old);
      if (spent + delta > available) return false;
      spent += delta;
      record[key] += 1;
      return true;
    }
    var progressed = true;
    while (progressed) {
      progressed = false;
      records.forEach(function (record) {
        if (record.rows >= (record.banner.rows || []).length) return;
        if (tryAdd(record, "rows", record.banner.rows[record.rows],
            Number(record.banner.rowsTotal) || 0)) progressed = true;
      });
    }
    progressed = true;
    while (progressed) {
      progressed = false;
      records.forEach(function (record) {
        if (record.alternatives >= (record.banner.conditional || []).length) return;
        if (tryAdd(record, "alternatives",
            record.banner.conditional[record.alternatives],
            Number(record.banner.conditionalTotal) || 0)) progressed = true;
      });
    }
    records.forEach(function (record) {
      lines.push(jsonLine(ARRAY_PREFIX, capturedBannerEnvelope(record.banner,
        record.rows, record.alternatives, true)));
    });
  }

  function compactCapturedFind(find) {
    find = find && typeof find === "object" ? find : {};
    var actions = Array.isArray(find.actions) ? find.actions : [];
    var compact = {};
    ["status", "message", "destination", "optimization", "totalDraws",
      "targetAcquired", "targetTotal", "regularActions", "ticketActions",
      "guaranteedActions", "cost", "rawCost", "uberDraws"].forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(find, key)) compact[key] = find[key];
    });
    compact.actionCount = actions.length;
    compact.actionsIncluded = 0;
    compact.omittedActions = actions.length;
    return compact;
  }

  function modelFind(find) {
    if (!find || typeof find !== "object") return find;
    var result = Object.assign({}, find);
    if (Object.prototype.hasOwnProperty.call(result, "nextOffset")) {
      result.engine_position = {next_track_offset: result.nextOffset};
      delete result.nextOffset;
    }
    return result;
  }

  function compactCapturedPlan(plan) {
    plan = plan && typeof plan === "object" ? plan : {};
    var compact = {enabled: plan.enabled === true};
    if (Object.prototype.hasOwnProperty.call(plan, "name")) compact.name = plan.name;
    ["progress", "marks", "route", "cats"].forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(plan, key)) {
        var value = plan[key];
        compact[key + "Count"] = Array.isArray(value) ? value.length :
          (value && typeof value === "object" ? Object.keys(value).length :
            (value == null || value === "" ? 0 : 1));
        compact["omitted" + key.charAt(0).toUpperCase() + key.slice(1)] = compact[key + "Count"];
      }
    });
    return compact;
  }

  function buildCaptured(snapshot, maxChars) {
    var limit = Math.min(DEFAULT_LIMIT, Number(maxChars) > 0 ? Math.floor(maxChars) : DEFAULT_LIMIT);
    snapshot = snapshot || {};
    if (snapshot.kind === "seek") {
      var result = snapshot.result || {};
      var seekLines = ["Catsroll 기기 계산 결과", "시드 찾기 계산 완료 스냅샷 (prepared는 계산 전 상태)",
        jsonLine("시드 찾기 입력: ", snapshot.input), "데이터 버전: " + safeString(snapshot.data_version),
        jsonLine("시드 찾기 결과: ", result)];
      if (result.status === "success") seekLines.push("시작 시드 " + result.begin + ", 관측 후 시드 " + result.end);
      else seekLines.push(result.status === "ambiguous" ? "모호한 후보 2개 이상. 확정 시드가 아닙니다." : "일치하는 시드 없음.");
      seekLines.push("계산은 사용자 기기에서 실행했으며 서버에 결과를 저장하지 않았습니다.");
      return seekLines.join("\n").slice(0, limit);
    }
    var input = snapshot.input || {};
    var track = input.track || {};
    var banners = Array.isArray(snapshot.banners) ? snapshot.banners : [];
    var lines = [
      "Catsroll 기기 계산 결과",
      "예상 배열 계산 상태: completed. 아래는 사용자 기기에서 이미 계산한 결과이며 다시 계산하지 않습니다.",
      "출처: 공유 버튼을 누른 시점에 고정한 결과 스냅샷입니다.",
      "데이터 버전: " + safeString(snapshot.data_version || "미제공"),
      jsonLine("입력: ", input),
      jsonLine("Find 계산: ", snapshot.find == null ? null : modelFind(snapshot.find)),
      jsonLine("플랜: ", snapshot.plan == null ? null : snapshot.plan)
    ];
    (Array.isArray(track.rows) ? track.rows : []).filter(function (row) {
      return row && row.previewFor;
    }).forEach(function (row) {
      lines.push("참고 시뮬레이션: " + safeString(row.lang).toUpperCase() + " " +
        safeString(row.event) + " 풀을 " + safeString(row.previewFor).toUpperCase() +
        "용으로 가정했습니다. 출처 기간은 미래 복각 일정이 아니며 실제 풀·배열은 미확정입니다.");
    });
    lines.push("배열 표기: names는 ID→이름, rarities는 ID→희귀도(2 레어, 3 슈레, 4 울슈레, 5 레레)입니다. 사전에 없는 희귀도는 미제공입니다. rows는 1행부터 A/B 칸이며 각 셀은 [ID, 결과위치, 다음위치, R, G], R은 [ID, 결과위치, 다음위치, G], G는 [ID, 결과위치, 다음위치]입니다. conditional 항목은 [기준위치,[kind,variant,ID,결과표시,rerolled,guaranteed,뽑기후위치,다음위치,prerequisite,lastRareId]]이고 prerequisite는 [배너열,위치,이름,종류]입니다. 이 조건을 만족하는 분기만 선택할 수 있습니다.");
    lines.push("Find 경로 표기: action.catId의 이름·희귀도는 actionCats 사전에 있습니다. 생략된 acquired는 빈 목록이며 rerolled/avoidedR/defense는 false, rerollSteps/uberDraws/legendDraws/harvestDraws는 0입니다. originalCatId가 없으면 catId와 같고 start가 없으면 resultLabel과 같습니다. action.context는 actionContexts의 0기준 인덱스로 배너·일정을 연결합니다. 단뽑·티켓은 자체 resultLabel/next, 확정 묶음은 routePulls에 각 뽑기 위치가 있습니다. 연속 일반 뽑기만 묶었으며 count와 actionStart/actionEnd는 원래 액션 수와 1기준 인덱스입니다. ticket은 1회, guaranteed는 pulls 수만큼 실제 뽑기로 셉니다. cost 계열은 엔진의 상대 비교 가중치이며 게임 재화가 아닙니다. uberDraws는 경로에서 얻은 울슈레 수이고 입력의 미래 울슈레 수와 다릅니다. Find 계산 요약의 nextOffset은 엔진 트랙 진행 위치이며 페이지 커서가 아닙니다. 경로 추가 조회에는 catsroll_result(view=route) 응답의 nextOffset만 offset으로 사용하세요.");
    var essentialLength = lines.join("\n").length;
    appendCapturedArrays(lines, banners, limit, essentialLength);
    lines.push("상태와 생략 수는 위에 표시한 계산 결과를 기준으로 설명하세요. 생략된 배열이나 경로를 추정하지 마세요.");
    var output = lines.join("\n");
    if (output.length <= limit) return output;

    // If a route or plan alone fills the budget, keep complete fields only and
    // report every omitted category. The downloadable capture remains intact.
    var base = [lines[0], lines[1], lines[2], lines[3]];
    var omissions = [];
    var reserve = 1200;
    lines.slice(4).filter(function (line) {
      return line.indexOf(ARRAY_PREFIX) !== 0 && line.indexOf("상태와 생략 수") !== 0;
    }).forEach(function (line) {
      var label = line.indexOf("입력: ") === 0 ? "입력" :
        line.indexOf("Find 계산: ") === 0 ? "Find 계산" :
        line.indexOf("플랜: ") === 0 ? "플랜" :
        line.indexOf("참고 시뮬레이션:") === 0 ? "참고 시뮬레이션" : "설명";
      if (base.join("\n").length + line.length + reserve < limit) base.push(line);
      else {
        if (label === "Find 계산") base.push(jsonLine("Find 계산: ", compactCapturedFind(snapshot.find)));
        if (label === "플랜") base.push(jsonLine("플랜: ", compactCapturedPlan(snapshot.plan)));
        if (omissions.indexOf(label) < 0) omissions.push(label);
      }
    });
    banners.forEach(function (banner, index) {
      var envelope = capturedBannerEnvelope(banner, 0, 0, false);
      if (envelope.banner.length > 128) envelope.banner = "배너 " + (index + 1) + " (이름 생략)";
      var line = jsonLine(ARRAY_PREFIX, envelope);
      if (base.join("\n").length + line.length + 400 < limit) base.push(line);
      else omissions.push("배너 " + (index + 1) + " 배열 메타데이터");
    });
    var notice = "요약 한도 " + limit + "자를 지키기 위해 전체 필드를 생략했습니다" +
      (omissions.length ? ". 생략: " + omissions.join(", ") : "") +
      ". 전체 캡처는 아래 JSON 내보내기에 보존되어 있습니다.";
    var bounded = base.concat([notice,
      "상태와 생략 수는 위에 표시한 계산 결과를 기준으로 설명하세요. 생략된 배열이나 경로를 추정하지 마세요."]).join("\n");
    if (bounded.length <= limit) return bounded;

    // Preserve a compact calculation state even when the full Find route or
    // plan cannot fit in the transport summary. The JSON export stays complete.
    var compactFind = "Find 요약: " + JSON.stringify(compactCapturedFind(snapshot.find));
    var compactPlan = "플랜 요약: " + JSON.stringify(compactCapturedPlan(snapshot.plan));
    var compactLines = [lines[0], lines[1], lines[2], lines[3], compactFind, compactPlan,
      "요약 한도 " + limit + "자를 지키기 위해 입력·Find 액션·플랜 세부정보·배열 일부를 생략했습니다. 전체 캡처 JSON에는 원래 값이 보존되어 있습니다.",
      "상태와 생략 수는 위 계산 결과를 기준으로 설명하세요. 생략된 값을 추정하지 마세요."];
    var compactOutput = compactLines.join("\n");
    if (compactOutput.length <= limit) return compactOutput;
    // Current validated inputs are far below this fallback, but keep the
    // transport limit hard even for malformed direct callers.
    var minimal = "요약 한도 " + limit + "자: Find 상태·액션 수와 플랜 상태를 축약했습니다. 전체 캡처는 JSON에 보존됩니다.";
    return minimal.length <= limit ? minimal : minimal.slice(0, limit);
  }

  return { build: build, capture: snapshotApi.capture, buildCaptured: buildCaptured };
});
