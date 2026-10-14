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
    assert.equal(await page.locator('.card').count(), 6);
    assert.equal(await page.locator('#result-count').innerText(), '15 updates');
    assert.equal(await page.getByRole('button', { name: /reload/i }).count(), 0);
    assert(!/A good week starts here|A lovely note|What about choir|Why this is here/.test(await page.locator('body').innerText()));
    assert.equal(await page.locator('.schedule').getByText('Choir', { exact: false }).count(), 0);
    assert(await page.locator('.school img').evaluate(img => img.complete && img.naturalWidth > 0));
    await page.getByRole('button', { name: /Show more updates/ }).click();
    assert.equal(await page.locator('.card').count(), 12);
    await page.getByRole('button', { name: /Show more updates/ }).click();
    assert.equal(await page.locator('.card').count(), 15);
    for (const [name, expected] of [['Archive', 2], ['Newsletters', 6], ['Blake & Year 3', 5]]) {
      await page.getByRole('button', { name, exact: true }).click();
      assert.equal(await page.locator('.card').count(), expected);
    }
    await page.getByRole('button', { name: 'Latest', exact: true }).click();
    const first = page.locator('.card').first();
    const key = await first.getAttribute('data-key');
    await first.getByRole('button', { name: /^Save / }).click();
    await page.reload();
    await page.waitForSelector('.card');
    await page.getByRole('button', { name: 'Saved', exact: true }).click();
    assert.equal(await page.locator('.card').count(), 1);
    assert.equal(await page.locator('.card').getAttribute('data-key'), key);
    await page.locator('.card').getByRole('button', { name: /^Unsave / }).click();
    assert(await page.getByText('Nothing saved yet').isVisible());
    await page.getByRole('button', { name: 'Latest', exact: true }).click();
    await page.locator('.card').first().getByRole('button', { name: /^Archive / }).click();
    assert.equal(await page.locator('#result-count').innerText(), '14 updates');
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await page.locator('#result-count').innerText(), '15 updates');
    await page.getByRole('searchbox').fill('choir');
    assert.equal(await page.locator('.card').count(), 1);
    await page.getByRole('searchbox').fill('xyznonexistent');
    assert.equal(await page.locator('.card').count(), 0);
    await page.getByRole('searchbox').fill('');
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow at ' + width);
    }
    assert.deepEqual(errors, []);
    console.log('Passed: pagination, filters, saved persistence, archive/undo, search, logo, copy, and 4 viewport widths.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
