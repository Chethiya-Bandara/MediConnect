# MediConnect — Authentication Security Design
**Author:** Bihanga Rathnayaka (Security Engineer)  
**Iteration:** IT-1  
**Tasks:** B-1.1.1, B-1.1.2  
**Status:** In Progress  

---

## 1. Password Hashing

| Parameter | Value | Justification |
|-----------|-------|---------------|
| Algorithm | bcrypt | Industry standard for password hashing; resistant to GPU brute-force |
| Cost Factor (rounds) | `12` | OWASP-recommended minimum for healthcare systems; ~400ms per hash |
| Library | `passlib[bcrypt]` | Widely audited Python bcrypt wrapper |

**Config key:** `BCRYPT_ROUNDS=12` in `.env`

---

## 2. JWT Token Policies

### 2.1 Token Types

| Token | Expiry | Secret | Purpose |
|-------|--------|--------|---------|
| Access Token | 15 minutes | `JWT_ACCESS_SECRET` | Authenticates every API request |
| Refresh Token | 7 days | `JWT_REFRESH_SECRET` | Obtains a new access token silently |

> Access and refresh tokens use **separate secrets**.  
> If one secret is compromised, the other remains secure.

---

### 2.2 Access Token Payload Structure
```json
{
  "sub":  "<user_id>",
  "role": "patient | doctor | pharmacist | hospital_admin | health_ministry_admin",
  "type": "access",
  "iat":  "<issued_at_timestamp>",
  "exp":  "<expiry_timestamp>"
}
```

---

### 2.3 Refresh Token Payload Structure
```json
{
  "sub":  "<user_id>",
  "type": "refresh",
  "iat":  "<issued_at_timestamp>",
  "exp":  "<expiry_timestamp>"
}
```

> Refresh tokens do **not** contain the role.  
> The role is re-fetched from the database when a new access token is issued.  
> This ensures role changes (e.g. account suspension) take effect immediately.

---

### 2.4 Refresh Token Rotation Policy

| Rule | Detail |
|------|--------|
| Single-use | Each refresh token can only be used **once** |
| Auto-rotation | Using a refresh token issues a **new** refresh token (fresh 7-day window) |
| Replay detection | If a refresh token is used **twice**, **both** tokens are revoked immediately |
| Forced re-login | After replay detection, the user must authenticate again |

**Implementation note for Chethiya (C-1.4.1):**  
The database needs a `refresh_tokens` table (or `token_version` column on the users table)  
to track which refresh tokens have been used and detect replay attacks.

---

### 2.5 Token Delivery & Storage Rules

#### Access Token
- Returned in the **JSON response body** after login
- Frontend stores in **memory only** (JavaScript variable)
- ❌ Must NOT be stored in `localStorage` or `sessionStorage` — vulnerable to XSS
- Sent on every request as: `Authorization: Bearer <token>`

#### Refresh Token
- Delivered via `Set-Cookie` HTTP header with the following flags:
