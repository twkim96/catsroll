(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.EventSeriesSearch = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function integer(value, fallback) {
    var result = parseInt(value, 10);
    return isNaN(result) ? fallback : result;
  }

  function normalizeText(value) {
    var text = String(value || "");
    if (text.normalize) text = text.normalize("NFKC");
    return text.toLocaleLowerCase().replace(/\s+/g, " ").trim();
  }

  function compareText(left, right) {
    return String(left || "").localeCompare(String(right || ""), "ko");
  }

  function uniqueIntegers(values) {
    var seen = Object.create(null);
    return (Array.isArray(values) ? values : []).map(function (value) {
      return integer(value, -1);
    }).filter(function (value) {
      if (value < 0 || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }

  function textMatches(search, compact, value) {
    var query = normalizeText(value);
    if (!query) return true;
    var tokens = query.split(" ").filter(Boolean);
    if (tokens.every(function (token) { return search.indexOf(token) !== -1; })) {
      return true;
    }
    return compact.indexOf(query.replace(/\s+/g, "")) !== -1;
  }

  function prepareCatalog(payload) {
    var series = (Array.isArray(payload && payload.series) ? payload.series : []).
      map(function (raw) {
        var item = Object.assign({}, raw);
        item.id = integer(item.id, -1);
        item._search = normalizeText(
          [item.id, item.label].concat(item.aliases || []).join(" ")
        );
        item._searchCompact = item._search.replace(/\s+/g, "");
        return item;
      }).filter(function (item) { return item.id >= 0; });

    var characters = (Array.isArray(payload && payload.characters) ?
      payload.characters : []).map(function (raw) {
      var item = Object.assign({}, raw);
      item.id = integer(item.id, -1);
      item.rarity = integer(item.rarity, 0);
      item.names = (Array.isArray(item.names) ? item.names : [item.name]).
        map(String).filter(Boolean).filter(function (name, index, names) {
          return names.indexOf(name) === index;
        });
      item.name = String(item.name || item.names[0] || item.id);
      item.seriesIds = uniqueIntegers(item.series_ids || item.seriesIds);
      item._search = normalizeText([item.id].concat(item.names).join(" "));
      item._searchCompact = item._search.replace(/\s+/g, "");
      item._normalizedNames = item.names.map(normalizeText);
      return item;
    }).filter(function (item) {
      return item.id > 0 && item.seriesIds.length > 0;
    });

    return { series: series, characters: characters };
  }

  function filterSeries(series, query, selectedCharacters) {
    var selected = Array.isArray(selectedCharacters) ? selectedCharacters : [];
    return (Array.isArray(series) ? series : []).filter(function (item) {
      var hasEveryCharacter = selected.every(function (character) {
        return character.seriesIds.indexOf(item.id) !== -1;
      });
      return hasEveryCharacter && textMatches(
        item._search || "", item._searchCompact || "", query);
    });
  }

  function matchingName(character, query) {
    var normalizedQuery = normalizeText(query);
    var compactQuery = normalizedQuery.replace(/\s+/g, "");
    var best = null;
    (character.names || []).forEach(function (name) {
      var normalized = normalizeText(name);
      var compact = normalized.replace(/\s+/g, "");
      if (!textMatches(normalized, compact, normalizedQuery)) return;
      var rank = normalized === normalizedQuery ? 0 :
        (normalized.indexOf(normalizedQuery) === 0 ||
          normalized.indexOf(" " + normalizedQuery) !== -1 ? 1 : 2);
      if (!best || rank < best.rank) {
        best = { name: name, rank: rank };
      }
    });
    if (!best && character._searchCompact.indexOf(compactQuery) !== -1) {
      best = { name: character.name, rank: 3 };
    }
    return best;
  }

  function suggestCharacters(characters, query, selectedCharacters, limit) {
    var normalizedQuery = normalizeText(query);
    if (!normalizedQuery) return [];
    var selectedIds = Object.create(null);
    (Array.isArray(selectedCharacters) ? selectedCharacters : []).forEach(
      function (item) { selectedIds[item.id] = true; });

    return (Array.isArray(characters) ? characters : []).map(function (item) {
      if (selectedIds[item.id]) return null;
      var match = matchingName(item, normalizedQuery);
      return match ? { character: item, name: match.name, rank: match.rank } : null;
    }).filter(Boolean).sort(function (left, right) {
      if (left.rank !== right.rank) return left.rank - right.rank;
      var nameOrder = compareText(left.name, right.name);
      return nameOrder || left.character.id - right.character.id;
    }).slice(0, integer(limit, 10));
  }

  function rarityLabel(rarity) {
    return rarity === 5 ? "레레" : "울슈레";
  }

  function createAutocomplete(options) {
    var input = options.input;
    var chips = options.chips;
    var suggestions = options.suggestions;
    var root = options.root || input.parentNode;
    var doc = input.ownerDocument || document;
    var onChange = options.onChange || function () {};
    var characters = [];
    var selected = [];
    var renderedSuggestions = [];
    var activeIndex = -1;

    function notify() {
      onChange();
    }

    function renderChips() {
      chips.innerHTML = "";
      selected.forEach(function (character) {
        var chip = doc.createElement("span");
        chip.className = "event-filter-search-chip";
        chip.appendChild(doc.createTextNode(character.selectedName || character.name));
        var remove = doc.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.setAttribute("aria-label",
          (character.selectedName || character.name) + " 정확 검색 해제");
        remove.addEventListener("click", function () {
          selected = selected.filter(function (item) {
            return item.id !== character.id;
          });
          render();
          input.focus();
          notify();
        });
        chip.appendChild(remove);
        chips.appendChild(chip);
      });
    }

    function setActive(index) {
      if (!renderedSuggestions.length) {
        activeIndex = -1;
        return;
      }
      activeIndex = Math.max(0, Math.min(index, renderedSuggestions.length - 1));
      Array.prototype.forEach.call(suggestions.children, function (option, i) {
        option.classList.toggle("is-active", i === activeIndex);
        option.setAttribute("aria-selected", i === activeIndex ? "true" : "false");
      });
    }

    function choose(result) {
      if (!result) return;
      var character = Object.assign({}, result.character, { selectedName: result.name });
      selected.push(character);
      input.value = "";
      activeIndex = -1;
      render();
      input.focus();
      notify();
    }

    function renderSuggestions() {
      renderedSuggestions = suggestCharacters(characters, input.value, selected, 10);
      suggestions.innerHTML = "";
      renderedSuggestions.forEach(function (result, index) {
        var option = doc.createElement("button");
        option.type = "button";
        option.className = "event-filter-suggestion";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        option.dataset.characterId = result.character.id;

        var name = doc.createElement("span");
        name.textContent = result.name;
        var rarity = doc.createElement("small");
        rarity.textContent = rarityLabel(result.character.rarity);
        option.appendChild(name);
        option.appendChild(rarity);
        option.addEventListener("click", function () { choose(result); });
        option.addEventListener("mouseenter", function () { setActive(index); });
        suggestions.appendChild(option);
      });
      suggestions.hidden = renderedSuggestions.length === 0;
      input.setAttribute("aria-expanded",
        renderedSuggestions.length ? "true" : "false");
      if (activeIndex >= renderedSuggestions.length) activeIndex = -1;
    }

    function render() {
      renderChips();
      renderSuggestions();
    }

    input.addEventListener("input", function () {
      activeIndex = -1;
      renderSuggestions();
      notify();
    });
    input.addEventListener("focus", renderSuggestions);
    input.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" && renderedSuggestions.length) {
        event.preventDefault();
        setActive(activeIndex < 0 ? 0 : activeIndex + 1);
      } else if (event.key === "ArrowUp" && renderedSuggestions.length) {
        event.preventDefault();
        setActive(activeIndex < 0 ? renderedSuggestions.length - 1 : activeIndex - 1);
      } else if (event.key === "Enter" && activeIndex >= 0) {
        event.preventDefault();
        choose(renderedSuggestions[activeIndex]);
      } else if (event.key === "Escape") {
        suggestions.hidden = true;
        input.setAttribute("aria-expanded", "false");
      } else if (event.key === "Backspace" && !input.value && selected.length) {
        selected.pop();
        render();
        notify();
      }
    });
    root.addEventListener("focusout", function (event) {
      if (event.relatedTarget && root.contains(event.relatedTarget)) return;
      suggestions.hidden = true;
      input.setAttribute("aria-expanded", "false");
    });

    render();
    return {
      setCharacters: function (values) {
        characters = Array.isArray(values) ? values : [];
        renderSuggestions();
      },
      reset: function (silent) {
        selected = [];
        input.value = "";
        activeIndex = -1;
        render();
        if (!silent) notify();
      },
      filterSeries: function (series) {
        return filterSeries(series, input.value, selected);
      },
      hasCriteria: function () {
        return normalizeText(input.value) !== "" || selected.length !== 0;
      },
      selectedCharacters: function () { return selected.slice(); }
    };
  }

  return {
    normalizeText: normalizeText,
    prepareCatalog: prepareCatalog,
    filterSeries: filterSeries,
    suggestCharacters: suggestCharacters,
    createAutocomplete: createAutocomplete
  };
});
