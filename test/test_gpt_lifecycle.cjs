'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const createApplication = require('../lib/battle-cats-rolls/asset/gpt-application-state.js');
const app = createApplication(), run = app.calculation;
const first = run.begin();
let cancelled = 0;
run.attach(first, {cancel() {cancelled++;}});
app.inputsChanged();
const second = run.begin();
assert.equal(cancelled, 1);
assert.equal(run.move(first, 'completed'), false, 'late completion cannot replace a newer run');
run.move(second, 'completed');
const revision = app.inputRevision();
app.planChanged();
assert.equal(app.inputRevision(), revision, 'plan edits do not invalidate calculated arrays');
assert.equal(run.phase(), 'completed');

const scope = {crypto: webcrypto, Uint8Array};
vm.createContext(scope);
vm.runInContext(fs.readFileSync('lib/battle-cats-rolls/asset/gpt-share.js','utf8'), scope);
const snapshot = {schema_version:1, input:{track:{seed:42,count:100}}, find:{status:'success'}, plan:{enabled:false}, banners:[]};
let writes = [], messages = [], contexts = [], recoveries = [], hold, failMessage = false;
let titlesSupported=false, contextSupported=true, missingTool=false;
const attachments=[];
const bridge = {isConnected:()=>true,supports:(name)=>name==='titledMessage'?titlesSupported:contextSupported||name!=='updateModelContext',
  async callTool(name,args) {
    if(name==='catsroll_share_result') {
      writes.push(args);
      if(missingTool) throw Error('MCP Resource not found');
      if(hold) await new Promise(resolve=>{hold=resolve;});
      return {structuredContent:{result_id:'a'.repeat(64),expires_at:'fixture',summary:{}}};
    }
    return {structuredContent:{status:'ok'}};
  },
  async updateContext(value) {contexts.push(value);return {};},
  async sendMessage(value,attachment) {messages.push(value);attachments.push(attachment);if(failMessage) throw Error('delivery denied');return {};}
};
const share = scope.CatsrollShare({bridge,profile:'chatgpt',capture:()=>({snapshot:JSON.parse(JSON.stringify(snapshot)),serverShare:true}),
  project:value=>JSON.stringify(value),inputRevision:app.inputRevision,planRevision:app.planRevision,
  resultError:r=>r?.isError?'denied':'',onRecovery:(...args)=>recoveries.push(args)});
(async()=>{
  assert.equal(writes.length,0,'only an explicit share command publishes');
  await share.send();
  const original=share.current();
  assert.equal(original.phase,'delivered');
  assert.equal(messages[0],'현재 Catsroll 앱의 계산 결과와 플랜을 설명해 주세요. 표시된 상태와 생략 범위를 그대로 밝혀 주세요.');
  assert(Object.isFrozen(original.capture));
  failMessage=true;
  await share.send();
  assert.equal(share.current(),original,'retry uses the immutable existing job');
  assert.equal(writes[0].idempotency_key,writes[1].idempotency_key);
  assert.equal(share.current().phase,'recoverable_error');
  assert.equal(run.phase(),'completed','delivery failure does not fail the calculation');
  assert.equal(recoveries.at(-1)[0].capture.input.track.seed,42);
  failMessage=false;hold=true;
  const before=messages.length;
  const sending=share.send();
  await new Promise(resolve=>setImmediate(resolve));
  app.inputsChanged();
  hold();hold=null;
  await sending;
  assert.equal(messages.length,before,'changed input fences the late publish response');
  assert.equal(share.current().serialized,original.serialized,'input invalidation preserves frozen export');
  assert.equal(share.current().phase,'recoverable_error');
  // A new plan creates a new share without rerunning the calculation.
  snapshot.plan={enabled:true,name:'edited'};
  app.planChanged();
  await share.send();
  assert.notEqual(share.current(),original);
  assert.equal(share.current().capture.plan.name,'edited');
  assert.notEqual(writes.at(-1).idempotency_key,writes[0].idempotency_key);
  assert.equal(JSON.parse(contexts.at(-1).split('\n')[0]).plan.name,'edited');
  assert.equal(original.capture.plan.enabled,false);
  titlesSupported=true;
  const contextCount=contexts.length,recoveryCount=recoveries.length;
  await share.send();
  const titled=attachments.at(-1);
  assert.equal(titled.title,'Catsroll 계산 결과 · 100행');
  assert.equal(titled.text,contexts.at(-1),'titled share preserves exactly the same snapshot and lookup guidance');
  assert.equal(messages.at(-1),messages[0],'the prompt stays short');
  assert.equal(contexts.length,contextCount,'atomic attachment avoids duplicating data in hidden context');
  assert.equal(recoveries.length,recoveryCount,'successful attachment is not presented as context failure');
  assert.equal(share.current().phase,'delivered');
  snapshot.input.track.count=300;
  await share.send();
  assert.equal(attachments.at(-1).title,'Catsroll 계산 결과 · 300행');
  assert.match(attachments.at(-1).text,/"count":300/);
  failMessage=true;
  const attempts=messages.length;
  await share.send();
  assert.equal(messages.length,attempts+1,'failed attachment never silently retries a potentially delivered message');
  assert.equal(share.current().phase,'recoverable_error');
  assert.match(share.current().fullText,/"count":300/,'full export survives attachment failure');
  failMessage=false;
  const claude=scope.CatsrollShare({bridge,profile:'claude',capture:()=>({snapshot:JSON.parse(JSON.stringify(snapshot)),serverShare:true}),
    project:value=>JSON.stringify(value),inputRevision:app.inputRevision,planRevision:app.planRevision,resultError:()=>''});
  await claude.send();
  assert.equal(attachments.at(-1),null,'Claude ignores OpenAI-only attachment behavior');
  assert(messages.at(-1).includes(contexts.at(-1)),'Claude retains visible snapshot delivery');
  titlesSupported=false;contextSupported=false;
  await share.send();
  assert.equal(attachments.at(-1),null);
  assert.match(messages.at(-1),/"count":300/,'unsupported hosts retain the full visible fallback');
  missingTool=true;
  const missingStatuses=[], missingRecoveries=[];
  const missing=scope.CatsrollShare({bridge,profile:'chatgpt',capture:()=>({snapshot:JSON.parse(JSON.stringify(snapshot)),serverShare:true}),
    project:value=>JSON.stringify(value),inputRevision:app.inputRevision,planRevision:app.planRevision,resultError:()=>'',
    onStatus:value=>missingStatuses.push(value),onRecovery:(...args)=>missingRecoveries.push(args)});
  for(const delivery of ['visible','context','title']) {
    titlesSupported=delivery==='title';contextSupported=delivery==='context';
    await missing.send();
    assert.equal(missing.current().phase,'delivered');
    assert.equal(missing.current().publicationError.code,'tool_unavailable');
    const deliveredText=delivery==='title'?attachments.at(-1).text:delivery==='context'?contexts.at(-1):messages.at(-1);
    assert.match(deliveredText,/"count":300/,'unpublished tools still deliver the captured result');
    assert.equal(missingRecoveries.length,0,'successful direct delivery does not open a large error export');
    assert.match(missingStatuses.at(-1),/추가 결과 조회는 현재 사용할 수 없습니다/);
  }
  failMessage=true;
  await missing.send();
  assert.equal(missing.current().phase,'recoverable_error');
  assert.match(missingRecoveries.at(-1)[1],/delivery denied/,'actual delivery failure still offers immutable recovery');
  console.log('application/share lifecycle: late run fencing, plan revisions, immutable retry, failed delivery recovery and explicit sharing passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
