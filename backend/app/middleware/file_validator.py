# app/middleware/file_validator.py
# File upload security validator for MediConnect
# Managed by Bihanga (B-2.1.1)
#
# RULES:
#   Allowed types: PDF, JPG/JPEG only
#   Max file size: 5MB
#   Validates REAL file content (not just extension)
#   Prevents: malware uploads, wrong file types, oversized files

from fastapi import HTTPException, UploadFile

# ── Constants ─────────────────────────────────────────────────────────────────

MAX_FILE_SIZE_MB    = 5
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024  # 5,242,880 bytes

# Allowed MIME types
ALLOWED_MIME_TYPES = {
    "application/pdf",
    "image/jpeg",
}

# Allowed file extensions
ALLOWED_EXTENSIONS = {
    ".pdf",
    ".jpg",
    ".jpeg",
}

# Magic bytes — the first few bytes of a file that identify its real type
# This prevents attackers from renaming a .exe to .pdf
MAGIC_BYTES = {
    b"\x25\x50\x44\x46":         "application/pdf",  # %PDF
    b"\xff\xd8\xff\xe0":         "image/jpeg",        # JPEG (JFIF)
    b"\xff\xd8\xff\xe1":         "image/jpeg",        # JPEG (EXIF)
    b"\xff\xd8\xff\xe2":         "image/jpeg",        # JPEG (ICC)
    b"\xff\xd8\xff\xe3":         "image/jpeg",        # JPEG
    b"\xff\xd8\xff\xdb":         "image/jpeg",        # JPEG
    b"\xff\xd8\xff\xee":         "image/jpeg",        # JPEG
}


# ── Validator Function ────────────────────────────────────────────────────────

async def validate_upload_file(file: UploadFile) -> bytes:
    """
    Validates an uploaded file for MIME type and file size.
    Used for SLMC license uploads from doctors.

    Checks:
        1. File extension is in whitelist (.pdf, .jpg, .jpeg)
        2. File size is under 5MB
        3. Real file content matches allowed types (magic bytes check)

    Args:
        file: FastAPI UploadFile object

    Returns:
        File contents as bytes if valid

    Raises:
        HTTPException 400 if file type is not allowed
        HTTPException 413 if file is too large
    """

    # ── Check 1: File extension ───────────────────────────────────
    filename  = file.filename or ""
    extension = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Invalid file type",
                "message": f"Only PDF and JPG files are allowed. "
                           f"You uploaded: '{extension or 'unknown'}'"
            }
        )

    # ── Check 2: Read file and check size ─────────────────────────
    contents = await file.read()

    if len(contents) > MAX_FILE_SIZE_BYTES:
        size_mb = len(contents) / (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail={
                "error": "File too large",
                "message": f"Maximum file size is {MAX_FILE_SIZE_MB}MB. "
                           f"Your file is {size_mb:.1f}MB."
            }
        )

    if len(contents) == 0:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Empty file",
                "message": "The uploaded file is empty."
            }
        )

    # ── Check 3: Magic bytes — real file type check ───────────────
    # Read first 4 bytes to identify the real file type
    file_header = contents[:4]
    detected_type = None

    for magic, mime_type in MAGIC_BYTES.items():
        if file_header.startswith(magic):
            detected_type = mime_type
            break

    if detected_type is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Invalid file content",
                "message": "File content does not match an allowed type. "
                           "Only real PDF and JPG files are accepted."
            }
        )

    if detected_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "Invalid file type",
                "message": f"Detected file type '{detected_type}' is not allowed. "
                           f"Only PDF and JPG files are accepted."
            }
        )

    return contents


# ── Helper — Safe Filename ────────────────────────────────────────────────────

def sanitize_filename(filename: str, user_id: str) -> str:
    """
    Creates a safe, unique filename for storage.
    Prevents path traversal attacks and filename collisions.

    Args:
        filename: Original filename from upload
        user_id: User's ID to make filename unique

    Returns:
        Safe filename e.g. "slmc_license_abc123_1234567890.pdf"
    """
    import re
    import time

    # Get extension
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    # Remove unsafe characters from user_id
    safe_user_id = re.sub(r'[^a-zA-Z0-9]', '', user_id)[:12]

    # Create unique filename with timestamp
    timestamp = int(time.time())

    return f"slmc_license_{safe_user_id}_{timestamp}{ext}"
