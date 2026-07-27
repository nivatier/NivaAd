"""Developer-configured models for two background quality-improvement
steps in video generation — neither is customer-facing or customer-
charged, both run automatically using the developer's own OpenRouter
balance as an internal cost of generating better output, the same way
you might spend on any other quality investment.

1. Prompt review model (text) — rewrites each video shot's raw prompt
   into a stronger, more effective description before it's used, rather
   than sending the customer's exact wording straight to the video
   model.

2. Video prep image model (image) — the actual fix for the "first
   frames show the original reference photo's background, not the
   described scene" problem: before generating the video, a NEW image
   is rendered that places the same reference product into the scene
   described by the first shot, and THAT becomes the video's starting
   frame instead of the raw reference photo. Only runs when a reference
   image was actually attached — nothing to prep for a text-to-video ad.

Both settings are just a reference to an id already in the text/image
model lists (Developer > Models) — not a new model list of their own.
Reuses the same ModelConfig JSON blob everything else in this app's
developer settings lives in.
"""
from sqlalchemy.orm.attributes import flag_modified

from app.models import ModelConfig, get_config_row, get_config_row_sync


async def get_video_prep_settings(db) -> dict:
    row = await get_config_row(db, "platform")
    stored = row.config if row and row.config else {}
    cfg = stored.get("video_prep") or {}
    return {
        "prompt_review_model_id": cfg.get("prompt_review_model_id"),
        "image_model_id": cfg.get("image_model_id"),
    }


def get_video_prep_settings_sync(db) -> dict:
    """SYNC equivalent — for use inside Celery tasks (tasks.py), which
    run on a sync SQLAlchemy session/engine, same reasoning as
    credits.get_available_models_sync."""
    row = get_config_row_sync(db, "platform")
    stored = row.config if row and row.config else {}
    cfg = stored.get("video_prep") or {}
    return {
        "prompt_review_model_id": cfg.get("prompt_review_model_id"),
        "image_model_id": cfg.get("image_model_id"),
    }


async def set_video_prep_settings(db, prompt_review_model_id: str | None, image_model_id: str | None) -> None:
    row = await get_config_row(db, "platform")

    config = dict(row.config or {})
    config["video_prep"] = {
        "prompt_review_model_id": prompt_review_model_id,
        "image_model_id": image_model_id,
    }
    row.config = config
    flag_modified(row, "config")
    await db.commit()
