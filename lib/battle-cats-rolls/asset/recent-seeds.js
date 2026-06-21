(function () {
  "use strict";

  var storageKey = "battle-cats-rolls.recentSeeds.v1";
  var maxSeeds = 4;
  var longPressMs = 650;

  function uniqueSeeds(seeds) {
    var seen = {};
    return seeds.filter(function (seed) {
      seed = String(seed);
      if (!validSeed(seed) || seen[seed]) {
        return false;
      }
      seen[seed] = true;
      return true;
    });
  }

  function readState() {
    try {
      var parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(parsed)) {
        return { pinned: null, seeds: uniqueSeeds(parsed).slice(0, maxSeeds) };
      }

      return {
        pinned: validSeed(parsed && parsed.pinned) ? String(parsed.pinned) : null,
        seeds: uniqueSeeds((parsed && parsed.seeds) || []).slice(0, maxSeeds)
      };
    } catch (_error) {
      return { pinned: null, seeds: [] };
    }
  }

  function writeState(state) {
    var pinned = validSeed(state.pinned) ? String(state.pinned) : null;
    var seeds = uniqueSeeds(state.seeds || []).filter(function (seed) {
      return seed !== pinned;
    });

    try {
      localStorage.setItem(storageKey, JSON.stringify({
        pinned: pinned,
        seeds: seeds.slice(0, maxSeeds)
      }));
    } catch (_error) {
      // Ignore private browsing or blocked localStorage.
    }
  }

  function validSeed(seed) {
    return /^\d+$/.test(String(seed)) && String(seed) !== "0";
  }

  function currentSeed() {
    var url = new URL(window.location.href);
    var fromQuery = url.searchParams.get("seed");
    if (validSeed(fromQuery)) {
      return fromQuery;
    }

    var input = document.querySelector('input[name="seed"]');
    if (input && validSeed(input.value)) {
      return input.value;
    }
  }

  function remember(seed) {
    var state = readState();
    if (!validSeed(seed)) {
      return state;
    }

    seed = String(seed);
    state.seeds = state.seeds.filter(function (item) {
      return item !== seed;
    });

    if (state.pinned !== seed) {
      state.seeds.unshift(seed);
    }

    state.seeds = state.seeds.slice(0, maxSeeds);
    writeState(state);
    return state;
  }

  function displaySeeds(state) {
    var seeds = state.seeds.filter(function (seed) {
      return seed !== state.pinned;
    });
    if (state.pinned) {
      seeds.unshift(state.pinned);
    }
    return seeds.slice(0, maxSeeds);
  }

  function togglePinned(seed) {
    var state = readState();
    var previousPinned = state.pinned;
    state.pinned = state.pinned === seed ? null : seed;
    state.seeds = state.seeds.filter(function (item) {
      return item !== seed && item !== previousPinned;
    });
    if (previousPinned) {
      state.seeds.unshift(previousPinned);
    }
    writeState(state);
    render(state);
  }

  function seedUrl(seed) {
    var url = new URL(window.location.href);
    url.pathname = "/";
    url.searchParams.set("seed", seed);
    url.searchParams.delete("pick");
    url.hash = "";
    return url.toString();
  }

  function injectStyle() {
    if (document.getElementById("recent-seeds-style")) {
      return;
    }

    var style = document.createElement("style");
    style.id = "recent-seeds-style";
    style.textContent = [
      "#recent-seeds{position:fixed;right:8px;top:92px;z-index:20;",
      "display:flex;flex-direction:column;gap:4px;max-width:9.5rem;",
      "font-size:12px;line-height:1.2}",
      "#recent-seeds .recent-seeds-top{align-self:center;display:flex;",
      "align-items:center;justify-content:center;width:28px;height:28px;padding:0;",
      "margin-bottom:6px;",
      "border:1px solid rgba(0,0,0,.18);border-radius:50%;",
      "background:rgba(255,255,255,.88);color:#2f5f99;",
      "box-shadow:0 2px 8px rgba(0,0,0,.16);backdrop-filter:blur(6px);",
      "cursor:pointer;transition:background .12s ease,box-shadow .12s ease,transform .12s ease}",
      "#recent-seeds .recent-seeds-top:hover{background:#fff;",
      "box-shadow:0 3px 10px rgba(0,0,0,.2);transform:translateY(-1px)}",
      "#recent-seeds .recent-seeds-top svg{width:16px;height:16px;display:block;",
      "stroke:currentColor}",
      "#recent-seeds a{display:block;padding:4px 6px;border:1px solid #ccc;",
      "border-radius:4px;background:rgba(255,255,255,.92);color:#222;",
      "text-decoration:none;overflow:hidden;text-overflow:ellipsis;",
      "white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.08)}",
      "#recent-seeds a:hover{background:#f0f0f0}",
      "#recent-seeds a.pinned{background:rgba(226,226,226,.96);",
      "border-color:#aaa;color:#111}",
      "#recent-seeds a.pinned:hover{background:rgba(214,214,214,.96)}",
      "#recent-seeds .recent-seeds-label{padding:4px 6px;border:1px solid #bbb;",
      "border-radius:4px;background:rgba(245,245,245,.94);color:#444;",
      "font-weight:bold;box-shadow:0 1px 2px rgba(0,0,0,.08)}",
      "@media (max-width: 760px){#recent-seeds{right:4px;top:auto;",
      "bottom:8px;max-width:7.5rem;font-size:11px}#recent-seeds a{",
      "padding:3px 5px}}"
    ].join("");
    document.head.appendChild(style);
  }

  function bindLongPress(link, seed) {
    var timer = null;
    var longPressed = false;

    function clearTimer() {
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    link.addEventListener("pointerdown", function () {
      clearTimer();
      longPressed = false;
      timer = window.setTimeout(function () {
        longPressed = true;
        togglePinned(seed);
      }, longPressMs);
    });

    ["pointerup", "pointerleave", "pointercancel"].forEach(function (eventName) {
      link.addEventListener(eventName, clearTimer);
    });

    link.addEventListener("click", function (event) {
      if (longPressed) {
        event.preventDefault();
        longPressed = false;
      }
    });

    link.addEventListener("contextmenu", function (event) {
      event.preventDefault();
      clearTimer();
      togglePinned(seed);
    });
  }

  function render(state) {
    var seeds = displaySeeds(state);
    var old = document.getElementById("recent-seeds");
    if (old) {
      old.remove();
    }
    if (!seeds.length) {
      return;
    }

    injectStyle();

    var panel = document.createElement("nav");
    panel.id = "recent-seeds";
    panel.setAttribute("aria-label", "Recent seeds");

    var top = document.createElement("button");
    top.type = "button";
    top.className = "recent-seeds-top";
    top.innerHTML = [
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">',
      '<path d="M12 19V5"></path>',
      '<path d="m5 12 7-7 7 7"></path>',
      '</svg>'
    ].join("");
    top.title = "맨 위로";
    top.setAttribute("aria-label", "맨 위로");
    top.addEventListener("click", function () {
      window.scrollTo(0, 0);
    });
    panel.appendChild(top);

    var label = document.createElement("div");
    label.className = "recent-seeds-label";
    label.textContent = "최근 seed";
    panel.appendChild(label);

    seeds.forEach(function (seed) {
      var link = document.createElement("a");
      link.href = seedUrl(seed);
      link.textContent = seed;
      if (state.pinned === seed) {
        link.className = "pinned";
      }
      link.title = state.pinned === seed ? seed + " (pinned)" : seed;
      bindLongPress(link, seed);
      panel.appendChild(link);
    });

    document.body.appendChild(panel);
  }

  function init() {
    render(remember(currentSeed()));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
