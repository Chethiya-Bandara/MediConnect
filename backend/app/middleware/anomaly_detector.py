"""
Anomaly detection — NFR-1.9.

Tracks four event types with in-memory sliding-window counters and writes a
row to anomaly_flags in Supabase when a threshold is exceeded.

Event types and thresholds:
  LOGIN_SPIKE          — 15 attempts from same IP in 5 min
  DHID_ENUMERATION     — 20 DHID lookups from same IP in 10 min
  PASSWORD_RESET_ABUSE — 8 reset submissions from same IP in 10 min
  REQUEST_FLOOD        — 500 requests from same IP in 5 min

A cooldown of 15 min prevents duplicate flags for the same (ip, event_type).
Failures never propagate to the caller — anomaly logging must not block
primary request handling.
"""
import logging
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any

from app.config.supabase import execute_with_retry, supabase_admin

# event_type → (threshold, window_seconds)
_RULES: dict[str, tuple[int, int]] = {
    "LOGIN_SPIKE":          (15, 300),   # 15 logins from same IP in 5 min
    "DHID_ENUMERATION":     (20, 600),   # 20 DHID lookups from same IP in 10 min
    "PASSWORD_RESET_ABUSE": (8,  600),   # 8 reset attempts from same IP in 10 min
    "REQUEST_FLOOD":        (500, 300),  # 500 any-requests from same IP in 5 min
}

_COOLDOWN_SECONDS = 900  # 15 min between repeat flags for the same (ip, type)

# Sliding window: (ip, event_type) → deque of monotonic timestamps
_COUNTERS: dict[tuple[str, str], deque] = defaultdict(deque)

# Cooldown: (ip, event_type) → monotonic time of last written flag
_LAST_FLAGGED: dict[tuple[str, str], float] = {}


def record(ip: str, event_type: str) -> None:
    """Record one event. Writes a flag to the DB if the threshold is crossed."""
    if event_type not in _RULES:
        return

    threshold, window = _RULES[event_type]
    key = (ip, event_type)
    bucket = _COUNTERS[key]
    now = time.monotonic()

    while bucket and now - bucket[0] > window:
        bucket.popleft()
    bucket.append(now)

    if len(bucket) < threshold:
        return

    last_flagged = _LAST_FLAGGED.get(key, 0.0)
    if now - last_flagged < _COOLDOWN_SECONDS:
        return

    _LAST_FLAGGED[key] = now
    _write_flag(
        ip=ip,
        event_type=event_type,
        count=len(bucket),
        threshold=threshold,
        window=window,
    )


def _write_flag(
    *,
    ip: str,
    event_type: str,
    count: int,
    threshold: int,
    window: int,
) -> None:
    payload: dict[str, Any] = {
        "event_type": event_type,
        "source_ip": ip,
        "event_count": count,
        "window_seconds": window,
        "threshold": threshold,
        "flagged_at": datetime.now(timezone.utc).isoformat(),
        "status": "open",
    }
    try:
        execute_with_retry(
            lambda: supabase_admin.table("anomaly_flags").insert(payload).execute(),
            attempts=2,
        )
    except Exception:
        logging.exception(
            "Anomaly flag write failed — event_type=%s ip=%s count=%d",
            event_type, ip, count,
        )
