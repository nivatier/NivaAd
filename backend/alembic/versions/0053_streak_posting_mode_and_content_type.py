"""add posting_mode generate_lead_hours content_type image_model_id to website_streaks and streak_ads

Revision ID: 0053
Revises: 0052
Create Date: 2026-08-31

Adds:
  website_streaks: posting_mode, generate_lead_hours, content_type, image_model_id
  streak_ads:      content_type, image_model_id
"""
from alembic import op
import sqlalchemy as sa

revision = '0053'
down_revision = '0052'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # website_streaks — global streak settings
    op.add_column('website_streaks', sa.Column('posting_mode', sa.String(20), nullable=False, server_default='auto_post'))
    op.add_column('website_streaks', sa.Column('generate_lead_hours', sa.Integer(), nullable=False, server_default='24'))
    op.add_column('website_streaks', sa.Column('content_type', sa.String(20), nullable=False, server_default='text'))
    op.add_column('website_streaks', sa.Column('image_model_id', sa.String(120), nullable=True))

    # streak_ads — per-ad overrides (inherit from streak on creation)
    op.add_column('streak_ads', sa.Column('content_type', sa.String(20), nullable=False, server_default='text'))
    op.add_column('streak_ads', sa.Column('image_model_id', sa.String(120), nullable=True))


def downgrade() -> None:
    op.drop_column('streak_ads', 'image_model_id')
    op.drop_column('streak_ads', 'content_type')
    op.drop_column('website_streaks', 'image_model_id')
    op.drop_column('website_streaks', 'content_type')
    op.drop_column('website_streaks', 'generate_lead_hours')
    op.drop_column('website_streaks', 'posting_mode')
