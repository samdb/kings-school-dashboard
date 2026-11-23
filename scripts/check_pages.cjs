/* Real browser navigation/layout checks. Fresh context, no live subscription changes. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const url=process.env.KINGS_REVIEW_URL||'http://127.0.0.1:8876/';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,headless:true,chromiumSandbox:process.env.CHROMIUM_SANDBOX!=='false'});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  async function navigate(view,title) {
   await page.getByRole('button',{name:'Menu'}).click();
   await page.locator(`#site-menu [data-view="${view}"]`).click();
   await page.waitForFunction(t=>document.querySelector('#page-title').textContent===t,title);
   assert.equal(await page.locator('#site-menu').isVisible(),false);
   assert.equal(await page.locator(`#site-menu [data-view="${view}"]`).getAttribute('aria-current'),'page');
   assert.equal(await page.locator('.page-screen:visible').count(),1);
  }
  await page.goto(url);await page.waitForSelector('#feed .card');
  assert.equal(await page.locator('#page-title').innerText(),'Upcoming');
  assert.equal(await page.locator('#grades').isVisible(),false);
  assert.equal(await page.locator('.next-date,.dates,.sidebar,.schedule,.choir,#information').count(),0);
  assert.equal(await page.locator('#updates button,#updates input,#updates select').count(),0);
  assert(await page.locator('.school img').evaluate(img=>img.complete&&img.naturalWidth>0));
  const manifest=await (await page.request.get(new URL('./manifest.webmanifest',page.url()).href)).json();
  assert.equal(manifest.display,'standalone');assert.equal(manifest.scope,'./');
  const dateValues=await page.locator('#feed .event-date').evaluateAll(nodes=>nodes.map(n=>n.dateTime));
  assert.deepEqual(dateValues,[...dateValues].sort());
  assert.equal(await page.locator('#feed [data-key="calendar-2026-27-michaelmas-ends"]').count(),1);
  const initial=await page.locator('#feed .card').count();
  await page.evaluate(()=>localStorage.setItem('kings-family-marks-v1',JSON.stringify(Object.fromEntries([...document.querySelectorAll('.card')].map(c=>[c.dataset.key,{done:true,dismissed:true}])))));
  await page.reload();await page.waitForSelector('#feed .card');assert.equal(await page.locator('#feed .card').count(),initial);
  await page.getByRole('button',{name:'Menu'}).click();await page.keyboard.press('Escape');
  assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'),'false');
  assert(await page.locator('#menu-toggle').evaluate(el=>el===document.activeElement));
  for(const width of [1440,768,390,320]) {
   await page.setViewportSize({width,height:844});
   for(const [view,title] of [['upcoming','Upcoming'],['grades','Schoolwork & grades'],['term-dates','Term dates'],['past-events','Past events'],['settings','App settings']]) {
    await navigate(view,title);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${view} overflow at ${width}`);
   }
   await page.getByRole('button',{name:'Menu'}).click();
   assert(await page.locator('#site-menu').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));
   if(width===390)await page.screenshot({path:'/tmp/kings-menu-mobile.png'});
   await page.keyboard.press('Escape');
  }
  await navigate('term-dates','Term dates');
  assert.equal(await page.locator('#term-dates-feed .card').count(),16);
  assert.equal(await page.locator('#term-dates-feed [data-key="calendar-2026-27-michaelmas-ends"]').count(),1);
  assert((await page.locator('#term-dates-feed').innerText()).includes('School calendar checked'));
  await page.screenshot({path:'/tmp/kings-term-dates-mobile.png'});
  await navigate('past-events','Past events');
  const pastDates=await page.locator('#past-feed .event-date').evaluateAll(nodes=>nodes.map(n=>n.dateTime));
  assert.deepEqual(pastDates,[...pastDates].sort().reverse());
  assert(await page.locator('#past-feed .card').count()>0);
  await page.screenshot({path:'/tmp/kings-past-mobile.png'});
  await navigate('grades','Schoolwork & grades');
  assert.equal(await page.locator('#grades-feed .event-date').count(),0);
  const image=page.locator('.work-image').first();await image.click();
  const dialog=page.getByRole('dialog');await dialog.waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('.lightbox-stage img').naturalWidth>0);
  await dialog.getByRole('button',{name:'Zoom in',exact:true}).click();
  assert.equal(await dialog.getByRole('button',{name:'Fit image',exact:true}).getAttribute('aria-pressed'),'true');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert(await image.evaluate(el=>el===document.activeElement));
  await image.click();await dialog.getByRole('button',{name:'Close',exact:true}).click();
  // Routes survive refresh, direct links and browser back.
  await page.reload();await page.waitForSelector('#grades-feed .card');
  assert.equal(await page.locator('#page-title').innerText(),'Schoolwork & grades');
  await navigate('term-dates','Term dates');await page.goBack();await page.waitForSelector('#grades:not([hidden])');
  await navigate('upcoming','Upcoming');await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'/tmp/kings-info-desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/kings-info-mobile.png'});
  // London midnight moves dated events into history, retaining in-progress ranges.
  const fixture=await browser.newPage({serviceWorkers:'block'});
  await fixture.route('**/feed.json',r=>r.abort());
  await fixture.clock.install({time:new Date('2026-12-01T23:59:00Z')});
  const items=[
   {key:'later',subject:'Later event',event_on:'2026-12-03',received_at:'2026-11-23',excerpt:'Later'},
   {key:'undated',subject:'Policy',expires_on:'2027-01-01',received_at:'2026-11-23',excerpt:'Undated'},
   {key:'grade',kind:'grade',subject:'Spelling',received_at:'2026-11-22',excerpt:'Grade'},
   {key:'work',kind:'work',subject:'Maths',received_at:'2026-11-23',excerpt:'Work'},
   {key:'today',subject:'Today',event_on:'2026-12-01',received_at:'2026-11-01',excerpt:'Today'},
   {key:'range',kind:'term',subject:'Break',event_on:'2026-11-30',event_end_on:'2026-12-02',reviewed_on:'2026-11-23',excerpt:'Break'},
   {key:'past',subject:'Past event',event_on:'2026-11-29',expires_on:'2026-11-29',received_at:'2026-11-23',excerpt:'Past'}];
  await fixture.route('**/snapshot.js*',r=>r.fulfill({contentType:'text/javascript',body:'window.schoolSnapshotApi=()=>Promise.resolve('+JSON.stringify({revision:'fixture',generated_at:'2026-11-23',coverage_text:'',items})+');'}));
  await fixture.goto(url);await fixture.waitForSelector('#feed .card');
  const keys=selector=>fixture.locator(selector+' .card').evaluateAll(cards=>cards.map(c=>c.dataset.key));
  assert.deepEqual(await keys('#feed'),['range','today','later']);
  assert.deepEqual(await keys('#grades-feed'),['work','grade']);
  assert.deepEqual(await keys('#past-feed'),['past']);
  assert.equal(await fixture.locator('[data-key=undated]').count(),0);
  await fixture.clock.fastForward(120000);
  assert.deepEqual(await keys('#feed'),['range','later']);
  assert.deepEqual(await keys('#past-feed'),['today','past']);
  await fixture.goto(url+'#past-events');await fixture.waitForSelector('#past-feed .card');
  assert.equal(await fixture.locator('#page-title').innerText(),'Past events');
  await fixture.close();assert.deepEqual(errors,[]);
  console.log('Passed: five screens, menu/keyboard/focus/back/deep links, source-backed term events, reverse-date history, live midnight rollover + ranges, four widths, lightbox, manifest, old marks ignored.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
