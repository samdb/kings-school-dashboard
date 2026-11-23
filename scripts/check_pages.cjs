/* Browser regression check. Uses a fresh context; does not change Gmail. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    chromiumSandbox: true,
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.KINGS_REVIEW_URL || 'http://127.0.0.1:8876/');
    await page.waitForSelector('.card');
    const initialCount = await page.locator('.card').count();
    assert(initialCount > 0);
    assert.equal(await page.locator('#updates button:not(.work-image), #updates input, #updates select, #updates details').count(), 0);
    assert.equal(await page.locator('.schedule, .choir, #information').count(), 0);
    assert.equal(await page.locator('#grades-title').innerText(), 'Schoolwork & grades');
    const manifest=await (await page.request.get(new URL('./manifest.webmanifest',page.url()).href)).json();
    assert.equal(manifest.display,'standalone');
    assert.equal(manifest.scope,'./');
    for(const icon of manifest.icons) assert.equal((await page.request.get(new URL(icon.src,page.url()).href)).status(),200);
    assert(!/A good week starts here|Saved|Archive|Sync coverage|imported emails/.test(await page.locator('body').innerText()));
    assert(await page.locator('.school img').evaluate(img => img.complete && img.naturalWidth > 0));
    // Old saved/hidden choices must not hide information on the read-only page.
    await page.evaluate(() => localStorage.setItem('kings-family-marks-v1', JSON.stringify(Object.fromEntries([...document.querySelectorAll('.card')].map(card => [card.dataset.key, {done:true,dismissed:true}])))));
    await page.reload();
    await page.waitForSelector('.card');
    assert.equal(await page.locator('.card').count(), initialCount);
    const expired = await page.evaluate(async () => { const f=await schoolSnapshotApi('/api/feed'); const today=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/London'}); return f.items.filter(i=>i.expires_on && i.expires_on<today).map(i=>i.key); });
    for (const key of expired) assert.equal(await page.locator('[data-key="'+key+'"]').count(),0);
    assert.equal(await page.locator('.card').filter({hasText:'Year 3 teaching-assistant provision'}).count(),0);
    assert(!(await page.locator('#feed').innerText()).includes('Read the newsletter for notices'));
    assert.equal(await page.locator('#updates-title').innerText(), 'Upcoming');
    const displayedDates=await page.locator('#feed .event-date').evaluateAll(times=>times.map(t=>t.dateTime));
    assert.deepEqual(displayedDates, [...displayedDates].sort());
    assert.equal(await page.locator('#grades-feed .event-date').count(),0);
    assert(await page.locator('.card').evaluateAll(cards=>cards.every(c=>c.querySelector('h3').compareDocumentPosition(c.querySelector('.source-note')) & Node.DOCUMENT_POSITION_FOLLOWING)));
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'overflow at ' + width);
    }
    const imageButton=page.locator('.work-image').first();
    if(await imageButton.count()) {
      await imageButton.click();
      const dialog=page.getByRole('dialog');
      await dialog.waitFor({state:'visible'});
      assert(await dialog.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0));
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'dialog overflow');
      await dialog.getByRole('button',{name:'Zoom in',exact:true}).click();
      assert.equal(await dialog.getByRole('button',{name:'Fit image',exact:true}).getAttribute('aria-pressed'),'true');
      await page.screenshot({path:'/tmp/kings-work-lightbox-mobile.png'});
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
      assert(await imageButton.evaluate(el=>document.activeElement===el),'focus returns to image');
      await imageButton.click();await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'hidden'});
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.screenshot({path:'/tmp/kings-info-desktop.png'});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:'/tmp/kings-info-mobile.png'});
    await page.locator('#updates').scrollIntoViewIfNeeded();
    await page.screenshot({path:'/tmp/kings-upcoming-mobile.png'});
    // Dates, not arrival order or expiry, determine the upcoming list. Verify
    // the day boundary and undated information with a separate synthetic page.
    const fixture=await browser.newPage();
    await fixture.clock.install({time:new Date('2026-12-01T23:59:00Z')});
    await fixture.route('**/snapshot.js*',route=>route.fulfill({contentType:'text/javascript',body:
      'window.schoolSnapshotApi=()=>Promise.resolve('+JSON.stringify({generated_at:'2026-11-23',coverage_text:'',items:[
        {key:'later',subject:'Later event',event_on:'2026-12-03',received_at:'2026-11-23',excerpt:'Later'},
        {key:'undated',subject:'School policy',expires_on:'2027-01-01',received_at:'2026-11-22',excerpt:'Undated'},
        {key:'grade',kind:'grade',subject:'Spelling result',received_at:'2026-11-22',excerpt:'Synthetic grade'},
        {key:'work',kind:'work',subject:'Marked maths work',received_at:'2026-11-23',excerpt:'Ticks, no numerical score'},
        {key:'today',subject:'Today event',event_on:'2026-12-01',received_at:'2026-11-01',excerpt:'Today'},
        {key:'past',subject:'Past event without expiry',event_on:'2026-11-30',received_at:'2026-11-23',excerpt:'Past'}
      ]})+');'}));
    await fixture.goto(process.env.KINGS_REVIEW_URL || 'http://127.0.0.1:8876/');
    await fixture.waitForSelector('#feed .card');
    assert.deepEqual(await fixture.locator('#feed .card').evaluateAll(cards=>cards.map(c=>c.dataset.key)),['today','later']);
    assert.deepEqual(await fixture.locator('#grades-feed .card').evaluateAll(cards=>cards.map(c=>c.dataset.key)),['work','grade']);
    assert.equal(await fixture.locator('[data-key=undated]').count(),0);
    assert.equal(await fixture.locator('[data-key="past"]').count(),0);
    await fixture.clock.fastForward(120000);
    await fixture.reload();
    await fixture.waitForSelector('#feed .card');
    assert.deepEqual(await fixture.locator('#feed .card').evaluateAll(cards=>cards.map(c=>c.dataset.key)),['later']);
    await fixture.close();
    assert.deepEqual(errors, []);
    console.log('Passed: event-date order, date rollover, schoolwork/grade separation, image lightbox zoom/close/focus, PWA manifest, source footnotes, old marks ignored, logo and 4 viewport widths.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
