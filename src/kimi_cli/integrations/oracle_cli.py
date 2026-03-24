"""Oracle CLI self-integration — manage and configure the local Oracle agent."""

from __future__ import annotations

import shutil
import time
from dataclasses import dataclass
from typing import Any

from kimi_cli.integrations.base import (
    Integration,
    IntegrationMessage,
    IntegrationStatus,
)


@dataclass
class OracleCliIntegration(Integration):
    """Oracle CLI (local agent). Auto-connects since it's the host application.

    This integration represents the local Oracle agent itself, allowing
    the web UI to show it alongside Claude Code as a team member.
    """

    id: str = "oracle-cli"
    name: str = "Oracle CLI"
    description: str = "AI agent for the terminal by Mythic Labs. The local host agent."
    icon: str = "bot"

    def detect(self) -> dict[str, Any]:
        """Oracle CLI is always available (it's the host app)."""
        from kimi_cli.constant import VERSION
        return {"installed": True, "version": VERSION, "path": shutil.which("oracle")}

    async def connect(self) -> None:
        """Oracle CLI is always connected as the host."""
        self.status = IntegrationStatus.CONNECTED
        self.error = None
        self._broadcast({"type": "status", "status": "connected"})

    async def disconnect(self) -> None:
        """Oracle CLI cannot be disconnected — it's the host."""
        pass

    async def send(
        self,
        prompt: str,
        shared_context: list[IntegrationMessage] | None = None,
    ) -> str:
        """Oracle CLI messages are handled by the main session, not here."""
        self.add_context(IntegrationMessage(
            role="user",
            content=prompt,
            source="user",
            timestamp=time.time(),
        ))
        return ""
