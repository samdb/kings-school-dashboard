"""Reviewed school-calendar rows become ordinary dated feed items."""
from datetime import date


def calendar_items(calendar):
    checked = date.fromisoformat(calendar['reviewed_on']).isoformat()
    source = 'https://kings-rochester.co.uk/admissions/term-dates/'
    if calendar['source_url'] != source:
        raise ValueError('Unexpected calendar source')
    items = []
    keys = set()
    for row in calendar['events']:
        start = date.fromisoformat(row['event_on']).isoformat()
        end = date.fromisoformat(row.get('event_end_on', start)).isoformat()
        if end < start:
            raise ValueError('Calendar range ends before it begins')
        key = 'calendar-' + row['id']
        if key in keys:
            raise ValueError('Duplicate calendar event')
        keys.add(key)
        items.append(dict(key=key, subject=row['title'], excerpt=row['summary'],
                          event_on=start, event_end_on=end, expires_on=end,
                          # Compatibility timestamp for older cached shells; the new
                          # calendar UI labels this as checked, never an email receipt.
                          kind='term', reviewed_on=checked, received_at=checked, tags=['Whole school'],
                          links=[dict(label='School term dates', url=source)],
                          source_url=source, points=[]))
    return items
