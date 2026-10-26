"""The same durable jobs run on Redis/Celery or queue-triggered Vercel functions."""

import logging
from celery import Celery
from kombu import Queue
from .config import settings
from .jobs import pending_jobs, run_job

is_vercel = settings().queue_mode == "vercel"
celery = Celery(
    "knowledge_hub",
    broker="vercel://" if is_vercel else settings().redis_url,
    backend="vercel-runtime-cache://" if is_vercel else None,
)
celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    task_ignore_result=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_default_queue="knowledge",
    task_queues=[Queue("knowledge")],
    broker_transport_options={"lease_duration": 360, "use_task_id_as_idempotency_key": False}
    if is_vercel
    else {"visibility_timeout": 10800},
    beat_schedule={} if is_vercel else {"dispatch-durable-jobs": {"task": "hub.dispatch", "schedule": 3.0}},
)


@celery.task(name="hub.process", bind=True, max_retries=180)
def process(self, job_id):
    pending_jobs()
    resumed = run_job(job_id)
    if resumed:
        raise self.retry(countdown=5)


@celery.task(name="hub.dispatch")
def dispatch():
    for job_id in pending_jobs():
        process.delay(job_id)


def notify_job(job_id):
    if not is_vercel:
        return
    try:
        process.apply_async(args=[job_id], task_id=f"knowledge-{job_id}")
    except Exception as exc:
        logging.getLogger(__name__).error(
            "Queue delivery deferred (%s); database job retained", type(exc).__name__
        )


def recover_deliveries():
    """Redispatch persisted work when visitors poll after a transient queue outage."""
    if not is_vercel:
        return
    from datetime import timedelta
    from sqlalchemy import update
    from .db import Job, session_factory, utcnow

    candidates = pending_jobs()
    for job_id in candidates:
        with session_factory()() as db:
            claimed = db.execute(
                update(Job)
                .where(
                    Job.id == job_id, Job.status == "queued", Job.touched < utcnow() - timedelta(seconds=30)
                )
                .values(touched=utcnow())
            )
            db.commit()
            if claimed.rowcount:
                notify_job(job_id)
