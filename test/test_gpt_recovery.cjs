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
  // Storage saturation falls back to bounded computed data, with a complete local export.
  await page.evaluate(()=>{rejectMessage=false;writeFailure={status:'error',code:'storage_full',retryable:true,message:'Storage full'};});
  await share();
  assert.match(await frame.locator('#share-recovery-status').innerText(),/storage_full/);
  const direct=await page.evaluate(()=>messages.filter(m=>m.method==='ui/update-model-context').at(-1).params.content[0].text);
  assert.match(direct,/배너 배열:/);assert(direct.length<=60000);
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
  assert.deepEqual(errors,[]);
  console.log('share recovery: GPT normal flow, context/message denial, idempotent retry, clipboard/download, size-bounded saturation fallback, immutable capture, advertised/legacy capabilities, full multi/seek fragment restoration passed');
 } finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
