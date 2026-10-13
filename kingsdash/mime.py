"""Decode Gmail API message payloads into plain text. Attachments are skipped, only counted."""

import base64
import binascii
import codecs
import re
from email.header import decode_header, make_header
from email.utils import getaddresses, parseaddr

from .textclean import html_to_text

MAX_BODY_CHARS = 60000
_CHARSET_RE = re.compile(r'charset\s*=\s*"?([A-Za-z0-9._:-]+)"?', re.I)


def b64url_decode(data):
    if not isinstance(data, str) or not data:
        return b""
    data = data.strip().replace("\n", "").replace("\r", "")
    data += "=" * (-len(data) % 4)
    try:
        return base64.urlsafe_b64decode(data.encode("ascii"))
    except (binascii.Error, ValueError, UnicodeEncodeError):
        try:
            return base64.b64decode(data.encode("ascii"), validate=False)
        except (binascii.Error, ValueError, UnicodeEncodeError):
            return b""


def header_map(payload):
    """Lower-cased header name -> first value (MIME encoded-words decoded)."""
    out = {}
    headers = payload.get("headers") if isinstance(payload, dict) else None
    for h in headers or []:
        if not isinstance(h, dict):
            continue
        name, value = h.get("name"), h.get("value")
        if not isinstance(name, str) or not isinstance(value, str):
            continue
        key = name.lower()
        if key not in out:
            out[key] = decode_mime_words(value)
    return out


def decode_mime_words(value):
    try:
        return str(make_header(decode_header(value)))
    except Exception:  # malformed encoded-words: fall back to raw text
        return value


def _charset(part_headers, default="utf-8"):
    ctype = part_headers.get("content-type", "")
    m = _CHARSET_RE.search(ctype)
    charset = m.group(1).lower() if m else default
    try:
        codecs.lookup(charset)
    except LookupError:
        charset = "utf-8"
    return charset


def _is_attachment(part, part_headers):
    if part.get("filename"):
        return True
    disp = part_headers.get("content-disposition", "").lower()
    if disp.startswith("attachment"):
        return True
    body = part.get("body") or {}
    mime = (part.get("mimeType") or "").lower()
    if body.get("attachmentId") and not body.get("data"):
        return True
    return not (mime.startswith("text/") or mime.startswith("multipart/") or mime == "message/rfc822"
                or mime == "")


def _walk(part, plains, htmls, counters, depth=0):
    if not isinstance(part, dict) or depth > 25:
        return
    headers = header_map(part)
    mime = (part.get("mimeType") or "").lower()
    children = part.get("parts")
    if isinstance(children, list) and children:
        for child in children:
            _walk(child, plains, htmls, counters, depth + 1)
        return
    if depth > 0 and _is_attachment(part, headers):
        counters["attachments"] += 1
        return
    body = part.get("body") or {}
    raw = b64url_decode(body.get("data"))
    if not raw:
        return
    text = raw.decode(_charset(headers), errors="replace")
    if mime == "text/html":
        htmls.append(text)
    elif mime in ("text/plain", "") or depth == 0 and mime.startswith("text/"):
        plains.append(text)


def extract_text(payload):
    """Return (text, source_kind, attachment_count). Prefers text/plain over HTML."""
    plains, htmls = [], []
    counters = {"attachments": 0}
    _walk(payload or {}, plains, htmls, counters)
    if any(p.strip() for p in plains):
        text, kind = "\n\n".join(p for p in plains if p.strip()), "plain"
    elif htmls:
        text, kind = "\n\n".join(html_to_text(h) for h in htmls), "html"
    else:
        text, kind = "", "none"
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    if len(text) > MAX_BODY_CHARS:
        text = text[:MAX_BODY_CHARS] + "\n\n[Message truncated in the dashboard — open the email for the rest.]"
    return text, kind, counters["attachments"]


def addresses(value):
    return [addr.lower() for _, addr in getaddresses([value or ""]) if addr]


def display_sender(value):
    name, addr = parseaddr(value or "")
    return {"name": name.strip() or addr, "address": addr.lower()}
