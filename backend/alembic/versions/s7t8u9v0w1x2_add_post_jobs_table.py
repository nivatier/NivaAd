"""add post_jobs table for async celery posting

Revision ID: s7t8u9v0w1x2
Revises: p4q5r6s7t8u9
Create Date: 2026-08-03

post_jobs tracks one row per "Post Now" click, enabling the
API endpoint to return immediately with a job_id and the
frontend to poll for per-platform results.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSON

revision = "s7t8u9v0w1x2"
down_revision = "r6s7t8u9v0w1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "post_jobs",
        sa.Column("id",          UUID(as_uuid=True), primary_key=True),
        sa.Column("company_id",  UUID(as_uuid=True), sa.ForeignKey("companies.id"), nullable=False, index=True),
        sa.Column("ad_id",       UUID(as_uuid=True), sa.ForeignKey("ads.id"),       nullable=False, index=True),
        sa.Column("platforms",   JSON, nullable=False, server_default="[]"),
        sa.Column("status",      sa.String(20), nullable=False, server_default="queued", index=True),
        sa.Column("succeeded",   JSON, nullable=False, server_default="[]"),
        sa.Column("failed",      JSON, nullable=False, server_default="{}"),
        sa.Column("error",       sa.Text, nullable=True),
        sa.Column("created_at",  sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("finished_at", sa.DateTime, nullable=True),
    )


def downgrade() -> None:
    op.drop_table("post_jobs")
