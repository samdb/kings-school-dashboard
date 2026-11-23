"""Fail-closed export of human/agent reviewed presentation fields only."""
from datetime import date
from urllib.parse import urlsplit

AUDIENCE_TAGS = {'Whole school', 'Year 3', 'Blake confirmed', 'School event', 'Parents', 'Choir', 'Optional'}


def approved_reviews(reviews):
    approved = {}
    for key, review in reviews.items():
        if review.get('status') != 'relevant' or review.get('public_safe') is not True:
            continue
        if not review.get('evidence') or not review.get('source_checks'):
            continue
        checks = review['source_checks']
        if not isinstance(checks, list) or any(c.get('status') not in ('read', 'excluded') or not c.get('reason') for c in checks):
            continue
        try:
            date.fromisoformat(review['reviewed_on'])
            if review.get('expires_on'):
                date.fromisoformat(review['expires_on'])
            if review.get('event_on'):
                if date.fromisoformat(review['event_on']).isoformat() != review['event_on']:
                    continue
        except (KeyError, ValueError, TypeError):
            continue
        if not all(isinstance(review.get(k), str) and review[k].strip() for k in ('title', 'summary')):
            continue
        if not isinstance(review.get('points', []), list) or not all(isinstance(p, str) for p in review.get('points', [])):
            continue
        clean = {k: review[k] for k in ('title', 'summary', 'points', 'reviewed_on', 'expires_on', 'event_on') if k in review}
        if review.get('kind') == 'grade':
            # Sam authorised Blake's reviewed grades on the main page, 23 Nov.
            if review.get('child') != 'Blake':
                continue
            clean['kind'] = 'grade'
        clean['links'] = []
        clean['tags'] = [tag for tag in review.get('tags', []) if tag in AUDIENCE_TAGS]
        for link in review.get('links', []):
            url = urlsplit(link.get('url', ''))
            if url.scheme == 'https' and url.hostname in ('kings-rochester.co.uk', 'mcusercontent.com') and not url.query and not url.username:
                clean['links'].append({'label': link.get('label', 'School notice'), 'url': link['url']})
        approved[key] = clean
    return approved


def coverage_note(status):
    accounts = status.get('accounts', [])
    if any(a.get('error') for a in accounts):
        return 'Some school emails cannot currently be checked. Previously reviewed information is shown; newer notices may be missing.'
    if any((a.get('coverage') or {}).get(k) for a in accounts for k in ('failed', 'more_available', 'budget_hit')):
        return 'Some school emails and attachments are still awaiting review.'
    if status.get('pending_sources') or status.get('pending_threads') or status.get('errors'):
        return 'New school emails are being checked. Some linked notices and attachments are still awaiting review.'
    if status.get('mail_ok'):
        return 'School email is checked every four hours. Only reviewed information is shown.'
    return 'Previously reviewed information is shown. Other attachments and parent-portal letters have not yet been reviewed.'
