"""add reference logo + text overlay fields to brand_video_shots

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-07-21 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'd6e7f8a9b0c1'
down_revision: Union[str, None] = 'c5d6e7f8a9b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('brand_video_shots', sa.Column('reference_logo_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column('brand_video_shots', sa.Column('overlay_text', sa.Text(), nullable=True))
    op.add_column('brand_video_shots', sa.Column('overlay_font', sa.String(length=20), nullable=True))
    op.add_column('brand_video_shots', sa.Column('overlay_text_color', sa.String(length=9), nullable=True))
    op.add_column('brand_video_shots', sa.Column('overlay_position', sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column('brand_video_shots', 'overlay_position')
    op.drop_column('brand_video_shots', 'overlay_text_color')
    op.drop_column('brand_video_shots', 'overlay_font')
    op.drop_column('brand_video_shots', 'overlay_text')
    op.drop_column('brand_video_shots', 'reference_logo_id')
