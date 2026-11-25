const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,chromiumSandbox:false});
 try {
  const page=await browser.newPage({serviceWorkers:'block',viewport:{width:390,height:844}});
  const now=new Date('2026-11-25T12:00:00Z');await page.clock.install({time:now});
  const feed=JSON.parse(fs.readFileSync('docs/feed.json'));
  let health={status:'verification_required',checked_at:now.toISOString(),last_reviewed_at:'2026-11-23T20:36:00Z'};
  await page.route('**/feed.json',r=>r.fulfill({json:{...feed,source_health:{seesaw:health}}}));
  await page.goto('http://127.0.0.1:8876/');
  await page.waitForFunction(()=>document.querySelector('#refresh-message').textContent==='Published updates loaded');
  assert.match(await page.locator('#source-status').innerText(),/paused.*23 Nov 2026/);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'/tmp/kings-source-status-mobile.png'});
  health={status:'available',checked_at:now.toISOString(),last_reviewed_at:'2026-11-23T20:36:00Z'};
  await page.evaluate(()=>window.schoolRefresh());
  assert.match(await page.locator('#source-status').innerText(),/not yet been checked/);
  health={status:'available',checked_at:now.toISOString(),last_reviewed_at:now.toISOString()};
  await page.evaluate(()=>window.schoolRefresh());assert.equal(await page.locator('#source-status').isVisible(),false);
  await page.clock.fastForward(8*60*60*1000+60000);
  assert.match(await page.locator('#source-status').innerText(),/not yet been checked/);
  health=undefined;await page.evaluate(()=>window.schoolRefresh());
  assert.match(await page.locator('#source-status').innerText(),/not yet been checked/);
  console.log('PASS: blocked, connection-only, reviewed, unattended stale rollover, missing evidence, mobile layout');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
