"""add tiktok_publish_ids to post_jobs

Revision ID: u1v2w3x4y5z6
Revises: s7t8u9v0w1x2y3
Create Date: 2026-08-12

Stores the publish_id strings returned by TikTok's Content Posting API
so that the /webhooks/tiktok endpoint can match async status callbacks
back to the originating PostJob row.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "u1v2w3x4y5z6"
down_revision = "t8u9v0w1x2y3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "post_jobs",
        sa.Column(
            "tiktok_publish_ids",
            postgresql.JSON(astext_type=sa.Text()),
            nullable=True,
            server_default="[]",
        ),
    )


def downgrade() -> None:
    op.drop_column("post_jobs", "tiktok_publish_ids")
