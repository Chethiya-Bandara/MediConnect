# MediConnect

## Overview
MediConnect is a secure, web-based digital healthcare platform designed for Sri Lanka.
It connects Patients, Doctors, Hospitals, Pharmacies, and Health Ministry Administrators in one centralized system.

## Project Goal
Build an interoperable, role-driven healthcare platform that supports:
- Digital patient identity (DHID)
- Appointments and scheduling
- Clinical encounters and medical history
- ePrescriptions and pharmacy dispensing
- Consent management
- Government analytics and reporting
- AI-assisted support (with clear medical disclaimers)

## Why This Project
Sri Lanka's healthcare system still faces fragmentation due to paper-based records and limited interoperability.
MediConnect aims to reduce delays, duplicate tests, and incomplete patient history risks by offering one unified workflow.

## User Roles
- Patient
- Doctor
- Hospital Admin
- Pharmacist / Pharmacy Admin
- Health Ministry Admin

## Core Modules (Planned in 6 Phases)
1. Identity, Authentication, and Organization Setup
2. DHID and Doctor-Hospital Affiliation
3. Scheduling, Appointments, and Consent
4. Encounters, Medical Records, and ePrescriptions
5. Pharmacy, Inventory, Dispensing, and Billing
6. AI Assistants, Analytics, and Audit System

## Functional Highlights
- Multi-role registration and authentication
- NIC-based verification and DHID generation (`DHID-XXXX-XXXX`)
- Appointment booking and doctor availability management
- Consent-based access to patient history
- Encounter creation and full medical history view for patients
- Digitally signed ePrescriptions with lifecycle tracking
- Pharmacy lookup and dispensing by DHID
- Inventory and itemized billing support
- Government disease-incidence analytics by district/time window
- AI chatbot + doctor summary assistant (advisory only)

## Non-Functional Highlights
- bcrypt password hashing
- JWT-based auth with environment-managed secrets
- Strict RBAC + organization boundary checks
- Rate limiting and request validation
- Privacy controls (NIC masking, restricted diagnosis visibility)
- Audit logs for sensitive actions
- Transaction consistency for critical operations
- FastAPI modular architecture + SQLAlchemy/Alembic migrations
- Docker-friendly local deployment

## Tech Stack
- Frontend: React.js / Next.js
- Backend: FastAPI (Python)
- Database: PostgreSQL (+ Supabase)
- AI: Gemini API
- Version Control: GitHub
- Design: Figma
- DevOps/Runtime: Docker / Docker Compose
- Security Testing: OWASP ZAP, Burp Suite, Kali Linux

## Current Scope
Included:
- Web portal (desktop/tablet)
- Full multi-role healthcare workflow
- Security, privacy, auditing, and analytics baseline

Excluded (for now):
- Native mobile apps
- SMS/push reminders
- Telemedicine video module
- Calendar sync (Google Calendar/iCal)
- Patient PDF export modules
- Multilingual UI (Sinhala/Tamil)

## Planned Milestones
- Proposal Submission: 16 Mar 2026
- Final Presentation: 04 May 2026
- Final Report: 11 May 2026
- Professional Portfolio: 18 May 2026

---

## How to Run Locally

### Prerequisites
Make sure you have the following installed:
- Python 3.12 or higher
- Node.js 20 or higher
- Git

### 1. Clone the Repository
```bash
git clone https://github.com/Mohamed-Ruzaik/MediConnect.git
cd MediConnect
```

### 2. Backend Setup
```bash
cd backend

# Install dependencies
pip install -r requirements.txt

# Set up environment variables
cp .env.example .env
# Open .env and fill in your Supabase and JWT secret values

# Run the backend server
python -m uvicorn main:app --reload
```
Backend runs at: `http://127.0.0.1:8000`
API docs available at: `http://127.0.0.1:8000/docs`

### 3. Frontend Setup
```bash
cd frontend

# Install dependencies
npm install

# Run the frontend
npm run dev
```
Frontend runs at: `http://localhost:5173`

### 4. Pre-commit Security Hooks (for contributors)
```bash
# Run from the MediConnect root folder
pip install pre-commit
python -m pre_commit install
```
This automatically checks every commit for hardcoded secrets.

---

## Team
| Name | Role |
|------|------|
| Chethiya Bandara | Backend Lead / DB Engineer / AI-ML |
| Bihanga Rathnayaka | Project Lead / Security Engineer |
| Mohamed Ruzaik | Frontend Developer / Full-Stack Engineer |
| Ranuda Premadasa | Full-Stack Engineer / API Integration Lead |
| Pasindu Nawagamuwage | Security Tester / QA Engineer |

---

## Academic Supervision
This project was guided and supervised by Ann Roshanie Appuhamy as part of undergraduate coursework.
