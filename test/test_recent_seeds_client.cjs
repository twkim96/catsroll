'use strict';

const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

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
    console.log('recent-seeds client compute: ok');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
