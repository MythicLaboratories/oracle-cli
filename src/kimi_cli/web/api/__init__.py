"""API routes."""

from kimi_cli.web.api import config, integrations, open_in, sessions

config_router = config.router
integrations_router = integrations.router
sessions_router = sessions.router
work_dirs_router = sessions.work_dirs_router
open_in_router = open_in.router

__all__ = [
    "config_router",
    "integrations_router",
    "open_in_router",
    "sessions_router",
    "work_dirs_router",
]
