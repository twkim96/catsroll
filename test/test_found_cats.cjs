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
    // Direct client rendering has no server-computed result argument. The spare
    // Find dropdown must still load before JS computes, including on reload.
    const direct = await browser.newPage();
    const directErrors = [];
    direct.on('pageerror', error => directErrors.push(error.message));
    const directResponse = await direct.goto(`${base}/?seed=42&last=47&lang=kr&compute=client`);
    assert.equal(directResponse.status(), 200);
    await direct.waitForFunction(() => document.querySelector('#client-compute-status')?.textContent === '✓');
    assert.equal(await direct.locator('select[name="find"]').count(), 1);
    assert.equal((await direct.reload()).status(), 200);
    await direct.waitForFunction(() => document.querySelector('#client-compute-status')?.textContent === '✓');

    // The upstream five-target form is server-owned, while the arrays are still
    // computed on device. Adding/removing a target must rebuild the spare field.
    await direct.goto(`${base}/?${query}&count=100&compute=client`);
    await direct.waitForFunction(() => document.querySelector('#client-compute-status')?.textContent === '✓');
    let selectedFinds = () => direct.locator('select[name="find"]').evaluateAll(nodes => nodes.map(n => n.value).filter(Boolean));
    assert.deepEqual(await selectedFinds(), ['732']);
    await direct.locator('select[name="find"]').last().selectOption('270');
    await direct.waitForURL(url => url.searchParams.getAll('find').includes('270'));
    await direct.waitForFunction(() => document.querySelector('#client-compute-status')?.textContent === '✓');
    assert.deepEqual(await selectedFinds(), ['732', '270']);
    assert.equal(await direct.locator('select[name="find"]').count(), 3);
    assert.equal(await direct.locator('.found_cats ul').first().locator('li').count(), 2);
    await direct.locator('select[name="find"]').first().selectOption('');
    await direct.waitForURL(url => !url.searchParams.getAll('find').includes('732'));
    await direct.waitForFunction(() => document.querySelector('#client-compute-status')?.textContent === '✓');
    assert.deepEqual(await selectedFinds(), ['270']);
    const maximumFinds = ['732', '270', '319', '544', '691'];
    await direct.goto(`${base}/?seed=42&event=2026-10-16_1072&lang=en&compute=client&` +
      new URLSearchParams(maximumFinds.map(id => ['find', id])));
    await direct.waitForFunction(() => document.querySelector('#client-compute-status')?.textContent === '✓');
    assert.deepEqual(await selectedFinds(), maximumFinds);
    assert.equal(await direct.locator('select[name="find"]').count(), 5);
    assert.equal(await direct.locator('.found_cats ul').first().locator('li').count(), 5);
    // A later Roll must preserve every dropdown selection, not only the first.
    await direct.locator('#content form input[type=submit]').click();
    await direct.waitForFunction(() => document.querySelector('#client-compute-status')?.textContent === '✓');
    assert.deepEqual(new URL(direct.url()).searchParams.getAll('find'), maximumFinds);
    assert.deepEqual(await selectedFinds(), maximumFinds);
    assert.deepEqual(directErrors, []);
    await direct.close();

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
    assert.deepEqual(await group.locator('h4').allTextContents(), ['Found cats:', 'Exclusive and legend cats:']);
    assert.equal(await group.locator('ul').first().locator('li').count(), 1);
    assert.equal((await group.locator('ul').first().innerText()).split(':').pop().trim(), originalPositions);
    assert.equal(await group.locator('ul').nth(1).locator(`a[data-last="${targetId}"]`).count(), 0);

    // A guaranteed banner keeps its table branches, but lists only normal positions.
    const guaranteed = await browser.newPage();
    guaranteed.on('pageerror', error => errors.push(error.message));
    await guaranteed.goto(`${base}/multi?seed=1278975749&last=447&lang=kr&event=2026-09-28_1081&count=100`);
    await guaranteed.locator('#multi_tables table').first().waitFor();
    await guaranteed.locator('#multi_rows select[data-field="forceGuaranteed"]').selectOption('11');
    await guaranteed.locator('#multi_find_filter').click();
    await guaranteed.locator('#multi_find_available button[data-cat-id="865"]').first().click();
    await guaranteed.locator('[data-multi-find-close]').click();
    await guaranteed.locator('#multi_apply').click();
    await guaranteed.waitForFunction(() => !document.querySelector('#multi-track-app').classList.contains('is-dirty'));
    await guaranteed.locator('#multi_found summary').click();
    const guaranteedFound = guaranteed.locator('#multi_found_cats');
    assert.match(await guaranteedFound.innerText(), /Found cats:/);
    assert(!/\d+[AB][RG]*G/.test(await guaranteedFound.innerText()));
    assert(await guaranteed.locator('#multi_tables [data-plan-pick-kind="guaranteed"]').count() > 0,
      'G results stay available in the actual track table');

    // The GPT host uses the same Multi UI and calculation boundary.
    const host = await browser.newPage();
    host.on('pageerror', error => errors.push(error.message));
    await host.route('**/gpt-test-host', route => route.fulfill({contentType: 'text/html',
      body: fs.readFileSync(path.join(__dirname, 'fixtures/gpt-host.html'), 'utf8')}));
    await host.goto(`${base}/gpt-test-host`);
    await host.waitForFunction(() => window.ready);
    const prepared = JSON.parse(await host.locator('#arguments').inputValue());
    prepared.count = 30;
    prepared.rows[0].forceGuaranteed = 11;
    await host.locator('#arguments').fill(JSON.stringify(prepared));
    await host.locator('#prepare').click();
    await host.waitForFunction(() => window.latestResult);
    await host.waitForFunction(() => document.querySelector('#widget').contentDocument
      .querySelector('#multi_find_targets')?.value.includes('칼리파'));
    const frame = host.frameLocator('#widget');
    assert.equal(await frame.locator('#multi_tables table').count(), 0);
    await frame.locator('#calculate').click();
    await frame.locator('#multi_tables table').first().waitFor();
    await frame.locator('#multi_found summary').click();
    const gptGroup = frame.locator('#multi_found_cats .multi-found-group').first();
    assert.deepEqual(await gptGroup.locator('h4').allTextContents(), ['Found cats:', 'Exclusive and legend cats:']);
    assert.equal(await gptGroup.locator('ul').first().locator('li').count(), 1);
    assert.match(await gptGroup.locator('ul').first().innerText(), /칼리파/);
    assert(!(await gptGroup.locator('ul').nth(1).innerText()).includes('칼리파'));
    assert(!/\d+[AB][RG]*G/.test(await frame.locator('#multi_found_cats').innerText()));
    assert(await frame.locator('#multi_tables [data-plan-pick-kind="guaranteed"]').count() > 0);
    assert.deepEqual(errors, []);
    console.log('found cats: upstream server search, client mode transition, grouped positions and Multi/GPT target separation passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
