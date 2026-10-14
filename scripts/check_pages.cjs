/* Browser regression check. Uses a fresh context; does not change Gmail. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.KINGS_REVIEW_URL || 'http://127.0.0.1:8876/');
    await page.waitForSelector('.card');
    assert.equal(await page.locator('.card').count(), 15);
    assert.equal(await page.locator('button, input, select, details').count(), 0);
    assert(!/A good week starts here|Saved|Archive|Sync coverage|imported emails/.test(await page.locator('body').innerText()));
    assert.equal(await page.locator('.schedule').getByText('Choir', { exact: false }).count(), 0);
    assert(await page.locator('.school img').evaluate(img => img.complete && img.naturalWidth > 0));
    // Old saved/hidden choices must not hide information on the read-only page.
    await page.evaluate(() => localStorage.setItem('kings-family-marks-v1', JSON.stringify(Object.fromEntries([...document.querySelectorAll('.card')].map(card => [card.dataset.key, {done:true,dismissed:true}])))));
    await page.reload();
    await page.waitForSelector('.card');
    assert.equal(await page.locator('.card').count(), 15);
    assert.equal(await page.locator('.card a').count(), 15);
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow at ' + width);
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:'/tmp/kings-info-desktop.png'});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'/tmp/kings-info-mobile.png'});
    assert.deepEqual(errors, []);
    console.log('Passed: read-only presentation, all current updates visible, old marks ignored, source links, logo, copy, and 4 viewport widths.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
