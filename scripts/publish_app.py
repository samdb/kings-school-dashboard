"""Atomically publish only the generated, approved docs to the Home Screen app."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from kingsdash.public_media import MEDIA_NAME
TARGET = Path('/srv/kings-school-app')
NAMES = ['index.html', 'app.js', 'app.css', 'snapshot.js', 'feed.json', 'pwa.js', 'sw.js',
         'manifest.webmanifest', 'favicon.svg', 'school-logo.svg', 'icon-192.png',
         'icon-512.png', 'apple-touch-icon.png']
content = {name: (ROOT / 'docs' / name).read_bytes() for name in NAMES}
for item in json.loads(content['feed.json'])['items']:
    for picture in item.get('images', []):
        name = picture['src']
        if not MEDIA_NAME.fullmatch(name):
            raise ValueError('Unapproved public image path')
        content[name] = (ROOT / 'docs' / name).read_bytes()
version = hashlib.sha256(b''.join(name.encode()+content[name] for name in sorted(content))).hexdigest()[:20]
release = TARGET / 'releases' / version
if not release.exists():
    staged = Path(tempfile.mkdtemp(prefix='.staging-', dir=TARGET / 'releases'))
    for name, data in content.items():
        (staged / name).parent.mkdir(parents=True, exist_ok=True)
        (staged / name).write_bytes(data)
    os.rename(staged, release)
link = TARGET / 'next'
if link.is_symlink():
    link.unlink()
link.symlink_to(release)
os.replace(link, TARGET / 'current')
print('Published school app release ' + version)
