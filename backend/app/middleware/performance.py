"""
Response-time tracking middleware — NFR-4.1.

Measures wall-clock duration for every request and:
  - Adds X-Response-Time header (milliseconds) to every response
  - Logs a WARNING for any request that exceeds the 2-second SLA
  - Maintains an in-memory ring buffer of the last 100 slow requests
    so they can be surfaced in the MOH admin dashboard

The ring buffer is capped and thread-safe for single-process deployments.
"""
import logging
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("mediconnect.performance")

SLA_MS = 2000          # 2-second SLA (NFR-4.1)
_MAX_SLOW_RECORDS = 100

# Ring buffer of slow requests: newest at the right
_slow_requests: deque[dict[str, Any]] = deque(maxlen=_MAX_SLOW_RECORDS)


def record_request(path: str, method: str, status_code: int, duration_ms: float) -> None:
    """Called after every response. Logs and stores slow requests."""
    if duration_ms > SLA_MS:
        entry: dict[str, Any] = {
            "path": path,
            "method": method,
            "status_code": status_code,
            "duration_ms": round(duration_ms, 1),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        _slow_requests.append(entry)
        logger.warning(
            "Slow request: %s %s took %.0fms (SLA: %dms)",
            method,
            path,
            duration_ms,
            SLA_MS,
        )


def get_slow_requests() -> list[dict[str, Any]]:
    """Return slow requests newest-first."""
    return list(reversed(_slow_requests))


def measure_ms(start: float) -> float:
    return (time.monotonic() - start) * 1000
