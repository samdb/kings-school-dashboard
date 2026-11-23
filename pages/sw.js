'use strict';
// Generated, exact allowlist of public page assets. APIs and private documents stay network-only.
const RELEASE=/* SCHOOL_RELEASE */ "development";
const ASSETS=/* SCHOOL_ASSETS */ {};
const MEDIA=/* SCHOOL_MEDIA */ [];
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
