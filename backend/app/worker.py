from celery import Celery
from celery.schedules import crontab, schedule

from app.config import settings

celery_app = Celery("nivaad", broker=settings.REDIS_URL, backend=settings.REDIS_URL)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    imports=["app.tasks"],
    beat_schedule={
        "fire-due-scheduled-posts": {
            "task": "app.fire_due_scheduled_posts",
            "schedule": schedule(run_every=60),  # check every 60 seconds
        },
        "cleanup-expired-media": {
            "task": "app.cleanup_expired_media",
            "schedule": crontab(hour=3, minute=0),  # once daily at 3 AM UTC — a low-traffic window, doesn't need the tight interval the scheduled-posts check does
        },
    },
)


@celery_app.task(name="app.ping")
def ping():
    return "pong"
