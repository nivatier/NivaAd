"""add generation_error to website_streaks

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-08-19
"""
from alembic import op
import sqlalchemy as sa

revision = 'b2c3d4e5f6a7'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'website_streaks',
        sa.Column('generation_error', sa.Text(), nullable=True),
    )
    # Update existing 'active' rows to 'ideas_ready' to match new status vocabulary
    op.execute("UPDATE website_streaks SET status = 'ideas_ready' WHERE status = 'active'")


def downgrade() -> None:
    op.drop_column('website_streaks', 'generation_error')
    op.execute("UPDATE website_streaks SET status = 'active' WHERE status = 'ideas_ready'")
