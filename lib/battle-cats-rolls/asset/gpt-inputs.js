(function(root){
  "use strict";
  root.CatsrollGptInputs = function(options){
  var doc=root.document, $=function(id){return doc.getElementById(id);};
  var els={rows:$("rows"),addRow:$("add-row"),mode:$("mode")};
  var state={mode:"multi",rows:[{lang:"kr",event:"",ubers:0,forceGuaranteed:0}],
    eventCatalogs:{kr:{events:[],status:"loading"},jp:{events:[],status:"loading"}}};
  function setStatus(value){options.onError(value);}
  function text(value) { return value == null ? "" : String(value); }
  function eventDisplayName(event) {
    return text(event && (event.displayName || event.series_name || event.label || event.event));
  }
  function eventOptionLabel(event) {
    var label = eventDisplayName(event);
    var dates = [text(event && event.start_on), text(event && event.end_on)].filter(Boolean);
    if (dates.length) label += " · " + dates.join("–");
    return label;
  }
  function node(tag, className, content) {
    var item = doc.createElement(tag);
    if (className) item.className = className;
    if (content != null) item.textContent = content;
    return item;
  }
  function button(label, className, action) {
    var item = node("button", "button " + (className || ""), label);
    item.type = "button";
    if (action) item.addEventListener("click", action);
    return item;
  }
  function iconButton(label, icon, className, action) {
    var item = button("", "button-icon " + className, action);
    item.setAttribute("aria-label", label); item.title = label;
    var svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true");
    var path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6");
    svg.appendChild(path); item.appendChild(svg);
    return item;
  }
  function renderRows() {
    els.rows.replaceChildren();
    state.rows.forEach(function (row, index) {
      var card = node("article", "banner-row");
      var top = node("div", "row-top");
      var langLabel = node("label", "field lang-field");
      langLabel.appendChild(node("span", "", "지역"));
      var lang = node("select");
      lang.setAttribute("aria-label", "배너 " + (index + 1) + " 지역");
      [["kr", "한국"], ["jp", "일본"]].forEach(function (option) {
        var item = node("option", "", option[1]); item.value = option[0]; lang.appendChild(item);
      });
      lang.value = row.lang;
      lang.addEventListener("change", function () {
        row.lang = lang.value; row.event = ""; row.label = ""; row.displayName = "";
        delete row.previewFor;
        renderRows();
      });
      langLabel.appendChild(lang); top.appendChild(langLabel);

      var eventLabel = node("label", "field event-field");
      eventLabel.appendChild(node("span", "", "배너"));
      var eventSelect = node("select");
      eventSelect.setAttribute("aria-label", "배너 " + (index + 1) + " 선택");
      var placeholder = node("option", "", "배너를 선택하세요");
      placeholder.value = ""; eventSelect.appendChild(placeholder);
      var catalog = state.eventCatalogs[row.lang];
      var matchingEvent = catalog.events.some(function (event) { return String(event.event) === String(row.event); });
      if (row.event && !matchingEvent) {
        var supplied = node("option", "", row.displayName || row.label || row.event);
        supplied.value = String(row.event);
        supplied.title = row.label || row.event;
        supplied.setAttribute("data-label", row.label || row.event);
        supplied.setAttribute("data-display-name", row.displayName || row.label || row.event);
        eventSelect.appendChild(supplied);
      }
      [
        {group: "upcoming", label: "진행·예정"},
        {group: "past", label: "지난 배너"}
      ].forEach(function (definition) {
        var events = catalog.events.filter(function (event) { return event.group === definition.group; });
        if (!events.length) return;
        var optgroup = doc.createElement("optgroup"); optgroup.label = definition.label;
        events.forEach(function (event) {
          var option = node("option", "", eventOptionLabel(event));
          option.value = text(event.event);
          option.title = event.label || eventOptionLabel(event);
          option.setAttribute("data-label", text(event.label || event.event));
          option.setAttribute("data-display-name", eventDisplayName(event));
          optgroup.appendChild(option);
        });
        eventSelect.appendChild(optgroup);
      });
      eventSelect.value = text(row.event);
      eventSelect.addEventListener("change", function () {
        delete row.previewFor;
        var selected = eventSelect.options[eventSelect.selectedIndex];
        row.event = eventSelect.value;
        row.label = selected ? text(selected.getAttribute("data-label") || selected.title || selected.textContent) : "";
        row.displayName = selected ? text(selected.getAttribute("data-display-name") || selected.textContent) : "";
        renderRows();
      });
      eventLabel.appendChild(eventSelect);
      top.appendChild(eventLabel);
      if (state.mode !== "seek" || state.rows.length > 1) {
        var remove = iconButton("배너 " + (index + 1) + " 삭제", "delete", "button-secondary remove-row", function () {
          if (state.rows.length < 2) { setStatus("배너는 최소 하나 필요합니다.", "error"); return; }
          state.rows.splice(index, 1); renderRows();
        });
        remove.setAttribute("aria-label", "배너 " + (index + 1) + " 삭제"); top.appendChild(remove);
      }
      card.appendChild(top);

      if (row.event) {
        var selectedBanner = node("div", "selected-banner");
        selectedBanner.title = text(row.lang).toUpperCase() + " / " + row.event;
        selectedBanner.appendChild(node("strong", "", row.displayName || row.label || row.event));
        selectedBanner.appendChild(node("small", "", row.label || row.event));
        if(row.previewFor) selectedBanner.appendChild(node("small","preview-notice","참고 시뮬레이션 · "+row.lang.toUpperCase()+" 풀 → "+row.previewFor.toUpperCase()+" 가정. 미래 일정·풀 미확정"));
        card.appendChild(selectedBanner);
      }
      {
        var bottom = node("div", "row-bottom");
        var uberLabel = node("label", "field"); uberLabel.appendChild(node("span", "", "미래 울슈레 수"));
        var ubers = node("input"); ubers.type = "number"; ubers.min = "0"; ubers.max = "100"; ubers.value = row.ubers == null ? "0" : String(row.ubers);
        ubers.setAttribute("aria-label", "배너 " + (index + 1) + " 미래 울슈레 수");
        ubers.addEventListener("input", function () { row.ubers = ubers.value; });
        uberLabel.appendChild(ubers); bottom.appendChild(uberLabel);
        var forceLabel = node("label", "field"); forceLabel.appendChild(node("span", "", "확정 뽑기"));
        var force = node("select"); force.setAttribute("aria-label", "배너 " + (index + 1) + " 확정 뽑기");
        [[0, "배너 기본값"], [2, "2회 확정"], [7, "7회 확정"], [11, "11회 확정"], [15, "15회 확정"]].forEach(function (option) {
          var item = node("option", "", option[1]); item.value = String(option[0]); force.appendChild(item);
        });
        var forceValue = row.forceGuaranteed == null ? 0 : Number(row.forceGuaranteed);
        if ([0, 2, 7, 11, 15].indexOf(forceValue) === -1) {
          var invalidForce = node("option", "", "확정 설정 확인 필요 (" + text(row.forceGuaranteed) + ")");
          invalidForce.value = text(row.forceGuaranteed); force.appendChild(invalidForce);
        }
        force.value = String(forceValue);
        force.addEventListener("change", function () { row.forceGuaranteed = Number(force.value); });
        forceLabel.appendChild(force); bottom.appendChild(forceLabel);
        card.appendChild(bottom);
      }
      els.rows.appendChild(card);
    });
  }


  function changed(){options.onChange();}
  els.rows.addEventListener("change",changed);
  els.rows.addEventListener("input",changed);
  ["seed","count","last"].forEach(function(id){$(id).addEventListener("input",changed);});
  els.addRow.onclick=function(){if(state.rows.length>=8)return;state.rows.push({lang:"kr",event:"",ubers:0,forceGuaranteed:0});renderRows();changed();};
  els.rows.addEventListener("click",function(event){if(event.target.closest(".remove-row"))changed();});
  renderRows();
  return {
    setCatalog:function(data){Object.keys(data.regions).forEach(function(lang){var region=data.regions[lang];
      state.eventCatalogs[lang]={status:"ready",events:region.events.map(function(event){return Object.assign({},event,{series_name:region.series_names[event.series_id]});})};
    });renderRows();},
    setMode:function(mode){state.mode=mode==="seek"?"seek":"multi";["seed-field","count-field","last-field"].forEach(function(id){$(id).hidden=state.mode==="seek";});els.addRow.hidden=state.mode==="seek";renderRows();},
    apply:function(args){if(args.seed!=null)$("seed").value=args.seed;if(args.count!=null)$("count").value=args.count;if(args.last!=null)$("last").value=args.last||"";
      if(Array.isArray(args.rows)&&args.rows.length)state.rows=args.rows.map(function(row){var catalog=state.eventCatalogs[row.lang];var event=catalog&&catalog.events.find(function(e){return e.event===row.event;});return Object.assign({ubers:0,forceGuaranteed:0},row,{displayName:event&&event.series_name||row.displayName||row.event,label:event&&event.label||row.label||row.event});});renderRows();},
    read:function(){return {seed:Number($("seed").value),count:Number($("count").value),last:Number($("last").value)||0,rows:state.rows.map(function(row){var result={lang:row.lang,event:row.event,ubers:Number(row.ubers)||0,forceGuaranteed:Number(row.forceGuaranteed)||0};if(row.previewFor)result.previewFor=row.previewFor;return result;})};},
    lock:function(locked){["seed","count","last","add-row"].forEach(function(id){$(id).disabled=!!locked;});els.rows.querySelectorAll("input,select,button").forEach(function(el){el.disabled=!!locked;});}
  };
  };
})(typeof globalThis!=="undefined"?globalThis:this);
