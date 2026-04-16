import bcrypt
import random
import re
import hmac
import hashlib
import os
from dotenv import load_dotenv

load_dotenv()

# ─── Chethiya's functions ─────────────────────────────────────────────────────

def hash_nic(nic: str) -> str:
    """
    Bcrypt hash of NIC — used for guardian NIC storage where
    only verification is needed (not lookup).
    """
    return bcrypt.hashpw(nic.encode(), bcrypt.gensalt()).decode()


def generate_dhid() -> str:
    return f"DHID-{random.randint(1000,9999)}-{random.randint(1000,9999)}"


# ─── Bihanga's functions ──────────────────────────────────────────────────────

# ── NIC Hashing (B-1.4.1) ────────────────────────────────────────────────────
# NICs are stored as HMAC-SHA256 hashes in the database.
#
# Why HMAC-SHA256 instead of bcrypt for NICs:
#   - Deterministic: same NIC always produces same hash
#   - Allows database lookups: "find patient by NIC"
#   - Secure: requires NIC_HMAC_SECRET to reverse
#   - Fast: no salt rounds needed for lookup performance
#
# Why NOT store raw NICs:
#   - If database is compromised, NICs are exposed
#   - NICs can be used for identity theft
#   - Sri Lankan data protection best practices require this

def hmac_nic(nic: str) -> str:
    """
    Creates a deterministic HMAC-SHA256 hash of a NIC number.
    Used for storing and looking up NICs in the database.

    Same NIC always produces the same hash (unlike bcrypt).
    Requires NIC_HMAC_SECRET environment variable.

    Args:
        nic: Raw NIC string e.g. "123456789V" or "200012345678"

    Returns:
        64-character hex string e.g. "a3f8c2e1d4b7..."
    """
    secret = os.getenv("NIC_HMAC_SECRET", "")
    if not secret:
        raise EnvironmentError(
            "[helpers] NIC_HMAC_SECRET is not set. "
            "Add it to your .env file."
        )

    # Normalize NIC: uppercase, strip whitespace
    normalized = nic.strip().upper()

    return hmac.new(
        secret.encode(),
        normalized.encode(),
        hashlib.sha256
    ).hexdigest()


def verify_nic(raw_nic: str, stored_hash: str) -> bool:
    """
    Verifies a raw NIC against a stored HMAC hash.
    Uses constant-time comparison to prevent timing attacks.

    Args:
        raw_nic: The NIC entered by the user
        stored_hash: The hash stored in the database

    Returns:
        True if NIC matches, False otherwise
    """
    expected = hmac_nic(raw_nic)
    return hmac.compare_digest(expected, stored_hash)


# ── Password Validation (B-1.1.3) ────────────────────────────────────────────

# Password complexity rules for MediConnect (healthcare system):
#   - Minimum 10 characters, maximum 128
#   - At least 1 uppercase letter (A-Z)
#   - At least 1 lowercase letter (a-z)
#   - At least 1 number (0-9)
#   - At least 1 special character (!@#$%^&*...)
#   - No spaces allowed
PASSWORD_REGEX = re.compile(
    r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>\/?]).{10,128}$'
)


def is_valid_password(password: str) -> bool:
    """
    Validates password strength against MediConnect complexity rules.
    Returns True if password meets all requirements, False otherwise.
    """
    return bool(PASSWORD_REGEX.match(password))


def get_password_errors(password: str) -> list[str]:
    """
    Returns a list of specific error messages for why a password failed.
    Used to give users clear feedback on what they need to fix.
    """
    errors = []

    if len(password) < 10:
        errors.append("Password must be at least 10 characters long")

    if len(password) > 128:
        errors.append("Password must not exceed 128 characters")

    if not re.search(r'[A-Z]', password):
        errors.append("Password must contain at least one uppercase letter")

    if not re.search(r'[a-z]', password):
        errors.append("Password must contain at least one lowercase letter")

    if not re.search(r'\d', password):
        errors.append("Password must contain at least one number")

    if not re.search(r'[!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>\/?]', password):
        errors.append("Password must contain at least one special character (!@#$%^&*...)")

    if re.search(r'\s', password):
        errors.append("Password must not contain spaces")

    return errors
