(function () {
  "use strict";

  var storageKey = "battle-cats-rolls.recentSeeds.v1";
  var maxSeeds = 4;

  function readSeeds() {
    try {
      var parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(parsed) ? parsed.filter(validSeed) : [];
    } catch (_error) {
      return [];
    }
  }

  function writeSeeds(seeds) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(seeds.slice(0, maxSeeds)));
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
    if (!validSeed(seed)) {
      return readSeeds();
    }

    var seeds = readSeeds().filter(function (item) {
      return item !== seed;
    });
    seeds.unshift(seed);
    seeds = seeds.slice(0, maxSeeds);
    writeSeeds(seeds);
    return seeds;
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
      "#recent-seeds a{display:block;padding:4px 6px;border:1px solid #ccc;",
      "border-radius:4px;background:rgba(255,255,255,.92);color:#222;",
      "text-decoration:none;overflow:hidden;text-overflow:ellipsis;",
      "white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.08)}",
      "#recent-seeds a:hover{background:#f0f0f0}",
      "#recent-seeds .recent-seeds-label{padding:4px 6px;border:1px solid #bbb;",
      "border-radius:4px;background:rgba(245,245,245,.94);color:#444;",
      "font-weight:bold;box-shadow:0 1px 2px rgba(0,0,0,.08)}",
      "@media (max-width: 760px){#recent-seeds{right:4px;top:auto;",
      "bottom:8px;max-width:7.5rem;font-size:11px}#recent-seeds a{",
      "padding:3px 5px}}"
    ].join("");
    document.head.appendChild(style);
  }

  function render(seeds) {
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

    var label = document.createElement("div");
    label.className = "recent-seeds-label";
    label.textContent = "최근 seed";
    panel.appendChild(label);

    seeds.forEach(function (seed) {
      var link = document.createElement("a");
      link.href = seedUrl(seed);
      link.textContent = seed;
      link.title = seed;
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
