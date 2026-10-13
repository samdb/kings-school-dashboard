"""Refresh orchestration (no overlap, last-good retention), scheduling and feed assembly."""

import logging
import re
import threading
import time
from datetime import datetime, timezone

from . import config as cfgmod
from . import demo, matching, storage
from .gmail import GogClient, SyncError, now_iso, sync_account

log = logging.getLogger("kingsdash")
MARK_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
MAX_MARKS = 5000


def _parse_iso(value):
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


class Service:
    def __init__(self, env, client=None):
        self.env = env
        storage.ensure_private_dir(env.data_dir)
        self.client = client or GogClient(env.gog_bin, env.command_timeout)
        self._refresh_lock = threading.Lock()
        self._state_lock = threading.RLock()
        self._marks_lock = threading.Lock()
        self.status = {"running": False, "started_at": None, "trigger": None, "account": None}
        self._stop = threading.Event()
        self._wake = threading.Event()

    # ---------- config ----------
    def get_config(self):
        return cfgmod.load_config(self.env)

    def save_config(self, raw):
        clean = cfgmod.validate_config(raw)
        cfgmod.save_config(self.env, clean)
        self._wake.set()
        return clean

    # ---------- state ----------
    def load_state(self):
        with self._state_lock:
            state = storage.read_json(self.env.state_path, None)
        if not isinstance(state, dict):
            state = {}
        state.setdefault("version", 1)
        state.setdefault("accounts", {})
        state.setdefault("last_run", None)
        return state

    def _save_account_state(self, account, entry):
        with self._state_lock:
            state = self.load_state()
            state["accounts"][account] = entry
            storage.write_json_atomic(self.env.state_path, state)

    def _save_last_run(self, info, accounts):
        with self._state_lock:
            state = self.load_state()
            state["last_run"] = info
            # Forget accounts the user removed from settings.
            keep = {a.lower() for a in accounts}
            state["accounts"] = {a: v for a, v in state["accounts"].items() if a.lower() in keep}
            storage.write_json_atomic(self.env.state_path, state)

    # ---------- refresh ----------
    def start_refresh(self, trigger="manual", wait=False):
        """Start a background refresh. Returns False if one is already running."""
        if not self._refresh_lock.acquire(blocking=False):
            return False
        self.status.update(running=True, started_at=now_iso(), trigger=trigger, account=None)

        def runner():
            try:
                self._refresh()
            except Exception:  # never let the worker die silently with the lock held
                log.exception("refresh crashed")
            finally:
                self.status.update(running=False, account=None)
                self._refresh_lock.release()

        if wait:
            runner()
        else:
            threading.Thread(target=runner, name="kingsdash-refresh", daemon=True).start()
        return True

    def _refresh(self):
        cfg = self.get_config()
        started = now_iso()
        if cfg["demo_mode"] or not cfg["accounts"]:
            self._save_last_run({"started": started, "finished": now_iso(), "ok": None,
                                 "skipped": "demo" if cfg["demo_mode"] else "no_accounts"}, cfg["accounts"])
            return
        deadline = time.monotonic() + self.env.refresh_budget
        ok_all = True
        for account in cfg["accounts"]:
            self.status["account"] = account
            previous = self.load_state()["accounts"].get(account) or {}
            entry = dict(previous)
            entry["last_attempt"] = now_iso()
            try:
                result = sync_account(self.client, account, cfg["query"], previous,
                                      self.env.max_pages, self.env.max_threads, deadline)
            except SyncError as exc:
                ok_all = False
                entry["error"] = {"kind": exc.kind, "message": exc.message, "at": now_iso()}
                # Items/coverage from the last good sync are deliberately left untouched.
            except Exception:
                log.exception("unexpected sync failure")
                ok_all = False
                entry["error"] = {"kind": "internal", "message": "Unexpected error while syncing; "
                                  "previous emails kept.", "at": now_iso()}
            else:
                entry.update(result)
                entry["query"] = cfg["query"]
                entry["error"] = None
                entry["last_success"] = now_iso()
                if result["coverage"]["failed"]:
                    ok_all = False
            self._save_account_state(account, entry)
        self._save_last_run({"started": started, "finished": now_iso(), "ok": ok_all}, cfg["accounts"])

    # ---------- scheduler ----------
    def _due(self, cfg, state):
        if cfg["demo_mode"] or not cfg["accounts"]:
            return False
        last = _parse_iso((state.get("last_run") or {}).get("started"))
        if not last:
            return True
        return (datetime.now(timezone.utc) - last).total_seconds() >= cfg["refresh_minutes"] * 60

    def scheduler_loop(self, tick=20):
        while not self._stop.is_set():
            try:
                if self._due(self.get_config(), self.load_state()):
                    self.start_refresh("scheduled")
            except Exception:
                log.exception("scheduler tick failed")
            self._wake.wait(tick)
            self._wake.clear()

    def start_scheduler(self):
        threading.Thread(target=self.scheduler_loop, name="kingsdash-scheduler", daemon=True).start()

    def stop(self):
        self._stop.set()
        self._wake.set()

    # ---------- marks (local only, never written to Gmail) ----------
    def load_marks(self):
        marks = storage.read_json(self.env.marks_path, {})
        return marks if isinstance(marks, dict) else {}

    def set_mark(self, key, changes):
        if not isinstance(key, str) or not MARK_KEY_RE.match(key):
            raise cfgmod.ValidationError("Invalid item key.")
        if not isinstance(changes, dict) or not changes or set(changes) - {"saved", "done", "dismissed"}:
            raise cfgmod.ValidationError("Marks may only set saved, done or dismissed.")
        if not all(isinstance(v, bool) for v in changes.values()):
            raise cfgmod.ValidationError("Mark values must be true or false.")
        with self._marks_lock:
            marks = self.load_marks()
            entry = dict(marks.get(key) or {})
            entry.update(changes)
            entry["updated"] = now_iso()
            if not (entry.get("saved") or entry.get("done") or entry.get("dismissed")):
                marks.pop(key, None)
            else:
                marks[key] = entry
            if len(marks) > MAX_MARKS:
                for old in sorted(marks, key=lambda k: marks[k].get("updated", ""))[:len(marks) - MAX_MARKS]:
                    marks.pop(old, None)
            storage.write_json_atomic(self.env.marks_path, marks)
            return marks.get(key, {"saved": False, "done": False, "dismissed": False})

    # ---------- feed ----------
    def feed(self):
        cfg = self.get_config()
        state = self.load_state()
        marks = self.load_marks()
        profile = cfg["profile"]
        demo_mode = cfg["demo_mode"]

        accounts_out = []
        raw_items = []
        if demo_mode:
            raw_items = demo.demo_items(profile)
        for account in cfg["accounts"]:
            entry = state["accounts"].get(account) or {}
            accounts_out.append({
                "account": account,
                "last_success": entry.get("last_success"),
                "last_attempt": entry.get("last_attempt"),
                "error": entry.get("error"),
                "coverage": entry.get("coverage"),
                "partial_errors": entry.get("partial_errors") or [],
                "item_count": len(entry.get("items") or []),
                "stale_query": bool(entry.get("items")) and entry.get("query") not in (None, cfg["query"]),
            })
            if not demo_mode:
                raw_items.extend(it for it in entry.get("items") or [] if isinstance(it, dict))

        items = dedupe(raw_items)
        out = []
        for it in items:
            match = matching.classify(it.get("subject"), it.get("new_text"), profile,
                                      outgoing=it.get("direction") == "outgoing")
            mark = marks.get(it["key"]) or {}
            row = dict(it)
            row["match"] = match
            row["mark"] = {k: bool(mark.get(k)) for k in ("saved", "done", "dismissed")}
            out.append(row)

        successes = [a["last_success"] for a in accounts_out if a["last_success"]]
        errors = [a for a in accounts_out if a["error"]]
        if demo_mode:
            connection = "demo"
        elif not cfg["accounts"]:
            connection = "not_configured"
        elif not successes and not errors:
            connection = "never_synced"
        elif errors and len(errors) == len(accounts_out):
            connection = "error"
        elif errors:
            connection = "partial"
        else:
            connection = "connected"
        return {
            "mode": "demo" if demo_mode else "live",
            "connection": connection,
            "last_successful_refresh": max(successes) if successes else None,
            "last_run": state.get("last_run"),
            "refresh": dict(self.status),
            "refresh_minutes": cfg["refresh_minutes"],
            "query": cfg["query"],
            "profile": profile,
            "accounts": accounts_out,
            "items": out,
            "generated_at": now_iso(),
        }


def dedupe(items):
    """Merge the same email seen in several family accounts or listed twice; latest first."""
    by_key = {}
    for it in items:
        key = it.get("key")
        if not key:
            continue
        if key in by_key:
            existing = by_key[key]
            for acc in it.get("accounts") or [it.get("account")]:
                if acc and acc not in existing["accounts"]:
                    existing["accounts"].append(acc)
            continue
        copy = dict(it)
        copy["accounts"] = list(it.get("accounts") or [it.get("account")])
        by_key[key] = copy
    return sorted(by_key.values(), key=lambda it: it.get("received_at") or "", reverse=True)
