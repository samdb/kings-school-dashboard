"""Read-only Gmail sync through the gog-authenticated helper.

Only two subcommands are ever issued, both with --readonly --no-input:
  gmail search QUERY --max 50 --json [--page TOKEN]
  gmail thread get ID --json
"""

import hashlib
import html
import json
import re
import subprocess
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote

from . import mime
from .textclean import clean_new_content, excerpt

PAGE_SIZE = 50
_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")  # never starts with "-" (no flag injection)
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_.~+/=][A-Za-z0-9_.~+/=-]{0,511}$")
_ALLOWED_SUBCOMMANDS = {("gmail", "search"), ("gmail", "thread")}

_AUTH_HINTS = re.compile(
    r"invalid_grant|token (?:has )?(?:been )?(?:expired|revoked)|expired token|reauth|re-auth|"
    r"unauthori[sz]ed|\b401\b|login required|not authenticated|no (?:stored )?(?:token|credentials)|"
    r"refresh token|consent required|auth(?:entication|orization)? (?:failed|required|error)", re.I)
_SECRETISH = re.compile(
    r"(?i)(bearer\s+\S+|(?:access|refresh|id)_token\S*|(?:client_)?secret\S*|password\S*|"
    r"(?:api[_-]?)?key=\S+|ya29\.\S+|[A-Za-z0-9_\-/+=.]{24,})")


class SyncError(Exception):
    def __init__(self, kind, message):
        super().__init__(message)
        self.kind = kind
        self.message = message


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sanitize_detail(text, limit=160):
    """Short, credential-free diagnostic line from helper output."""
    line = ""
    for candidate in (text or "").splitlines():
        if candidate.strip():
            line = candidate.strip()
            break
    line = _SECRETISH.sub("[redacted]", line)
    line = re.sub(r"(/[\w.-]+){2,}", "[path]", line)
    return line[:limit]


def auth_help(account):
    return ("Gmail access for %s needs re-authorising. On the machine running this dashboard, "
            "re-run your gog sign-in for this account (see README › Expired Gmail access), then press "
            "Refresh. Previously loaded emails are still shown." % account)


class GogClient:
    def __init__(self, binary, timeout=45, runner=None):
        self.binary = binary
        self.timeout = timeout
        self.runner = runner or self._subprocess_runner

    def _subprocess_runner(self, argv, timeout):
        return subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout,
                              check=False, shell=False)

    def build_argv(self, account, sub):
        if tuple(sub[:2]) not in _ALLOWED_SUBCOMMANDS:
            raise ValueError("refusing non-read-only helper command")
        if not account or account.startswith("-"):
            raise ValueError("invalid account")
        return [self.binary, "--account", account, "--readonly", "--no-input"] + list(sub)

    def _run(self, account, sub):
        argv = self.build_argv(account, sub)
        try:
            proc = self.runner(argv, self.timeout)
        except FileNotFoundError:
            raise SyncError("helper_missing",
                            "The Gmail helper '%s' was not found. Install it or set KINGSDASH_GOG_BIN."
                            % self.binary.rsplit("/", 1)[-1])
        except PermissionError:
            raise SyncError("helper_missing", "The Gmail helper is not executable.")
        except subprocess.TimeoutExpired:
            raise SyncError("timeout", "Gmail did not respond within %d seconds." % self.timeout)
        stdout = proc.stdout.decode("utf-8", "replace") if isinstance(proc.stdout, bytes) else (proc.stdout or "")
        stderr = proc.stderr.decode("utf-8", "replace") if isinstance(proc.stderr, bytes) else (proc.stderr or "")
        if proc.returncode != 0:
            if _AUTH_HINTS.search(stderr) or _AUTH_HINTS.search(stdout[:2000]):
                raise SyncError("auth", auth_help(account))
            detail = sanitize_detail(stderr or stdout)
            raise SyncError("helper_error", "Gmail helper failed (exit %s)%s" %
                            (proc.returncode, (": " + detail) if detail else "."))
        try:
            return json.loads(stdout)
        except ValueError:
            if _AUTH_HINTS.search(stdout[:2000]) or _AUTH_HINTS.search(stderr):
                raise SyncError("auth", auth_help(account))
            raise SyncError("bad_output", "Gmail helper returned unreadable output.")

    def search(self, account, query, page=None):
        q = query if not query.startswith("-") else " " + query  # never parsed as a flag
        sub = ["gmail", "search", q, "--max", str(PAGE_SIZE), "--json"]
        if page:
            sub += ["--page", page]
        data = self._run(account, sub)
        if not isinstance(data, dict) or not isinstance(data.get("threads", []), list):
            raise SyncError("bad_output", "Unexpected search response from Gmail helper.")
        return data

    def thread(self, account, thread_id):
        if not _ID_RE.match(thread_id or ""):
            raise SyncError("bad_output", "Invalid thread id from Gmail helper.")
        data = self._run(account, ["gmail", "thread", "get", thread_id, "--json"])
        thread = data.get("thread") if isinstance(data, dict) else None
        if not isinstance(thread, dict) or not isinstance(thread.get("messages"), list):
            raise SyncError("bad_output", "Unexpected thread response from Gmail helper.")
        return thread


def _received(msg, headers):
    try:
        ms = int(msg.get("internalDate"))
        return datetime.fromtimestamp(ms / 1000, timezone.utc).replace(microsecond=0).isoformat()
    except (TypeError, ValueError, OverflowError, OSError):
        pass
    try:
        dt = parsedate_to_datetime(headers.get("date", ""))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()
    except (TypeError, ValueError, IndexError):
        return None


def item_key(rfc_id, account, thread_id, message_id):
    basis = ("rfc:" + rfc_id.strip().lower()) if rfc_id else "gm:%s:%s:%s" % (account.lower(), thread_id, message_id)
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()[:24]


def source_url(account, message_id):
    return "https://mail.google.com/mail/?authuser=%s#all/%s" % (quote(account, safe="@"), quote(message_id, safe=""))


def build_item(account, thread):
    """Reduce one Gmail thread to a single feed item based on its latest message.

    The latest *incoming* message is preferred so a parent's own reply never
    replaces the school's content (and never generates "actions").
    """
    acct = account.lower()
    seen, parsed = set(), []
    for msg in thread.get("messages") or []:
        if not isinstance(msg, dict):
            continue
        mid = msg.get("id")
        if not isinstance(mid, str) or not _ID_RE.match(mid) or mid in seen:
            continue
        seen.add(mid)
        payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
        headers = mime.header_map(payload)
        sender = mime.display_sender(headers.get("from", ""))
        parsed.append({
            "msg": msg, "payload": payload, "headers": headers, "sender": sender,
            "received": _received(msg, headers),
            "outgoing": sender["address"] == acct,
        })
    if not parsed:
        return None
    parsed.sort(key=lambda p: p["received"] or "")
    incoming = [p for p in parsed if not p["outgoing"]]
    chosen = incoming[-1] if incoming else parsed[-1]
    later_outgoing = [p for p in parsed if p["outgoing"] and (p["received"] or "") > (chosen["received"] or "")]

    text, kind, attachments = mime.extract_text(chosen["payload"])
    if not text.strip():
        text = html.unescape(chosen["msg"].get("snippet") or "")
        kind = "snippet"
    headers = chosen["headers"]
    rfc_id = headers.get("message-id", "")
    new_text = clean_new_content(text)
    thread_id = thread.get("id") if isinstance(thread.get("id"), str) and _ID_RE.match(thread["id"]) else ""
    message_id = chosen["msg"]["id"]
    return {
        "key": item_key(rfc_id, account, thread_id, message_id),
        "account": account,
        "accounts": [account],
        "thread_id": thread_id,
        "message_id": message_id,
        "rfc_message_id": rfc_id[:300],
        "subject": (headers.get("subject") or "(no subject)")[:300],
        "from_name": chosen["sender"]["name"][:200],
        "from_address": chosen["sender"]["address"][:200],
        "received_at": chosen["received"],
        "direction": "outgoing" if chosen["outgoing"] else "incoming",
        "you_replied_at": later_outgoing[-1]["received"] if later_outgoing else None,
        "message_count": len(parsed),
        "excerpt": excerpt(text),
        "new_text": new_text,
        "full_text": text,
        "body_source": kind,
        "attachments_skipped": attachments,
        "source_url": source_url(account, message_id),
    }


def sync_account(client, account, query, previous, max_pages=4, max_threads=200, deadline=None):
    """Return a fresh account-state dict. Raises SyncError if listing fails entirely."""
    prev_items = {it.get("thread_id"): it for it in (previous or {}).get("items", []) if isinstance(it, dict)}
    prev_meta = (previous or {}).get("thread_meta", {}) or {}

    listed, order = {}, []
    page, pages, has_more = None, 0, False
    while pages < max_pages:
        data = client.search(account, query, page)
        pages += 1
        for t in data.get("threads") or []:
            if not isinstance(t, dict) or not _ID_RE.match(str(t.get("id", ""))):
                continue
            if t["id"] not in listed:
                listed[t["id"]] = t
                order.append(t["id"])
        token = data.get("nextPageToken")
        has_more = bool(data.get("has_more") or token)
        if not has_more or len(order) >= max_threads:
            break
        if not isinstance(token, str) or not _TOKEN_RE.match(token) or token == page:
            break
        page = token
    page_cap_hit = has_more
    thread_cap_hit = len(order) > max_threads
    order = order[:max_threads]

    items, meta = [], {}
    fetched = reused = failed = 0
    budget_hit = False
    errors = []
    for tid in order:
        info = listed[tid]
        sig = "%s|%s" % (info.get("messageCount"), info.get("internalDateIso") or info.get("date"))
        cached = prev_items.get(tid)
        if cached and prev_meta.get(tid) == sig:
            items.append(cached)
            meta[tid] = sig
            reused += 1
            continue
        if deadline is not None and time.monotonic() > deadline:
            budget_hit = True
            if cached:
                items.append(cached)
                meta[tid] = prev_meta.get(tid, "")
            continue
        try:
            item = build_item(account, client.thread(account, tid))
        except SyncError as exc:
            if exc.kind in ("auth", "helper_missing"):
                raise
            failed += 1
            errors.append(exc.message)
            if cached:
                items.append(cached)
                meta[tid] = prev_meta.get(tid, "")
            continue
        fetched += 1
        if item:
            items.append(item)
            meta[tid] = sig

    items.sort(key=lambda it: it.get("received_at") or "", reverse=True)
    coverage = {
        "threads_listed": len(order),
        "pages": pages,
        "fetched": fetched,
        "reused": reused,
        "failed": failed,
        "more_available": page_cap_hit or thread_cap_hit,
        "budget_hit": budget_hit,
    }
    return {
        "items": items,
        "thread_meta": meta,
        "coverage": coverage,
        "partial_errors": errors[:3],
    }
