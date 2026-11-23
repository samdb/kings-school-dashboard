/* Opt-in notifications. No task state, third-party scripts or analytics. */
(async function () {
  'use strict';
  const status = document.getElementById('notification-status');
  const enable = document.getElementById('enable-notifications');
  const disable = document.getElementById('disable-notifications');
  const test = document.getElementById('test-notifications');
  const base = new URL('./', location.href);
  const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (location.hostname === 'samdb.github.io') {
    document.getElementById('app-link').hidden = false;
    status.textContent = 'Use the app version for notifications and Home Screen badges.';
    return;
  }
  if (!('serviceWorker' in navigator)) { status.textContent = 'This browser does not support Home Screen notifications.'; return; }
  let registration, config;
  async function api(path, data) {
    const response = await fetch(new URL('api/' + path, base), {credentials:'same-origin', cache:'no-store',
      ...(data === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)})});
    if (!response.ok) throw new Error(response.status === 429 ? 'Please wait a moment and try again.' : 'Could not save notification settings. Please try again.');
    return response.json();
  }
  async function seen() {
    if (!window.schoolRenderedRevision || document.visibilityState !== 'visible' || !config?.enabled) return;
    try {
      const result = await api('seen', {revision:window.schoolRenderedRevision});
      if (result.seen && 'clearAppBadge' in navigator) await navigator.clearAppBadge();
      if (result.seen) (await registration.getNotifications()).forEach(n=>n.close());
    } catch { /* Keep the badge if the rendered page cannot be acknowledged. */ }
  }
  function controls(enabled) {
    enable.hidden = enabled; disable.hidden = !enabled; test.hidden = !enabled;
    status.textContent = enabled ? 'Notifications are on. The badge counts updates since you last opened the app.' : 'Get a notification and badge when new school updates are published.';
  }
  function keyBytes(value) {
    const decoded=atob(value.replace(/-/g,'+').replace(/_/g,'/'));
    return Uint8Array.from(decoded, c=>c.charCodeAt(0));
  }
  try {
    registration = await navigator.serviceWorker.register(new URL('sw.js',base), {scope:base.pathname, updateViaCache:'none'});
    await navigator.serviceWorker.ready;
    if (appleMobile && !standalone) {
      status.textContent = 'After adding it, open the Home Screen icon to enable notifications.';
      return;
    }
    if (!('PushManager' in window) || !('Notification' in window)) {
      status.textContent = 'Notifications need a supported browser. On iPhone, use iOS 16.4 or later and open the Home Screen app.';
      return;
    }
    if (standalone) document.getElementById('install-help').hidden = true;
    config = await api('status');
    let sub = await registration.pushManager.getSubscription();
    if (sub && Notification.permission === 'granted' && !config.enabled) {
      config = await api('subscribe', {subscription:sub.toJSON()});
    }
    controls(config.enabled && !!sub && Notification.permission === 'granted');
    if (Notification.permission === 'denied') {
      status.textContent = 'Notifications are blocked. You can allow them in your device’s notification settings.';
      enable.hidden = true;
    }
    window.addEventListener('school-rendered', seen);
    document.addEventListener('visibilitychange', ()=>{
      if (document.visibilityState === 'visible') {
        // Refresh a suspended app before clearing any badge for newer notices.
        fetch(new URL('feed.json',base),{cache:'no-store'}).then(r=>r.json()).then(feed=>{
          if(feed.revision !== window.schoolRenderedRevision) location.reload(); else seen();
        }).catch(()=>{});
      }
    });
    await seen();
    enable.addEventListener('click', async()=>{
      enable.disabled=true;
      try {
        // Permission prompt must be directly within the user's tap, before network work.
        const permission = await Notification.requestPermission();
        if(permission !== 'granted') {status.textContent='Notifications were not enabled. You can change this in device settings.'; return;}
        sub = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(config.publicKey)});
        config = await api('subscribe',{subscription:sub.toJSON()}); controls(true); await seen();
      } catch(error) {status.textContent=error.message;} finally {enable.disabled=false;}
    });
    disable.addEventListener('click', async()=>{
      disable.disabled=true;
      try {
        await api('unsubscribe',{});
        if(sub) await sub.unsubscribe();
        config.enabled=false; controls(false);
        if('clearAppBadge' in navigator) await navigator.clearAppBadge();
      } catch(error) {status.textContent=error.message;} finally {disable.disabled=false;}
    });
    test.addEventListener('click', async()=>{
      test.disabled=true;
      try {await api('test',{});status.textContent='Test sent. Check your notifications.';}
      catch(error) {status.textContent=error.message;} finally {test.disabled=false;}
    });
  } catch { status.textContent='Notifications are temporarily unavailable. School updates are still readable.'; }
})();
