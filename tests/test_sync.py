import json
import os
import stat
import subprocess
import sys
import tempfile
import textwrap
import unittest

from kingsdash import config, gmail, storage
from kingsdash.gmail import GogClient, SyncError, build_item, sync_account
from kingsdash.service import Service, dedupe
from tests.helpers import PARENT, FakeClient, message, thread

ACCOUNT = PARENT
T0 = 1_790_000_000_000  # ms


def listing(*ids, has_more=False, token=None, count=1):
    return {"threads": [{"id": i, "date": "d", "internalDateIso": "x" + i, "from": "f", "subject": "s",
                         "messageCount": count} for i in ids],
            "has_more": has_more, "nextPageToken": token}


class BuildItemTests(unittest.TestCase):
    def test_latest_incoming_message_is_used_and_messages_deduped(self):
        msgs = [
            message("a", T0, plain="First notice", rfc_id="<1@x>"),
            message("b", T0 + 1000, plain="Second notice", rfc_id="<2@x>", attachments=1),
            message("b", T0 + 1000, plain="Second notice", rfc_id="<2@x>"),  # duplicate id
            message("c", T0 + 2000, sender="Me <%s>" % PARENT, plain="My reply. Please sign it."),
        ]
        item = build_item(ACCOUNT, thread("t1", msgs)["thread"])
        self.assertEqual(item["message_id"], "b")
        self.assertEqual(item["message_count"], 3)
        self.assertEqual(item["direction"], "incoming")
        self.assertIsNotNone(item["you_replied_at"])
        self.assertEqual(item["attachments_skipped"], 1)
        self.assertTrue(item["source_url"].startswith("https://mail.google.com/mail/?authuser="))
        self.assertTrue(item["source_url"].endswith("#all/b"))
        self.assertTrue(item["received_at"].startswith("2026-"))

    def test_outgoing_only_thread_marked_outgoing(self):
        item = build_item(ACCOUNT, thread("t1", [message("a", T0, sender=PARENT, plain="Hi")])["thread"])
        self.assertEqual(item["direction"], "outgoing")

    def test_cross_account_dedup_by_message_id(self):
        m = message("a", T0, plain="Same", rfc_id="<same@x>")
        i1 = build_item("one@example.invalid", thread("t1", [m])["thread"])
        i2 = build_item("two@example.invalid", thread("t9", [m])["thread"])
        older = build_item("one@example.invalid", thread("t2", [message("z", T0 - 5000, plain="Old")])["thread"])
        merged = dedupe([older, i1, i2])
        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[0]["accounts"], ["one@example.invalid", "two@example.invalid"])
        self.assertEqual(merged[1]["message_id"], "z")  # latest first


class SyncAccountTests(unittest.TestCase):
    def test_pagination_dedups_threads_and_reports_cap(self):
        pages = [listing("t1", "t2", has_more=True, token="1"),
                 listing("t2", "t3", has_more=True, token="2"),
                 listing("t4")]
        threads = {t: thread(t, [message("m" + t, T0 + i * 60000, plain="Body")])["thread"]
                   for i, t in enumerate(["t1", "t2", "t3", "t4"])}
        client = FakeClient(pages, threads)
        res = sync_account(client, ACCOUNT, config.DEFAULT_QUERY, {}, max_pages=2)
        self.assertEqual([c[3] for c in client.calls if c[0] == "search"], [None, "1"])
        self.assertEqual(res["coverage"]["threads_listed"], 3)
        self.assertTrue(res["coverage"]["more_available"])
        self.assertEqual([it["thread_id"] for it in res["items"]], ["t3", "t2", "t1"])

    def test_unchanged_threads_are_reused_not_refetched(self):
        threads = {"t1": thread("t1", [message("m1", T0, plain="Body")])["thread"]}
        first = sync_account(FakeClient([listing("t1")], threads), ACCOUNT, "q", {})
        client = FakeClient([listing("t1")], threads)
        second = sync_account(client, ACCOUNT, "q", first)
        self.assertEqual(second["coverage"]["reused"], 1)
        self.assertFalse([c for c in client.calls if c[0] == "thread"])

    def test_single_thread_failure_keeps_cached_copy(self):
        threads = {"t1": thread("t1", [message("m1", T0, plain="Body")])["thread"]}
        first = sync_account(FakeClient([listing("t1")], threads), ACCOUNT, "q", {})
        client = FakeClient([listing("t1", count=2)], threads, fail_threads={"t1"})
        second = sync_account(client, ACCOUNT, "q", first)
        self.assertEqual(second["coverage"]["failed"], 1)
        self.assertEqual(len(second["items"]), 1)

    def test_auth_failure_on_thread_aborts_account(self):
        class AuthClient(FakeClient):
            def thread(self, account, tid):
                raise SyncError("auth", gmail.auth_help(account))
        with self.assertRaises(SyncError):
            sync_account(AuthClient([listing("t1")], {}), ACCOUNT, "q", {})


class RefreshRetentionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = config.Env({"KINGSDASH_DATA_DIR": self.tmp.name})
        cfg = config.default_config()
        cfg["accounts"] = [ACCOUNT]
        cfg["profile"]["child_first_name"] = "Robin"
        config.save_config(self.env, cfg)

    def tearDown(self):
        self.tmp.cleanup()

    def test_failed_refresh_retains_last_good_items(self):
        threads = {"t1": thread("t1", [message("m1", T0, subject="Year 3 trip", plain="Trip")])["thread"]}
        svc = Service(self.env, client=FakeClient([listing("t1")], threads))
        self.assertTrue(svc.start_refresh(wait=True))
        feed = svc.feed()
        self.assertEqual(feed["connection"], "connected")
        self.assertEqual(len(feed["items"]), 1)
        good_time = feed["last_successful_refresh"]

        svc.client = FakeClient([], {}, fail_search=SyncError("auth", gmail.auth_help(ACCOUNT)))
        svc.start_refresh(wait=True)
        feed = svc.feed()
        self.assertEqual(feed["connection"], "error")
        self.assertEqual(len(feed["items"]), 1, "old data must not be cleared")
        self.assertEqual(feed["last_successful_refresh"], good_time)
        self.assertEqual(feed["accounts"][0]["error"]["kind"], "auth")
        self.assertIn("re-authorising", feed["accounts"][0]["error"]["message"])

    def test_overlapping_refresh_refused(self):
        svc = Service(self.env, client=FakeClient([listing()], {}))
        self.assertTrue(svc._refresh_lock.acquire(blocking=False))
        try:
            self.assertFalse(svc.start_refresh())
        finally:
            svc._refresh_lock.release()

    def test_failed_refresh_after_query_change_labels_old_data(self):
        threads = {"t1": thread("t1", [message("m1", T0, plain="School notice")])["thread"]}
        svc = Service(self.env, client=FakeClient([listing("t1")], threads))
        svc.start_refresh(wait=True)
        cfg = svc.get_config()
        cfg["query"] = "from:new-school.example"
        svc.save_config(cfg)
        svc.client = FakeClient([], {}, fail_search=SyncError("auth", "Reconnect"))
        svc.start_refresh(wait=True)
        self.assertTrue(svc.feed()["accounts"][0]["stale_query"])
        self.assertEqual(len(svc.feed()["items"]), 1)

    def test_state_files_are_private(self):
        svc = Service(self.env, client=FakeClient([listing()], {}))
        svc.start_refresh(wait=True)
        mode = stat.S_IMODE(os.stat(self.env.state_path).st_mode)
        self.assertEqual(mode, 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(self.tmp.name).st_mode), 0o700)

    def test_no_accounts_means_no_items_and_no_fabrication(self):
        config.save_config(self.env, config.default_config())
        svc = Service(self.env, client=FakeClient([], {}))
        svc.start_refresh(wait=True)
        feed = svc.feed()
        self.assertEqual(feed["items"], [])
        self.assertEqual(feed["connection"], "not_configured")

    def test_demo_mode_is_marked_synthetic(self):
        cfg = config.load_config(self.env)
        cfg["demo_mode"] = True
        config.save_config(self.env, cfg)
        feed = Service(self.env, client=FakeClient([], {})).feed()
        self.assertEqual(feed["mode"], "demo")
        self.assertTrue(feed["items"])
        self.assertTrue(all(it["synthetic"] and it["source_url"] is None for it in feed["items"]))
        self.assertTrue(all(it["subject"].startswith("SAMPLE") for it in feed["items"]))

    def test_marks_persist_locally_and_validate(self):
        svc = Service(self.env, client=FakeClient([], {}))
        svc.set_mark("abc123", {"done": True})
        self.assertTrue(svc.load_marks()["abc123"]["done"])
        svc.set_mark("abc123", {"done": False})
        self.assertNotIn("abc123", svc.load_marks())
        for bad in [("../x", {"done": True}), ("k", {"done": "yes"}), ("k", {"delete": True})]:
            with self.assertRaises(config.ValidationError):
                svc.set_mark(*bad)


class AtomicStorageTests(unittest.TestCase):
    def test_corrupt_file_falls_back_to_default(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "s.json")
            with open(p, "w") as fh:
                fh.write("{not json")
            self.assertEqual(storage.read_json(p, {"ok": 1}), {"ok": 1})
            storage.write_json_atomic(p, {"a": 1})
            self.assertEqual(storage.read_json(p, None), {"a": 1})
            self.assertEqual([f for f in os.listdir(d) if f.startswith(".tmp-")], [])


class GogClientTests(unittest.TestCase):
    def _fake_bin(self, d, script):
        path = os.path.join(d, "fake-gog")
        with open(path, "w") as fh:
            fh.write("#!%s\n%s" % (sys.executable, textwrap.dedent(script)))
        os.chmod(path, 0o700)
        return path

    def test_command_shape_is_read_only(self):
        seen = []

        def runner(argv, timeout):
            seen.append(argv)
            out = {"threads": [], "has_more": False} if "search" in argv else \
                {"thread": {"id": "t1", "messages": []}}
            return subprocess.CompletedProcess(argv, 0, json.dumps(out).encode(), b"")

        c = GogClient("gog-authenticated", runner=runner)
        c.search(ACCOUNT, config.DEFAULT_QUERY, page="TOKEN1")
        c.thread(ACCOUNT, "t1")
        self.assertEqual(seen[0], ["gog-authenticated", "--account", ACCOUNT, "--readonly", "--no-input",
                                   "gmail", "search", config.DEFAULT_QUERY, "--max", "50", "--json",
                                   "--page", "TOKEN1"])
        self.assertEqual(seen[1], ["gog-authenticated", "--account", ACCOUNT, "--readonly", "--no-input",
                                   "gmail", "thread", "get", "t1", "--json"])
        with self.assertRaises(ValueError):
            c.build_argv(ACCOUNT, ["gmail", "send", "x"])
        with self.assertRaises(SyncError):
            c.thread(ACCOUNT, "--evil")

    def test_query_starting_with_dash_not_treated_as_flag(self):
        seen = []

        def runner(argv, timeout):
            seen.append(argv)
            return subprocess.CompletedProcess(argv, 0, b'{"threads": []}', b"")

        GogClient("g", runner=runner).search(ACCOUNT, "-in:spam")
        self.assertEqual(seen[0][7], " -in:spam")

    def test_real_subprocess_timeout_and_auth_and_secret_redaction(self):
        with tempfile.TemporaryDirectory() as d:
            slow = self._fake_bin(d, "import time; time.sleep(10)\n")
            with self.assertRaises(SyncError) as cm:
                GogClient(slow, timeout=1).search(ACCOUNT, "q")
            self.assertEqual(cm.exception.kind, "timeout")

            auth = self._fake_bin(d, "import sys; sys.stderr.write('oauth2: invalid_grant token expired "
                                     "ya29.SECRETSECRETSECRETSECRET'); sys.exit(1)\n")
            with self.assertRaises(SyncError) as cm:
                GogClient(auth, timeout=5).search(ACCOUNT, "q")
            self.assertEqual(cm.exception.kind, "auth")
            self.assertNotIn("SECRET", cm.exception.message)

            other = self._fake_bin(d, "import sys; sys.stderr.write('boom refresh_tok=abc access_token=AAAA"
                                      "BBBBCCCCDDDDEEEEFFFFGGGG at /home/u/.config/x'); sys.exit(3)\n")
            with self.assertRaises(SyncError) as cm:
                GogClient(other, timeout=5).search(ACCOUNT, "q")
            self.assertNotIn("AAAA", cm.exception.message)
            self.assertNotIn("/home/u", cm.exception.message)

            ok = self._fake_bin(d, "import json; print(json.dumps({'threads': [{'id': 't1'}], 'has_more': False}))\n")
            self.assertEqual(GogClient(ok).search(ACCOUNT, "q")["threads"][0]["id"], "t1")

    def test_missing_helper_is_friendly(self):
        with self.assertRaises(SyncError) as cm:
            GogClient("/nonexistent/gog-authenticated").search(ACCOUNT, "q")
        self.assertEqual(cm.exception.kind, "helper_missing")


class ConfigValidationTests(unittest.TestCase):
    def test_rejects_bad_values(self):
        bad = [
            {"accounts": ["--account=evil"]},
            {"accounts": "x@example.invalid"},
            {"profile": {"year_group": 14}},
            {"profile": {"year_group": True}},
            {"profile": {"child_first_name": "<script>"}},
            {"refresh_minutes": 1},
            {"query": "x" * 1000},
            {"demo_mode": "yes"},
            {"surprise": 1},
            [],
        ]
        for raw in bad:
            with self.subTest(raw=raw):
                with self.assertRaises(config.ValidationError):
                    config.validate_config(raw)

    def test_accepts_and_normalises(self):
        cfg = config.validate_config({"profile": {"child_first_name": "  Robin ", "year_group": 3,
                                                  "activities": ["Chess Club", "chess club", " "]},
                                      "accounts": ["a@example.com", "A@example.com"], "query": "",
                                      "refresh_minutes": 30, "demo_mode": False})
        self.assertEqual(cfg["profile"]["child_first_name"], "Robin")
        self.assertEqual(cfg["profile"]["activities"], ["Chess Club"])
        self.assertEqual(cfg["accounts"], ["a@example.com"])
        self.assertEqual(cfg["query"], config.DEFAULT_QUERY)


if __name__ == "__main__":
    unittest.main()
