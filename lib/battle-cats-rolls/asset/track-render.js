// Client-side ("내 기기 연산") track renderer — Feature B, step B-4.
//
// Faithful port of view/table.erb + the view.rb td/link helpers, producing the
// same `<div class="table">...</div>` HTML the server emits, reusing existing
// CSS classes. Consumes the cats structure from TrackEngine.buildTracks (which
// is already verified 1:1 against the server) plus render context.
//
// TrackRender.renderTable(out, ctx) -> HTML string
//   out: result of TrackEngine.buildTracks (has .cats)
//   ctx: {
//     name,        // evolution form index (0..3)
//     lang,        // 'en'|'tw'|'jp'|'kr'
//     display,     // 'text'|'image'|'both'
//     details,     // bool (show Seed / Score,slot columns)
//     find,        // cat id being searched (or 0)
//     pos,         // current position marker, e.g. '1A'
//     count,       // number of rendered rows
//     seed,        // current seed (for backtrack)
//     owned,       // optional array/Set of owned cat ids
//     params       // URLSearchParams-like base query (event/lang/name/...)
//   }

(function (global) {
  'use strict';

  var EX = (global.TrackEngine && global.TrackEngine.EXCLUSIVES) || [];
  var EX_SET = {};
  EX.forEach(function (id) { EX_SET[id] = true; });

  function h(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function TrackRender(ctx) {
    this.ctx = ctx || {};
    this.path = this.ctx.path || '/';
    var owned = this.ctx.owned || [];
    this.ownedSet = {};
    (owned.forEach ? owned : []).forEach(function (id) { this.ownedSet[id] = true; }, this);
  }

  // ---- URL building (mirrors Route#uri / uri_to_roll / uri_to_cat) ----
  // Builds from the current page query (ctx.params) with overrides applied.
  TrackRender.prototype.baseParams = function () {
    var p = new URLSearchParams(this.ctx.params || '');
    p.delete('pick'); // pick is set via interaction, not carried here
    return p;
  };

  TrackRender.prototype.uri = function (overrides, path) {
    var p = this.baseParams();
    Object.keys(overrides || {}).forEach(function (k) {
      var v = overrides[k];
      if (v === null || v === undefined) p.delete(k);
      else p.set(k, v);
    });
    var qs = p.toString();
    return (path || this.path) + (qs ? '?' + qs : '');
  };

  TrackRender.prototype.uriToRoll = function (cat) {
    return this.uri({ seed: cat.slot_seed, last: cat.id, pos: '1A' });
  };
  TrackRender.prototype.uriToCat = function (cat) {
    return this.uri({}, '/cats/' + cat.id);
  };
  TrackRender.prototype.uriForBacktrack = function (steps) {
    var seed = global.TrackEngine.Gacha.prototype.backtrackSeed
      .call({}, this.ctx.seed, steps);
    return this.uri({ seed: seed, last: 0, pos: '1A' });
  };
  TrackRender.prototype.multiUri = function () {
    var p = this.baseParams();
    p.delete('compute');
    p.delete('pick');
    var qs = p.toString();
    return '/multi' + (qs ? '?' + qs : '');
  };
  TrackRender.prototype.uriForNumberTd = function (cat) {
    var num = cat.number();
    var pos = (this.ctx.pos === num && cat.rerolled && num !== '1A')
      ? num + 'R' : num;
    var overrides = { pos: pos };
    if (num !== '1A') overrides.last = 0;
    return this.uri(overrides) + '#N' + num;
  };

  // ---- coloring (mirrors View#rarity_labels and highlighting modes) ----
  TrackRender.prototype.specialLabel = function (cat, order) {
    for (var i = 0; i < order.length; i++) {
      if (order[i] === 'owned' && this.ownedSet[cat.id]) return 'owned';
      if (order[i] === 'found' && cat.id === this.ctx.find) return 'found';
      if (order[i] === 'exclusive' && EX_SET[cat.id]) return 'exclusive';
    }
    return null;
  };

  TrackRender.prototype.highlightBasic = function (cat) {
    var special = this.specialLabel(cat, ['owned', 'found', 'exclusive']);
    var score = cat.scoreRarityLabel();
    var major = special || score;
    var minor = major;
    if (special === 'owned') {
      if (cat.id === this.ctx.find) minor = 'found';
      else if (EX_SET[cat.id]) minor = 'exclusive';
      else minor = score === 'rare' ? 'owned' : score;
    }
    return ['minor_' + minor, 'major_' + major];
  };

  TrackRender.prototype.highlightAdvanced = function (cat) {
    var special = this.specialLabel(cat, ['found', 'owned', 'exclusive']);
    var score = cat.scoreRarityLabel();
    var major = special || score;
    var minor;
    if (special) minor = score === 'rare' ? special : score;
    else minor = cat.score == null ? 'rare' : cat.catRarityLabel();
    return ['minor_' + minor, 'major_' + major];
  };

  TrackRender.prototype.highlightConsistent = function (cat) {
    var special = this.specialLabel(cat, ['found', 'owned', 'exclusive']);
    var major = special;
    if (!major) {
      if (this.ctx.platinum && cat.rarity === 4) major = 'rare';
      else major = cat.score == null ? 'rare' : cat.catRarityLabel();
    }
    var score = cat.scoreRarityLabel();
    var minor = score === 'rare' ? major : score;
    return ['minor_' + minor, 'major_' + major];
  };

  TrackRender.prototype.rarityLabels = function (cat) {
    if (this.ctx.highlighting === 'advanced') return this.highlightAdvanced(cat);
    if (this.ctx.highlighting === 'consistent') return this.highlightConsistent(cat);
    return this.highlightBasic(cat);
  };

  TrackRender.prototype.colorLabel = function (cat, type, rerolled) {
    if (!cat) return '';
    var cursor, picked = null;
    if (type === 'cat' || !(rerolled || cat.rerolled)) {
      picked = cat.picked_label;
      cursor = 'pick';
    } else {
      cursor = 'navigate';
    }
    var parts = [cursor].concat(this.rarityLabels(cat));
    if (picked) parts.push(picked);
    return parts.join(' ');
  };

  // ---- links (mirrors link_to_cat / link_to_roll / link_to_next) ----
  TrackRender.prototype.rollTag = function (href, title, content) {
    if (href) return '<a href="' + href + '" title="' + title + '">' + content + '</a>';
    return '<a title="' + title + '">' + content + '</a>';
  };

  TrackRender.prototype.avatarTag = function (cat, name) {
    var src = cat.imgSrc();
    if (!src) return null;
    var alt = (this.ctx.display === 'image') ? name : '';
    return '<span class="track_avatar_clip">' +
      '<img class="track_avatar" src="' + h(src) + '" alt="' + alt + '" ' +
      'decoding="async"></span>';
  };

  TrackRender.prototype.linkToRoll = function (cat, opts) {
    opts = opts || {};
    var text = opts.text !== false;
    var image = opts.image === true;
    var name = h(cat.pickName(this.ctx.name));
    var title = h(cat.pickTitle(this.ctx.name));
    var statUri = (cat.id > 0) ? h(this.uriToCat(cat)) : null;
    var rollUri = (cat.slot_seed != null) ? h(this.uriToRoll(cat)) : null;
    var avatar = (image && statUri) ? this.avatarTag(cat, name) : null;
    var textRoll = (text || !avatar) ? this.rollTag(rollUri, title, name) : '';
    var stat = statUri ? (' <a href="' + statUri + '">\uD83D\uDC3E</a>') : '';
    var content = '<span>' + (opts.prefix || '') + textRoll + stat +
      (opts.suffix || '') + '</span>';

    if (avatar) {
      var imageRoll = this.rollTag(rollUri, title, avatar);
      return '<span class="track_avatar_wrap">' + imageRoll + content + '</span>';
    }
    return content;
  };

  TrackRender.prototype.linkToNext = function (cat, opts) {
    opts = opts || {};
    var nextCat = cat.next;
    var affix = {};
    var track = nextCat ? nextCat.track : undefined;
    if (track === 0) affix.prefix = '&lt;- ' + nextCat.number() + ' ';
    else if (track === 1) affix.suffix = ' -&gt; ' + nextCat.number();
    else affix.prefix = '&lt;?&gt; ';
    affix.text = opts.text; affix.image = opts.image;
    return this.linkToRoll(cat, affix);
  };

  TrackRender.prototype.linkToCat = function (cat) {
    var name = h(cat.pickName(this.ctx.name));
    var title = h(cat.pickTitle(this.ctx.name));
    var href = h(this.uriToCat(cat));
    return '<a href="' + href + '" title="' + title + '">' + name + '</a>';
  };

  // ---- table cells (mirrors td / td_to_cat / cat_tds / number_td / etc.) ----
  TrackRender.prototype.showDetails = function () { return !!this.ctx.details; };

  TrackRender.prototype.expandDataAttrs = function (cat, type) {
    if (type !== 'score' || !(cat && cat.slot_seed != null)) return '';
    var attrs = [];
    attrs.push('data-expand-kind="' +
      ((cat.extra_label || '').indexOf('G') !== -1 ? 'guaranteed' : 'roll') + '"');
    attrs.push('data-expand-slot-seed="' + h(cat.slot_seed) + '"');
    if (cat.rarity_seed != null) {
      attrs.push('data-expand-rarity-seed="' + h(cat.rarity_seed) + '"');
    }
    return attrs.join(' ');
  };

  TrackRender.prototype.onclickPick = function (cat, type) {
    if (!cat || this.path !== '/') return '';
    var number = (type === 'cat') ? cat.number() : (cat.number() + 'X');
    return 'onclick="pick(\'' + number + '\')"';
  };

  TrackRender.prototype.td = function (cat, type, o) {
    o = o || {};
    var rowspan = o.rowspan || 1;
    var content = (o.content == null) ? '' : o.content;
    return '<td rowspan="' + rowspan + '" class="position ' + type + ' ' +
      this.colorLabel(cat, type, o.rerolled) + '" ' +
      this.expandDataAttrs(cat, type) + ' ' +
      this.onclickPick(cat, type) + '>' + content + '</td>';
  };

  TrackRender.prototype.tdToCat = function (cat, linkType) {
    var content = null;
    if (cat) {
      var opts = {
        text: this.ctx.display !== 'image',
        image: this.ctx.display !== 'text'
      };
      content = (linkType === 'next')
        ? this.linkToNext(cat, opts) : this.linkToRoll(cat, opts);
    }
    return this.td(cat, 'cat', { content: content });
  };

  TrackRender.prototype.catTds = function (cat, type) {
    var single = this.tdToCat(cat, type || 'roll');
    var guaranteed = this.tdToCat(cat.guaranteed, 'next');
    return single + guaranteed;
  };

  TrackRender.prototype.numberTd = function (cat, otherCat) {
    var extras = 0;
    if (cat.rerolled) extras++;
    if (otherCat && otherCat.rerolled) extras++;
    var rowspan = 2 + extras;
    var num = cat.number();
    return '<td rowspan="' + rowspan + '" id="N' + num + '">' +
      '<a href="' + this.uriForNumberTd(cat) + '">' + num + '</a></td>';
  };

  TrackRender.prototype.scoreTds = function (cat, otherCat) {
    var rowspan = (otherCat && otherCat.rerolled) ? 2 : 1;
    var content = this.showDetails()
      ? (cat.score + ', ' + cat.slot) : '\u00A0';
    var single = this.td(cat, 'score', { rowspan: rowspan, content: content });
    var guaranteed = this.td(cat.guaranteed, 'score',
      { rowspan: rowspan, rerolled: cat.rerolled && cat.rerolled.guaranteed });
    return single + guaranteed;
  };

  TrackRender.prototype.seedTds = function (seed, cat) {
    if (!this.showDetails()) return '';
    var rowspan = (cat && cat.rerolled) ? 2 : 1;
    return '<td rowspan="' + rowspan + '">' + (seed == null ? '' : seed) + '</td>';
  };

  // ---- full table (mirrors table.erb) ----
  TrackRender.prototype.renderTable = function (out) {
    var cats = out.cats;
    var details = this.showDetails();
    var colspan = details ? 4 : 3;
    var html = ['<div class="table"><table><tbody>'];

    // header row
    html.push('<tr><th>No.</th>');
    if (details) {
      html.push('<th>Seed</th><th>Score, slot</th>');
    } else {
      html.push('<th>Result</th>');
    }
    html.push('<th>Guaranteed</th>');
    html.push(details ? '<th>Alt. score, slot</th>' : '<th>Alt. result</th>');
    html.push('<th>Alt. guaranteed</th>');
    if (details) html.push('<th>Seed</th>');
    html.push('<th>Alt. No.</th></tr>');

    // body: each_ab_cat yields (prev_b, [a, b])
    var prevB = null;
    for (var i = 0; i < cats.length; i++) {
      var a = cats[i][0], b = cats[i][1];

      html.push('<tr>');
      html.push(this.numberTd(a, prevB));
      html.push(this.seedTds(a.rarity_seed, prevB));
      html.push(this.scoreTds(a, prevB));
      if (prevB) {
        html.push(this.catTds(prevB));
        html.push(this.seedTds(prevB.slot_seed, prevB));
      } else {
        html.push('<td colspan="' + colspan + '">' +
          '<a href="' + this.uriForBacktrack(2) + '">Backtrack</a></td>');
      }
      html.push('</tr>');

      if (prevB && prevB.rerolled) {
        html.push('<tr>' + this.catTds(prevB.rerolled, 'next') + '</tr>');
      }

      html.push('<tr>');
      html.push(this.seedTds(a.slot_seed, a));
      html.push(this.catTds(a));
      html.push(this.scoreTds(b, a));
      html.push(this.seedTds(b.rarity_seed, a));
      html.push(this.numberTd(b, a));
      html.push('</tr>');

      if (a.rerolled) {
        html.push('<tr>' + this.catTds(a.rerolled, 'next') + '</tr>');
      }

      prevB = b;
    }

    // final trailing row
    var lastB = cats[cats.length - 1][1];
    html.push('<tr><td colspan="' + colspan + '"></td>');
    html.push(this.catTds(lastB));
    html.push(this.seedTds(lastB.slot_seed, lastB));
    html.push('</tr>');

    html.push('</tbody></table></div>');
    return html.join('');
  };

  function renderTable(out, ctx) {
    return new TrackRender(ctx).renderTable(out);
  }

  // ---- found_cats panel (mirrors view/found_cats.erb) ----
  TrackRender.prototype.foundCatNumberLink = function (number) {
    var anchor = String(number).replace(/[RGX]/g, '');
    var sequence = parseInt(anchor, 10);
    var label = h(number);
    if (sequence >= 1 && sequence <= this.ctx.count) {
      return '<a href="#N' + h(anchor) + '">' + label + '</a>';
    }
    return label;
  };

  TrackRender.prototype.foundCatNumbers = function (numbers) {
    var self = this;
    return numbers.map(function (n) { return self.foundCatNumberLink(n); }).join(', ');
  };

  TrackRender.prototype.renderFoundCats = function (out) {
    var results = out.foundCats || [];
    var html = ['<div class="found_cats">'];
    html.push('<p class="multi_track_prompt"><a href="' + h(this.multiUri()) +
      '">멀티 트랙 보기: PC 권장</a></p>');
    if (results.length) html.push('<p>Found cats:</p>');
    html.push('<ul>');
    for (var i = 0; i < results.length; i++) {
      var cat = results[i].cat;
      html.push('<li><span class="' + cat.scoreRarityLabel() + '">' +
        this.linkToRoll(cat, { text: true, image: false }) + '</span>: ' +
        this.foundCatNumbers(results[i].numbers) + '</li>');
    }
    html.push('</ul></div>');
    return html.join('');
  };

  function renderFoundCats(out, ctx) {
    return new TrackRender(ctx).renderFoundCats(out);
  }

  global.TrackRender = {
    renderTable: renderTable, renderFoundCats: renderFoundCats,
    TrackRender: TrackRender, h: h
  };
})(typeof self !== 'undefined' ? self : this);
