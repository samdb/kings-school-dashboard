import unittest

from kingsdash import mime
from kingsdash.textclean import clean_new_content, excerpt, html_to_text, strip_quoted
from tests.helpers import b64, message


class MimeTests(unittest.TestCase):
    def test_prefers_plain_over_html(self):
        msg = message("m1", 1, plain="Plain body", html="<p>HTML body</p>")
        text, kind, att = mime.extract_text(msg["payload"])
        self.assertEqual((text, kind, att), ("Plain body", "plain", 0))

    def test_html_fallback_strips_markup_and_scripts(self):
        html = ("<html><head><style>p{}</style><title>T</title></head><body>"
                "<p>Hello &amp; welcome</p><script>alert(1)</script><img src=x onerror=alert(2)>"
                "<ul><li>One</li><li>Two</li></ul></body></html>")
        msg = message("m1", 1, html=html)
        text, kind, _ = mime.extract_text(msg["payload"])
        self.assertEqual(kind, "html")
        self.assertIn("Hello & welcome", text)
        self.assertIn("• One", text)
        self.assertNotIn("alert", text)
        self.assertNotIn("<", text)

    def test_attachments_are_counted_not_decoded(self):
        msg = message("m1", 1, plain="See attached", attachments=2)
        text, _, att = mime.extract_text(msg["payload"])
        self.assertEqual(att, 2)
        self.assertEqual(text, "See attached")

    def test_charset_and_unpadded_base64url(self):
        msg = message("m1", 1, plain="Café – naïve £5")
        text, _, _ = mime.extract_text(msg["payload"])
        self.assertEqual(text, "Café – naïve £5")
        latin = message("m2", 1, plain="Café £5", charset="iso-8859-1")
        self.assertEqual(mime.extract_text(latin["payload"])[0], "Café £5")

    def test_single_part_message(self):
        payload = {"mimeType": "text/plain", "headers": [], "body": {"data": b64("Just text")}}
        self.assertEqual(mime.extract_text(payload)[0], "Just text")

    def test_bad_base64_and_unknown_charset_do_not_crash(self):
        payload = {"mimeType": "text/plain",
                   "headers": [{"name": "Content-Type", "value": "text/plain; charset=x-nonsense"}],
                   "body": {"data": "@@@not-base64@@@"}}
        text, kind, _ = mime.extract_text(payload)
        self.assertIsInstance(text, str)

    def test_encoded_subject_header(self):
        headers = mime.header_map({"headers": [{"name": "Subject", "value": "=?utf-8?q?Caf=C3=A9_news?="}]})
        self.assertEqual(headers["subject"], "Café news")


class QuoteAndExcerptTests(unittest.TestCase):
    def test_gmail_html_quote_removed(self):
        html = ('<div>New note</div><div class="gmail_quote"><div class="gmail_attr">On Mon wrote:</div>'
                '<blockquote>Old text about Year 3</blockquote></div>')
        text = html_to_text(html)
        self.assertEqual(strip_quoted(text), "New note")
        self.assertIn("Old text", text)  # full text keeps history for the expandable view

    def test_signature_and_greeting_removed_from_excerpt(self):
        body = "Dear Parents,\nThe library opens at 8am.\n-- \nSchool Office\n01234 567890"
        self.assertEqual(clean_new_content(body), "Dear Parents,\nThe library opens at 8am.")
        self.assertEqual(excerpt(body), "The library opens at 8am.")

    def test_angle_bracket_lines_and_forward_header(self):
        body = "Top line\n> quoted\nMore\n---------- Forwarded message ---------\nOld"
        self.assertEqual(strip_quoted(body), "Top line\nMore")

    def test_excerpt_truncates_on_word_boundary(self):
        ex = excerpt("word " * 200, limit=50)
        self.assertTrue(ex.endswith("…"))
        self.assertLessEqual(len(ex), 51)


if __name__ == "__main__":
    unittest.main()
