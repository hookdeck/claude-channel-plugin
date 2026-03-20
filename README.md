# Hookdeck Channel Plugin for Claude Code

Receive webhooks from any provider (GitHub, Stripe, CI pipelines, monitoring tools) in your Claude Code session via [Hookdeck](https://hookdeck.com). Hookdeck captures, inspects, and forwards webhook events to Claude with stable URLs, event replay, and filtering — no tunnel setup required.

Channels are in [research preview](https://code.claude.com/docs/en/channels#research-preview) and require Claude Code v2.1.80+.

## Use-cases

- **Iterate without re-triggering** — Capture a webhook once from your provider, then replay it every time you change your channel server code. No need to push another commit or create another test payment.
- **Stable webhook URLs across restarts** — Your Hookdeck source URL stays the same between sessions. Reconfigure your webhook provider once and it keeps working no matter how many times you restart Claude Code or the CLI.
- **Inspect what your channel actually receives** — See the full request body, headers, and response for every webhook in the CLI or Hookdeck dashboard. Useful when your channel notification formatting isn't producing what you expect.
- **Filter out noise during development** — If you're subscribed to all GitHub events but only building a handler for push events, filter at the Hookdeck layer so your channel only receives what you're working on.
- **Test multiple event types quickly** — Trigger one of each event type from your provider, then selectively replay them from Hookdeck's history as you build handlers for each one.
- **Share webhook payloads with teammates** — Multiple developers can connect to the same Hookdeck source independently, each forwarding to their own local channel server without stepping on each other.

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
- [Claude Code](https://claude.ai) v2.1.80+ with claude.ai login
- [Hookdeck CLI](https://hookdeck.com/docs/cli) (for Approach A)
- [Hookdeck API key](https://dashboard.hookdeck.com) (for Approach B)

## Installation

### From a marketplace

```
/plugin install hookdeck@<marketplace-name>
```

### For development

```bash
claude --plugin-dir ./path/to/claude-channel-plugin
```

## Running with channels enabled

Channels must be explicitly enabled per session with `--channels`:

```bash
claude --channels plugin:hookdeck@<marketplace-name>
```

During the research preview, custom channels aren't on the approved allowlist. To test locally:

```bash
claude --dangerously-load-development-channels plugin:hookdeck@<marketplace-name>
```

Or for a bare MCP server (no plugin wrapper):

```bash
claude --dangerously-load-development-channels server:hookdeck-channel
```

## Setup

After installing and enabling the plugin, configure your webhook sources.

### Approach A: Manual (simpler)

Run the Hookdeck CLI in another terminal:

```bash
hookdeck listen 8788 my-source
```

Point your webhook provider at the Hookdeck source URL the CLI gives you.

### Approach B: Auto-provision (more integrated)

Set `HOOKDECK_API_KEY` and `HOOKDECK_SOURCES` environment variables in the plugin's `.mcp.json`. The plugin auto-creates Hookdeck connections and logs the source URLs on startup. You still need the Hookdeck CLI running to forward events locally:

```bash
hookdeck listen 8788 --cli-path /webhook
```

## Configuration

All configuration is via environment variables in the plugin's `.mcp.json`:

| Variable | Default | Description |
|---|---|---|
| `HOOKDECK_PORT` | `8788` | Local HTTP server port |
| `HOOKDECK_API_KEY` | — | Hookdeck API key (enables auto-provisioning) |
| `HOOKDECK_SOURCES` | — | Comma-separated source names to provision |
| `HOOKDECK_EVENT_FILTER` | — | Comma-separated event types to allow (e.g., `push,pull_request`) |
| `HOOKDECK_ALLOWED_IPS` | — | Comma-separated IPs to allow (empty = allow all; localhost always allowed) |

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

The plugin exposes a `hookdeck_reply` tool so Claude can send outbound HTTP requests in response to events — post PR comments, acknowledge alerts, trigger downstream services, etc.

## How It Works

1. On session start, a hook installs dependencies into `${CLAUDE_PLUGIN_DATA}` if needed
2. The plugin starts a localhost HTTP server on `HOOKDECK_PORT` to receive forwarded webhooks
3. It registers as an MCP server with the `claude/channel` capability (under `experimental`)
4. Server `instructions` are added to Claude's system prompt so it knows how to handle events
5. When a POST arrives at `/webhook`, it extracts metadata from Hookdeck headers and well-known webhook headers (GitHub, Stripe, GitLab)
6. It emits a `notifications/claude/channel` notification with the payload as `content` and metadata as `meta` attributes
7. Claude Code receives the event as a `<channel>` tag and acts on it

## Plugin Structure

```
claude-channel-plugin/
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
