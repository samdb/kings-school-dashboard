'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const crypto=require('node:crypto');
const {createApp,reconcile,validateSubscription}=require('../push/server.cjs');
const item=(key,excerpt='School update')=>({key,subject:'Event '+key,excerpt,event_on:'2099-12-01'});
const feed=(revision,items)=>({revision,items});
function sub() {const e=crypto.createECDH('prime256v1');e.generateKeys();return {endpoint:'https://web.push.apple.com/'+crypto.randomBytes(12).toString('hex'),keys:{p256dh:e.getPublicKey().toString('base64url'),auth:crypto.randomBytes(16).toString('base64url')}};}
test('baseline, metadata-only rebuild, changes, removal and accumulated badge counts',()=>{
 const state={devices:{d:{pending:{},needsSend:false}}};
 assert.deepEqual(reconcile(state,feed('a',[item('a')]),'2026-11-23'),[]);
 assert.deepEqual(reconcile(state,feed('b',[{...item('a'),reviewed_on:'2026-11-24'}]),'2026-11-24'),[]);
 assert.deepEqual(reconcile(state,feed('c',[item('a','Changed'),item('b')]),'2026-11-24'),['a','b']);
 assert.equal(Object.keys(state.devices.d.pending).length,2);
 reconcile(state,feed('d',[item('b')]),'2026-11-24');assert.deepEqual(Object.keys(state.devices.d.pending),['b']);
 const state2={devices:{}};reconcile(state2,feed('a',[{...item('past'),event_on:'2026-11-20'}]),'2026-11-23');assert.deepEqual(state2.versions,{});
});
test('push endpoints reject SSRF, credentials, ports, and malformed keys',()=>{
 const good=sub();assert.deepEqual(validateSubscription(good),good);
 for(const endpoint of ['http://web.push.apple.com/a','https://127.0.0.1/a','https://web.push.apple.com.evil.test/a','https://a@web.push.apple.com/a','https://web.push.apple.com:444/a','https://web.push.apple.com/a#x']) {
  assert.throws(()=>validateSubscription({...good,endpoint}));
 }
 assert.throws(()=>validateSubscription({...good,keys:{p256dh:'bad',auth:'bad'}}));
});
test('image and teacher-note changes notify while unchanged publications do not',()=>{
 const state={devices:{d:{pending:{},needsSend:false}}};
 reconcile(state,feed('a',[item('a')]),'2026-11-23');
 const updated={...item('a'),teacher_comment:'Your child is narrating.'};
 assert.deepEqual(reconcile(state,feed('b',[updated]),'2026-11-23'),['a']);
 assert.deepEqual(reconcile(state,feed('c',[updated]),'2026-11-23'),[]);
 assert.deepEqual(reconcile(state,feed('d',[{...updated,images:[{src:'media/'+ 'a'.repeat(64)+'.png'}]}]),'2026-11-23'),['a']);
});
async function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'school-push-test-'));const docs=path.join(root,'docs');fs.mkdirSync(docs);
 fs.writeFileSync(path.join(docs,'index.html'),'public');const update=value=>fs.writeFileSync(path.join(docs,'feed.json'),JSON.stringify(value));update(feed('a',[item('a')]));
 const sent=[];let fail;
 const app=createApp({docs,data:path.join(root,'private'),origin:'https://example.test',send:async(s,p)=>{const error=typeof fail==='function'?fail(p):fail;if(error)throw error;sent.push(p);}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
 const url='http://127.0.0.1:'+app.server.address().port;
 const request=(route,data,cookie='',origin='https://example.test')=>fetch(url+'/school/'+route,{method:data===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:data===undefined?undefined:JSON.stringify(data)});
 const subscription=sub();const response=await request('api/subscribe',{subscription});assert.equal(response.status,200);
 const cookie=response.headers.get('set-cookie').split(';')[0];
 return {app,request,cookie,subscription,sent,update,root,setFail:value=>{fail=value;}};
}
test('HTTP guards, opt-in, stale-page ack, valid ack, unsubscribe and file boundary',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('api/seen',{revision:'a'},f.cookie,'https://evil.test')).status,403);
 assert.equal((await f.request('api/unsubscribe',{})).status,401);
 assert.equal((await f.request('data/state.json')).status,404);
 assert.equal((await f.request('')).status,200);
 f.update(feed('b',[item('a'),item('b')]));await f.app.tick();assert.equal(f.sent.length,1);assert.equal(f.sent[0].count,1);
 await f.app.tick();assert.equal(f.sent.length,1,'no duplicate delivery on unchanged publication');
 assert.equal((await (await f.request('api/seen',{revision:'a'},f.cookie)).json()).seen,false);
 assert.equal((await (await f.request('api/status',undefined,f.cookie)).json()).count,1);
 assert.equal((await (await f.request('api/seen',{revision:'b',category:'events'},f.cookie)).json()).seen,true);
 assert.equal((await (await f.request('api/status',undefined,f.cookie)).json()).count,0);
 assert.equal((await f.request('api/test',{},f.cookie)).status,200);assert.equal(f.sent[1].test,true);
 assert.equal((await f.request('api/unsubscribe',{},f.cookie)).status,200);
 assert.equal((await (await f.request('api/status',undefined,f.cookie)).json()).enabled,false);
});
test('retry state persists, retry succeeds, expired subscriptions removed',async t=>{
 const f=await fixture(t);f.setFail({statusCode:503});f.update(feed('b',[item('a'),item('b')]));await f.app.tick();
 let d=Object.values(f.app.state.devices)[0];assert.equal(d.needsSend,true);assert(d.retries.events.nextAttempt>Date.now());
 const saved=JSON.parse(fs.readFileSync(path.join(f.root,'private/state.json')));assert.equal(Object.values(saved.devices)[0].needsSend,true);
 d.retries.events.nextAttempt=0;f.setFail(null);await f.app.tick();assert.equal(f.sent.length,1);assert.equal(d.needsSend,false);
 f.setFail({statusCode:410});f.update(feed('c',[item('a'),item('b'),item('c')]));await f.app.tick();assert.equal(Object.keys(f.app.state.devices).length,0);
});
test('only images referenced by the current approved feed are served',async t=>{
 const f=await fixture(t);const name='media/'+ 'a'.repeat(64)+'.png';
 fs.mkdirSync(path.join(f.root,'docs/media'));fs.writeFileSync(path.join(f.root,'docs',name),'approved');
 assert.equal((await f.request(name)).status,404);
 f.update(feed('b',[{...item('a'),images:[{src:name}]}]));
 const response=await f.request(name);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
 assert.equal((await f.request('media/'+ 'b'.repeat(64)+'.png')).status,404);
 assert.equal((await f.request('media/%2e%2e/data/reviews.json')).status,404);
 f.update(feed('c',[item('a')]));assert.equal((await f.request(name)).status,404);
});
test('same browser can recover session; knowing endpoint without correct keys cannot take over',async t=>{
 const f=await fixture(t);const response=await f.request('api/subscribe',{subscription:f.subscription});assert.equal(response.status,200);assert.equal(Object.keys(f.app.state.devices).length,1);
 const bad={...f.subscription,keys:sub().keys};assert.equal((await f.request('api/subscribe',{subscription:bad})).status,409);
});
test('service worker shows visible notification, gets current badge, and safely opens app',async()=>{
 const vm=require('node:vm');const handlers={};const notices=[];const badges=[];const opened=[];
 const self={registration:{scope:'https://example.test/school/',showNotification:async(...args)=>notices.push(args)},navigator:{setAppBadge:async n=>badges.push(n),clearAppBadge:async()=>badges.push(0)},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)},addEventListener:(name,fn)=>handlers[name]=fn};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../pages/sw.js'),'utf8'),{self,URL,fetch:async()=>({ok:true,json:async()=>({enabled:true,count:2})})});
 let work;handlers.push({data:{json:()=>({count:9,url:'https://evil.test'})},waitUntil:p=>work=p});await work;
 assert.equal(notices.length,1);assert.deepEqual(badges,[2]);
 handlers.notificationclick({notification:{close:()=>{}},waitUntil:p=>work=p});await work;assert.deepEqual(opened,['https://example.test/school/#upcoming']);
});

test('calendar ranges remain current through their end; archived events do not notify',()=>{
 const range={...item('half-term'),event_on:'2026-11-20',event_end_on:'2026-11-24',expires_on:'2026-11-24',kind:'term'};
 const state={devices:{d:{pending:{},needsSend:false}}};
 reconcile(state,feed('first',[range]),'2026-11-23');
 assert(state.versions['half-term']);
 const archived={...item('old-notice'),event_on:'2026-10-16'};
 assert.deepEqual(reconcile(state,feed('archive',[range,archived]),'2026-11-23'),[]);
 assert.deepEqual(reconcile(state,feed('ended',[range,archived]),'2026-11-25'),[]);
 assert.deepEqual(state.versions,{});
});

const work=(key,kind='grade')=>({key,kind,subject:'Private work title',excerpt:'Private marks',received_at:'2026-11-23'});
test('mixed changes send separate generic categories and only the viewed category is acknowledged',async t=>{
 const f=await fixture(t);
 f.update(feed('mixed',[item('a'),item('new-event'),work('mark'),work('ticks','work')]));
 await f.app.tick();assert.deepEqual(f.sent.map(p=>p.category),['grades','events']);
 assert.deepEqual(f.sent.map(p=>p.count),[3,3]);
 assert(!JSON.stringify(f.sent).includes('Private'));
 await f.app.tick();assert.equal(f.sent.length,2);
 const ack=async data=>(await (await f.request('api/seen',data,f.cookie)).json());
 assert.equal((await ack({revision:'mixed'})).seen,false,'old clients must not clear both categories');
 assert.equal((await ack({revision:'mixed',category:'invalid'})).seen,false);
 assert.equal((await ack({revision:'a',category:'grades'})).seen,false);
 let result=await ack({revision:'mixed',category:'grades'});
 assert.equal(result.seen,true);assert.equal(result.count,1);assert.deepEqual(result.categories,{grades:0,events:1});
 result=await ack({revision:'mixed',category:'events'});assert.equal(result.count,0);
 assert.equal((await f.request('api/test',{category:'grades'},f.cookie)).status,200);
 assert.equal(f.sent.at(-1).category,'grades');assert.equal(f.sent.at(-1).test,true);
 assert.equal((await f.request('api/test',{category:'outside'},f.cookie)).status,400);
});
test('one failed category retries across restart without resending the successful category',async t=>{
 const f=await fixture(t);f.setFail(p=>p.category==='events'?{statusCode:503}:null);
 f.update(feed('mixed',[item('a'),item('b'),work('mark')]));await f.app.tick();
 assert.deepEqual(f.sent.map(p=>p.category),['grades']);
 let d=Object.values(f.app.state.devices)[0];assert(d.retries.events.nextAttempt>Date.now());
 assert(d.delivered.mark);assert(!d.delivered.b);
 const resent=[];
 const restart=createApp({docs:path.join(f.root,'docs'),data:path.join(f.root,'private'),send:async(s,p)=>resent.push(p)});
 await restart.tick();assert.equal(resent.length,0);
 d=Object.values(restart.state.devices)[0];d.retries.events.nextAttempt=0;
 await restart.tick();assert.deepEqual(resent.map(p=>p.category),['events']);
 await restart.tick();assert.equal(resent.length,1);
 // Later marks do not resend already-delivered but unread events.
 f.update(feed('more',[item('a'),item('b'),work('mark'),work('mark2')]));await restart.tick();
 assert.deepEqual(resent.map(p=>p.category),['events','grades']);
});
test('migration preserves existing pending/delivery state and category-only corrections notify',()=>{
 const initial={devices:{}};const data=feed('same',[item('event'),work('mark')]);reconcile(initial,data);
 const versions={...initial.versions};
 const state={versions,revision:'same',devices:{sent:{pending:{...versions},needsSend:false},unsent:{pending:{...versions},needsSend:true,nextAttempt:123}}};
 assert.deepEqual(reconcile(state,data),[]);
 assert.equal(state.devices.sent.needsSend,false);assert.equal(state.devices.unsent.needsSend,true);
 assert.deepEqual(state.devices.sent.pending,versions);
 const changed=feed('kind',[item('event'),{...work('mark'),kind:'event'}]);
 assert.deepEqual(reconcile(state,changed),['mark']);assert.equal(state.devices.sent.needsSend,true);
});
test('notification categories use different tags and route both cold and existing clients safely',async()=>{
 const vm=require('node:vm');const handlers={};const notices=[];const opened=[];const navigated=[];let clients=[];
 const self={registration:{scope:'https://example.test/school/',showNotification:async(...n)=>notices.push(n)},navigator:{},clients:{matchAll:async()=>clients,openWindow:async u=>opened.push(u)},addEventListener:(name,fn)=>handlers[name]=fn};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../pages/sw.js'),'utf8'),{self,URL,fetch:async()=>{throw Error('offline');}});
 let work;
 for(const category of ['grades','events']) {
  handlers.push({data:{json:()=>({category,count:2,url:'https://evil.test'})},waitUntil:p=>work=p});await work;
  const [,notification]=notices.at(-1);
  handlers.notificationclick({notification:{...notification,close:()=>{}},waitUntil:p=>work=p});await work;
 }
 assert.deepEqual(notices.map(n=>n[1].tag),['school-grades','school-events']);
 assert.deepEqual(opened,['https://example.test/school/#grades','https://example.test/school/#upcoming']);
 let focused=0;clients=[{url:'https://example.test/school/#upcoming',navigate:async u=>navigated.push(u),focus:async()=>focused++}];
 handlers.notificationclick({notification:{data:{category:'grades',url:'https://evil.test'},close:()=>{}},waitUntil:p=>work=p});await work;
 assert.deepEqual(navigated,['https://example.test/school/#grades']);assert.equal(focused,1);
 clients=[{url:'https://example.test/school/#upcoming',navigate:async()=>{throw Error('closed');}}];
 handlers.notificationclick({notification:{data:{category:'grades'},close:()=>{}},waitUntil:p=>work=p});await work;
 assert.equal(opened.at(-1),'https://example.test/school/#grades');
 const result='Spelling · 19 November: 4/5 (“Good!”) and 5/5 (“Fab!”).';
 for(const payload of [
  {test:true,category:'grades',body:result},
  {category:'grades',body:result},
  {test:true,category:'grades',body:{invalid:true}},
  {test:true,category:'grades',body:'x'.repeat(300)}
 ]) {handlers.push({data:{json:()=>payload},waitUntil:p=>work=p});await work;}
 assert.deepEqual(notices.slice(-4).map(n=>n[1].body),[
  result,'Open Schoolwork & grades to see the update.',
  'Open Schoolwork & grades to see the update.','x'.repeat(240)
 ]);
 assert.equal(notices.at(-4)[1].data.category,'grades');
});
