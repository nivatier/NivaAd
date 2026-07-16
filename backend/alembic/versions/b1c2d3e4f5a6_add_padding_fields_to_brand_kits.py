"""add padding/reframe fields to brand_kits

Revision ID: b1c2d3e4f5a6
Revises: 0f71d49bdf73
Create Date: 2026-07-16 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = '0f71d49bdf73'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Two independent fill-mode selectors — one per padding direction,
    # since a video needing top/bottom bars (source wider than target)
    # and one needing left/right bars (source taller than target) are
    # visually unrelated choices, not the same setting reused.
    op.add_column('brand_kits', sa.Column('vertical_pad_mode', sa.String(length=20), nullable=False, server_default=sa.text("'blurred_video'")))
    op.add_column('brand_kits', sa.Column('horizontal_pad_mode', sa.String(length=20), nullable=False, server_default=sa.text("'blurred_video'")))
    # Four independent image slots — top/bottom for vertical padding,
    # left/right for horizontal — only relevant when that direction's
    # mode is 'image'; nullable since a company may prefer color or the
    # automatic blurred-video fallback instead.
    op.add_column('brand_kits', sa.Column('pad_top_image_url', sa.String(length=500), nullable=True))
    op.add_column('brand_kits', sa.Column('pad_bottom_image_url', sa.String(length=500), nullable=True))
    op.add_column('brand_kits', sa.Column('pad_left_image_url', sa.String(length=500), nullable=True))
    op.add_column('brand_kits', sa.Column('pad_right_image_url', sa.String(length=500), nullable=True))
    op.add_column('brand_kits', sa.Column('vertical_pad_color', sa.String(length=9), nullable=True))
    op.add_column('brand_kits', sa.Column('horizontal_pad_color', sa.String(length=9), nullable=True))


def downgrade() -> None:
    op.drop_column('brand_kits', 'horizontal_pad_color')
    op.drop_column('brand_kits', 'vertical_pad_color')
    op.drop_column('brand_kits', 'pad_right_image_url')
    op.drop_column('brand_kits', 'pad_left_image_url')
    op.drop_column('brand_kits', 'pad_bottom_image_url')
    op.drop_column('brand_kits', 'pad_top_image_url')
    op.drop_column('brand_kits', 'horizontal_pad_mode')
    op.drop_column('brand_kits', 'vertical_pad_mode')
