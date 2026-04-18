# app/middleware/metadata_encryptor.py
# AES-256-GCM encryption for medical attachment metadata
# Managed by Bihanga (B-4.2.2)
#
# PURPOSE:
#   Encrypts sensitive metadata about medical file uploads before DB storage.
#   Protects patient privacy even if the database is compromised.
#
# ALGORITHM: AES-256-GCM
#   AES-256  → 256-bit key, HIPAA/healthcare compliant
#   GCM mode → Authenticated encryption — detects any tampering
#   Nonce    → Random 12-byte value, unique per encryption
#
# WHAT GETS ENCRYPTED:
#   original_filename  → e.g. "john_doe_chest_xray.jpg"
#   file_type          → e.g. "chest_xray", "lab_report"
#   doctor_notes       → any notes attached to the file
#   patient_context    → any patient-identifying information
#
# WHAT IS NOT ENCRYPTED (stored plaintext):
#   safe_filename      → sanitized filename for storage path
#   patient_id         → needed for DB queries
#   doctor_id          → needed for DB queries
#   file_size          → not sensitive
#   upload_timestamp   → not sensitive
#
# KEY STORAGE:
#   METADATA_ENCRYPTION_KEY in .env — never stored in DB

import os
import json
import base64
from dotenv import load_dotenv
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

load_dotenv()


# ── Key Loading ───────────────────────────────────────────────────────────────

def _get_encryption_key() -> bytes:
    """
    Loads the AES-256 encryption key from environment.
    Key must be exactly 32 bytes (64 hex characters).

    Raises:
        EnvironmentError if key is missing or wrong length
    """
    key_hex = os.getenv("METADATA_ENCRYPTION_KEY", "")

    if not key_hex:
        raise EnvironmentError(
            "[metadata_encryptor] METADATA_ENCRYPTION_KEY is not set. "
            "Add it to your .env file. "
            "Generate with: python -c \"import secrets; print(secrets.token_hex(32))\""
        )

    try:
        key_bytes = bytes.fromhex(key_hex)
    except ValueError:
        raise EnvironmentError(
            "[metadata_encryptor] METADATA_ENCRYPTION_KEY must be a valid hex string."
        )

    if len(key_bytes) != 32:
        raise EnvironmentError(
            f"[metadata_encryptor] METADATA_ENCRYPTION_KEY must be 32 bytes "
            f"(64 hex chars). Got {len(key_bytes)} bytes."
        )

    return key_bytes


# ── Encryption ────────────────────────────────────────────────────────────────

def encrypt_metadata(metadata: dict) -> str:
    """
    Encrypts a metadata dictionary using AES-256-GCM.

    Args:
        metadata: Dictionary of sensitive metadata to encrypt
                  e.g. {"original_filename": "xray.jpg", "file_type": "xray"}

    Returns:
        Base64-encoded string containing nonce + ciphertext
        Safe to store in database

    Raises:
        EnvironmentError if encryption key is not configured
    """
    key      = _get_encryption_key()
    aesgcm   = AESGCM(key)

    # Generate random 12-byte nonce (unique per encryption)
    nonce = os.urandom(12)

    # Serialize metadata to JSON bytes
    plaintext = json.dumps(metadata, sort_keys=True).encode("utf-8")

    # Encrypt — GCM automatically adds authentication tag
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)

    # Combine nonce + ciphertext and encode as base64
    combined = nonce + ciphertext
    return base64.b64encode(combined).decode("utf-8")


# ── Decryption ────────────────────────────────────────────────────────────────

def decrypt_metadata(encrypted_b64: str) -> dict:
    """
    Decrypts an encrypted metadata string back to a dictionary.

    Args:
        encrypted_b64: Base64-encoded encrypted metadata from database

    Returns:
        Original metadata dictionary

    Raises:
        ValueError if decryption fails (wrong key or tampered data)
        EnvironmentError if encryption key is not configured
    """
    key    = _get_encryption_key()
    aesgcm = AESGCM(key)

    try:
        combined = base64.b64decode(encrypted_b64.encode("utf-8"))
    except Exception:
        raise ValueError("Invalid encrypted metadata format")

    # Split nonce (first 12 bytes) from ciphertext
    if len(combined) < 12:
        raise ValueError("Encrypted data is too short")

    nonce      = combined[:12]
    ciphertext = combined[12:]

    try:
        # Decrypt — GCM verifies authentication tag automatically
        plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    except Exception:
        raise ValueError(
            "Metadata decryption failed. "
            "Data may be tampered or the wrong key is being used."
        )

    return json.loads(plaintext.decode("utf-8"))


# ── Safe Metadata Builder ─────────────────────────────────────────────────────

def build_attachment_metadata(
    original_filename: str,
    file_type:         str,
    file_size_bytes:   int,
    doctor_id:         int,
    patient_id:        int,
    notes:             str = ""
) -> dict:
    """
    Builds a structured metadata dictionary for a medical attachment.
    This dict is then passed to encrypt_metadata() before DB storage.

    Args:
        original_filename: The original filename before sanitization
        file_type:         Type of medical document e.g. "xray", "lab_report"
        file_size_bytes:   File size in bytes
        doctor_id:         Uploading doctor's ID
        patient_id:        Patient the file belongs to
        notes:             Optional doctor notes about the file

    Returns:
        Structured metadata dictionary ready for encryption
    """
    return {
        "original_filename": original_filename,
        "file_type":         file_type,
        "file_size_bytes":   file_size_bytes,
        "doctor_id":         doctor_id,
        "patient_id":        patient_id,
        "notes":             notes,
    }
