"""add greeting fields to agent_events

Revision ID: o3p4q5r6s7t8
Revises: n2o3p4q5r6s7
Create Date: 2026-07-30

Adds five columns that turn recurring events into branded greeting posts:
  post_hour / post_minute  — user-chosen posting time (UTC)
  wish_tone                — copy style: warm | professional | fun | luxury
  visual_style             — image style: festive | minimal | bold | elegant
  reference_image_url      — optional product/scene photo (R2 URL)

server_defaults keep every existing event row valid without a data migration.
"""
from alembic import op
import sqlalchemy as sa

revision = "o3p4q5r6s7t8"
down_revision = "n2o3p4q5r6s7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agent_events", sa.Column("post_hour",   sa.Integer(), nullable=False, server_default="10"))
    op.add_column("agent_events", sa.Column("post_minute", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("agent_events", sa.Column("wish_tone",   sa.String(20), nullable=False, server_default="warm"))
    op.add_column("agent_events", sa.Column("visual_style", sa.String(20), nullable=False, server_default="festive"))
    op.add_column("agent_events", sa.Column("reference_image_url", sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column("agent_events", "reference_image_url")
    op.drop_column("agent_events", "visual_style")
    op.drop_column("agent_events", "wish_tone")
    op.drop_column("agent_events", "post_minute")
    op.drop_column("agent_events", "post_hour")
