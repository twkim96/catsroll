// Client-side ("내 기기 연산") track rolling engine — Feature B, step B-2.
//
// Faithful port of lib/battle-cats-rolls/gacha.rb (+ the bits of cat.rb it
// needs). Given a pool from /track.json and a seed, it produces the same
// `cats` structure that Route#prepare_tracks builds server-side: a list of
// [aCat, bCat] pairs with linked rerolled/guaranteed/next cats and labels.
//
// Pure JS, no WASM: seed -> track is a fast forward simulation.
//
// Exposes: TrackEngine.buildTracks(poolJson, seed, opts) -> { cats }
//   opts: { count, position, last, guaranteedRolls, pick }
//
// Rarity constants match cat.rb: Rare=2, Supa=3, Uber=4, Legend=5.

(function (global) {
  'use strict';

  var RARE = 2, SUPA = 3, UBER = 4, LEGEND = 5;
  var NONE_INFO = { name: ['N/A'] };

  // ---- 32-bit xorshift (mirrors Gacha#shift/advance_seed/retreat_seed) ----
  function shiftL(base, bits) { return (base ^ ((base << bits) >>> 0)) >>> 0; }
  function shiftR(base, bits) { return (base ^ (base >>> bits)) >>> 0; }

  function advanceSeed(base) {
    base = shiftL(base, 13);
    base = shiftR(base, 17);
    base = shiftL(base, 15);
    return base >>> 0;
  }

  function retreatSeed(base) {
    base = shiftL(base, 15);
    base = shiftL(base, 30);
    base = shiftR(base, 17);
    base = shiftL(base, 13);
    base = shiftL(base, 26);
    return base >>> 0;
  }

  // ---- Cat (mirrors the subset of cat.rb used by tracking/rendering) ----
  function Cat(attrs) {
    this.id = attrs.id;
    this.info = attrs.info;
    this.rarity = attrs.rarity;
    this.rarity_seed = attrs.rarity_seed;
    this.score = attrs.score;
    this.slot = (attrs.slot === undefined) ? null : attrs.slot;
    this.slot_seed = attrs.slot_seed;
    this.sequence = attrs.sequence;
    this.track = (attrs.track === undefined) ? null : attrs.track;
    this.steps = attrs.steps;
    this.next = attrs.next || null;
    this.rerolled = attrs.rerolled || null;
    this.guaranteed = attrs.guaranteed || null;
    this.picked_label = attrs.picked_label || null;
    this.extra_label = (attrs.extra_label == null) ? null : attrs.extra_label;
  }

  Cat.prototype.trackLabel = function () {
    if (this.track !== null && this.track !== undefined) {
      return String.fromCharCode(this.track + 65); // 'A'
    }
    return '+';
  };

  Cat.prototype.number = function () {
    var seq = (this.sequence === undefined || this.sequence === null)
      ? '' : this.sequence;
    return '' + seq + this.trackLabel() + (this.extra_label || '');
  };

  Cat.prototype.duped = function (rhs) {
    return !!rhs && this.rarity === RARE && this.id === rhs.id && this.id > 0;
  };

  // info.name[index] with fallback to lower forms (mirrors Cat#pick_name)
  Cat.prototype.pickName = function (index) {
    var info = this.info;
    while (index >= 0) {
      if (info && info.name && info.name[index] != null) return info.name[index];
      index -= 1;
    }
    return this.id;
  };

  // ---- Pool wrapper over /track.json data ----
  function Pool(json) {
    this.json = json;
    this.base = json.base || 10000;
    this.rare = json.rates.rare;
    this.supa = json.rates.supa;
    this.uber = json.rates.uber;
    this.legend = json.rates.legend;
    this.guaranteedRolls = json.guaranteed_rolls || 0;
    this.version = json.version;
  }

  Pool.prototype.digSlot = function (rarity) {
    var s = this.json.slots[rarity];
    if (!s) s = this.json.slots[String(rarity)];
    return s || [];
  };

  Pool.prototype.digCat = function (id) {
    var c = this.json.cats[id];
    if (!c) c = this.json.cats[String(id)];
    return c || null;
  };

  // ---- Gacha engine (mirrors gacha.rb) ----
  function Gacha(pool, seed) {
    this.pool = pool;
    this.seed = seed >>> 0;
    this.last_both = [];
    this.last_roll = null;
    this.position = null;
    this.advanceSeedBang();
  }

  Gacha.nextIndex = function (track, steps) {
    return Math.floor((track + steps) / 2) + 1;
  };
  Gacha.nextTrack = function (track, steps) {
    return ((track + steps - 1) ^ 1) & 1;
  };

  Gacha.prototype.advanceSeedBang = function () {
    this.seed = advanceSeed(this.seed);
  };

  Gacha.prototype.rollSeedBang = function () {
    var current = this.seed;
    this.advanceSeedBang();
    return current;
  };

  Gacha.prototype.digRarity = function (score) {
    var rareSupa = this.pool.rare + this.pool.supa;
    if (score < this.pool.rare) return RARE;
    if (score < rareSupa) return SUPA;
    if (score < rareSupa + this.pool.uber) return UBER;
    return LEGEND;
  };

  Gacha.prototype.newCat = function (rarity, slotSeed, args) {
    args = args || {};
    var slots = this.pool.digSlot(rarity);
    var slot, id, info;

    if (!slots.length) {
      slot = null;
      id = -1;
      info = NONE_INFO;
    } else {
      slot = slotSeed % slots.length;
      id = slots[slot];
      info = this.pool.digCat(id);
    }

    return new Cat({
      id: id, info: info, rarity: rarity,
      slot_seed: slotSeed, slot: slot,
      sequence: args.sequence, track: args.track,
      next: args.next, extra_label: args.extra_label
    });
  };

  // roll_cat(rarity_seed) with optional slot-seed consumption
  Gacha.prototype.rollCat = function (raritySeed, consumeSlotSeed) {
    var score = raritySeed % this.pool.base;
    var rarity = this.digRarity(score);
    var slotSeed = consumeSlotSeed ? this.rollSeedBang() : this.seed;
    var cat = this.newCat(rarity, slotSeed, {});
    cat.rarity_seed = raritySeed;
    cat.score = score;
    return cat;
  };

  Gacha.prototype.rollBoth = function (sequence) {
    var aSeed = this.rollSeedBang();
    var bSeed = this.seed;
    var aCat = this.rollCat(aSeed, true);
    var bCat = this.rollCat(bSeed, false);
    aCat.track = 0;
    bCat.track = 1;
    aCat.sequence = bCat.sequence = sequence;

    this.fillCatLinks(aCat, this.last_both[0]);
    this.fillCatLinks(bCat, this.last_both[1]);

    this.last_both = [aCat, bCat];
    return this.last_both;
  };

  Gacha.prototype.rerollCat = function (cat) {
    var rarity = cat.rarity;
    var slots = this.pool.digSlot(rarity).slice(); // dup
    var nextSeed = cat.slot_seed;
    var slot = cat.slot;
    var id = null;

    var count = 0;
    for (var k = 0; k < slots.length; k++) if (slots[k] === cat.id) count++;

    var steps = null;
    for (var n = 1; n <= count; n++) {
      nextSeed = advanceSeed(nextSeed);
      slots.splice(slot, 1); // delete_at(slot)
      if (slots.length === 0) break;
      slot = nextSeed % slots.length;
      id = slots[slot];
      if (id !== cat.id) { steps = n; break; }
    }

    return new Cat({
      id: id, info: this.pool.digCat(id),
      rarity: rarity, score: cat.score,
      slot_seed: nextSeed, slot: slot,
      sequence: cat.sequence, track: cat.track, steps: steps,
      extra_label: (cat.extra_label || '') + 'R'
    });
  };

  Gacha.prototype.fillCatLinks = function (cat, lastCat) {
    if (cat.duped(lastCat)) {
      if (!cat.rerolled) cat.rerolled = this.rerollCat(cat);
      lastCat.next = cat.rerolled;
    } else if (lastCat) {
      lastCat.next = cat;
    }
  };

  function eachCat(cats, fn) {
    for (var index = 0; index < cats.length; index++) {
      var row = cats[index];
      for (var track = 0; track < row.length; track++) {
        fn(row[track], index, track);
      }
    }
  }

  function dig(cats, index, track) {
    var row = cats[index];
    return row ? (row[track] === undefined ? null : row[track]) : null;
  }

  Gacha.prototype.finishRerolledLinks = function (cats) {
    var self = this;
    eachCat(cats, function (rolledCat, index, track) {
      var rerolled = rolledCat.rerolled;
      if (!rerolled) return;
      var nextIndex = index + Gacha.nextIndex(track, rerolled.steps);
      var nextTrack = Gacha.nextTrack(track, rerolled.steps);
      var nextCat = dig(cats, nextIndex, nextTrack);
      if (nextCat) self.fillCatLinks(nextCat, rerolled);
    });
  };

  Gacha.prototype.finishLastRoll = function (firstCat) {
    this.fillCatLinks(firstCat, this.last_roll);
  };

  // follow_cat: follow .next `steps` times, or null if the chain breaks
  function followCat(cat, steps) {
    var result = cat;
    for (var i = 0; i < steps; i++) {
      if (!result.next) return null;
      result = result.next;
    }
    return result;
  }

  Gacha.prototype.fillGuaranteed = function (cats, guaranteedRolls, rolledCat) {
    var last = followCat(rolledCat, guaranteedRolls - 1);
    if (!last) return;

    var nextIndex = last.sequence - (last.track ^ 1);
    var nextTrack = last.track ^ 1;
    var nextCat = dig(cats, nextIndex, nextTrack);

    if (nextCat) {
      var prevRow = cats[last.sequence - 1];
      var guaranteedSlotSeed = prevRow && prevRow[last.track]
        ? prevRow[last.track].rarity_seed : undefined;

      rolledCat.guaranteed = this.newCat(UBER, guaranteedSlotSeed, {
        sequence: rolledCat.sequence,
        track: rolledCat.track,
        next: nextCat,
        extra_label: (rolledCat.extra_label || '') + 'G'
      });
    }
  };

  Gacha.prototype.finishGuaranteed = function (cats, guaranteedRolls) {
    var self = this;
    eachCat(cats, function (rolledCat) {
      self.fillGuaranteed(cats, guaranteedRolls, rolledCat);
      if (rolledCat.rerolled) {
        self.fillGuaranteed(cats, guaranteedRolls, rolledCat.rerolled);
      }
    });
  };

  function indexAndTrack(marker) {
    var index = parseInt(marker, 10) - 1;
    var m = /^\d+(\w)/.exec(marker);
    var track = (m ? m[1].charCodeAt(0) : 'A'.charCodeAt(0)) - 'A'.charCodeAt(0);
    return [index, track];
  }

  Gacha.prototype.digCatsFrom = function (cats, marker) {
    if (marker == null) return null;
    var it = indexAndTrack(marker);
    var located = dig(cats, it[0], it[1]);
    if (String(marker).indexOf('R') !== -1) {
      return located ? located.rerolled : null;
    }
    return located;
  };

  Gacha.prototype.markNextPosition = function (cats) {
    if (this.position == null) return;
    var next = this.digCatsFrom(cats, this.position);
    if (next) {
      if (this.last_roll && this.last_roll.id === next.id && next.rerolled) {
        next.rerolled.picked_label = 'next_position';
      } else {
        next.picked_label = 'next_position';
      }
    } else {
      var fallback = this.digCatsFrom(cats,
        String(this.position).replace(/R$/, ''));
      if (fallback) fallback.picked_label = 'next_position';
    }
  };

  // ---- pick handling (mirrors finish_picking and helpers) ----
  Gacha.prototype.finishPicking = function (cats, pick, guaranteedRolls) {
    var picked = this.digCatsFrom(cats, pick);
    if (!picked) return;
    if (pick.indexOf('G') !== -1 && !picked.guaranteed) return;

    if (pick.indexOf('X') !== -1) {
      var prefix = new RegExp('^' + escapeRegExp(picked.number()));
      if (pick.indexOf('G') !== -1) {
        this.fillPickingGuaranteed(cats, picked, prefix, guaranteedRolls);
      } else {
        this.fillPickingSingle(cats, picked, prefix);
      }
    } else if (pick.indexOf('G') !== -1) {
      this.fillPickingGuaranteed(cats, picked, picked.number() + 'G',
        guaranteedRolls);
    } else {
      this.fillPickingSingle(cats, picked, picked.number());
    }
  };

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function matchNumber(matcher, value) {
    if (value == null) return false;
    if (matcher instanceof RegExp) return matcher.test(value);
    return matcher === value;
  }

  Gacha.prototype.fillPickingBacktrackFrom = function (cat, matcher, whichCat) {
    var path = [];
    do {
      var checking = (whichCat === 'guaranteed') ? cat.guaranteed : cat;
      var num = checking ? checking.number() : null;
      if (matchNumber(matcher, num)) {
        for (var i = 0; i < path.length; i++) path[i].picked_label = 'picked';
        return cat;
      } else {
        path.push(cat);
      }
      cat = cat.next;
    } while (cat);
    return null;
  };

  Gacha.prototype.fillPickingBacktrack = function (cats, matcher, whichCat) {
    var cat = this.last_roll ||
      this.digCatsFrom(cats, this.position) || dig(cats, 0, 0);
    return this.fillPickingBacktrackFrom(cat, matcher, whichCat);
  };

  Gacha.prototype.fillPickingSingle = function (cats, picked, matcher) {
    var detected = this.fillPickingBacktrack(cats, matcher, 'itself');
    var theCat = detected || picked;
    theCat.picked_label = 'picked';
    if (theCat.next) theCat.next.picked_label = 'next_position';
  };

  Gacha.prototype.fillPickingGuaranteed =
    function (cats, picked, matcher, guaranteedRolls) {
      var detected = this.fillPickingBacktrack(cats, matcher, 'guaranteed');
      var theCat = detected || picked;
      var guaranteed = theCat.guaranteed;
      guaranteed.picked_label = 'picked_consecutively';
      if (guaranteed.next) guaranteed.next.picked_label = 'next_position';
      this.fillPickedConsecutivelyLabel(guaranteedRolls, theCat);
    };

  Gacha.prototype.fillPickedConsecutivelyLabel =
    function (guaranteedRolls, cat) {
      var stepUp = guaranteedRolls === 15;
      var rolled = cat;
      for (var index = 0; index < guaranteedRolls - 1; index++) {
        rolled.picked_label =
          (stepUp && index >= 3 && index < 8) ? 'picked' : 'picked_consecutively';
        if (!rolled.next) break;
        rolled = rolled.next;
      }
    };

  Gacha.prototype.backtrackSeed = function (baseSeed, steps) {
    var seed = baseSeed >>> 0;
    for (var i = 0; i < steps; i++) seed = retreatSeed(seed);
    return seed >>> 0;
  };

  // ---- FindCat (port of find_cat.rb) ----
  // Always-searched exclusive cat ids (mirrors FindCat.exclusives).
  var EXCLUSIVES = [
    270, 284, 287, 319, 381, 334, 379, 398, 436, 442, 485, 521, 530, 544,
    560, 586, 610, 613, 642, 658, 687, 691, 706, 759, 780, 784, 788, 811,
    838, 860
  ];
  var FIND_MAX = 999;

  function arrayMinus(arr, removeKeys) {
    var set = {};
    removeKeys.forEach(function (k) { set[k] = true; });
    return arr.filter(function (x) { return !set[x]; });
  }

  // Build the target ids exactly like FindCat#initialize.
  function findTargetIds(pool, find) {
    var targetSet = {};
    EXCLUSIVES.forEach(function (id) { targetSet[id] = true; });
    if (find) targetSet[find] = true;

    var slotIds = []
      .concat(pool.digSlot(RARE), pool.digSlot(SUPA),
              pool.digSlot(UBER), pool.digSlot(LEGEND));

    var idsInGacha = slotIds.filter(function (id) { return targetSet[id]; });
    return idsInGacha.concat(pool.digSlot(LEGEND));
  }

  // Mirrors FindCat#search_from_cats: returns map id -> cat.
  function searchFromCats(rows, guaranteed, remainingIds) {
    var result = {};
    for (var i = 0; i < rows.length; i++) {
      var ab = rows[i];
      var remaining = arrayMinus(remainingIds, Object.keys(result).map(Number));
      for (var r = 0; r < remaining.length; r++) {
        var id = remaining[r];
        for (var c = 0; c < ab.length; c++) {
          var cat = ab[c];
          if (id === cat.id) {
            result[id] = cat;
          } else if (guaranteed && cat.guaranteed && id === cat.guaranteed.id) {
            result[id] = cat.guaranteed;
          }
        }
      }
      if (Object.keys(result).length === remainingIds.length) break;
    }
    return result;
  }

  // Mirrors FindCat#search_deep + search_from_rolling. We only need the side
  // effect (rolling beyond `count` extends the chain, e.g. last row's .next),
  // and the found map for the find UI (B-5).
  Gacha.prototype.runFindCat = function (cats, find, guaranteed, max) {
    var ids = findTargetIds(this.pool, find);
    if (ids.length === 0) return {};

    var found = searchFromCats(cats, guaranteed, ids);
    if (Object.keys(found).length >= ids.length) return found;

    var sequence = cats.length + 1;
    while (sequence <= max) {
      if (Object.keys(found).length === ids.length) break;
      var newAb = this.rollBoth(sequence);
      var remaining = arrayMinus(ids, Object.keys(found).map(Number));
      var more = searchFromCats([newAb], guaranteed, remaining);
      for (var k in more) if (more.hasOwnProperty(k)) found[k] = more[k];
      sequence += 1;
    }
    return found;
  };

  // ---- top-level: mirrors Route#prepare_tracks ----
  function buildTracks(poolJson, seed, opts) {
    opts = opts || {};
    var pool = new Pool(poolJson);
    var gacha = new Gacha(pool, seed);

    var count = opts.count || 100;
    var guaranteedRolls = (opts.guaranteedRolls != null)
      ? opts.guaranteedRolls : pool.guaranteedRolls;

    gacha.position = (opts.position != null) ? String(opts.position) : null;

    var last = opts.last || 0;
    if (last) {
      gacha.last_roll = new Cat({ id: last });
      gacha.last_both = [gacha.last_roll, null];
    }

    var cats = [];
    for (var seq = 1; seq <= count; seq++) {
      cats.push(gacha.rollBoth(seq).slice());
    }

    gacha.finishRerolledLinks(cats);
    if (last) gacha.finishLastRoll(dig(cats, 0, 0));
    if (guaranteedRolls > 0) gacha.finishGuaranteed(cats, guaranteedRolls);

    if (opts.pick) {
      gacha.finishPicking(cats, opts.pick, guaranteedRolls);
    } else {
      gacha.markNextPosition(cats);
    }

    // Mirror Route#prepare_tracks running FindCat.search AFTER the finish_*
    // steps. FindCat rolls beyond `count` (until all target cats are found or
    // FindCat::Max), which can link the last visible row forward. Reproducing
    // it exactly is required for parity of the last row's .next.
    var found = {};
    if (opts.findCat !== false) {
      found = gacha.runFindCat(cats, opts.find || 0,
        opts.guaranteed !== false, opts.max || 999);
    }

    return { cats: cats, gacha: gacha, pool: pool, found: found };
  }

  global.TrackEngine = {
    buildTracks: buildTracks,
    advanceSeed: advanceSeed,
    retreatSeed: retreatSeed,
    Cat: Cat,
    Gacha: Gacha,
    Pool: Pool
  };
})(typeof self !== 'undefined' ? self : this);
