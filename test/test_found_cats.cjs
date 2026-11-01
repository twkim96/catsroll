'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.CATSROLL_TEST_URL || 'http://127.0.0.1:17867';
const query = 'seed=1&lang=en&event=2026-10-16_1072&find=732';

(async () => {
  const browser = await chromium.launch({headless: true,
    channel: process.env.GPT_BROWSER_CHANNEL || 'chrome'});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    // Server mode uses upstream's repeated rows and supplemental search.
    await page.goto(`${base}/?${query}&count=100`);
    assert.equal(await page.locator('.found_cats ul').count(), 2);
    const serverTargets = await page.locator('.found_cats ul').first().locator('li').allTextContents();
    assert.equal(serverTargets.length, 4);
    for (const [index, position] of ['335A', '791B', '913A', '999+'].entries()) {
      assert(serverTargets[index].includes(position));
    }
    assert(!(await page.locator('.found_cats ul').nth(1).innerText()).includes('Daybreaker Izanagi'));
    assert.equal(await page.locator('.multi_track_prompt').count(), 1);

    // Switching modes keeps local navigation once, with a single supplemental result.
    await page.locator('#client-compute-toggle').check();
    await page.waitForFunction(() => document.querySelector('#client-compute-status').textContent === '✓');
    assert.equal(await page.locator('.multi_track_prompt').count(), 1);
    assert.equal(await page.locator('.found_cats ul').first().locator('li').count(), 1);
    assert.match(await page.locator('.found_cats ul').first().innerText(), /335A/);
    assert.equal(await page.locator('.found_cats ul').first().locator('a[href^="#N"]').count(), 0);

    // Visible occurrences are grouped on one line and stay navigable.
    await page.goto(`${base}/?${query}&count=999&compute=client`);
    await page.waitForFunction(() => document.querySelector('#client-compute-status').textContent === '✓');
    const clientTargets = page.locator('.found_cats ul').first();
    assert.equal(await clientTargets.locator('li').count(), 1);
    assert.deepEqual(await clientTargets.locator('a[href^="#N"]').allTextContents(),
      ['335A', '791B', '913A']);
    const automatic = await page.locator('.found_cats ul').nth(1).innerText();
    assert(!automatic.includes('Daybreaker Izanagi'));
    assert(automatic.split('\n').some(line => /\d+[AB].*,.*\d+[AB]/.test(line)),
      'automatic cats also retain multiple visible occurrences');

    // Multi reuses this engine; selected automatic results move to Found cats.
    const multi = await browser.newPage({viewport: {width: 1440, height: 1000}});
    multi.on('pageerror', error => errors.push(error.message));
    await multi.goto(`${base}/multi?seed=1&lang=kr&event=2026-02-13_1042&count=100`);
    await multi.locator('#multi_tables table').first().waitFor();
    await multi.locator('#multi_found summary').click();
    const group = multi.locator('#multi_found_cats .multi-found-group').first();
    const firstAutomatic = group.locator('li').filter({has: multi.locator('a[data-last]')}).first();
    const targetId = await firstAutomatic.locator('a[data-last]').getAttribute('data-last');
    const originalPositions = (await firstAutomatic.innerText()).split(':').pop().trim();
    assert.match(originalPositions, /\d+[AB]/);
    await multi.locator('#multi_find_filter').click();
    const target = multi.locator(`#multi_find_available button[data-cat-id="${targetId}"]`).first();
    await target.click();
    await multi.locator('[data-multi-find-close]').click();
    await multi.locator('#multi_apply').click();
    await multi.waitForFunction(() => !document.querySelector('#multi-track-app').classList.contains('is-dirty'));
    assert.deepEqual(await group.locator('p').allTextContents(), ['Found cats:', 'Exclusive and legend cats:']);
    assert.equal(await group.locator('ul').first().locator('li').count(), 1);
    assert.equal((await group.locator('ul').first().innerText()).split(':').pop().trim(), originalPositions);
    assert.equal(await group.locator('ul').nth(1).locator(`a[data-last="${targetId}"]`).count(), 0);

    // The GPT host uses the same Multi UI and calculation boundary.
    const host = await browser.newPage();
    host.on('pageerror', error => errors.push(error.message));
    await host.route('**/gpt-test-host', route => route.fulfill({contentType: 'text/html',
      body: fs.readFileSync(path.join(__dirname, 'fixtures/gpt-host.html'), 'utf8')}));
    await host.goto(`${base}/gpt-test-host`);
    await host.waitForFunction(() => window.ready);
    await host.locator('#prepare').click();
    await host.waitForFunction(() => window.latestResult);
    const frame = host.frameLocator('#widget');
    assert.equal(await frame.locator('#multi_tables table').count(), 0);
    await frame.locator('#calculate').click();
    await frame.locator('#multi_tables table').first().waitFor();
    await frame.locator('#multi_found summary').click();
    const gptGroup = frame.locator('#multi_found_cats .multi-found-group').first();
    assert.deepEqual(await gptGroup.locator('p').allTextContents(), ['Found cats:', 'Exclusive and legend cats:']);
    assert.equal(await gptGroup.locator('ul').first().locator('li').count(), 1);
    assert.match(await gptGroup.locator('ul').first().innerText(), /칼리파/);
    assert(!(await gptGroup.locator('ul').nth(1).innerText()).includes('칼리파'));
    assert.deepEqual(errors, []);
    console.log('found cats: upstream server search, client mode transition, grouped positions and Multi/GPT target separation passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
