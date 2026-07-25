"""add system_logs table

Revision ID: k9l0m1n2o3p4
Revises: j8k9l0m1n2o3
Create Date: 2026-07-25
"""
from alembic import op
import sqlalchemy as sa

revision = 'k9l0m1n2o3p4'
down_revision = 'j8k9l0m1n2o3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'system_logs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('service', sa.String(30), nullable=False),
        sa.Column('level', sa.String(10), nullable=False),
        sa.Column('logger_name', sa.String(120), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False, server_default=sa.text('now()')),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_system_logs_service', 'system_logs', ['service'])
    op.create_index('ix_system_logs_created_at', 'system_logs', ['created_at'])
    # Composite index for the most common query: service + date range
    op.create_index('ix_system_logs_service_created_at', 'system_logs', ['service', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_system_logs_service_created_at', 'system_logs')
    op.drop_index('ix_system_logs_created_at', 'system_logs')
    op.drop_index('ix_system_logs_service', 'system_logs')
    op.drop_table('system_logs')
