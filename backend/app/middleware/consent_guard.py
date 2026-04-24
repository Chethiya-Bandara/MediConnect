# app/middleware/consent_guard.py
# Consent Guard — checks patient consent before allowing doctor access to history
# Managed by Bihanga (B-3.1.1)
#
# HOW IT WORKS:
#   Patient grants/revokes consent per appointment via:
#     POST /patient/dashboard/appointments/{appointment_id}/consent
#
#   Consent is stored in audit_logs table:
#     CONSENT_GRANTED → doctor can access patient history
#     CONSENT_REVOKED → doctor is blocked from patient history
#
#   This guard checks the LATEST consent action for an appointment
#   and blocks access if consent was not granted.
#
# USAGE:
#   # In any endpoint that accesses patient history:
#   from app.middleware.consent_guard import check_consent
#
#   @router.get("/patient/{patient_id}/history")
#   def get_history(patient_id: int, appointment_id: int, ...):
#       check_consent(doctor_id=doctor["id"], appointment_id=appointment_id)
#       # If no consent → 403 raised automatically
#       # If consent granted → continues normally

from fastapi import HTTPException, status
from app.config.supabase import supabase_admin


def check_consent(doctor_id: int, appointment_id: int) -> bool:
    """
    Checks whether a patient has granted consent for a doctor
    to access their medical history for a specific appointment.

    Reads the latest consent action from audit_logs.
    Raises 403 if consent is not granted.

    Args:
        doctor_id:      The doctor requesting access
        appointment_id: The appointment linked to the history request

    Returns:
        True if consent is granted

    Raises:
        HTTPException 403 if consent not granted or revoked
        HTTPException 404 if appointment not found
        HTTPException 500 if database error
    """

    # ── Verify appointment belongs to this doctor ─────────────────
    try:
        appointment = (
            supabase_admin.table("appointments")
            .select("id, doctor_id, patient_id, status")
            .eq("id", appointment_id)
            .eq("doctor_id", doctor_id)
            .single()
            .execute()
            .data
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found or does not belong to this doctor."
        )

    if not appointment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Appointment not found or does not belong to this doctor."
        )

    # ── Get latest consent action for this appointment ────────────
    try:
        consent_logs = (
            supabase_admin.table("audit_logs")
            .select("action, timestamp")
            .eq("entity", "appointment_consent")
            .eq("entity_id", appointment_id)
            .order("timestamp", desc=True)
            .limit(1)
            .execute()
            .data or []
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not verify patient consent. Please try again."
        )

    # ── Check consent status ──────────────────────────────────────
    if not consent_logs:
        # No consent action found — access denied by default
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Access denied. Patient has not granted consent for this appointment. "
                "The patient must grant consent before you can access their history."
            )
        )

    latest_action = consent_logs[0].get("action", "")

    if latest_action == "CONSENT_AUTO_REVOKED":
        # Encounter was finalised — consent auto-revoked by system
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Access denied. This appointment has been finalised. "
                "Consent was automatically revoked when the encounter was completed."
            )
        )

    if latest_action != "CONSENT_GRANTED":
        # Latest action was CONSENT_REVOKED or unknown
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Access denied. Patient has revoked consent for this appointment. "
                "You cannot access their medical history."
            )
        )

    return True


def get_consent_status(appointment_id: int) -> dict:
    """
    Returns the current consent status for an appointment.
    Used to display consent status in the UI without blocking.

    Args:
        appointment_id: The appointment to check

    Returns:
        Dict with consent status details
    """
    try:
        consent_logs = (
            supabase_admin.table("audit_logs")
            .select("action, timestamp, user_id")
            .eq("entity", "appointment_consent")
            .eq("entity_id", appointment_id)
            .order("timestamp", desc=True)
            .limit(1)
            .execute()
            .data or []
        )
    except Exception:
        return {
            "granted":      False,
            "status":       "Unknown",
            "last_updated": None,
        }

    if not consent_logs:
        return {
            "granted":      False,
            "status":       "Pending",
            "last_updated": None,
        }

    latest = consent_logs[0]
    granted = latest.get("action") == "CONSENT_GRANTED"

    return {
        "granted":      granted,
        "status":       "Granted" if granted else "Revoked",
        "last_updated": latest.get("timestamp"),
    }

def auto_revoke_consent(
    appointment_id: int,
    doctor_user_id: str,
    reason: str = "Encounter finalised — consent auto-revoked"
) -> bool:
    """
    Automatically revokes patient consent when an encounter is finalised.
    Called after appointment is marked as completed.

    Logs CONSENT_AUTO_REVOKED to audit_logs so the revocation
    is traceable and cannot be mistaken for a manual revocation.

    Args:
        appointment_id:  The appointment being finalised
        doctor_user_id:  The doctor's user ID (for audit log)
        reason:          Why consent was revoked (for audit trail)

    Returns:
        True if revocation was logged successfully
        False if it failed (non-blocking — encounter still completes)
    """
    try:
        from datetime import datetime
        supabase_admin.table("audit_logs").insert({
            "action":    "CONSENT_AUTO_REVOKED",
            "entity":    "appointment_consent",
            "entity_id": appointment_id,
            "user_id":   doctor_user_id,
            "timestamp": datetime.now().astimezone().isoformat(),
            "notes":     reason,
        }).execute()
        return True

    except Exception:
        # Auto-revocation failure should NOT block the encounter from completing
        # Log the failure but let the encounter proceed
        return False


def is_appointment_finalised(appointment_id: int) -> bool:
    """
    Checks if an appointment has been finalised (completed).
    Used to prevent doctors from accessing history of completed appointments.

    Args:
        appointment_id: The appointment to check

    Returns:
        True if appointment is completed, False otherwise
    """
    try:
        appointment = (
            supabase_admin.table("appointments")
            .select("status")
            .eq("id", appointment_id)
            .single()
            .execute()
            .data
        )
        if not appointment:
            return False

        return (appointment.get("status") or "").lower() == "completed"

    except Exception:
        return False
