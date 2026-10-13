"""Paths, environment settings and validation of the user-editable local profile."""

import os
import re

from . import storage

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(APP_DIR, "static")

DEFAULT_QUERY = "from:(kings-rochester.co.uk) newer_than:180d"
DEFAULT_REFRESH_MINUTES = 30
MIN_REFRESH_MINUTES = 5
MAX_REFRESH_MINUTES = 24 * 60
MAX_ACCOUNTS = 5
MAX_ACTIVITIES = 20
MAX_QUERY_LEN = 400

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$")
NAME_RE = re.compile(r"^[^\W\d_](?:[^\W\d_]|[-' ]){0,39}$")
ACTIVITY_RE = re.compile(r"^[\w&' .+/-]{2,40}$")


class Env:
    """Process-level settings that are not user profile data."""

    def __init__(self, environ=None):
        env = os.environ if environ is None else environ
        self.data_dir = os.path.abspath(env.get("KINGSDASH_DATA_DIR") or os.path.join(APP_DIR, "data"))
        self.gog_bin = env.get("KINGSDASH_GOG_BIN") or "gog-authenticated"
        self.port = _env_int_from(env, "KINGSDASH_PORT", 8765, 1024, 65535)
        self.command_timeout = _env_int_from(env, "KINGSDASH_COMMAND_TIMEOUT", 45, 5, 300)
        self.max_pages = _env_int_from(env, "KINGSDASH_MAX_PAGES", 4, 1, 20)
        self.max_threads = _env_int_from(env, "KINGSDASH_MAX_THREADS", 200, 1, 1000)
        self.refresh_budget = _env_int_from(env, "KINGSDASH_REFRESH_BUDGET", 600, 30, 3600)

    @property
    def config_path(self):
        return os.path.join(self.data_dir, "config.json")

    @property
    def state_path(self):
        return os.path.join(self.data_dir, "state.json")

    @property
    def marks_path(self):
        return os.path.join(self.data_dir, "marks.json")


def _env_int_from(env, name, default, lo, hi):
    try:
        value = int(env.get(name, default))
    except (TypeError, ValueError):
        value = default
    return max(lo, min(hi, value))


def default_config():
    return {
        "profile": {"child_first_name": "", "year_group": 3, "activities": []},
        "accounts": [],
        "query": DEFAULT_QUERY,
        "refresh_minutes": DEFAULT_REFRESH_MINUTES,
        "demo_mode": False,
    }


class ValidationError(ValueError):
    pass


def validate_config(raw):
    """Validate a full settings object from the UI. Returns a clean dict or raises."""
    if not isinstance(raw, dict):
        raise ValidationError("Settings must be a JSON object.")
    allowed = {"profile", "accounts", "query", "refresh_minutes", "demo_mode"}
    unknown = set(raw) - allowed
    if unknown:
        raise ValidationError("Unknown setting: " + sorted(unknown)[0])
    cfg = default_config()

    profile = raw.get("profile", {})
    if not isinstance(profile, dict):
        raise ValidationError("Profile must be an object.")
    if set(profile) - {"child_first_name", "year_group", "activities"}:
        raise ValidationError("Unknown profile field.")
    name = profile.get("child_first_name", "")
    if not isinstance(name, str):
        raise ValidationError("Child first name must be text.")
    name = " ".join(name.split())
    if name and not NAME_RE.match(name):
        raise ValidationError("Child first name should be letters only (up to 40 characters).")
    year = profile.get("year_group", 3)
    if isinstance(year, bool) or not isinstance(year, int) or not 1 <= year <= 13:
        raise ValidationError("Year group must be a whole number from 1 to 13.")
    activities = profile.get("activities", [])
    if not isinstance(activities, list) or len(activities) > MAX_ACTIVITIES:
        raise ValidationError("Activities must be a list of up to %d items." % MAX_ACTIVITIES)
    clean_acts = []
    for act in activities:
        if not isinstance(act, str):
            raise ValidationError("Each activity must be text.")
        act = " ".join(act.split())
        if not act:
            continue
        if not ACTIVITY_RE.match(act):
            raise ValidationError("Activity names must be 2–40 simple characters: %r" % act[:40])
        if act.lower() not in {a.lower() for a in clean_acts}:
            clean_acts.append(act)
    cfg["profile"] = {"child_first_name": name, "year_group": year, "activities": clean_acts}

    accounts = raw.get("accounts", [])
    if not isinstance(accounts, list) or len(accounts) > MAX_ACCOUNTS:
        raise ValidationError("Accounts must be a list of up to %d email addresses." % MAX_ACCOUNTS)
    clean_accounts = []
    for acc in accounts:
        if not isinstance(acc, str):
            raise ValidationError("Each account must be an email address.")
        acc = acc.strip()
        if not acc:
            continue
        if not EMAIL_RE.match(acc):
            raise ValidationError("Not a valid email address: %s" % acc[:80])
        if acc.lower() not in {a.lower() for a in clean_accounts}:
            clean_accounts.append(acc)
    cfg["accounts"] = clean_accounts

    query = raw.get("query", DEFAULT_QUERY)
    if not isinstance(query, str):
        raise ValidationError("Search query must be text.")
    query = " ".join(query.split())
    if not query:
        query = DEFAULT_QUERY
    if len(query) > MAX_QUERY_LEN or any(ord(c) < 32 for c in query):
        raise ValidationError("Search query is too long or contains control characters.")
    cfg["query"] = query

    minutes = raw.get("refresh_minutes", DEFAULT_REFRESH_MINUTES)
    if isinstance(minutes, bool) or not isinstance(minutes, int):
        raise ValidationError("Refresh interval must be a whole number of minutes.")
    if not MIN_REFRESH_MINUTES <= minutes <= MAX_REFRESH_MINUTES:
        raise ValidationError("Refresh interval must be between %d and %d minutes."
                              % (MIN_REFRESH_MINUTES, MAX_REFRESH_MINUTES))
    cfg["refresh_minutes"] = minutes

    demo = raw.get("demo_mode", False)
    if not isinstance(demo, bool):
        raise ValidationError("Demo mode must be true or false.")
    cfg["demo_mode"] = demo
    return cfg


def load_config(env):
    raw = storage.read_json(env.config_path, None)
    if raw is None:
        return default_config()
    try:
        return validate_config(raw)
    except ValidationError:
        return default_config()


def save_config(env, cfg):
    storage.write_json_atomic(env.config_path, cfg)
