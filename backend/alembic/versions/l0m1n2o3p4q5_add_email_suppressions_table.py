"""add email_suppressions table

Revision ID: l0m1n2o3p4q5
Revises: k9l0m1n2o3p4
Create Date: 2026-07-26

"""
from alembic import op
import sqlalchemy as sa

revision = 'l0m1n2o3p4q5'
down_revision = 'k9l0m1n2o3p4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'email_suppressions',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('reason', sa.String(20), nullable=False),
        sa.Column('detail', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email'),
    )
    op.create_index('ix_email_suppressions_email', 'email_suppressions', ['email'])
    op.create_index('ix_email_suppressions_created_at', 'email_suppressions', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_email_suppressions_created_at', table_name='email_suppressions')
    op.drop_index('ix_email_suppressions_email', table_name='email_suppressions')
    op.drop_table('email_suppressions')
