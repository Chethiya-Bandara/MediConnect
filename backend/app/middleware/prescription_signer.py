# app/middleware/prescription_signer.py
# RSA-SHA256 Digital Signature for ePrescriptions
# Managed by Bihanga (B-4.1.1, B-4.1.2)
#
# PURPOSE:
#   Ensures ePrescriptions are genuine and have not been tampered with.
#   Each prescription is signed by the issuing doctor using RSA-SHA256.
#   Pharmacists can verify the signature before dispensing.
#
# ALGORITHM: RSA-SHA256
#   - RSA: Asymmetric encryption (private key signs, public key verifies)
#   - SHA256: Hash function (creates a fixed-size digest of prescription data)
#   - Key size: 2048 bits (NIST recommended minimum for healthcare)
#
# KEY STORAGE:
#   - Private key: stored encrypted in DB (doctors table)
#   - Public key:  stored plaintext in DB (accessible to pharmacists)
#
# SIGNING FLOW:
#   1. Doctor creates prescription
#   2. System builds canonical payload (sorted, deterministic)
#   3. SHA256 hash of payload is computed
#   4. Hash is signed with doctor's RSA private key
#   5. Base64-encoded signature stored with prescription
#
# VERIFICATION FLOW:
#   1. Pharmacist requests prescription
#   2. System rebuilds canonical payload
#   3. SHA256 hash recomputed
#   4. Signature verified against hash using doctor's public key
#   5. Match → genuine Mismatch → tampered

import json
import base64
import hashlib
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.backends import default_backend
from cryptography.exceptions import InvalidSignature


# ── Key Generation ────────────────────────────────────────────────────────────

def generate_rsa_key_pair() -> tuple[str, str]:
    """
    Generates a new RSA-2048 key pair for a doctor.
    Called once when a doctor account is first approved.

    Returns:
        Tuple of (private_key_pem, public_key_pem) as strings
        Private key should be stored securely in DB
        Public key can be stored plaintext
    """
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
        backend=default_backend()
    )

    # Serialize private key to PEM format
    private_key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    ).decode("utf-8")

    # Serialize public key to PEM format
    public_key_pem = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode("utf-8")

    return private_key_pem, public_key_pem


# ── Canonical Payload ─────────────────────────────────────────────────────────

def build_prescription_payload(
    prescription_id: int,
    patient_id: int,
    doctor_id: int,
    items: list[dict],
    created_at: str
) -> str:
    """
    Builds a canonical (deterministic) JSON string of prescription data.
    Used as the input for signing and verification.

    Canonical = sorted keys, no extra whitespace
    This ensures the same prescription always produces the same string.

    Args:
        prescription_id: Unique prescription ID
        patient_id:      Patient's ID
        doctor_id:       Doctor's ID
        items:           List of prescription items
        created_at:      ISO timestamp of creation

    Returns:
        Canonical JSON string
    """
    # Sort items for determinism
    sorted_items = sorted(
        items,
        key=lambda x: x.get("medicine_name", "")
    )

    payload = {
        "prescription_id": prescription_id,
        "patient_id":      patient_id,
        "doctor_id":       doctor_id,
        "created_at":      created_at,
        "items": [
            {
                "medicine_name": item.get("medicine_name", ""),
                "dosage":        item.get("dosage", ""),
                "quantity":      item.get("quantity", ""),
                "instructions":  item.get("instructions", ""),
            }
            for item in sorted_items
        ]
    }

    # Compact JSON with sorted keys for determinism
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


# ── Signing ───────────────────────────────────────────────────────────────────

def sign_prescription(
    payload_str: str,
    private_key_pem: str
) -> str:
    """
    Signs a prescription payload using RSA-SHA256.

    Args:
        payload_str:     Canonical prescription JSON string
        private_key_pem: Doctor's RSA private key in PEM format

    Returns:
        Base64-encoded signature string

    Raises:
        ValueError if private key is invalid
    """
    try:
        private_key = serialization.load_pem_private_key(
            private_key_pem.encode("utf-8"),
            password=None,
            backend=default_backend()
        )
    except Exception as e:
        raise ValueError(f"Invalid private key: {e}")

    # Sign with RSA-PSS + SHA256
    # PSS (Probabilistic Signature Scheme) is more secure than PKCS1v15
    signature = private_key.sign(
        payload_str.encode("utf-8"),
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.MAX_LENGTH
        ),
        hashes.SHA256()
    )

    # Return as base64 string for storage
    return base64.b64encode(signature).decode("utf-8")


# ── Verification ──────────────────────────────────────────────────────────────

def verify_prescription_signature(
    payload_str: str,
    signature_b64: str,
    public_key_pem: str
) -> bool:
    """
    Verifies a prescription signature using the doctor's public key.
    Used by pharmacists before dispensing medication.

    Args:
        payload_str:    Canonical prescription JSON string (rebuilt from DB)
        signature_b64:  Base64-encoded signature from DB
        public_key_pem: Doctor's public key in PEM format

    Returns:
        True if signature is valid (prescription is genuine)
        False if signature is invalid (prescription may be tampered)
    """
    try:
        public_key = serialization.load_pem_public_key(
            public_key_pem.encode("utf-8"),
            backend=default_backend()
        )
    except Exception:
        return False

    try:
        signature = base64.b64decode(signature_b64)
    except Exception:
        return False

    try:
        public_key.verify(
            signature,
            payload_str.encode("utf-8"),
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.MAX_LENGTH
            ),
            hashes.SHA256()
        )
        return True  # Signature valid

    except InvalidSignature:
        return False  # Signature invalid — tampered or wrong key
    except Exception:
        return False
