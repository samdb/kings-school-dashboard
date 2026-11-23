/* Real service-worker/browser regression: isolated server, no live subscriptions. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createApp}=require('../push/server.cjs');
(async()=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'school-cache-'));
  const docs=path.resolve(__dirname,'../docs');
  let slow=false, failure=false, changed=false, brokenWorker=false, feedRequests=0;
  const app=createApp({docs,data,origin:'http://127.0.0.1',send:async()=>{}});
  const handler=app.server.listeners('request')[0];
  app.server.removeAllListeners('request');
  app.server.on('request',(req,res)=>{
    if(req.url==='/school/feed.json') {
      feedRequests++;
      return setTimeout(()=>{
        if(failure){res.writeHead(503);return res.end();}
        const feed=JSON.parse(fs.readFileSync(path.join(docs,'feed.json')));
        if(changed){feed.revision='test-new-publication';feed.generated_at='2099-01-01T00:00:00Z';feed.items.find(i=>i.event_on).subject='New publication test';}
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(feed));
      },slow?3000:0);
    }
    if(brokenWorker && req.url==='/school/sw.js') {
      let worker=fs.readFileSync(path.join(docs,'sw.js'),'utf8').replace(/const RELEASE=.*?;/,'const RELEASE="broken-publication";').replace(/("index.html":\s*")[a-f0-9]{64}/,'$1'+'0'.repeat(64));
      res.setHeader('Content-Type','application/javascript');res.end(worker);return;
    }
    setTimeout(()=>handler(req,res),slow?3000:0);
  });
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${app.server.address().port}/school/`;
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url);await page.waitForSelector('.card');
    await page.waitForFunction(()=>navigator.serviceWorker.controller);
    await page.waitForFunction(()=>window.schoolFreshRevision===window.schoolRenderedRevision);
    const original=await page.evaluate(()=>schoolRenderedRevision);
    // Viewed images must reopen offline too.
    await page.locator('.work-image').first().click();
    await page.waitForFunction(()=>document.querySelector('.lightbox-stage img').naturalWidth>0);
    await page.getByRole('button',{name:'Close',exact:true}).click();
    slow=true;
    const started=Date.now();await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('.card');
    const elapsed=Date.now()-started;assert(elapsed<1800,`Cached launch took ${elapsed}ms with 3000ms network delay`);
    assert.equal(await page.locator('#refresh-status').getAttribute('aria-busy'),'true');
    assert.equal(await page.evaluate(()=>window.schoolFreshRevision),null);
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:'/tmp/kings-cache-updating-mobile.png'});
    await page.waitForFunction(()=>document.querySelector('#refresh-message').textContent==='Up to date');
    console.log(`Cached render: ${elapsed}ms with 3000ms delayed server`);
    slow=false;
    await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('.card');
    await page.waitForFunction(()=>document.querySelector('#refresh-message').textContent.includes('Offline'));
    assert.equal(await page.evaluate(()=>window.schoolFreshRevision),null);
    assert.equal(await page.evaluate(()=>window.schoolRenderedRevision),original);
    await page.locator('.work-image').first().click();await page.waitForFunction(()=>document.querySelector('.lightbox-stage img').naturalWidth>0);
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:'/tmp/kings-cache-offline-mobile.png'});
    changed=true;await context.setOffline(false);
    await page.waitForFunction(()=>window.schoolRenderedRevision==='test-new-publication' && window.schoolFreshRevision==='test-new-publication');
    assert(await page.getByRole('heading',{name:'New publication test'}).count());
    // A newer successfully fetched feed persists across offline cold navigation.
    await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('.card');
    assert.equal(await page.evaluate(()=>window.schoolRenderedRevision),'test-new-publication');
    assert.equal(await page.evaluate(()=>window.schoolFreshRevision),null);
    failure=true;await context.setOffline(false);
    await page.waitForFunction(()=>document.querySelector('#refresh-message').textContent.includes('Couldn’t'));
    assert.equal(await page.evaluate(()=>window.schoolRenderedRevision),'test-new-publication');
    failure=false;await page.getByRole('button',{name:'Try again'}).click();
    await page.waitForFunction(()=>document.querySelector('#refresh-message').textContent==='Up to date');
    const urls=await page.evaluate(async()=>{const result=[];for(const name of await caches.keys())for(const req of await (await caches.open(name)).keys())result.push(req.url);return result;});
    assert(!urls.some(u=>u.includes('/api/')||u.endsWith('/feed.json')),'API/feed must stay network-only');
    // A mixed/corrupt deployment cannot replace the last complete offline shell.
    brokenWorker=true;
    await page.evaluate(async()=>{
      const reg=await navigator.serviceWorker.getRegistration();
      await new Promise(async resolve=>{reg.addEventListener('updatefound',()=>{const w=reg.installing;w.addEventListener('statechange',()=>{if(w.state==='redundant')resolve();});},{once:true});await reg.update();});
    });
    await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('.card');
    assert.deepEqual(errors,[]);assert(feedRequests>=5);
    console.log('Passed: slow launch spinner, offline page + viewed image, online recovery, saved newer feed, failed refresh + retry, no cached API, incomplete release rejected.');
  }finally{await browser.close();await new Promise(resolve=>app.server.close(resolve));fs.rmSync(data,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
