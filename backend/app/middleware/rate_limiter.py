# app/middleware/rate_limiter.py
# Rate limiting configuration reference for MediConnect
# Managed by Bihanga (B-1.3.2)
#
# IMPLEMENTATION:
#   The actual rate limiting middleware is in main.py
#   using a sliding window algorithm with Python's built-in
#   collections.deque — no extra library needed.
#
# RATE LIMIT RULES:
#   /login           → 5 attempts  per 1 minute   (brute force protection)
#   /register        → 3 attempts  per 10 minutes  (spam/bot protection)
#   /forgot-password → 5 attempts  per 1 minute   (enumeration protection)
#   All other routes → 90 requests per 1 minute   (general DoS protection)
#
# RESPONSE WHEN BLOCKED:
#   HTTP 429 Too Many Requests
#   {
#       "error": "Too many requests",
#       "message": "You have made too many attempts. Please wait before trying again.",
#       "limit": <max_requests>,
#       "window_seconds": <window>
#   }

# ── Rate Limit Constants ──────────────────────────────────────────────────────
# These values match the configuration in main.py
# Update both files if limits need to change

LOGIN_LIMIT_REQUESTS    = 5
LOGIN_LIMIT_WINDOW      = 60      # seconds

REGISTER_LIMIT_REQUESTS = 3
REGISTER_LIMIT_WINDOW   = 600     # seconds (10 minutes)

FORGOT_PASSWORD_LIMIT_REQUESTS = 5
FORGOT_PASSWORD_LIMIT_WINDOW   = 60      # seconds

DEFAULT_LIMIT_REQUESTS  = 90
DEFAULT_LIMIT_WINDOW    = 60      # seconds
