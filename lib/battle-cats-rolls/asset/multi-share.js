(function (root, factory) {
  "use strict";

  var codec = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = codec;
  }
  if (!root || !root.document) return;

  var doc = root.document;
  var activePayload = codec.fromHash(root.location.hash);
  var activeToken = codec.tokenFromHash(root.location.hash);

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function trackState() {
    return activePayload ? codec.trackState(activePayload) : null;
  }

  function findSettings() {
    return activePayload ? codec.findSettings(activePayload) : null;
  }

  function planState() {
    return activePayload ? codec.planState(activePayload) : null;
  }

  function planStateFromApp() {
    if (root.MultiPlanApp &&
        typeof root.MultiPlanApp.getShareState === "function") {
      return root.MultiPlanApp.getShareState();
    }
    return planState();
  }

  function buildUrl(payload) {
    var state = codec.trackState(payload);
    var first = state.rows[0] || {};
    var url = new URL(root.location.href);
    url.pathname = "/multi";
    url.search = "";
    if (state.seed) url.searchParams.set("seed", state.seed);
    if (state.last) url.searchParams.set("last", state.last);
    url.searchParams.set("count", state.count);
    if (first.lang) url.searchParams.set("lang", first.lang);
    if (first.event) url.searchParams.set("event", first.event);
    if (state.formIndex) url.searchParams.set("name", state.formIndex);
    url.hash = "share=" + codec.encode(payload);
    return url.toString();
  }

  function updateNotice() {
    var notice = doc.getElementById("multi_share_notice");
    var app = doc.getElementById("multi-track-app");
    if (notice) notice.hidden = !activePayload;
    if (app) app.classList.toggle("is-shared-session", !!activePayload);
  }

  function writeActiveUrl(mode) {
    if (!activePayload) return;
    var url = buildUrl(activePayload);
    activeToken = codec.tokenFromHash(new URL(url).hash);
    var historyState = {
      multi: true,
      shared: true,
      seed: activePayload.t[0],
      last: activePayload.t[1],
      count: activePayload.t[2]
    };
    if (mode === "push") {
      root.history.pushState(historyState, "", url);
    } else if (mode !== false) {
      root.history.replaceState(historyState, "", url);
    }
  }

  function setTrackState(state, formIndex, mode) {
    if (!activeToken) return false;
    var previousForm = activePayload ? activePayload.t[3] : 0;
    var next = codec.makePayload(state, findSettings(), state && state.count,
      formIndex == null ? previousForm : formIndex, planStateFromApp());
    if (!next) return false;
    activePayload = next;
    updateNotice();
    writeActiveUrl(mode);
    return true;
  }

  function setFindSettings(settings) {
    if (!activePayload) return false;
    var state = trackState();
    var next = codec.makePayload(state, settings, state.count, state.formIndex,
      planStateFromApp());
    if (!next) return false;
    activePayload = next;
    writeActiveUrl("replace");
    return true;
  }

  function setPlanState(plan) {
    if (!activePayload) return false;
    var state = trackState();
    var next = codec.makePayload(state, findSettings(), state.count,
      state.formIndex, plan);
    if (!next) return false;
    activePayload = next;
    writeActiveUrl("replace");
    return true;
  }

  function shareStateFromApps(count) {
    var state = root.MultiTrackApp &&
      typeof root.MultiTrackApp.getShareState === "function" ?
      root.MultiTrackApp.getShareState() : trackState();
    var settings = root.MultiFindApp &&
      typeof root.MultiFindApp.getShareSettings === "function" ?
      root.MultiFindApp.getShareSettings() : findSettings();
    var plan = planStateFromApp();
    if (!state) return null;
    return codec.makePayload(state, settings, count, state.formIndex, plan);
  }

  function createUrl(count) {
    var payload = shareStateFromApps(count);
    if (!payload) throw new Error("공유할 Multi 설정을 찾지 못했습니다.");
    return buildUrl(payload);
  }

  function refreshFromLocation() {
    var token = codec.tokenFromHash(root.location.hash);
    if (token === activeToken) return;
    activeToken = token;
    activePayload = codec.fromHash(root.location.hash);
    updateNotice();
    root.dispatchEvent(new CustomEvent("multi-share:changed", {
      detail: { active: !!activePayload }
    }));
  }

  root.MultiShareCodec = codec;
  root.MultiShareApp = {
    isActive: function () { return !!activeToken; },
    getTrackState: function () { return clone(trackState()); },
    getFindSettings: function () { return clone(findSettings()); },
    getPlanState: function () { return clone(planState()); },
    setTrackState: setTrackState,
    setFindSettings: setFindSettings,
    setPlanState: setPlanState,
    createUrl: createUrl
  };

  root.addEventListener("popstate", refreshFromLocation);
  root.addEventListener("hashchange", refreshFromLocation);
  updateNotice();
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var version = 1;
  var maxEncodedLength = 48000;
  var maxDecodedLength = 65536;
  var compressedPrefix = "z1.";
  var lzWindowSize = 4096;
  var lzMinimumMatch = 3;
  var lzMaximumMatch = 18;
  var lzMaximumCandidates = 32;

  function integer(value, fallback, min, max) {
    var parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) parsed = fallback;
    return Math.max(min, Math.min(max, parsed));
  }

  function limitedText(value, maximum) {
    return String(value == null ? "" : value).slice(0, maximum);
  }

  function uniqueIntegers(values, maximum) {
    var seen = Object.create(null);
    return (Array.isArray(values) ? values : []).slice(0, maximum).map(function (value) {
      return integer(value, -1, -1, 10000000);
    }).filter(function (value) {
      if (value < 0 || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }

  function normalizeRow(row) {
    if (!Array.isArray(row) || !row[1]) return null;
    var customName = row[3] == null ? null : limitedText(row[3], 200);
    return [
      limitedText(row[0] || "kr", 8),
      limitedText(row[1], 96),
      integer(row[2], 0, 0, 20),
      customName,
      uniqueIntegers(row[4], 64)
    ];
  }

  function normalizeFind(find) {
    find = Array.isArray(find) ? find : [];
    var optimization = ["cost", "distance", "balance"].indexOf(find[0]) !== -1 ?
      find[0] : "cost";
    var seen = Object.create(null);
    var targets = (Array.isArray(find[4]) ? find[4] : []).slice(0, 64).map(function (target) {
      if (!Array.isArray(target)) return null;
      var id = integer(target[0], 0, 0, 10000000);
      if (!id || seen[id]) return null;
      seen[id] = true;
      return [id, target[1] ? 1 : 0];
    }).filter(Boolean);
    return [
      optimization,
      integer(find[1], 0, 0, 20),
      integer(find[2], 0, 0, 99),
      integer(find[3], 0, 0, 99),
      targets
    ];
  }

  function normalizePlanMark(mark, rowCount, count) {
    if (!Array.isArray(mark)) return null;
    var column = parseInt(mark[0], 10);
    var position = limitedText(mark[1], 8).toUpperCase();
    var match = /^(\d{1,3})([AB])$/.exec(position);
    if (!Number.isFinite(column) || column < 0 || column >= rowCount || !match) {
      return null;
    }
    var sequence = parseInt(match[1], 10);
    if (!Number.isFinite(sequence) || sequence < 1 || sequence > count) return null;
    var kind = parseInt(mark[2], 10);
    if ([0, 1, 2].indexOf(kind) === -1) kind = 0;
    var result = [column, sequence + match[2], kind];
    if (kind === 2 && parseInt(mark[3], 10) === 1) result.push(1);
    return result;
  }

  function normalizePlan(plan, rowCount, count) {
    if (!Array.isArray(plan)) return null;
    var name = limitedText(plan[0], 80).trim();
    var marks = [];
    (Array.isArray(plan[1]) ? plan[1] : []).slice(0, 1000)
      .map(function (mark) { return normalizePlanMark(mark, rowCount, count); })
      .filter(Boolean).forEach(function (mark) {
        marks = marks.filter(function (selected) { return selected[1] !== mark[1]; });
        marks.push(mark);
      });
    marks.sort(function (left, right) {
      var leftMatch = /^(\d+)([AB])$/.exec(left[1]);
      var rightMatch = /^(\d+)([AB])$/.exec(right[1]);
      var leftOffset = (parseInt(leftMatch[1], 10) - 1) * 2 +
        (leftMatch[2] === "B" ? 1 : 0);
      var rightOffset = (parseInt(rightMatch[1], 10) - 1) * 2 +
        (rightMatch[2] === "B" ? 1 : 0);
      return leftOffset - rightOffset || left[0] - right[0];
    });
    return name || marks.length ? [name, marks] : null;
  }

  function normalize(payload) {
    if (!payload || integer(payload.v, 0, 0, 99) !== version ||
        !Array.isArray(payload.t) || !Array.isArray(payload.r)) return null;
    var rows = payload.r.slice(0, 8).map(normalizeRow).filter(Boolean);
    if (!rows.length) return null;
    var seed = integer(payload.t[0], 1, 1, 4294967295);
    var result = {
      v: version,
      t: [
        seed,
        integer(payload.t[1], 0, 0, 10000000),
        integer(payload.t[2], 100, 1, 500),
        integer(payload.t[3], 0, 0, 10)
      ],
      r: rows,
      f: normalizeFind(payload.f)
    };
    var plan = normalizePlan(payload.p, rows.length, result.t[2]);
    if (plan) result.p = plan;
    return result;
  }

  function rowFromState(row) {
    row = row || {};
    return [
      row.lang,
      row.event,
      row.ubers,
      row.customNameAuto === false ? String(row.customName || "") : null,
      row.seriesIds
    ];
  }

  function findFromSettings(settings) {
    settings = settings || {};
    return [
      settings.optimization || settings.optimization_mode,
      settings.maxGuaranteed == null ? settings.max_guaranteed : settings.maxGuaranteed,
      settings.maxPlatinum == null ? settings.max_platinum : settings.maxPlatinum,
      settings.maxLegendTicket == null ?
        settings.max_legend_ticket : settings.maxLegendTicket,
      (settings.targets || []).map(function (target) {
        return [target.cat_id, target.allow_ticket ? 1 : 0];
      })
    ];
  }

  function planFromState(plan) {
    if (!plan || typeof plan !== "object") return null;
    return [
      plan.name,
      (Array.isArray(plan.marks) ? plan.marks : []).map(function (mark) {
        var kind = mark && mark.kind === "reroll" ? 1 :
          (mark && mark.kind === "guaranteed" ? 2 : 0);
        var compact = [mark && mark.column, mark && mark.position, kind];
        if (kind === 2 && mark && mark.variant === "rerolled") compact.push(1);
        return compact;
      })
    ];
  }

  function makePayload(state, settings, count, formIndex, plan) {
    if (!state || !Array.isArray(state.rows) || !state.rows.length) return null;
    var requestedCount = count == null ? state.count : count;
    return normalize({
      v: version,
      t: [state.seed, state.last, requestedCount,
        formIndex == null ? state.formIndex : formIndex],
      r: state.rows.map(rowFromState),
      f: findFromSettings(settings),
      p: planFromState(plan)
    });
  }

  function utf8Encode(value) {
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(value, "utf8"));
    }
    return new TextEncoder().encode(value);
  }

  function utf8Decode(bytes) {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        .toString("utf8");
    }
    return new TextDecoder().decode(bytes);
  }

  function base64EncodeBytes(bytes) {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        .toString("base64");
    }
    var binary = "";
    for (var index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
  }

  function base64DecodeBytes(value) {
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(value, "base64"));
    }
    var binary = atob(value);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function base64UrlEncodeBytes(bytes) {
    return base64EncodeBytes(bytes)
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function base64UrlDecodeBytes(value) {
    var padded = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4) padded += "=";
    return base64DecodeBytes(padded);
  }

  function lzKey(bytes, index) {
    if (index + 2 >= bytes.length) return null;
    return (bytes[index] << 16) | (bytes[index + 1] << 8) |
      bytes[index + 2];
  }

  function rememberLzPosition(table, bytes, index) {
    var key = lzKey(bytes, index);
    if (key == null) return;
    var positions = table.get(key);
    if (!positions) {
      positions = [];
      table.set(key, positions);
    }
    while (positions.length && positions[0] < index - lzWindowSize) {
      positions.shift();
    }
    positions.push(index);
    if (positions.length > lzMaximumCandidates) {
      positions.splice(0, positions.length - lzMaximumCandidates);
    }
  }

  function findLzMatch(table, bytes, index) {
    var key = lzKey(bytes, index);
    var positions = key == null ? null : table.get(key);
    if (!positions || !positions.length) return null;
    var maximum = Math.min(lzMaximumMatch, bytes.length - index);
    var bestLength = 0;
    var bestDistance = 0;
    var checked = 0;
    for (var cursor = positions.length - 1;
        cursor >= 0 && checked < lzMaximumCandidates;
        cursor -= 1, checked += 1) {
      var candidate = positions[cursor];
      var distance = index - candidate;
      if (distance < 1 || distance > lzWindowSize) continue;
      var length = 0;
      while (length < maximum &&
          bytes[candidate + length] === bytes[index + length]) {
        length += 1;
      }
      if (length > bestLength) {
        bestLength = length;
        bestDistance = distance;
        if (length === maximum) break;
      }
    }
    return bestLength >= lzMinimumMatch ?
      { length: bestLength, distance: bestDistance } : null;
  }

  // Eight tokens share one flag byte. A set bit is a 12-bit distance and
  // 4-bit length back-reference; an unset bit is one literal UTF-8 byte.
  function lzCompress(bytes) {
    var output = [];
    var positions = new Map();
    var index = 0;
    while (index < bytes.length) {
      var flagIndex = output.length;
      output.push(0);
      var flags = 0;
      for (var bit = 0; bit < 8 && index < bytes.length; bit += 1) {
        var match = findLzMatch(positions, bytes, index);
        if (match) {
          flags |= 1 << bit;
          var packed = ((match.distance - 1) << 4) |
            (match.length - lzMinimumMatch);
          output.push((packed >> 8) & 255, packed & 255);
          for (var offset = 0; offset < match.length; offset += 1) {
            rememberLzPosition(positions, bytes, index + offset);
          }
          index += match.length;
        } else {
          output.push(bytes[index]);
          rememberLzPosition(positions, bytes, index);
          index += 1;
        }
      }
      output[flagIndex] = flags;
    }
    return Uint8Array.from(output);
  }

  function lzDecompress(bytes) {
    var output = [];
    var index = 0;
    while (index < bytes.length) {
      var flags = bytes[index];
      index += 1;
      var wroteToken = false;
      for (var bit = 0; bit < 8 && index < bytes.length; bit += 1) {
        wroteToken = true;
        if (flags & (1 << bit)) {
          if (index + 1 >= bytes.length) throw new Error("Invalid LZ token");
          var packed = (bytes[index] << 8) | bytes[index + 1];
          index += 2;
          var distance = (packed >> 4) + 1;
          var length = (packed & 15) + lzMinimumMatch;
          if (distance > output.length) throw new Error("Invalid LZ distance");
          for (var offset = 0; offset < length; offset += 1) {
            output.push(output[output.length - distance]);
            if (output.length > maxDecodedLength) {
              throw new Error("Decoded share payload is too large");
            }
          }
        } else {
          output.push(bytes[index]);
          index += 1;
          if (output.length > maxDecodedLength) {
            throw new Error("Decoded share payload is too large");
          }
        }
      }
      if (!wroteToken) throw new Error("Invalid LZ group");
    }
    return Uint8Array.from(output);
  }

  function encode(payload) {
    var normalized = normalize(payload);
    if (!normalized) throw new Error("Invalid multi share payload");
    var bytes = utf8Encode(JSON.stringify(normalized));
    var legacy = base64UrlEncodeBytes(bytes);
    var compressed = compressedPrefix + base64UrlEncodeBytes(lzCompress(bytes));
    return compressed.length < legacy.length ? compressed : legacy;
  }

  function decode(token) {
    try {
      token = String(token || "");
      if (!token || token.length > maxEncodedLength) {
        return null;
      }
      var bytes;
      if (token.indexOf(compressedPrefix) === 0) {
        var compressed = token.slice(compressedPrefix.length);
        if (!compressed || !/^[A-Za-z0-9_-]+$/.test(compressed)) return null;
        bytes = lzDecompress(base64UrlDecodeBytes(compressed));
      } else {
        if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
        bytes = base64UrlDecodeBytes(token);
        if (bytes.length > maxDecodedLength) return null;
      }
      return normalize(JSON.parse(utf8Decode(bytes)));
    } catch (_error) {
      return null;
    }
  }

  function tokenFromHash(hash) {
    try {
      return new URLSearchParams(String(hash || "").replace(/^#/, "")).get("share") || "";
    } catch (_error) {
      return "";
    }
  }

  function fromHash(hash) {
    return decode(tokenFromHash(hash));
  }

  function trackState(payload) {
    payload = normalize(payload);
    if (!payload) return null;
    return {
      seed: payload.t[0],
      last: payload.t[1],
      count: payload.t[2],
      formIndex: payload.t[3],
      rows: payload.r.map(function (row) {
        return {
          lang: row[0],
          event: row[1],
          ubers: row[2],
          customName: row[3] == null ? "" : row[3],
          customNameAuto: row[3] == null,
          seriesIds: row[4].slice()
        };
      })
    };
  }

  function findSettings(payload) {
    payload = normalize(payload);
    if (!payload) return null;
    return {
      optimization: payload.f[0],
      maxGuaranteed: payload.f[1],
      maxPlatinum: payload.f[2],
      maxLegendTicket: payload.f[3],
      targets: payload.f[4].map(function (target) {
        return { cat_id: target[0], allow_ticket: !!target[1] };
      })
    };
  }

  function planState(payload) {
    payload = normalize(payload);
    if (!payload || !payload.p) return null;
    return {
      name: payload.p[0],
      marks: payload.p[1].map(function (mark) {
        var result = {
          column: mark[0],
          position: mark[1],
          kind: ["regular", "reroll", "guaranteed"][mark[2]] || "regular"
        };
        if (result.kind === "guaranteed" && mark[3] === 1) {
          result.variant = "rerolled";
        }
        return result;
      })
    };
  }

  return {
    VERSION: version,
    normalize: normalize,
    makePayload: makePayload,
    encode: encode,
    decode: decode,
    tokenFromHash: tokenFromHash,
    fromHash: fromHash,
    trackState: trackState,
    findSettings: findSettings,
    planState: planState
  };
});
