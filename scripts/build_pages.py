"""Build the authorised family Pages snapshot from reviewed summaries, never raw mail."""
import json
import hashlib
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from kingsdash.service import Service
from kingsdash.config import Env
from kingsdash.matching import classify
from kingsdash.storage import read_json
from kingsdash.publication import approved_reviews, coverage_note
from kingsdash.public_media import export_images

# Explicitly reviewed summaries keyed to their source. No arbitrary email export.
SUMMARIES = {
 '1bfe6cad1733cbd88ba80842': ('English work recognised by Mr Fisher', 'Blake showed Mr Fisher an English task on 12 October. The Junior School congratulated him on the high standard of his work.'),
 '586eec97452540686c80eb60': ('Michaelmas clubs: confirmed places', 'Guided Drawing: Wednesday after school, Michaelmas term. LAMDA: Friday lunchtime, all year. Both places confirmed.'),
 '89c519e060d4934a0be6dd5d': ('Choir place offered', 'Choir offered Blake a place from Tuesday 22 September and asked for a reply. Acceptance not confirmed.'),
 'b4ae119d62ce32fc74b9cde7': ('Year 3 parents’ letter · 21 September', 'Year 3 parents’ letter from the Junior Office. Read the letter in the original email.'),
 '989658e78cff6c0a5877365a': ('PSHEE and RSHE curriculum · Years 1–6', 'PSHEE and RSHE curriculum letter for Years 1–6, including Year 3. Read the letter in the original email.'),
 '46807aaeeb6d09e3ee1694cb': ('Allergy safety: school policy updated', 'Allergy-safety changes announced on 18 September. Updated policy, school procedures and Sodexo letter are in the original email.'),
 '9c4a533071a2096b2e797a74': ('Google educational services: parental information', 'Information about additional Google educational services, including the parental opt-out.'),
 '26e2c35e83d329cb32c7bcea': ('Past event: Year 3 Roman Museum trip · 16 September', 'Consent email for the Year 3 trip to Canterbury’s Roman Museum on 16 September 2026. Event has passed.'),
 'cb47e5b23a5d8e4ee2bdd624': ('Past event: scholarship evening · 7 October', 'Scholarship evening on 7 October, including Year 4 choristerships. Event has passed.'),
 'c69d4079eae36bab9a21db1f': ('Michaelmas welcome letter', 'Mrs Crozer’s Michaelmas welcome letter. Read the letter in the original email.'),
 '1faa3ceffa714b82241b7a92': ('Junior School leadership opportunities', 'Junior School leadership opportunities. Read the letter in the original email.'),
}
REVIEWS = json.loads((ROOT/'scripts/reviewed_content.json').read_text())
family = json.loads((ROOT/'scripts/family_updates.json').read_text())
env = Env()
raw = Service(env).feed()
private_reviews = read_json(str(Path(env.data_dir)/'reviews.json'), {})
approved = approved_reviews(private_reviews)
REVIEWS.update(approved)
extra_sources = read_json(str(Path(env.data_dir)/'sources.json'), {})
source_items = {s['key']: s for s in raw['items']}
source_items.update(extra_sources)
update_status = read_json(str(Path(env.data_dir)/'update_status.json'), {})
assert raw['mode'] == 'live', 'Refusing to publish synthetic data'
profile = dict(raw['profile'], activities=['Guided Drawing', 'Choir'])
items = []
out = ROOT/'docs'; out.mkdir(exist_ok=True)
for source in source_items.values():
    key = source['key']
    if key in family['superseded_source_keys']:
        continue
    if key in private_reviews and key not in approved:
        continue
    review = REVIEWS.get(key)
    if review:
        subject, summary = review['title'], review['summary']
    elif key in SUMMARIES:
        subject, summary = SUMMARIES[key]
    else:
        # Do not publish generic newsletter placeholders. Older issues need
        # document/image review before they can supply useful summaries.
        continue
    # Main page includes upcoming events, grades and marked schoolwork (Sam, 23 Nov).
    if not review or not (review.get('event_on') or review.get('kind') in ('grade', 'work')):
        continue
    url = urlsplit(source.get('source_url', ''))
    safe_url = urlunsplit((url.scheme, url.netloc, url.path, '', url.fragment))
    item = dict(key=key,subject=subject,new_text=summary,excerpt=summary,full_text='',
                received_at=source['received_at'],from_name='King’s School Rochester',
                source_url=safe_url,attachments_skipped=source.get('attachments_skipped',0),
                mark=dict(saved=False,done=False,dismissed=False))
    if review:
        item['points'] = review.get('points', [])
        item['links'] = review.get('links', [])
        item['reviewed_on'] = review['reviewed_on']
        item['expires_on'] = review.get('expires_on')
        item['event_on'] = review.get('event_on')
        item['tags'] = review.get('tags', [])
        item['kind'] = review.get('kind', 'event')
        if review.get('teacher_comment'):
            item['teacher_comment'] = review['teacher_comment']
        if review.get('images'):
            item['images'] = export_images(review['images'], Path(env.data_dir)/'approved-images', out)
    item['match'] = classify(subject, summary, profile)
    # Personal relevance is reviewed metadata, not a side effect of copy wording.
    if key in {'1bfe6cad1733cbd88ba80842', '586eec97452540686c80eb60', '89c519e060d4934a0be6dd5d'}:
        item['match']['direct'] = True
        item['match']['category'] = 'direct'
    if key == '89c519e060d4934a0be6dd5d': item['match']['possible_actions'] = ['confirm whether choir place was accepted']
    else: item['match']['possible_actions'] = []
    if subject.startswith('School newsletter'):
        item['match'] = dict(category='general',direct=False,year_match=False,activities=[],years_mentioned=[],possible_actions=[],reasons=[dict(kind='general',text='Whole-school newsletter; individual stories do not restrict its audience.')])
    items.append(item)
assert items
feed = dict(mode='snapshot', connection='snapshot', profile={'child_first_name': 'Blake', 'year_group': 3}, items=items, accounts=[], refresh={'running':False}, refresh_minutes=0, last_successful_refresh=raw['last_successful_refresh'], generated_at=max((r.get('reviewed_on', '') for r in REVIEWS.values()), default='2026-10-14'), coverage_text=coverage_note(update_status))
out = ROOT/'docs'; out.mkdir(exist_ok=True)
feed['revision'] = hashlib.sha256(json.dumps({'items': items}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
# Pages has its own presentation: do not rewrite the local-app UI with regexes.
for name in ['index.html', 'app.css', 'app.js', 'pwa.js', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png']:
    (out/name).write_bytes((ROOT/'pages'/name).read_bytes())
for name in ['favicon.svg', 'school-logo.svg']:
    (out/name).write_bytes((ROOT/'static'/name).read_bytes())
(out/'snapshot.js').write_text('"use strict";\n(function(){\nconst feed = '+json.dumps(feed,ensure_ascii=False)+''';
window.schoolSnapshotApi = function(path) {
 if(path === '/api/feed') return Promise.resolve(feed);
 return Promise.reject(new Error('This is a read-only information page.'));
};
})();
''')
# Remove obsolete synthetic output from the published tree.
if (out/'demo.js').exists(): (out/'demo.js').unlink()
(out/'.nojekyll').touch()
(out/'feed.json').write_text(json.dumps(feed, ensure_ascii=False))
# Generated media is an exact allowlist of this approved feed, never all downloads.
used_media = {picture['src'] for item in items for picture in item.get('images', [])}
if (out/'media').exists():
    for image in (out/'media').iterdir():
        if image.is_file() and 'media/'+image.name not in used_media:
            image.unlink()
# Version assets so a refreshed page cannot mix old presentation and new data.
html = (out/'index.html').read_text()
for name in ('app.css', 'app.js', 'snapshot.js', 'pwa.js'):
    version = hashlib.sha256((out/name).read_bytes()).hexdigest()[:12]
    html = html.replace('./'+name+'"', './'+name+'?v='+version+'"')
(out/'index.html').write_text(html)
print(f'Built {len(items)} reviewed real school updates')
