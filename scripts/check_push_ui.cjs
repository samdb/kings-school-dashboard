/* Browser integration for category acknowledgement. Push/permission APIs are mocked; no real notifications sent. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');const http=require('node:http');const fs=require('node:fs');const path=require('node:path');
(async()=>{
 const docs=path.resolve(__dirname,'../docs');const feed=JSON.parse(fs.readFileSync(path.join(docs,'feed.json')));
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined});
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice('/school/'.length)||'index.html';if(!/^[a-zA-Z0-9.-]+$/.test(name)){res.writeHead(404);return res.end();}try{res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.png')?'image/png':'application/json');res.end(fs.readFileSync(path.join(docs,name)));}catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const unread={grades:1,events:1};const acknowledgements=[];const tests=[];let refuse=false;
  await page.route('**/api/*',async route=>{
   const req=route.request(),kind=new URL(req.url()).pathname.split('/').at(-1);const input=req.method()==='POST'?req.postDataJSON():{};
   let data;
   if(kind==='seen') {acknowledgements.push(input);const seen=!refuse && input.revision===feed.revision && ['grades','events'].includes(input.category);if(seen)unread[input.category]=0;data={seen,count:unread.grades+unread.events,categories:{...unread}};}
   else if(kind==='test'){tests.push(input.category);data={sent:true};}
   else data={enabled:true,count:unread.grades+unread.events,publicKey:'test'};
   await route.fulfill({json:data});
  });
  await page.addInitScript(()=>{
   window.__badges=[];window.__closed=[];
   const notifications=['grades','events'].map(category=>({data:{category},tag:'school-'+category,close:()=>window.__closed.push(category)}));
   const reg={pushManager:{getSubscription:async()=>({toJSON:()=>({})})},getNotifications:async()=>notifications};
   Object.defineProperty(navigator.serviceWorker,'register',{value:async()=>reg});
   Object.defineProperty(navigator.serviceWorker,'ready',{value:Promise.resolve(reg)});
   Object.defineProperty(Notification,'permission',{get:()=>'granted'});
   Object.defineProperty(navigator,'setAppBadge',{value:async n=>window.__badges.push(n)});
   Object.defineProperty(navigator,'clearAppBadge',{value:async()=>window.__badges.push(0)});
  });
  const url=`http://127.0.0.1:${server.address().port}/school/`;
  await page.goto(url+'#grades');await page.waitForFunction(()=>window.__closed.includes('grades'));
  assert(acknowledgements.every(a=>a.category==='grades'));assert.equal(unread.events,1);
  assert.equal(await page.evaluate(()=>window.__badges.at(-1)),1);assert(!await page.evaluate(()=>window.__closed.includes('events')));
  await page.evaluate(()=>location.hash='upcoming');await page.waitForFunction(()=>window.__closed.includes('events'));
  assert.equal(await page.evaluate(()=>window.__badges.at(-1)),0);
  await page.evaluate(()=>location.hash='settings');await page.waitForSelector('#settings:not([hidden])');
  const previous=acknowledgements.length;await page.evaluate(()=>window.dispatchEvent(new Event('school-rendered')));
  assert.equal(acknowledgements.length,previous,'settings must not acknowledge unread categories');
  await page.screenshot({path:'/tmp/kings-push-settings-mobile.png'});
  await page.getByRole('button',{name:'Test schoolwork notification',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#notification-status').textContent.includes('Schoolwork & grades.'));
  await page.getByRole('button',{name:'Test event notification',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#notification-status').textContent.includes('Upcoming.'));
  assert.deepEqual(tests,['grades','events']);
  await page.evaluate(()=>{window.schoolFreshRevision=null;location.hash='grades';});
  await page.waitForSelector('#grades:not([hidden])');assert.equal(acknowledgements.length,previous,'offline/stale rendering must not acknowledge');
  refuse=true;
  const badges=await page.evaluate(()=>window.__badges.length);
  await page.evaluate(()=>{window.schoolFreshRevision=window.schoolRenderedRevision;window.dispatchEvent(new Event('school-rendered'));});
  await page.waitForResponse(r=>r.url().endsWith('/api/seen'));
  assert.equal(await page.evaluate(()=>window.__badges.length),badges,'server stale rejection must not clear badges');
  assert.deepEqual(errors,[]);
  console.log('Passed: grades/events acknowledge separately, shared badge decrements, other alert retained, settings/stale pages do not acknowledge, both category test buttons. Browser notification APIs mocked.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
