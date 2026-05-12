import json
import os
import base64
from typing import Optional
from urllib import error as urllib_error
from urllib import request as urllib_request


def _extract_answer(payload) -> Optional[str]:
    if isinstance(payload, str):
        cleaned = payload.strip()
        return cleaned or None

    if isinstance(payload, list):
        for item in payload:
            answer = _extract_answer(item)
            if answer:
                return answer
        return None

    if not isinstance(payload, dict):
        return None

    for key in ("answer", "response", "reply", "text", "message"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    content = payload.get("content")
    if isinstance(content, dict):
        parts = content.get("parts")
        if isinstance(parts, list):
            for part in parts:
                if isinstance(part, dict):
                    text = part.get("text")
                    if isinstance(text, str) and text.strip():
                        return text.strip()

    candidates = payload.get("candidates")
    if isinstance(candidates, list):
        for candidate in candidates:
            answer = _extract_answer(candidate)
            if answer:
                return answer

    return None


def _summarize_http_error(exc: urllib_error.HTTPError) -> str:
    raw = exc.read().decode("utf-8", "replace")

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        payload = None

    message = ""
    if isinstance(payload, dict):
        error = payload.get("error", {})
        if isinstance(error, dict):
            message = str(error.get("message") or "").strip()

    if exc.code == 429:
        return "Gemini API quota is exhausted for this key"
    if exc.code in {401, 403}:
        return "Gemini API rejected the configured credentials"
    if exc.code == 404:
        return "the configured Gemini model is unavailable"
    if message:
        return message
    return f"Gemini API returned HTTP {exc.code}"


def _configured_api_keys() -> list[str]:
    candidates = [
        os.getenv("GEMINI_API_KEY", ""),
        os.getenv("GEMINI_API_KEY_BACKUP", ""),
        os.getenv("GEMINI_API_KEY_2", ""),
        os.getenv("GOOGLE_API_KEY", ""),
    ]

    csv_keys = os.getenv("GEMINI_API_KEYS", "")
    if csv_keys:
        candidates.extend(part.strip() for part in csv_keys.split(","))

    keys: list[str] = []
    seen = set()
    for candidate in candidates:
        cleaned = candidate.strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        keys.append(cleaned)

    return keys


def _call_edge(payload: dict) -> tuple[Optional[str], Optional[str]]:
    edge_url = os.getenv("GEMINI_EDGE_FUNCTION_URL")
    if not edge_url:
        return None, None

    token = os.getenv("GEMINI_EDGE_FUNCTION_TOKEN") or os.getenv("SUPABASE_SERVICE_KEY")
    encoded = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["apikey"] = token

    request = urllib_request.Request(edge_url, data=encoded, headers=headers, method="POST")

    try:
        with urllib_request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except urllib_error.HTTPError as exc:
        return None, _summarize_http_error(exc)
    except urllib_error.URLError:
        return None, "Gemini edge endpoint is unreachable"

    if not raw.strip():
        return None, "Gemini edge returned an empty response"

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return raw.strip(), None

    answer = _extract_answer(parsed)
    if answer:
        return answer, None

    return None, "Gemini edge returned no usable answer"


def _build_direct_prompt(message: str, history: list[dict], snapshot: dict, context_key: str) -> str:
    role_label = context_key.replace("_context", "").replace("_", " ")
    history_lines = "\n".join(
        f"{item.get('role', 'user')}: {item.get('text', '').strip()}"
        for item in history[-12:]
        if item.get("text")
    )
    runtime = snapshot.get("assistant_runtime", {}) if isinstance(snapshot, dict) else {}
    timezone_name = runtime.get("timezone") or "Asia/Colombo"
    current_date = runtime.get("current_date") or "unknown"
    current_datetime = runtime.get("current_datetime") or "unknown"

    return (
        f"You are the MediConnect {role_label} AI assistant.\n"
        "Reply in a natural, conversational, free-style way that matches the user's tone.\n"
        "Reply in the same language or language mix the user uses, including Sinhala, Tamil, English, or Singlish when appropriate.\n"
        f"Treat the current local timezone as {timezone_name}.\n"
        f"Treat today's local date as {current_date}, and the current local datetime as {current_datetime}.\n"
        "When the user says today, tomorrow, yesterday, heta, ada, or iye, resolve those words using that local Sri Lanka date only.\n"
        "Do not guess or shift the date to another timezone.\n"
        "Use the provided JSON context and recent conversation for anything about the user's saved records, appointments, availability, prescriptions, dashboard data, or identity.\n"
        "You may also give general health education, practical next steps, and clarifying questions when the user's message asks for broader guidance.\n"
        "Clearly say when something is general information instead of data from MediConnect records.\n"
        "Do not invent diagnoses, appointments, availability, medicines, prescriptions, test results, or records.\n"
        "For medicine-alternative questions, only mention exact generic equivalents when the ingredient, strength, and dosage form all match the provided data, and do not suggest therapeutic alternatives.\n"
        "Do not give a definitive diagnosis or emergency reassurance; mention urgent care when symptoms sound severe.\n"
        "Keep replies short: usually 2-4 sentences, or a few compact bullets only when that is clearer.\n"
        "Keep the reply useful and human, not robotic.\n\n"
        f"Recent conversation:\n{history_lines or 'No prior conversation.'}\n\n"
        f"Structured context JSON:\n{json.dumps(snapshot, ensure_ascii=True)}\n\n"
        f"Latest user question:\n{message}"
    )


def _call_direct_gemini(payload: dict) -> tuple[Optional[str], Optional[str]]:
    api_keys = _configured_api_keys()
    if not api_keys:
        return None, "Gemini API key is not configured on the server"

    model = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
    context_key = "patient_context"
    snapshot = payload.get(context_key) or {}
    if "moh_admin_context" in payload:
        context_key = "moh_admin_context"
        snapshot = payload.get("moh_admin_context") or {}
    elif "doctor_context" in payload:
        context_key = "doctor_context"
        snapshot = payload.get("doctor_context") or {}

    prompt = _build_direct_prompt(
        message=str(payload.get("message") or "").strip(),
        history=payload.get("history") or [],
        snapshot=snapshot,
        context_key=context_key,
    )

    request_payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
        "generationConfig": {
            "temperature": 0.3,
            "topP": 0.9,
        },
    }

    last_issue = "Gemini AI is unavailable right now"
    quota_failures = 0

    for api_key in api_keys:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            f"?key={api_key}"
        )
        request = urllib_request.Request(
            url,
            data=json.dumps(request_payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib_request.urlopen(request, timeout=30) as response:
                raw = response.read().decode("utf-8")
        except urllib_error.HTTPError as exc:
            issue = _summarize_http_error(exc)
            last_issue = issue
            if exc.code == 429:
                quota_failures += 1
                continue
            return None, issue
        except urllib_error.URLError:
            return None, "Gemini API is unreachable from the server"

        if not raw.strip():
            last_issue = "Gemini API returned an empty response"
            continue

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return raw.strip(), None

        answer = _extract_answer(parsed)
        if answer:
            return answer, None

        last_issue = "Gemini API returned no usable answer"

    if quota_failures == len(api_keys) and api_keys:
        return None, "all configured Gemini API keys are temporarily out of quota"

    return None, last_issue


def call_gemini_assistant(payload: dict) -> tuple[Optional[str], Optional[str]]:
    answer, issue = _call_edge(payload)
    if answer:
        return answer, None

    direct_answer, direct_issue = _call_direct_gemini(payload)
    if direct_answer:
        return direct_answer, None

    return None, direct_issue or issue or "Gemini AI is unavailable right now"


def verify_identity_document(
    *,
    image_bytes: bytes,
    mime_type: str,
    expected_nic: str,
    expected_full_name: str,
    expected_dob: str = "",
    expected_gender: str = "",
) -> tuple[Optional[dict], Optional[str]]:
    api_keys = _configured_api_keys()
    if not api_keys:
        return None, "Gemini API key is not configured on the server"

    model = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
    prompt = (
        "You are verifying a Sri Lankan NIC image for registration.\n"
        "Return JSON only with these keys:\n"
        "is_identity_document: boolean,\n"
        "document_type: string,\n"
        "nic_number: string,\n"
        "full_name: string,\n"
        "date_of_birth: string,\n"
        "gender: string,\n"
        "matches_expected_nic: boolean,\n"
        "matches_expected_name: boolean,\n"
        "matches_expected_dob: boolean,\n"
        "matches_expected_gender: boolean,\n"
        "confidence: number,\n"
        "reason: string.\n"
        "If the image is unreadable, say so in reason and set confidence low.\n"
        f"Expected NIC: {expected_nic}\n"
        f"Expected full name: {expected_full_name}\n"
        f"Expected date of birth: {expected_dob}\n"
        f"Expected gender: {expected_gender}\n"
        "Treat minor OCR spacing and case differences as acceptable for matches_expected_name and matches_expected_nic.\n"
        "For gender, normalize to male or female.\n"
        "For date_of_birth, prefer YYYY-MM-DD. If you cannot read a value clearly, return an empty string and set the corresponding match flag to false."
    )

    request_payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": base64.b64encode(image_bytes).decode("ascii"),
                        }
                    },
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "topP": 0.8,
        },
    }

    last_issue = "Gemini verification is unavailable right now"
    quota_failures = 0
    for api_key in api_keys:
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            f"?key={api_key}"
        )
        request = urllib_request.Request(
            url,
            data=json.dumps(request_payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib_request.urlopen(request, timeout=45) as response:
                raw = response.read().decode("utf-8")
        except urllib_error.HTTPError as exc:
            issue = _summarize_http_error(exc)
            last_issue = issue
            if exc.code == 429:
                quota_failures += 1
                continue
            return None, issue
        except urllib_error.URLError:
            return None, "Gemini API is unreachable from the server"

        if not raw.strip():
            last_issue = "Gemini verification returned an empty response"
            continue

        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return None, "Gemini verification returned invalid JSON"

        answer = _extract_answer(parsed)
        if not answer:
            last_issue = "Gemini verification returned no usable answer"
            continue

        try:
            verification = json.loads(answer)
        except json.JSONDecodeError:
            cleaned = answer.strip().strip("`")
            if cleaned.lower().startswith("json"):
                cleaned = cleaned[4:].strip()
            try:
                verification = json.loads(cleaned)
            except json.JSONDecodeError:
                return None, "Gemini verification returned malformed JSON"

        if isinstance(verification, dict):
            return verification, None

        last_issue = "Gemini verification returned an unexpected payload"

    if quota_failures == len(api_keys) and api_keys:
        return None, "all configured Gemini API keys are temporarily out of quota"

    return None, last_issue
