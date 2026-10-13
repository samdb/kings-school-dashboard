"""Private, atomic JSON persistence inside the gitignored data/ directory."""

import json
import os
import tempfile
import threading

_write_lock = threading.Lock()


def ensure_private_dir(path):
    os.makedirs(path, mode=0o700, exist_ok=True)
    try:
        os.chmod(path, 0o700)
    except OSError:
        pass


def read_json(path, default):
    """Return parsed JSON, or ``default`` if the file is missing or unreadable."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default
    except (OSError, ValueError):
        # A corrupt file must never take the dashboard down; keep a copy for inspection.
        try:
            os.replace(path, path + ".corrupt")
        except OSError:
            pass
        return default


def write_json_atomic(path, data):
    """Write JSON via temp file + fsync + rename so readers never see partial state."""
    directory = os.path.dirname(os.path.abspath(path))
    ensure_private_dir(directory)
    payload = json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True)
    with _write_lock:
        fd, tmp = tempfile.mkstemp(prefix=".tmp-", suffix=".json", dir=directory)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(payload)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, path)
            try:
                dfd = os.open(directory, os.O_RDONLY)
                try:
                    os.fsync(dfd)
                finally:
                    os.close(dfd)
            except OSError:
                pass
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
