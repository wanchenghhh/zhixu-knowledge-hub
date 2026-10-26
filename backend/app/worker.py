from celery import Celery
from .config import settings
from .jobs import pending_jobs, run_job

celery = Celery("knowledge_hub", broker=settings().redis_url)
celery.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    task_ignore_result=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    broker_transport_options={"visibility_timeout": 10800},
    beat_schedule={"dispatch-durable-jobs": {"task": "hub.dispatch", "schedule": 3.0}},
)


@celery.task(name="hub.process")
def process(job_id):
    run_job(job_id)


@celery.task(name="hub.dispatch")
def dispatch():
    for job_id in pending_jobs():
        process.delay(job_id)
