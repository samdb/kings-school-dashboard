"""Synthetic Gmail-shaped fixtures. No real names, addresses or school messages."""

import base64

SCHOOL = "Office <office@example-school.invalid>"
PARENT = "parent@example.invalid"


def b64(text):
    return base64.urlsafe_b64encode(text.encode("utf-8")).decode("ascii").rstrip("=")


def message(mid, ms, sender=SCHOOL, subject="Notice", plain=None, html=None, attachments=0,
            rfc_id=None, charset="utf-8"):
    headers = [{"name": "From", "value": sender}, {"name": "Subject", "value": subject},
               {"name": "To", "value": PARENT}]
    if rfc_id:
        headers.append({"name": "Message-ID", "value": rfc_id})
    parts = []
    if plain is not None:
        parts.append({"mimeType": "text/plain",
                      "headers": [{"name": "Content-Type", "value": "text/plain; charset=%s" % charset}],
                      "body": {"data": base64.urlsafe_b64encode(plain.encode(charset)).decode()}})
    if html is not None:
        parts.append({"mimeType": "text/html",
                      "headers": [{"name": "Content-Type", "value": "text/html; charset=utf-8"}],
                      "body": {"data": b64(html)}})
    alt = {"mimeType": "multipart/alternative", "parts": parts, "body": {}}
    att_parts = [{"mimeType": "application/pdf", "filename": "letter%d.pdf" % i,
                  "headers": [{"name": "Content-Disposition", "value": 'attachment; filename="x.pdf"'}],
                  "body": {"attachmentId": "ATT%d" % i, "size": 1000}} for i in range(attachments)]
    payload = {"mimeType": "multipart/mixed", "headers": headers, "body": {},
               "parts": [alt] + att_parts}
    return {"id": mid, "internalDate": str(ms), "snippet": "snippet text", "payload": payload}


def thread(tid, messages):
    return {"thread": {"id": tid, "messages": messages}}


class FakeClient:
    """Stands in for GogClient: canned search pages and threads; records calls."""

    def __init__(self, pages, threads, fail_search=None, fail_threads=()):
        self.pages = pages              # list of search-response dicts
        self.threads = threads          # thread_id -> thread dict (inner "thread")
        self.fail_search = fail_search  # SyncError to raise on search
        self.fail_threads = set(fail_threads)
        self.calls = []

    def search(self, account, query, page=None):
        self.calls.append(("search", account, query, page))
        if self.fail_search:
            raise self.fail_search
        idx = 0 if page is None else int(page)
        return self.pages[idx]

    def thread(self, account, tid):
        from kingsdash.gmail import SyncError
        self.calls.append(("thread", account, tid))
        if tid in self.fail_threads:
            raise SyncError("helper_error", "Gmail helper failed (exit 1).")
        return self.threads[tid]
