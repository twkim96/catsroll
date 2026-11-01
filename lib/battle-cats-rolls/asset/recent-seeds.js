(function () {
  "use strict";

  var storageKey = "battle-cats-rolls.recentSeeds.v1";
  var maxSeeds = 4;
  var longPressMs = 650;
  var suppressLongPressClick = false;

  function isSharedMultiSession() {
    if (window.location.pathname !== "/multi") return false;
    try {
      return !!new URLSearchParams(window.location.hash.replace(/^#/, "")).get("share");
    } catch (_error) {
      return false;
    }
  }

  // Keep the v1 key and container; old string entries have unknown Last.
  function record(value) {
    var seed = value && typeof value === "object" ? value.seed : value;
    if (!validSeed(seed)) return null;
    var last = value && typeof value === "object" ? value.last : null;
    return {seed: String(seed), last: last != null && /^\d+$/.test(String(last)) ? Number(last) : null};
  }

  function key(value) {
    return value ? value.seed + ":" + value.last : "";
  }

  function uniqueSeeds(seeds) {
    var seen = {};
    return (Array.isArray(seeds) ? seeds : []).map(record).filter(function (item) {
      if (!item || seen[key(item)]) return false;
      seen[key(item)] = true;
      return true;
    });
  }

  function readState() {
    try {
      var parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return {
        pinned: record(parsed && parsed.pinned),
        seeds: uniqueSeeds(Array.isArray(parsed) ? parsed : parsed && parsed.seeds).slice(0, maxSeeds)
      };
    } catch (_error) {
      return { pinned: null, seeds: [] };
    }
  }

  function writeState(state) {
    if (isSharedMultiSession() || window.CatsrollMultiHost) return;
    var pinned = record(state.pinned);
    var seeds = uniqueSeeds(state.seeds).filter(function (item) {
      return key(item) !== key(pinned);
    });
    try {
      localStorage.setItem(storageKey, JSON.stringify({pinned: pinned, seeds: seeds.slice(0, maxSeeds)}));
    } catch (_error) {
      // Ignore private browsing or blocked localStorage.
    }
  }

  function validSeed(seed) {
    return /^\d+$/.test(String(seed)) && String(seed) !== "0";
  }

  function currentSeed() {
    var params = new URL(window.location.href).searchParams;
    if (params.has("last_unknown")) return null;
    var input = document.querySelector('input[name="seed"]');
    return record({seed: params.get("seed") || (input && input.value), last: params.get("last") || 0});
  }

  function remember(value) {
    var state = readState();
    if (isSharedMultiSession() || window.CatsrollMultiHost) return state;
    var item = record(value);
    if (!item) return state;
    state.seeds = state.seeds.filter(function (other) { return key(other) !== key(item); });
    if (key(state.pinned) !== key(item)) state.seeds.unshift(item);
    state.seeds = state.seeds.slice(0, maxSeeds);
    writeState(state);
    return state;
  }

  function displaySeeds(state) {
    var seeds = state.seeds.filter(function (item) { return key(item) !== key(state.pinned); });
    if (state.pinned) seeds.unshift(state.pinned);
    return seeds.slice(0, maxSeeds);
  }

  function togglePinned(item) {
    var state = readState();
    var previousPinned = state.pinned;
    state.pinned = key(state.pinned) === key(item) ? null : item;
    state.seeds = state.seeds.filter(function (other) {
      return key(other) !== key(item) && key(other) !== key(previousPinned);
    });
    if (previousPinned) state.seeds.unshift(previousPinned);
    writeState(state);
    render(state);
  }

  function seedUrl(item) {
    var url = new URL(window.location.href);
    // Preserve the current track screen, including modified clicks/new tabs.
    url.pathname = window.location.pathname === "/multi" ? "/multi" : "/";
    url.searchParams.set("seed", item.seed);
    url.searchParams.delete("last");
    url.searchParams.delete("last_unknown");
    if (item.last == null) {
      url.searchParams.set("last_unknown", "1");
      url.searchParams.set("pos", "1A");
    }
    else url.searchParams.set("last", item.last);
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
      "#recent-seeds{position:fixed;right:8px;top:auto;bottom:20vh;z-index:20;",
      "display:flex;flex-direction:column;gap:4px;max-width:10rem;",
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
      "#recent-seeds .recent-seeds-row{position:relative}",
      "#recent-seeds a{display:block;padding:4px 8px 4px calc(1em + 12px);border:1px solid #ccc;",
      "border-radius:4px;background:rgba(255,255,255,.92);color:#222;",
      "text-decoration:none;overflow:hidden;text-overflow:ellipsis;",
      "white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.08)}",
      "#recent-seeds a:hover{background:#f0f0f0}",
      "#recent-seeds .recent-seeds-star{position:absolute;left:7px;top:50%;",
      "transform:translateY(-50%);display:block;width:1em;height:1em;",
      "min-width:0;min-height:0;margin:0;padding:0;border:0;border-radius:0;",
      "background:none;box-shadow:none;color:#777;font:inherit;line-height:1;cursor:pointer}",
      "#recent-seeds .recent-seeds-star svg{display:block;width:100%;height:100%;",
      "fill:none;stroke:currentColor;stroke-width:1.7;stroke-linejoin:round}",
      "#recent-seeds .recent-seeds-star[aria-pressed=true]{color:#d5a000}",
      "#recent-seeds .recent-seeds-star[aria-pressed=true] svg{fill:#ffd447}",
      "#recent-seeds .recent-seeds-star:focus-visible{outline:1px solid #2f5f99;outline-offset:2px}",
      "#recent-seeds .recent-seeds-label{padding:4px 8px;border:1px solid #bbb;",
      "border-radius:4px;background:rgba(245,245,245,.94);color:#444;",
      "font-weight:bold;box-shadow:0 1px 2px rgba(0,0,0,.08)}",
      "#recent-seeds .recent-seeds-share,#recent-seeds .recent-seeds-plan{",
      "display:block;width:100%;padding:5px 6px;",
      "margin-top:4px;border:1px solid #244d7e;border-radius:4px;",
      "background:rgba(47,95,153,.96);color:#fff;font:inherit;font-weight:bold;",
      "box-shadow:0 1px 3px rgba(0,0,0,.16);cursor:pointer}",
      "#recent-seeds .recent-seeds-share:hover{background:#244d7e}",
      "#recent-seeds .recent-seeds-share:disabled{background:#707984;",
      "border-color:#707984;cursor:wait}",
      "#recent-seeds .recent-seeds-plan{margin-top:0;border-color:#222;",
      "background:rgba(35,35,35,.94)}",
      "#recent-seeds .recent-seeds-plan[hidden]{display:none!important}",
      "#recent-seeds .recent-seeds-plan:hover{background:#000}",
      "@media (max-width: 760px){#recent-seeds{right:4px;top:auto;",
      "bottom:8px;max-width:8rem;font-size:11px}#recent-seeds a{",
      "padding:3px 7px 3px calc(1em + 11px)}}"
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
        suppressLongPressClick = true;
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
      if (!longPressed) {
        longPressed = true;
        suppressLongPressClick = true;
        togglePinned(seed);
      }
    });
  }

  function render(state) {
    var seeds = displaySeeds(state);
    var canShare = window.CatsRollTableShare &&
      window.CatsRollTableShare.available();
    var planMode = document.getElementById("multi_plan_mode");
    var canPlan = window.location.pathname === "/multi" && !!planMode;
    var old = document.getElementById("recent-seeds");
    if (old) {
      old.remove();
    }
    if (!seeds.length && !canShare && !canPlan) {
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
      var row = document.createElement("div");
      row.className = "recent-seeds-row";
      var pinned = key(state.pinned) === key(seed);
      var link = document.createElement("a");
      link.href = seedUrl(seed);
      link.textContent = seed.seed;
      link.dataset.seed = seed.seed;
      link.dataset.last = seed.last == null ? "" : String(seed.last);
      if (pinned) {
        link.className = "pinned";
      }
      link.title = seed.seed + (seed.last == null ? " (Last 미확인)" : "") +
        (pinned ? " (pinned)" : "");
      bindLongPress(link, seed);
      row.appendChild(link);

      var star = document.createElement("button");
      star.type = "button";
      star.className = "recent-seeds-star";
      star.dataset.seed = seed.seed;
      star.dataset.last = link.dataset.last;
      star.setAttribute("aria-pressed", String(pinned));
      star.setAttribute("aria-label", (pinned ? "고정 해제: " : "고정: ") + seed.seed +
        (seed.last == null ? " (Last 미확인)" : " (Last " + seed.last + ")"));
      star.title = "길게 누르거나 별을 눌러 고정/해제";
      star.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.7 1.2 6.6-5.9-3.1-5.9 3.1 1.2-6.6-4.8-4.7 6.6-.9z"/></svg>';
      star.addEventListener("click", function () { togglePinned(seed); });
      row.appendChild(star);
      panel.appendChild(row);
    });

    if (canShare) {
      var share = document.createElement("button");
      share.type = "button";
      share.className = "recent-seeds-share";
      share.textContent = "공유";
      share.title = "표를 PNG로 저장·복사하거나 공유 링크 만들기";
      share.setAttribute("aria-label", "표 공유 옵션 열기");
      share.addEventListener("click", function () {
        window.CatsRollTableShare.open().catch(function (error) {
          share.title = error && error.message ?
            error.message : "공유 옵션을 열지 못했습니다.";
        });
      });
      panel.appendChild(share);
    }

    if (canPlan) {
      var plan = document.createElement("button");
      plan.type = "button";
      plan.id = "recent-seeds-plan";
      plan.className = "recent-seeds-plan";
      plan.textContent = "플랜";
      plan.title = "현재 플랜 정보 보기";
      plan.setAttribute("aria-label", "현재 플랜 정보 열기");
      plan.hidden = !planMode.checked;
      plan.addEventListener("click", function () {
        if (window.MultiPlanApp &&
            typeof window.MultiPlanApp.openInfo === "function") {
          window.MultiPlanApp.openInfo();
        }
      });
      panel.appendChild(plan);
    }

    document.body.appendChild(panel);
  }

  function init() {
    if (window.CatsrollMultiHost) return;
    document.addEventListener("pointerdown", function () {
      suppressLongPressClick = false;
    }, true);
    document.addEventListener("click", function (event) {
      if (!suppressLongPressClick || event.detail === 0) return;
      suppressLongPressClick = false;
      // A hold reorders the rows; touch release can click the new row underneath.
      if (event.target.closest && event.target.closest("#recent-seeds")) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    window.addEventListener("catsroll:track-seed-change", function (event) {
      render(remember(event.detail));
    });
    render(remember(currentSeed()));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
