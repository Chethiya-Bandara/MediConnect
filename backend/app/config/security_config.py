# app/config/security_config.py
# Security parameters for MediConnect — managed by Bihanga (B-1.1.1, B-1.1.2)

import os
from dotenv import load_dotenv

load_dotenv()


# ── bcrypt ────────────────────────────────────────────────────────────────────
# Cost factor 12 → 2^12 = 4096 iterations per hash
# OWASP recommended minimum for healthcare systems
BCRYPT_ROUNDS: int = int(os.getenv("BCRYPT_ROUNDS", 12))


# ── JWT Algorithm ─────────────────────────────────────────────────────────────
JWT_ALGORITHM: str = "HS256"


# ── JWT Secrets ───────────────────────────────────────────────────────────────
# Separate secrets for access and refresh tokens
# If one is compromised, the other remains secure
JWT_ACCESS_SECRET:  str = os.getenv("JWT_ACCESS_SECRET", "")
JWT_REFRESH_SECRET: str = os.getenv("JWT_REFRESH_SECRET", "")


# ── JWT Expiry ────────────────────────────────────────────────────────────────
ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 15))
REFRESH_TOKEN_EXPIRE_DAYS:   int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", 7))

# Derived values in seconds
ACCESS_TOKEN_EXPIRE_SECONDS:  int = ACCESS_TOKEN_EXPIRE_MINUTES * 60
REFRESH_TOKEN_EXPIRE_SECONDS: int = REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60


# ── Startup Validation ────────────────────────────────────────────────────────
# Crash immediately if critical secrets are missing
# Better to fail at startup than run silently with empty secrets
_REQUIRED_SECRETS = {
    "JWT_ACCESS_SECRET":  JWT_ACCESS_SECRET,
    "JWT_REFRESH_SECRET": JWT_REFRESH_SECRET,
}

for _name, _value in _REQUIRED_SECRETS.items():
    if not _value:
        raise EnvironmentError(
            f"\n[security_config] ❌ Missing required environment variable: {_name}"
            f"\n→ Copy .env.example to .env and fill in your values."
            f"\n→ Generate secrets with: "
            f"python -c \"import secrets; print(secrets.token_hex(64))\""
        )
# TEST LINE - will be removed
PASSWORD = "SuperSecret123!"
API_KEY = "AKIAIOSFODNN7EXAMPLE"
