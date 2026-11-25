"""Record a completed newest-feed review, not merely a successful login/check."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from kingsdash.storage import read_json, write_json_atomic
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--evidence', required=True, help='Private project-relative evidence file for the completed review')
a = p.parse_args()
root = Path(__file__).resolve().parents[1]
evidence = (root / a.evidence).resolve()
if not evidence.is_relative_to(root / 'data') or not evidence.is_file():
    p.error('A real private data evidence file is required')
file = root / 'data/source_health.json'
data = read_json(str(file), {})
source = data.get('seesaw', {})
now = datetime.now(timezone.utc)
checked = datetime.fromisoformat(source.get('checked_at', '1970-01-01T00:00:00+00:00').replace('Z','+00:00'))
if source.get('status') != 'available' or not 0 <= (now-checked).total_seconds() <= 3600:
    p.error('A successful live family-feed check within the last hour is required')
source.update(last_reviewed_at=now.isoformat(), review_evidence=str(evidence.relative_to(root)))
data['seesaw'] = source
write_json_atomic(str(file), data)
print('Recorded completed Seesaw feed review')
