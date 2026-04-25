import time
from collections import defaultdict, deque

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.routes import auth, doctor_dashboard, patient_dashboard, pharmacist_dashboard, pharmacy_admin_dashboard, moh_admin_dashboard, hospital_admin_dashboard, admin_router

app = FastAPI()

# ── IP-Based Rate Limiting (Bihanga B-1.3.2) ─────────────────────────────────
# Tracks request timestamps per IP per endpoint in memory
# Uses sliding window algorithm — counts requests in the last N seconds
#
# Limits:
#   /login          → 5 attempts per minute    (brute force protection)
#   /register       → 3 attempts per 10 mins   (spam/bot protection)
#   /forgot-password → 5 attempts per minute   (enumeration protection)
#   All other routes → 90 requests per minute  (general protection)

_RATE_LIMIT_BUCKETS: dict[str, deque[float]] = defaultdict(deque)

# Per-endpoint rate limit rules: path → (max_requests, window_seconds)
_ENDPOINT_LIMITS: dict[str, tuple[int, int]] = {
    # Auth endpoints
    "/login":                    (5,  60),    # 5 per minute
    "/register":                 (3,  600),   # 3 per 10 minutes
    "/forgot-password":          (5,  60),    # 5 per minute

    # Appointment endpoints — prevent ID enumeration
    "/patient/dashboard/appointments": (30, 60),  # 30 per minute

    # DHID lookup — prevent enumeration
    "/patient/dashboard/lookup": (3, 60),     # 3 per minute
}
_DEFAULT_LIMIT = (90, 60)            # 90 per minute for all other routes


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    """
    Sliding window rate limiter.
    Blocks requests exceeding the limit with 429 Too Many Requests.
    """
    client_ip  = request.client.host if request.client else "unknown"
    path       = request.url.path

    # Get limit for this specific endpoint
    max_requests, window_seconds = _ENDPOINT_LIMITS.get(path, _DEFAULT_LIMIT)

    bucket_key = f"{client_ip}:{path}"
    bucket     = _RATE_LIMIT_BUCKETS[bucket_key]
    now        = time.monotonic()

    # Remove timestamps outside the current window
    while bucket and now - bucket[0] > window_seconds:
        bucket.popleft()

    # Block if limit exceeded
    if len(bucket) >= max_requests:
        return JSONResponse(
            status_code=429,
            content={
                "error": "Too many requests",
                "message": "You have made too many attempts. Please wait before trying again.",
                "limit": max_requests,
                "window_seconds": window_seconds,
            },
        )

    # Record this request
    bucket.append(now)
    return await call_next(request)


# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(patient_dashboard.router)
app.include_router(doctor_dashboard.router)
app.include_router(admin_router.router)
app.include_router(pharmacist_dashboard.router)
app.include_router(pharmacy_admin_dashboard.router)
app.include_router(hospital_admin_dashboard.router)
app.include_router(moh_admin_dashboard.router)
