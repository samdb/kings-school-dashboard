import unittest
from kingsdash.publication import approved_reviews, coverage_note

class PublicationTests(unittest.TestCase):
    def review(self):
        return dict(status='relevant', public_safe=True, title='School visit', summary='Bring a coat.',
                    reviewed_on='2026-11-23', evidence='Letter page 1',
                    source_checks=[dict(source='email', status='read', reason='Read')])

    def test_unread_or_unapproved_never_publishes(self):
        for changes in ({'status':'incomplete'}, {'public_safe':False}, {'evidence':''},
                        {'source_checks':[{'status':'unread','reason':'Portal unavailable'}]},
                        {'expires_on':'tomorrow'}):
            self.assertEqual(approved_reviews({'key': dict(self.review(), **changes)}), {})

    def test_only_presentation_fields_and_safe_public_links(self):
        r = self.review()
        r.update(raw_mail='PRIVATE', links=[{'label':'secret','url':'https://kings-rochester.co.uk/?token=abc'},
                                         {'label':'dates','url':'https://kings-rochester.co.uk/admissions/term-dates/'}])
        out = approved_reviews({'key':r})['key']
        self.assertNotIn('evidence', out)
        self.assertNotIn('source_checks', out)
        self.assertNotIn('raw_mail', out)
        self.assertEqual(len(out['links']), 1)

    def test_failed_or_partial_mail_is_not_complete(self):
        self.assertIn('cannot currently', coverage_note({'accounts':[{'error':{'kind':'auth'}}]}))
        self.assertIn('awaiting review', coverage_note({'accounts':[{'coverage':{'more_available':True}}]}))
        self.assertNotIn('every four hours', coverage_note({}))
        self.assertIn('awaiting review', coverage_note({'mail_ok':True, 'pending_threads':2}))
        self.assertIn('awaiting review', coverage_note({'mail_ok':True, 'errors':[{'kind':'auth'}]}))
