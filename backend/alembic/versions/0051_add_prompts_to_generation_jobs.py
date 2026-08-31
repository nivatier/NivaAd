"""add text_prompt image_prompt video_prompt to generation_jobs

Revision ID: 0051
Revises: e6f7a8b9c0d1
Create Date: 2026-08-31

"""
from alembic import op
import sqlalchemy as sa

revision = '0051'
down_revision = 'e6f7a8b9c0d1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('generation_jobs', sa.Column('text_prompt', sa.Text(), nullable=True))
    op.add_column('generation_jobs', sa.Column('image_prompt', sa.Text(), nullable=True))
    op.add_column('generation_jobs', sa.Column('video_prompt', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('generation_jobs', 'video_prompt')
    op.drop_column('generation_jobs', 'image_prompt')
    op.drop_column('generation_jobs', 'text_prompt')
