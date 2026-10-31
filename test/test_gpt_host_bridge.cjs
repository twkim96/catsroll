'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function make(embedded=true,options={}){
 const listeners=new Map(),sent=[],errors=[],frames=new Map(),timers=new Map();
 let ready=0,frameId=0,disconnected=0,timerId=0,now=0;
 const root={AbortController,URL,setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,due:now+ms});return id;},
  clearTimeout:id=>timers.delete(id),
  requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id),
  ResizeObserver:class{constructor(fn){this.callback=fn;}observe(){}disconnect(){disconnected++;}},
  addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
  removeEventListener:(name,fn)=>{const group=listeners.get(name);if(!group)return;group.delete(fn);if(!group.size)listeners.delete(name);},
  document:{documentElement:{clientWidth:390},body:{getBoundingClientRect:()=>({height:200})}}};
 root.parent=embedded?{postMessage:(m,origin)=>sent.push({m,origin})}:root;
 vm.createContext(root);vm.runInContext(fs.readFileSync('lib/battle-cats-rolls/asset/gpt-host-bridge.js','utf8'),root);
 const bridge=root.CatsrollHostBridge({...options,onReady:()=>{ready++;options.onReady?.();},onError:message=>errors.push(message)});
 function reply(m,origin='https://host.test',source=root.parent){for(const fn of listeners.get('message')||[])fn({source,origin,data:{jsonrpc:'2.0',...m}});}
 function advance(ms){now+=ms;while(true){const due=Array.from(timers.entries()).filter(([,timer])=>timer.due<=now).sort((a,b)=>a[1].due-b[1].due)[0];if(!due)break;timers.delete(due[0]);due[1].fn();}}
 function listenerCount(name){return listeners.get(name)?.size||0;}
 return {root,sent,errors,bridge,reply,listeners,frames,timers,advance,listenerCount,disconnected:()=>disconnected,ready:()=>ready};
}
(async()=>{
 const preinitEvents=[],preinitHost=make(true,{onDiagnostic:(...args)=>preinitEvents.push(['diagnostic',...args]),
  onNotification:message=>preinitEvents.push(['notification',message]),onReady:()=>preinitEvents.push(['ready'])});
 preinitHost.reply({id:'before-connect',method:'ping',params:{}},'https://early.test');
 assert.equal(preinitHost.sent.length,0,'messages before connect have no listener');
 preinitHost.bridge.connect();
 const preinitId=preinitHost.sent[0].m.id;
 const preinitSent=preinitHost.sent.length;
 for(const ignored of [
  [{id:'null-origin',method:'ping',params:{}},'null',preinitHost.root.parent],
  [{id:'empty-origin',method:'ping',params:{}},'',preinitHost.root.parent],
  [{id:'non-http-origin',method:'ping',params:{}},'file://host.test',preinitHost.root.parent],
  [{id:'wrong-source',method:'ping',params:{}},'https://host.test',{}],
  [{id:'bad-params',method:'ping',params:null},'https://host.test',preinitHost.root.parent],
  [{id:1.5,method:'ping',params:{}},'https://host.test',preinitHost.root.parent],
  [{method:'ping',params:{}},'https://host.test',preinitHost.root.parent],
  [{id:'bad-envelope',method:'ping',params:{},result:{}},'https://host.test',preinitHost.root.parent],
  [{id:'business',method:'tools/call',params:{name:'catsroll_result'}},'https://host.test',preinitHost.root.parent]
 ])preinitHost.reply(...ignored);
 assert.equal(preinitHost.sent.length,preinitSent,'invalid-origin, malformed and business requests are ignored before initialize');
 assert.deepEqual(preinitEvents,[['diagnostic','bridge-start'],['diagnostic','initialize-sent']],
  'ignored pre-initialize messages invoke no notification or ready handlers');
 preinitHost.reply({id:preinitId,method:'ping',params:{}},'https://ping-only.test');
 preinitHost.reply({id:'ping-string',method:'ping'},'http://ping-only.test');
 assert.deepEqual(preinitHost.sent.slice(preinitSent).map(item=>({m:JSON.parse(JSON.stringify(item.m)),origin:item.origin})),[
  {m:{jsonrpc:'2.0',id:preinitId,result:{}},origin:'https://ping-only.test'},
  {m:{jsonrpc:'2.0',id:'ping-string',result:{}},origin:'http://ping-only.test'}
 ],'pre-initialize ping supports integer collision and string IDs, replying only to each event origin');
 assert.equal(preinitHost.bridge.phase(),'connecting');assert.equal(preinitHost.bridge.isConnected(),false);
 assert.equal(preinitHost.timers.size,1,'pre-initialize ping leaves the initialize request pending');
 assert.equal(preinitEvents.length,2,'pre-initialize ping does not announce initialization');
 preinitHost.reply({id:preinitId,result:{}},'https://host.test');
 assert.equal(preinitHost.bridge.phase(),'ready','initialize response from a different valid origin pins normally');
 assert.equal(preinitHost.ready(),1);
 assert.equal(preinitHost.sent.at(-1).origin,'https://host.test');
 assert.equal(preinitHost.sent.at(-1).m.method,'ui/notifications/initialized');
 preinitHost.bridge.close();

 const stages=[];
 const host=make(true,{onDiagnostic:(...args)=>stages.push(args)});host.bridge.connect();
 assert.deepEqual(stages,[['bridge-start'],['initialize-sent']]);
 const init=host.sent[0].m;
 assert.equal(init.method,'ui/initialize');assert.equal(host.sent[0].origin,'*');
 assert.deepEqual(Array.from(init.params.appCapabilities.availableDisplayModes),['inline','fullscreen']);
 for(const malformed of [
  {id:init.id,method:'host/request',result:{}},
  {id:init.id,method:'host/request'},
  {id:init.id,result:{},error:{code:-1,message:'ambiguous'}},
  {id:init.id,error:{}}, {id:init.id,result:null}, {id:init.id},
  {id:String(init.id),result:{}}
 ])host.reply(malformed,'https://untrusted.test');
 assert.equal(host.ready(),0,'only a valid matching response can pin initialization origin');
 assert.equal(stages.length,2,'malformed initialization messages produce no diagnostic payload');
 host.reply({id:init.id,result:{}},'https://host.test',{});
 assert.equal(host.ready(),0,'only parent can initialize');
 host.reply({id:init.id,result:{}},'null');
 assert.equal(host.ready(),0,'opaque origin is rejected');
 assert.equal(host.bridge.phase(),'failed');
 host.bridge.connect();
 const retryInit=host.sent.at(-1).m;
 assert.ok(retryInit.id>init.id);
 host.reply({id:init.id,result:{}},'https://host.test');
 assert.equal(host.ready(),0,'a response from the failed attempt cannot complete its retry');
 host.reply({id:retryInit.id,result:{hostCapabilities:{serverTools:{},message:{text:{}}}}});
 assert.equal(host.ready(),1);
 assert.deepEqual(stages,[['bridge-start'],['initialize-sent'],['bridge-start'],['initialize-sent'],['initialize-ready']]);
 assert.equal(host.sent.at(-1).m.method,'ui/notifications/initialized');
 await assert.rejects(host.bridge.updateContext('test'),/문맥 갱신/);
 const pending=host.bridge.callTool('catsroll_result',{result_id:'synthetic'});
 const call=host.sent.at(-1).m;
 let settled=false;pending.then(()=>settled=true);
 const beforeRejectedPings=host.sent.length;
 host.reply({id:call.id,method:'ping',params:{}},'https://other.test');
 host.reply({id:call.id,method:'ping',params:{}},'https://host.test',{});
 assert.equal(host.sent.length,beforeRejectedPings,'wrong-origin and spoofed ping requests are ignored');
 await Promise.resolve();assert.equal(settled,false,'rejected ping requests cannot resolve an app RPC');
 host.reply({id:call.id,method:'ping',params:{}});
 assert.equal(host.sent.length,beforeRejectedPings+1);
 assert.deepEqual(JSON.parse(JSON.stringify(host.sent.at(-1).m)),{jsonrpc:'2.0',id:call.id,result:{}});
 assert.equal(host.sent.at(-1).origin,'https://host.test','ping response uses the pinned origin');
 await Promise.resolve();assert.equal(settled,false,'ping request ID collision does not consume the app RPC');
 const beforeCollision=host.sent.length;
 host.reply({id:call.id,method:'host/unknown',params:{}});
 assert.equal(host.sent.length,beforeCollision+1);
 assert.equal(host.sent.at(-1).origin,'https://host.test');
 assert.equal(host.sent.at(-1).m.id,call.id);
 assert.equal(host.sent.at(-1).m.error.code,-32601,'unknown host requests get method-not-found');
 await Promise.resolve();assert.equal(settled,false,'host request ID collision does not consume app pending');
 for(const malformed of [
  {id:call.id}, {id:call.id,result:{},error:{code:-1,message:'ambiguous'}},
  {id:call.id,error:null}, {id:call.id,error:{message:'missing code'}},
  {id:call.id,method:'host/unknown',result:{}},
  {id:call.id,method:42}, {id:call.id,method:'host/unknown',params:null},
  {id:String(call.id),result:{status:'wrong type'}}
 ])host.reply(malformed);
 await Promise.resolve();assert.equal(settled,false,'malformed envelopes and mismatched ID types cannot resolve pending');
 host.reply({id:call.id,result:{status:'wrong'}},'https://other.test');
 await Promise.resolve();assert.equal(settled,false,'response cannot change pinned origin');
 host.reply({id:call.id,result:{status:'ok'}});
 assert.equal((await pending).status,'ok');
 const closing=host.bridge.sendMessage('test');
 host.bridge.close();
 await assert.rejects(closing,/Connection closed/);
 host.reply({id:init.id,result:{}});
 assert.equal(host.ready(),1,'late response after close cannot reconnect');
 assert.equal(host.bridge.isConnected(),false);
 await assert.rejects(host.bridge.callTool('catsroll_result',{}),/Connection closed/);
 await assert.rejects(host.bridge.sendMessage('closed'),/Connection closed/);
 await assert.rejects(host.bridge.updateContext('closed'),/Connection closed/);

 for (const capabilities of [undefined, {}, {message:{text:{}}}, {experimental:{'openai/message':null}}]) {
  const legacy=make(true);legacy.bridge.connect();
  legacy.reply({id:legacy.sent[0].m.id,result:capabilities?{hostCapabilities:capabilities}:{}});
  assert.equal(legacy.bridge.supports('titledMessage'),false,'titles require an explicit valid extension capability');
  await assert.rejects(legacy.bridge.sendMessage('prompt',{title:'result',text:'snapshot'}),/제목 있는/);
  legacy.bridge.close();
 }
 const attachmentHost=make(true);attachmentHost.bridge.connect();
 attachmentHost.reply({id:attachmentHost.sent[0].m.id,result:{hostCapabilities:{message:{text:{}},experimental:{'openai/message':{}}}}});
 assert.equal(attachmentHost.bridge.supports('titledMessage'),true);
 const attachmentText='full result\n'.repeat(5000);
 const attached=attachmentHost.bridge.sendMessage('Explain the result',{title:'Catsroll 계산 결과 · 300행',text:attachmentText});
 const attachmentRpc=attachmentHost.sent.at(-1).m;
 assert.deepEqual(JSON.parse(JSON.stringify(attachmentRpc.params)),{role:'user',content:[
  {type:'text',text:'Explain the result'},
  {type:'text',text:attachmentText,_meta:{'openai/title':'Catsroll 계산 결과 · 300행'}}
 ]},'message carries the full data in a titled block beside a short prompt');
 attachmentHost.reply({id:attachmentRpc.id,result:{}});await attached;attachmentHost.bridge.close();

 const notifications=[],contexts=[],order=[];
 const contextHost=make(true,{onHostContext:context=>{contexts.push(context);order.push('context');},
  onReady:()=>order.push('ready'),onNotification:message=>notifications.push(message)});
 contextHost.bridge.connect();
 contextHost.reply({id:contextHost.sent[0].m.id,result:{hostContext:{theme:'dark',displayMode:'inline',
  availableDisplayModes:['inline','fullscreen'],styles:{variables:{'--color-text-primary':'red'}},customField:{value:1}}}});
 assert.deepEqual(order,['context','ready'],'initial context callback precedes onReady');
 assert.equal(contextHost.bridge.getHostContext(),contexts[0]);
 contextHost.reply({method:'ui/notifications/host-context-changed',params:{displayMode:'fullscreen',viewport:{width:800}}});
 assert.equal(contextHost.bridge.getHostContext().theme,'dark');
 assert.equal(contextHost.bridge.getHostContext().displayMode,'fullscreen');
 assert.equal(contextHost.bridge.getHostContext().customField.value,1,'unknown protocol context fields are preserved');
 assert.equal(contextHost.bridge.getHostContext().styles.variables['--color-text-primary'],'red');
 assert.equal(contexts.length,2);assert.equal(notifications.length,1);
 contextHost.reply({method:'ui/notifications/host-context-changed',params:[]});
 contextHost.reply({id:800,result:{}});
 contextHost.reply({method:'ui/notifications/tool-result',params:{result:'ok'}});
 assert.equal(contexts.length,2,'malformed context update is ignored');
 assert.equal(notifications.length,2,'only notifications reach notification callback');
 contextHost.reply({method:'ui/notifications/host-context-changed',params:JSON.parse('{"__proto__":{"polluted":true},"theme":"light"}')});
 assert.equal(contextHost.bridge.getHostContext().theme,'light');
 assert.equal(contextHost.bridge.getHostContext().polluted,undefined,'context merge does not set prototypes');
 assert.equal(Object.hasOwn(contextHost.bridge.getHostContext(),'__proto__'),true,'context merge preserves fields safely');
 contextHost.bridge.close();

 let stopped=0,deviceRunning=true;
 const teardownStages=[];
 const teardown=make(true,{onDiagnostic:(...args)=>teardownStages.push(args),
  onTeardown:params=>{assert.equal(params.reason,'test');stopped++;deviceRunning=false;}});
 teardown.bridge.connect();teardown.reply({id:teardown.sent[0].m.id,result:{}});
 const teardownPending=teardown.bridge.callTool('catsroll_result',{});
 const teardownId=teardown.sent.at(-1).m.id;
 const rejection=assert.rejects(teardownPending,/Connection closed/);
 const sizeFrame=Array.from(teardown.frames.values())[0];
 const post=teardown.root.parent.postMessage;
 teardown.root.parent.postMessage=(message,origin)=>{
  assert.equal(deviceRunning,false,'device run stops synchronously before teardown ack');
  post(message,origin);
 };
 teardown.reply({id:teardownId,method:'ui/resource-teardown',params:{reason:'test'}},'https://other.test');
 assert.equal(stopped,0,'teardown is restricted to pinned origin');
 teardown.reply({id:teardownId,method:'ui/resource-teardown',params:{reason:'test'}});
 await rejection;
 assert.equal(stopped,1);
 assert.deepEqual(teardownStages,[['bridge-start'],['initialize-sent'],['initialize-ready'],['teardown']],
  'diagnostics contain only one fixed stage argument, without teardown reason or RPC ID');
 assert.equal(JSON.stringify(teardown.sent.at(-1)),JSON.stringify({m:{jsonrpc:'2.0',id:teardownId,result:{}},origin:'https://host.test'}));
 assert.equal(teardown.bridge.isConnected(),false);assert.equal(teardown.bridge.phase(),'disconnected');
 assert.equal(teardown.disconnected(),1);assert.equal(teardown.frames.size,0);assert.equal(teardown.timers.size,0);
 assert.equal(teardown.listeners.size,0,'teardown removes message and resize listeners');
 const afterTeardown=teardown.sent.length;
 sizeFrame();teardown.reply({id:teardownId,result:{}});
 teardown.reply({id:teardownId,method:'ui/resource-teardown',params:{reason:'test'}});
 assert.equal(teardown.sent.length,afterTeardown,'queued observer and host messages are fenced after teardown');
 assert.equal(stopped,1);
 await assert.rejects(teardown.bridge.callTool('catsroll_result',{}),/Connection closed/);
 assert.throws(()=>teardown.bridge.connect(),/Connection closed/);
 const timeoutStages=[],connectionStates=[];
 const timeoutHost=make(true,{onDiagnostic:(...args)=>timeoutStages.push(args),
  onConnection:(label,state)=>connectionStates.push([label,state])});
 timeoutHost.bridge.connect();
 const oldInit=timeoutHost.sent[0].m;
 assert.deepEqual(connectionStates.at(-1),['ChatGPT 연결 중','connecting']);
 assert.equal(timeoutHost.listenerCount('message'),1);
 timeoutHost.advance(10000);
 assert.deepEqual(timeoutStages,[['bridge-start'],['initialize-sent'],['initialize-timeout']]);
 assert.equal(timeoutHost.bridge.phase(),'failed');
 assert.equal(connectionStates.at(-1)[1],'error');assert.equal(timeoutHost.timers.size,0);
 assert.equal(timeoutHost.listenerCount('message'),0,'failed attempt removes its message listener');
 const afterTimeout=timeoutHost.sent.length;
 timeoutHost.reply({id:'late-ping',method:'ping',params:{}},'https://late.test');
 assert.equal(timeoutHost.sent.length,afterTimeout,'failed attempt does not reply to pings');
 timeoutHost.bridge.connect();
 const freshInit=timeoutHost.sent.at(-1).m;
 assert.ok(freshInit.id>oldInit.id,'retry keeps initialization IDs monotonic');
 assert.equal(timeoutHost.bridge.phase(),'connecting');assert.equal(timeoutHost.listenerCount('message'),1);
 timeoutHost.bridge.connect();
 assert.equal(timeoutHost.sent.length,2,'connect while connecting is a no-op');
 timeoutHost.reply({id:oldInit.id,result:{hostContext:{displayMode:'stale'}}},'https://host.test');
 assert.equal(timeoutHost.ready(),0,'old same-origin handshake response is rejected after retry');
 timeoutHost.reply({id:freshInit.id,result:{}});
 assert.equal(timeoutHost.ready(),1);assert.equal(timeoutHost.bridge.phase(),'ready');
 timeoutHost.bridge.connect();
 assert.equal(timeoutHost.sent.length,3,'connect while ready is a no-op');
 assert.equal(timeoutHost.ready(),1,'explicit retry delivers onReady only once');
 assert.equal(timeoutHost.listenerCount('message'),1,'retry does not duplicate message listeners');
 timeoutHost.bridge.close();

 const closedWhileConnecting=make(true);
 closedWhileConnecting.bridge.connect();
 const closedInitId=closedWhileConnecting.sent[0].m.id;
 closedWhileConnecting.bridge.close();
 const afterClose=closedWhileConnecting.sent.length;
 closedWhileConnecting.reply({id:closedInitId,method:'ping',params:{}},'https://late.test');
 assert.equal(closedWhileConnecting.sent.length,afterClose,'closed bridge does not reply to late pre-initialize pings');
 assert.equal(closedWhileConnecting.listenerCount('message'),0);

 const rpcFailure=make(true,{onConnection:(label,state)=>connectionStates.push([label,state])});
 rpcFailure.bridge.connect();
 const rejectedInit=rpcFailure.sent[0].m;
 rpcFailure.reply({id:rejectedInit.id,error:{code:-32000,message:'initialize rejected'}});
 assert.equal(rpcFailure.bridge.phase(),'failed');assert.equal(rpcFailure.listenerCount('message'),0);
 rpcFailure.bridge.connect();
 const retriedInit=rpcFailure.sent.at(-1).m;
 assert.ok(retriedInit.id>rejectedInit.id);
 rpcFailure.reply({id:rejectedInit.id,result:{}},'https://host.test');
 assert.equal(rpcFailure.ready(),0,'failed initialize response cannot complete a later attempt');
 rpcFailure.reply({id:retriedInit.id,result:{}});
 assert.equal(rpcFailure.ready(),1);assert.equal(rpcFailure.bridge.phase(),'ready');
 rpcFailure.bridge.close();

 const nullOrigin=make(true,{onConnection:(label,state)=>connectionStates.push([label,state])});
 nullOrigin.bridge.connect();
 const opaqueInit=nullOrigin.sent[0].m;
 nullOrigin.reply({id:opaqueInit.id,result:{}},'null');
 assert.equal(nullOrigin.bridge.phase(),'failed');assert.equal(nullOrigin.timers.size,0);
 assert.equal(nullOrigin.listenerCount('message'),0);assert.equal(connectionStates.at(-1)[1],'error');
 nullOrigin.bridge.connect();
 const nonOpaqueInit=nullOrigin.sent.at(-1).m;
 assert.ok(nonOpaqueInit.id>opaqueInit.id);
 nullOrigin.reply({id:nonOpaqueInit.id,result:{}});
 assert.equal(nullOrigin.ready(),1);nullOrigin.bridge.close();
 const failingDiagnostic=make(true,{onDiagnostic:()=>{throw new Error('diagnostic callback failure');}});
 failingDiagnostic.bridge.connect();failingDiagnostic.reply({id:failingDiagnostic.sent[0].m.id,result:{}});
 assert.equal(failingDiagnostic.ready(),1,'optional diagnostics cannot interrupt initialization');
 failingDiagnostic.reply({id:99,method:'ui/resource-teardown'});
 assert.equal(failingDiagnostic.bridge.isConnected(),false,'optional diagnostics cannot interrupt teardown');
 assert.equal(failingDiagnostic.listeners.size,0);
 const browser=make(false);let requests=[];
 browser.root.fetch=async(url,args)=>{requests.push({url,args});return {ok:true,text:async()=>JSON.stringify({result:{status:'data_ready'}})};};
 browser.bridge.connect();assert.equal(browser.ready(),1);assert.equal(browser.bridge.isConnected(),false);
 browser.bridge.connect();assert.equal(browser.ready(),1,'standalone repeated connect does not duplicate onReady');
 assert.equal((await browser.bridge.callTool('catsroll_multi_data',{section:'bootstrap'})).status,'data_ready');
 assert.equal(requests[0].url,'/mcp');assert.equal(JSON.parse(requests[0].args.body).params.name,'catsroll_multi_data');
 browser.bridge.close();
 console.log('host bridge: RPC classification/collisions, pinned-origin handshake, capabilities, host context, teardown cleanup, closed fences and standalone transport passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
