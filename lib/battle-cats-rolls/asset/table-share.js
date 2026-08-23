(function () {
  "use strict";

  var script = document.currentScript;
  var html2canvasUrl = script && script.getAttribute("data-html2canvas");
  var loaderPromise;
  var dialogElements;
  var activePromise;
  var activeResolve;
  var activeMax = 0;
  var modalBusy = false;

  function isMultiPage() {
    return window.location.pathname === "/multi";
  }

  function supportedPage() {
    return window.location.pathname === "/" || isMultiPage();
  }

  function captureTarget() {
    if (isMultiPage()) {
      return document.querySelector("#multi_tables .multi-track-pair");
    }
    return document.querySelector("#content .table");
  }

  function waitForTarget() {
    var target = captureTarget();
    if (target) {
      return Promise.resolve(target);
    }

    return new Promise(function (resolve, reject) {
      var observer = new MutationObserver(function () {
        var found = captureTarget();
        if (found) {
          window.clearTimeout(timeout);
          observer.disconnect();
          resolve(found);
        }
      });
      var timeout = window.setTimeout(function () {
        observer.disconnect();
        reject(new Error("저장할 표가 아직 준비되지 않았습니다."));
      }, 5000);

      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  function loadHtml2Canvas() {
    if (window.html2canvas) {
      return Promise.resolve(window.html2canvas);
    }
    if (loaderPromise) {
      return loaderPromise;
    }
    if (!html2canvasUrl) {
      return Promise.reject(new Error("표 캡처 모듈 주소가 없습니다."));
    }

    loaderPromise = new Promise(function (resolve, reject) {
      var loader = document.createElement("script");
      loader.src = html2canvasUrl;
      loader.async = true;
      loader.onload = function () {
        if (window.html2canvas) {
          resolve(window.html2canvas);
        } else {
          reject(new Error("표 캡처 모듈을 불러오지 못했습니다."));
        }
      };
      loader.onerror = function () {
        loaderPromise = null;
        reject(new Error("표 캡처 모듈을 불러오지 못했습니다."));
      };
      document.head.appendChild(loader);
    });
    return loaderPromise;
  }

  function captureScale(width, height) {
    var desired = Math.min(window.devicePixelRatio || 1, 1.5);
    var maxSide = 30000;
    var maxArea = 40000000;
    return Math.min(
      desired,
      maxSide / Math.max(width, height),
      Math.sqrt(maxArea / Math.max(1, width * height))
    );
  }

  function safeSeed() {
    var seed = new URL(window.location.href).searchParams.get("seed") || "seed";
    return String(seed).replace(/[^0-9A-Za-z_-]+/g, "-");
  }

  function filename() {
    var page = isMultiPage() ? "multi" : "track";
    var now = new Date();
    var stamp = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") + "-" +
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0") +
      String(now.getSeconds()).padStart(2, "0");
    return "catsroll-" + page + "-" + safeSeed() + "-" + stamp + ".png";
  }

  function download(canvas, name) {
    return canvasBlob(canvas).then(function (blob) {
      return new Promise(function (resolve) {
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = name;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 1000);
        resolve();
      });
    });
  }

  function canvasBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error("PNG 파일을 만들지 못했습니다."));
      }, "image/png");
    });
  }

  function renderedRowLimit(target) {
    if (isMultiPage()) {
      var table = target.querySelector(".multi-track-table");
      return table ? table.querySelectorAll("tbody > tr").length : 0;
    }

    var maximum = 0;
    target.querySelectorAll('[id^="N"]').forEach(function (cell) {
      var match = /^N(\d+)/.exec(cell.id || "");
      if (match) {
        maximum = Math.max(maximum, parseInt(match[1], 10));
      }
    });
    return maximum;
  }

  function routeDestination() {
    if (!isMultiPage()) return null;
    if (window.MultiFindApp &&
        typeof window.MultiFindApp.getDestination === "function") {
      return window.MultiFindApp.getDestination();
    }

    var result = document.querySelector("#multi_find_result");
    if (!result || !/Find route\s*·\s*완료/.test(result.textContent || "")) {
      return null;
    }
    var match = /다음 위치:\s*(\d+[AB])/.exec(result.textContent || "");
    return match && match[1];
  }

  function defaultConfiguration(target) {
    var maximum = renderedRowLimit(target);
    var destination = routeDestination();
    var match = /^(\d+)/.exec(String(destination || ""));
    var routeLimit = match ? parseInt(match[1], 10) : 0;
    var limit = routeLimit > 0 ? Math.min(routeLimit, maximum) : maximum;
    return {
      maximum: maximum,
      limit: Math.max(1, limit || 1),
      destination: destination
    };
  }

  function trimMultiRows(copy, limit) {
    copy.querySelectorAll(".multi-track-table tbody").forEach(function (body) {
      Array.prototype.slice.call(body.querySelectorAll(":scope > tr"), limit).
        forEach(function (row) { row.remove(); });
    });
  }

  function trimRegularRows(copy, limit) {
    var beyondLimit = false;
    copy.querySelectorAll("tbody > tr").forEach(function (row) {
      var numbered = row.querySelectorAll('[id^="N"]');
      for (var index = 0; index < numbered.length; index++) {
        var match = /^N(\d+)/.exec(numbered[index].id || "");
        if (match && parseInt(match[1], 10) > limit) {
          beyondLimit = true;
          break;
        }
      }
      if (beyondLimit) row.remove();
    });
  }

  function trimRows(copy, limit) {
    if (isMultiPage()) {
      trimMultiRows(copy, limit);
    } else {
      trimRegularRows(copy, limit);
    }
  }

  function stagedTarget(target, limit) {
    var width = Math.ceil(target.scrollWidth);
    if (isMultiPage()) {
      width = Math.max(width, 1200);
    }

    var stage = document.createElement("div");
    stage.setAttribute("aria-hidden", "true");
    stage.style.cssText = [
      "position:fixed",
      "left:-100000px",
      "top:0",
      "z-index:-2147483647",
      "width:" + width + "px",
      "overflow:visible",
      "pointer-events:none",
      "background:#fff"
    ].join(";");

    var copy = target.cloneNode(true);
    trimRows(copy, limit);
    copy.style.width = width + "px";
    copy.style.maxWidth = "none";
    copy.style.margin = "0";
    copy.style.background = "#fff";
    copy.querySelectorAll("th").forEach(function (cell) {
      cell.style.position = "static";
    });
    stage.appendChild(copy);
    var host = target.closest(".multi-track-app") || document.body;
    host.appendChild(stage);

    return new Promise(function (resolve) {
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          resolve({
            element: copy,
            stage: stage,
            width: Math.ceil(copy.scrollWidth),
            height: Math.ceil(copy.scrollHeight)
          });
        });
      });
    });
  }

  function normalizedLimit(value, maximum) {
    var parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return maximum;
    return Math.max(1, Math.min(parsed, maximum));
  }

  function capture(options) {
    if (!supportedPage()) {
      return Promise.reject(new Error("이 화면에서는 표를 공유할 수 없습니다."));
    }

    return Promise.all([
      waitForTarget(),
      loadHtml2Canvas(),
      document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()
    ]).then(function (values) {
      var target = values[0];
      var html2canvas = values[1];
      var maximum = renderedRowLimit(target);
      if (!maximum) throw new Error("공유할 표의 행을 찾지 못했습니다.");
      var requested = typeof options === "number" ? options : options && options.limit;
      var limit = normalizedLimit(requested, maximum);
      var staged;

      return stagedTarget(target, limit).then(function (value) {
        staged = value;
        var scale = captureScale(staged.width, staged.height);

        return html2canvas(staged.element, {
          backgroundColor: "#ffffff",
          logging: false,
          scale: scale,
          useCORS: true,
          allowTaint: false,
          width: staged.width,
          height: staged.height,
          windowWidth: Math.max(document.documentElement.clientWidth, staged.width),
          windowHeight: Math.max(document.documentElement.clientHeight, staged.height)
        }).then(function (canvas) {
          return {
            canvas: canvas,
            filename: filename(),
            width: canvas.width,
            height: canvas.height,
            scale: scale,
            limit: limit
          };
        });
      }).finally(function () {
        if (staged && staged.stage) {
          staged.stage.remove();
        }
      });
    });
  }

  function resultDetails(result) {
    return {
      filename: result.filename,
      width: result.width,
      height: result.height,
      scale: result.scale,
      limit: result.limit
    };
  }

  function save(options) {
    return capture(options).then(function (result) {
      return download(result.canvas, result.filename).then(function () {
        return resultDetails(result);
      });
    });
  }

  function copyPng(options) {
    if (!navigator.clipboard || typeof navigator.clipboard.write !== "function" ||
        typeof window.ClipboardItem !== "function") {
      return Promise.reject(new Error(
        "이 브라우저는 PNG 클립보드 복사를 지원하지 않습니다."));
    }

    var capturePromise = capture(options);
    var blobPromise = capturePromise.then(function (result) {
      return canvasBlob(result.canvas);
    });
    var writePromise;
    try {
      writePromise = navigator.clipboard.write([
        new window.ClipboardItem({ "image/png": blobPromise })
      ]);
    } catch (_error) {
      writePromise = blobPromise.then(function (blob) {
        return navigator.clipboard.write([
          new window.ClipboardItem({ "image/png": blob })
        ]);
      });
    }

    return Promise.all([capturePromise, writePromise]).then(function (values) {
      return resultDetails(values[0]);
    });
  }

  function createShareUrl(limit) {
    if (isMultiPage()) {
      if (!window.MultiShareApp ||
          typeof window.MultiShareApp.createUrl !== "function") {
        throw new Error("Multi 공유 링크 모듈을 불러오지 못했습니다.");
      }
      return window.MultiShareApp.createUrl(limit);
    }

    var url = new URL(window.location.href);
    url.searchParams.set("count", String(limit));
    return url.toString();
  }

  function copyText(value) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(value);
    }

    return new Promise(function (resolve, reject) {
      var input = document.createElement("textarea");
      input.value = value;
      input.setAttribute("readonly", "");
      input.style.cssText = "position:fixed;left:-100000px;top:0";
      document.body.appendChild(input);
      input.select();
      try {
        if (document.execCommand("copy")) resolve();
        else reject(new Error("URL을 클립보드에 복사하지 못했습니다."));
      } catch (error) {
        reject(error);
      } finally {
        input.remove();
      }
    });
  }

  function shareLink(limit) {
    var url = createShareUrl(limit);
    var copied = copyText(url).then(function () {
      return { ok: true };
    }).catch(function (error) {
      return { ok: false, error: error };
    });
    var nativeAttempted = false;

    if (typeof navigator.share === "function") {
      try {
        nativeAttempted = true;
        navigator.share({
          title: "Battle Cats Rolls",
          text: isMultiPage() ? "Multi Track 공유" : "Track 공유",
          url: url
        }).catch(function () {
          // The URL copy remains useful when the native share sheet is dismissed.
        });
      } catch (_error) {
        nativeAttempted = false;
      }
    }

    return copied.then(function (copyResult) {
      if (!copyResult.ok && !nativeAttempted) {
        throw copyResult.error ||
          new Error("공유 링크를 전달하지 못했습니다.");
      }
      return {
        url: url,
        copied: copyResult.ok,
        nativeAttempted: nativeAttempted
      };
    });
  }

  function injectDialogStyle() {
    if (document.getElementById("table-share-style")) return;
    var style = document.createElement("style");
    style.id = "table-share-style";
    style.textContent = [
      ".table-share-dialog{position:fixed;inset:0;display:none;align-items:center;",
      "justify-content:center;width:100%;height:100dvh;max-width:none;max-height:none;",
      "margin:0;padding:0;border:0;background:transparent;font-family:inherit}",
      ".table-share-dialog[open]{display:flex}",
      ".table-share-dialog::backdrop{background:rgba(0,0,0,.45)}",
      ".table-share-backdrop{position:absolute;inset:0}",
      ".table-share-panel{position:relative;z-index:1;box-sizing:border-box;",
      "width:min(25rem,calc(100% - 24px));padding:0;border:1px solid #888;",
      "border-radius:10px;background:#fff;box-shadow:0 14px 45px rgba(0,0,0,.25);",
      "overflow:hidden;color:#222}",
      ".table-share-header{display:flex;align-items:center;justify-content:space-between;",
      "gap:12px;padding:14px 16px 10px;border-bottom:1px solid #ddd}",
      ".table-share-header h2{margin:0;font-size:1.05rem}",
      ".table-share-close{width:32px;height:32px;margin:0;padding:0;border:0;",
      "border-radius:50%;background:#f1f1f1;font-size:25px;line-height:30px;cursor:pointer}",
      ".table-share-body{padding:16px}",
      ".table-share-field{display:grid;gap:6px;margin:0}",
      ".table-share-field span{font-size:.82rem;font-weight:700}",
      ".table-share-field input{box-sizing:border-box;width:100%;padding:8px 10px;",
      "border:1px solid #999;border-radius:7px;background:#fff;color:#222;",
      "font:inherit;font-size:1rem}",
      ".table-share-note,.table-share-status{margin:9px 0 0;color:#666;",
      "font-size:.78rem;line-height:1.4}",
      ".table-share-status.is-error{color:#b3261e}",
      ".table-share-actions{display:flex;justify-content:stretch;gap:8px;",
      "padding:0 16px 16px}",
      ".table-share-actions button{margin:0;padding:7px 13px;border:1px solid #777;",
      "border-radius:7px;background:#fff;color:#222;font:inherit;font-size:.82rem;",
      "font-weight:700;cursor:pointer;flex:1;white-space:nowrap}",
      ".table-share-actions .table-share-link{border-color:#275a90;",
      "background:#275a90;color:#fff}",
      ".table-share-status a{margin-left:.35rem;color:#275a90;font-weight:700}",
      ".table-share-actions button:disabled,.table-share-close:disabled{opacity:.55;",
      "cursor:wait}"
    ].join("");
    document.head.appendChild(style);
  }

  function finishDialog(result) {
    var resolve = activeResolve;
    activeResolve = null;
    activePromise = null;
    activeMax = 0;
    modalBusy = false;
    if (dialogElements.dialog.open) dialogElements.dialog.close();
    if (resolve) resolve(result);
  }

  function cancelDialog() {
    if (modalBusy || !activeResolve) return;
    finishDialog(null);
  }

  function setDialogBusy(action, busy) {
    modalBusy = busy;
    dialogElements.input.disabled = busy;
    dialogElements.actions.forEach(function (button) { button.disabled = busy; });
    dialogElements.close.disabled = busy;
    dialogElements.actions.forEach(function (button) {
      button.textContent = button.dataset.defaultLabel;
    });
    if (busy && action) {
      var active = dialogElements.dialog.querySelector(
        "[data-table-share-action='" + action + "']");
      if (active) {
        active.textContent = action === "save" ? "저장 중…" :
          (action === "copy" ? "복사 중…" : "공유 중…");
      }
    }
  }

  function showDialogStatus(message, isError, url) {
    dialogElements.status.textContent = message || "";
    dialogElements.status.classList.toggle("is-error", !!isError);
    if (url) {
      var link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "링크 확인";
      dialogElements.status.appendChild(link);
    }
  }

  function dialogLimit() {
    var value = parseInt(dialogElements.input.value, 10);
    if (!Number.isFinite(value) || value < 1 || value > activeMax) {
      dialogElements.input.setCustomValidity(
        "1부터 " + activeMax + " 사이의 숫자를 입력해 주세요.");
      dialogElements.input.reportValidity();
      return null;
    }
    dialogElements.input.setCustomValidity("");
    return value;
  }

  function runDialogAction(action) {
    if (modalBusy) return;
    var value = dialogLimit();
    if (value == null) return;

    setDialogBusy(action, true);
    showDialogStatus(action === "save" ? "PNG를 만드는 중입니다." :
      (action === "copy" ? "PNG를 만들어 클립보드에 복사하는 중입니다." :
        "공유 링크를 만드는 중입니다."), false);

    var operation;
    try {
      operation = action === "save" ? save({ limit: value }) :
        (action === "copy" ? copyPng({ limit: value }) : shareLink(value));
    } catch (error) {
      operation = Promise.reject(error);
    }

    operation.then(function (result) {
      setDialogBusy(action, false);
      if (action === "save") {
        showDialogStatus("PNG를 저장했습니다.", false);
      } else if (action === "copy") {
        showDialogStatus("PNG를 클립보드에 복사했습니다.", false);
      } else {
        var message = result.nativeAttempted ?
          (result.copied ? "공유 창을 열었고 URL도 클립보드에 복사했습니다." :
            "공유 창을 열었습니다.") :
          "공유 URL을 클립보드에 복사했습니다.";
        showDialogStatus(message, false, result.url);
      }
    }).catch(function (error) {
      setDialogBusy(action, false);
      showDialogStatus(error && error.message ? error.message :
        "공유 작업을 완료하지 못했습니다.", true);
    });
  }

  function ensureDialog() {
    if (dialogElements) return dialogElements;
    injectDialogStyle();

    var dialog = document.createElement("dialog");
    dialog.id = "table_share_dialog";
    dialog.className = "table-share-dialog";
    dialog.setAttribute("aria-labelledby", "table_share_title");
    dialog.innerHTML = [
      '<div class="table-share-backdrop" data-table-share-cancel aria-hidden="true"></div>',
      '<form class="table-share-panel">',
        '<div class="table-share-header">',
          '<h2 id="table_share_title">공유</h2>',
          '<button type="button" class="table-share-close" data-table-share-cancel ',
            'aria-label="닫기">&times;</button>',
        '</div>',
        '<div class="table-share-body">',
          '<label class="table-share-field" for="table_share_limit">',
            '<span>몇 번까지 포함할까요?</span>',
            '<input id="table_share_limit" name="limit" type="number" min="1" ',
              'step="1" inputmode="numeric" required>',
          '</label>',
          '<p class="table-share-note" id="table_share_note"></p>',
          '<p class="table-share-status" role="status" aria-live="polite"></p>',
        '</div>',
        '<div class="table-share-actions">',
          '<button type="button" data-table-share-action="save">PNG 저장</button>',
          '<button type="button" data-table-share-action="copy">PNG 복사</button>',
          '<button type="button" class="table-share-link" ',
            'data-table-share-action="link">공유하기</button>',
        '</div>',
      '</form>'
    ].join("");
    document.body.appendChild(dialog);

    dialogElements = {
      dialog: dialog,
      form: dialog.querySelector("form"),
      input: dialog.querySelector("#table_share_limit"),
      note: dialog.querySelector("#table_share_note"),
      status: dialog.querySelector(".table-share-status"),
      close: dialog.querySelector(".table-share-close"),
      actions: dialog.querySelectorAll("[data-table-share-action]"),
      cancel: dialog.querySelectorAll("[data-table-share-cancel]")
    };

    dialogElements.actions.forEach(function (button) {
      button.dataset.defaultLabel = button.textContent;
      button.addEventListener("click", function () {
        runDialogAction(button.dataset.tableShareAction);
      });
    });

    dialogElements.cancel.forEach(function (button) {
      button.addEventListener("click", cancelDialog);
    });
    dialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      cancelDialog();
    });
    dialogElements.input.addEventListener("input", function () {
      dialogElements.input.setCustomValidity("");
      showDialogStatus("", false);
    });
    dialogElements.form.addEventListener("submit", function (event) {
      event.preventDefault();
      runDialogAction("save");
    });

    return dialogElements;
  }

  function open() {
    if (!supportedPage()) {
      return Promise.reject(new Error("이 화면에서는 표를 공유할 수 없습니다."));
    }
    if (activePromise) return activePromise;

    var elements = ensureDialog();
    activePromise = waitForTarget().then(function (target) {
      var config = defaultConfiguration(target);
      if (!config.maximum) {
        throw new Error("저장할 표의 행을 찾지 못했습니다.");
      }

      activeMax = config.maximum;
      setDialogBusy(null, false);
      elements.input.max = String(config.maximum);
      elements.input.value = String(config.limit);
      elements.input.setCustomValidity("");
      showDialogStatus("", false);
      elements.note.textContent = config.destination ?
        "Find route 도착 위치 " + config.destination +
          "를 기준으로 자동 입력했습니다. 최대 " + config.maximum + "번입니다." :
        "현재 표는 최대 " + config.maximum + "번까지 포함할 수 있습니다.";

      return new Promise(function (resolve) {
        activeResolve = resolve;
        elements.dialog.showModal();
        elements.input.focus();
        elements.input.select();
      });
    }).catch(function (error) {
      activePromise = null;
      throw error;
    });

    return activePromise;
  }

  window.CatsRollTableShare = {
    available: supportedPage,
    open: open,
    save: save,
    copyPng: copyPng,
    createShareUrl: createShareUrl
  };
}());
