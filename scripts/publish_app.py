"""Atomically publish only the generated, approved docs to the Home Screen app."""
import hashlib
import os
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[1]
TARGET = Path('/srv/kings-school-app')
NAMES = ['index.html', 'app.js', 'app.css', 'snapshot.js', 'feed.json', 'pwa.js', 'sw.js',
         'manifest.webmanifest', 'favicon.svg', 'school-logo.svg', 'icon-192.png',
         'icon-512.png', 'apple-touch-icon.png']
content = {name: (ROOT / 'docs' / name).read_bytes() for name in NAMES}
version = hashlib.sha256(b''.join(name.encode()+content[name] for name in sorted(NAMES))).hexdigest()[:20]
release = TARGET / 'releases' / version
if not release.exists():
    staged = Path(tempfile.mkdtemp(prefix='.staging-', dir=TARGET / 'releases'))
    for name, data in content.items():
        (staged / name).write_bytes(data)
    os.rename(staged, release)
link = TARGET / 'next'
if link.is_symlink():
    link.unlink()
link.symlink_to(release)
os.replace(link, TARGET / 'current')
print('Published school app release ' + version)
