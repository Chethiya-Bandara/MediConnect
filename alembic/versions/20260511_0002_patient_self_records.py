"""Add patient self-record storage.

Revision ID: 20260511_0002
Revises: 20260509_0001
Create Date: 2026-05-11 13:10:00
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "20260511_0002"
down_revision = "20260509_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "patient_self_records",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("patient_id", sa.BigInteger(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "idx_patient_self_records_patient_created_at",
        "patient_self_records",
        ["patient_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_patient_self_records_patient_created_at", table_name="patient_self_records")
    op.drop_table("patient_self_records")
