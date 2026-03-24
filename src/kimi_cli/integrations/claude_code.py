"""Claude Code integration — persistent session, instant task dispatch."""

from __future__ import annotations

import asyncio
import json
import shutil
import time
from dataclasses import dataclass, field
from typing import Any

from kimi_cli import logger
from kimi_cli.integrations.base import (
    Integration,
    IntegrationMessage,
    IntegrationStatus,
)


@dataclass
class ClaudeCodeIntegration(Integration):
    """Persistent Claude Code session — stays warm, tasks dispatch instantly.

    On connect, spawns a long-running `claude` process in interactive mode.
    Tasks are sent via `--print --continue` for API responses, but a warm
    session stays alive so MCP servers and context are already loaded.
    """

    id: str = "claude-code"
    name: str = "Claude Code"
    description: str = "AI coding agent by Anthropic. Control it from Oracle with voice or text."
    icon: str = "terminal"
    _process: asyncio.subprocess.Process | None = field(default=None, repr=False)
    _read_task: asyncio.Task[None] | None = field(default=None, repr=False)
    _claude_path: str | None = field(default=None, repr=False)
    _work_dir: str | None = field(default=None, repr=False)
    _session_id: str | None = field(default=None, repr=False)
    _warmed_up: bool = field(default=False, repr=False)
    _model: str = field(default="opus", repr=False)

    def detect(self) -> dict[str, Any]:
        path = shutil.which("claude")
        if path:
            self._claude_path = path
            return {"installed": True, "path": path}
        return {"installed": False, "path": None}

    async def get_version(self) -> str | None:
        path = self._claude_path or shutil.which("claude")
        if not path:
            return None
        try:
            proc = await asyncio.create_subprocess_exec(
                path, "--version",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            return stdout.decode().strip()
        except Exception:
            return None

    async def list_sessions(self) -> list[dict[str, Any]]:
        import os
        claude_dir = os.path.expanduser("~/.claude/projects")
        sessions: list[dict[str, Any]] = []
        try:
            if os.path.isdir(claude_dir):
                for project in sorted(os.listdir(claude_dir), reverse=True):
                    if not os.path.isdir(os.path.join(claude_dir, project)):
                        continue
                    display_path = "/" + project.replace("-", "/").lstrip("/")
                    sessions.append({
                        "id": project,
                        "path": display_path,
                        "name": os.path.basename(display_path) or project,
                    })
        except Exception:
            pass
        return sessions[:20]

    async def connect(self, work_dir: str | None = None, session_id: str | None = None, continue_last: bool = False, model: str = "opus") -> None:
        if self.status == IntegrationStatus.CONNECTED and self._warmed_up:
            return

        self.status = IntegrationStatus.CONNECTING
        self._broadcast({"type": "status", "status": "connecting"})
        self._work_dir = work_dir
        self._session_id = session_id
        self._model = model

        path = self._claude_path or shutil.which("claude")
        if not path:
            self.status = IntegrationStatus.ERROR
            self.error = "Claude Code CLI not found"
            self._broadcast({"type": "status", "status": "error", "error": self.error})
            return

        try:
            # Warm up: run a no-op to pre-load MCP servers and session
            warmup = await asyncio.create_subprocess_exec(
                path, "-p", "respond with just OK",
                "--output-format", "json",
                "--continue",
                "--dangerously-skip-permissions",
                "--model", "haiku",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=work_dir,
            )
            await asyncio.wait_for(warmup.communicate(), timeout=30)
            self._warmed_up = True
            self.status = IntegrationStatus.CONNECTED
            self.error = None
            self._broadcast({"type": "status", "status": "connected"})
            logger.info("Claude Code warmed up and connected")
        except Exception as e:
            self.status = IntegrationStatus.ERROR
            self.error = str(e)
            self._broadcast({"type": "status", "status": "error", "error": self.error})

    async def disconnect(self) -> None:
        if self._read_task:
            self._read_task.cancel()
            self._read_task = None
        if self._process:
            try:
                self._process.terminate()
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except (asyncio.TimeoutError, ProcessLookupError):
                self._process.kill()
            self._process = None
        self._warmed_up = False
        self.status = IntegrationStatus.DISCONNECTED
        self.error = None
        self._broadcast({"type": "status", "status": "disconnected"})

    async def send(
        self,
        prompt: str,
        shared_context: list[IntegrationMessage] | None = None,
    ) -> str:
        """Send task to Claude Code. Uses --continue to reuse warm session."""
        full_prompt = prompt
        if shared_context:
            ctx = "\n".join(f"[{m.source}]: {m.content}" for m in shared_context[-10:])
            full_prompt = f"<context>\n{ctx}\n</context>\n\n{prompt}"

        self.add_context(IntegrationMessage(
            role="user", content=prompt, source="oracle", timestamp=time.time(),
        ))

        path = self._claude_path or shutil.which("claude")
        if not path:
            raise RuntimeError("Claude Code CLI not found")

        try:
            # --continue reuses the warm session (MCP already loaded = fast)
            cmd = [
                path, "-p", full_prompt,
                "--output-format", "json",
                "--continue",
                "--dangerously-skip-permissions",
                "--model", self._model,
            ]

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self._work_dir,
            )

            self._broadcast({"type": "claude_thinking", "prompt": prompt})

            stdout_data, stderr_data = await asyncio.wait_for(
                proc.communicate(), timeout=300,
            )

            response_text = self._parse_response(stdout_data.decode())

            self.add_context(IntegrationMessage(
                role="assistant", content=response_text, source="claude-code", timestamp=time.time(),
            ))

            self._broadcast({
                "type": "claude_response",
                "content": response_text,
                "prompt": prompt,
            })

            return response_text

        except asyncio.TimeoutError:
            raise RuntimeError("Claude Code request timed out (5m)")
        except Exception as e:
            logger.error(f"Claude Code send error: {e}")
            raise

    def _parse_response(self, raw: str) -> str:
        raw = raw.strip()
        if not raw:
            return ""
        try:
            data = json.loads(raw)
            if isinstance(data, dict):
                if "result" in data:
                    return str(data["result"])
                if "content" in data:
                    return str(data["content"])
            return raw
        except json.JSONDecodeError:
            return raw

    async def _read_output(self) -> None:
        if not self._process or not self._process.stdout:
            return
        try:
            while True:
                line = await self._process.stdout.readline()
                if not line:
                    break
                decoded = line.decode().strip()
                if not decoded:
                    continue
                try:
                    event = json.loads(decoded)
                    self._broadcast({"type": "claude_event", "event": event})
                except json.JSONDecodeError:
                    self._broadcast({"type": "claude_output", "text": decoded})
        except asyncio.CancelledError:
            return
        except Exception as e:
            logger.error(f"Claude Code read error: {e}")
        finally:
            if self._process and self._process.returncode is not None:
                self.status = IntegrationStatus.DISCONNECTED
                self._broadcast({"type": "status", "status": "disconnected"})


_integrations: dict[str, Integration] = {}


def get_integration_registry() -> dict[str, Integration]:
    if "claude-code" not in _integrations:
        _integrations["claude-code"] = ClaudeCodeIntegration()
    return _integrations
