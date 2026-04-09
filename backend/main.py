import time
from collections import defaultdict, deque

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.routes import auth, doctor_dashboard, patient_dashboard

app = FastAPI()

_RATE_LIMIT_BUCKETS: dict[str, deque[float]] = defaultdict(deque)
_AUTH_LIMIT_PATHS = {"/login", "/register", "/forgot-password"}


@app.middleware("http")
async def rate_limit_requests(request, call_next):
    client_host = request.client.host if request.client else "unknown"
    path = request.url.path
    now = time.monotonic()

    if path in _AUTH_LIMIT_PATHS:
        window_seconds = 60
        limit = 10
    else:
        window_seconds = 60
        limit = 90

    bucket_key = f"{client_host}:{path}"
    bucket = _RATE_LIMIT_BUCKETS[bucket_key]

    while bucket and now - bucket[0] > window_seconds:
        bucket.popleft()

    if len(bucket) >= limit:
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests. Please try again shortly."},
        )

    bucket.append(now)
    response = await call_next(request)
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(patient_dashboard.router)
app.include_router(doctor_dashboard.router)
