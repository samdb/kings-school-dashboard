'use strict';
// Network-only: do not cache private documents or show stale school arrangements offline.
self.addEventListener('install', event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event=>event.waitUntil(self.clients.claim()));
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
