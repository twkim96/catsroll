'use strict';
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.CATSROLL_TEST_URL || 'http://127.0.0.1:17868';

async function readable(locator, minimum = 4.5) {
  const colors = await locator.evaluate(element => {
    const style = getComputedStyle(element);
    return {text: element.textContent.trim(), fg: style.color, bg: style.backgroundColor};
  });
  function luminance(color) {
    const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
      value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    });
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
  }
  const a = luminance(colors.fg), b = luminance(colors.bg);
  assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= minimum,
    'Control must remain readable: ' + JSON.stringify(colors));
}

(async () => {
  const browser = await chromium.launch({headless: true, channel: process.env.GPT_BROWSER_CHANNEL || 'chrome'});
  try {
    let page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    await page.goto(base + '/?seed=42&lang=kr&event=2019-01-23_348&count=10&compute=client');
    await page.locator('#event_filter_button').waitFor();
    await readable(page.locator('#event_filter_button'), 3);
    await page.locator('#event_filter_button').click();
    const singleTag = page.locator('[data-event-filter-available] .event-filter-tag').first();
    await singleTag.waitFor(); await readable(singleTag);
    await singleTag.click();
    await readable(page.locator('[data-event-filter-selected] .event-filter-tag').first());
    await page.locator('[data-event-filter-close]').click();
    // Closing applies the filter through the ordinary form navigation.
    await page.close();
    page = await browser.newPage({viewport: {width: 1440, height: 1000}});

    await page.goto(base + '/multi?seed=42&lang=kr&event=2019-01-23_348&count=10');
    await page.locator('#multi_tables table').first().waitFor();
    await page.locator('.multi-filter-button').first().click();
    const multiTag = page.locator('[data-multi-filter-available] .event-filter-tag').first();
    await multiTag.waitFor(); await readable(multiTag);
    await page.screenshot({path: '/tmp/catsroll-web-filter-fixed.png'});
    await page.locator('[data-multi-filter-close]').click();
    await page.locator('#multi_find_filter').click();
    const cat = page.locator('#multi_find_available .event-filter-tag:not(.is-selected)').first();
    await cat.waitFor(); await readable(cat);
    await cat.click();
    await readable(page.locator('#multi_find_available .event-filter-tag.is-selected').first());
    await page.locator('[data-multi-find-close]').click();
    await page.locator('#multi_apply').click();
    await page.waitForFunction(() => !document.querySelector('#multi-track-app').classList.contains('is-dirty'));
    await page.locator('#multi_plan_mode').check();
    await page.locator('#multi_tables td[data-route-position="1A"]').first().click();
    const before = await page.evaluate(() => MultiPlanApp.getState());
    assert.ok(before.marks.length > 0);
    await page.locator('#multi_plan_mode').uncheck();
    assert.equal(await page.locator('#multi_plan_status').isVisible(), false);
    const after = await page.evaluate(() => MultiPlanApp.getState());
    assert.deepEqual(after.marks, before.marks);
    assert.deepEqual(after.route, before.route);
    await page.locator('#multi_plan_mode').check();
    assert.deepEqual(await page.evaluate(() => MultiPlanApp.getState().marks), before.marks);
    console.log('web controls: single/Multi filter contrast, selected/unselected targets and silent reversible plan toggle passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
