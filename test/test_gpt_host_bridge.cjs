'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function make(embedded=true){
 const listeners=new Map(),sent=[],errors=[];
 let ready=0;
 const root={AbortController,setTimeout,clearTimeout,requestAnimationFrame:()=>1,cancelAnimationFrame(){},
  addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name),
  document:{documentElement:{clientWidth:390},body:{getBoundingClientRect:()=>({height:200})}}};
 root.parent=embedded?{postMessage:(m,origin)=>sent.push({m,origin})}:root;
 vm.createContext(root);vm.runInContext(fs.readFileSync('lib/battle-cats-rolls/asset/gpt-host-bridge.js','utf8'),root);
 const bridge=root.CatsrollHostBridge({onReady:()=>ready++,onError:message=>errors.push(message)});
 function reply(m,origin='https://host.test',source=root.parent){listeners.get('message')?.({source,origin,data:{jsonrpc:'2.0',...m}});}
 return {root,sent,errors,bridge,reply,ready:()=>ready};
}
(async()=>{
 const host=make();host.bridge.connect();
 const init=host.sent[0].m;
 assert.equal(init.method,'ui/initialize');assert.equal(host.sent[0].origin,'*');
 host.reply({id:init.id,result:{}},'https://host.test',{});
 assert.equal(host.ready(),0,'only parent can initialize');
 host.reply({id:init.id,result:{}},'null');
 assert.equal(host.ready(),0,'opaque origin is rejected');
 host.reply({id:init.id,result:{hostCapabilities:{serverTools:{},message:{text:{}}}}});
 assert.equal(host.ready(),1);
 assert.equal(host.sent.at(-1).m.method,'ui/notifications/initialized');
 await assert.rejects(host.bridge.updateContext('test'),/문맥 갱신/);
 const pending=host.bridge.callTool('catsroll_result',{result_id:'synthetic'});
 const call=host.sent.at(-1).m;
 let settled=false;pending.then(()=>settled=true);
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
 const browser=make(false);let requests=[];
 browser.root.fetch=async(url,args)=>{requests.push({url,args});return {ok:true,text:async()=>JSON.stringify({result:{status:'data_ready'}})};};
 browser.bridge.connect();assert.equal(browser.ready(),1);assert.equal(browser.bridge.isConnected(),false);
 assert.equal((await browser.bridge.callTool('catsroll_multi_data',{section:'bootstrap'})).status,'data_ready');
 assert.equal(requests[0].url,'/mcp');assert.equal(JSON.parse(requests[0].args.body).params.name,'catsroll_multi_data');
 browser.bridge.close();
 console.log('host bridge: pinned-origin handshake, explicit capabilities, pending cleanup, closed-response fence and standalone transport passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
