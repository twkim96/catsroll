(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CatsrollSnapshot = api;
})(typeof self !== "undefined" ? self :
  (typeof globalThis !== "undefined" ? globalThis : this), function () {
  "use strict";

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
        result.push({value: [position, compactAlternative(entry, names)],
          names: names});
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
      var rarities = Object.create(null);
      function rememberRarity(cat) {
        if (!cat) return;
        if (cat.id != null && Number.isInteger(cat.rarity)) rarities[safeString(cat.id)] = cat.rarity;
        if (cat.rerolled) rememberRarity(cat.rerolled);
        if (cat.guaranteed) rememberRarity(cat.guaranteed);
      }
      var rowNames = [];
      var rows = item.out.cats.map(function (pair) {
        (Array.isArray(pair) ? pair : []).forEach(rememberRarity);
        var names = Object.create(null);
        var row = compactRow(pair, names, formIndex);
        rowNames.push(names);
        return row;
      });
      var alternatives = collectAlternatives(item.alternatives);
      Object.keys(item.alternatives || {}).forEach(function (position) {
        (Array.isArray(item.alternatives[position]) ? item.alternatives[position] : []).forEach(function (entry) {
          rememberRarity(entry && entry.pull);
        });
      });

      var names = Object.create(null);
      function merge(source) {
        if (!source) return;
        Object.keys(source).forEach(function (id) {
          if (!Object.prototype.hasOwnProperty.call(names, id)) names[id] = source[id];
        });
      }
      rowNames.forEach(merge);
      alternatives.forEach(function (item) { merge(item.names); });
      var bannerNames = Object.keys(names).reduce(function (result, id) {
        result[id] = names[id];
        return result;
      }, {});
      var bannerRarities = Object.keys(bannerNames).reduce(function (result, id) {
        if (rarities[id] != null) result[id] = rarities[id];
        return result;
      }, {});
      banners.push({
        banner: item.label == null ? "배너 " + (index + 1) : safeString(item.label),
        lang: safeString(item.row && item.row.lang),
        rowsTotal: rows.length,
        rowsIncluded: rows.length,
        rowsOmitted: 0,
        conditionalTotal: alternatives.length,
        conditionalIncluded: alternatives.length,
        conditionalOmitted: 0,
        names: bannerNames,
        rarities: bannerRarities,
        rows: rows,
        conditional: alternatives.map(function (item) { return item.value; })
      });
    });
    return banners;
  }

  function actionPulls(action) {
    if (Array.isArray(action.routePulls)) return action.routePulls;
    if (action.type === "roll" || action.type === "ticket") {
      return [{resultLabel: action.resultLabel, rerolled: !!action.rerolled,
        guaranteed: false}];
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
    var output = {actionIndex: index, type: action.type};
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
      result = {enabled: false, status: "not_requested"};
    } else if (!source) {
      result = {enabled: true, status: "unavailable",
        message: "Find 계산 결과가 입력에 없습니다."};
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

  function sanitize(value) {
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
    return JSON.parse(JSON.stringify(plain(value, 0)));
  }

  function capture(input) {
    input = input || {};
    var track = input.track || {};
    var enabled = input.findEnabled === true;
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
          return target ? {cat_id: target.cat_id,
            allow_ticket: target.allow_ticket === true} : null;
        }) : [];
    }
    var planSnapshot = null;
    if (plan != null) {
      planSnapshot = {};
      ["enabled", "name", "marks", "route", "cats", "progress"].forEach(function (key) {
        if (plan[key] !== undefined) planSnapshot[key] = plan[key];
      });
    }
    var snapshot = {
      schema_version: 1,
      data_version: safeString(input.dataVersion || "미제공"),
      banners: []
    };
    snapshot.input = sanitize({track: inputTrack, findEnabled: enabled,
      findSettings: inputSettings});
    snapshot.find = sanitize(compactFind(input.find, enabled));
    snapshot.plan = sanitize(planSnapshot);
    snapshot.banners = buildBanners(input).map(sanitize);
    return snapshot;
  }

  return {capture: capture};
});
