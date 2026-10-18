// Focused browser regressions for transport failures and complete fallback inputs.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.CATSROLL_GPT_TEST_URL || 'http://127.0.0.1:17867';
const request = {mode:'multi', seed:42, count:300, rows:[{lang:'kr',event:'2019-01-23_348'}],findEnabled:false};
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.GPT_BROWSER_CHANNEL||'chrome'});
 const page=await browser.newPage({viewport:{width:1000,height:900},acceptDownloads:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let capabilities={serverTools:{},message:{text:{}},updateModelContext:{text:{}}};
 let legacy=false;
 await page.route('**/gpt-test-host*',route=>{
  let body=fs.readFileSync(path.join(__dirname,'fixtures/gpt-host.html'),'utf8');
  body=body.replace('hostCapabilities:window.hostCapabilities,',legacy?'':'hostCapabilities:'+JSON.stringify(capabilities)+',');
  return route.fulfill({contentType:'text/html',body});
 });
 const frame=page.frameLocator('#widget');
 async function open(){
  await page.goto(base+'/gpt-test-host');await page.waitForFunction(()=>window.ready);
  await page.locator('#arguments').fill(JSON.stringify(request));await page.locator('#prepare').click();
  await page.waitForFunction(()=>latestResult?.structuredContent?.request?.seed===42);
  await frame.locator('#multi-container').waitFor({state:'visible'});
  await frame.locator('#count').evaluate((element,count)=>new Promise(resolve=>{
    const ready=()=>element.value===String(count)?resolve():setTimeout(ready,10);ready();
  }),request.count);
  await frame.locator('#calculate').click();await frame.locator('#multi_tables table').first().waitFor();
 }
 async function share(){
  const before=await page.evaluate(()=>messages.filter(x=>x.method==='ui/message').length);
  await frame.locator('#send-context').click();
  await page.waitForFunction(n=>messages.filter(x=>x.method==='ui/message').length>n,before);
  await frame.locator('#send-context').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.querySelector('iframe').contentDocument.querySelector('#send-context').disabled);
  return page.evaluate(()=>messages.filter(x=>x.method==='ui/message').at(-1).params.content[0].text);
 }
 try{
  await open();
  await frame.locator('body').evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  // A prior successful context must never make a failed retry send text without data.
  assert.equal(await share(),'현재 Catsroll 앱의 계산 결과와 플랜을 설명해 주세요. 표시된 상태와 생략 범위를 그대로 밝혀 주세요.');
  const originalId=await page.evaluate(()=>lastShareReply.structuredContent.result_id);
  await page.evaluate(()=>{rejectModelContext=true;});
  assert.match(await share(),/결과 조회: .*result_id/);
  assert.equal(await page.evaluate(()=>lastShareReply.structuredContent.result_id),originalId);
  const keys=await page.evaluate(()=>messages.filter(m=>m.method==='tools/call'&&m.params.name==='catsroll_share_result').map(m=>m.params.arguments.idempotency_key));
  assert.equal(new Set(keys).size,1);
  await page.evaluate(()=>{rejectModelContext=false;rejectContextResult=true;});
  assert.match(await share(),/결과 조회: .*result_id/);
  await page.evaluate(()=>{rejectContextResult=false;rejectMessage=true;});
  await share(); // The fixture records the rejected message before returning its error.
  await frame.locator('#share-recovery').waitFor({state:'visible'});
  assert.match(await frame.locator('#share-recovery-status').innerText(),/Message rejected/);
  const saved=JSON.parse(await frame.locator('#share-recovery-json').inputValue());
  assert.equal(saved.banners[0].rows.length,300);
  await frame.locator('body').evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(Error('denied'))}}));
  await frame.locator('#copy-share-json').click();
  assert.match(await frame.locator('#share-recovery-status').innerText(),/직접 복사/);
  assert.equal(await frame.locator('#share-recovery-json').evaluate(el=>el.selectionEnd-el.selectionStart),JSON.stringify(saved).length);
  const downloading=page.waitForEvent('download');await frame.locator('#download-share-json').click();
  const download=await downloading;assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(),'utf8')),saved);
  // A newer successful job must not change the result still displayed for recovery.
  await frame.locator('#seed').fill('99');
  await frame.locator('#calculate').click();
  await frame.locator('#multi_tables table').first().waitFor();
  await page.evaluate(()=>{rejectMessage=false;});
  await share();
  assert.equal(await frame.locator('#share-recovery-json').inputValue(),JSON.stringify(saved));
  const downloadingA=page.waitForEvent('download');await frame.locator('#download-share-json').click();
  assert.deepEqual(JSON.parse(fs.readFileSync(await (await downloadingA).path(),'utf8')),saved,
    'download stays bound to the displayed recovery job A after job B succeeds');
  assert.match(await frame.locator('#share-recovery-provenance').innerText(),/입력이 바뀌었습니다/);
  await frame.locator('#seed').fill('42');
  await frame.locator('#calculate').click();
  await frame.locator('#multi_tables table').first().waitFor();
  // Storage saturation falls back to bounded computed data, with a complete local export.
  await page.evaluate(()=>{rejectMessage=false;writeFailure={status:'error',code:'storage_full',retryable:true,message:'Storage full'};});
  await share();
  assert.match(await frame.locator('#share-recovery-status').innerText(),/storage_full/);
  const direct=await page.evaluate(()=>messages.filter(m=>m.method==='ui/update-model-context').at(-1).params.content[0].text);
  assert.match(direct,/배너 배열:/);assert(direct.length<=60000);
  // Plan editing is separate from array input: freeze the old plan while a
  // publish is in flight, then share the edited plan without another engine run.
  await page.evaluate(()=>{writeFailure=null;holdShare=true;messages=[];});
  await frame.locator('#send-context').click();await page.waitForFunction(()=>shareReleases.length===1);
  await frame.locator('#multi_plan_name').evaluate(el=>{el.value='편집한 플랜';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.evaluate(()=>{holdShare=false;shareReleases.shift()();});
  await page.waitForFunction(()=>!document.querySelector('iframe').contentDocument.querySelector('#send-context').disabled);
  assert.equal(await page.evaluate(()=>messages.some(x=>x.method==='ui/message')),false);
  const oldPlan=JSON.parse(await frame.locator('#share-recovery-json').inputValue());
  assert.notEqual(oldPlan.plan.name,'편집한 플랜');
  assert.equal(await frame.locator('#multi_tables table').first().locator('tbody tr').count(),300);
  await share();
  assert.equal(await page.evaluate(()=>messages.some(x=>x.method==='tools/call'&&x.params.name==='catsroll_prepare')),false,
    'editing and sharing a plan never recalculates the array');
  assert.equal(await page.evaluate(()=>messages.filter(x=>x.method==='tools/call'&&x.params.name==='catsroll_share_result').at(-1).params.arguments.snapshot.plan.name),'편집한 플랜');
  // Snapshot is frozen before the async upload and never mixed with a newer seed.
  await page.evaluate(()=>{writeFailure=null;holdShare=true;messages=[];});
  await frame.locator('#send-context').click();await page.waitForFunction(()=>shareReleases.length===1);
  await frame.locator('#seed').fill('43');
  await page.evaluate(()=>{holdShare=false;shareReleases.shift()();});
  await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.querySelector('#share-recovery-status').textContent.includes('입력이 바뀌어'));
  assert.equal(JSON.parse(await frame.locator('#share-recovery-json').inputValue()).input.track.seed,42);
  assert.equal(await page.evaluate(()=>messages.some(x=>x.method==='ui/message')),false);
  assert.match(await frame.locator('#share-recovery-provenance').innerText(),/입력이 바뀌었습니다/);
  // Explicit unsupported features are not called; legacy hosts remain compatible.
  capabilities={serverTools:{},message:{text:{}}};await open();
  assert.match(await share(),/결과 조회:/);
  assert.equal(await page.evaluate(()=>messages.some(m=>m.method==='ui/update-model-context')),false);
  capabilities={serverTools:{},updateModelContext:{text:{}}};await open();
  await frame.locator('#send-context').click();
  await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.querySelector('#share-recovery-status').textContent.includes('메시지 전달을 사용할'));
  assert.equal(await page.evaluate(()=>messages.some(m=>m.method==='ui/message')),false);
  legacy=true;await open();assert.equal(await share(),'현재 Catsroll 앱의 계산 결과와 플랜을 설명해 주세요. 표시된 상태와 생략 범위를 그대로 밝혀 주세요.');
  // A standalone fragment restores every normalized input but never calculates automatically.
  async function prepare(args){const r=await page.request.post(base+'/mcp',{data:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'catsroll_prepare',arguments:args}}});const body=await r.json();assert(!body.result.isError,JSON.stringify(body.result));return body.result;}
  const complex=await prepare({...request,last:38,rows:[{lang:'kr',event:'2019-01-23_348',ubers:3,forceGuaranteed:11,previewFor:'jp'},{lang:'kr',event:'2019-01-23_348',ubers:2,forceGuaranteed:7}],planMode:true,planName:'복원 계획',targets:[{cat_id:38,allow_ticket:true}],maxGuaranteed:2,maxPlatinum:1,maxLegendTicket:2,optimization:'balance'});
  await page.goto(base+'/gpt'+new URL(complex.structuredContent.siteUrl).hash);
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('모든 계산 조건을 복원'));
  assert.equal(await page.locator('#multi_tables table').count(),0);
  assert.deepEqual(await page.evaluate(()=>MultiTrackApp.getShareState().rows.map(r=>Object.assign({lang:r.lang,event:r.event,ubers:r.ubers,forceGuaranteed:r.forceGuaranteed},r.previewFor?{previewFor:r.previewFor}:{}))),complex.structuredContent.request.rows);
  assert.equal(await page.locator('#last').inputValue(),'38');
  assert.equal(await page.locator('#multi_plan_name').inputValue(),'복원 계획');
  const seekBase=await prepare({mode:'seek',rows:request.rows});
  const observations=seekBase._meta['catsroll/data'].seeker.choices.slice(0,3).map(x=>x.id);
  const seeking=await prepare({mode:'seek',rows:request.rows,rolls:observations});
  await page.goto(base+'/gpt'+new URL(seeking.structuredContent.siteUrl).hash);
  await page.waitForFunction(()=>document.querySelector('#mode').value==='seek'&&document.querySelector('#status').textContent.includes('모든 계산 조건을 복원'));
  assert.equal(await page.locator('#mode').inputValue(),'seek');
  assert.deepEqual(await page.locator('#seek-rolls select').evaluateAll(els=>els.map(el=>Number(el.value))),observations);
  assert.equal(await page.locator('#seek-result').innerText(),'');
  // Host notifications are fenced independently of local Calculate RPCs.
  await open();
  await page.evaluate(()=>{holdHostResult=true;});
  await page.locator('#prepare').click();
  await page.waitForFunction(()=>hostResultReleases.length===1);
  await frame.locator('#seed').fill('99');
  await page.evaluate(()=>{holdHostResult=false;hostResultReleases.shift()();});
  await frame.locator('#status').getByText(/이전 준비 결과/).waitFor();
  assert.equal(await frame.locator('#seed').inputValue(),'99');
  // Different host calls must not consume one another's results.
  await page.evaluate(()=>{holdHostResult=true;});
  await page.locator('#arguments').fill(JSON.stringify({...request,seed:42}));
  await page.locator('#prepare').click();await page.waitForFunction(()=>hostResultReleases.length===1);
  await page.locator('#arguments').fill(JSON.stringify({...request,seed:43}));
  await page.locator('#prepare').click();await page.waitForFunction(()=>hostResultReleases.length===2);
  await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{isError:true,content:[{type:'text',text:'Old host failure'}]}},location.origin));
  await frame.locator('#status').getByText('Old host failure',{exact:true}).waitFor();
  await page.evaluate(()=>hostResultReleases.shift()());
  await frame.locator('#status').getByText(/현재 요청과 다른/).waitFor();
  assert.equal(await frame.locator('#seed').inputValue(),'43');
  await page.evaluate(()=>{holdHostResult=false;hostResultReleases.shift()();});
  await frame.locator('#status').getByText('설정을 불러왔습니다. 계산하기를 누르세요.',{exact:true}).waitFor();
  // Server normalization of set-like ownership must still correlate to its request.
  const collection={...request,targetSelection:{type:'banner_collection',lang:'kr',event:'2019-01-23_348',rarity:4,excludeOwnedIds:[418,418]}};
  await page.locator('#arguments').fill(JSON.stringify(collection));await page.locator('#prepare').click();
  await page.waitForFunction(()=>latestResult?._meta?.['catsroll/data']?.targetSelection?.excludeOwnedIds.length===1);
  await frame.locator('#status').getByText('설정을 불러왔습니다. 계산하기를 누르세요.',{exact:true}).waitFor();
  assert.equal(await frame.locator('#calculate').isEnabled(),true);
  assert.equal(await frame.locator('#multi_tables table').count(),0);
  // Both needs_input reasons are visible and block stale calculation/sharing.
  const allOwned={...request,targetSelection:{type:'banner_collection',lang:'kr',event:'2019-01-23_348',rarity:4,excludeOwnedIds:[418,418,356,307,306,305]}};
  await page.locator('#arguments').fill(JSON.stringify(allOwned));await page.locator('#prepare').click();
  await frame.locator('#status').getByText(/남은 목표가 없습니다/).waitFor();
  assert.equal(await frame.locator('#calculate').isEnabled(),false);
  assert.equal(await frame.locator('#send-context').isEnabled(),false);
  assert.equal(await frame.locator('#multi_tables table').count(),0);
  await page.evaluate(args=>{
    const win=document.querySelector('iframe').contentWindow;
    win.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-input',params:{arguments:args}},location.origin);
    win.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:{status:'needs_input',reason:'target_limit_exceeded',maximum:30,targetSelection:{...args.targetSelection,included_count:31}},_meta:{'catsroll/data':{targetSelection:{...args.targetSelection,included_count:31}}}}},location.origin);
  },allOwned);
  await frame.locator('#status').getByText(/선택한 목표 31종이 한도 30종/).waitFor();
  assert.equal(await frame.locator('#calculate').isEnabled(),false);
  const needsHash='#catsroll-input='+Buffer.from(JSON.stringify({version:1,arguments:allOwned})).toString('base64url');
  await page.goto(base+'/gpt'+needsHash);
  await page.locator('#status').getByText(/남은 목표가 없습니다/).waitFor();
  assert.equal(await page.locator('#calculate').isEnabled(),false,'fragment restoration handles needs_input');
  await page.goto(base+'/gpt-test-host?holdBootstrap=1');await page.waitForFunction(()=>ready&&bootstrapReleases.length===1);
  await page.locator('#arguments').fill(JSON.stringify(allOwned));await page.locator('#prepare').click();
  await frame.locator('#status').getByText(/남은 목표가 없습니다/).waitFor();
  await page.evaluate(()=>{holdBootstrap=false;bootstrapReleases.shift()();});
  await frame.locator('#multi-container').waitFor({state:'visible'});
  await frame.locator('#status').getByText(/남은 목표가 없습니다/).waitFor();
  assert.equal(await frame.locator('#calculate').isEnabled(),false,'bootstrap preserves needs_input');
  // Initialization and catalog retries preserve edits and never calculate or remount.
  await page.goto(base+'/gpt-test-host?rejectInitialize=1');
  await frame.locator('#retry-connection').waitFor({state:'visible'});
  await frame.locator('#seed').fill('99');await frame.locator('#count').fill('300');
  await frame.locator('#retry-connection').click();
  await frame.locator('#multi-container').waitFor({state:'visible'});
  assert.equal(await frame.locator('#seed').inputValue(),'99');
  assert.equal(await frame.locator('#count').inputValue(),'300');
  assert.equal(await frame.locator('#multi_tables table').count(),0);
  assert.equal(await page.evaluate(()=>messages.filter(m=>m.method==='ui/initialize').length),2);
  await page.goto(base+'/gpt-test-host?rejectBootstrap=1');
  await frame.locator('#retry-bootstrap').waitFor({state:'visible'});
  await page.locator('#arguments').fill(JSON.stringify(request));await page.locator('#prepare').click();
  await page.waitForFunction(()=>latestResult?.structuredContent?.request?.seed===42);
  await frame.locator('#seed').evaluate(element=>new Promise(resolve=>{
    const ready=()=>element.value==='42'?resolve():setTimeout(ready,10);ready();
  }));
  await frame.locator('#seed').fill('99');
  await page.evaluate(()=>{rejectBootstrap=false;});
  await frame.locator('#retry-bootstrap').click();
  await frame.locator('#multi-container').waitFor({state:'visible'});
  assert.equal(await frame.locator('#seed').inputValue(),'99');
  assert.equal(await frame.locator('#multi_track_data').count(),1);
  assert.equal(await frame.locator('#gpt-plan-settings').count(),1);
  assert.equal(await frame.locator('#multi_tables table').count(),0);
  assert.equal(await page.evaluate(()=>messages.filter(m=>m.method==='tools/call'&&m.params.name==='catsroll_share_result').length),0);
  const readyStages=await frame.locator('body').evaluate(()=>CatsrollDiagnostics().steps.map(s=>s.stage));
  assert(readyStages.indexOf('bootstrap-failed')<readyStages.indexOf('ui-mount-start'));
  assert(readyStages.indexOf('ui-mount-start')<readyStages.indexOf('ui-mounted'));
  assert.equal(readyStages.filter(s=>s==='ui-mounted').length,1);
  await open();
  await page.evaluate(()=>{rejectPrepare=true;});
  await frame.locator('#mode').selectOption('seek');
  await frame.locator('#status').getByText('Prepare rejected',{exact:true}).waitFor();
  assert.equal(await frame.locator('#calculate-seek').isEnabled(),true,'failed choice preparation can be retried');
  await page.evaluate(()=>{rejectPrepare=false;});
  await frame.locator('#calculate-seek').click();
  await frame.locator('#seek-rolls select').first().waitFor();
  assert.equal(await frame.locator('#seek-result').innerText(),'','retry prepares choices without running WASM');
  // Host context updates and explicit teardown affect the actual app, without publishing.
  await open();
  await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/host-context-changed',params:{displayMode:'fullscreen',safeAreaInsets:{top:12,right:7,bottom:20,left:4},containerDimensions:{width:390,height:700}}},location.origin));
  await page.waitForFunction(()=>document.querySelector('iframe').contentDocument.documentElement.dataset.displayMode==='fullscreen');
  assert.equal(await frame.locator('html').evaluate(el=>el.style.getPropertyValue('--host-safe-top')),'12px');
  assert.equal(await frame.locator('.app-shell').evaluate(el=>el.getBoundingClientRect().width<=390),true);
  assert.equal(await frame.locator('.app-shell').evaluate(el=>parseFloat(getComputedStyle(el).paddingTop)>=26),true,
    'mobile padding includes the host safe area');
  const diag=await frame.locator('body').evaluate(()=>CatsrollDiagnostics());
  assert.match(diag.diagnosticId,/^[0-9a-f-]{36}$/);
  assert.equal(diag.steps[0].stage,'html-start');
  assert(diag.steps.some(s=>s.stage==='ui-mounted'));
  assert(!JSON.stringify(diag).includes('seed'));
  const visibleDiag=JSON.parse(await frame.locator('#connection-diagnostics').textContent());
  assert.equal(visibleDiag.diagnosticId,diag.diagnosticId);
  assert(visibleDiag.steps.some(s=>s.stage==='ui-mounted'));
  await page.evaluate(()=>{holdPrepare=true;messages=[];});
  await frame.locator('#calculate').click();await page.waitForFunction(()=>releases.length===1);
  await page.evaluate(()=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',id:'teardown-test',method:'ui/resource-teardown',params:{}},location.origin));
  await page.waitForFunction(()=>messages.some(m=>m.id==='teardown-test'&&m.result));
  await page.evaluate(()=>{holdPrepare=false;releases.shift()();});
  assert.equal(await frame.locator('#calculate').isEnabled(),false);
  assert.equal(await page.evaluate(()=>messages.some(m=>m.method==='tools/call'&&m.params.name==='catsroll_share_result')),false);
  // Same-origin minimal control performs the handshake without catalog or engine calls.
  await page.route('**/gpt-probe-host',route=>{
    let body=fs.readFileSync(path.join(__dirname,'fixtures/gpt-host.html'),'utf8');
    return route.fulfill({contentType:'text/html',body:body.replace('src="/gpt"','src="/gpt/probe"')});
  });
  await page.goto(base+'/gpt-probe-host');
  await frame.locator('#connection').getByText('연결 완료 · 계산 실행 없음',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>messages.some(m=>m.method==='tools/call')),false);
  assert.equal(await frame.locator('#diagnostics').innerText().then(text=>JSON.parse(text).steps.some(s=>s.stage==='probe-ready')),true);
  assert.deepEqual(errors,[]);
  console.log('share recovery: GPT normal flow, context/message denial, idempotent retry, clipboard/download, size-bounded saturation fallback, immutable capture, advertised/legacy capabilities, full multi/seek fragment restoration passed');
 } finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
