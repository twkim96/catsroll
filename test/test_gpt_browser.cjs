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
    await page.route("**/gpt-test-host", route => route.fulfill({contentType: "text/html",
      body: fs.readFileSync(path.join(__dirname, "fixtures/gpt-host.html"), "utf8")}));
    await page.goto(base + "/gpt-test-host");
    const frame = page.frameLocator("#widget");
    await frame.locator("#seed").waitFor();
    await page.waitForFunction(() => window.ready);
    await page.locator("#prepare").click();
    await frame.locator("#seed").waitFor({state: "visible"});
    await page.waitForFunction(() => window.latestResult);
    await assert.doesNotReject(async () => frame.locator("#calculate").waitFor());
    assert.equal(await frame.locator("#mode option[value=find]").count(), 0);
    assert.equal(await frame.locator("#seed").inputValue(), "42");
    assert.equal(await frame.locator("#multi_tables table").count(), 0, "prepared input never calculates automatically");
    assert.equal(await frame.locator("#calculate").isEnabled(), true, "prepared plan mode permits the initial Apply");
    await page.waitForFunction(() => document.querySelector("iframe").contentDocument.querySelector("#multi_find_targets")?.value.includes("칼리파"));
    await frame.locator("#calculate").click();
    await frame.locator("#multi_tables table").first().waitFor();
    assert.equal(await frame.locator("#multi_tables table").count(), 2);
    assert.equal(await frame.locator("#multi_tables table").first().locator("tbody tr").count(), 10);
    await page.waitForFunction(() => document.querySelector("iframe").contentWindow.MultiFindApp.getResult()?.status === "success");
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
    assert.match(shared.params.content[0].text, /명계의 칼리파/);
    assert.match(shared.params.content[0].text, /플랜/);
    // A new host input cancels and discards all old results/plan selections.
    const prepared = {mode: "multi", seed: 43, count: 10, rows: [{lang: "kr", event: "2019-01-23_348"}],
      targets: [{cat_id: 545}], findEnabled: true};
    await page.locator("#arguments").fill(JSON.stringify(prepared));
    await page.locator("#prepare").click();
    await frame.locator("#seed").waitFor();
    await page.waitForFunction(() => latestResult?.structuredContent?.request?.seed === 43);
    assert.equal(await frame.locator("#multi_tables table").count(), 0);
    await page.waitForFunction(() => document.querySelector("iframe").contentDocument.querySelector("#multi_find_targets")?.value.includes("나나호"));
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
    assert.deepEqual(errors, []);
    console.log("GPT shared Multi: canonical targets, manual Apply, arrays+Find stamps, plan switching/save, reference provenance, host sharing, cancellation, mobile width and WASM seed recovery passed");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
