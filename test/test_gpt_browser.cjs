// Optional browser regression. Start the opt-in local server first.
// UI behavior is also checked manually through CUA in the local host fixture.
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.CATSROLL_GPT_TEST_URL || "http://127.0.0.1:17867";
(async () => {
  const browser = await chromium.launch({headless: true, channel: process.env.GPT_BROWSER_CHANNEL || "chrome"});
  try {
    const page = await browser.newPage({viewport: {width: 1000, height: 1100}});
    const errors = [];
    page.on("pageerror", error => { errors.push(error.message); console.error(error.stack); });
    await page.route("**/gpt-test-host*", route => route.fulfill({contentType: "text/html",
      body: fs.readFileSync(path.join(__dirname, "fixtures/gpt-host.html"), "utf8").replace('src="/gpt"',
        new URL(route.request().url()).searchParams.has("claude") ? 'src="/gpt-test-claude-widget"' : 'src="/gpt"')}));
    await page.goto(base + "/gpt-test-host");
    const frame = page.frameLocator("#widget");
    await frame.locator("#seed").waitFor();
    await page.waitForFunction(() => window.ready);
    await page.evaluate(() => { rejectResultSharing=true; });
    await page.locator("#prepare").click();
    await frame.locator("#seed").waitFor({state: "visible"});
    await page.waitForFunction(() => window.latestResult);
    await assert.doesNotReject(async () => frame.locator("#calculate").waitFor());
    assert.equal(await frame.locator("#mode option[value=find]").count(), 0);
    assert.equal(await frame.locator("#seed").inputValue(), "42");
    assert.equal(await frame.locator("#multi_tables table").count(), 0, "prepared input never calculates automatically");
    assert.equal(await frame.locator("#calculate").isEnabled(), true, "prepared plan mode permits the initial Apply");
    await page.waitForFunction(() => messages.some(item => item.method === "ui/notifications/size-changed"));
    await page.waitForFunction(() => {
      const iframe = document.querySelector("iframe");
      return iframe.contentDocument.querySelector("#calculate").getBoundingClientRect().bottom <= iframe.clientHeight;
    });
    await page.waitForFunction(() => document.querySelector("iframe").contentDocument.querySelector("#multi_find_targets")?.value.includes("칼리파"));
    await frame.locator("#calculate").click();
    await frame.locator("#multi_tables table").first().waitFor();
    assert.equal(await frame.locator("#multi_tables table").count(), 2);
    assert.equal(await frame.locator("#multi_tables table").first().locator("tbody tr").count(), 10);
    await page.waitForFunction(() => document.querySelector("iframe").contentWindow.MultiFindApp.getResult()?.status === "success");
    const routeText = await frame.locator("#multi_find_result_content").textContent();
    assert.match(routeText, /플래티넘 티켓.*비용 \+1 →/);
    assert.match(routeText, /총 코스트 1/);
    assert.equal(await frame.locator("#multi_tables .multi-route-marked").count() > 0, true);
    await frame.locator("#multi_found summary").click();
    assert.match(await frame.locator("#multi_found_cats").innerText(), /ヨ|요수|[0-9]+[AB]/);
    assert.equal(await frame.locator("#gpt-found-select").count(),0);
    assert.equal(await frame.locator("#multi_plan_auto_draw").isEnabled(), true);
    await frame.locator("#multi_plan_auto_draw").click();
    assert.equal(await frame.locator("#multi_tables .multi-plan-picked-line").count() > 0, true);
    await frame.locator("#multi_plan_save").click();
    await frame.locator("#send-context").click();
    await page.waitForFunction(() => messages.some(item => item.method === "ui/message"));
    const shared = await page.evaluate(() => messages.find(item => item.method === "ui/update-model-context"));
    const visibleShare = await page.evaluate(() => messages.find(item => item.method === "ui/message"));
    assert.equal(visibleShare.params.content[0].text, "현재 Catsroll 앱의 계산 결과와 플랜을 설명해 주세요. 표시된 상태와 생략 범위를 그대로 밝혀 주세요.", "ChatGPT keeps its short follow-up message");
    assert.match(shared.params.content[0].text, /Find 계산:.*success/);
    assert.match(shared.params.content[0].text, /명계의 칼리파/);
    assert.match(shared.params.content[0].text, /플랜/);
    // A long successful route must include the final guaranteed acquisition in ChatGPT context.
    const messageCountBeforeLongRoute = await page.evaluate(() => messages.length);
    const longRouteShare = await frame.locator("body").evaluate(() => {
      const app = window.MultiFindApp;
      const original = app.getResult;
      app.getResult = () => ({status: "success", destination: "35B", cost: 1.48,
        rawCost: 1.48, baseCost: 1.48, regularUnitCost: 0.02, optimization: "cost",
        targetAcquired: 1, targetTotal: 1, regularUses: 24, guaranteedUses: 1,
        actions: Array.from({length: 24}, (_, i) => ({type: "roll", lang: "kr", event: "fixture",
          eventLabel: "검증 배너", start: (i + 1) + "A", resultLabel: (i + 1) + "A",
          next: (i + 2) + "A", catId: 38, catName: "고양이 홉핑", rarity: 2, acquired: []})).concat([{
            type: "guaranteed", lang: "kr", event: "fixture", eventLabel: "검증 배너",
            start: "25A", next: "35B", guaranteedLabel: "25AG", pulls: 11,
            routePulls: Array.from({length: 11}, (_, i) => ({resultLabel: i === 10 ? "25AG" : (25 + i) + "A", guaranteed: i === 10})),
            acquired: [{catId: 870, catName: "변신소녀 단", resultLabel: "25AG", targetIndex: 0}]
          }])});
      document.getElementById("send-context").click();
      app.getResult = original;
      return true;
    });
    assert.equal(longRouteShare, true);
    await page.waitForFunction(() => messages.filter(item => item.method === "ui/message").length === 2);
    const routeSnapshot = await page.evaluate(() => messages.filter(item => item.method === "ui/update-model-context").at(-1).params.content[0].text);
    assert.match(routeSnapshot, /25AG/);
    assert.match(routeSnapshot, /변신소녀 단/);
    assert.match(routeSnapshot, /"totalDraws":35/);
    await page.evaluate(count => messages.splice(count), messageCountBeforeLongRoute);
    // A new host input cancels and discards all old results/plan selections.
    const prepared = {mode: "multi", seed: 43, count: 10, rows: [{lang: "kr", event: "2019-01-23_348"}],
      targets: [{cat_id: 306}], findEnabled: true};
    await page.locator("#arguments").fill(JSON.stringify(prepared));
    await page.locator("#prepare").click();
    await frame.locator("#seed").waitFor();
    await page.waitForFunction(() => latestResult?.structuredContent?.request?.seed === 43);
    assert.equal(await frame.locator("#multi_tables table").count(), 0);
    await page.waitForFunction(() => document.querySelector("iframe").contentDocument.querySelector("#multi_find_targets")?.value.includes("고대군함 가레스"));
    assert.equal(await frame.locator("#send-context").isEnabled(), false);
    await frame.locator("#gpt-plan-settings summary").click();
    await frame.locator(".multi-plan-toggle-field").click();
    assert.equal(await frame.locator("#multi_plan_mode").isChecked(),false,"unapplied input cannot activate plan mode");
    assert.equal(await frame.locator("#multi_plan_panel").evaluate(el=>el.classList.contains("is-plan-off")),true);
    assert.equal(await frame.locator("#gpt-plan-warning").isVisible(),true);
    await page.evaluate(()=>{window.holdPrepare=true;});
    await frame.locator("#calculate").click();
    await page.waitForFunction(()=>releases.length===1);
    await frame.locator("#cancel").click();
    await page.evaluate(()=>{window.holdPrepare=false;releases.splice(0).forEach(resolve=>resolve());});
    await frame.locator("#status").getByText("계산을 중단했습니다.",{exact:true}).waitFor();
    assert.equal(await frame.locator("#multi_tables table").count(),0,"a cancelled preparation never publishes a late array");
    await page.evaluate(()=>{window.holdPrepare=true;});
    await frame.locator("#calculate").click();
    await page.waitForFunction(()=>releases.length===1);
    if (!await frame.locator("#gpt-find-settings").evaluate(el=>el.open)) await frame.locator("#gpt-find-settings summary").click();
    await frame.locator("#multi_find_max_guaranteed").fill("1");
    assert.equal(await frame.locator("#calculate").isEnabled(),true,"budget edit cancels pending preparation and restores controls");
    await page.evaluate(()=>{window.holdPrepare=false;releases.splice(0).forEach(resolve=>resolve());});
    assert.equal(await frame.locator("#multi_tables table").count(),0,"late pre-edit data cannot become current");
    // Reference arrays keep provenance through calculation, plan saving and model sharing.
    const lookup=await fetch(base+"/mcp",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"catsroll_banner_preview",arguments:{query:"검심",lang:"kr"}}})}).then(r=>r.json());
    const referenceRows=lookup.result.structuredContent.prepare_rows;
    await page.locator("#arguments").fill(JSON.stringify({mode:"multi",seed:42,count:10,rows:referenceRows}));
    await page.locator("#prepare").click();
    await frame.locator(".preview-notice").waitFor();
    assert.match(await frame.locator(".preview-notice").innerText(),/JP 풀 → KR 가정/);
    await frame.locator("#calculate").click();
    await frame.locator("#multi_tables table").first().waitFor();
    await frame.locator("#gpt-plan-settings summary").click();
    await frame.locator(".multi-plan-toggle-field").click();
    assert.equal(await frame.locator("#multi_plan_mode").isChecked(),true,"computed tracks can enable plan mode");
    await frame.locator(".multi-plan-toggle-field").click();
    assert.equal(await frame.locator("#multi_plan_mode").isChecked(),false);
    await frame.locator(".multi-plan-toggle-field").click();
    assert.equal(await frame.locator("#multi_plan_mode").isChecked(),true,"plan mode can be switched back on");
    await frame.locator("#multi_plan_save").click();
    await frame.locator("#send-context").click();
    await page.waitForFunction(()=>messages.filter(item=>item.method==="ui/update-model-context").length===2);
    const referenceContext=await page.evaluate(()=>messages.filter(item=>item.method==="ui/update-model-context").at(-1).params.content[0].text);
    assert.match(referenceContext,/참고 시뮬레이션: JP/);
    assert.match(referenceContext,/"previewFor":"kr"/);
    assert.match(referenceContext,/미래 복각 일정이 아니며/);
    // Viewport overflow belongs to the array scroller, not the entire app.
    const widths = await frame.locator("body").evaluate(body => ({scroll: body.scrollWidth, client: body.clientWidth}));
    assert(widths.scroll <= widths.client + 1);
    // Restore the old seed-finder contract after the Multi UI integration.
    const prepareReply = await fetch(base+"/mcp", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"catsroll_prepare",arguments:{mode:"seek",rows:[{lang:"kr",event:"2019-01-23_348"}]}}})}).then(r=>r.json());
    const choices=prepareReply.result._meta["catsroll/data"].seeker.choices;
    const find=require("../lib/battle-cats-rolls/asset/multi-find-engine.js");
    const poolReply=await fetch(base+"/mcp",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"catsroll_multi_data",arguments:{section:"pool",lang:"kr",event:"2019-01-23_348"}}})}).then(r=>r.json());
    const pool=poolReply.result._meta["catsroll/multi"];
    let offset=0,last=0;const rolls=[];
    for(let n=0;n<10;n++){const out=find.simulateRegular(pool,42,offset,last,0);assert(choices.some(c=>c.id===out.id));rolls.push(out.id);offset=out.nextOffset;last=out.lastRareId;}
    let expectedEnd=42;for(let n=0;n<offset;n++)expectedEnd=find.advanceSeed(expectedEnd);
    await page.locator("#arguments").fill(JSON.stringify({mode:"seek",rows:[{lang:"kr",event:"2019-01-23_348"}],rolls}));
    await page.locator("#prepare").click();
    await page.waitForFunction(()=>document.querySelector("iframe").contentDocument.querySelectorAll("#seek-rolls select").length===10);
    await frame.locator("#calculate-seek").click();
    await frame.locator("#seek-result").getByText("시작 시드: 42",{exact:true}).waitFor({timeout:120000});
    assert.match(await frame.locator("#seek-result").innerText(),new RegExp("관측 후 시드: "+expectedEnd));
    // Real hosts may finish the prepared tool before the larger bootstrap response.
    await page.goto(base + "/gpt-test-host?holdBootstrap=1");
    await page.waitForFunction(()=>bootstrapReleases.length===1);
    await page.locator("#arguments").fill(JSON.stringify({mode:"seek",rows:[{lang:"kr",event:"2019-01-23_348"}],rolls}));
    await page.locator("#prepare").click();
    await page.waitForFunction(()=>latestResult?.structuredContent?.request?.rolls?.length===10);
    await page.evaluate(()=>{holdBootstrap=false;bootstrapReleases.splice(0).forEach(resolve=>resolve());});
    await frame.locator("#seek-rolls select").last().waitFor();
    await page.waitForFunction(()=>document.querySelector("iframe").contentDocument.querySelectorAll("#seek-rolls select").length===10);
    assert.deepEqual(await frame.locator("#seek-rolls select").evaluateAll(es=>es.map(e=>Number(e.value))),rolls);
    assert.equal(await frame.locator("#calculate").isVisible(),false);
    assert.equal(await frame.locator("#rows .row-bottom").count(),0);
    assert.equal(await frame.locator("#add-roll").isEnabled(),false,"at most ten observations");
    assert.equal(await frame.locator("#seek-rolls label button").count(),0,"remove is separate from the select label");
    await frame.locator("#calculate-seek").click();
    await frame.locator("#seek-result").getByText("시작 시드: 42",{exact:true}).waitFor({timeout:120000});
    // Switching from Multi normalizes unsupported simulation settings only for seek.
    await page.locator("#arguments").fill(JSON.stringify({mode:"multi",seed:42,count:10,rows:[{lang:"kr",event:"2019-01-23_348",ubers:1,forceGuaranteed:11}]}));
    await page.locator("#prepare").click();
    await frame.locator("#calculate").waitFor({state:"visible"});
    await frame.locator("#mode").selectOption("seek");
    await frame.locator("#seek-rolls select").first().waitFor();
    assert.equal(await frame.locator("#calculate").isVisible(),false);
    assert.equal(await frame.locator("#rows .row-bottom").count(),0);
    assert.equal(await frame.locator("#seek-result").innerText(),"","preparing choices does not run the seeker");
    await frame.locator("#add-roll").click();
    assert.equal(await frame.locator("#seek-rolls select").count(),2);
    await frame.locator("#seek-rolls .seek-remove").last().click();
    assert.equal(await frame.locator("#seek-rolls select").count(),1);
    await frame.getByRole("combobox",{name:"배너 1 선택",exact:true}).selectOption("2026-10-20_947");
    await page.waitForFunction(()=>document.querySelector("iframe").contentDocument.querySelector("#status")?.textContent==="실제로 뽑은 결과를 순서대로 선택하세요.");
    assert.equal(await frame.locator("#calculate-seek").isEnabled(),true,"banner changes automatically prepare choices");
    await frame.locator("#mode").selectOption("multi");
    assert.equal(await frame.locator("#calculate").isVisible(),true);
    assert.equal(await frame.getByRole("combobox",{name:"배너 1 확정 뽑기",exact:true}).inputValue(),"11");
    // Use the actual Claude resource, keeping its compatibility behavior off ChatGPT.
    async function claudeRpc(method, params) {
      const response = await fetch(base + "/mcp/claude", {method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({jsonrpc:"2.0",id:1,method,params:params || {}})});
      return (await response.json()).result;
    }
    const claudeResource = (await claudeRpc("resources/list")).resources[0];
    const claudeHtml = (await claudeRpc("resources/read", {uri:claudeResource.uri})).contents[0].text;
    await page.route("**/gpt-test-claude-widget", route => route.fulfill({contentType:"text/html",body:claudeHtml}));
    await page.goto(base + "/gpt-test-host?claude=1");
    await page.waitForFunction(() => window.ready);
    await page.evaluate(() => { rejectResultSharing=true; });
    await page.locator("#prepare").click();
    await page.waitForFunction(() => latestResult?.structuredContent?.status === "prepared");
    await frame.locator("#calculate").click();
    await page.waitForFunction(() => document.querySelector("iframe").contentWindow.MultiFindApp.getResult()?.status === "success");
    await frame.locator("#send-context").click();
    await page.waitForFunction(() => messages.some(item => item.method === "ui/message"));
    const claudeShare = await page.evaluate(() => messages.find(item => item.method === "ui/message").params.content[0].text);
    const claudeContext = await page.evaluate(() => messages.find(item => item.method === "ui/update-model-context").params.content[0].text);
    assert(claudeShare.includes(claudeContext), "Claude receives computed data in the visible message");
    assert.match(claudeShare, /Find 계산:.*success/);
    await frame.locator("#send-context").waitFor({state:"visible"});
    await page.waitForFunction(() => !document.querySelector("iframe").contentDocument.querySelector("#send-context").disabled);
    await page.evaluate(() => { messages=[]; rejectModelContext=true; });
    await frame.locator("#send-context").click();
    await page.waitForFunction(() => messages.some(item => item.method === "ui/message"));
    assert.equal(await page.evaluate(() => messages.find(item => item.method === "ui/message").params.content[0].text), claudeShare,
      "Claude can share computed data when hidden context fails");
    // Default 100 and explicit 300: arrays arrive in context on both hosts.
    async function resultRpc(endpoint, name, args) {
      const response = await fetch(base + endpoint, {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "tools/call", params: {name, arguments: args}})});
      const envelope = await response.json();
      assert(!envelope.error, JSON.stringify(envelope.error));
      assert(!envelope.result.isError, JSON.stringify(envelope.result));
      return envelope.result.structuredContent;
    }
    for (const [hostPath, count] of [["", 100], ["?claude=1", 100], ["", 300], ["?claude=1", 300]]) {
      await page.goto(base + "/gpt-test-host" + hostPath);
      await page.waitForFunction(() => window.ready);
      await page.evaluate(() => { rejectResultSharing=false; });
      await page.locator("#arguments").fill(JSON.stringify({mode: "multi", seed: 42, ...(count === 300 ? {count} : {}),
        rows: [{lang: "kr", event: "2019-01-23_348", forceGuaranteed: 11}],
        findEnabled: true, targets: [{cat_id: 306, allow_ticket: true}],
        maxGuaranteed: 1, maxPlatinum: 1, planMode: true, planName: "300행 조회 검증"}));
      await page.locator("#prepare").click();
      await page.waitForFunction(n => latestResult?.structuredContent?.request?.count === n, count);
      await frame.locator("#count").fill("301");
      await frame.locator("#calculate").click();
      assert.equal(await frame.locator("#multi_tables table").count(), 0, "UI rejects counts above the MCP maximum");
      await frame.locator("#count").fill(String(count));
      await frame.locator("#calculate").click();
      await page.waitForFunction(() => document.querySelector("iframe").contentWindow.MultiFindApp.getResult()?.status === "success");
      if (!await frame.locator("#gpt-plan-settings").evaluate(el => el.open)) await frame.locator("#gpt-plan-settings summary").click();
      await frame.locator("#multi_plan_auto_draw").click();
      await frame.locator("#multi_plan_save").click();
      await frame.locator("#send-context").click();
      await page.waitForFunction(() => messages.some(item => item.method === "ui/message"));
      const baseline = await page.evaluate(() => {
        const win = document.querySelector("iframe").contentWindow;
        const snapshot = messages.find(item => item.method === "ui/update-model-context").params.content[0].text;
        const find = win.MultiFindApp.getResult();
        return {snapshot, visible: messages.find(item => item.method === "ui/message").params.content[0].text,
          route: find.actions, destination: find.destination, targetAcquired: find.targetAcquired, plan: win.MultiPlanApp.getState(),
          rows: win.MultiTrackApp.getOutputs()[0].out.cats.map(pair => pair.map(cat => [cat.id, cat.number(), cat.next && cat.next.number()]))};
      });
      const parseLine = prefix => JSON.parse(baseline.snapshot.split("\n").find(line => line.startsWith(prefix)).slice(prefix.length));
      assert(baseline.snapshot.includes("결과 조회: "), "new result sharing failed: " + JSON.stringify(await page.evaluate(() => lastShareReply?.isError ? lastShareReply.content : null)));
      const reference = parseLine("결과 조회: ");
      assert.match(reference.result_id, /^[0-9a-f]{64}$/);
      assert(baseline.snapshot.length <= 60000, "direct arrays plus lookup reference stay bounded");
      const direct = parseLine("배너 배열: ");
      assert.equal(direct.rowsIncluded, count);
      assert.equal(direct.rowsOmitted, 0);
      assert.deepEqual(direct.rows.map(pair => pair.map(cell => cell.slice(0, 3))), baseline.rows,
        "all A/B ID/result/next cells are already in context before any lookup");
      assert(Object.values(direct.rarities).includes(4), "shared arrays identify ubers without a catalog search");
      assert.match(baseline.snapshot, /새 배너 요청이 없으면/);
      const endpoint = hostPath ? "/mcp/claude" : "/mcp";
      const allRows = [];
      for (let start = 1; start <= count;) {
        const array = await resultRpc(endpoint, "catsroll_result", {result_id: reference.result_id,
          view: "array", banner: 0, start, limit: 50});
        allRows.push(...array.rows);
        assert(array.rows.length > 0);
        start = array.nextStart || count + 1;
      }
      assert.equal(allRows.length, count);
      assert.deepEqual(allRows.map(pair => [pair.A, pair.B].map(cell => [cell.id, cell.position, cell.next])), baseline.rows,
        "all 600 retrieved ID/result/next cells match the calculated table");
      const route = await resultRpc(endpoint, "catsroll_result", {result_id: reference.result_id, view: "summary"});
      assert.equal(route.find.totalDraws, baseline.route.reduce((n, action) => n + (action.type === "guaranteed" ? action.pulls : 1), 0));
      assert.equal(route.find.destination, baseline.destination);
      assert.equal(route.find.targetAcquired, baseline.targetAcquired);
      assert(route.find.targetsAcquired.some(item => item.catId === 306));
      const plan = await resultRpc(endpoint, "catsroll_result", {result_id: reference.result_id, view: "plan", limit: 50});
      assert.equal(plan.enabled, true);
      assert.equal(plan.name, "300행 조회 검증");
      assert.deepEqual(plan.collections.marks.items, baseline.plan.marks);
      assert.deepEqual(plan.collections.route.items, baseline.plan.route);
      assert.deepEqual(plan.collections.cats.items, baseline.plan.cats);
      if (hostPath) assert(baseline.visible.includes(baseline.snapshot));
      else assert.equal(baseline.visible, "현재 Catsroll 앱의 계산 결과와 플랜을 설명해 주세요. 표시된 상태와 생략 범위를 그대로 밝혀 주세요.");
      console.log((hostPath ? "Claude" : "GPT") + " count=" + count + ": direct arrays exact, full Find acquisition, chars=" + baseline.snapshot.length);
      if (count === 100) {
        const roster = await resultRpc(endpoint, "catsroll_cats", {lang: "kr", event: "2019-01-23_348", rarity: 4, limit: 50});
        const owned = roster.cats[0].id;
        const expected = roster.cats.filter(cat => cat.id !== owned).map(cat => cat.id).sort((a,b) => a-b);
        await page.locator("#arguments").fill(JSON.stringify({mode: "multi", seed: 42, count,
          rows: [{lang: "kr", event: "2019-01-23_348"}], maxGuaranteed: 1, maxPlatinum: 0,
          targetSelection: {type: "banner_collection", lang: "kr", event: "2019-01-23_348", rarity: 4, excludeOwnedIds: [owned]}}));
        await page.locator("#prepare").click();
        await page.waitForFunction(() => latestResult?.structuredContent?.targetSelection?.excluded_count === 1);
        await page.waitForFunction(ids => {
          const targets = document.querySelector("iframe").contentWindow.MultiFindApp.getShareSettings().targets;
          return JSON.stringify(targets.map(t => t.cat_id).sort((a,b)=>a-b)) === JSON.stringify(ids);
        }, expected);
        const selected = await page.evaluate(() => latestResult.structuredContent);
        assert.equal(selected.request.maxGuaranteed, 1);
        assert.equal(selected.request.count, 100);
        assert.equal(selected.request.findEnabled, true);
        assert.equal(await frame.locator("#multi_tables table").count(), 0, "collection preparation never computes automatically");
        console.log((hostPath ? "Claude" : "GPT") + " collection: all " + expected.length + " remaining targets reached the shared selector, budget preserved");
      }
    }
    // At the maximum count, multiple banners may omit arrays but never the route or plan.
    const stress = await frame.locator("body").evaluate(() => {
      const win = window;
      const source = win.MultiTrackApp.getOutputs()[0];
      const inputs = win.MultiTrackApp.getShareState();
      const output = Object.assign({}, source, {out: win.TrackEngine.buildTracks(source.pool, 42,
        {count: 999, position: "1A", last: 0, guaranteedRolls: 11, guaranteed: true, findCat: true})});
      const find = win.MultiFindApp.getResult();
      const start = performance.now();
      const snapshot = win.CatsrollGptResultSummary.build({track: Object.assign({}, inputs, {count: 999}),
        find, findEnabled: true, findSettings: win.MultiFindApp.getShareSettings(),
        plan: win.MultiPlanApp.getState(), outputs: Array.from({length: 8}, () => output)});
      const alternatives = win.MultiFindEngine.buildTrackAlternatives(Array.from({length: 8}, () => source.pool), 42, {count: 999, last: 0, formIndex: 0});
      const captured = win.CatsrollGptResultSummary.capture({track: Object.assign({}, inputs, {count: 999}),
        find, findEnabled: true, findSettings: win.MultiFindApp.getShareSettings(), plan: win.MultiPlanApp.getState(),
        outputs: Array.from({length: 8}, (_, i) => Object.assign({}, output, {alternatives: alternatives[i]}))});
      return {snapshot, elapsed: performance.now() - start, destination: find.destination, captured};
    });
    const stressLines = stress.snapshot.split("\n");
    const stressArrays = stressLines.filter(line => line.startsWith("배너 배열: ")).map(line => JSON.parse(line.slice("배너 배열: ".length)));
    assert.equal(stressArrays.length, 8);
    assert(stressArrays.some(item => item.rowsOmitted > 0));
    for (const array of stressArrays) {
      assert.equal(array.rowsTotal, 999);
      assert.equal(array.rowsIncluded + array.rowsOmitted, 999);
      assert.equal(array.rows.length, array.rowsIncluded);
    }
    const stressFind = JSON.parse(stressLines.find(line => line.startsWith("Find 계산: ")).slice("Find 계산: ".length));
    assert.equal(stressFind.destination, stress.destination);
    assert(stressFind.targetsAcquired.some(item => item.catId === 306));
    assert(stress.snapshot.length <= 60000);
    assert(stress.elapsed < 5000, "snapshot serialization should not freeze the UI");
    console.log("999x8 banners: explicit omissions, route retained, chars=" + stress.snapshot.length + ", ms=" + Math.round(stress.elapsed));
    assert(stress.captured.banners.every(b => b.rowsIncluded === 999 && b.rowsOmitted === 0 && b.conditionalOmitted === 0));
    console.log("full store payload bytes=" + Buffer.byteLength(JSON.stringify(stress.captured)));
    const extreme = await resultRpc("/mcp/claude", "catsroll_share_result", {snapshot: stress.captured});
    for (let banner = 0; banner < 8; banner++) {
      const tail = await resultRpc("/mcp/claude", "catsroll_result", {result_id: extreme.result_id, view: "array", banner, start: 999, limit: 1});
      assert.equal(tail.rows.length, 1);
      assert.equal(tail.rows[0].A.position, "999A");
      assert.equal(tail.rows[0].B.position, "999B");
    }
    console.log("full result store999x8: all 15984 cells and conditional branches retained, late-row lookup passed, bytes=" + Buffer.byteLength(JSON.stringify(stress.captured)));
    assert.deepEqual(errors, []);
    console.log("GPT shared Multi: canonical targets, manual Apply, arrays+Find stamps, plan switching/save, reference provenance, host sharing, cancellation, mobile width and WASM seed recovery passed");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
