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
    # Reliability settings — closes the real gap between Redis-as-broker
    # and a dedicated message queue (e.g. RabbitMQ) for THIS app's
    # actual failure mode: a worker crashing mid-task. Without these, a
    # task Celery had already marked "in progress" when the worker died
    # is simply gone — no error, no retry, just silently lost. With
    # them, an unacknowledged task is treated as still-pending and
    # redelivered to another worker once the visibility window passes.
    #
    # task_acks_late: only acknowledge (and remove from the queue) a
    # task once it's ACTUALLY FINISHED, not the moment a worker picks it
    # up — the default is early-ack, which is exactly what loses work
    # on a mid-task crash.
    task_acks_late=True,
    # task_reject_on_worker_lost: if Celery detects the worker process
    # itself died (not just the task raising an exception), explicitly
    # requeue the task rather than leaving it in limbo.
    task_reject_on_worker_lost=True,
    # visibility_timeout: how long Redis waits before assuming an
    # unacknowledged task was lost and redelivering it. Must be longer
    # than the longest any single task can legitimately run, or a task
    # that's still genuinely in progress gets duplicated onto a second
    # worker. Video generation alone can poll for up to 480s (see
    # services/videos.py MAX_WAIT_SECONDS), plus the video-prep
    # first/last-frame image generation and the multi-ratio reframe
    # pass can run afterward in the same task — 3600s (1 hour) gives a
    # comfortable margin above the realistic worst case without making
    # genuine crash recovery wait unreasonably long.
    broker_transport_options={"visibility_timeout": 3600},
    beat_schedule={
        "fire-due-scheduled-posts": {
            "task": "app.fire_due_scheduled_posts",
            "schedule": schedule(run_every=60),  # check every 60 seconds
        },
        "cleanup-expired-media": {
            "task": "app.cleanup_expired_media",
            "schedule": crontab(hour=3, minute=0),  # once daily at 3 AM UTC — a low-traffic window, doesn't need the tight interval the scheduled-posts check does
        },
        "cleanup-expired-posts": {
            "task": "app.cleanup_expired_posts",
            "schedule": crontab(hour=4, minute=0),  # once daily at 4 AM UTC — offset an hour after media cleanup so the two don't compete for the same window; this one deletes whole rows (much rarer/heavier than the media pass) so keeping them separate makes each run's logs easier to read too
        },
        "check-agent-events": {
            "task": "app.check_agent_events",
            "schedule": crontab(hour=5, minute=0),  # once daily at 5 AM UTC — checks every enabled recurring event for whether today is (month/day - lead_days), i.e. whether it's time to generate this year's ad
        },
    },
)


@celery_app.task(name="app.ping")
def ping():
    return "pong"
