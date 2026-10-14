/* Published family desk. Reviewed summaries only; no raw email HTML. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let feed, view = 'current', query = '', limit = 6, noticeTimer;
  const dateFormat = new Intl.DateTimeFormat('en-GB', {day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'});
  const isPast = item => item.subject.startsWith('Past event:');
  const archived = item => isPast(item) || item.mark.done || item.mark.dismissed;
  const newsletter = item => item.subject.startsWith('School newsletter');
  function node(tag, cls, text) {const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;}
  function sourceLink(item, text) {const a=node('a','',text);if(!/^https:\/\/mail\.google\.com\//.test(item.source_url||''))return null;a.href=item.source_url;a.target='_blank';a.rel='noopener noreferrer';a.setAttribute('aria-label',text+' — '+item.subject+' (opens Gmail)');return a;}
  function notice(text, undo) {clearTimeout(noticeTimer);const box=$('notice');box.replaceChildren(document.createTextNode(text));box.hidden=false;if(undo){const b=node('button','', 'Undo');b.onclick=()=>{undo();box.hidden=true;};box.append(b);}noticeTimer=setTimeout(()=>box.hidden=true,10000);}
  async function mark(item, changes) {try {const result=await window.schoolSnapshotApi('/api/marks',{key:item.key,changes});Object.assign(item.mark,result.mark);render();return true;}catch(e){notice('Couldn’t save that change. '+e.message);return false;}}
  function card(item) {
    const article=node('article','card');article.dataset.key=item.key;
    const top=node('div','card-top');let label=newsletter(item)?'NEWSLETTER':item.match.direct?'FOR BLAKE':item.match.year_match?'YEAR 3':'SCHOOL NOTICE';if(isPast(item))label='PAST EVENT';
    top.append(node('span','label',label));const time=node('time','',dateFormat.format(new Date(item.received_at)));time.dateTime=item.received_at;time.title='Email received';top.append(time);article.append(top);
    article.append(node('h3','',newsletter(item) ? 'School newsletter · '+dateFormat.format(new Date(item.received_at)) : item.subject.replace(/^Past event: /,'')),node('p','',item.excerpt));
    if(item.attachments_skipped)article.append(node('p','attachment','Attachment in source email · not yet summarised'));
    const actions=node('div','card-actions');const source=sourceLink(item,'Open email ↗');if(source)actions.append(source);
    const save=node('button','',item.mark.saved?'Saved':'Save');save.type='button';save.setAttribute('aria-pressed',String(!!item.mark.saved));save.setAttribute('aria-label',(item.mark.saved?'Unsave':'Save')+' '+item.subject);save.onclick=async()=>{save.disabled=true;await mark(item,{saved:!item.mark.saved});save.disabled=false;};actions.append(save);
    if(!isPast(item)){const hidden=!!(item.mark.done||item.mark.dismissed);const archive=node('button','',hidden?'Restore':'Archive');archive.type='button';archive.setAttribute('aria-label',(hidden?'Restore':'Archive')+' '+item.subject);archive.onclick=async()=>{const previous={done:!!item.mark.done,dismissed:!!item.mark.dismissed};archive.disabled=true;if(await mark(item,{done:false,dismissed:!hidden}))notice(hidden?'Update restored.':'Moved to Archive.',()=>mark(item,previous));archive.disabled=false;};actions.append(archive);}
    article.append(actions);return article;
  }
  function render(){
    if(!feed)return;
    const items=feed.items.filter(item=>{
      if(view==='archive'){if(!archived(item))return false;}
      else if(view==='saved'){if(!item.mark.saved)return false;}
      else {if(archived(item))return false;if(view==='child'&&!item.match.direct&&!item.match.year_match)return false;if(view==='news'&&!newsletter(item))return false;}
      const hay=(item.subject+' '+item.excerpt).toLowerCase();return query.toLowerCase().split(/\s+/).filter(Boolean).every(t=>hay.includes(t));
    }).sort((a,b)=>b.received_at.localeCompare(a.received_at));
    $('result-count').textContent=items.length+' update'+(items.length===1?'':'s');
    const cards=items.slice(0,limit).map(card);if(items.length>limit){const more=node('button','load-more','Show more updates ('+(items.length-limit)+')');more.type='button';more.onclick=()=>{limit+=6;render();};cards.push(more);}if(!cards.length){const empty=node('div','empty');empty.append(node('h3','',view==='saved'?'Nothing saved yet':'No updates here'),node('p','',query?'Try a different search.':view==='saved'?'Use Save on an update to keep it here.':'Try another view or search.'));cards.push(empty);}
    $('feed').replaceChildren(...cards);
  }
  document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{view=button.dataset.view;limit=6;document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();});
  $('search').oninput=e=>{query=e.target.value.trim();limit=6;render();};
  window.schoolSnapshotApi('/api/feed').then(data=>{feed=data;$('snapshot-date').textContent='Emails last imported '+dateFormat.format(new Date(feed.last_successful_refresh))+'.';$('coverage-text').textContent=feed.coverage_text;const choir=feed.items.find(i=>i.key==='89c519e060d4934a0be6dd5d');if(choir&&/^https:\/\/mail\.google\.com\//.test(choir.source_url)){$('choir-source').href=choir.source_url;$('choir-source').hidden=false;}render();}).catch(()=>{$('feed').textContent='School updates could not load. Please reload the page.';});
})();
