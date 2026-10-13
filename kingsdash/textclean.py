"""Safe HTML-to-text conversion, quoted-history and signature removal, excerpts."""

import html
import re
from html.parser import HTMLParser

_BLOCK_TAGS = {
    "p", "div", "br", "li", "ul", "ol", "tr", "table", "h1", "h2", "h3", "h4", "h5", "h6",
    "section", "article", "header", "footer", "blockquote", "hr", "td", "th", "dd", "dt",
}
_SKIP_TAGS = {"script", "style", "head", "title", "noscript", "template", "svg", "iframe", "object"}


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in _SKIP_TAGS:
            self.skip += 1
            return
        attrs = dict((k, v or "") for k, v in attrs)
        cls = attrs.get("class", "").lower()
        # Gmail / Apple Mail / Outlook wrap previous messages in these containers.
        if "gmail_quote" in cls or "gmail_attr" in cls or attrs.get("id") == "divRplyFwdMsg" \
                or (tag == "blockquote" and attrs.get("type", "").lower() == "cite"):
            self.out.append("\n\x01QUOTE\x01\n")
        if tag in _BLOCK_TAGS:
            self.out.append("\n")
        if tag == "li":
            self.out.append("• ")

    def handle_startendtag(self, tag, attrs):
        if tag in ("br", "hr"):
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in _SKIP_TAGS:
            self.skip = max(0, self.skip - 1)
            return
        if tag in _BLOCK_TAGS:
            self.out.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def html_to_text(markup):
    """Convert HTML to plain text. Output is only ever rendered via textContent."""
    parser = _TextExtractor()
    try:
        parser.feed(markup or "")
        parser.close()
    except Exception:
        return re.sub(r"<[^>]*>", " ", html.unescape(markup or ""))
    text = "".join(parser.out).replace("\xa0", " ")
    # Marker becomes a recognisable quoted-history boundary for strip_quoted().
    text = text.replace("\x01QUOTE\x01", "\n" + QUOTE_MARKER + "\n")
    lines = [re.sub(r"[ \t\f\v]+", " ", ln).strip() for ln in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


QUOTE_MARKER = "––– earlier messages in this thread –––"

_QUOTE_HEADER_RES = [
    re.compile(r"^On\b.{0,300}\bwrote:\s*$", re.I),
    re.compile(r"^-{2,}\s*Original Message\s*-{2,}", re.I),
    re.compile(r"^-{2,}\s*Forwarded message\s*-{2,}", re.I),
    re.compile(r"^_{8,}\s*$"),
    re.compile(r"^Begin forwarded message:", re.I),
    re.compile(r"^Le .{0,200} a écrit\s*:\s*$", re.I),
]
_OUTLOOK_FROM = re.compile(r"^\*?From:\*?\s.+", re.I)
_OUTLOOK_NEXT = re.compile(r"^\*?(Sent|Date|To|Subject|Cc):\*?\s", re.I)

_SIGNATURE_RES = [
    re.compile(r"^--\s*$"),
    re.compile(r"^Sent from my (iPhone|iPad|Android|mobile|Galaxy|phone)", re.I),
    re.compile(r"^Get Outlook for ", re.I),
]
_DISCLAIMER_RE = re.compile(
    r"^(This (e-?mail|message) (and any|is|contains|may)|DISCLAIMER|CONFIDENTIALITY|"
    r"The information (in|contained in) this (e-?mail|message))", re.I)


def strip_quoted(text):
    """Return only the newly written part of a message (no quoted history)."""
    lines = (text or "").split("\n")
    kept = []
    i = 0
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if s == QUOTE_MARKER:
            break
        if s.startswith(">"):
            i += 1
            continue
        if any(r.match(s) for r in _QUOTE_HEADER_RES):
            break
        # "On Mon, 3 Feb 2025 at 10:00, Someone <x@y>\nwrote:" split over two lines.
        if re.match(r"^On\b", s, re.I) and i + 1 < len(lines) and \
                re.match(r"^.{0,200}\bwrote:\s*$", lines[i + 1].strip(), re.I) and len(s) < 300:
            break
        if _OUTLOOK_FROM.match(s):
            window = [ln.strip() for ln in lines[i + 1:i + 5]]
            if sum(1 for w in window if _OUTLOOK_NEXT.match(w)) >= 2:
                break
        kept.append(line)
        i += 1
    return "\n".join(kept).strip()


def strip_signature(text):
    lines = (text or "").split("\n")
    for idx, line in enumerate(lines):
        s = line.strip()
        if any(r.match(s) for r in _SIGNATURE_RES) or (idx > 2 and _DISCLAIMER_RE.match(s)):
            return "\n".join(lines[:idx]).strip()
    return (text or "").strip()


def clean_new_content(text):
    return strip_signature(strip_quoted(text))


def excerpt(text, limit=320):
    body = clean_new_content(text)
    # Drop greeting-only first lines so the excerpt starts with substance.
    lines = [ln.strip() for ln in body.split("\n") if ln.strip()]
    if len(lines) > 1 and re.match(r"^(dear|hi|hello|good (morning|afternoon|evening))\b[^.!?]{0,60}[,!]?$",
                                   lines[0], re.I):
        lines = lines[1:]
    flat = re.sub(r"\s+", " ", " ".join(lines)).strip()
    if len(flat) <= limit:
        return flat
    cut = flat[:limit].rsplit(" ", 1)[0]
    return cut.rstrip(",;:-") + "…"
