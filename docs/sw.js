'use strict';
// Generated, exact allowlist of public page assets. APIs and private documents stay network-only.
const RELEASE="b530407149050e24fec2";
const ASSETS={"index.html": "27570e38b295f0c2ed95c08498f1dcf312a8b62174196178a2630d19948ab2ed", "manifest.webmanifest": "634d4518f29d903a8c8aebbb512f63efc162214966ed9f16928080f921dd7542", "favicon.svg": "0b207d3e79fd89cbc1ce137be6929848bde41b9dc6d0ef397c583a30b3a8d60c", "school-logo.svg": "4764d3cd5f4b9a009d2a268eafbc4b2236182c460eb2f45316f8191653bad679", "icon-192.png?v=shield-1": "19b9b310fed7c667ec657eb1af1f6cf17b80e169b6a07942c5d636aaceae5bfa", "icon-512.png?v=shield-1": "ac4a1abbfd89436a3590c2783b0a98d8757ef22c2b1919d516b3f308e0d310d3", "apple-touch-icon.png?v=shield-1": "5c274c0a2ef92375640a5afe87b0ee42dfaacfe223a31cb386a2b092c3b47a7d", "app.css?v=12061d9d7345": "12061d9d7345ab51af286f8cbfb5c284e0cce5e479e615085c68d27a0efe9f4c", "snapshot.js?v=ac5dc48d3583": "ac5dc48d3583c65c9f39ba2768c9a7cb8d7135071436e3927e47a8ecde86aea9", "app.js?v=807ca3a11301": "807ca3a11301706c3b2df9139d5ba1dc8a1492a6d4ca5e04207e9d55c0776804", "pwa.js?v=f3943ee8697a": "f3943ee8697aab4e8695284e0f770c496e4c80da67123d59bd3e8e2365ef9459"};
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
    let count=Number.isSafeInteger(data.count) && data.count>0 ? data.count : 0;
    try {
      const response=await fetch(new URL('api/status',self.registration.scope),{credentials:'same-origin',cache:'no-store'});
      if(response.ok) {const current=await response.json(); if(current.enabled) count=current.count;}
    } catch {}
    // Every push displays a notification; iOS does not permit silent badge pushes.
    await self.registration.showNotification(data.test ? 'School notifications are on' : 'New school updates',{
      body:data.test ? 'Your Home Screen app is ready to receive school updates.' : 'Open the app to read the latest school information.',
      icon:new URL('icon-192.png?v=shield-1',self.registration.scope).href,
      tag:data.test ? 'school-test' : 'school-updates',
      data:{url:self.registration.scope}
    });
    if('setAppBadge' in self.navigator) {
      try {if(count) await self.navigator.setAppBadge(count); else await self.navigator.clearAppBadge();} catch {}
    }
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const url=self.registration.scope;
    for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})) {
      if(client.url.startsWith(url)) {await client.navigate(url);return client.focus();}
    }
    return self.clients.openWindow(url);
  })());
});
