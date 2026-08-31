"""add posting_mode to streak_ads

Revision ID: 0054
Revises: 0053
Create Date: 2026-08-31

0053 already added content_type and image_model_id to streak_ads.
This adds the missing posting_mode column (per-ad override of the
streak-level posting_mode, so individual ads can be auto-post or manual
independently).
"""
from alembic import op
import sqlalchemy as sa

revision = '0054'
down_revision = '0053'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'streak_ads',
        sa.Column('posting_mode', sa.String(20), nullable=False, server_default='auto_post'),
    )


def downgrade() -> None:
    op.drop_column('streak_ads', 'posting_mode')
