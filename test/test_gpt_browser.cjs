// Optional real-browser integration check. Start the opt-in server first.
// Supply Playwright via NODE_PATH or PLAYWRIGHT_MODULE; no product npm dependency.
"use strict";
const assert = require("node:assert/strict");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.CATSROLL_GPT_TEST_URL || "http://127.0.0.1:17867";

(async () => {
  const browser = await chromium.launch({headless: true,
    channel: process.env.GPT_BROWSER_CHANNEL || "chrome"});
  try {
    const page = await browser.newPage({viewport: {width: 1000, height: 900}});
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/gpt-bridge-test", route => route.fulfill({contentType: "text/html", body: `
      <!doctype html><iframe id="widget" sandbox="allow-scripts allow-same-origin" src="/gpt"
        style="width:950px;height:850px"></iframe><script>
      window.messages=[]; window.latestResult=null; window.holdPrepare=false; window.releases=[];
      addEventListener('message',async event=>{
        if(event.source!==document.querySelector('iframe').contentWindow)return;
        const m=event.data;if(!m||m.jsonrpc!=='2.0')return; messages.push(m);
        let result={};
        if(m.method==='ui/initialize')result={protocolVersion:'2026-01-26',
          hostInfo:{name:'local-test-host',version:'1'},hostCapabilities:{},hostContext:{}};
        else if(m.method==='tools/call'){
          const r=await fetch('/mcp',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({...m,method:'tools/call'})}); result=(await r.json()).result;
          if(holdPrepare && m.params.name==='catsroll_prepare') await new Promise(resolve=>releases.push(resolve));
        } else if(m.method==='ui/message' && !Array.isArray(m.params.content)){
          event.source.postMessage({jsonrpc:'2.0',id:m.id,error:{code:-32602,message:'content must be array'}},event.origin); return;
        }
        if(m.id!=null)event.source.postMessage({jsonrpc:'2.0',id:m.id,result},event.origin);
        if(m.method==='ui/notifications/initialized'){
          const r=await fetch('/mcp',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({jsonrpc:'2.0',id:99,method:'tools/call',params:{name:'catsroll_prepare',
              arguments:{mode:'multi',seed:2762818371,count:10,rows:[{lang:'kr',event:'2026-02-13_1042'}]}}})});
          latestResult=(await r.json()).result;
          event.source.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:latestResult},event.origin);
        }
      });</script>`}));
    await page.goto(base + "/gpt-bridge-test");
    const frame = page.frameLocator("#widget");
    await page.waitForFunction(() => window.latestResult);
    await frame.locator("#seed").waitFor();
    assert.equal(await frame.locator("#seed").inputValue(), "2762818371");
    assert.equal(await frame.locator("#results-panel").isVisible(), false,
      "receiving prepared data never claims computation completed");
    await frame.locator("#calculate").click();
    await frame.locator("#results-panel").waitFor({state: "visible"});
    assert.equal(await frame.locator("#result-content tbody tr").count(), 10);
    await frame.locator("#send-context").click();
    await page.waitForFunction(() => messages.some(item => item.method === "ui/message"));
    const shared = await page.evaluate(() => messages.filter(item =>
      ["ui/update-model-context", "ui/message"].includes(item.method)));
    assert.equal(shared.length, 2);
    assert(Array.isArray(shared[1].params.content));
    assert.equal(shared[1].params.role, "user");

    await frame.locator("#seed").fill("42");
    assert.equal(await frame.locator("#results-panel").isVisible(), false,
      "edited inputs invalidate the old result and sharing");
    await page.evaluate(() => { window.holdPrepare = true; });
    await frame.locator("#calculate").click();
    await page.waitForFunction(() => releases.length === 1);
    assert.equal(await frame.locator("#mode").isDisabled(), true);
    await frame.locator("#cancel").click();
    await page.evaluate(() => { window.holdPrepare = false; releases.splice(0).forEach(resolve => resolve()); });
    await frame.locator("#calculate").waitFor({state: "visible"});
    // An unrelated awaited ping establishes that the delayed reply was processed.
    await page.evaluate(async () => {
      await fetch('/mcp', {method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:100,method:'ping'})});
    });
    assert.equal(await frame.locator("#results-panel").isVisible(), false,
      "a cancelled preparation cannot publish a late result");
    await frame.locator("#calculate").click();
    await frame.locator("#results-panel").waitFor({state: "visible"});
    assert.match(await frame.locator("#result-caption").innerText(), /42/);

    await page.goto(base + "/gpt");
    const workerChecks = await page.evaluate(async () => {
      const source = JSON.parse(document.getElementById('catsroll-worker-source').textContent);
      async function prepare(args) {
        const response = await fetch('/mcp', {method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'catsroll_prepare',arguments:args}})});
        return (await response.json()).result._meta['catsroll/data'];
      }
      const payload = await prepare({mode:'find',seed:42,count:10,
        rows:[{lang:'kr',event:'2019-01-23_348'}],targets:[{cat_id:38}],optimization:'distance'});
      const found = await CatsrollGptRuntime.start('find',payload,{source}).promise;
      const seeker = (await prepare({mode:'seek',rows:[{lang:'kr',event:'2019-01-23_348'}]})).seeker;
      const first = seeker.choices.find(cat => cat.rarity === 5) || seeker.choices.find(cat => cat.rarity === 4);
      seeker.rolls = [first.rarity,first.slot];
      const seed = await CatsrollGptRuntime.start('seek',{request:{mode:'seek'},seeker},{source}).promise;
      const run = CatsrollGptRuntime.start('find',payload,{source}); run.cancel();
      let cancelled = false;
      try { await run.promise; } catch (error) { cancelled = error.name === 'AbortError'; }
      return {find:found.status,seed:seed.status,cancelled};
    });
    assert.equal(workerChecks.find, "success");
    assert(workerChecks.seed >= 1);
    assert(workerChecks.cancelled);
    assert.deepEqual(errors, []);
    console.log("GPT browser: mock-host handshake, arrays, explicit sharing, stale-input/cancel isolation, Find and WASM Workers passed");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
