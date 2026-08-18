"""add rss feed health check columns

Revision ID: x4y5z6a7b8c9
Revises: w3x4y5z6a7b8
Create Date: 2026-08-18

Adds four health-status columns to rss_feeds:
  last_checked_at     — when the feed was last probed
  last_status         — "ok" | "error" | NULL (never checked)
  last_error          — human-readable error message from last failed probe
  last_article_count  — number of articles found on last successful probe

The health_check_interval_days value is stored in model_config (topic="rss")
and defaults to 7 (weekly). No migration row needed — get_config_row creates
the row on first access if it doesn't exist.
"""
from alembic import op
import sqlalchemy as sa

revision = "x4y5z6a7b8c9"
down_revision = "w3x4y5z6a7b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rss_feeds", sa.Column("last_checked_at",    sa.DateTime(),    nullable=True))
    op.add_column("rss_feeds", sa.Column("last_status",        sa.String(10),    nullable=True))
    op.add_column("rss_feeds", sa.Column("last_error",         sa.String(500),   nullable=True))
    op.add_column("rss_feeds", sa.Column("last_article_count", sa.Integer(),     nullable=True))


def downgrade() -> None:
    op.drop_column("rss_feeds", "last_article_count")
    op.drop_column("rss_feeds", "last_error")
    op.drop_column("rss_feeds", "last_status")
    op.drop_column("rss_feeds", "last_checked_at")
