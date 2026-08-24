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

  function compareText(left, right) {
    return String(left || "").localeCompare(String(right || ""), "ko");
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

  function normalizedSeries(raw, index, catsById, selectedSeries) {
    var id = integer(raw && raw.id, -1);
    var catIds = uniqueCatIds(raw && (raw.cat_ids || raw.catIds), catsById);
    return {
      id: id,
      key: "series:" + id,
      label: String(raw && raw.label || "시리즈 " + id),
      catIds: catIds,
      totalCount: catIds.length,
      selected: !!selectedSeries[id],
      order: index
    };
  }

  function ownershipOrder(left, right) {
    if (left.totalCount !== right.totalCount) {
      return left.totalCount - right.totalCount;
    }
    var labelOrder = compareText(left.label, right.label);
    if (labelOrder) return labelOrder;
    if (left.id !== right.id) return left.id - right.id;
    return left.order - right.order;
  }

  function displayOrder(left, right) {
    if (left.selected !== right.selected) return left.selected ? -1 : 1;
    if (!!left.fallback !== !!right.fallback) return left.fallback ? 1 : -1;
    return ownershipOrder(left, right);
  }

  function organize(cats, series, selectedIds, selectedCatIds) {
    var catsById = Object.create(null);
    (Array.isArray(cats) ? cats : []).forEach(function (cat) {
      var id = integer(cat && cat.id, -1);
      if (id > 0 && !catsById[id]) catsById[id] = cat;
    });

    var selectedSeries = Object.create(null);
    (Array.isArray(selectedIds) ? selectedIds : []).forEach(function (value) {
      var id = integer(value, -1);
      if (id >= 0) selectedSeries[id] = true;
    });
    var selectedCats = Object.create(null);
    (Array.isArray(selectedCatIds) ? selectedCatIds : []).forEach(function (value) {
      var id = integer(value, -1);
      if (id > 0) selectedCats[id] = true;
    });

    var groups = (Array.isArray(series) ? series : []).map(function (item, index) {
      return normalizedSeries(item, index, catsById, selectedSeries);
    }).filter(function (group) {
      return group.id >= 0 && group.catIds.length > 0;
    });

    var owners = Object.create(null);
    groups.slice().sort(ownershipOrder).forEach(function (group) {
      group.catIds.forEach(function (id) {
        if (!owners[id]) owners[id] = group;
      });
    });

    var assigned = Object.create(null);
    groups.forEach(function (group) { assigned[group.key] = []; });
    Object.keys(catsById).forEach(function (value) {
      var id = integer(value, -1);
      var owner = owners[id];
      if (owner) assigned[owner.key].push(catsById[id]);
    });

    var result = groups.map(function (group) {
      var groupCats = assigned[group.key].sort(function (left, right) {
        var nameOrder = compareText(left.name, right.name);
        return nameOrder || integer(left.id, 0) - integer(right.id, 0);
      });
      return {
        id: group.id,
        key: group.key,
        label: group.label,
        totalCount: group.totalCount,
        selected: group.selected || groupCats.some(function (cat) {
          return !!selectedCats[integer(cat.id, -1)];
        }),
        cats: groupCats
      };
    }).filter(function (group) {
      return group.cats.length > 0;
    });

    var fallback = Object.keys(catsById).map(function (value) {
      var id = integer(value, -1);
      return owners[id] ? null : catsById[id];
    }).filter(Boolean).sort(function (left, right) {
      var nameOrder = compareText(left.name, right.name);
      return nameOrder || integer(left.id, 0) - integer(right.id, 0);
    });
    if (fallback.length) {
      result.push({
        id: null,
        key: "other",
        label: "기타",
        totalCount: fallback.length,
        selected: fallback.some(function (cat) {
          return !!selectedCats[integer(cat.id, -1)];
        }),
        fallback: true,
        cats: fallback
      });
    }

    return result.sort(displayOrder);
  }

  return {
    organize: organize
  };
});
