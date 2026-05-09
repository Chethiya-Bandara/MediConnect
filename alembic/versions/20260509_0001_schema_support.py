"""Bootstrap migration support for performance and anomaly tables.

Revision ID: 20260509_0001
Revises:
Create Date: 2026-05-09 23:45:00
"""
from __future__ import annotations

from pathlib import Path

from alembic import op


revision = "20260509_0001"
down_revision = None
branch_labels = None
depends_on = None


ROOT = Path(__file__).resolve().parents[2]


def _execute_sql_file(relative_path: str) -> None:
    sql = (ROOT / relative_path).read_text(encoding="utf-8")
    op.execute(sql)


def upgrade() -> None:
    _execute_sql_file("backend/app/db/create_anomaly_flags.sql")
    _execute_sql_file("backend/app/db/create_indexes.sql")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_appointments_patient_id")
    op.execute("DROP INDEX IF EXISTS idx_appointments_doctor_id")
    op.execute("DROP INDEX IF EXISTS idx_appointments_start_time")
    op.execute("DROP INDEX IF EXISTS idx_appointments_status")
    op.execute("DROP INDEX IF EXISTS idx_appointments_org_start")
    op.execute("DROP INDEX IF EXISTS idx_encounters_patient_id")
    op.execute("DROP INDEX IF EXISTS idx_encounters_doctor_id")
    op.execute("DROP INDEX IF EXISTS idx_encounters_created_at")
    op.execute("DROP INDEX IF EXISTS idx_encounters_created_date")
    op.execute("DROP INDEX IF EXISTS idx_prescriptions_patient_id")
    op.execute("DROP INDEX IF EXISTS idx_prescriptions_doctor_id")
    op.execute("DROP INDEX IF EXISTS idx_prescriptions_created_at")
    op.execute("DROP INDEX IF EXISTS idx_prescriptions_status")
    op.execute("DROP INDEX IF EXISTS idx_audit_logs_timestamp")
    op.execute("DROP INDEX IF EXISTS idx_audit_logs_entity")
    op.execute("DROP INDEX IF EXISTS idx_audit_logs_user_id")
    op.execute("DROP TABLE IF EXISTS anomaly_flags")
