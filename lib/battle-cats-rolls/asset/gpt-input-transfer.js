(function (root, factory) {
  "use strict";

  var codec = factory();
  if (typeof module === "object" && module.exports) module.exports = codec;
  if (root) root.CatsrollGptInputTransfer = codec;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_JSON_BYTES = 64 * 1024;
  var PREFIX = "catsroll-input=";
  var PROTOTYPE_KEYS = Object.create(null);
  PROTOTYPE_KEYS["__proto__"] = true;
  PROTOTYPE_KEYS.prototype = true;
  PROTOTYPE_KEYS.constructor = true;

  function fail(message) {
    throw new Error("Invalid Catsroll input link: " + message);
  }

  function plainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function assertSafeKeys(value) {
    if (Array.isArray(value)) {
      value.forEach(assertSafeKeys);
      return;
    }
    if (!value || typeof value !== "object") return;
    Object.keys(value).forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(PROTOTYPE_KEYS, key)) {
        fail("prototype-sensitive object key is not allowed");
      }
      assertSafeKeys(value[key]);
    });
  }

  function binaryFromBase64(value) {
    if (typeof atob === "function") return atob(value);
    if (typeof Buffer !== "undefined") return Buffer.from(value, "base64").toString("binary");
    fail("base64 decoding is unavailable");
  }

  function utf8FromBytes(bytes) {
    if (typeof TextDecoder === "function") {
      return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
    }

    var encoded = "";
    for (var index = 0; index < bytes.length; index += 1) {
      encoded += "%" + bytes[index].toString(16).padStart(2, "0");
    }
    return decodeURIComponent(encoded);
  }

  function decode(hash) {
    if (typeof hash !== "string") return null;
    var fragment = hash.charAt(0) === "#" ? hash.slice(1) : hash;
    var parts = fragment.split("&");
    var matches = parts.filter(function (part) {
      return part.indexOf(PREFIX) === 0;
    });
    if (!matches.length) return null;
    if (matches.length !== 1) fail("duplicate input fragments");

    var token = matches[0].slice(PREFIX.length);
    if (!token || !/^[A-Za-z0-9_-]+$/.test(token) || token.length % 4 === 1) {
      fail("fragment encoding is malformed");
    }
    if (token.length > Math.ceil(MAX_JSON_BYTES / 3) * 4) {
      fail("input exceeds 64 KiB");
    }

    var standard = token.replace(/-/g, "+").replace(/_/g, "/");
    standard += "=".repeat((4 - standard.length % 4) % 4);
    var binary;
    try {
      binary = binaryFromBase64(standard);
    } catch (_error) {
      fail("fragment encoding is malformed");
    }
    var canonical = (typeof btoa === "function" ? btoa(binary) :
      Buffer.from(binary, "binary").toString("base64")).
      replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    if (canonical !== token) fail("fragment encoding is malformed");

    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    if (bytes.length > MAX_JSON_BYTES) fail("input exceeds 64 KiB");

    var envelope;
    try {
      envelope = JSON.parse(utf8FromBytes(bytes));
    } catch (_error) {
      fail("payload is not valid UTF-8 JSON");
    }
    if (!plainObject(envelope)) fail("payload must be an object");
    if (envelope.version !== 1) fail("unsupported version");
    if (!plainObject(envelope.arguments)) fail("arguments must be an object");
    assertSafeKeys(envelope);
    return envelope;
  }

  return {decode: decode};
});
