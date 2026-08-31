"""add generate_lead_hours to streak_ads

Revision ID: 0055
Revises: 0054
Create Date: 2026-08-31

Adds per-ad generate_lead_hours to streak_ads so each individual idea
can have its own generation window (overrides the streak-level default).
Only relevant for auto_post mode — manual mode generates immediately
when the window arrives regardless of this value.
"""
from alembic import op
import sqlalchemy as sa

revision = '0055'
down_revision = '0054'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'streak_ads',
        sa.Column('generate_lead_hours', sa.Integer(), nullable=False, server_default='24'),
    )


def downgrade() -> None:
    op.drop_column('streak_ads', 'generate_lead_hours')
