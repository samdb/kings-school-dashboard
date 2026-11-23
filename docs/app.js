/* Read-only school information. Notification acknowledgement never hides cards. */
(function () {
  'use strict';
  const dateFormat = new Intl.DateTimeFormat('en-GB', {day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'});
  const eventFormat = new Intl.DateTimeFormat('en-GB', {weekday:'long',day:'numeric',month:'long',timeZone:'Europe/London'});
  function node(tag, cls, text) {const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;}
  const lightbox=node('dialog','work-lightbox');lightbox.setAttribute('aria-labelledby','work-image-title');
  const lightboxTitle=node('h2','','Schoolwork');lightboxTitle.id='work-image-title';
  const close=node('button','lightbox-close','Close');close.type='button';close.autofocus=true;
  const zoom=node('button','lightbox-zoom','Zoom in');zoom.type='button';zoom.setAttribute('aria-pressed','false');
  const tools=node('div','lightbox-tools');tools.append(lightboxTitle,zoom,close);
  const stage=node('div','lightbox-stage');const fullImage=node('img');stage.append(fullImage);
  const caption=node('p','lightbox-caption');lightbox.append(tools,stage,caption);document.body.append(lightbox);
  let imageOpener;
  close.addEventListener('click',()=>lightbox.close());
  lightbox.addEventListener('click',event=>{if(event.target===lightbox){const r=lightbox.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)lightbox.close();}});
  zoom.addEventListener('click',()=>{const enlarged=stage.classList.toggle('is-zoomed');zoom.textContent=enlarged?'Fit image':'Zoom in';zoom.setAttribute('aria-pressed',String(enlarged));stage.scrollLeft=enlarged?(stage.scrollWidth-stage.clientWidth)/2:0;stage.scrollTop=enlarged?(stage.scrollHeight-stage.clientHeight)/2:0;});
  lightbox.addEventListener('close',()=>{document.documentElement.classList.remove('lightbox-open');fullImage.removeAttribute('src');imageOpener?.focus({preventScroll:true});});
  function openImage(picture,title,opener) {
    imageOpener=opener;lightboxTitle.textContent=title;fullImage.src='./'+picture.src;fullImage.alt=picture.alt;
    caption.textContent=picture.caption||picture.alt;stage.classList.remove('is-zoomed');stage.scrollTop=stage.scrollLeft=0;zoom.textContent='Zoom in';zoom.setAttribute('aria-pressed','false');
    lightbox.showModal();document.documentElement.classList.add('lightbox-open');
  }
  function card(item) {
    const article=node('article','card');article.dataset.key=item.key;
    if(item.event_on) {
      const time=node('time','event-date',eventFormat.format(new Date(item.event_on+'T12:00:00Z')));
      time.dateTime=item.event_on;article.append(time);
    }
    article.append(node('h3','',item.subject.startsWith('School newsletter') ? 'School newsletter' : item.subject),node('p','',item.excerpt));
    if(item.tags?.length) {
      const tags=node('div','audience-tags');tags.setAttribute('aria-label','Who this is for');
      item.tags.forEach(tag=>tags.append(node('span','audience-tag',tag)));
      article.insertBefore(tags,article.querySelector('p'));
    }
    if(item.points?.length) {
      const list=node('ul','summary-points');
      item.points.forEach(text=>list.append(node('li','',text)));article.append(list);
    }
    if(item.teacher_comment) {
      const comment=node('blockquote','teacher-comment');comment.append(node('span','teacher-comment-label','Teacher’s note'),node('p','',item.teacher_comment));article.append(comment);
    }
    if(item.images?.length) {
      const gallery=node('div','work-images');
      for(const picture of item.images) {
        if(!/^media\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(picture.src||''))continue;
        const button=node('button','work-image');button.type='button';button.setAttribute('aria-label','Enlarge image: '+picture.alt);
        const image=node('img');image.src='./'+picture.src;image.alt=picture.alt;image.loading='lazy';image.decoding='async';
        button.append(image,node('span','','View image ↗'));button.addEventListener('click',()=>openImage(picture,item.subject,button));gallery.append(button);
      }
      article.append(gallery);
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
    if(item.source_url==='https://app.seesaw.me/#/family/feed') {
      const source=node('a','text-link','Open Seesaw ↗');source.href=item.source_url;source.target='_blank';source.rel='noopener noreferrer';
      const links=node('div','card-actions');links.append(source);article.append(links);
    }
    const note=node('p','source-note',item.source_url==='https://app.seesaw.me/#/family/feed' ? 'Posted on Seesaw ' : 'Notice received ');
    const received=node('time','',dateFormat.format(new Date(item.received_at)));
    received.dateTime=item.received_at;note.append(received);article.append(note);
    return article;
  }
  function render(feed) {
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'Europe/London'});
    const items=feed.items.filter(item=>!item.subject.startsWith('Past event:') && (!item.expires_on || item.expires_on>=today) && (!item.event_on || item.event_on>=today));
    const upcoming=items.filter(item=>item.event_on && !['grade','work'].includes(item.kind)).sort((a,b)=>a.event_on.localeCompare(b.event_on)||a.subject.localeCompare(b.subject));
    const grades=items.filter(item=>['grade','work'].includes(item.kind)).sort((a,b)=>b.received_at.localeCompare(a.received_at));
    document.getElementById('coverage-note').textContent=feed.coverage_text;
    document.getElementById('result-count').textContent='';
    document.getElementById('feed').replaceChildren(...(upcoming.length ? upcoming.map(card) : [node('p','update-note','No upcoming dated notices have been reviewed yet.')]));
    document.getElementById('grades-feed').replaceChildren(...(grades.length ? grades.map(card) : [node('p','update-note','No schoolwork or grades have been reviewed yet.')]));
    document.getElementById('snapshot-date').textContent='Updated '+dateFormat.format(new Date(feed.generated_at))+'.';
    window.schoolRenderedRevision=feed.revision;
    window.dispatchEvent(new Event('school-rendered'));

  }
  const base=new URL('./',location.href);
  const savedKey='school-feed:'+base.pathname;
  const status=document.getElementById('refresh-status');
  const message=document.getElementById('refresh-message');
  const retry=document.getElementById('refresh-retry');
  let current, pending;
  function valid(feed) {return feed && Array.isArray(feed.items) && typeof feed.revision==='string' && Number.isFinite(Date.parse(feed.generated_at));}
  function state(text,busy=false,failed=false) {
    message.textContent=text;status.setAttribute('aria-busy',String(busy));retry.hidden=!failed;
  }
  async function refresh() {
    if(pending)return pending;
    window.schoolFreshRevision=null;
    state('Checking for updates…',true);
    pending=(async()=>{
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),8000);
      try {
        const response=await fetch(new URL('feed.json',base),{cache:'no-store',signal:controller.signal});
        if(!response.ok)throw Error('Update unavailable');
        const feed=await response.json();
        if(!valid(feed))throw Error('Invalid update');
        // Do not replace cards or steal focus when only the check timestamp changed.
        if(!current || JSON.stringify(current)!==JSON.stringify(feed))render(feed);
        current=feed;
        try {localStorage.setItem(savedKey,JSON.stringify(feed));}catch{}
        window.schoolFreshRevision=feed.revision;
        state('Up to date');
        window.dispatchEvent(new Event('school-rendered'));
      } catch {
        state(navigator.onLine?'Couldn’t check for updates. Showing saved content.':'Offline · showing saved content.',false,true);
      } finally {clearTimeout(timeout);pending=null;}
    })();
    return pending;
  }
  window.schoolRefresh=refresh;
  retry.addEventListener('click',refresh);
  window.addEventListener('online',refresh);
  window.addEventListener('offline',()=>{window.schoolFreshRevision=null;state('Offline · showing saved content.',false,true);});
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible') {if(current)render(current);refresh();}
    else window.schoolFreshRevision=null;
  });
  window.addEventListener('pageshow',event=>{if(event.persisted)refresh();});
  window.schoolSnapshotApi('/api/feed').then(feed=>{
    let saved;
    try {saved=JSON.parse(localStorage.getItem(savedKey));}catch{}
    current=valid(saved) && Date.parse(saved.generated_at)>Date.parse(feed.generated_at)?saved:feed;
    render(current);
    refresh();
  }).catch(()=>{state('School updates could not load. Please reopen the app.',false);});
})();
