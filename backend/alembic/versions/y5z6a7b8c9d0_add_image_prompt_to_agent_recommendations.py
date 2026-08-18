"""add image_prompt to agent_recommendations

Revision ID: y5z6a7b8c9d0
Revises: x4y5z6a7b8c9
Create Date: 2026-08-18

Adds image_prompt column to agent_recommendations so the Quick Start AI
can return a vivid, specific image generation prompt alongside each ad idea.
This prompt is passed directly to Create Ad's image_scene field, giving
every Website Spark idea a unique, article-relevant image rather than a
generic placeholder.
"""
from alembic import op
import sqlalchemy as sa

revision = "y5z6a7b8c9d0"
down_revision = "x4y5z6a7b8c9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_recommendations",
        sa.Column("image_prompt", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agent_recommendations", "image_prompt")
