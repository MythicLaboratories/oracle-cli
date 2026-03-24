"""Oracle CLI integrations — connect external AI agents as teammates."""

from kimi_cli.integrations.base import Integration, IntegrationStatus
from kimi_cli.integrations.claude_code import ClaudeCodeIntegration
from kimi_cli.integrations.oracle_cli import OracleCliIntegration

__all__ = [
    "Integration",
    "IntegrationStatus",
    "ClaudeCodeIntegration",
    "OracleCliIntegration",
]


_registry: dict[str, Integration] | None = None


def get_registry() -> dict[str, Integration]:
    """Get or create the global integration registry."""
    global _registry
    if _registry is None:
        oracle = OracleCliIntegration()
        claude = ClaudeCodeIntegration()
        _registry = {
            oracle.id: oracle,
            claude.id: claude,
        }
    return _registry
