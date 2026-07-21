"""add label and ratio to brand_video_shots

Revision ID: f8a9b0c1d2e3
Revises: e7f8a9b0c1d2
Create Date: 2026-07-21 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f8a9b0c1d2e3'
down_revision: Union[str, None] = 'e7f8a9b0c1d2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('brand_video_shots', sa.Column('label', sa.String(length=120), nullable=False, server_default=''))
    op.add_column('brand_video_shots', sa.Column('ratio', sa.String(length=10), nullable=False, server_default='16:9'))
    op.alter_column('brand_video_shots', 'overlay_position', type_=sa.String(length=20))


def downgrade() -> None:
    op.alter_column('brand_video_shots', 'overlay_position', type_=sa.String(length=10))
    op.drop_column('brand_video_shots', 'ratio')
    op.drop_column('brand_video_shots', 'label')
