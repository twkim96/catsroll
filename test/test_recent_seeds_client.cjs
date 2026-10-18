'use strict';

const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const codec = require('../lib/battle-cats-rolls/asset/multi-share.js');
const base = process.env.CATSROLL_TEST_URL || 'http://127.0.0.1:17868';
const storageKey = 'battle-cats-rolls.recentSeeds.v1';
const query = 'event=2026-10-16_1068&lang=kr&count=30';
const history = page => page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
const recent = (page, seed, last) => page.locator('#recent-seeds a').filter({hasText: new RegExp('^' + seed + ' · Last ' + last + '$')});
const ready = page => page.locator('#multi_tables table').first().waitFor();
const clientReady = page => page.waitForFunction(() => document.querySelector('#client-compute-status')?.textContent === '✓');
const snapshot = page => page.evaluate(() => ({
  text: document.querySelector("#multi_tables").innerText,
  inputs: MultiTrackApp.getShareState(),
  find: (({seed,last,count,ready}) => ({seed,last,count,ready}))(MultiTrackApp.getFindSnapshot()),
  // Production engine cats include first result, reroll/guaranteed variants and
  // next positions/seeds. Capture every row/alternative, not a copied formula.
  cats: MultiTrackApp.getOutputs().map(item => ({
    cats: item.out.cats.map(pair => pair.map(cat => ({
      id:cat.id, rarity:cat.rarity, slotSeed:cat.slot_seed,
      rerolled:cat.rerolled && cat.rerolled.id,
      guaranteed:cat.guaranteed && cat.guaranteed.id
    }))),
    alternatives: Object.fromEntries(Object.entries(item.alternatives).map(([position,variants]) =>
      [position,variants.map(v => ({kind:v.kind,id:v.pull.id,next:v.next,last:v.lastRareId}))]))
  })),
  links: Array.from(document.querySelectorAll('#multi_tables a[data-action="advance"]'), a => ({
    text: a.textContent, seed: a.dataset.seed, last: a.dataset.last, href: a.getAttribute('href')
  })),
  share: MultiShareApp.createUrl()
}));

(async () => {
  const browser = await chromium.launch({headless: true, channel: process.env.GPT_BROWSER_CHANNEL || 'chrome'});
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(base + '/?seed=42&last=0&' + query + '&compute=client');
    await clientReady(page);
    assert.deepEqual((await history(page)).seeds, [{seed:'42',last:0}]);
    await page.locator('#seed_input').fill('99');
    await page.locator('#content form input[type=submit]').click();
    await page.waitForURL(url => url.searchParams.get('seed') === '99');
    await clientReady(page);
    assert.deepEqual((await history(page)).seeds, [{seed:'99',last:0},{seed:'42',last:0}]);
    await page.reload();
    await clientReady(page);
    await recent(page,42,0).click();
    await page.waitForURL(url => url.searchParams.get('seed') === '42');
    await clientReady(page);
    assert.equal(await page.locator('#last_select').inputValue(), '0');

    // Actual delivered production assets/pools: known zero and a real first-cat
    // duplicate (seed 42, Last 47) must restore exactly after result navigation.
    for (const last of [0,47]) {
      console.log("recent-seeds: production restore Last " + last);
      await page.goto(base + '/multi?seed=42&last=' + last + '&' + query);
      await ready(page);
      const before = await snapshot(page);
      assert.ok(/G:/.test(before.text), 'production guaranteed variants present');
      if (last === 47) assert.ok(/R:/.test(before.text) && /RG:/.test(before.text), 'production duplicate reroll present');
      const advance = page.locator('#multi_tables a[data-action="advance"]').first();
      const moved = await advance.getAttribute('data-seed');
      await advance.click();
      await page.waitForFunction(seed => document.querySelector('#multi_seed').value === seed, moved);
      await ready(page);
      const href = await recent(page,42,last).getAttribute('href');
      assert.equal(new URL(href).searchParams.get('last'), String(last));
      await recent(page,42,last).click();
      await ready(page);
      assert.deepEqual(await snapshot(page), before, 'restored production results, R/G/RG, next and share inputs');
      await page.reload();
      await ready(page);
      assert.deepEqual(await snapshot(page), before, 'reload preserves exact restored state');
      // A modified click follows href, bypassing Multi's handler. Test both
      // client and ordinary server pages with that same full link.
      const tab = await context.newPage();
      await tab.goto(href + '&compute=client');
      await clientReady(tab);
      assert.equal(await tab.locator('#last_select').inputValue(), String(last));
      await tab.goto(href + '&compute=server');
      await tab.locator('#content .table').first().waitFor();
      assert.equal(await tab.locator('#last_select').inputValue(), String(last));
      await tab.close();
    }
    await page.locator('#multi_last').fill('0');
    await page.locator('#multi_apply').click();
    assert.deepEqual((await history(page)).seeds[0], {seed:'42',last:0},
      'Last-only Apply updates history even when the seed is unchanged');
    const pairs = (await history(page)).seeds;
    assert.ok(pairs.some(item => item.seed === '42' && item.last === 0));
    assert.ok(pairs.some(item => item.seed === '42' && item.last === 47));

    // Legacy object/pinned and original array formats retain unknown Last.
    console.log("recent-seeds: legacy compatibility");
    for (const legacy of [{pinned:'777',seeds:['42','99','88','77','66']}, ['777','42','99','88','77']]) {
      await page.evaluate(({key,legacy}) => localStorage.setItem(key,JSON.stringify(legacy)), {key:storageKey,legacy});
      await page.goto(base + '/multi?seed=123&last=38&' + query);
      await ready(page);
      assert.ok(await page.locator('#recent-seeds a').count() <= 4);
      const unknown = recent(page,777,'미확인');
      const href = await unknown.getAttribute('href');
      assert.equal(new URL(href).searchParams.has('last'),false,'legacy URL never inherits Last');
      assert.equal(new URL(href).pathname,'/multi');
      if (!Array.isArray(legacy)) assert.equal(await unknown.getAttribute('class'),'pinned');
      await unknown.click();
      assert.equal(await page.locator('#multi_last').inputValue(),'');
      assert.equal(await page.locator('#multi_tables table').count(),0);
      assert.equal(await page.evaluate(() => MultiTrackApp.getFindSnapshot()),null);
      assert.equal(await page.evaluate(() => MultiTrackApp.getShareState()),null);
      await page.locator('#multi_apply').click();
      assert.equal(await page.locator('#multi_tables table').count(),0,'blank Last cannot confirm unknown as zero');
      await page.reload();
      await page.locator('.multi-track-pending').waitFor();
      assert.equal(await page.locator('#multi_tables table').count(),0);
      await page.locator('#multi_last').fill('0');
      await page.locator('#multi_apply').click();
      await ready(page);
      assert.equal(await page.evaluate(() => MultiTrackApp.getShareState().last),0);
      assert.equal(new URL(page.url()).searchParams.has('last_unknown'),false);
      assert.ok((await history(page)).seeds.some(item => item.seed === '777' && item.last === 0));
      // Full legacy href enters the same pending state, even from ordinary page.
      await page.goto(base + '/?seed=123&last=38&' + query + '&compute=client');
      await clientReady(page);
      await recent(page,777,'미확인').click();
      await page.waitForURL(url => url.pathname === '/multi');
      await page.locator('.multi-track-pending').waitFor();
      const tab = await context.newPage();
      await tab.goto(href);
      await tab.locator('.multi-track-pending').waitFor();
      assert.equal(await tab.locator('#multi_tables table').count(),0);
      await tab.close();
    }

    await page.goto(base + '/multi?seed=42&last=0&' + query);
    await ready(page);
    await recent(page,42,0).click({button:'right'});
    assert.equal((await history(page)).pinned.last,0,'pin known zero as a pair');
    await page.reload();
    await ready(page);
    assert.equal(await recent(page,42,0).getAttribute('class'),'pinned');
    const personalHistory = await page.evaluate(key => localStorage.getItem(key),storageKey);
    const personalSettings = await page.evaluate(() => localStorage.getItem('battle-cats-rolls.multiTrack.v1'));
    const payload = codec.makePayload({seed:42,last:0,count:10,rows:[{lang:'kr',event:'2019-01-23_348'}]}, {targets:[]});
    await page.goto(base + '/multi?' + query + '#share=' + codec.encode(payload));
    await page.locator('#multi_tables a[data-action="advance"]').first().click();
    await recent(page,777,'미확인').click();
    await page.locator('#multi_last').fill('0');
    await page.locator('#multi_apply').click();
    await ready(page);
    assert.equal(await page.evaluate(key => localStorage.getItem(key),storageKey),personalHistory);
    assert.equal(await page.evaluate(() => localStorage.getItem('battle-cats-rolls.multiTrack.v1')),personalSettings);
    await page.goto(base + '/gpt');
    await page.locator('#multi-track-app').waitFor();
    assert.equal(await page.locator('#recent-seeds').count(),0);
    assert.equal(await page.evaluate(key => localStorage.getItem(key),storageKey),personalHistory);
    console.log('recent-seeds: production restore/results/R/G/RG/next/share, known0/unknown, same-seed pairs, legacy/pin/max4, full links/client/server, shared/GPT isolation passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
