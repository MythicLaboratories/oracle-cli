from __future__ import annotations

import os
from pathlib import Path


def get_share_dir() -> Path:
    """Get the share directory path."""
    if share_dir := os.getenv("ORACLE_SHARE_DIR"):
        share_dir = Path(share_dir)
    elif share_dir := os.getenv("KIMI_SHARE_DIR"):
        share_dir = Path(share_dir)
    else:
        share_dir = Path.home() / ".oracle"
    share_dir.mkdir(parents=True, exist_ok=True)
    return share_dir
