// Gateway protected-exec only. Supply SEESAW_ACCOUNT_EMAIL privately; never a plaintext password.
const {chromium}=require('/home/ubuntu/.npm-global/lib/node_modules/openclaw/node_modules/playwright-core');
const {spawnSync}=require('node:child_process');
let stage='transport';
(async()=>{
  if(!process.env.SEESAW_ACCOUNT_EMAIL || !process.env.SEESAW_PASSWORD || !process.env.HTTPS_PROXY) throw Error('Protected transport unavailable');
  const health=require('node:fs').existsSync(__dirname+'/../data/source_health.json')?JSON.parse(require('node:fs').readFileSync(__dirname+'/../data/source_health.json','utf8')):{};
  if(health.seesaw?.status==='verification_required') throw Error('Human verification is pending; automatic login is disabled');
  stage='browser connection';
  process.env.NO_PROXY='localhost,127.0.0.1';
  process.env.no_proxy='localhost,127.0.0.1';
  const version=spawnSync('curl',['--noproxy','localhost,127.0.0.1','--silent','--fail','http://127.0.0.1:18800/json/version'],{encoding:'utf8'});
  const browser=await chromium.connectOverCDP(JSON.parse(version.stdout).webSocketDebuggerUrl);
  const context=browser.contexts()[0];
  const page=context.pages().find(p=>p.url().startsWith('https://app.seesaw.me/') && p.url().includes('role=parent'));
  stage='find family page';
  if(!page) throw Error('Family sign-in page not found');
  let intercepted=false;
  const handler=async route=>{
    const request=route.request();
    const body=request.postData()||'';
    if(!body.includes(process.env.SEESAW_PASSWORD)) return route.continue();
    intercepted=true;
    const url=new URL(request.url());
    console.log('Sign-in endpoint:',url.origin+url.pathname);
    if(url.protocol!=='https:' || url.hostname!=='app.seesaw.me') {
      await route.abort();
      console.log('Stopped: sign-in needs a different approved host');
      return;
    }
    const headers=await request.allHeaders();
    const args=['--silent','--show-error','--max-time','30','--request',request.method(),request.url(), '--data-binary','@-','--write-out','\n%{http_code}'];
    for(const [key,value] of Object.entries(headers)) {
      if(['content-length','host','accept-encoding','connection'].includes(key.toLowerCase())) continue;
      args.push('--header',key+': '+value);
    }
    const result=spawnSync('curl',args,{input:body,encoding:'utf8',maxBuffer:8*1024*1024});
    if(result.status!==0) {await route.abort();console.log('Protected request failed; response not printed');return;}
    const split=result.stdout.lastIndexOf('\n');
    const status=Number(result.stdout.slice(split+1));
    console.log('Sign-in HTTP status:',status);
    await route.fulfill({status,contentType:'application/json',body:result.stdout.slice(0,split)});
  };
  await context.route('**/*',handler);
  try {
    stage='fill email';
    await page.getByRole('textbox',{name:'Email',exact:true}).fill(process.env.SEESAW_ACCOUNT_EMAIL);
    stage='fill password';
    await page.getByRole('textbox',{name:'Password',exact:true}).fill('');
    await page.getByRole('textbox',{name:'Password',exact:true}).pressSequentially(process.env.SEESAW_PASSWORD,{delay:10});
    stage='submit';
    await page.getByRole('button',{name:/Family Member Sign In/}).click();
    await page.waitForFunction(()=>!document.querySelector('input[type=password]'),{},{timeout:30000}).catch(()=>{});
    console.log('Protected request intercepted:',intercepted);
    console.log('Current location:',new URL(page.url()).origin+new URL(page.url()).hash.split('?')[0]);
    console.log('Password form still visible:',await page.getByRole('textbox',{name:'Password',exact:true}).isVisible());
  } finally {
    await context.unroute('**/*',handler);
    const password=page.getByRole('textbox',{name:'Password',exact:true});
    if(await password.isVisible()) await password.fill('');
    await browser.close();
  }
})().catch(error=>{console.error('Protected login did not complete at: '+stage+' ('+error.name+')');console.error(String(error.message).split('\n')[0].replace(/https?:\/\/\S+/g,'[URL]').replace(/wss?:\/\/\S+/g,'[WebSocket URL]').split(process.env.SEESAW_PASSWORD||'NEVER_MATCH').join('[protected]'));process.exitCode=1;});
