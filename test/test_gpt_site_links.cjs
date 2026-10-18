'use strict';
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const share = require('../lib/battle-cats-rolls/asset/multi-share.js');
const transfer = require('../lib/battle-cats-rolls/asset/gpt-input-transfer.js');
const ruby = `require 'battle-cats-rolls/server'; require 'json';
BattleCatsRolls::Web.new.call('PATH_INFO'=>'/warmup');
results=JSON.parse(ARGV[0]).map do |host,args|
 BattleCatsRolls::GptMcp.new(ui_host: host.to_sym).dispatch('tools/call', {'name'=>'catsroll_site_link','arguments'=>args})
end
puts "SITE_LINKS_TEST="+JSON.generate(results)`;
const event='2019-01-23_348';
const request={mode:'multi',seed:42,last:38,count:300,findEnabled:true,optimization:'balance',maxGuaranteed:2,maxPlatinum:1,maxLegendTicket:2,scheduleAware:true,planMode:true,planName:'보존',targets:[{cat_id:305,allow_ticket:false}],rows:[{lang:'kr',event,ubers:2,forceGuaranteed:11},{lang:'kr',event,ubers:1,forceGuaranteed:7}]};
const base={mode:'multi',seed:42,rows:[{lang:'kr',event}]};
const requests=[['chatgpt',request],['claude',request],
 ['chatgpt',{...base,findEnabled:false,targets:[{cat_id:38,allow_ticket:true}]}],
 ...[{lang:'kr',event,previewFor:'jp'},{lang:'kr',event,ubers:21}].map(row=>['chatgpt',{...base,rows:[row]}]),
 ['chatgpt',{...base,rows:[{lang:'kr',event,ubers:10}]}],
 ['chatgpt',{mode:'seek',rows:[{lang:'kr',event}],rolls:[38]}],
 ['chatgpt',{...base,rows:[{lang:'kr',event:'not-real'}]}],['chatgpt',{...base,seed:0}],['chatgpt',{...base,findEnabled:true,targets:[{cat_id:38}]}]];
const output=execFileSync('bundle',['exec','ruby','-EUTF-8','-Ilib','-e',ruby,JSON.stringify(requests)],{encoding:'utf8',maxBuffer:16*1024*1024});
const replies=JSON.parse(output.split('\n').find(line=>line.startsWith('SITE_LINKS_TEST=')).slice('SITE_LINKS_TEST='.length));
for(const reply of replies.slice(0,2)) { assert.equal(reply.isError,undefined);assert.equal(reply._meta,undefined);

 const data=reply.structuredContent;assert.equal(data.status,'links_ready');assert.equal(data.computed,false);
 assert.equal(data.dataVersion,undefined);assert.equal(JSON.stringify(data).includes('"pool"'),false);
 const links=data.websiteLinks;
 assert.deepEqual(transfer.decode(new URL(links.app.url).hash).arguments,data.request);
 const url=new URL(links.multi.url);assert.equal(url.pathname,'/multi');assert.equal(url.search,'');
 const payload=share.fromHash(url.hash);assert.ok(payload);
 const track=share.trackState(payload);assert.equal(track.seed,42);assert.equal(track.last,38);assert.equal(track.count,300);
 assert.deepEqual(track.rows.map(r=>[r.event,r.ubers,r.forceGuaranteed]),[[event,2,11],[event,1,7]]);
 const find=share.findSettings(payload);assert.equal(find.optimization,'balance');assert.equal(find.scheduleAware,true);assert.equal(find.maxGuaranteed,2);assert.equal(find.maxPlatinum,1);assert.equal(find.maxLegendTicket,2);assert.deepEqual(find.targets,[{cat_id:305,allow_ticket:false}]);
 assert.equal(share.planState(payload),null);assert.ok(links.multi.omitted.includes('plan_marks'));
 assert.equal(links.tracks.length,2);
 const p=new URL(links.tracks[0].url).searchParams;
 for(const [k,v] of Object.entries({seed:42,last:38,count:300,lang:'kr',event,ubers:2,force_guaranteed:11,compute:'client'}))assert.equal(p.get(k),String(v));
}
const off=replies[2].structuredContent;
assert.deepEqual(share.findSettings(share.fromHash(new URL(off.websiteLinks.multi.url).hash)).targets,[]);
assert.equal(transfer.decode(new URL(off.siteUrl).hash).arguments.targets.length,1);
for(const reply of replies.slice(3,5)) {
 const d=reply.structuredContent;assert.equal(d.websiteLinks.multi,null);assert.equal(d.websiteLinks.tracks.length,0);assert.ok(d.websiteLinks.unavailable.length);assert.ok(d.websiteLinks.app.url);
}
const ten=replies[5].structuredContent;
assert.ok(ten.websiteLinks.multi);assert.equal(ten.websiteLinks.tracks.length,0);
const seek=replies[6].structuredContent;
assert.equal(seek.websiteLinks.multi,null);assert.deepEqual(transfer.decode(new URL(seek.websiteLinks.app.url).hash).arguments.rolls,[38]);
assert.equal(replies[7].isError,true);assert.equal(replies[8].isError,true);
assert.equal(replies[9].structuredContent.websiteLinks.multi,null);
assert.ok(replies[9].structuredContent.websiteLinks.unavailable.some(item=>item.view==='multi'));
console.log('gpt-site-links: both hosts, real Multi codec, preserved conditions and unsupported boundaries ok');

if(process.env.CATSROLL_GPT_TEST_URL) (async()=>{
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
 const browser=await chromium.launch({headless:true,channel:process.env.GPT_BROWSER_CHANNEL||'chrome'});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const base=process.env.CATSROLL_GPT_TEST_URL;
  const links=replies[0].structuredContent.websiteLinks;
  const local=url=>base+new URL(url).pathname+new URL(url).search+new URL(url).hash;
  await page.goto(base+'/multi');
  const saved='{"seed":99,"count":10,"rows":[{"lang":"jp","event":"2019-01-23_348"}]}';
  await page.evaluate(saved=>localStorage.setItem('battle-cats-rolls.multiTrack.v1',saved),saved);
  await page.goto(local(links.multi.url));
  await page.locator('#multi_tables table').first().waitFor();
  const actual=await page.evaluate(()=>({track:MultiTrackApp.getShareState(),find:MultiFindApp.getShareSettings(),saved:localStorage.getItem('battle-cats-rolls.multiTrack.v1')}));
  assert.equal(actual.track.seed,42);assert.equal(actual.track.last,38);assert.equal(actual.track.count,300);assert.equal(actual.track.rows.length,2);
  assert.deepEqual(actual.find.targets,[{cat_id:305,allow_ticket:false}]);assert.equal(actual.find.maxGuaranteed,2);assert.equal(actual.find.scheduleAware,true);
  assert.equal(actual.saved,saved,'shared fallback must not overwrite the recipient settings');
  await page.screenshot({path:'/tmp/catsroll-site-link-multi.png'});
  await page.goto(local(links.tracks[0].url));
  await page.locator('#content .table').first().waitFor();
  assert.equal(await page.locator('#seed_input').inputValue(),'42');assert.equal(await page.locator('#count_input').inputValue(),'300');
  assert.equal(await page.locator('#last_select').inputValue(),'38');assert.equal(await page.locator('#force_guaranteed_input').inputValue(),'11');
  assert.equal(await page.locator('#add_future_ubers').inputValue(),'2');assert.equal(await page.locator('#client-compute-toggle').isChecked(),true);
  await page.screenshot({path:'/tmp/catsroll-site-link-track.png'});
  console.log('gpt-site-links browser: ordinary client array and isolated Multi/Find inputs restored');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
