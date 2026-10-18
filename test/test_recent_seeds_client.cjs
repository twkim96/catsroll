'use strict';

const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const codec = require('../lib/battle-cats-rolls/asset/multi-share.js');

const base = process.env.CATSROLL_TEST_URL || 'http://127.0.0.1:17868';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.GPT_BROWSER_CHANNEL || 'chrome'
  });
  try {
    const page = await browser.newPage();
    await page.goto(base + '/?seed=42&event=2019-01-23_348&lang=kr&count=10&compute=client');
    await page.waitForFunction(() =>
      document.querySelector('#client-compute-status')?.textContent === '✓');
    assert.deepEqual(await page.evaluate(() =>
      JSON.parse(localStorage.getItem('battle-cats-rolls.recentSeeds.v1')).seeds), ['42']);

    await page.locator('#seed_input').fill('99');
    await page.locator('#content form input[type=submit]').click();
    await page.waitForFunction(() =>
      new URL(location.href).searchParams.get('seed') === '99' &&
      document.querySelector('#client-compute-status')?.textContent === '✓');

    const state = await page.evaluate(() => ({
      seeds: JSON.parse(localStorage.getItem('battle-cats-rolls.recentSeeds.v1')).seeds,
      links: Array.from(document.querySelectorAll('#recent-seeds a'), link => link.textContent),
      clientCompute: new URL(location.href).searchParams.get('compute'),
      renderedTrack: !!document.querySelector('#content .table')
    }));
    assert.deepEqual(state.seeds, ['99', '42']);
    assert.deepEqual(state.links, ['99', '42']);
    assert.equal(state.clientCompute, 'client');
    assert.equal(state.renderedTrack, true);

    await page.reload();
    await page.waitForFunction(() =>
      document.querySelector('#client-compute-status')?.textContent === '✓');
    assert.deepEqual(await page.evaluate(() =>
      Array.from(document.querySelectorAll('#recent-seeds a'), link => link.textContent)),
    ['99', '42']);

    await page.goto(base + '/multi?seed=42&event=2019-01-23_348&lang=kr&count=10');
    const advance = page.locator('#multi_tables a[data-action="advance"]').first();
    await advance.waitFor();
    const movedSeed = await advance.getAttribute('data-seed');
    await advance.click();
    await page.waitForFunction(seed =>
      document.querySelector('#multi_seed').value === seed &&
      JSON.parse(localStorage.getItem('battle-cats-rolls.recentSeeds.v1')).seeds[0] === seed,
    movedSeed);
    assert.deepEqual(await page.locator('#recent-seeds a').allTextContents(), [movedSeed, '42', '99']);
    await page.locator('#recent-seeds a').filter({hasText: /^42$/}).click();
    await page.waitForFunction(() => document.querySelector('#multi_seed').value === '42');
    assert.equal(await page.locator('#recent-seeds a').first().textContent(), '42');
    await page.locator('#multi_seed').fill('99');
    await page.locator('#multi_apply').click();
    assert.equal(await page.locator('#recent-seeds a').first().textContent(), '99');
    await page.reload();
    await page.locator('#multi_tables table').first().waitFor();
    assert.deepEqual(await page.locator('#recent-seeds a').allTextContents(), ['99', '42', movedSeed]);

    const personalHistory = await page.evaluate(() => localStorage.getItem('battle-cats-rolls.recentSeeds.v1'));
    const payload = codec.makePayload({seed:42,last:0,count:10,rows:[{lang:'kr',event:'2019-01-23_348'}]}, {targets:[]});
    await page.goto(base + '/multi?seed=42&count=10&lang=kr&event=2019-01-23_348#share=' + codec.encode(payload));
    await page.locator('#multi_tables a[data-action="advance"]').first().click();
    assert.equal(await page.evaluate(() => localStorage.getItem('battle-cats-rolls.recentSeeds.v1')), personalHistory,
      'Temporary shared Multi navigation must preserve personal history');
    console.log('recent-seeds: single client, Multi advance/apply/recent links/reload and shared isolation passed');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
