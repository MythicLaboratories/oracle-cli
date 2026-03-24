"""Base integration interface for external AI agents."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class IntegrationStatus(str, Enum):
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    ERROR = "error"


@dataclass
class IntegrationMessage:
    """A message exchanged with an integration."""

    role: str  # "user" | "assistant" | "system"
    content: str
    source: str  # integration id that produced this message
    timestamp: float = 0.0


@dataclass
class Integration:
    """Base class for external agent integrations."""

    id: str
    name: str
    description: str
    icon: str  # lucide icon name
    status: IntegrationStatus = IntegrationStatus.DISCONNECTED
    error: str | None = None
    context: list[IntegrationMessage] = field(default_factory=list)
    _listeners: list[asyncio.Queue[dict[str, Any]]] = field(default_factory=list)

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._listeners.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        self._listeners = [l for l in self._listeners if l is not q]

    def _broadcast(self, event: dict[str, Any]) -> None:
        for q in self._listeners:
            q.put_nowait(event)

    def add_context(self, msg: IntegrationMessage) -> None:
        self.context.append(msg)
        self._broadcast({"type": "context", "message": msg.__dict__})

    async def connect(self) -> None:
        raise NotImplementedError

    async def disconnect(self) -> None:
        raise NotImplementedError

    async def send(self, prompt: str, shared_context: list[IntegrationMessage] | None = None) -> str:
        raise NotImplementedError

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "icon": self.icon,
            "status": self.status.value,
            "error": self.error,
        }
