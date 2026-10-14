/* Read-only school information. No saved state or task controls. */
(function () {
  'use strict';
  const dateFormat = new Intl.DateTimeFormat('en-GB', {day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'});
  function node(tag, cls, text) {const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;}
  function card(item) {
    const article=node('article','card');article.dataset.key=item.key;
    const time=node('time','',dateFormat.format(new Date(item.received_at)));time.dateTime=item.received_at;time.title='Email received';article.append(time);
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
    return article;
  }
  window.schoolSnapshotApi('/api/feed').then(feed=>{
    const items=feed.items.filter(item=>!item.subject.startsWith('Past event:')).sort((a,b)=>b.received_at.localeCompare(a.received_at));
    document.getElementById('result-count').textContent='';
    document.getElementById('feed').replaceChildren(...items.map(card));
    document.getElementById('snapshot-date').textContent='Updated '+dateFormat.format(new Date(feed.generated_at))+'.';
    const choir=feed.items.find(i=>i.key==='89c519e060d4934a0be6dd5d');
    if(choir&&/^https:\/\/mail\.google\.com\//.test(choir.source_url||'')){const link=document.getElementById('choir-source');link.href=choir.source_url;link.hidden=false;}
  }).catch(()=>{document.getElementById('feed').textContent='School updates could not load.';});
})();
