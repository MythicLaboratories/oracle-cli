"""Terminal API — real PTY shell access via WebSocket."""

from __future__ import annotations

import asyncio
import fcntl
import os
import pty
import signal
import struct
import termios
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from kimi_cli import logger

router = APIRouter(prefix="/api/terminal", tags=["terminal"])


class TerminalSession:
    """Manages a PTY shell session."""

    def __init__(self) -> None:
        self.master_fd: int | None = None
        self.pid: int | None = None
        self._closed = False

    def start(self, cols: int = 120, rows: int = 30, cwd: str | None = None) -> None:
        master_fd, slave_fd = pty.openpty()

        # Set initial terminal size
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)

        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"

        pid = os.fork()
        if pid == 0:
            # Child process — become the shell
            os.close(master_fd)
            os.setsid()
            fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
            os.dup2(slave_fd, 0)
            os.dup2(slave_fd, 1)
            os.dup2(slave_fd, 2)
            if slave_fd > 2:
                os.close(slave_fd)

            if cwd:
                try:
                    os.chdir(os.path.expanduser(cwd))
                except OSError:
                    pass

            shell = os.environ.get("SHELL", "/bin/bash")
            os.execvpe(shell, [shell, "-l"], env)

        # Parent process
        os.close(slave_fd)
        self.master_fd = master_fd
        self.pid = pid

    def write(self, data: bytes) -> None:
        if self.master_fd is not None and not self._closed:
            try:
                os.write(self.master_fd, data)
            except OSError:
                pass

    def resize(self, cols: int, rows: int) -> None:
        if self.master_fd is not None and not self._closed:
            try:
                winsize = struct.pack("HHHH", rows, cols, 0, 0)
                fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, winsize)
            except OSError:
                pass

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            self.master_fd = None
        if self.pid is not None:
            try:
                os.kill(self.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            self.pid = None


@router.websocket("/ws")
async def terminal_websocket(websocket: WebSocket) -> None:
    """WebSocket endpoint for interactive terminal access.

    Client sends JSON messages:
      {"type": "input", "data": "ls\\n"}   — keystrokes
      {"type": "resize", "cols": 120, "rows": 30}  — terminal resize

    Server sends raw bytes (terminal output).
    """
    await websocket.accept()

    session = TerminalSession()
    loop = asyncio.get_event_loop()

    try:
        # Start PTY with default size
        session.start(cols=120, rows=30)
        assert session.master_fd is not None

        # Set non-blocking on master fd
        flags = fcntl.fcntl(session.master_fd, fcntl.F_GETFL)
        fcntl.fcntl(session.master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

        # Task to read PTY output and send to client
        async def read_pty() -> None:
            assert session.master_fd is not None
            fd = session.master_fd
            while not session._closed:
                try:
                    # Use asyncio event loop fd reader
                    future: asyncio.Future[bytes] = loop.create_future()

                    def _on_readable() -> None:
                        if future.done():
                            return
                        try:
                            data = os.read(fd, 4096)
                            if data:
                                future.set_result(data)
                            else:
                                future.set_result(b"")
                        except (OSError, BlockingIOError):
                            future.set_result(b"")

                    loop.add_reader(fd, _on_readable)
                    try:
                        data = await future
                    finally:
                        try:
                            loop.remove_reader(fd)
                        except Exception:
                            pass

                    if data:
                        await websocket.send_bytes(data)
                    else:
                        await asyncio.sleep(0.01)
                except (OSError, WebSocketDisconnect):
                    break
                except Exception:
                    await asyncio.sleep(0.05)

        read_task = asyncio.create_task(read_pty())

        # Main loop: read from WebSocket, write to PTY
        try:
            while True:
                message = await websocket.receive_json()
                msg_type = message.get("type", "")

                if msg_type == "input":
                    raw = message.get("data", "")
                    session.write(raw.encode())
                elif msg_type == "resize":
                    cols = message.get("cols", 120)
                    rows = message.get("rows", 30)
                    session.resize(cols, rows)
        except WebSocketDisconnect:
            pass
        except Exception as e:
            logger.error(f"Terminal WS error: {e}")
        finally:
            read_task.cancel()
            try:
                await read_task
            except asyncio.CancelledError:
                pass

    finally:
        session.close()
