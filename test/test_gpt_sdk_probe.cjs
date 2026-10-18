// No HTTP service needed. Generate real resource HTML, then route a synthetic parent.
'use strict';
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const generated = execFileSync('bundle', ['exec', 'ruby', '-EUTF-8', '-Ilib', '-rbattle-cats-rolls/server', '-e',
  'p = BattleCatsRolls::GptSdkProbe.new; puts JSON.generate(p.dispatch("resources/read", {"uri" => p.class.widget[:uri]})[:contents].first[:text])'],
  {cwd: require('node:path').join(__dirname, '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
const html = JSON.parse(generated);
const resourceId = html.match(/data-catsroll-resource-id="([^"]+)"/)[1];

(async () => {
  const browser = await chromium.launch({headless: true, channel: process.env.GPT_BROWSER_CHANNEL || 'chrome'});
  try {
    for (const mode of ['success', 'reject', 'timeout', 'cached']) {
      const page = await browser.newPage();
      const errors = [];
      const requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => requests.push(request.url()));
      await page.clock.install();
      await page.route('https://probe.test/**', route => {
        if (route.request().url().endsWith('/widget')) return route.fulfill({contentType: 'text/html', body: html});
        return route.fulfill({contentType: 'text/html', body: `<!doctype html><html><body><script>
          window.messages=[];window.replies=[];
          addEventListener('message',event=>{
            if(event.source!==document.querySelector('iframe').contentWindow || event.origin!==location.origin)return;
            const m=event.data;
            if(m.method)messages.push(m);else replies.push(m);
            if(m.method==='ui/initialize'){
              if(${JSON.stringify(mode)}==='timeout')return;
              const reply=${JSON.stringify(mode)}==='reject'
                ? {error:{code:-32000,message:'PRIVATE_ERROR_WITH_SEED_AND_ACCOUNT'}}
                : {result:{protocolVersion:m.params.protocolVersion,hostInfo:{name:'synthetic',version:'1'},hostCapabilities:{},hostContext:{}}};
              event.source.postMessage({jsonrpc:'2.0',id:m.id,...reply},event.origin);
            }
          });
          </script><iframe src="/widget"></iframe></body></html>`});
      });
      await page.goto('https://probe.test/host');
      const frame = page.frameLocator('iframe');
      if (mode === 'success' || mode === 'cached') {
        await frame.locator('#connection').filter({hasText: 'SDK 연결 완료'}).waitFor();
        await page.waitForFunction(() => messages.some(m => m.method === 'ui/notifications/initialized'));
        const initialize = await page.evaluate(() => messages.find(m => m.method === 'ui/initialize'));
        assert.equal(initialize.params.appInfo.name, 'Catsroll SDK connection probe');
        await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',id:'host-ping',method:'ping',params:{}},location.origin));
        await page.waitForFunction(() => replies.some(m => m.id === 'host-ping'));
        assert.deepEqual(await page.evaluate(() => replies.find(m => m.id === 'host-ping').result), {});
        await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{content:[{type:'text',text:'PRIVATE_TOOL_RESULT'}]}},location.origin));
        await page.waitForFunction(() => document.querySelector('iframe').contentWindow.CatsrollSdkDiagnostics().steps.some(s => s.stage === 'tool-result'));
      } else if (mode === 'reject') {
        await frame.locator('#connection').filter({hasText: 'SDK 연결 실패'}).waitFor();
      } else {
        await page.waitForFunction(() => messages.some(m => m.method === 'ui/initialize'));
        await page.clock.fastForward(10001);
        await frame.locator('#connection').filter({hasText: '연결 대기 초과'}).waitFor();
      }
      const diagnostics = await frame.locator('#diagnostics').innerText();
      const info = JSON.parse(diagnostics);
      assert.equal(info.resourceId, resourceId, 'cached HTML keeps original response ID');
      assert.match(info.diagnosticId, /^[0-9a-f-]{36}$/);
      assert.equal(info.steps[0].stage, 'html-start');
      assert.doesNotMatch(diagnostics, /PRIVATE_|probe\.test|protocolVersion|hostInfo/);
      if (mode === 'success') {
        global.firstDiagnosticId = info.diagnosticId;
        await page.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',id:'teardown',method:'ui/resource-teardown',params:{}},location.origin));
        await page.waitForFunction(() => replies.some(m => m.id === 'teardown'));
        assert.deepEqual(await page.evaluate(() => replies.find(m => m.id === 'teardown').result), {});
        assert.equal(await frame.locator('#connection').innerText(), '연결 종료');
      }
      if (mode === 'cached') assert.notEqual(info.diagnosticId, global.firstDiagnosticId, 'each execution has its own diagnostic ID');
      assert.deepEqual(await page.evaluate(() => messages.filter(m => m.method === 'tools/call')), [], 'no tool, catalog or calculation calls');
      assert.deepEqual(requests.sort(), ['https://probe.test/host', 'https://probe.test/widget']);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`SDK probe ${mode}: passed`);
    }
  } finally { await browser.close(); }
})().catch(error => {console.error(error); process.exitCode = 1;});
