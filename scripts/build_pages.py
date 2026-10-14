"""Build Pages from synthetic fixtures only; never reads local data or config."""
import json
import sys
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from kingsdash.demo import demo_items
from kingsdash.matching import classify

out = ROOT / 'docs'
out.mkdir(exist_ok=True)
profile = {'child_first_name': 'Alex', 'year_group': 3, 'activities': ['Chess Club']}
items = demo_items(profile, now=datetime(2026, 10, 14, 12, tzinfo=timezone.utc))
for item in items:
    item['match'] = classify(item['subject'], item['new_text'], profile)
    item['mark'] = dict(saved=False, done=False, dismissed=False)
feed = dict(mode='demo', connection='demo', profile=profile, items=items,
            accounts=[], refresh={'running': False}, refresh_minutes=30,
            last_successful_refresh=None)
html = (ROOT / 'static/index.html').read_text().replace('/static/', './')
html = html.replace('None of these items are real school emails. Turn demo mode off in Settings to see your synced Gmail.',
                    'Public preview only. All names and emails are fictional. Gmail and profile settings are available only in the local app.')
html = html.replace('id="settings-btn"', 'id="settings-btn" disabled title="Settings are available in the local app"')
html = html.replace('Private family dashboard · runs only on this computer (127.0.0.1) · Gmail is read, never changed.\n      Saved / done / dismissed are stored locally on this machine only.',
                    'Public demo · synthetic content only · no Gmail connection. Save / done / dismiss last until you reload this page.')
html = html.replace('Only the configured inboxes and school search are covered. Parent newsletters may arrive in another inbox.',
                    'Explore sample messages using the tabs, search and activity filters.')
html = html.replace('<script src="./app.js" defer></script>', '<script src="./demo.js" defer></script>\n  <script src="./app.js" defer></script>')
(out / 'index.html').write_text(html)
for name in ['app.css', 'favicon.svg']:
    (out / name).write_bytes((ROOT / 'static' / name).read_bytes())
js = (ROOT / 'static/app.js').read_text()
start = js.index('  function api(path, body) {')
end = js.index('  // ---------- dates ----------', start)
js = js[:start] + '  function api(path, body) { return window.schoolDemoApi(path, body); }\n\n' + js[end:]
(out / 'app.js').write_text(js)
(out / 'demo.js').write_text('"use strict";\n(function () {\nconst feed = ' + json.dumps(feed, ensure_ascii=False) + ''';
window.schoolDemoApi = function(path, body) {
  if (path === '/api/feed') return Promise.resolve(feed);
  if (path === '/api/marks') {
    const item = feed.items.find(item => item.key === body.key);
    if (!item) return Promise.reject(new Error('Unknown sample'));
    Object.assign(item.mark, body.changes);
    return Promise.resolve({mark: item.mark});
  }
  return Promise.reject(new Error('Available only in the local app'));
};
})();
''')
(out / '.nojekyll').touch()
print('Built synthetic Pages preview in docs/')
