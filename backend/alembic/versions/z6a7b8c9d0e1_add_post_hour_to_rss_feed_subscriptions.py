"""add post_hour t rss_feed_subscriptions

Revision ID: z6a7b8c9d0e1
Revises: y5z6a7b8c9d0
Create Date: 2026-08-19
"""
from alembic import op
import sqlalchemy as sa

revision = 'z6a7b8c9d0e1'
down_revision = 'y5z6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'rss_feed_subscriptions',
        sa.Column('post_hour', sa.Integer(), nullable=False, server_default='9'),
    )


def downgrade() -> None:
    op.drop_column('rss_feed_subscriptions', 'post_hour')
