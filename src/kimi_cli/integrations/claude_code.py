"""Claude Code integration — control Claude Code CLI from Oracle."""

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
    """Connect to Claude Code CLI running in the terminal.

    Spawns Claude Code in --output-format stream-json mode and communicates
    bidirectionally. Oracle and Claude share conversation context so they
    work as an agentic team.
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
    _continue_session: bool = field(default=False, repr=False)

    def detect(self) -> dict[str, Any]:
        """Check if Claude Code is installed and return info."""
        path = shutil.which("claude")
        if path:
            self._claude_path = path
            return {"installed": True, "path": path}
        return {"installed": False, "path": None}

    async def get_version(self) -> str | None:
        """Get Claude Code version."""
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
        """List recent Claude Code sessions."""
        path = self._claude_path or shutil.which("claude")
        if not path:
            return []
        try:
            # Get recent sessions by checking ~/.claude/projects/
            import os
            claude_dir = os.path.expanduser("~/.claude/projects")
            sessions: list[dict[str, Any]] = []
            if os.path.isdir(claude_dir):
                for project in sorted(os.listdir(claude_dir), reverse=True):
                    project_path = os.path.join(claude_dir, project)
                    if not os.path.isdir(project_path):
                        continue
                    # Decode the project name (dashes = slashes)
                    display_path = "/" + project.replace("-", "/").lstrip("/")
                    sessions.append({
                        "id": project,
                        "path": display_path,
                        "name": os.path.basename(display_path) or project,
                    })
            return sessions[:20]  # Last 20
        except Exception:
            return []

    async def connect(self, work_dir: str | None = None, session_id: str | None = None, continue_last: bool = False) -> None:
        """Start a Claude Code subprocess in stream-json mode."""
        if self.status == IntegrationStatus.CONNECTED and self._process:
            return

        self.status = IntegrationStatus.CONNECTING
        self._broadcast({"type": "status", "status": "connecting"})
        self._work_dir = work_dir
        self._session_id = session_id
        self._continue_session = continue_last

        path = self._claude_path or shutil.which("claude")
        if not path:
            self.status = IntegrationStatus.ERROR
            self.error = "Claude Code CLI not found. Install it: npm install -g @anthropic-ai/claude-code"
            self._broadcast({"type": "status", "status": "error", "error": self.error})
            return

        try:
            cmd = [
                path,
                "--output-format", "stream-json",
                "--verbose",
            ]

            self._process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=work_dir,
            )

            self.status = IntegrationStatus.CONNECTED
            self.error = None
            self._broadcast({"type": "status", "status": "connected"})

            # Start reading output in background
            self._read_task = asyncio.create_task(self._read_output())

            logger.info(f"Claude Code connected (pid={self._process.pid})")

        except Exception as e:
            self.status = IntegrationStatus.ERROR
            self.error = str(e)
            self._broadcast({"type": "status", "status": "error", "error": self.error})
            logger.error(f"Failed to connect to Claude Code: {e}")

    async def disconnect(self) -> None:
        """Stop the Claude Code subprocess."""
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

        self.status = IntegrationStatus.DISCONNECTED
        self.error = None
        self._broadcast({"type": "status", "status": "disconnected"})
        logger.info("Claude Code disconnected")

    async def send(
        self,
        prompt: str,
        shared_context: list[IntegrationMessage] | None = None,
    ) -> str:
        """Send a prompt to Claude Code and return the response.

        If shared_context is provided, it's prepended as system context
        so Claude Code knows what Oracle has been working on.
        """
        if self.status != IntegrationStatus.CONNECTED or not self._process:
            # Auto-connect if not connected
            await self.connect(self._work_dir)
            if self.status != IntegrationStatus.CONNECTED:
                raise RuntimeError(f"Claude Code not connected: {self.error}")

        # Build the full prompt with shared context
        full_prompt = prompt
        if shared_context:
            context_text = "\n".join(
                f"[{m.source} ({m.role})]: {m.content}" for m in shared_context[-10:]
            )
            full_prompt = (
                f"<shared_context>\nHere's what the Oracle AI agent has been working on:\n"
                f"{context_text}\n</shared_context>\n\n{prompt}"
            )

        # Record the outgoing message
        self.add_context(IntegrationMessage(
            role="user",
            content=prompt,
            source="oracle",
            timestamp=time.time(),
        ))

        # Use --print mode for single-shot request/response
        path = self._claude_path or shutil.which("claude")
        if not path:
            raise RuntimeError("Claude Code CLI not found")

        try:
            cmd = [path, "-p", full_prompt, "--output-format", "json"]
            if self._session_id:
                cmd.extend(["--resume", self._session_id])
            elif self._continue_session:
                cmd.append("--continue")

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=self._work_dir,
            )

            self._broadcast({"type": "claude_thinking", "prompt": prompt})

            stdout_data, stderr_data = await asyncio.wait_for(
                proc.communicate(),
                timeout=300,  # 5 minute timeout
            )

            response_text = self._parse_response(stdout_data.decode())

            # Record the response
            self.add_context(IntegrationMessage(
                role="assistant",
                content=response_text,
                source="claude-code",
                timestamp=time.time(),
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
        """Parse Claude Code JSON output into text.

        Claude Code --output-format json returns a single JSON object with:
        {"type": "result", "result": "the response text", ...}
        """
        raw = raw.strip()
        if not raw:
            return ""
        try:
            data = json.loads(raw)
            if isinstance(data, dict):
                # JSON mode: {"type": "result", "result": "..."}
                if "result" in data:
                    return str(data["result"])
                # Fallback for other shapes
                if "content" in data:
                    return str(data["content"])
            return raw
        except json.JSONDecodeError:
            # Plain text output
            return raw

    async def _read_output(self) -> None:
        """Background task to read Claude Code's stdout stream."""
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


# Singleton registry
_integrations: dict[str, Integration] = {}


def get_integration_registry() -> dict[str, Integration]:
    """Get or create the global integration registry."""
    if "claude-code" not in _integrations:
        _integrations["claude-code"] = ClaudeCodeIntegration()
    return _integrations
