"""split brand kit padding into separate image/video settings

Revision ID: a3b4c5d6e7f8
Revises: f1a2b3c4d5e6
Create Date: 2026-07-21 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a3b4c5d6e7f8'
down_revision: Union[str, None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The existing vertical_pad_mode/horizontal_pad_mode/pad_*_image_url/
    # *_pad_color columns are untouched and now mean "video padding"
    # specifically. These new image_-prefixed columns are their
    # independent counterparts for image reframing — fresh defaults
    # rather than copying over each company's existing video settings,
    # since "blurred_video" mode needs no further config and is a safe,
    # good-looking default with zero setup required.
    op.add_column('brand_kits', sa.Column('image_vertical_pad_mode', sa.String(length=20), nullable=False, server_default='blurred_video'))
    op.add_column('brand_kits', sa.Column('image_horizontal_pad_mode', sa.String(length=20), nullable=False, server_default='blurred_video'))
    op.add_column('brand_kits', sa.Column('image_pad_top_image_url', sa.String(length=500), nullable=True))
    op.add_column('brand_kits', sa.Column('image_pad_bottom_image_url', sa.String(length=500), nullable=True))
    op.add_column('brand_kits', sa.Column('image_pad_left_image_url', sa.String(length=500), nullable=True))
    op.add_column('brand_kits', sa.Column('image_pad_right_image_url', sa.String(length=500), nullable=True))
    op.add_column('brand_kits', sa.Column('image_vertical_pad_color', sa.String(length=9), nullable=True))
    op.add_column('brand_kits', sa.Column('image_horizontal_pad_color', sa.String(length=9), nullable=True))


def downgrade() -> None:
    op.drop_column('brand_kits', 'image_horizontal_pad_color')
    op.drop_column('brand_kits', 'image_vertical_pad_color')
    op.drop_column('brand_kits', 'image_pad_right_image_url')
    op.drop_column('brand_kits', 'image_pad_left_image_url')
    op.drop_column('brand_kits', 'image_pad_bottom_image_url')
    op.drop_column('brand_kits', 'image_pad_top_image_url')
    op.drop_column('brand_kits', 'image_horizontal_pad_mode')
    op.drop_column('brand_kits', 'image_vertical_pad_mode')
