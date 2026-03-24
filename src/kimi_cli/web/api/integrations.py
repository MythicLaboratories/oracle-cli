"""Integrations API — manage external AI agent connections."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel

from kimi_cli import logger
from kimi_cli.integrations import get_registry
from kimi_cli.integrations.claude_code import ClaudeCodeIntegration

router = APIRouter(prefix="/api/integrations", tags=["integrations"])


# ── Models ──────────────────────────────────────────────────────────────


class ConnectRequest(BaseModel):
    work_dir: str | None = None


class SendRequest(BaseModel):
    prompt: str
    share_context: bool = True


class IntegrationInfo(BaseModel):
    id: str
    name: str
    description: str
    icon: str
    status: str
    error: str | None = None
    installed: bool = False
    version: str | None = None


# ── Routes ──────────────────────────────────────────────────────────────


@router.get("")
async def list_integrations() -> list[IntegrationInfo]:
    """List all available integrations with their status."""
    registry = get_registry()
    result: list[IntegrationInfo] = []
    for integration in registry.values():
        info = IntegrationInfo(**integration.to_dict(), installed=False)
        # Detect installation
        if hasattr(integration, "detect"):
            detection = integration.detect()
            info.installed = detection.get("installed", False)
            info.version = detection.get("version")
        if isinstance(integration, ClaudeCodeIntegration):
            version = await integration.get_version()
            if version:
                info.version = version
                info.installed = True
        result.append(info)
    return result


@router.get("/{integration_id}")
async def get_integration(integration_id: str) -> IntegrationInfo:
    """Get a specific integration's details."""
    registry = get_registry()
    integration = registry.get(integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail=f"Integration '{integration_id}' not found")
    info = IntegrationInfo(**integration.to_dict(), installed=False)
    if hasattr(integration, "detect"):
        detection = integration.detect()
        info.installed = detection.get("installed", False)
        info.version = detection.get("version")
    return info


@router.post("/{integration_id}/connect")
async def connect_integration(integration_id: str, req: ConnectRequest) -> dict[str, Any]:
    """Connect to an integration (auto-detect and start)."""
    registry = get_registry()
    integration = registry.get(integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail=f"Integration '{integration_id}' not found")

    if isinstance(integration, ClaudeCodeIntegration):
        await integration.connect(work_dir=req.work_dir)
    else:
        await integration.connect()

    return {"status": integration.status.value, "error": integration.error}


@router.post("/{integration_id}/disconnect")
async def disconnect_integration(integration_id: str) -> dict[str, str]:
    """Disconnect from an integration."""
    registry = get_registry()
    integration = registry.get(integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail=f"Integration '{integration_id}' not found")
    await integration.disconnect()
    return {"status": integration.status.value}


@router.post("/{integration_id}/send")
async def send_to_integration(integration_id: str, req: SendRequest) -> dict[str, str]:
    """Send a prompt to an integration and get the response."""
    registry = get_registry()
    integration = registry.get(integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail=f"Integration '{integration_id}' not found")

    # Build shared context from all integrations
    shared_context = None
    if req.share_context:
        shared_context = []
        for other in registry.values():
            if other.id != integration_id:
                shared_context.extend(other.context[-10:])

    try:
        response = await integration.send(req.prompt, shared_context=shared_context)
        return {"response": response}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )


@router.get("/{integration_id}/context")
async def get_integration_context(integration_id: str) -> list[dict[str, Any]]:
    """Get the shared context history for an integration."""
    registry = get_registry()
    integration = registry.get(integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail=f"Integration '{integration_id}' not found")
    return [msg.__dict__ for msg in integration.context[-50:]]


@router.websocket("/{integration_id}/ws")
async def integration_websocket(websocket: WebSocket, integration_id: str) -> None:
    """Real-time event stream from an integration."""
    registry = get_registry()
    integration = registry.get(integration_id)
    if not integration:
        await websocket.close(code=4004, reason="Integration not found")
        return

    await websocket.accept()
    queue = integration.subscribe()

    try:
        # Send current status immediately
        await websocket.send_json({
            "type": "status",
            "status": integration.status.value,
            "error": integration.error,
        })

        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=30)
                await websocket.send_json(event)
            except asyncio.TimeoutError:
                # Send keepalive ping
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"Integration WS error: {e}")
    finally:
        integration.unsubscribe(queue)
