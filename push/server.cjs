'use strict';
// Serves ONLY the approved public snapshot. Never imports the Gmail application.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const webpush=require('web-push');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function save(file,value) {
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  const tmp=file+'.tmp'; const fd=fs.openSync(tmp,'w',0o600);
  try {fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  fs.renameSync(tmp,file);
}
function versions(feed, today=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/London'})) {
  const result={};
  for(const item of feed.items) {
    if(item.subject.startsWith('Past event:') || item.expires_on && item.expires_on<today || item.event_on && (item.event_end_on||item.event_on)<today) continue;
    const fields=[item.subject,item.excerpt,item.points||[],item.event_on||null,item.tags||[],item.links||[]];
    if(item.images?.length || item.teacher_comment) fields.push(item.images||[],item.teacher_comment||'');
    if(item.event_end_on) fields.push(item.event_end_on);
    result[item.key]=sha(JSON.stringify(fields));
  }
  return result;
}
function reconcile(state,feed,today) {
  const current=versions(feed,today);
  const changed=state.versions ? Object.keys(current).filter(k=>state.versions[k]!==current[k]) : [];
  for(const device of Object.values(state.devices)) {
    for(const key of Object.keys(device.pending)) if(!current[key]) delete device.pending[key];
    for(const key of changed) device.pending[key]=current[key];
    if(changed.length) {device.needsSend=true;device.nextAttempt=0;}
  }
  state.versions=current;state.revision=feed.revision;
  return changed;
}
function validateSubscription(sub) {
  if(!sub || typeof sub.endpoint!=='string' || sub.endpoint.length>2048 || !sub.keys) throw Error('Invalid subscription');
  const url=new URL(sub.endpoint);
  const host=url.hostname;
  const allowed=host==='web.push.apple.com' || host==='fcm.googleapis.com' || host==='updates.push.services.mozilla.com' || /^[a-z0-9-]+\.push\.services\.mozilla\.com$/.test(host);
  if(url.protocol!=='https:' || url.port || url.username || url.password || url.hash || !allowed) throw Error('Invalid push endpoint');
  if(typeof sub.keys.p256dh!=='string' || !/^[A-Za-z0-9_-]{87}=?$/.test(sub.keys.p256dh) || Buffer.from(sub.keys.p256dh,'base64url').length!==65 || Buffer.from(sub.keys.p256dh,'base64url')[0]!==4) throw Error('Invalid public key');
  if(typeof sub.keys.auth!=='string' || !/^[A-Za-z0-9_-]{22}(==)?$/.test(sub.keys.auth) || Buffer.from(sub.keys.auth,'base64url').length!==16) throw Error('Invalid auth key');
  return {endpoint:sub.endpoint,keys:{p256dh:sub.keys.p256dh,auth:sub.keys.auth}};
}
function createApp(options={}) {
  const docs=options.docs || process.env.KINGS_PUBLIC_DIR || path.resolve(__dirname,'../docs');
  const data=options.data || process.env.KINGS_PUSH_DATA || path.resolve(__dirname,'../data/push');
  const origin=options.origin || 'https://agents.victorgroup.co.uk';
  const prefix='/school/';
  fs.mkdirSync(data,{recursive:true,mode:0o700});
  const keysFile=path.join(data,'vapid.json');
  if(!fs.existsSync(keysFile)) save(keysFile,webpush.generateVAPIDKeys());
  const keys=JSON.parse(fs.readFileSync(keysFile));
  const stateFile=path.join(data,'state.json');
  const state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)): {devices:{}};
  const persist=()=>save(stateFile,state);
  const send=options.send || ((subscription,payload)=>webpush.sendNotification(subscription,JSON.stringify(payload),{
    vapidDetails:{subject:'mailto:sam@victorgroup.co.uk',publicKey:keys.publicKey,privateKey:keys.privateKey},
    TTL:86400,urgency:'normal',timeout:10000,topic:payload.test?'school-test':'school-updates'
  }));
  const readFeed=()=>JSON.parse(fs.readFileSync(path.join(docs,'feed.json')));
  const refresh=()=>{reconcile(state,readFeed());persist();};
  refresh();
  let busy=false;
  async function tick() {
    if(busy) return;
    busy=true;
    try {
      refresh();
      for(const [id,device] of Object.entries(state.devices)) {
        if(!device.needsSend || device.nextAttempt>Date.now()) continue;
        if(!Object.keys(device.pending).length){device.needsSend=false;continue;}
        const fingerprint=JSON.stringify(device.pending);
        try {
          await send(device.subscription,{count:Object.keys(device.pending).length});
          if(state.devices[id]===device && fingerprint===JSON.stringify(device.pending)) {device.needsSend=false;device.failures=0;}
        } catch(error) {
          if([404,410].includes(error.statusCode)) delete state.devices[id];
          else {device.failures=(device.failures||0)+1;device.nextAttempt=Date.now()+Math.min(3600000,60000*2**Math.min(device.failures,6));}
        }
        persist();
      }
      persist();
    } finally {busy=false;}
  }
  const limit=new Map();
  function limited(key,max) {
    const now=Date.now();
    for(const [k,v] of limit) if(v.until<now) limit.delete(k);
    const v=limit.get(key)||{n:0,until:now+3600000};v.n++;limit.set(key,v);return v.n>max;
  }
  const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.webmanifest':'application/manifest+json'};
  const files=new Set(['index.html','app.css','app.js','snapshot.js','pwa.js','sw.js','manifest.webmanifest','feed.json','favicon.svg','school-logo.svg','icon-192.png','icon-512.png','apple-touch-icon.png']);
  async function body(req) {
    let buffer='';
    for await(const chunk of req) {buffer+=chunk;if(Buffer.byteLength(buffer)>12000) throw Error('Request too large');}
    return JSON.parse(buffer);
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'");
    const reply=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    try {
      const url=new URL(req.url,origin);
      if(!url.pathname.startsWith(prefix)) return reply(404,{error:'Not found'});
      const route=url.pathname.slice(prefix.length);
      if(!route.startsWith('api/')) {
        if(!['GET','HEAD'].includes(req.method)) return reply(405,{error:'Method not allowed'});
        const name=route||'index.html';
        const approvedImage=/^media\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(name) && readFeed().items.some(item=>(item.images||[]).some(image=>image.src===name));
        if(!files.has(name) && !approvedImage) return reply(404,{error:'Not found'});
        const content=fs.readFileSync(path.join(docs,name));
        res.writeHead(200,{'Content-Type':types[path.extname(name)]||'application/octet-stream'});
        return res.end(req.method==='HEAD'?undefined:content);
      }
      const token=(req.headers.cookie||'').match(/(?:^|;\s*)kings_device=([a-f0-9]{64})(?:;|$)/)?.[1];
      const id=token?sha(token):null;
      const device=id?state.devices[id]:null;
      const info=()=>({publicKey:keys.publicKey,enabled:!!device,count:device?Object.keys(device.pending).length:0,revision:state.revision});
      if(route==='api/status' && req.method==='GET') return reply(200,info());
      if(req.method!=='POST') return reply(405,{error:'Method not allowed'});
      if(req.headers.origin!==origin || req.headers['content-type']?.split(';')[0]!=='application/json') return reply(403,{error:'Origin or content type refused'});
      // Caddy overwrites this header; the server listens only on loopback.
      const ip=req.headers['x-real-ip'] || req.socket.remoteAddress;
      if(limited('all:'+ip,240)) return reply(429,{error:'Too many requests'});
      const input=await body(req);
      if(route==='api/subscribe') {
        if(limited('subscribe:'+ip,20)) return reply(429,{error:'Too many subscriptions'});
        const subscription=validateSubscription(input.subscription);
        const existing=Object.entries(state.devices).find(([,d])=>d.subscription.endpoint===subscription.endpoint);
        // Full browser subscription keys are a capability; endpoint alone cannot reclaim a device.
        if(existing && JSON.stringify(existing[1].subscription)!==JSON.stringify(subscription)) return reply(409,{error:'Subscription conflict'});
        if(!existing && !device && Object.keys(state.devices).length>=20) return reply(429,{error:'Device limit reached'});
        refresh();
        const freshToken=crypto.randomBytes(32).toString('hex');
        const record=existing?.[1] || device || {pending:{},needsSend:false};
        if(existing) delete state.devices[existing[0]];
        if(id) delete state.devices[id];
        state.devices[sha(freshToken)]={...record,subscription};persist();
        res.setHeader('Set-Cookie',`kings_device=${freshToken}; Path=/school/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000`);
        return reply(200,{publicKey:keys.publicKey,enabled:true,count:Object.keys(record.pending).length});
      }
      if(!device) return reply(401,{error:'This device is not subscribed'});
      if(route==='api/seen') {
        refresh();
        if(input.revision!==state.revision) return reply(200,{seen:false});
        device.pending={};device.needsSend=false;persist();return reply(200,{seen:true});
      }
      if(route==='api/unsubscribe') {
        delete state.devices[id];persist();
        res.setHeader('Set-Cookie','kings_device=; Path=/school/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
        return reply(200,{enabled:false});
      }
      if(route==='api/test') {
        if(limited('test:'+id,5)) return reply(429,{error:'Test limit reached'});
        try {await send(device.subscription,{test:true,count:Object.keys(device.pending).length});return reply(200,{sent:true});}
        catch(error) {if([404,410].includes(error.statusCode)){delete state.devices[id];persist();}return reply(502,{error:'Push service did not accept notification'});}
      }
      return reply(404,{error:'Not found'});
    } catch {return reply(400,{error:'Request could not be completed'});}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return {server,tick,state};
}
if(require.main===module) {
  const app=createApp();
  app.server.listen(Number(process.env.KINGS_PUSH_PORT||8767),'127.0.0.1',()=>console.log('School app listening on loopback'));
  const timer=setInterval(()=>app.tick().catch(()=>console.error('Publication check failed; retaining prior notification state')),60000);
  timer.unref();app.tick().catch(()=>console.error('Initial publication check failed'));
}
module.exports={createApp,reconcile,versions,validateSubscription};
