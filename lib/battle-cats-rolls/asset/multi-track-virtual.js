(function (global, factory) {
  "use strict";

  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.MultiTrackVirtual = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function appleSafariDevice(navigator) {
    navigator = navigator || {};
    var userAgent = String(navigator.userAgent || "");
    var isSafari = /\bVersion\//.test(userAgent) && /\bSafari\//.test(userAgent) &&
      !/\b(?:CriOS|FxiOS|EdgiOS|OPiOS)\//.test(userAgent);
    if (!isSafari) return "";

    if (/\biPad\b/.test(userAgent) ||
        (/\bMacintosh\b/.test(userAgent) &&
          Number(navigator.maxTouchPoints || 0) > 1)) {
      return "ipad";
    }
    if (/\b(?:iPhone|iPod)\b/.test(userAgent)) return "iphone";
    return "";
  }

  function enabledFor(device, devices) {
    return !!(device && devices && devices[device]);
  }

  function create(count, options) {
    options = options || {};
    var bufferChunks = parseInt(options.bufferChunks, 10);
    if (isNaN(bufferChunks)) bufferChunks = 2;
    return {
      count: Math.max(0, parseInt(count, 10) || 0),
      chunkSize: Math.max(1, parseInt(options.chunkSize, 10) || 40),
      bufferChunks: Math.max(0, bufferChunks),
      estimatedRowHeight: Math.max(1,
        Number(options.estimatedRowHeight) || 64),
      heights: [],
      calibrated: false
    };
  }

  function rangeForIndex(model, index) {
    if (!model || !model.count) return { start: 0, end: 0 };
    index = clamp(parseInt(index, 10) || 0, 0, model.count - 1);
    var chunk = Math.floor(index / model.chunkSize);
    return {
      start: Math.max(0,
        (chunk - model.bufferChunks) * model.chunkSize),
      end: Math.min(model.count,
        (chunk + model.bufferChunks + 1) * model.chunkSize)
    };
  }

  function sameRange(left, right) {
    return !!left && !!right &&
      left.start === right.start && left.end === right.end;
  }

  function rowHeight(model, index) {
    return model.heights[index] || model.estimatedRowHeight;
  }

  function offsetForIndex(model, index) {
    if (!model) return 0;
    index = clamp(parseInt(index, 10) || 0, 0, model.count);
    var offset = 0;
    for (var i = 0; i < index; i++) {
      offset += rowHeight(model, i);
    }
    return offset;
  }

  function indexAtOffset(model, offset) {
    if (!model || !model.count) return 0;
    offset = Math.max(0, Number(offset) || 0);
    var total = 0;
    for (var i = 0; i < model.count; i++) {
      total += rowHeight(model, i);
      if (offset < total) return i;
    }
    return model.count - 1;
  }

  function updateHeights(model, measurements) {
    if (!model || !Array.isArray(measurements)) return;
    var calibration = [];
    measurements.forEach(function (measurement) {
      var index = parseInt(measurement && measurement.index, 10);
      var height = Number(measurement && measurement.height);
      if (index < 0 || index >= model.count || !(height > 0)) return;
      model.heights[index] = height;
      calibration.push(height);
    });

    if (!model.calibrated && calibration.length) {
      var total = calibration.reduce(function (sum, height) {
        return sum + height;
      }, 0);
      model.estimatedRowHeight = clamp(total / calibration.length, 32, 180);
      model.calibrated = true;
    }
  }

  return {
    appleSafariDevice: appleSafariDevice,
    enabledFor: enabledFor,
    create: create,
    rangeForIndex: rangeForIndex,
    sameRange: sameRange,
    offsetForIndex: offsetForIndex,
    indexAtOffset: indexAtOffset,
    updateHeights: updateHeights
  };
});
