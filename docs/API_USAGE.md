# API Usage

## Base URLs
- Backend API: `http://127.0.0.1:8001`
- Swagger UI: `http://127.0.0.1:8001/docs`

## Authentication
Most protected routes expect:
```http
Authorization: Bearer <access_token>
```

Login is handled through the auth routes. After login, the frontend stores the returned access token and sends it on subsequent API calls.

## Common Role Dashboards
- Patient: `/patient/dashboard/*`
- Doctor: `/doctor/dashboard/*`
- Pharmacist: `/pharmacist/dashboard/*`
- Pharmacy Admin: `/pharmacy-admin/*`
- Health Ministry Admin: `/moh-admin/*`

## Useful Examples

### Patient assistant
`POST /patient/dashboard/assistant/respond`

Request:
```json
{
  "message": "Book me the earliest cardiology slot tomorrow",
  "history": []
}
```

Behavior:
- The assistant can propose a live slot.
- It will not book immediately.
- The patient must explicitly confirm with a follow-up message in the form:
  `Confirm booking slot 123`

### Patient appointment booking
`POST /patient/dashboard/appointments`

Request:
```json
{
  "slot_id": 123
}
```

### Doctor encounter submission
`POST /doctor/dashboard/encounters`

Current guard rails:
- diagnosis must resolve to a saved disease from the database
- each prescription item must map to a real `medicine_id`

### MOH monthly AI report
`POST /moh-admin/reports/monthly`

Behavior:
- computes the current monthly statistics payload
- asks Gemini to summarize it when available
- falls back to a computed text report if Gemini is unavailable

## Notes
- Patient DHID QR display is already rendered in the patient dashboard UI.
- Browser-based QR scanning is already implemented in the pharmacist dashboard via `html5-qrcode`.
- Frontend runs on Vite port `5173`.
- Backend helper `run_dev.py` currently serves on port `8001`, not `8000`.
