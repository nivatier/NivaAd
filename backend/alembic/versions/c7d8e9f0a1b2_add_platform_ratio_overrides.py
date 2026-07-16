"""add platform_ratio_overrides to brand_kits

Revision ID: c7d8e9f0a1b2
Revises: b1c2d3e4f5a6
Create Date: 2026-07-16 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c7d8e9f0a1b2'
down_revision: Union[str, None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # {"platform_id": "ratio"} — a company's own override of the
    # developer's platform-wide default ratio (see
    # services/platform_config.py). Only platforms a company has
    # explicitly overridden appear here; anything absent falls back to
    # the developer default, so this starts empty for every existing
    # company and nothing changes until an admin actually sets one.
    op.add_column('brand_kits', sa.Column('platform_ratio_overrides', sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade() -> None:
    op.drop_column('brand_kits', 'platform_ratio_overrides')
