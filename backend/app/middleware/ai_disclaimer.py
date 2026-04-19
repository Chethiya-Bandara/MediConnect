# app/middleware/ai_disclaimer.py
# Standardised AI response disclaimers for MediConnect
# Managed by Bihanga (B-6.2.1)
#
# PURPOSE:
#   Ensures every AI-generated response includes a clear disclaimer
#   that the response is AI-generated and not a substitute for
#   professional medical judgment.
#
# USAGE:
#   from app.middleware.ai_disclaimer import attach_disclaimer
#   response = attach_disclaimer(answer, source="gemini_edge", role="doctor")

# ── Disclaimer Templates ──────────────────────────────────────────────────────

DISCLAIMERS = {
    "doctor": (
        "⚠️ AI-generated response. "
        "This is a decision-support tool only. "
        "Always apply clinical judgment before acting on this information."
    ),
    "patient": (
        "⚠️ AI-generated response. "
        "This is for informational purposes only and does not constitute medical advice. "
        "Please consult your doctor before making any health decisions."
    ),
    "pharmacist": (
        "⚠️ AI-generated response. "
        "Verify all medication information against official sources before dispensing."
    ),
    "fallback": (
        "⚠️ AI-generated response. "
        "This information is not a substitute for professional medical advice."
    ),
}


# ── Source Labels ─────────────────────────────────────────────────────────────

SOURCE_LABELS = {
    "gemini_edge":      "Gemini AI",
    "doctor_fallback":  "MediConnect Assistant",
    "patient_fallback": "MediConnect Assistant",
    "fallback":         "MediConnect Assistant",
}


# ── Main Function ─────────────────────────────────────────────────────────────

def attach_disclaimer(
    answer: str,
    source: str = "fallback",
    role:   str = "fallback"
) -> dict:
    """
    Attaches a standardised disclaimer to an AI-generated response.

    Args:
        answer: The AI-generated answer text
        source: Where the answer came from e.g. "gemini_edge", "doctor_fallback"
        role:   The user role e.g. "doctor", "patient", "pharmacist"

    Returns:
        Dict with answer, disclaimer, source_label and is_ai_generated flag
    """
    disclaimer   = DISCLAIMERS.get(role, DISCLAIMERS["fallback"])
    source_label = SOURCE_LABELS.get(source, "AI Assistant")

    return {
        "answer":         answer,
        "disclaimer":     disclaimer,
        "source":         source,
        "source_label":   source_label,
        "is_ai_generated": True,
    }


def build_safe_response(
    answer: str,
    source: str = "fallback",
    role:   str = "fallback"
) -> dict:
    """
    Builds a complete safe AI response with disclaimer attached.
    Use this as the standard response format for all AI endpoints.

    Args:
        answer: The AI-generated answer text
        source: Source identifier
        role:   User role for appropriate disclaimer

    Returns:
        Standardised response dict with disclaimer
    """
    if not answer or not isinstance(answer, str):
        answer = "I was unable to generate a response. Please try again."

    return attach_disclaimer(answer, source=source, role=role)
