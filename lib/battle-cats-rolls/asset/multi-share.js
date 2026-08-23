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
      formIndex == null ? previousForm : formIndex);
    if (!next) return false;
    activePayload = next;
    updateNotice();
    writeActiveUrl(mode);
    return true;
  }

  function setFindSettings(settings) {
    if (!activePayload) return false;
    var state = trackState();
    var next = codec.makePayload(state, settings, state.count, state.formIndex);
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
    if (!state) return null;
    return codec.makePayload(state, settings, count, state.formIndex);
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
    setTrackState: setTrackState,
    setFindSettings: setFindSettings,
    createUrl: createUrl
  };

  root.addEventListener("popstate", refreshFromLocation);
  root.addEventListener("hashchange", refreshFromLocation);
  updateNotice();
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var version = 1;
  var maxEncodedLength = 48000;

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

  function normalize(payload) {
    if (!payload || integer(payload.v, 0, 0, 99) !== version ||
        !Array.isArray(payload.t) || !Array.isArray(payload.r)) return null;
    var rows = payload.r.slice(0, 8).map(normalizeRow).filter(Boolean);
    if (!rows.length) return null;
    var seed = integer(payload.t[0], 1, 1, 4294967295);
    return {
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

  function makePayload(state, settings, count, formIndex) {
    if (!state || !Array.isArray(state.rows) || !state.rows.length) return null;
    var requestedCount = count == null ? state.count : count;
    return normalize({
      v: version,
      t: [state.seed, state.last, requestedCount,
        formIndex == null ? state.formIndex : formIndex],
      r: state.rows.map(rowFromState),
      f: findFromSettings(settings)
    });
  }

  function base64Encode(value) {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(value, "utf8").toString("base64");
    }
    var bytes = new TextEncoder().encode(value);
    var binary = "";
    for (var index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
  }

  function base64Decode(value) {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(value, "base64").toString("utf8");
    }
    var binary = atob(value);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  }

  function encode(payload) {
    var normalized = normalize(payload);
    if (!normalized) throw new Error("Invalid multi share payload");
    return base64Encode(JSON.stringify(normalized))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decode(token) {
    try {
      token = String(token || "");
      if (!token || token.length > maxEncodedLength || !/^[A-Za-z0-9_-]+$/.test(token)) {
        return null;
      }
      var padded = token.replace(/-/g, "+").replace(/_/g, "/");
      while (padded.length % 4) padded += "=";
      return normalize(JSON.parse(base64Decode(padded)));
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

  return {
    VERSION: version,
    normalize: normalize,
    makePayload: makePayload,
    encode: encode,
    decode: decode,
    tokenFromHash: tokenFromHash,
    fromHash: fromHash,
    trackState: trackState,
    findSettings: findSettings
  };
});
