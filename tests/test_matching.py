import unittest

from kingsdash import matching
from kingsdash.textclean import clean_new_content

PROFILE = {"child_first_name": "Robin", "year_group": 3, "activities": ["Chess Club", "Swimming"]}


def classify(subject, body, profile=PROFILE, outgoing=False):
    return matching.classify(subject, clean_new_content(body), profile, outgoing=outgoing)


class YearBoundaryTests(unittest.TestCase):
    def test_year_3_matches(self):
        r = classify("Year 3 trip", "Details for parents.")
        self.assertEqual(r["category"], "year")
        self.assertTrue(r["year_match"])

    def test_year_13_is_not_year_3(self):
        r = classify("Year 13 leavers' ball", "Tickets for Year 13 students.")
        self.assertFalse(r["year_match"])
        self.assertEqual(r["category"], "other")
        self.assertEqual(r["years_mentioned"], [13])

    def test_year_30_and_dates_are_not_years(self):
        self.assertEqual(matching.year_mentions("Year 2026 calendar"), [])
        self.assertFalse(classify("Celebrating 30 years", "Over the years 1990 to 2020")["year_match"])

    def test_variants(self):
        for text in ["Y3 assembly", "Yr 3 parents", "YEAR THREE trip", "Years 3 and 4", "Years 3, 4 & 5",
                     "Year 3/4 cross country", "Years 1-6 sports day", "Years 1 to 6", "Y3-6 concert"]:
            with self.subTest(text=text):
                self.assertTrue(classify(text, "")["year_match"], text)

    def test_ranges_excluding_child_year(self):
        for text in ["Years 4-6 trip", "Years 7 to 13", "Y13 mocks", "Year 4 and 5"]:
            with self.subTest(text=text):
                r = classify(text, "")
                self.assertFalse(r["year_match"], text)
                self.assertEqual(r["category"], "other")

    def test_no_year_is_general(self):
        r = classify("Harvest festival", "Whole school collection next week.")
        self.assertEqual(r["category"], "general")
        self.assertEqual([x["kind"] for x in r["reasons"]], ["general"])


class NameAndActivityTests(unittest.TestCase):
    def test_direct_name_in_other_year_is_still_direct(self):
        r = classify("Year 5 assembly", "Robin will read a poem at the Year 5 assembly.")
        self.assertEqual(r["category"], "direct")
        self.assertTrue(r["direct"])
        self.assertFalse(r["year_match"])
        kinds = [x["kind"] for x in r["reasons"]]
        self.assertIn("direct", kinds)
        self.assertIn("other", kinds)

    def test_name_is_whole_word_and_capitalised(self):
        self.assertFalse(classify("Robinson Hall closure", "")["direct"])
        self.assertFalse(classify("Notice", "a robin was seen in the garden")["direct"])
        self.assertTrue(classify("Notice", "Well done ROBIN!")["direct"])

    def test_no_name_configured_never_matches(self):
        r = classify("Hi", "Robin", profile={"child_first_name": "", "year_group": 3, "activities": []})
        self.assertFalse(r["direct"])

    def test_activity_is_possible_relevance_not_enrolment(self):
        r = classify("Clubs this term", "Chess Club runs on Tuesdays.")
        self.assertEqual(r["category"], "activity")
        self.assertEqual(r["activities"], ["Chess Club"])
        text = " ".join(x["text"] for x in r["reasons"])
        self.assertIn("possible relevance", text)
        self.assertIn("does not mean", text)
        self.assertNotIn("is enrolled", text)

    def test_year_outranks_activity(self):
        r = classify("Year 3 swimming", "Swimming lessons for Year 3.")
        self.assertEqual(r["category"], "year")
        self.assertEqual(r["activities"], ["Swimming"])


class QuotedHistoryTests(unittest.TestCase):
    def test_name_only_in_quoted_reply_is_ignored(self):
        body = ("Thank you, see you then.\n\nOn Mon, 6 Oct 2026 at 09:00, Parent <p@example.invalid> wrote:\n"
                "> Robin will be late on Friday for Year 3 swimming.\n")
        r = classify("Re: Friday", body)
        self.assertFalse(r["direct"])
        self.assertFalse(r["year_match"])
        self.assertEqual(r["activities"], [])

    def test_outlook_style_history_ignored(self):
        body = ("Noted.\n\nFrom: Someone <x@example.invalid>\nSent: 01 October 2026 10:00\nTo: Office\n"
                "Subject: Year 3\n\nRobin needs to sign the consent form.")
        r = classify("RE: note", body)
        self.assertFalse(r["direct"])
        self.assertEqual(r["possible_actions"], [])


class ActionHintTests(unittest.TestCase):
    def test_action_keywords_flag_possible_action(self):
        r = classify("Trip", "Please return the consent form to the office.")
        self.assertIn("consent", r["possible_actions"])

    def test_outgoing_never_produces_actions(self):
        r = classify("Trip", "I will sign the consent form and make the payment.", outgoing=True)
        self.assertEqual(r["possible_actions"], [])

    def test_plain_newsletter_has_no_actions(self):
        self.assertEqual(classify("News", "A lovely week of music and art.")["possible_actions"], [])


if __name__ == "__main__":
    unittest.main()
