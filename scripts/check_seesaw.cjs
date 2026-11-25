/* Read-only persistent-browser preflight. Never submits credentials or solves verification. */
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/home/ubuntu/.npm-global/lib/node_modules/openclaw/node_modules/playwright-core');
const evidence=path.resolve(__dirname,'../data/source_health.json');
(async()=>{
 let browser,status='unavailable';
 try {
  const version=await (await fetch('http://127.0.0.1:18800/json/version',{signal:AbortSignal.timeout(5000)})).json();
  browser=await chromium.connectOverCDP(version.webSocketDebuggerUrl,{timeout:10000});
  const context=browser.contexts()[0];
  let page=context.pages().find(p=>p.url().startsWith('https://app.seesaw.me/'));
  if(!page)page=await context.newPage();
  const challenge=async()=>{
   for(const frame of page.frames()) {
    if(!/recaptcha.*bframe/.test(frame.url()))continue;
    if(await frame.locator('body').isVisible().catch(()=>false))return true;
   }
   return /verification code|verify your email|check your email/i.test(await page.locator('body').innerText({timeout:5000}));
  };
  if((fs.existsSync(evidence)&&JSON.parse(fs.readFileSync(evidence,'utf8')).seesaw?.status==='verification_required'&&!/#\/family\/feed/.test(page.url()))||await challenge())status='verification_required';
  else {
   await page.goto('https://app.seesaw.me/#/family/feed',{waitUntil:'domcontentloaded',timeout:20000});
   await page.waitForFunction(()=>/Blake|Family Member|verification|verify your email/i.test(document.body.innerText),{},{timeout:15000}).catch(()=>{});
   const body=await page.locator('body').innerText({timeout:5000});
   if(await challenge())status='verification_required';
   else if(/#\/login/.test(page.url())||/Sign In as a Family Member|I’m a Family Member/.test(body))status='sign_in_required';
   else if(/#\/family\/feed/.test(page.url())&&/Blake/.test(body))status='available';
  }
 } catch {status='unavailable';}
 finally {if(browser)await browser.close();}
 // Merge only this source, preserving real review evidence and other sources.
 const data=fs.existsSync(evidence)?JSON.parse(fs.readFileSync(evidence,'utf8')):{};
 data.seesaw={...data.seesaw,status,checked_at:new Date().toISOString()};
 const temp=evidence+'.'+process.pid+'.tmp';fs.writeFileSync(temp,JSON.stringify(data,null,2),{mode:0o600});fs.renameSync(temp,evidence);
 console.log(JSON.stringify({source:'seesaw',status,reviewed:false}));
})().catch(()=>{console.error('Seesaw source check could not be recorded');process.exitCode=1;});
