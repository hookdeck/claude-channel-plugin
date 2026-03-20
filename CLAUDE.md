# Hookdeck Channel Plugin for Claude Code

This is a Claude Code plugin that bridges Hookdeck webhooks into Claude Code sessions via channels.

## Runtime

Use Bun. `bun run index.ts` to start, `bun install` for dependencies.

## Plugin Structure

- `.claude-plugin/plugin.json` — plugin manifest (name, version, metadata)
- `.mcp.json` — MCP server config using `${CLAUDE_PLUGIN_ROOT}` for paths
- `hooks/hooks.json` — SessionStart hook installs deps into `${CLAUDE_PLUGIN_DATA}`
- `index.ts` — single-file MCP server + HTTP listener

## Key Constraints

- stdout is reserved for MCP stdio — all logging uses `console.error`
- Plugins are copied to `~/.claude/plugins/cache`, so all paths must use `${CLAUDE_PLUGIN_ROOT}`
- Dependencies install to `${CLAUDE_PLUGIN_DATA}/node_modules` via the SessionStart hook

## Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol SDK
- `@hookdeck/sdk` — Hookdeck API client
- `zod` — schema validation (comes with MCP SDK)
