"""add ref_id to notifications

Revision ID: e6f7a8b9c0d1
Revises: e5f6a7b8c9d0
Create Date: 2026-08-24

Adds ref_id (UUID, nullable, indexed) to the notifications table.
Stores the entity the notification is about — e.g. ad_id for
agent_draft_ready notifications — so dependent rows can be found
and cleared when the entity is deleted.
"""
from alembic import op
import sqlalchemy as sa

revision = 'e6f7a8b9c0d1'
down_revision = 'e5f6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'notifications',
        sa.Column('ref_id', sa.UUID(), nullable=True),
    )
    op.create_index('ix_notifications_ref_id', 'notifications', ['ref_id'])


def downgrade() -> None:
    op.drop_index('ix_notifications_ref_id', table_name='notifications')
    op.drop_column('notifications', 'ref_id')
