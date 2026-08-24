(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.MultiFindEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var RARE = 2;
  var SUPA = 3;
  var UBER = 4;
  var LEGEND = 5;
  var DEFAULT_STATE_LIMIT = 400000;
  var MAX_TARGETS = 30;
  var REGULAR_COST = 2;
  var GUARANTEED_COST = 100;
  var SPECIAL_TICKET_COST = 200;
  var UBER_CREDIT = 14;
  var LEGEND_CREDIT = 200;

  function shiftL(base, bits) {
    return (base ^ ((base << bits) >>> 0)) >>> 0;
  }

  function shiftR(base, bits) {
    return (base ^ (base >>> bits)) >>> 0;
  }

  function advanceSeed(base) {
    base = shiftL(base >>> 0, 13);
    base = shiftR(base, 17);
    base = shiftL(base, 15);
    return base >>> 0;
  }

  function SeedStream(seed) {
    this.values = [advanceSeed(seed >>> 0)];
  }

  SeedStream.prototype.at = function (offset) {
    while (this.values.length <= offset) {
      this.values.push(advanceSeed(this.values[this.values.length - 1]));
    }
    return this.values[offset];
  };

  function slotList(pool, rarity) {
    if (!pool || !pool.slots) return [];
    return pool.slots[rarity] || pool.slots[String(rarity)] || [];
  }

  function catInfo(pool, id) {
    if (!pool || !pool.cats) return null;
    return pool.cats[id] || pool.cats[String(id)] || null;
  }

  function pickedName(info, formIndex) {
    if (!info || !Array.isArray(info.name)) return null;
    for (var index = formIndex; index >= 0; index -= 1) {
      if (info.name[index]) return info.name[index];
    }
    return info.name[0] || null;
  }

  function catName(pool, id, formIndex) {
    return pickedName(catInfo(pool, id), formIndex || 0) || String(id);
  }

  function rarityFor(pool, raritySeed) {
    var rates = pool.rates || {};
    var rare = Number(rates.rare) || 0;
    var supa = Number(rates.supa) || 0;
    var uber = Number(rates.uber) || 0;
    var score = raritySeed % (Number(pool.base) || 10000);

    if (score < rare) return { rarity: RARE, score: score };
    if (score < rare + supa) return { rarity: SUPA, score: score };
    if (score < rare + supa + uber) return { rarity: UBER, score: score };
    return { rarity: LEGEND, score: score };
  }

  function positionLabel(offset) {
    var row = Math.floor(offset / 2) + 1;
    return row + (offset % 2 ? "B" : "A");
  }

  function rollRegular(pool, stream, offset, lastRareId, formIndex) {
    var raritySeed = stream.at(offset);
    var rarityResult = rarityFor(pool, raritySeed);
    var rarity = rarityResult.rarity;
    var slots = slotList(pool, rarity);
    var slotSeed = stream.at(offset + 1);
    var slot = slots.length ? slotSeed % slots.length : null;
    var originalId = slot == null ? -1 : slots[slot];
    var resultId = originalId;
    var rerolled = rarity === RARE && originalId > 0 &&
      originalId === lastRareId;
    var rerollSteps = 0;

    if (rerolled) {
      var rerolling = slots.slice();
      var duplicateCount = 0;
      for (var countIndex = 0; countIndex < rerolling.length; countIndex += 1) {
        if (rerolling[countIndex] === originalId) duplicateCount += 1;
      }

      resultId = -1;
      for (var step = 1; step <= duplicateCount; step += 1) {
        rerolling.splice(slot, 1);
        if (!rerolling.length) break;
        var nextSeed = stream.at(offset + 1 + step);
        slot = nextSeed % rerolling.length;
        resultId = rerolling[slot];
        if (resultId !== originalId) {
          rerollSteps = step;
          break;
        }
      }
    }

    var nextOffset = offset + 2 + rerollSteps;
    return {
      startOffset: offset,
      nextOffset: nextOffset,
      start: positionLabel(offset),
      next: positionLabel(nextOffset),
      resultLabel: positionLabel(offset) + (rerolled ? "R" : ""),
      id: resultId,
      name: catName(pool, resultId, formIndex),
      rarity: rarity,
      score: rarityResult.score,
      originalId: originalId,
      originalName: catName(pool, originalId, formIndex),
      rerolled: rerolled,
      rerollSteps: rerollSteps,
      lastRareId: rarity === RARE && resultId > 0 ? resultId : 0
    };
  }

  function rollGuaranteed(pool, stream, offset, lastRareId, maxStartOffset,
    formIndex) {
    var startOffset = offset;
    var pulls = [];
    var firstRerolled = false;
    var currentLast = lastRareId;

    for (var index = 0; index < 10; index += 1) {
      if (offset > maxStartOffset) return null;
      var regular = rollRegular(pool, stream, offset, currentLast, formIndex);
      if (index === 0) firstRerolled = regular.rerolled;
      pulls.push(regular);
      offset = regular.nextOffset;
      currentLast = regular.lastRareId;
    }

    if (offset > maxStartOffset) return null;
    var slots = slotList(pool, UBER);
    var guaranteedSeed = stream.at(offset);
    var guaranteedId = slots.length ? slots[guaranteedSeed % slots.length] : -1;
    var guaranteedLabel = positionLabel(startOffset) +
      (firstRerolled ? "RG" : "G");
    pulls.push({
      startOffset: offset,
      nextOffset: offset + 1,
      start: guaranteedLabel,
      next: positionLabel(offset + 1),
      resultLabel: guaranteedLabel,
      id: guaranteedId,
      name: catName(pool, guaranteedId, formIndex),
      rarity: UBER,
      guaranteed: true,
      rerolled: false,
      rerollSteps: 0,
      lastRareId: 0
    });

    return {
      startOffset: startOffset,
      nextOffset: offset + 1,
      start: positionLabel(startOffset),
      guaranteedLabel: guaranteedLabel,
      next: positionLabel(offset + 1),
      pulls: pulls,
      lastRareId: 0
    };
  }

  function simulateRegular(pool, seed, offset, lastRareId, formIndex) {
    return rollRegular(pool, new SeedStream(seed), offset || 0,
      lastRareId || 0, formIndex || 0);
  }

  function simulateGuaranteed(pool, seed, offset, lastRareId, maxStartOffset,
    formIndex) {
    return rollGuaranteed(pool, new SeedStream(seed), offset || 0,
      lastRareId || 0,
      maxStartOffset == null ? Number.MAX_SAFE_INTEGER : maxStartOffset,
      formIndex || 0);
  }

  function targetBit(index) {
    return (1 << index) >>> 0;
  }

  function popcount(value) {
    value >>>= 0;
    value = value - ((value >>> 1) & 0x55555555);
    value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
    return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }

  function maskHas(mask, required) {
    return ((mask & required) >>> 0) === (required >>> 0);
  }

  function poolIds(pool) {
    var result = Object.create(null);
    [SUPA, UBER, LEGEND].forEach(function (rarity) {
      slotList(pool, rarity).forEach(function (id) { result[id] = true; });
    });
    return result;
  }

  function targetIndexes(targets, allowTarget) {
    var result = Object.create(null);
    targets.forEach(function (target, index) {
      if (!allowTarget(target)) return;
      result[target.cat_id] = index;
    });
    return result;
  }

  function addPullTargets(mask, pulls, indexes) {
    var nextMask = mask >>> 0;
    var acquired = [];
    for (var index = 0; index < pulls.length; index += 1) {
      var targetIndex = indexes[pulls[index].id];
      if (targetIndex == null) continue;
      var bit = targetBit(targetIndex);
      if ((nextMask & bit) === 0) {
        acquired.push({
          targetIndex: targetIndex,
          catId: pulls[index].id,
          catName: pulls[index].name,
          resultLabel: pulls[index].resultLabel
        });
      }
      nextMask = (nextMask | bit) >>> 0;
    }
    return { mask: nextMask, acquired: acquired };
  }

  function rarityCounts(pulls) {
    var result = { uber: 0, legend: 0 };
    pulls.forEach(function (pull) {
      if (pull.rarity === UBER) result.uber += 1;
      else if (pull.rarity === LEGEND) result.legend += 1;
    });
    return result;
  }

  function actionCost(baseCost, counts, optimization) {
    if (optimization !== "balance") return baseCost;
    return baseCost - counts.uber * UBER_CREDIT -
      counts.legend * LEGEND_CREDIT;
  }

  function normalizeTargets(targets) {
    var seen = Object.create(null);
    return (Array.isArray(targets) ? targets : []).map(function (target) {
      return {
        cat_id: parseInt(target.cat_id, 10),
        allow_ticket: target.allow_ticket === true ||
          target.source_policy === "ticket"
      };
    }).filter(function (target) {
      if (!(target.cat_id > 0) || seen[target.cat_id]) return false;
      seen[target.cat_id] = true;
      return true;
    });
  }

  function ticketKind(ticket) {
    var kind = ticket && (ticket.kind || (ticket.pool && ticket.pool.platinum));
    return kind === "legend" ? "legend" : "platinum";
  }

  function normalizeTickets(input) {
    var source = Array.isArray(input.tickets) ? input.tickets :
      (input.ticket ? [input.ticket] : []);
    return source.filter(function (ticket) {
      return ticket && ticket.pool && ticket.pool.exist !== false;
    }).map(function (ticket) {
      return {
        event: ticket.event,
        label: ticket.label,
        lang: ticket.lang,
        kind: ticketKind(ticket),
        pool: ticket.pool
      };
    });
  }

  function preflight(events, tickets, targets, maxTickets) {
    var usableTickets = tickets.filter(function (ticket) {
      return maxTickets[ticket.kind] > 0;
    });
    if (!events.length && !usableTickets.length) {
      return {
        status: "impossible",
        message: "일반 이벤트 또는 사용 가능한 특수 티켓 데이터가 없습니다."
      };
    }
    var langs = Object.create(null);
    events.forEach(function (event) { langs[event.lang] = true; });
    usableTickets.forEach(function (ticket) {
      if (ticket.lang) langs[ticket.lang] = true;
    });
    if (Object.keys(langs).length !== 1) {
      return {
        status: "invalid",
        message: "KR과 JP 이벤트는 한 경로에서 함께 계산할 수 없습니다."
      };
    }
    if (targets.length > MAX_TARGETS) {
      return {
        status: "limit",
        message: "목표 캐릭터는 최대 " + MAX_TARGETS + "명까지 계산할 수 있습니다."
      };
    }

    var eventIds = Object.create(null);
    events.forEach(function (event) {
      var ids = poolIds(event.pool);
      Object.keys(ids).forEach(function (id) { eventIds[id] = true; });
    });
    var ticketIds = Object.create(null);
    usableTickets.forEach(function (ticket) {
      var ids = poolIds(ticket.pool);
      Object.keys(ids).forEach(function (id) { ticketIds[id] = true; });
    });

    for (var index = 0; index < targets.length; index += 1) {
      var target = targets[index];
      var availableFromEvent = !!eventIds[target.cat_id];
      var availableFromTicket = target.allow_ticket && ticketIds[target.cat_id];
      if (!availableFromEvent && !availableFromTicket) {
        return {
          status: "impossible",
          message: target.allow_ticket && !usableTickets.length ?
            "선택 이벤트에 없는 목표가 있고 특수 티켓 최대 횟수도 0입니다." :
            "허용된 획득처에 없는 목표가 있습니다."
        };
      }
    }
    return null;
  }

  function reconstruct(nodes, nodeId) {
    var actions = [];
    var current = nodes[nodeId];
    while (current && current.parent != null) {
      actions.push(current.action);
      current = nodes[current.parent];
    }
    actions.reverse();
    return actions;
  }

  function betterGoal(candidate, best, optimization) {
    if (!best) return true;
    var candidateScore = optimization === "balance" ?
      Math.max(0, candidate.costUnits) : candidate.costUnits;
    if (optimization !== "distance") {
      if (candidateScore !== best.scoreUnits) {
        return candidateScore < best.scoreUnits;
      }
      if (candidate.offset !== best.offset) return candidate.offset < best.offset;
    } else {
      if (candidate.offset !== best.offset) return candidate.offset < best.offset;
      if (candidateScore !== best.scoreUnits) {
        return candidateScore < best.scoreUnits;
      }
    }
    return candidate.order < best.order;
  }

  function search(rawInput, callbacks) {
    callbacks = callbacks || {};
    var startedAt = Date.now();
    var input = rawInput || {};
    var targets = normalizeTargets(input.targets);
    var events = (Array.isArray(input.events) ? input.events : []).filter(function (event) {
      return event && event.pool && event.pool.exist !== false &&
        !event.pool.platinum;
    });
    var tickets = normalizeTickets(input);
    var optimization = input.optimization === "distance" ? "distance" :
      (input.optimization === "balance" ? "balance" : "cost");
    var maxPlatinum = Math.max(0, parseInt(input.maxPlatinum, 10) || 0);
    var maxLegendTicket = Math.max(0,
      parseInt(input.maxLegendTicket, 10) || 0);
    var maxTickets = {
      platinum: maxPlatinum,
      legend: maxLegendTicket
    };
    var preflightResult = preflight(events, tickets, targets, maxTickets);
    if (preflightResult) {
      preflightResult.explored = 0;
      preflightResult.elapsedMs = Date.now() - startedAt;
      return preflightResult;
    }

    var targetMask = 0;
    targets.forEach(function (target, index) {
      targetMask = (targetMask | targetBit(index)) >>> 0;
    });

    if (!targets.length) {
      return {
        status: "idle",
        message: "목표 캐릭터를 선택하세요.",
        explored: 0,
        elapsedMs: Date.now() - startedAt
      };
    }

    var count = Math.max(1, parseInt(input.count, 10) || 1);
    var maxStartOffset = count * 2 - 1;
    var maxGuaranteed = Math.max(0, parseInt(input.maxGuaranteed, 10) || 0);
    var stateLimit = Math.max(1000, parseInt(input.stateLimit, 10) ||
      DEFAULT_STATE_LIMIT);
    var stream = new SeedStream(Number(input.seed) >>> 0);
    var formIndex = Math.max(0, parseInt(input.formIndex, 10) || 0);
    var eventTargetIndexes = targetIndexes(targets, function () { return true; });
    var ticketTargetIndexes = targetIndexes(targets, function (target) {
      return target.allow_ticket;
    });
    var nodes = [];
    var buckets = [];
    var frontier = Object.create(null);
    var explored = 0;
    var order = 0;
    var best = null;
    var limitHit = false;

    function dominates(lhs, rhs) {
      return lhs.alive && lhs.costUnits <= rhs.costUnits &&
        lhs.guaranteedUsed <= rhs.guaranteedUsed &&
        lhs.platinumUsed <= rhs.platinumUsed &&
        lhs.legendTicketUsed <= rhs.legendTicketUsed &&
        maskHas(lhs.mask, rhs.mask);
    }

    function addNode(attrs) {
      var baseKey = attrs.offset + "|" + attrs.lastRareId;
      var candidates = frontier[baseKey] || [];
      for (var index = 0; index < candidates.length; index += 1) {
        var existing = nodes[candidates[index]];
        if (dominates(existing, attrs)) return null;
      }

      var node = {
        offset: attrs.offset,
        lastRareId: attrs.lastRareId,
        mask: attrs.mask >>> 0,
        guaranteedUsed: attrs.guaranteedUsed,
        platinumUsed: attrs.platinumUsed,
        legendTicketUsed: attrs.legendTicketUsed,
        costUnits: attrs.costUnits,
        parent: attrs.parent,
        action: attrs.action || null,
        alive: true,
        order: order++
      };
      var nodeId = nodes.length;
      nodes.push(node);

      var kept = [];
      for (var keepIndex = 0; keepIndex < candidates.length; keepIndex += 1) {
        var checking = nodes[candidates[keepIndex]];
        if (dominates(node, checking)) checking.alive = false;
        else if (checking.alive) kept.push(candidates[keepIndex]);
      }
      kept.push(nodeId);
      frontier[baseKey] = kept;
      if (node.offset <= maxStartOffset) {
        if (!buckets[node.offset]) buckets[node.offset] = [];
        buckets[node.offset].push(nodeId);
      }
      return nodeId;
    }

    function consider(nodeId) {
      if (nodeId == null) return;
      var node = nodes[nodeId];
      if (!maskHas(node.mask, targetMask)) return;
      if (betterGoal(node, best, optimization)) {
        best = {
          nodeId: nodeId,
          offset: node.offset,
          scoreUnits: optimization === "balance" ?
            Math.max(0, node.costUnits) : node.costUnits,
          costUnits: node.costUnits,
          mask: node.mask,
          guaranteedUsed: node.guaranteedUsed,
          platinumUsed: node.platinumUsed,
          legendTicketUsed: node.legendTicketUsed,
          order: node.order
        };
      }
    }

    function transition(stateId, state, attrs) {
      var nodeId = addNode({
        offset: attrs.offset,
        lastRareId: attrs.lastRareId,
        mask: attrs.mask,
        guaranteedUsed: attrs.guaranteedUsed,
        platinumUsed: attrs.platinumUsed,
        legendTicketUsed: attrs.legendTicketUsed,
        costUnits: attrs.costUnits,
        parent: stateId,
        action: attrs.action
      });
      consider(nodeId);
    }

    addNode({
      offset: 0,
      lastRareId: Math.max(0, parseInt(input.last, 10) || 0),
      mask: 0,
      guaranteedUsed: 0,
      platinumUsed: 0,
      legendTicketUsed: 0,
      costUnits: 0,
      parent: null
    });

    for (var offset = 0; offset <= maxStartOffset; offset += 1) {
      if (optimization === "distance" && best && offset >= best.offset) break;
      var bucket = buckets[offset] || [];
      for (var bucketIndex = 0; bucketIndex < bucket.length; bucketIndex += 1) {
        var stateId = bucket[bucketIndex];
        var state = nodes[stateId];
        if (!state.alive || state.offset !== offset) continue;
        explored += 1;
        if (explored > stateLimit) {
          limitHit = true;
          break;
        }
        if (callbacks.aborted && callbacks.aborted()) {
          return {
            status: "cancelled",
            explored: explored,
            elapsedMs: Date.now() - startedAt
          };
        }
        if (callbacks.progress && explored % 5000 === 0) {
          callbacks.progress({ explored: explored, offset: offset });
        }
        if (maskHas(state.mask, targetMask)) continue;
        if (optimization === "cost" && best &&
            state.costUnits >= best.costUnits) continue;

        var normalTransitions = [];
        var normalSeen = Object.create(null);
        events.forEach(function (event) {
          var rolled = rollRegular(event.pool, stream, offset,
            state.lastRareId, formIndex);
          var targetResult = addPullTargets(state.mask, [rolled],
            eventTargetIndexes);
          var dedupeKey = [rolled.nextOffset, rolled.lastRareId,
            targetResult.mask].join("|");
          if (normalSeen[dedupeKey]) return;
          normalSeen[dedupeKey] = true;
          normalTransitions.push({
            event: event,
            rolled: rolled,
            targetResult: targetResult
          });
        });
        var hasRerollAlternative = events.length > 1 &&
          normalTransitions.some(function (item) { return item.rolled.rerolled; });
        normalTransitions.forEach(function (item) {
          var event = item.event;
          var rolled = item.rolled;
          var targetResult = item.targetResult;
          var counts = rarityCounts([rolled]);
          transition(stateId, state, {
            offset: rolled.nextOffset,
            lastRareId: rolled.lastRareId,
            mask: targetResult.mask,
            guaranteedUsed: state.guaranteedUsed,
            platinumUsed: state.platinumUsed,
            legendTicketUsed: state.legendTicketUsed,
            costUnits: state.costUnits + actionCost(REGULAR_COST, counts,
              optimization),
            action: {
              type: "roll",
              event: event.event,
              eventLabel: event.label,
              start: rolled.start,
              resultLabel: rolled.resultLabel,
              next: rolled.next,
              catId: rolled.id,
              catName: rolled.name,
              rarity: rolled.rarity,
              rerolled: rolled.rerolled,
              rerollSteps: rolled.rerollSteps,
              originalCatId: rolled.originalId,
              originalCatName: rolled.originalName,
              avoidedR: hasRerollAlternative && !rolled.rerolled,
              uberDraws: counts.uber,
              legendDraws: counts.legend,
              acquired: targetResult.acquired
            }
          });
        });

        var needsTicketDefense = normalTransitions.some(function (item) {
          return item.rolled.rerolled;
        });
        var proactiveTicketDefense = normalTransitions.some(function (item) {
          var rolled = item.rolled;
          if (rolled.rerolled || !(rolled.lastRareId > 0) ||
              rolled.nextOffset > maxStartOffset) return false;
          return events.some(function (nextEvent) {
            return rollRegular(nextEvent.pool, stream, rolled.nextOffset,
              rolled.lastRareId, formIndex).rerolled;
          });
        });
        tickets.forEach(function (ticket) {
          var used = ticket.kind === "legend" ? state.legendTicketUsed :
            state.platinumUsed;
          if (used >= maxTickets[ticket.kind]) return;

          var ticketRoll = rollRegular(ticket.pool, stream, offset,
            state.lastRareId, formIndex);
          var ticketCounts = rarityCounts([ticketRoll]);
          var ticketTargets = addPullTargets(state.mask, [ticketRoll],
            ticketTargetIndexes);
          if (needsTicketDefense || proactiveTicketDefense ||
              ticketTargets.mask !== state.mask || !normalTransitions.length) {
            var nextPlatinumUsed = state.platinumUsed +
              (ticket.kind === "platinum" ? 1 : 0);
            var nextLegendTicketUsed = state.legendTicketUsed +
              (ticket.kind === "legend" ? 1 : 0);
            transition(stateId, state, {
              offset: ticketRoll.nextOffset,
              lastRareId: ticketRoll.lastRareId,
              mask: ticketTargets.mask,
              guaranteedUsed: state.guaranteedUsed,
              platinumUsed: nextPlatinumUsed,
              legendTicketUsed: nextLegendTicketUsed,
              costUnits: state.costUnits + actionCost(SPECIAL_TICKET_COST,
                ticketCounts, optimization),
              action: {
                type: "ticket",
                ticketKind: ticket.kind,
                event: ticket.event,
                eventLabel: ticket.label,
                start: ticketRoll.start,
                resultLabel: ticketRoll.resultLabel,
                next: ticketRoll.next,
                catId: ticketRoll.id,
                catName: ticketRoll.name,
                rarity: ticketRoll.rarity,
                defense: needsTicketDefense || proactiveTicketDefense,
                uberDraws: ticketCounts.uber,
                legendDraws: ticketCounts.legend,
                acquired: ticketTargets.acquired,
                cost: 2
              }
            });
          }
        });

        if (state.guaranteedUsed < maxGuaranteed) {
          var guaranteedSeen = Object.create(null);
          events.forEach(function (event) {
            if (Number(event.pool.guaranteed_rolls) !== 11) return;
            var guaranteed = rollGuaranteed(event.pool, stream, offset,
              state.lastRareId, maxStartOffset, formIndex);
            if (!guaranteed) return;
            var guaranteedTargets = addPullTargets(state.mask,
              guaranteed.pulls, eventTargetIndexes);
            var guaranteedCounts = rarityCounts(guaranteed.pulls);
            var guaranteedKey = [guaranteed.nextOffset,
              guaranteed.lastRareId, guaranteedTargets.mask].join("|");
            if (guaranteedSeen[guaranteedKey]) return;
            guaranteedSeen[guaranteedKey] = true;
            transition(stateId, state, {
              offset: guaranteed.nextOffset,
              lastRareId: guaranteed.lastRareId,
              mask: guaranteedTargets.mask,
              guaranteedUsed: state.guaranteedUsed + 1,
              platinumUsed: state.platinumUsed,
              legendTicketUsed: state.legendTicketUsed,
              costUnits: state.costUnits + actionCost(GUARANTEED_COST,
                guaranteedCounts, optimization),
              action: {
                type: "guaranteed",
                event: event.event,
                eventLabel: event.label,
                start: guaranteed.start,
                guaranteedLabel: guaranteed.guaranteedLabel,
                next: guaranteed.next,
                pulls: guaranteed.pulls.length,
                routePulls: guaranteed.pulls.map(function (pull) {
                  return {
                    resultLabel: pull.resultLabel,
                    rerolled: !!pull.rerolled,
                    guaranteed: !!pull.guaranteed
                  };
                }),
                uberDraws: guaranteedCounts.uber,
                legendDraws: guaranteedCounts.legend,
                acquired: guaranteedTargets.acquired,
                cost: 1
              }
            });
          });
        }
      }
      if (limitHit) break;
    }

    var elapsedMs = Date.now() - startedAt;
    if (limitHit) {
      return {
        status: "limit",
        message: "정확 탐색 상태 한도를 넘어 계산을 중단했습니다.",
        explored: explored,
        stateLimit: stateLimit,
        elapsedMs: elapsedMs
      };
    }
    if (!best) {
      return {
        status: "impossible",
        message: "지정한 count와 자원 제한 안에서 가능한 경로가 없습니다.",
        explored: explored,
        elapsedMs: elapsedMs
      };
    }

    var actions = reconstruct(nodes, best.nodeId);
    var regularUses = actions.filter(function (action) {
      return action.type === "roll";
    }).length;
    var uberDraws = 0;
    var legendDraws = 0;
    actions.forEach(function (action) {
      uberDraws += Number(action.uberDraws) || 0;
      legendDraws += Number(action.legendDraws) || 0;
    });
    var ticketUses = best.platinumUsed + best.legendTicketUsed;
    var baseCostUnits = regularUses * REGULAR_COST +
      ticketUses * SPECIAL_TICKET_COST +
      best.guaranteedUsed * GUARANTEED_COST;
    var balanceCreditUnits = optimization === "balance" ?
      uberDraws * UBER_CREDIT + legendDraws * LEGEND_CREDIT : 0;
    return {
      status: "success",
      destination: positionLabel(best.offset),
      nextOffset: best.offset,
      optimization: optimization,
      cost: best.scoreUnits / 100,
      scoreUnits: best.scoreUnits,
      costUnits: best.costUnits,
      rawCost: best.costUnits / 100,
      baseCost: baseCostUnits / 100,
      balanceCredit: balanceCreditUnits / 100,
      uberDraws: uberDraws,
      legendDraws: legendDraws,
      regularUses: regularUses,
      ticketUses: ticketUses,
      platinumUses: best.platinumUsed,
      legendTicketUses: best.legendTicketUsed,
      guaranteedUses: best.guaranteedUsed,
      targetAcquired: popcount(best.mask & targetMask),
      targetTotal: popcount(targetMask),
      acquiredMask: best.mask,
      actions: actions,
      explored: explored,
      elapsedMs: elapsedMs,
      ticketEvents: tickets.map(function (ticket) { return ticket.event; })
    };
  }

  return {
    RARE: RARE,
    SUPA: SUPA,
    UBER: UBER,
    LEGEND: LEGEND,
    MAX_TARGETS: MAX_TARGETS,
    advanceSeed: advanceSeed,
    positionLabel: positionLabel,
    simulateRegular: simulateRegular,
    simulateGuaranteed: simulateGuaranteed,
    search: search
  };
});
