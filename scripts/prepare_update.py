"""Refresh mail and prepare a PRIVATE source queue for the scheduled reviewer.

Uses the existing read-only gog client. Downloads are not evidence of review.
The agent reads the queue and documents before writing data/reviews.json.
"""
import argparse
import fcntl
import json
import os
import re
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from kingsdash.config import Env
from kingsdash.gmail import build_item, now_iso, SyncError
from kingsdash.mime import b64url_decode
from kingsdash.service import Service
from kingsdash.storage import read_json, write_json_atomic

class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = set()
    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in ('href', 'src') and value and urlsplit(value).scheme in ('http', 'https'):
                self.urls.add(value)

def leaves(part):
    if part.get('parts'):
        for child in part['parts']:
            yield from leaves(child)
    else:
        yield part

def source_record(item, payload, data, binary):
    record = dict(item)
    links = Links()
    links.urls.update(re.findall(r'https?://[^\s<>"\)]+', item['full_text']))
    documents = []
    for index, part in enumerate(leaves(payload)):
        body = part.get('body') or {}
        mime = part.get('mimeType', '')
        if mime == 'text/html' and not part.get('filename'):
            links.feed(b64url_decode(body.get('data')).decode('utf-8', 'replace'))
        if not part.get('filename') and not body.get('attachmentId') and not mime.startswith('image/'):
            continue
        doc = {'name': part.get('filename', ''), 'mime': mime, 'status': 'unread'}
        ext = '.pdf' if mime == 'application/pdf' else { 'image/png': '.png', 'image/jpeg': '.jpg' }.get(mime, '.bin')
        dest = data / 'documents' / (item['key'] + '-' + str(index) + ext)
        if body.get('size', 0) > 20 * 1024 * 1024:
            doc['error'] = 'Over 20MB; manual review required'
        else:
            try:
                if body.get('data'):
                    dest.write_bytes(b64url_decode(body['data']))
                elif body.get('attachmentId'):
                    result = subprocess.run([binary, '--account', item['account'], '--readonly', '--no-input',
                        'gmail', 'attachment', item['message_id'], body['attachmentId'], '--out', str(dest), '--json'],
                        capture_output=True, timeout=60)
                    if result.returncode:
                        raise RuntimeError('Attachment download failed; retry required')
                if dest.exists():
                    dest.chmod(0o600)
                    doc['path'] = str(dest)
                else:
                    doc['error'] = 'No attachment bytes available'
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
                doc['error'] = type(exc).__name__ + ': attachment unavailable'
        documents.append(doc)
    record['documents'] = documents
    record['links'] = sorted(links.urls)
    record['prepared_at'] = now_iso()
    return record

def prepare(limit=20, refresh=True):
    os.umask(0o077)
    service = Service(Env())
    data = Path(service.env.data_dir)
    (data / 'documents').mkdir(mode=0o700, exist_ok=True)
    with open(data / 'prepare.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if refresh:
            service.start_refresh('scheduled', wait=True)
        state = service.load_state()
        sources = read_json(str(data / 'sources.json'), {})
        manifests = read_json(str(data / 'source_threads.json'), {})
        reviews = read_json(str(data / 'reviews.json'), {})
        errors = []
        count = 0
        # Latest threads first, across accounts. Preserve every incoming message,
        # not just the latest message displayed by the original local app.
        candidates = []
        for account, entry in state['accounts'].items():
            if entry.get('error'):
                errors.append({'account': account, 'kind': entry['error']['kind']})
                continue
            for item in entry.get('items', []):
                candidates.append((account, entry, item))
        candidates.sort(key=lambda row: row[2].get('received_at') or '', reverse=True)
        for account, entry, item in candidates:
            tid = item['thread_id']
            token = account + ':' + tid
            sig = entry.get('thread_meta', {}).get(tid)
            if sig is not None and manifests.get(token) == sig:
                continue
            if count >= limit:
                break
            count += 1
            try:
                thread = service.client.thread(account, tid)
                for message in thread['messages']:
                    one = build_item(account, {'id': tid, 'messages': [message]})
                    if not one or one['direction'] == 'outgoing':
                        continue
                    if one['key'] not in sources or any(d.get('error') for d in sources[one['key']].get('documents', [])):
                        sources[one['key']] = source_record(one, message.get('payload', {}), data, service.env.gog_bin)
                if not any(d.get('error') for s in sources.values() if s.get('thread_id') == tid for d in s.get('documents', [])):
                    manifests[token] = sig
            except SyncError as exc:
                errors.append({'account': account, 'kind': exc.kind})
        queue = [s for k, s in sources.items() if reviews.get(k, {}).get('status') not in ('relevant', 'no_relevance', 'excluded')]
        queue.sort(key=lambda s: s.get('received_at') or '', reverse=True)
        write_json_atomic(str(data / 'sources.json'), sources)
        write_json_atomic(str(data / 'source_threads.json'), manifests)
        write_json_atomic(str(data / 'review_queue.json'), queue)
        pending_threads = sum(1 for account, entry, item in candidates
                              if entry.get('thread_meta', {}).get(item['thread_id']) is None
                              or manifests.get(account + ':' + item['thread_id']) != entry.get('thread_meta', {}).get(item['thread_id']))
        status = {'attempted_at': now_iso(), 'mail_ok': bool(state.get('last_run', {}).get('ok')),
                  'pending_threads': pending_threads,
                  'accounts': service.feed()['accounts'], 'pending_sources': len(queue), 'errors': errors}
        write_json_atomic(str(data / 'update_status.json'), status)
        print(json.dumps({'mail_ok': status['mail_ok'], 'errors': errors, 'pending_sources': len(queue),
                          'queue': str(data / 'review_queue.json')}))
        return status

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--max-threads', type=int, default=20)
    parser.add_argument('--no-refresh', action='store_true')
    args = parser.parse_args()
    prepare(max(1, min(args.max_threads, 100)), not args.no_refresh)
