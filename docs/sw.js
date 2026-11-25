'use strict';
// Generated, exact allowlist of public page assets. APIs and private documents stay network-only.
const RELEASE="f853e9a1cf451878f2fb";
const ASSETS={"index.html": "f33eb8c2ac5129f1e8e3f008de7e2bd55e988b8046855550e2a6da531cfde6cb", "manifest.webmanifest": "634d4518f29d903a8c8aebbb512f63efc162214966ed9f16928080f921dd7542", "favicon.svg": "0b207d3e79fd89cbc1ce137be6929848bde41b9dc6d0ef397c583a30b3a8d60c", "school-logo.svg": "4764d3cd5f4b9a009d2a268eafbc4b2236182c460eb2f45316f8191653bad679", "icon-192.png?v=shield-1": "19b9b310fed7c667ec657eb1af1f6cf17b80e169b6a07942c5d636aaceae5bfa", "icon-512.png?v=shield-1": "ac4a1abbfd89436a3590c2783b0a98d8757ef22c2b1919d516b3f308e0d310d3", "apple-touch-icon.png?v=shield-1": "5c274c0a2ef92375640a5afe87b0ee42dfaacfe223a31cb386a2b092c3b47a7d", "app.css?v=10ac2fbc96f7": "10ac2fbc96f7e65f7e2de2c4f6cb721e948645eb0986b744e5832903a9c60b6f", "snapshot.js?v=a6d00ff41b3d": "a6d00ff41b3d051c9f15fc405e807d946166bf79d3cf7aa11997d618fecbda7b", "app.js?v=ac5cac535b62": "ac5cac535b626f002bdde0e0a826376552894e229c028b4ab60a9450bf8d973b", "pwa.js?v=c29c74e47860": "c29c74e47860e95ab264a51daba5ae947ebe98b0156ac728a4b5bcba67d69912"};
const MEDIA=["media/827905f99831faad0b4abb87bb0b615511dfa69195d3a5c116d9ce563823369c.png", "media/e1a8b8a32e06887aedb06bd4dc580407fd2b084bc0c8bbfafdd68c8b642de3ee.jpg", "media/fd7a19bc34b1a89c72c48636c7dde2eab9b9d10126d7c85db11890d3aacb4437.jpg"];
const prefix='school-shell:'+self.registration.scope+':';
const cacheName=prefix+RELEASE;
const absolute=name=>new URL(name,self.registration.scope).href;
const core=new Set(Object.keys(ASSETS).map(absolute));
const media=new Set(MEDIA.map(absolute));
async function checkedAsset(name,hash) {
  const response=await fetch(absolute(name),{cache:'no-store'});
  if(!response.ok)throw Error('Asset unavailable');
  const digest=await crypto.subtle.digest('SHA-256',await response.clone().arrayBuffer());
  const actual=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  if(actual!==hash)throw Error('Publication changed during download');
  return response;
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
  // Fetch and verify a coherent release before making it available offline.
  const entries=await Promise.all(Object.entries(ASSETS).map(async([name,hash])=>[absolute(name),await checkedAsset(name,hash)]));
  const cache=await caches.open(cacheName);
  await Promise.all(entries.map(([url,response])=>cache.put(url,response)));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  // Keep one previous release for already-open tabs; never touch other apps' caches.
  const old=(await caches.keys()).filter(name=>name.startsWith(prefix)&&name!==cacheName);
  await Promise.all(old.slice(0,-1).map(name=>caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  const home=new URL(self.registration.scope);
  if(request.mode==='navigate' && (url.pathname===home.pathname||url.pathname===home.pathname+'index.html')) {
    event.respondWith((async()=>await (await caches.open(cacheName)).match(absolute('index.html'))||fetch(request))());
    return;
  }
  // feed.json deliberately bypasses caches: only a successful live check can clear a badge.
  if(!core.has(url.href)&&!media.has(url.href))return;
  event.respondWith((async()=>{
    const cache=await caches.open(cacheName);
    const saved=await cache.match(request);
    if(saved)return saved;
    const response=await fetch(request);
    if(response.ok && media.has(url.href)) {
      try {await cache.put(request,response.clone());}catch{}
    }
    return response;
  })());
});
self.addEventListener('push', event=>{
  event.waitUntil((async()=>{
    let data={};
    try {data=event.data?.json() || {};} catch {}
    const category=data.category==='grades'?'grades':'events';
    let count=Number.isSafeInteger(data.count) && data.count>0 ? data.count : 0;
    try {
      const response=await fetch(new URL('api/status',self.registration.scope),{credentials:'same-origin',cache:'no-store'});
      if(response.ok) {const current=await response.json(); if(current.enabled) count=current.count;}
    } catch {}
    // Every push displays a notification; iOS does not permit silent badge pushes.
    await self.registration.showNotification(data.test ? (category==='grades'?'Schoolwork notification test':'Event notification test') : (category==='grades'?'New schoolwork & marks':'New school events'),{
      // A user-requested test may include a result; routine alerts remain generic.
      body:data.test===true && typeof data.body==='string' && data.body.trim()
        ? data.body.trim().slice(0,240)
        : (category==='grades'?'Open Schoolwork & grades to see the update.':'Open Upcoming to see the update.'),
      icon:new URL('icon-192.png?v=shield-1',self.registration.scope).href,
      tag:(data.test?'school-test-':'school-')+category,
      data:{category}
    });
    if('setAppBadge' in self.navigator) {
      try {if(count) await self.navigator.setAppBadge(count); else await self.navigator.clearAppBadge();} catch {}
    }
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    // Never follow a payload-supplied URL: only these two in-app destinations.
    const category=event.notification.data?.category==='grades'?'grades':'events';
    const url=new URL(category==='grades'?'#grades':'#upcoming',self.registration.scope).href;
    for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})) {
      if(client.url.startsWith(self.registration.scope)) {
        try {await client.navigate(url);return await client.focus();}catch{}
      }
    }
    return self.clients.openWindow(url);
  })());
});
