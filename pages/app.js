/* Read-only school information. No saved state or task controls. */
(function () {
  'use strict';
  const dateFormat = new Intl.DateTimeFormat('en-GB', {day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'});
  const eventFormat = new Intl.DateTimeFormat('en-GB', {weekday:'long',day:'numeric',month:'long',timeZone:'Europe/London'});
  function node(tag, cls, text) {const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;}
  function card(item) {
    const article=node('article','card');article.dataset.key=item.key;
    if(item.event_on) {
      const time=node('time','event-date',eventFormat.format(new Date(item.event_on+'T12:00:00Z')));
      time.dateTime=item.event_on;article.append(time);
    }
    article.append(node('h3','',item.subject.startsWith('School newsletter') ? 'School newsletter' : item.subject),node('p','',item.excerpt));
    if(item.points?.length) {
      const list=node('ul','summary-points');
      item.points.forEach(text=>list.append(node('li','',text)));article.append(list);
    }
    for(const link of item.links||[]) {
      if(!/^https:\/\/(kings-rochester\.co\.uk|mcusercontent\.com)\//.test(link.url))continue;
      const a=node('a','text-link',link.label+' ↗');a.href=link.url;a.target='_blank';a.rel='noopener noreferrer';
      const row=node('div','card-actions');row.append(a);article.append(row);
    }
    if(/^https:\/\/mail\.google\.com\//.test(item.source_url||'')) {
      const source=node('a','text-link','Read the school email ↗');source.href=item.source_url;source.target='_blank';source.rel='noopener noreferrer';
      source.setAttribute('aria-label','Read the school email: '+item.subject+' (opens Gmail)');
      const links=node('div','card-actions');links.append(source);article.append(links);
    }
    const note=node('p','source-note','Notice received ');
    const received=node('time','',dateFormat.format(new Date(item.received_at)));
    received.dateTime=item.received_at;note.append(received);article.append(note);
    return article;
  }
  window.schoolSnapshotApi('/api/feed').then(feed=>{
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/London'});
    const items=feed.items.filter(item=>!item.subject.startsWith('Past event:') && (!item.expires_on || item.expires_on>=today) && (!item.event_on || item.event_on>=today));
    const upcoming=items.filter(item=>item.event_on).sort((a,b)=>a.event_on.localeCompare(b.event_on)||a.subject.localeCompare(b.subject));
    const information=items.filter(item=>!item.event_on).sort((a,b)=>a.subject.localeCompare(b.subject));
    document.getElementById('coverage-note').textContent=feed.coverage_text;
    document.getElementById('result-count').textContent='';
    document.getElementById('feed').replaceChildren(...(upcoming.length ? upcoming.map(card) : [node('p','update-note','No upcoming dated notices have been reviewed yet.')]));
    document.getElementById('information-feed').replaceChildren(...information.map(card));
    document.getElementById('information').hidden=!information.length;
    document.getElementById('snapshot-date').textContent='Updated '+dateFormat.format(new Date(feed.generated_at))+'.';
    const choir=feed.items.find(i=>i.key==='89c519e060d4934a0be6dd5d');
    if(choir&&/^https:\/\/mail\.google\.com\//.test(choir.source_url||'')){const link=document.getElementById('choir-source');link.href=choir.source_url;link.hidden=false;}
  }).catch(()=>{document.getElementById('feed').textContent='School updates could not load.';});
})();
