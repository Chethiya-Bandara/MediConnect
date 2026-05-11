"""add medical record attachments

Revision ID: 20260511_0004
Revises: 20260511_0003
Create Date: 2026-05-11
"""

from alembic import op
import sqlalchemy as sa


revision = "20260511_0004"
down_revision = "20260511_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "medical_record_attachments",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=False), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("patient_id", sa.BigInteger(), sa.ForeignKey("patients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("encounter_id", sa.BigInteger(), sa.ForeignKey("encounters.id", ondelete="CASCADE"), nullable=True),
        sa.Column(
            "patient_self_record_id",
            sa.BigInteger(),
            sa.ForeignKey("patient_self_records.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("source_role", sa.Text(), nullable=False),
        sa.Column("source_user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("file_name", sa.Text(), nullable=False),
        sa.Column("file_url", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
    )
    op.create_index(
        "idx_medical_record_attachments_patient_created_at",
        "medical_record_attachments",
        ["patient_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_medical_record_attachments_patient_created_at", table_name="medical_record_attachments")
    op.drop_table("medical_record_attachments")
