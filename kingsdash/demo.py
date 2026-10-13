"""Clearly-labelled SYNTHETIC sample content for the optional demo mode.

None of this is real school email. It exists only so the layout can be explored
before Gmail is connected. Items carry ``synthetic: True`` and no source link.
"""

from datetime import datetime, timedelta, timezone

_SAMPLES = [
    ("SAMPLE · Year {year} trip to the castle",
     "Year {year} will visit the castle as part of their history topic. Please return the consent "
     "form via the school office. Packed lunches are needed on the day.", 1, 0),
    ("SAMPLE · Well done, {name}!",
     "We wanted to share that {name} was awarded a merit certificate in assembly this week for "
     "kindness in the classroom.", 2, 0),
    ("SAMPLE · {activity} update",
     "{activity} sessions continue this term on the usual afternoon. New members are welcome; "
     "places can be booked through the parent portal.", 3, 1),
    ("SAMPLE · Whole-school newsletter",
     "Highlights from the week: the harvest festival collection, house music practices and "
     "a reminder that the library is open after school for quiet reading.", 4, 0),
    ("SAMPLE · Year 13 university information evening",
     "Year 13 students and parents are invited to an information evening on applications and "
     "student finance.", 5, 0),
    ("SAMPLE · Lost property",
     "A reminder that named uniform is returned quickly. Unclaimed items will be donated at "
     "half term.", 7, 1),
]


def demo_items(profile, now=None):
    now = now or datetime.now(timezone.utc)
    name = (profile or {}).get("child_first_name") or "Alex"
    year = (profile or {}).get("year_group") or 3
    acts = (profile or {}).get("activities") or []
    activity = acts[0] if acts else "Chess Club"
    out = []
    for idx, (subject, body, days, att) in enumerate(_SAMPLES):
        fields = {"name": name, "year": year, "activity": activity}
        text = body.format(**fields)
        out.append({
            "key": "demo-%d" % idx,
            "account": "demo",
            "accounts": ["demo"],
            "thread_id": "",
            "message_id": "",
            "rfc_message_id": "",
            "subject": subject.format(**fields),
            "from_name": "Sample School Office (synthetic)",
            "from_address": "sample@example.invalid",
            "received_at": (now - timedelta(days=days, hours=idx)).replace(microsecond=0).isoformat(),
            "direction": "incoming",
            "you_replied_at": None,
            "message_count": 1,
            "excerpt": text,
            "new_text": text,
            "full_text": text,
            "body_source": "synthetic",
            "attachments_skipped": att,
            "source_url": None,
            "synthetic": True,
        })
    return out
