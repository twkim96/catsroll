'use strict';
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.CATSROLL_TEST_URL || 'http://127.0.0.1:17868';
const event = '2019-01-23_348';
(async () => {
  const browser = await chromium.launch({headless: true, channel: process.env.GPT_BROWSER_CHANNEL || 'chrome'});
  try {
    const page = await browser.newPage();
    async function notesFollowTable() {
      assert.equal(await page.locator('#content .table').count(), 1);
      assert.equal(await page.locator('#content .note').count(), 1);
      assert.equal(await page.locator('#content .table').evaluate(table =>
        !!(table.compareDocumentPosition(document.querySelector('#content .note')) &
          Node.DOCUMENT_POSITION_FOLLOWING)), true,
      'usage notes must stay below the calculated table');
    }
    await page.goto(`${base}/?seed=42&event=${event}&lang=kr&count=10`);
    await notesFollowTable();
    await page.locator('#client-compute-toggle').check();
    await page.waitForFunction(() => document.querySelector('#client-compute-status').textContent === '✓');
    await notesFollowTable();
    await page.locator('#seed_input').fill('43');
    await page.locator('#content form input[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#client-compute-status').textContent === '✓');
    await notesFollowTable();
    await page.goto(`${base}/?lang=kr&event=${event}&compute=client`);
    assert.equal(await page.locator('#content > p.section').count(), 1,
      'the introduction remains when there is no calculated result');
    assert.equal(await page.locator('#content > p a[href*="/help"]').count(), 1);
    await page.goto(`${base}/?seed=42&event=${event}&lang=kr&count=10&compute=client`);
    await page.waitForFunction(() => document.querySelector('#client-compute-status').textContent === '✓');
    assert.equal(await page.locator('#content .table').count(), 1);
    assert.equal(await page.locator('#content > p.section').count(), 0,
      'a calculated result replaces the initial simulator introduction');
    assert.equal(await page.locator('#content > p a[href*="/help"]').count(), 0,
      'the introductory help paragraph is also removed after calculation');
    // Delay only data delivery. Compute and render with the actual shared engine
    // and pools so the final UI is checked, not an excerpt of the controller.
    await page.evaluate(async () => {
      const original = TrackData.load;
      window.racePool = await original({event: '2019-01-23_348', lang: 'kr'});
      window.raceLoads = [];
      TrackData.load = params => new Promise((resolve, reject) => raceLoads.push({params, resolve, reject}));
      window.raceRenders = [];
      const render = TrackRender.renderTable;
      TrackRender.renderTable = (out, ctx) => { raceRenders.push({seed: ctx.seed, lang: ctx.lang, event: new URLSearchParams(ctx.params).get('event')}); return render(out, ctx); };
      window.raceScrolls = 0;
      window.scrollTo = () => { raceScrolls++; };
    });
    async function submit(seed) {
      await page.locator('#seed_input').fill(String(seed));
      await page.locator('#content form input[type=submit]').click();
    }
    async function settle(index, kind = 'success') {
      await page.evaluate(({index, kind}) => {
        const load = raceLoads[index];
        if (kind === 'error') load.reject(new Error('delayed failure'));
        else load.resolve(kind === 'empty' ? {exist: false} : racePool);
      }, {index, kind});
    }
    async function shownSeed(seed) {
      await page.waitForFunction(seed => raceRenders.at(-1)?.seed === seed &&
        document.querySelector('#client-compute-status').textContent === '✓', seed);
      assert.equal(await page.locator('#seed_input').inputValue(), String(seed));
      assert.equal(new URL(page.url()).searchParams.get('seed'), String(seed));
    }
    await submit(43); // request A
    assert.equal(await page.locator('#content .table').count(), 0, 'previous clickable results disappear while loading');
    assert.equal(await page.locator('#content .found_cats').count(), 0);
    assert.equal(await page.locator('#client-compute-status').textContent(), '불러오는 중…');
    await submit(99); // request B
    await settle(1); await shownSeed(99);
    const table = await page.locator('#content .table').innerHTML();
    const scrolls = await page.evaluate(() => raceScrolls);
    await settle(0); // old A succeeds last
    assert.equal(await page.locator('#content .table').innerHTML(), table);
    assert.deepEqual(await page.evaluate(() => raceRenders.map(r => r.seed)), [99]);
    assert.equal(await page.evaluate(() => raceScrolls), scrolls, 'old completion must not scroll the new table');

    await submit(100); await submit(101); await settle(3); await shownSeed(101);
    await settle(2, 'error');
    assert.equal(await page.locator('#client-compute-status').textContent(), '✓', 'late errors cannot replace current success');
    await submit(102); await submit(103); await settle(5); await shownSeed(103);
    await settle(4, 'empty');
    assert.equal(await page.locator('#client-compute-status').textContent(), '✓', 'late missing-pool cannot replace current success');

    await submit(104); await submit(105); await settle(7, 'error');
    await page.waitForFunction(() => document.querySelector('#client-compute-status').textContent === '계산 실패');
    await settle(6);
    assert.equal(await page.locator('#content .table').count(), 0, 'old success cannot replace latest failure');
    assert.equal(await page.locator('#client-compute-status').textContent(), '계산 실패');

    await submit(106); await submit(0); await settle(8);
    assert.equal(await page.locator('#content .table').count(), 0, 'seedless input invalidates pending calculation');
    assert.equal(await page.locator('#client-compute-status').textContent(), '');

    await submit(107); await page.goBack();
    await page.waitForFunction(() => document.querySelector('#seed_input').value === '0');
    await settle(9);
    assert.equal(await page.locator('#content .table').count(), 0, 'popstate invalidates pending navigation');
    assert.equal(await page.locator('#seed_input').inputValue(), '0');
    assert.equal(await page.evaluate(() => raceLoads.length), 10, 'seed 0 on popstate needs no pool request');

    await submit(108);
    await page.locator('#seed_input').fill('109');
    await settle(10);
    assert.equal(await page.locator('#content .table').count(), 0, 'editing input invalidates a pending response before Apply');
    assert.match(await page.locator('#client-compute-status').textContent(), /Roll/);
    await page.locator('#content form input[type=submit]').click();
    await settle(11); await shownSeed(109);

    await page.evaluate(() => {
      const fetchOriginal = window.fetch;
      window.regionRequests = [];
      window.fetch = (url, options) => String(url).startsWith('/events.json?') ?
        new Promise((resolve, reject) => regionRequests.push({url, resolve, reject})) : fetchOriginal(url, options);
    });
    await page.locator('#lang_select').selectOption('jp');
    await page.waitForFunction(() => regionRequests.length === 1);
    assert.equal(await page.locator('#content .table').count(), 0);
    // A second region request wins; the older list must not rewrite dropdowns,
    // URL, status, or start another pool request when it finally arrives.
    await page.locator('#lang_select').selectOption('en');
    await page.waitForFunction(() => regionRequests.length === 2);
    await page.evaluate(() => regionRequests[1].resolve({ok:true,json:async()=>({current:'2019-01-23_348',upcoming:[{value:'2019-01-23_348',label:'Latest region'}],past:[]})}));
    await page.waitForFunction(() => raceLoads.length === 13);
    await settle(12); await shownSeed(109);
    assert.equal(new URL(page.url()).searchParams.get('lang'), 'en');
    await page.evaluate(() => regionRequests[0].resolve({ok:true,json:async()=>({current:'stale',upcoming:[{value:'stale',label:'Old region'}],past:[]})}));
    assert.equal(new URL(page.url()).searchParams.get('lang'), 'en');
    assert.equal(await page.locator('#event_select').inputValue(), event);
    assert.equal(await page.evaluate(() => raceLoads.length), 13);

    await page.locator('#lang_select').selectOption('jp');
    await page.waitForFunction(() => regionRequests.length === 3);
    await submit(110);
    assert.equal(await page.locator('#lang_select').inputValue(), 'en', 'editing cancels the pending region and keeps its event menu paired');
    assert.equal(await page.evaluate(() => raceLoads[13].params.lang), 'en');
    assert.equal(await page.evaluate(() => raceLoads[13].params.event), event);
    await settle(13); await shownSeed(110);
    await page.evaluate(() => regionRequests[2].reject(new Error('late region failure')));
    assert.equal(await page.locator('#lang_select').inputValue(), 'en', 'late region errors cannot revert newer form state');
    assert.equal(await page.locator('#client-compute-status').textContent(), '✓');

    await submit(111);
    await page.evaluate(() => {
      // Avoid an actual unload while checking the turn-off handler's fence.
      history.replaceState(null, '', location.pathname + '?seed=111&lang=kr&event=2019-01-23_348&count=10&compute=client');
      localStorage.setItem('bcr_client_compute', '0');
      dispatchEvent(new PageTransitionEvent('pagehide'));
    });
    await settle(14);
    assert.equal(await page.locator('#content .table').count(), 0, 'pagehide/disabled mode fences pending data');
    await page.evaluate(() => {
      localStorage.setItem('bcr_client_compute', '1');
      dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true}));
    });
    await page.waitForFunction(() => raceLoads.length === 16);
    await settle(15); await shownSeed(111);
    await page.locator('#seed_input').fill('112');
    await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', {persisted:true}));
      dispatchEvent(new PageTransitionEvent('pageshow', {persisted:true}));
    });
    assert.equal(await page.locator('#seed_input').inputValue(), '112', 'BFCache preserves unsubmitted edits');
    assert.equal(await page.locator('#content .table').count(), 0);
    assert.equal(await page.evaluate(() => raceLoads.length), 16, 'draft does not trigger URL-based recalculation');
    await page.locator('#content form input[type=submit]').click();
    await settle(16); await shownSeed(112);
    await page.screenshot({path: '/tmp/catsroll-client-race.png'});
    console.log('track-client race: table before notes on toggle/recalculation, reversed success/error/empty, pending-table removal, edits, seedless, region, popstate and pagehide/BFCache fences passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
