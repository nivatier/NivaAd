"""add overlay_font_size to brand_video_shots

Revision ID: b0c1d2e3f4a5
Revises: a9b0c1d2e3f4
Create Date: 2026-07-21 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b0c1d2e3f4a5'
down_revision: Union[str, None] = 'a9b0c1d2e3f4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('brand_video_shots', sa.Column('overlay_font_size', sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column('brand_video_shots', 'overlay_font_size')
