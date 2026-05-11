"""Add patient health snapshot storage.

Revision ID: 20260511_0003
Revises: 20260511_0002
Create Date: 2026-05-11 16:05:00
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260511_0003"
down_revision = "20260511_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "patient_health_snapshots",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("source_role", sa.Text(), nullable=False),
        sa.Column("source_user_id", sa.Text(), nullable=True),
        sa.Column("encounter_id", sa.BigInteger(), nullable=True),
        sa.Column("patient_self_record_id", sa.BigInteger(), nullable=True),
        sa.Column("bmi", sa.Text(), nullable=True),
        sa.Column("blood_sugar", sa.Text(), nullable=True),
        sa.Column("cholesterol", sa.Text(), nullable=True),
        sa.Column("blood_pressure", sa.Text(), nullable=True),
        sa.Column("allergies", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["encounter_id"], ["encounters.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["patient_self_record_id"], ["patient_self_records.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "idx_patient_health_snapshots_patient_checked_at",
        "patient_health_snapshots",
        ["patient_id", "checked_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_patient_health_snapshots_patient_checked_at", table_name="patient_health_snapshots")
    op.drop_table("patient_health_snapshots")
