"""Vercel ASGI entrypoint. Migrate in the build before serving traffic."""

from app.main import app

__all__ = ["app"]
