# Oracle CLI

AI agent for the terminal, powered by [Mythic Oracle](https://mythicoracle.ai).

Built on [kimi-cli](https://github.com/MoonshotAI/kimi-cli) by MoonshotAI. Customized by [Mythic Labs](https://mythiclabs.io).

## Install

```bash
pip install oracle-cli
```

## Quick Start

```bash
# Set your API key
export ORACLE_API_KEY=sk-your-key

# Or login with OAuth
oracle login

# Start chatting
oracle
```

## Features

- Terminal AI agent with code editing, shell commands, web search
- Powered by Kimi K2.5 (1T parameters, 32B active)
- OAuth login via mythicoracle.ai
- Web UI (Technical Preview): `oracle web`
- MCP server support: `oracle mcp`
- VS Code / Zed / JetBrains integration

## Configuration

Config lives at `~/.oracle/config.toml`. Set your API key:

```toml
[providers.oracle]
type = "kimi"
base_url = "https://api.moonshot.ai/v1"
api_key = "sk-your-key"

[models.oracle]
provider = "oracle"
model = "kimi-k2.5"
max_context_size = 131072
```

## License

Apache 2.0 — see [LICENSE](LICENSE)
