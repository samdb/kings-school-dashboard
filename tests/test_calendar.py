import json
from pathlib import Path
import unittest
from kingsdash.calendar import calendar_items


class CalendarTests(unittest.TestCase):
    def calendar(self):
        return json.loads((Path(__file__).resolve().parents[1]/'scripts/term_dates.json').read_text())

    def test_term_dates_are_single_source_calendar_events(self):
        rows = calendar_items(self.calendar())
        self.assertEqual(len(rows), 16)
        self.assertEqual(len({r['key'] for r in rows}), len(rows))
        end = next(r for r in rows if r['key'].endswith('michaelmas-ends'))
        self.assertEqual(end['event_on'], '2026-12-11')
        half = next(r for r in rows if r['key'].endswith('lent-half-term'))
        self.assertEqual((half['event_on'], half['event_end_on']), ('2027-02-15', '2027-02-19'))
        self.assertEqual(end['received_at'], end['reviewed_on'])  # Old-shell compatibility only.
        self.assertFalse(any('Boarder' in r['subject'] or 'Speech Day' in r['subject'] for r in rows))
        self.assertTrue(all('evidence' not in r for r in rows))

    def test_bad_ranges_duplicate_dates_and_wrong_sources_are_rejected(self):
        c = self.calendar()
        c['events'][0]['event_end_on'] = '2026-08-01'
        with self.assertRaises(ValueError): calendar_items(c)
        c = self.calendar(); c['events'].append(c['events'][0])
        with self.assertRaises(ValueError): calendar_items(c)
        c = self.calendar(); c['source_url'] = 'https://example.com/'
        with self.assertRaises(ValueError): calendar_items(c)
