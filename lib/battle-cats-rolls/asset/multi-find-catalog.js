(function (root, factory) {
  "use strict";

  var catalog = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = catalog;
  } else {
    root.MultiFindCatalog = catalog;
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

  function catOrder(left, right) {
    var rarityOrder = integer(right && right.rarity, 0) -
      integer(left && left.rarity, 0);
    if (rarityOrder) return rarityOrder;
    var nameOrder = compareText(left && left.name, right && right.name);
    return nameOrder || integer(left && left.id, 0) -
      integer(right && right.id, 0);
  }

  function uniqueCatIds(values, catsById) {
    var seen = Object.create(null);
    return (Array.isArray(values) ? values : []).map(function (value) {
      return integer(value, -1);
    }).filter(function (id) {
      if (!catsById[id] || seen[id]) return false;
      seen[id] = true;
      return true;
    });
  }

  function normalizedGroup(raw, index, catsById, selected) {
    var id = integer(raw && raw.id, -1);
    var catIds = uniqueCatIds(raw && (raw.cat_ids || raw.catIds), catsById);
    var label = String(raw && raw.label || "시리즈 " + id);
    var search = normalizeText([label].concat(raw && raw.aliases || []).join(" "));
    return {
      id: id,
      key: selected ? String(raw && raw.key || "selected:" + index) :
        "series:" + id,
      label: label,
      catIds: catIds,
      totalCount: catIds.length,
      selected: selected,
      search: search,
      searchCompact: search.replace(/\s+/g, ""),
      order: index
    };
  }

  function seriesOrder(left, right) {
    var labelOrder = compareText(left.label, right.label);
    if (labelOrder) return labelOrder;
    if (left.id !== right.id) return left.id - right.id;
    return left.order - right.order;
  }

  function selectedGroupOrder(left, right) {
    if (left.totalCount !== right.totalCount) {
      return left.totalCount - right.totalCount;
    }
    return left.order - right.order;
  }

  function materialize(group, catsById) {
    return {
      id: group.id,
      key: group.key,
      label: group.label,
      totalCount: group.totalCount,
      selected: group.selected,
      search: group.search,
      searchCompact: group.searchCompact,
      cats: group.catIds.map(function (id) {
        return catsById[id];
      }).sort(catOrder)
    };
  }

  function matches(group, cat, value) {
    var query = normalizeText(value);
    if (!query) return true;
    var catSearch = cat.search || normalizeText([
      cat.id, cat.name, cat.kr, cat.jp
    ].join(" "));
    var groupSearch = group.search || normalizeText(group.label);
    var combined = groupSearch + " " + catSearch;
    var tokens = query.split(" ").filter(Boolean);
    if (tokens.every(function (token) { return combined.indexOf(token) !== -1; })) {
      return true;
    }
    return (group.searchCompact || groupSearch.replace(/\s+/g, ""))
      .concat(cat.searchCompact || catSearch.replace(/\s+/g, ""))
      .indexOf(query.replace(/\s+/g, "")) !== -1;
  }

  function organize(cats, series, selectedBanners) {
    var catsById = Object.create(null);
    (Array.isArray(cats) ? cats : []).forEach(function (cat) {
      var id = integer(cat && cat.id, -1);
      if (id > 0 && !catsById[id]) catsById[id] = cat;
    });

    var selectedGroups = (Array.isArray(selectedBanners) ? selectedBanners : []).
      map(function (item, index) {
        return normalizedGroup(item, index, catsById, true);
      }).sort(selectedGroupOrder).map(function (group) {
        return materialize(group, catsById);
      });
    var groups = (Array.isArray(series) ? series : []).map(function (item, index) {
      return normalizedGroup(item, index, catsById, false);
    }).filter(function (group) {
      return group.id >= 0 && group.catIds.length > 0;
    });

    var covered = Object.create(null);
    groups.forEach(function (group) {
      group.catIds.forEach(function (id) { covered[id] = true; });
    });
    var result = groups.sort(seriesOrder).map(function (group) {
      return materialize(group, catsById);
    });

    var fallback = Object.keys(catsById).map(function (value) {
      var id = integer(value, -1);
      return covered[id] ? null : catsById[id];
    }).filter(Boolean).sort(catOrder);
    if (fallback.length) {
      var search = normalizeText("기타");
      result.push({
        id: null,
        key: "other",
        label: "기타",
        totalCount: fallback.length,
        selected: false,
        fallback: true,
        search: search,
        searchCompact: search.replace(/\s+/g, ""),
        cats: fallback
      });
    }

    return selectedGroups.concat(result);
  }

  return {
    organize: organize,
    matches: matches
  };
});
