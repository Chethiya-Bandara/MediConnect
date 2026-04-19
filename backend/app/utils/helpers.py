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
    """
    Generates a unique Digital Health ID with checksum validation.
    Format: DHID-XXXX-YYYYC
      XXXX = 4 random digits (first segment)
      YYYY = 4 random digits (second segment)
      C    = 1 checksum digit (sum of all 8 digits % 10)

    Example: DHID-1234-56786
      Sum = 1+2+3+4+5+6+7+8 = 36, checksum = 36 % 10 = 6
    """
    part1 = random.randint(1000, 9999)
    part2 = random.randint(1000, 9999)

    # Calculate checksum from all 8 digits
    all_digits = str(part1) + str(part2)
    checksum   = sum(int(d) for d in all_digits) % 10

    return f"DHID-{part1}-{part2}{checksum}"


def validate_dhid(dhid: str) -> bool:
    """
    Validates a DHID by checking its format.
    The active data set contains legacy IDs in the form `DHID-XXXX-XXXX`,
    while newer flows may emit `DHID-XXXX-YYYYC` with a checksum digit.
    This validator accepts both so older patient records do not become invalid overnight.
    Used to verify a DHID is genuine and not forged or guessed.

    Supported formats:
      1. DHID-XXXX-YYYY
         XXXX = 4 digits
         YYYY = 4 digits

      2. DHID-XXXX-YYYYC
         XXXX = 4 digits
         YYYY = 4 digits
         C    = checksum digit (sum of XXXX + YYYY digits % 10)

    Args:
        dhid: DHID string to validate e.g. "DHID-1234-56786"

    Returns:
        True if valid format and checksum, False otherwise
    """
    if not dhid or not isinstance(dhid, str):
        return False

    # Check format: DHID-XXXX-YYYYC
    parts = dhid.strip().upper().split("-")

    if len(parts) != 3:
        return False

    prefix, segment1, segment2_with_check = parts

    # Check prefix
    if prefix != "DHID":
        return False

    # Check segment 1: exactly 4 digits
    if not segment1.isdigit() or len(segment1) != 4:
        return False

    if not segment2_with_check.isdigit():
        return False

    # Legacy format: DHID-XXXX-YYYY
    if len(segment2_with_check) == 4:
        return True

    # Checksum-aware format: DHID-XXXX-YYYYC
    if len(segment2_with_check) != 5:
        return False

    # Extract the 4 data digits and checksum digit
    segment2 = segment2_with_check[:4]
    checksum = int(segment2_with_check[4])

    # Recalculate checksum
    all_digits        = segment1 + segment2
    expected_checksum = sum(int(d) for d in all_digits) % 10

    return checksum == expected_checksum


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

# ── NIC Masking (B-1.4.2) ────────────────────────────────────────────────────
# Masks a NIC for safe display in the UI.
# Never shows the full NIC — only the last 5 characters are visible.
#
# Sri Lankan NIC formats:
#   Old format: 9 digits + V or X  e.g. 123456789V  → XXXXX6789V
#   New format: 12 digits           e.g. 200012345678 → XXXXXXX45678
#
# Rule: show last 5 characters, mask everything else with X

def mask_nic(nic: str) -> str:
    """
    Masks a NIC number for safe display in the UI.
    Shows only the last 5 characters — masks the rest with X.

    Args:
        nic: Raw NIC string e.g. "123456789V" or "200012345678"

    Returns:
        Masked NIC e.g. "XXXXX6789V" or "XXXXXXX45678"
        Returns "INVALID NIC" if input is invalid
    """
    if not nic or not isinstance(nic, str):
        return "INVALID NIC"

    # Normalize — uppercase, strip whitespace
    normalized = nic.strip().upper()

    # Validate NIC format
    if not is_valid_nic(normalized):
        return "INVALID NIC"

    # Show last 5 characters, mask the rest
    visible_chars = 5
    masked_chars  = len(normalized) - visible_chars

    return "X" * masked_chars + normalized[-visible_chars:]


def is_valid_nic(nic: str) -> bool:
    """
    Validates a Sri Lankan NIC format.

    Valid formats:
        Old: 9 digits followed by V or X  e.g. 123456789V
        New: exactly 12 digits             e.g. 200012345678

    Args:
        nic: NIC string to validate (should be uppercase)

    Returns:
        True if valid format, False otherwise
    """
    import re as _re

    # Old format: 9 digits + V or X
    old_format = _re.match(r'^\d{9}[VX]$', nic)

    # New format: 12 digits
    new_format = _re.match(r'^\d{12}$', nic)

    return bool(old_format or new_format)

# ── Search Query Sanitisation (B-5.1.2) ──────────────────────────────────────
# Sanitises medicine search queries to prevent injection attacks.
#
# Even though Supabase uses parameterized queries (preventing SQL injection),
# we still sanitise to:
#   1. Remove LIKE wildcard abuse (% and _ characters)
#   2. Strip dangerous special characters
#   3. Limit query length
#   4. Prevent NoSQL/pattern injection attempts

def sanitize_search_query(query: str, max_length: int = 100) -> str:
    """
    Sanitises a search query for safe use in database queries.
    Removes dangerous characters and patterns.

    Args:
        query:      Raw search query from user input
        max_length: Maximum allowed query length (default 100)

    Returns:
        Sanitised query string safe for database use
    """
    if not query or not isinstance(query, str):
        return ""

    # Step 1 — Strip whitespace
    cleaned = query.strip()

    # Step 2 — Enforce length limit
    cleaned = cleaned[:max_length]

    # Step 3 — Remove SQL wildcard characters that could abuse LIKE queries
    # % → matches any sequence of characters in LIKE
    # _ → matches any single character in LIKE
    cleaned = cleaned.replace("%", "")
    cleaned = cleaned.replace("_", " ")

    # Step 4 — Remove SQL injection special characters
    dangerous_chars = ["'", '"', ";", "--", "/*", "*/", "\\", "\x00"]
    for char in dangerous_chars:
        cleaned = cleaned.replace(char, "")

    # Step 5 — Remove NoSQL injection patterns
    nosql_patterns = ["$where", "$gt", "$lt", "$ne", "$in", "$or", "$and"]
    cleaned_lower = cleaned.lower()
    for pattern in nosql_patterns:
        if pattern in cleaned_lower:
            cleaned = re.sub(re.escape(pattern), "", cleaned, flags=re.IGNORECASE)

    # Step 6 — Collapse multiple spaces
    cleaned = " ".join(cleaned.split())

    return cleaned


def is_safe_search_query(query: str) -> bool:
    """
    Checks if a search query is safe without modifying it.
    Returns False if dangerous patterns are detected.

    Args:
        query: Raw search query to check

    Returns:
        True if query appears safe, False if suspicious
    """
    if not query:
        return True

    suspicious_patterns = [
        "'", '"', ";", "--", "/*", "*/",
        "DROP", "DELETE", "INSERT", "UPDATE", "SELECT",
        "UNION", "OR 1=1", "AND 1=1",
        "$where", "$gt", "$ne",
    ]

    query_upper = query.upper()
    for pattern in suspicious_patterns:
        if pattern.upper() in query_upper:
            return False

    return True
