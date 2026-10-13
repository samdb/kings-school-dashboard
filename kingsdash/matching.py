"""Explainable relevance classification for school emails.

Categories (one primary per item, but every reason is kept):
  direct    – the child's first name appears in the new (non-quoted) text
  year      – the child's year group is mentioned (including lists/ranges)
  activity  – a followed activity is mentioned: *possible* relevance only
  general   – no year group mentioned: whole-school update
  other     – only other year groups are mentioned

Nothing here infers enrolment, deadlines or completed/outstanding tasks.
"""

import re

_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
}
_NUM = r"(?:\d{1,2}(?!\d)|" + "|".join(sorted(_WORDS, key=len, reverse=True)) + r")\b"
_SEP = r"\s*(?:,|/|&|\+|\band\b|\bor\b|-|–|—|\bto\b)\s*(?:(?:years?|yrs?)\s*)?"
_YEAR_RE = re.compile(r"\b(?:years?|yrs?\.?)\s*(" + _NUM + r"(?:" + _SEP + _NUM + r")*)", re.I)
_Y_RE = re.compile(r"\bY(\d{1,2})(?!\d)((?:\s*(?:/|-|–|&)\s*Y?\d{1,2}(?!\d))*)\b", re.I)
_TOKEN_RE = re.compile(r"\d{1,2}|[a-z]+|-|–|—|/|,|&|\+", re.I)

ACTION_PATTERNS = [
    ("action required", r"action required"),
    ("please reply", r"please (?:reply|respond|let us know|confirm)"),
    ("RSVP", r"\brsvp\b"),
    ("deadline", r"\bdeadline\b"),
    ("return by", r"\breturn(?:ed)? (?:by|to|no later than)\b"),
    ("sign", r"\b(?:sign|signed|signature)\b"),
    ("consent", r"\bconsent\b"),
    ("permission slip", r"\bpermission (?:slip|form)\b"),
    ("form to complete", r"\b(?:complete|fill (?:in|out)|submit)\b[^.\n]{0,40}\bform\b"),
    ("booking", r"\b(?:book|booking|sign[- ]up|register|registration)\b"),
    ("payment", r"\b(?:payment|pay|fee|fees|invoice|parentpay)\b"),
    ("please bring", r"\bplease (?:bring|send in|ensure|remember)\b"),
    ("no later than", r"\bno later than\b"),
    ("reminder", r"\breminder\b"),
]
_ACTION_RES = [(label, re.compile(p, re.I)) for label, p in ACTION_PATTERNS]


def _to_int(tok):
    if tok.isdigit():
        return int(tok)
    return _WORDS.get(tok.lower())


def _expand(group):
    """'3, 4 and 5' -> {3,4,5}; '3-6' / '3 to 6' -> {3..6}."""
    years = set()
    tokens = _TOKEN_RE.findall(group)
    prev, range_pending = None, False
    for tok in tokens:
        if tok.lower() in ("year", "years", "yr", "yrs", "y"):
            continue
        n = _to_int(tok)
        if n is not None:
            if range_pending and prev is not None and prev <= n and n - prev <= 13:
                years.update(range(prev, n + 1))
            else:
                years.add(n)
            prev, range_pending = n, False
        elif tok.lower() in ("-", "–", "—", "to"):
            range_pending = True
        else:
            range_pending = False
    return {y for y in years if 0 <= y <= 13}


def year_mentions(text):
    """Return a list of (matched_text, set_of_years) for every year-group mention."""
    found = []
    for m in _YEAR_RE.finditer(text or ""):
        found.append((m.group(0).strip(), _expand(m.group(1))))
    for m in _Y_RE.finditer(text or ""):
        found.append((m.group(0).strip(), _expand(m.group(1) + (m.group(2) or "").replace("Y", " ")
                                                  .replace("y", " "))))
    return [(t, ys) for t, ys in found if ys]


def name_matches(text, name):
    """Case-sensitive whole-word match on the capitalised first name (or ALL CAPS)."""
    name = (name or "").strip()
    if not name:
        return False
    variants = {name[0].upper() + name[1:], name.upper()}
    for v in variants:
        if re.search(r"(?<![\w'’-])" + re.escape(v) + r"(?![\w-])", text or ""):
            return True
    return False


def activity_matches(text, activities):
    hits = []
    for act in activities or []:
        if re.search(r"(?<!\w)" + re.escape(act) + r"(?!\w)", text or "", re.I):
            hits.append(act)
    return hits


def action_hints(text):
    hits = []
    for label, rx in _ACTION_RES:
        if rx.search(text or ""):
            hits.append(label)
    return hits


def classify(subject, new_text, profile, outgoing=False):
    """Classify one email. ``new_text`` must already exclude quoted history."""
    profile = profile or {}
    haystack = (subject or "") + "\n" + (new_text or "")
    name = profile.get("child_first_name") or ""
    year = profile.get("year_group")
    activities = profile.get("activities") or []

    reasons = []
    is_direct = name_matches(haystack, name)
    mentions = year_mentions(haystack)
    mentioned_years = sorted(set().union(*[ys for _, ys in mentions])) if mentions else []
    year_hit = [t for t, ys in mentions if year in ys]
    acts = activity_matches(haystack, activities)

    if is_direct:
        reasons.append({"kind": "direct",
                        "text": "Mentions %s by name in the message itself." % name})
    if year_hit:
        reasons.append({"kind": "year",
                        "text": "Mentions Year %d (%s)." % (year, "; ".join(sorted(set(year_hit))[:3]))})
    for act in acts:
        reasons.append({"kind": "activity",
                        "text": "Mentions %s, an activity you follow — possible relevance only; "
                                "this does not mean %s is signed up." % (act, name or "your child")})
    other_years = [y for y in mentioned_years if y != year]
    if other_years and not year_hit:
        label = ", ".join("Year %d" % y for y in other_years[:6])
        reasons.append({"kind": "other",
                        "text": "Addressed to %s, not Year %s." % (label, year)
                        if not is_direct else
                        "Mentions %s — but also names %s directly." % (label, name)})
    if not mentions and not is_direct and not acts:
        reasons.append({"kind": "general",
                        "text": "No year group matched — general school correspondence; not necessarily a whole-school announcement."})

    if is_direct:
        primary = "direct"
    elif year_hit:
        primary = "year"
    elif acts:
        primary = "activity"
    elif mentions:
        primary = "other"
    else:
        primary = "general"

    actions = [] if outgoing else action_hints(haystack)
    return {
        "category": primary,
        "reasons": reasons,
        "direct": is_direct,
        "year_match": bool(year_hit),
        "activities": acts,
        "years_mentioned": mentioned_years,
        "possible_actions": actions,
    }
