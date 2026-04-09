import bcrypt
import random
import re

def hash_nic(nic: str):
    return bcrypt.hashpw(nic.encode(), bcrypt.gensalt()).decode()

def generate_dhid():
    return f"DHID-{random.randint(1000,9999)}-{random.randint(1000,9999)}"

PASSWORD_REGEX = re.compile(
    r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>\/?]).{10,128}$'
)

def is_valid_password(password: str) -> bool:
    """
    Validates password strength against MediConnect complexity rules.
    Returns True if password meets all requirements, False otherwise.
    Used by registration and password reset endpoints.
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