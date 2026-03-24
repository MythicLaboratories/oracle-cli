"""Integrations API — manage external AI agent connections."""

from __future__ import annotations

import asyncio
import json
import shutil
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
    session_id: str | None = None
    continue_last: bool = False
    model: str = "opus"


class SendRequest(BaseModel):
    prompt: str
    share_context: bool = True
    model: str | None = None


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
        await integration.connect(
            work_dir=req.work_dir,
            session_id=req.session_id,
            continue_last=req.continue_last,
            model=req.model,
        )
    else:
        await integration.connect()

    return {"status": integration.status.value, "error": integration.error}


@router.get("/{integration_id}/sessions")
async def list_sessions(integration_id: str) -> list[dict[str, Any]]:
    """List available sessions for an integration."""
    registry = get_registry()
    integration = registry.get(integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail=f"Integration '{integration_id}' not found")
    if isinstance(integration, ClaudeCodeIntegration):
        return await integration.list_sessions()
    return []


@router.post("/{integration_id}/open-terminal")
async def open_terminal(integration_id: str, req: ConnectRequest) -> dict[str, str]:
    """Open the integration in a native terminal window."""
    registry = get_registry()
    integration = registry.get(integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail=f"Integration '{integration_id}' not found")

    if isinstance(integration, ClaudeCodeIntegration):
        import subprocess
        import sys

        claude_path = integration._claude_path or "claude"
        cmd_parts = [claude_path]
        if req.session_id:
            cmd_parts.extend(["--resume", req.session_id])
        elif req.continue_last:
            cmd_parts.append("--continue")

        cmd_str = " ".join(cmd_parts)
        work_dir = req.work_dir or "~"

        if sys.platform == "darwin":
            # Open native Terminal.app with Claude Code
            apple_script = f'''
            tell application "Terminal"
                activate
                do script "cd {work_dir} && {cmd_str}"
            end tell
            '''
            subprocess.Popen(["osascript", "-e", apple_script])
        else:
            # Linux: try common terminals
            for term in ["gnome-terminal", "xterm", "konsole"]:
                import shutil as _shutil
                if _shutil.which(term):
                    subprocess.Popen([term, "--", "bash", "-c", f"cd {work_dir} && {cmd_str}"])
                    break

        # Mark as connected
        await integration.connect(work_dir=req.work_dir, session_id=req.session_id, continue_last=req.continue_last)
        return {"status": "opened", "command": cmd_str}

    raise HTTPException(status_code=400, detail="Terminal not supported for this integration")


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


@router.post("/{integration_id}/send-stream")
async def send_stream(integration_id: str, req: SendRequest) -> Any:
    """Stream Claude Code's live output (thinking, tool calls, text) via SSE."""
    from starlette.responses import StreamingResponse

    registry = get_registry()
    integration = registry.get(integration_id)
    if not integration:
        raise HTTPException(status_code=404, detail=f"Integration '{integration_id}' not found")
    if not isinstance(integration, ClaudeCodeIntegration):
        raise HTTPException(status_code=400, detail="Streaming only supported for Claude Code")

    claude_path = integration._claude_path or shutil.which("claude")
    if not claude_path:
        raise HTTPException(status_code=500, detail="Claude Code CLI not found")

    prompt = req.prompt
    if req.share_context:
        shared = []
        for other in registry.values():
            if other.id != integration_id:
                shared.extend(other.context[-10:])
        if shared:
            ctx = "\n".join(f"[{m.source}]: {m.content}" for m in shared)
            prompt = f"<context>\n{ctx}\n</context>\n\n{prompt}"

    model = integration._model or "opus"
    cmd = [
        claude_path, "-p", prompt,
        "--output-format", "stream-json",
        "--verbose",
        "--continue",
        "--dangerously-skip-permissions",
        "--model", model,
    ]

    async def event_generator():
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=integration._work_dir,
        )
        assert proc.stdout
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            decoded = line.decode().strip()
            if not decoded:
                continue
            yield f"data: {decoded}\n\n"
        yield "data: {\"type\":\"done\"}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        },
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
