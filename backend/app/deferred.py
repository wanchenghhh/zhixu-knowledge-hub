class DeferredJob(Exception):
    """A durable cloud task is pending and should continue in another invocation."""
