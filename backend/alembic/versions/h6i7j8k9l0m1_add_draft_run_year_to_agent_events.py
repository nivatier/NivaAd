"""add draft_run_year to agent_events

Revision ID: h6i7j8k9l0m1
Revises: g5h6i7j8k9l0
Create Date: 2026-07-22 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'h6i7j8k9l0m1'
down_revision: Union[str, None] = 'g5h6i7j8k9l0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'agent_events',
        sa.Column('draft_run_year', sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('agent_events', 'draft_run_year')
