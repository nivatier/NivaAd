"""split model_config into per-topic rows

Revision ID: m1n2o3p4q5r6
Revises: l0m1n2o3p4q5
Create Date: 2026-07-27

Adds a `topic` column to model_config and splits the existing single
JSON blob (id=1) into one row per topic. The old id=1 row is preserved
as topic='models' (image + video + text keys) so any in-flight request
that still reads id=1 before this deploy rolls out won't 404.

Topic → keys mapping:
  models     → image, video, text
  themes     → themes, theme_ai
  assistant  → assistant_hints, assistant_settings
  platform   → platforms, platform_ratios, video_ratios, video_prep, launch, platform_config
  pricing    → pricing_config
  retention  → retention
  team       → team_limits
"""
import json
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


revision = 'm1n2o3p4q5r6'
down_revision = 'l0m1n2o3p4q5'
branch_labels = None
depends_on = None

# Keys that belong to each topic
TOPIC_KEYS = {
    "models":    ["image", "video", "text"],
    "themes":    ["themes", "theme_ai"],
    "assistant": ["assistant_hints", "assistant_settings"],
    "platform":  ["platforms", "platform_ratios", "video_ratios", "video_prep", "launch", "platform"],
    "pricing":   ["pricing_config"],
    "retention": ["retention"],
    "team":      ["team_limits"],
}


def upgrade() -> None:
    # 1. Add topic column — nullable first so existing rows don't break
    op.add_column("model_config", sa.Column("topic", sa.String(64), nullable=True))

    # 2. Add unique constraint on topic (after data migration)
    # 3. Data migration — read the existing blob, create new rows per topic
    conn = op.get_bind()

    row = conn.execute(text("SELECT config FROM model_config WHERE id = 1")).fetchone()
    if row and row[0]:
        # config may come back as dict (psycopg2 JSON) or string
        blob = row[0] if isinstance(row[0], dict) else json.loads(row[0])
    else:
        blob = {}

    # Update id=1 to be the "models" topic row
    models_blob = {k: blob[k] for k in TOPIC_KEYS["models"] if k in blob}
    conn.execute(
        text("UPDATE model_config SET topic = 'models', config = :cfg WHERE id = 1"),
        {"cfg": json.dumps(models_blob)},
    )

    # Insert remaining topic rows starting at id=2
    next_id = 2
    for topic, keys in TOPIC_KEYS.items():
        if topic == "models":
            continue  # already handled above
        topic_blob = {k: blob[k] for k in keys if k in blob}
        conn.execute(
            text("INSERT INTO model_config (id, topic, config) VALUES (:id, :topic, :cfg)"),
            {"id": next_id, "topic": topic, "cfg": json.dumps(topic_blob)},
        )
        next_id += 1

    # 4. Now make topic NOT NULL and add unique constraint
    op.alter_column("model_config", "topic", nullable=False, server_default=None)
    op.create_index("ix_model_config_topic", "model_config", ["topic"], unique=True)


def downgrade() -> None:
    # Merge all topic rows back into a single id=1 blob
    conn = op.get_bind()
    rows = conn.execute(text("SELECT topic, config FROM model_config")).fetchall()
    merged = {}
    for topic, cfg in rows:
        if isinstance(cfg, str):
            cfg = json.loads(cfg)
        merged.update(cfg or {})

    conn.execute(text("DELETE FROM model_config"))
    conn.execute(
        text("INSERT INTO model_config (id, topic, config) VALUES (1, 'models', :cfg)"),
        {"cfg": json.dumps(merged)},
    )

    op.drop_index("ix_model_config_topic", table_name="model_config")
    op.drop_column("model_config", "topic")
