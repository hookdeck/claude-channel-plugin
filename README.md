# Hookdeck Channel Plugin for Claude Code

A Claude Code plugin that bridges webhooks from [Hookdeck Event Gateway](https://hookdeck.com) into Claude Code sessions as channel events. When webhooks arrive at your Hookdeck sources (from GitHub, Stripe, CI pipelines, monitoring tools, etc.), this plugin pushes them into Claude Code so Claude can react to them.

## Architecture

```
External Service (GitHub, Stripe, CI, etc.)
        ↓ POST webhook
Hookdeck Event Gateway (cloud)
        ↓ captures, queues, inspects
Hookdeck CLI (forwards to localhost)
        ↓
This Plugin (MCP server + HTTP listener)
        ↓ notifications/claude/channel
Claude Code Session (reacts to events)
```

## Prerequisites

- [Bun](https://bun.sh) runtime
- [Claude Code](https://claude.ai) v2.1.80+
- [Hookdeck CLI](https://hookdeck.com/docs/cli) (for Approach A)
- [Hookdeck API key](https://dashboard.hookdeck.com) (for Approach B)

## Installation

### From a marketplace

```
/plugin install hookdeck@<marketplace-name>
```

### For development

```bash
claude --plugin-dir ./path/to/hookdeck-channel
```

During research preview, custom channels also require:

```bash
claude --dangerously-load-development-channels server:hookdeck
```

## Setup

After installing the plugin, configure your webhook sources using one of two approaches.

### Approach A: Manual (simpler)

Run the Hookdeck CLI in another terminal:

```bash
hookdeck listen 8788 my-source
```

Point your webhook provider at the Hookdeck source URL the CLI gives you.

### Approach B: Auto-provision (more integrated)

Set `HOOKDECK_API_KEY` and `HOOKDECK_SOURCES` environment variables in your MCP server config. The plugin auto-creates Hookdeck connections and logs the source URLs on startup. You still need the Hookdeck CLI running to forward events locally:

```bash
hookdeck listen 8788 --cli-path /webhook
```

## Configuration

All configuration is via environment variables set in the plugin's `.mcp.json`:

| Variable | Default | Description |
|---|---|---|
| `HOOKDECK_PORT` | `8788` | Local HTTP server port |
| `HOOKDECK_API_KEY` | — | Hookdeck API key (enables auto-provisioning) |
| `HOOKDECK_SOURCES` | — | Comma-separated source names to provision |
| `HOOKDECK_EVENT_FILTER` | — | Comma-separated event types to allow (e.g., `push,pull_request`) |
| `HOOKDECK_ALLOWED_IPS` | — | Comma-separated IPs to allow (empty = allow all) |

## Testing Locally

With the plugin running, send test webhooks:

```bash
./test/test-webhook.sh
```

Or manually:

```bash
curl -X POST http://localhost:8788/webhook \
  -H "Content-Type: application/json" \
  -H "x-hookdeck-source-name: test-source" \
  -H "x-github-event: push" \
  -d '{"ref":"refs/heads/main","commits":[{"message":"fix bug"}]}'
```

## Reply Tool

The plugin includes a `hookdeck_reply` tool that lets Claude send outbound HTTP requests in response to events — post PR comments, acknowledge alerts, trigger downstream services, etc.

## How It Works

1. On session start, a hook installs dependencies into `${CLAUDE_PLUGIN_DATA}` if needed
2. The plugin starts an HTTP server on `HOOKDECK_PORT` to receive forwarded webhooks
3. It registers as an MCP server with the `claude/channel` capability
4. When a POST arrives at `/webhook`, it extracts metadata (source name, event type, event ID) from Hookdeck headers and well-known webhook headers (GitHub, Stripe, GitLab, etc.)
5. It emits a `notifications/claude/channel` notification with the payload wrapped in a `<channel>` XML tag
6. Claude Code receives the notification and can react to the event

## Plugin Structure

```
hookdeck-channel/
├── .claude-plugin/
│   └── plugin.json         # Plugin manifest
├── .mcp.json                # MCP server config
├── hooks/
│   └── hooks.json           # SessionStart hook for dependency installation
├── index.ts                 # MCP server + HTTP listener
├── package.json             # Dependencies
├── tsconfig.json
├── README.md
└── test/
    └── test-webhook.sh      # curl commands for local testing
```
