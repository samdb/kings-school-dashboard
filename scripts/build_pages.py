"""Build the authorised family Pages snapshot from reviewed summaries, never raw mail."""
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from kingsdash.service import Service
from kingsdash.config import Env
from kingsdash.matching import classify

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
raw = Service(Env()).feed()
assert raw['mode'] == 'live', 'Refusing to publish synthetic data'
profile = dict(raw['profile'], activities=['Guided Drawing', 'LAMDA', 'Choir'])
items = []
for source in raw['items']:
    key = source['key']
    if key in SUMMARIES:
        subject, summary = SUMMARIES[key]
    elif source['subject'] == "King's School Rochester News" and source['received_at'] >= '2026-09':
        subject = 'School newsletter · ' + source['received_at'][:10]
        summary = 'The Principal’s update and school-wide news. Read the newsletter for notices and dates.'
        if source['received_at'].startswith('2026-10-09'):
            summary = 'Firework Night, Harvest Festival and the Principal’s update. See the newsletter for dates and event details.'
    else:
        continue
    url = urlsplit(source.get('source_url', ''))
    safe_url = urlunsplit((url.scheme, url.netloc, url.path, '', url.fragment))
    item = dict(key=key,subject=subject,new_text=summary,excerpt=summary,full_text='',
                received_at=source['received_at'],from_name='King’s School Rochester',
                source_url=safe_url,attachments_skipped=source.get('attachments_skipped',0),
                mark=dict(saved=False,done=False,dismissed=False))
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
feed = dict(mode='snapshot',connection='snapshot',profile=profile,items=items,accounts=[],refresh={'running':False},refresh_minutes=0,last_successful_refresh=raw['last_successful_refresh'],generated_at=raw['generated_at'],coverage_text=f"{len(items)} reviewed updates from {len(raw['items'])} imported threads. 24 Victor threads were not retrieved in the last sync. Attachments have not been read. Personal medical, billing and account-access messages are not published.")
out = ROOT/'docs'; out.mkdir(exist_ok=True)
# Pages has its own presentation: do not rewrite the local-app UI with regexes.
for name in ['index.html', 'app.css', 'app.js']:
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
print(f'Built {len(items)} reviewed real school updates')
