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
 '586eec97452540686c80eb60': ('Michaelmas clubs: confirmed places', 'Blake has confirmed places in Prep Guided Drawing on Wednesday after school and Pre-Prep LAMDA at Friday lunchtime (all-year enrolment). The choir waitlist in this 11 September email was superseded by the place offer on 17 September.'),
 '89c519e060d4934a0be6dd5d': ('Choir place offered — acceptance not verified', 'A place in Pre-Prep Choir was offered on 17 September after the group expanded to 28 pupils. Blake could join from Tuesday 22 September. The school requested a reply confirming whether he would join; acceptance has not been verified. Check the source email before treating this as outstanding.'),
 'b4ae119d62ce32fc74b9cde7': ('Year 3 parents’ letter · 21 September', 'The Junior Office sent a letter for all Year 3 parents on 21 September. The important detail is in the attachment, which has not yet been read. Open the source email to read the letter.'),
 '989658e78cff6c0a5877365a': ('PSHEE and RSHE curriculum · Years 1–6', 'The school sent the KS1 and KS2 PSHEE and RSHE curriculum letter on 18 September. It covers Year 3. The letter is attached to the source email and has not yet been read.'),
 '46807aaeeb6d09e3ee1694cb': ('Allergy safety: school policy updated', 'The school announced immediate changes to allergy-safety procedures on 18 September. The email includes the updated policy, an operational-changes letter and a Sodexo letter. Read the attachments for the actual requirements; these have not yet been extracted.'),
 '9c4a533071a2096b2e797a74': ('Google educational services: parental information', 'The school sent information on additional Google educational services and a parental opt-out on 18 September. Open the source message to review the arrangements and decide whether you want to opt out.'),
 '26e2c35e83d329cb32c7bcea': ('Past event: Year 3 Roman Museum trip · 16 September', 'A consent request was sent for the Year 3 trip to the Roman Museum in Canterbury on 16 September 2026. The event date has passed. This is reference material, not a new consent deadline; attendance and consent status are not inferred.'),
 'cb47e5b23a5d8e4ee2bdd624': ('Past event: scholarship evening · 7 October', 'The scholarship evening on 7 October included information for Year 3 families about choristerships beginning in Year 4. The event has passed; the source email remains useful background if you are considering this route.'),
 'c69d4079eae36bab9a21db1f': ('Michaelmas welcome letter', 'The Junior Office sent Mrs Crozer’s Michaelmas welcome letter on 2 September. Open the attachment in the source email for the full term information.'),
 '1faa3ceffa714b82241b7a92': ('Junior School leadership opportunities', 'The Junior Office circulated a letter about leadership opportunities on 4 September. Eligibility and details are in the attachment, which has not yet been read.'),
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
        summary = 'School-wide newsletter with the Principal’s update, school news and upcoming notices. Open the source email for images and full details. Coverage is school-wide; it does not imply Blake participates in every featured activity.'
        if source['received_at'].startswith('2026-10-09'):
            summary = 'The latest imported newsletter links to Firework Night, Harvest Festival and other school notices, alongside the Principal’s update. Open the source email for dates, images and full details. These are school-wide notices, not confirmed activities for Blake.'
    else:
        continue
    url = urlsplit(source.get('source_url', ''))
    safe_url = urlunsplit((url.scheme, url.netloc, url.path, '', url.fragment))
    item = dict(key=key,subject=subject,new_text=summary,excerpt=summary,full_text='',
                received_at=source['received_at'],from_name='King’s School Rochester',
                source_url=safe_url,attachments_skipped=source.get('attachments_skipped',0),
                mark=dict(saved=False,done=False,dismissed=False))
    item['match'] = classify(subject, summary, profile)
    if key == '89c519e060d4934a0be6dd5d': item['match']['possible_actions'] = ['confirm whether choir place was accepted']
    else: item['match']['possible_actions'] = []
    if subject.startswith('School newsletter'):
        item['match'] = dict(category='general',direct=False,year_match=False,activities=[],years_mentioned=[],possible_actions=[],reasons=[dict(kind='general',text='Whole-school newsletter; individual stories do not restrict its audience.')])
    items.append(item)
assert items
feed = dict(mode='snapshot',connection='snapshot',profile=profile,items=items,accounts=[],refresh={'running':False},refresh_minutes=0,last_successful_refresh=raw['last_successful_refresh'],generated_at=raw['generated_at'],coverage_text=f"{len(items)} reviewed updates from {len(raw['items'])} imported threads. 24 Victor threads were not retrieved in the last sync. Attachments have not been read. Personal medical, billing and account-access messages are not published.")
out = ROOT/'docs'; out.mkdir(exist_ok=True)
html = (ROOT/'static/index.html').read_text().replace('/static/','./')
html = re.sub(r'<svg class="brand__crest".*?</svg>', '<img class="brand__logo" src="./school-logo.svg" alt="King’s School Rochester">', html, flags=re.S)
html = html.replace('The Family School Desk', 'Blake’s School Desk')
html = html.replace('id="settings-btn"','id="settings-btn" hidden')
html = re.sub(r'<div id="demo-banner".*?</div>', '<div id="demo-banner" hidden></div>', html, flags=re.S)
html = html.replace('<div class="layout">', '''<section class="family-overview" aria-label="Blake at a glance">
<p class="eyebrow">YEAR 3 · MICHAELMAS 2026</p><h2>A good week starts here.</h2>
<div class="week-grid"><article><span>WEDNESDAY · AFTER SCHOOL</span><h3>Guided Drawing</h3><p>Confirmed Michaelmas place.</p></article><article><span>FRIDAY · LUNCHTIME</span><h3>LAMDA</h3><p>Confirmed all-year enrolment.</p></article><article><span>TUESDAY · AFTER SCHOOL</span><h3>Pre-Prep Choir</h3><p>Place offered. Acceptance not verified.</p></article></div>
<p class="family-note">Latest good news: Blake’s English work was recognised by Mr Fisher on 12 October.</p>
<p class="quick-links"><a href="https://myksr.info/login" target="_blank" rel="noopener">School portal ↗</a> · <a href="https://kings-rochester.co.uk/" target="_blank" rel="noopener">School website ↗</a></p>
</section><div class="layout">''')
html = re.sub(r'<footer class="footer">.*?</footer>', '<footer class="footer"><p>Family-maintained school desk · reviewed email summaries · not an official school service.<br>Save, done and dismiss stay in this browser. This is a published snapshot, not a live Gmail connection.</p></footer>', html, count=1, flags=re.S)
html = html.replace('Only the configured inboxes and school search are covered. Parent newsletters may arrive in another inbox.','Coverage is incomplete; source links open your signed-in Gmail.')
html = html.replace('Add activities in Settings to filter by them. A match only means the activity is mentioned — not that your child takes part.','Drawing and LAMDA are confirmed. Choir was offered; acceptance has not been verified.')
html = html.replace('<script src="./app.js" defer></script>','<script src="./snapshot.js" defer></script>\n  <script src="./app.js" defer></script>')
(out/'index.html').write_text(html)
for name in ['app.css','favicon.svg','school-logo.svg']: (out/name).write_bytes((ROOT/'static'/name).read_bytes())
js = (ROOT/'static/app.js').read_text(); start=js.index('  function api(path, body) {'); end=js.index('  // ---------- dates ----------',start)
js = js[:start] + '  function api(path, body) { return window.schoolSnapshotApi(path, body); }\n\n' + js[end:]
js = js.replace('var btn = $("refresh-btn");','var btn = $("refresh-btn");')
js = js.replace('var conn = CONNECTION[feed.connection]', 'CONNECTION.snapshot = ["pill--ok", "School updates"];\n    var conn = CONNECTION[feed.connection]')
js = js.replace('"Last successful refresh: "','"Email snapshot: "')
js = js.replace('"Auto-refresh every " + feed.refresh_minutes + " minutes while the server runs"','"Published snapshot. Reload checks for a newly published version, not new Gmail messages."')
js = js.replace('$("demo-banner").hidden = feed.mode !== "demo";', '$("demo-banner").hidden = true;\n    $("refresh-label").textContent = "Reload page";')
js = js.replace('if (!feed.accounts.length) {','if (feed.mode === "snapshot") { box.appendChild(el("p", {text:feed.coverage_text})); return; }\n    if (!feed.accounts.length) {')
js = js.replace('Possible action — check email.','Check status in source email.')
(out/'app.js').write_text(js)
(out/'snapshot.js').write_text('"use strict";\n(function(){\nconst feed = '+json.dumps(feed,ensure_ascii=False)+''';
const storageKey = 'kings-family-marks-v1';
let marks = {};
try { marks = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch (_) {}
feed.items.forEach(item => { if(marks[item.key]) Object.assign(item.mark, marks[item.key]); });
window.schoolSnapshotApi = function(path, body) {
 if(path === '/api/feed') return Promise.resolve(feed);
 if(path === '/api/refresh') { location.reload(); return Promise.resolve({}); }
 if(path === '/api/marks') {
  const item = feed.items.find(i => i.key === body.key);
  if(!item) return Promise.reject(new Error('Unknown update'));
  Object.assign(item.mark, body.changes); marks[item.key] = item.mark;
  try { localStorage.setItem(storageKey, JSON.stringify(marks)); } catch (_) {}
  return Promise.resolve({mark:item.mark});
 }
 return Promise.reject(new Error('Manage settings in the local school desk'));
};
})();
''')
# Remove obsolete synthetic output from the published tree.
if (out/'demo.js').exists(): (out/'demo.js').unlink()
(out/'.nojekyll').touch()
print(f'Built {len(items)} reviewed real school updates')
