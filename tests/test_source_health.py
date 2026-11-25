import unittest
from kingsdash.publication import source_health

class SourceHealthTests(unittest.TestCase):
    def test_missing_is_not_healthy(self):
        self.assertEqual(source_health({}), {'seesaw': {'status': 'unknown'}})

    def test_fixed_allowlist_no_private_evidence_or_error(self):
        result = source_health({'seesaw': {'status':'verification_required', 'checked_at':'2026-11-25T12:00:00Z', 'last_reviewed_at':'2026-11-23T20:36:00Z', 'error':'secret', 'review_evidence':'private/path', 'password':'secret'}})
        self.assertEqual(set(result['seesaw']), {'status','checked_at','last_reviewed_at'})
        self.assertEqual(result['seesaw']['status'], 'verification_required')

    def test_invalid_or_naive_dates_do_not_claim_coverage(self):
        result=source_health({'seesaw': {'status':'invented','checked_at':'yesterday','last_reviewed_at':'2026-11-25'}})
        self.assertEqual(result, {'seesaw': {'status':'unknown'}})
