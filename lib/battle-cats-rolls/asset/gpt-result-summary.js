(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CatsrollGptResultSummary = api;
})(typeof self !== "undefined" ? self :
  (typeof globalThis !== "undefined" ? globalThis : this), function () {
  "use strict";

  var DEFAULT_LIMIT = 60000;
  var ARRAY_PREFIX = "배너 배열: ";

  function safeString(value) {
    return value == null ? "" : String(value);
  }

  function numberOf(cat) {
    if (!cat || typeof cat.number !== "function") return null;
    try { return cat.number(); } catch (_error) { return null; }
  }

  function nameOf(cat, formIndex) {
    if (!cat) return null;
    if (typeof cat.pickName === "function") {
      try { return safeString(cat.pickName(formIndex || 0)); }
      catch (_error) { /* use the ID below */ }
    }
    return cat.id == null ? null : safeString(cat.id);
  }

  function addName(names, cat, formIndex) {
    if (!cat || cat.id == null) return;
    var key = safeString(cat.id);
    var name = nameOf(cat, formIndex);
    if (name != null && !Object.prototype.hasOwnProperty.call(names, key)) {
      names[key] = name;
    }
  }

  function compactLinked(cat, names, formIndex, includeGuaranteed) {
    if (!cat) return null;
    addName(names, cat, formIndex);
    var linked = [cat.id == null ? null : cat.id, numberOf(cat), numberOf(cat.next)];
    if (includeGuaranteed && cat.guaranteed) {
      linked.push(compactLinked(cat.guaranteed, names, formIndex, false));
    }
    return linked;
  }

  function compactCell(cat, names, formIndex) {
    if (!cat) return null;
    addName(names, cat, formIndex);
    var reroll = cat.rerolled ?
      compactLinked(cat.rerolled, names, formIndex, true) : null;
    var guaranteed = cat.guaranteed ?
      compactLinked(cat.guaranteed, names, formIndex, false) : null;
    return [cat.id == null ? null : cat.id, numberOf(cat), numberOf(cat.next),
      reroll, guaranteed];
  }

  function compactRow(pair, names, formIndex) {
    pair = Array.isArray(pair) ? pair : [];
    return [compactCell(pair[0], names, formIndex),
      compactCell(pair[1], names, formIndex)];
  }

  function compactAlternative(entry, names) {
    if (!entry) return null;
    var pull = entry.pull || {};
    if (pull.id != null && pull.name != null) names[safeString(pull.id)] =
      safeString(pull.name);
    var prerequisite = entry.prerequisite || null;
    return [safeString(entry.kind), entry.variant == null ? null :
      safeString(entry.variant), pull.id == null ? null : pull.id,
      pull.resultLabel == null ? null : safeString(pull.resultLabel),
      !!pull.rerolled, !!pull.guaranteed,
      pull.next == null ? null : safeString(pull.next),
      entry.next == null ? null : safeString(entry.next),
      prerequisite ? [prerequisite.column, prerequisite.position == null ? null :
        safeString(prerequisite.position), prerequisite.name == null ? null :
        safeString(prerequisite.name), prerequisite.kind == null ? null :
        safeString(prerequisite.kind)] : null,
      entry.lastRareId == null ? null : entry.lastRareId];
  }

  function collectAlternatives(source) {
    var result = [];
    if (!source || typeof source !== "object") return result;
    Object.keys(source).sort().forEach(function (position) {
      var entries = source[position];
      if (!Array.isArray(entries)) return;
      entries.forEach(function (entry) {
        var names = Object.create(null);
        result.push({ value: [position, compactAlternative(entry, names)],
          names: names });
      });
    });
    return result;
  }

  function buildBanners(input) {
    var banners = [];
    var outputs = Array.isArray(input.outputs) ? input.outputs : [];
    var formIndex = input.track && input.track.formIndex || 0;
    outputs.forEach(function (item, index) {
      if (!item || !item.out || !Array.isArray(item.out.cats)) return;
      var rowNames = [];
      var rows = item.out.cats.map(function (pair) {
        var names = Object.create(null);
        var row = compactRow(pair, names, formIndex);
        rowNames.push(names);
        return row;
      });
      var alternatives = collectAlternatives(item.alternatives);
      banners.push({
        label: item.label == null ? "배너 " + (index + 1) : safeString(item.label),
        lang: safeString(item.row && item.row.lang),
        totalRows: rows.length,
        rows: rows,
        alternatives: alternatives,
        rowNames: rowNames
      });
    });
    return banners;
  }

  function actionPulls(action) {
    if (Array.isArray(action.routePulls)) return action.routePulls;
    if (action.type === "roll" || action.type === "ticket") {
      return [{ resultLabel: action.resultLabel, rerolled: !!action.rerolled,
        guaranteed: false }];
    }
    return [];
  }

  function actionDraws(action, pulls) {
    if (action.type === "roll" || action.type === "ticket") return 1;
    if (action.type === "guaranteed") {
      return Math.max(0, Number(action.pulls) || pulls.length);
    }
    return 0;
  }

  function acquiredForAction(action, actionIndex, drawStart, pulls, draws) {
    return (Array.isArray(action.acquired) ? action.acquired : []).map(function (item) {
      var found = -1;
      for (var index = 0; index < pulls.length; index += 1) {
        if (item && item.resultLabel != null &&
            pulls[index] && pulls[index].resultLabel === item.resultLabel) {
          found = index;
          break;
        }
      }
      var output = {
        actionIndex: actionIndex,
        targetIndex: item && item.targetIndex,
        catId: item && item.catId,
        catName: item && item.catName,
        resultLabel: item && item.resultLabel
      };
      if (found >= 0 && drawStart + found < drawStart + draws) {
        output.drawNumber = drawStart + found;
      } else {
        output.drawRange = draws ? [drawStart, drawStart + draws - 1] : null;
      }
      return output;
    });
  }

  function copyAction(action, index) {
    var output = { actionIndex: index, type: action.type };
    ["ticketKind", "lang", "event", "eventLabel", "scheduleDay",
      "scheduleStartDay", "scheduleEndDay", "start", "resultLabel",
      "next", "catId", "catName", "rarity", "rerolled", "rerollSteps",
      "originalCatId", "originalCatName", "avoidedR", "defense", "pulls",
      "guaranteedLabel", "uberDraws", "legendDraws", "harvestDraws", "cost"]
      .forEach(function (key) {
        if (action[key] !== undefined) output[key] = action[key];
      });
    if (action.type === "guaranteed") output.routePulls = actionPulls(action).map(function (pull) {
      var item = {};
      ["resultLabel", "rerolled", "guaranteed"].forEach(function (key) {
        if (pull && pull[key] !== undefined) item[key] = pull[key];
      });
      return item;
    });
    output.acquired = Array.isArray(action.acquired) ? action.acquired.map(function (item) {
      return item ? {
        targetIndex: item.targetIndex,
        catId: item.catId,
        catName: item.catName,
        resultLabel: item.resultLabel
      } : null;
    }) : [];
    return output;
  }

  function sameBatch(first, next) {
    return first && next && first.type === "roll" && next.type === "roll" &&
      first.lang === next.lang && first.event === next.event &&
      first.scheduleDay === next.scheduleDay && first.next === next.start;
  }

  function plainRoll(action) {
    return action && action.type === "roll" && Number(action.rarity) < 4 &&
      !action.rerolled && !action.avoidedR &&
      !(Array.isArray(action.acquired) && action.acquired.length);
  }

  function compactFind(find, enabled) {
    var source = enabled && find ? find : null;
    var actions = source && Array.isArray(source.actions) ? source.actions : [];
    var route = [];
    var acquired = [];
    var drawCursor = 1;
    var regularActions = 0, ticketActions = 0, guaranteedActions = 0;
    var totalDraws = 0;

    actions.forEach(function (action, index) {
      var pulls = actionPulls(action);
      var draws = actionDraws(action, pulls);
      acquired = acquired.concat(acquiredForAction(action, index + 1,
        drawCursor, pulls, draws));
      drawCursor += draws;
      totalDraws += draws;
      if (action.type === "roll") regularActions += 1;
      else if (action.type === "ticket") ticketActions += 1;
      else if (action.type === "guaranteed") guaranteedActions += 1;
    });

    for (var index = 0; index < actions.length;) {
      var action = actions[index];
      if (plainRoll(action)) {
        var end = index;
        while (end + 1 < actions.length && plainRoll(actions[end + 1]) &&
            sameBatch(actions[end], actions[end + 1])) end += 1;
        if (end > index) {
          route.push({
            type: "rollBatch",
            lang: action.lang,
            event: action.event,
            eventLabel: action.eventLabel,
            scheduleDay: action.scheduleDay,
            count: end - index + 1,
            start: action.start,
            next: actions[end].next,
            actionStart: index + 1,
            actionEnd: end + 1
          });
        } else {
          route.push(copyAction(action, index + 1));
        }
        index = end + 1;
      } else {
        route.push(copyAction(action, index + 1));
        index += 1;
      }
    }

    var result;
    if (!enabled) {
      result = { enabled: false, status: "not_requested" };
    } else if (!source) {
      result = { enabled: true, status: "unavailable",
        message: "Find 계산 결과가 입력에 없습니다." };
    } else {
      result = {};
      ["status", "message", "destination", "nextOffset", "optimization",
        "cost", "scoreUnits", "costUnits", "rawCost", "baseCost",
        "regularUnitCost", "balanceCredit", "harvestDraws", "paretoBaseCost",
        "paretoAllowance", "paretoBudget", "paretoPrunedTargetCost",
        "paretoPrunedTargetCapacity", "paretoPrunedHarvestBound", "uberDraws",
        "legendDraws", "regularUses", "ticketUses", "platinumUses",
        "legendTicketUses", "guaranteedUses", "targetAcquired", "targetTotal",
        "explored", "elapsedMs", "stateLimit"].forEach(function (key) {
        if (source[key] !== undefined) result[key] = source[key];
      });
      if (result.status === undefined) result.status = "unknown";
    }
    // Factor repeated banner/schedule context out of detailed actions. Long
    // routes with many notable pulls still retain every result without copying
    // the same event label and dates hundreds of times.
    var contexts = [];
    var actionCats = Object.create(null);
    var contextIds = Object.create(null);
    route.forEach(function (action) {
      if (action.type === "rollBatch") return;
      if (action.catId != null) {
        var catKey = safeString(action.catId);
        var catInfo = actionCats[catKey] || (actionCats[catKey] = {});
        if (action.catName != null) catInfo.name = action.catName;
        if (action.rarity != null) catInfo.rarity = action.rarity;
        delete action.catName;
        delete action.rarity;
      }
      if (action.originalCatId != null && action.originalCatName != null) {
        var originalKey = safeString(action.originalCatId);
        if (!actionCats[originalKey]) actionCats[originalKey] = {name: action.originalCatName};
        delete action.originalCatName;
        if (action.originalCatId === action.catId) delete action.originalCatId;
      }
      if (action.start === action.resultLabel) delete action.start;
      if (action.acquired && !action.acquired.length) delete action.acquired;
      ["rerolled", "avoidedR", "defense", "rerollSteps", "uberDraws", "legendDraws", "harvestDraws"].forEach(function (key) {
        if (action[key] === false || action[key] === 0) delete action[key];
      });
      var context = {};
      ["lang", "event", "eventLabel", "scheduleDay", "scheduleStartDay", "scheduleEndDay"].forEach(function (key) {
        if (action[key] !== undefined) { context[key] = action[key]; delete action[key]; }
      });
      var identity = JSON.stringify(context);
      if (contextIds[identity] === undefined) {
        contextIds[identity] = contexts.length;
        contexts.push(context);
      }
      action.context = contextIds[identity];
    });
    result.actionContexts = contexts;
    result.actionCats = actionCats;
    result.regularActions = regularActions;
    result.ticketActions = ticketActions;
    result.guaranteedActions = guaranteedActions;
    result.totalDraws = totalDraws;
    result.targetsAcquired = acquired;
    result.actions = route;
    return result;
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

  function bannerEnvelope(banner, rowCount, alternativeCount) {
    var names = Object.create(null);
    function merge(source) {
      if (!source) return;
      Object.keys(source).forEach(function (id) {
        if (!Object.prototype.hasOwnProperty.call(names, id)) names[id] = source[id];
      });
    }
    for (var rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      merge(banner.rowNames[rowIndex]);
    }
    for (var altIndex = 0; altIndex < alternativeCount; altIndex += 1) {
      merge(banner.alternatives[altIndex].names);
    }
    return {
      banner: banner.label,
      lang: banner.lang,
      rowsTotal: banner.totalRows,
      rowsIncluded: rowCount,
      rowsOmitted: banner.totalRows - rowCount,
      conditionalTotal: banner.alternatives.length,
      conditionalIncluded: alternativeCount,
      conditionalOmitted: banner.alternatives.length - alternativeCount,
      names: names,
      rows: banner.rows.slice(0, rowCount),
      conditional: banner.alternatives.slice(0, alternativeCount).map(function (item) {
        return item.value;
      })
    };
  }

  function baseEnvelopeSize(banner) {
    var prefix = ARRAY_PREFIX;
    var envelope = bannerEnvelope(banner, 0, 0);
    return prefix.length + JSON.stringify(envelope).length;
  }

  function nameEntryCost(names, additions) {
    var fresh = [];
    Object.keys(additions || {}).forEach(function (id) {
      if (!Object.prototype.hasOwnProperty.call(names, id)) fresh.push(id);
    });
    if (!fresh.length) return 0;
    var cost = fresh.reduce(function (sum, id) {
      return sum + JSON.stringify(id).length + 1 +
        JSON.stringify(additions[id]).length;
    }, 0);
    return cost + (Object.keys(names).length ? fresh.length : fresh.length - 1);
  }

  function mergeNames(target, source) {
    Object.keys(source || {}).forEach(function (id) {
      if (!Object.prototype.hasOwnProperty.call(target, id)) target[id] = source[id];
    });
  }

  function countDigitDelta(total, current) {
    return String(current + 1).length + String(total - current - 1).length -
      String(current).length - String(total - current).length;
  }

  function appendArrayLines(lines, banners, limit, essentialLength) {
    if (!banners.length) return;
    var records = banners.map(function (banner) {
      return { banner: banner, rows: 0, alternatives: 0,
        names: Object.create(null) };
    });
    var fixed = records.reduce(function (sum, record) {
      return sum + baseEnvelopeSize(record.banner) + 1;
    }, 0);
    var suffix = "\n상태와 생략 수는 위에 표시한 계산 결과를 기준으로 설명하세요. 생략된 배열이나 경로를 추정하지 마세요.";
    var available = limit - essentialLength - fixed - suffix.length;
    var spent = 0;

    function tryAdd(record, key, value, names) {
      var old = record[key];
      var banner = record.banner;
      var nameDelta = nameEntryCost(record.names, names);
      var valueCost = JSON.stringify(value).length + (old ? 1 : 0);
      var countDelta = key === "rows" ?
        countDigitDelta(banner.totalRows, old) :
        countDigitDelta(banner.alternatives.length, old);
      var added = valueCost + nameDelta + countDelta;
      if (spent + added > available) return false;
      spent += added;
      record[key] = old + 1;
      mergeNames(record.names, names);
      return true;
    }

    // Fill every base A/B row before spending the remaining budget on
    // conditional branches. Prefix inclusion keeps each banner's row ordinal
    // implicit and makes the omitted tail count exact.
    var progressed = true;
    while (progressed) {
      progressed = false;
      records.forEach(function (record) {
        if (record.rows >= record.banner.rows.length) return;
        var value = record.banner.rows[record.rows];
        if (tryAdd(record, "rows", value, record.banner.rowNames[record.rows])) {
          progressed = true;
        }
      });
    }
    progressed = true;
    while (progressed) {
      progressed = false;
      records.forEach(function (record) {
        if (record.alternatives >= record.banner.alternatives.length) return;
        var item = record.banner.alternatives[record.alternatives];
        if (tryAdd(record, "alternatives", item.value, item.names)) progressed = true;
      });
    }

    records.forEach(function (record) {
      lines.push(jsonLine(ARRAY_PREFIX, bannerEnvelope(record.banner,
        record.rows, record.alternatives)));
    });
  }

  function build(input) {
    input = input || {};
    var track = input.track || {};
    var enabled = input.findEnabled === true;
    var find = compactFind(input.find, enabled);
    var plan = input.plan == null ? null : input.plan;
    var inputTrack = {
      seed: track.seed,
      last: track.last,
      count: track.count,
      formIndex: track.formIndex,
      rows: Array.isArray(track.rows) ? track.rows.map(function (row) {
        var output = {};
        ["lang", "event", "ubers", "forceGuaranteed", "customName",
          "customNameAuto", "previewFor"].forEach(function (key) {
          if (row && row[key] !== undefined) output[key] = row[key];
        });
        if (row && Array.isArray(row.seriesIds)) output.seriesIds = row.seriesIds.slice();
        return output;
      }) : []
    };
    var inputSettings = null;
    if (input.findSettings != null) {
      inputSettings = {};
      ["optimization", "maxGuaranteed", "scheduleAware", "maxPlatinum",
        "maxLegendTicket"].forEach(function (key) {
        if (input.findSettings[key] !== undefined) inputSettings[key] = input.findSettings[key];
      });
      inputSettings.targets = Array.isArray(input.findSettings.targets) ?
        input.findSettings.targets.map(function (target) {
          return target ? { cat_id: target.cat_id,
            allow_ticket: target.allow_ticket === true } : null;
        }) : [];
    }
    var planSnapshot = null;
    if (plan != null) {
      planSnapshot = {};
      ["enabled", "name", "marks", "route", "cats", "progress"].forEach(function (key) {
        if (plan[key] !== undefined) planSnapshot[key] = plan[key];
      });
    }
    var lines = [
      "Catsroll 기기 계산 결과",
      "예상 배열 계산 상태: completed. 이전 catsroll_prepare의 prepared는 계산 전 상태이며, 아래는 사용자 기기에서 이미 계산한 결과입니다. 이 요약은 계산을 다시 실행하지 않습니다.",
      "출처: MultiTrackApp.getOutputs()의 계산 배열, MultiFindEngine 검색 결과, 현재 플랜 상태입니다.",
      "데이터 버전: " + safeString(input.dataVersion || "미제공"),
      jsonLine("입력: ", { track: inputTrack, findEnabled: enabled,
        findSettings: inputSettings }),
      jsonLine("Find 계산: ", find),
      jsonLine("플랜: ", planSnapshot)
    ];
    if (track.rows && Array.isArray(track.rows)) {
      track.rows.filter(function (row) { return row && row.previewFor; })
        .forEach(function (row) {
          lines.push("참고 시뮬레이션: " + safeString(row.lang).toUpperCase() + " " +
            safeString(row.event) + " 풀을 " + safeString(row.previewFor).toUpperCase() +
            "용으로 가정했습니다. 출처 기간은 해당 지역의 미래 복각 일정이 아니며 실제 풀·배열은 미확정입니다.");
        });
    }
    lines.push("배열 표기: names 사전은 ID에서 이름으로 연결합니다. rows는 1행부터 순서대로 A/B 칸이며 각 셀은 [ID, 결과위치, 다음위치, R, G], R은 [ID, 결과위치, 다음위치, G], G는 [ID, 결과위치, 다음위치] 형식입니다. R/G가 없으면 null입니다. conditional 항목은 [기준위치, [kind, variant, ID, 결과표시, rerolled, guaranteed, 뽑기후위치, 다음위치, prerequisite, lastRareId]]이고 prerequisite는 [배너열, 위치, 이름, 종류]입니다. 기본 A/B 배열은 기본 진행 조건의 결과이며 조건부 대안은 conditional 필드에 따로 표시합니다.");
    lines.push("Find 경로 표기: action.catId의 이름·희귀도는 actionCats 사전에 있습니다. 생략된 acquired는 빈 목록이며 rerolled/avoidedR/defense는 false, rerollSteps/uberDraws/legendDraws/harvestDraws는 0입니다. originalCatId가 없으면 catId와 같고 start가 없으면 resultLabel과 같습니다. action.context는 actionContexts의 0기준 인덱스로 배너·일정을 연결합니다. 단뽑·티켓은 자체 resultLabel/next, 확정 묶음은 routePulls에 각 뽑기 위치가 있습니다. 연속 일반 뽑기만 묶었으며 count와 actionStart/actionEnd는 원래 액션 수와 1기준 인덱스입니다. ticket은 1회, guaranteed는 pulls 수만큼 실제 뽑기로 셉니다. cost 계열은 엔진의 상대 비교 가중치이며 게임 재화가 아닙니다. uberDraws는 경로에서 얻은 울슈레 수이고 입력의 미래 울슈레 수와 다릅니다.");

    var essentialLength = lines.join("\n").length;
    var limit = Number(input.maxChars) > 0 ? Math.floor(Number(input.maxChars)) : DEFAULT_LIMIT;
    appendArrayLines(lines, buildBanners(input), limit, essentialLength);
    lines.push("상태와 생략 수는 위에 표시한 계산 결과를 기준으로 설명하세요. 생략된 배열이나 경로를 추정하지 마세요.");
    var output = lines.join("\n");
    // The route and plan are essential and deliberately form a soft cap. Array
    // records are whole JSON objects, so the output is never cut mid-value.
    if (output.length > limit) {
      var arrayStart = output.indexOf(ARRAY_PREFIX);
      if (arrayStart >= 0) {
        var kept = lines.slice(0, lines.findIndex(function (line) {
          return line.indexOf(ARRAY_PREFIX) === 0;
        }));
        buildBanners(input).forEach(function (banner) {
          kept.push(jsonLine(ARRAY_PREFIX, bannerEnvelope(banner, 0, 0)));
        });
        kept.push("요약 한도 " + limit + "자를 넘는 필수 경로·플랜은 생략 없이 보존했습니다. 배열 행은 위의 배너별 전체/포함/생략 수로 경계를 표시했습니다.");
        return kept.join("\n");
      }
    }
    return output;
  }

  return { build: build };
});
