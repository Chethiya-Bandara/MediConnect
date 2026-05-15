import os
import time

import httpx
from dotenv import load_dotenv
from httpx import HTTPError
from httpcore import RemoteProtocolError as HTTPCoreRemoteProtocolError
from supabase import create_client
from supabase.lib.client_options import SyncClientOptions

load_dotenv()

url = os.getenv("SUPABASE_URL")
anon_key = os.getenv("SUPABASE_KEY")
service_key = os.getenv("SUPABASE_SERVICE_KEY")

_REQUEST_TIMEOUT = httpx.Timeout(5.0, connect=5.0)  # NFR-4.1: fail fast within SLA budget
_CONNECTION_LIMITS = httpx.Limits(max_connections=40, max_keepalive_connections=20)
_UNSET = object()


def _build_httpx_client() -> httpx.Client:
    return httpx.Client(
        http2=False,
        follow_redirects=True,
        timeout=_REQUEST_TIMEOUT,
        limits=_CONNECTION_LIMITS,
    )


def _create_supabase_client(key: str):
    options = SyncClientOptions(
        httpx_client=_build_httpx_client(),
        postgrest_client_timeout=_REQUEST_TIMEOUT,
        storage_client_timeout=5,
        function_client_timeout=5,
    )
    return create_client(url, key, options)


def is_retryable_supabase_error(exc: Exception) -> bool:
    if isinstance(exc, (HTTPError, HTTPCoreRemoteProtocolError)):
        return True

    message = str(exc).lower()
    retryable_markers = (
        "server disconnected",
        "remoteprotocolerror",
        "connection reset",
        "connection aborted",
        "read timed out",
        "timed out",
        "temporarily unavailable",
    )
    return any(marker in message for marker in retryable_markers)


def execute_with_retry(
    query_factory,
    *,
    default=_UNSET,
    attempts: int = 3,
    retry_delay: float = 0.2,
):
    last_error = None

    for attempt in range(1, attempts + 1):
        try:
            return query_factory()
        except Exception as exc:
            last_error = exc
            if not is_retryable_supabase_error(exc) or attempt >= attempts:
                if default is not _UNSET:
                    return default() if callable(default) else default
                raise
            time.sleep(retry_delay * attempt)


supabase = _create_supabase_client(anon_key)  # for auth
supabase_admin = _create_supabase_client(service_key)  # for admin
