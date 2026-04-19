# app/middleware/ai_anonymiser.py
# Anonymisation middleware for AI API calls
# Managed by Bihanga (B-6.1.1)
#
# PURPOSE:
#   Strips personally identifiable information (PII) from patient/doctor
#   data snapshots before sending to external AI APIs (Gemini).
#
# WHY THIS MATTERS:
#   External AI APIs should never receive real patient names, DHIDs,
#   or other identifying information. Medical context (diagnosis,
#   medications, encounter notes) is kept for clinical usefulness
#   but all identifiers are replaced with neutral placeholders.
#
# WHAT GETS ANONYMISED:
#   Patient names    → "[PATIENT]"
#   Doctor names     → "[DOCTOR]"
#   Email addresses  → "[EMAIL]"
#   DHIDs            → "[DHID]"
#   User IDs         → "[ID]"
#   NIC hashes       → "[NIC]"
#
# WHAT IS KEPT (needed for clinical AI context):
#   Diagnosis notes, medications, encounter types,
#   appointment times, specialization, stats


import re
import copy


# ── Placeholder Constants ─────────────────────────────────────────────────────

PATIENT_PLACEHOLDER = "[PATIENT]"
DOCTOR_PLACEHOLDER  = "[DOCTOR]"
EMAIL_PLACEHOLDER   = "[EMAIL]"
DHID_PLACEHOLDER    = "[DHID]"
ID_PLACEHOLDER      = "[ID]"
NIC_PLACEHOLDER     = "[NIC]"


# ── DHID Pattern ──────────────────────────────────────────────────────────────

DHID_PATTERN = re.compile(r'DHID-\d{4}-\d{5}', re.IGNORECASE)
EMAIL_PATTERN = re.compile(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}')


# ── String-level Anonymisation ────────────────────────────────────────────────

def anonymise_string(value: str) -> str:
    """
    Anonymises a string value by replacing DHID and email patterns.

    Args:
        value: String to anonymise

    Returns:
        Anonymised string with PII replaced
    """
    if not isinstance(value, str):
        return value

    # Replace DHID patterns e.g. DHID-1234-56786
    value = DHID_PATTERN.sub(DHID_PLACEHOLDER, value)

    # Replace email patterns
    value = EMAIL_PATTERN.sub(EMAIL_PLACEHOLDER, value)

    return value


# ── Key-level Anonymisation ───────────────────────────────────────────────────

# Keys whose VALUES should be anonymised with patient placeholder
PATIENT_NAME_KEYS = {
    "name", "display_name", "patient_name", "full_name"
}

# Keys whose VALUES should be anonymised with email placeholder
EMAIL_KEYS = {
    "email", "email_address"
}

# Keys whose VALUES should be anonymised with DHID placeholder
DHID_KEYS = {
    "dhid", "patient_dhid"
}

# Keys whose VALUES should be anonymised with NIC placeholder
NIC_KEYS = {
    "nic", "nic_hash", "guardian_nic_hash"
}

# Keys whose VALUES should be anonymised with ID placeholder
# Note: numeric IDs are kept for clinical context
# Only string UUIDs are anonymised
UUID_KEYS = {
    "user_id", "auth_id"
}


# ── Deep Anonymisation ────────────────────────────────────────────────────────

def anonymise_snapshot(snapshot: dict, context: str = "general") -> dict:
    """
    Deep anonymises a data snapshot before sending to external AI APIs.
    Recursively processes all nested dicts and lists.

    Args:
        snapshot: The data snapshot to anonymise
        context:  "doctor" or "patient" — affects which name key is used

    Returns:
        Deep copy of snapshot with all PII replaced
    """
    if not snapshot or not isinstance(snapshot, dict):
        return snapshot

    # Work on a deep copy — never modify the original
    anon = copy.deepcopy(snapshot)

    _anonymise_dict(anon, context)
    return anon


def _anonymise_dict(data: dict, context: str):
    """Recursively anonymises a dictionary in-place."""
    for key, value in data.items():
        key_lower = key.lower()

        if isinstance(value, dict):
            # Determine context for nested dict
            nested_context = "patient" if "patient" in key_lower else context
            _anonymise_dict(value, nested_context)

        elif isinstance(value, list):
            _anonymise_list(value, context)

        elif isinstance(value, str):
            # Apply key-based anonymisation
            if key_lower in PATIENT_NAME_KEYS:
                # Use PATIENT or DOCTOR placeholder based on context
                if "doctor" in key_lower or context == "doctor":
                    data[key] = DOCTOR_PLACEHOLDER
                else:
                    data[key] = PATIENT_PLACEHOLDER

            elif key_lower in EMAIL_KEYS:
                data[key] = EMAIL_PLACEHOLDER

            elif key_lower in DHID_KEYS:
                data[key] = DHID_PLACEHOLDER

            elif key_lower in NIC_KEYS:
                data[key] = NIC_PLACEHOLDER

            elif key_lower in UUID_KEYS:
                data[key] = ID_PLACEHOLDER

            else:
                # Apply pattern-based anonymisation to all other strings
                data[key] = anonymise_string(value)


def _anonymise_list(data: list, context: str):
    """Recursively anonymises a list in-place."""
    for i, item in enumerate(data):
        if isinstance(item, dict):
            _anonymise_dict(item, context)
        elif isinstance(item, list):
            _anonymise_list(item, context)
        elif isinstance(item, str):
            data[i] = anonymise_string(item)


# ── Doctor Snapshot Anonymiser ────────────────────────────────────────────────

def anonymise_doctor_snapshot(snapshot: dict) -> dict:
    """
    Anonymises a doctor dashboard snapshot for Gemini API calls.
    Keeps clinical context, strips all PII.

    Args:
        snapshot: Doctor dashboard snapshot from _build_dashboard_payload()

    Returns:
        Anonymised snapshot safe for external AI API
    """
    return anonymise_snapshot(snapshot, context="doctor")


def anonymise_patient_snapshot(snapshot: dict) -> dict:
    """
    Anonymises a patient dashboard snapshot for Gemini API calls.
    Keeps clinical context, strips all PII.

    Args:
        snapshot: Patient dashboard snapshot

    Returns:
        Anonymised snapshot safe for external AI API
    """
    return anonymise_snapshot(snapshot, context="patient")
