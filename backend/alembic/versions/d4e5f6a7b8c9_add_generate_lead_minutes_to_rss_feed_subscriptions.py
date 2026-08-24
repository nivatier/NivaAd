"""add generate time columns to rss_feed_subscriptions

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-08-23

Adds three columns:
  generate_lead_minutes — UI control: minutes before post time (15/30/45/60)
  generate_hour         — computed UTC hour stored for fast beat query
  generate_minute       — computed UTC minute
"""
from alembic import op
import sqlalchemy as sa

revision = 'd4e5f6a7b8c9'
down_revision = 'c3d4e5f6a7b8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('rss_feed_subscriptions',
        sa.Column('generate_lead_minutes', sa.Integer(), nullable=False, server_default='30'))
    op.add_column('rss_feed_subscriptions',
        sa.Column('generate_hour', sa.Integer(), nullable=False, server_default='8'))
    op.add_column('rss_feed_subscriptions',
        sa.Column('generate_minute', sa.Integer(), nullable=False, server_default='30'))


def downgrade() -> None:
    op.drop_column('rss_feed_subscriptions', 'generate_minute')
    op.drop_column('rss_feed_subscriptions', 'generate_hour')
    op.drop_column('rss_feed_subscriptions', 'generate_lead_minutes')
