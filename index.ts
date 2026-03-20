import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HookdeckClient } from "@hookdeck/sdk";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Configuration (environment variables)
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.HOOKDECK_PORT || "8788", 10);
const API_KEY = process.env.HOOKDECK_API_KEY || "";
const SOURCES = process.env.HOOKDECK_SOURCES
  ? process.env.HOOKDECK_SOURCES.split(",").map((s) => s.trim()).filter(Boolean)
  : [];
const ALLOWED_IPS = process.env.HOOKDECK_ALLOWED_IPS
  ? process.env.HOOKDECK_ALLOWED_IPS.split(",").map((s) => s.trim()).filter(Boolean)
  : [];
const EVENT_FILTER = process.env.HOOKDECK_EVENT_FILTER
  ? process.env.HOOKDECK_EVENT_FILTER.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

// ---------------------------------------------------------------------------
// Logging — stdout is reserved for MCP stdio, so all logging goes to stderr
// ---------------------------------------------------------------------------

function log(msg: string) {
  console.error(`[hookdeck-channel] ${msg}`);
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const mcp = new McpServer(
  { name: "hookdeck", version: "1.0.0" },
  {
    capabilities: {
      tools: {},
      "claude/channel": {},
    } as any,
  }
);

// ---------------------------------------------------------------------------
// Reply Tool (Phase 2 — two-way communication)
// ---------------------------------------------------------------------------

mcp.tool(
  "hookdeck_reply",
  "Send an outbound webhook or HTTP request. Useful for replying to events — posting CI comments, acknowledging alerts, triggering downstream services, etc.",
  {
    destination_url: z.string().describe("URL to POST the response to"),
    body: z.string().describe("JSON payload to send"),
    headers: z
      .string()
      .describe('Optional HTTP headers as JSON object, e.g. {"Authorization": "Bearer ..."}. Omit or pass "{}" for no extra headers.'),
  },
  async ({ destination_url, body, headers: headersStr }) => {
    let headers: Record<string, string> = {};
    try {
      headers = headersStr ? JSON.parse(headersStr) : {};
    } catch {
      // ignore parse errors, use empty headers
    }
    try {
      const response = await fetch(destination_url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body,
      });
      const responseText = await response.text();
      return {
        content: [
          {
            type: "text" as const,
            text: `Sent to ${destination_url}: ${response.status} ${response.statusText}\n${responseText}`,
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Channel notification helper
// ---------------------------------------------------------------------------

async function emitChannelEvent(opts: {
  sourceName: string;
  eventType: string;
  eventId: string;
  payload: string;
}) {
  const attrs = [
    `source="hookdeck"`,
    `hookdeck_source="${opts.sourceName}"`,
    `event_type="${opts.eventType}"`,
    `hookdeck_event_id="${opts.eventId}"`,
  ].join(" ");

  // Use the low-level notification method on the underlying Server instance
  // because notifications/claude/channel is not a standard MCP notification type
  await (mcp as any).server.notification({
    method: "notifications/claude/channel",
    params: {
      channel: "hookdeck",
      title: `Webhook from ${opts.sourceName}`,
      body: `<channel ${attrs}>${opts.payload}</channel>`,
    },
  });

  log(`Emitted channel event: ${opts.sourceName} / ${opts.eventType} / ${opts.eventId}`);
}

// ---------------------------------------------------------------------------
// Sender gating — basic IP allowlist + Hookdeck header validation
// ---------------------------------------------------------------------------

function isAllowed(req: Request, server: any): boolean {
  // If no allowlist configured, allow all (trust the Hookdeck CLI or local network)
  if (ALLOWED_IPS.length === 0) return true;

  // Bun's server provides the remote address via server.requestIP(req)
  const addr = server?.requestIP?.(req);
  const ip = addr?.address || "";

  // Always allow localhost
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") {
    return true;
  }

  if (ALLOWED_IPS.includes(ip)) return true;

  log(`Blocked request from ${ip} (not in HOOKDECK_ALLOWED_IPS)`);
  return false;
}

// ---------------------------------------------------------------------------
// Extract metadata from incoming webhook request
// ---------------------------------------------------------------------------

function extractMetadata(req: Request): {
  sourceName: string;
  eventType: string;
  eventId: string;
} {
  const headers = req.headers;

  // Hookdeck-specific headers
  const hookdeckSource =
    headers.get("x-hookdeck-source-name") ||
    headers.get("x-hookdeck-source-id") ||
    "unknown";
  const hookdeckEventId =
    headers.get("x-hookdeck-event-id") || crypto.randomUUID();

  // Try to determine event type from well-known webhook headers
  const eventType =
    headers.get("x-github-event") || // GitHub
    headers.get("x-gitlab-event") || // GitLab
    headers.get("stripe-event-type") || // Stripe (custom, not standard)
    headers.get("x-hookdeck-event-type") || // Hookdeck
    "webhook";

  return {
    sourceName: hookdeckSource,
    eventType,
    eventId: hookdeckEventId,
  };
}

// ---------------------------------------------------------------------------
// HTTP Server — receives forwarded webhooks from Hookdeck CLI or direct delivery
// ---------------------------------------------------------------------------

function startHttpServer() {
  const server = Bun.serve({
    port: PORT,
    async fetch(req, server) {
      const url = new URL(req.url);

      // Health check
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        return new Response(JSON.stringify({ status: "ok", channel: "hookdeck" }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Only accept POST for webhooks
      if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      // Accept on / and /webhook
      if (url.pathname !== "/" && url.pathname !== "/webhook") {
        return new Response("Not found", { status: 404 });
      }

      // Sender gating
      if (!isAllowed(req, server)) {
        return new Response("Forbidden", { status: 403 });
      }

      try {
        const body = await req.text();
        const meta = extractMetadata(req);

        // Event type filtering
        if (EVENT_FILTER.length > 0 && !EVENT_FILTER.includes(meta.eventType)) {
          log(`Filtered out event type: ${meta.eventType}`);
          return new Response(JSON.stringify({ status: "filtered" }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        // Try to pretty-format well-known payloads, fall back to raw
        let payload = body;
        try {
          const parsed = JSON.parse(body);
          // For Stripe events, extract the type from the payload if not in headers
          if (parsed.type && meta.eventType === "webhook") {
            meta.eventType = parsed.type;
          }
          payload = JSON.stringify(parsed);
        } catch {
          // Not JSON — use raw body
        }

        await emitChannelEvent({
          sourceName: meta.sourceName,
          eventType: meta.eventType,
          eventId: meta.eventId,
          payload,
        });

        return new Response(JSON.stringify({ status: "ok", eventId: meta.eventId }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`Error processing webhook: ${message}`);
        return new Response(JSON.stringify({ status: "error", error: message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    },
  });

  log(`HTTP server listening on port ${server.port}`);
  log(`Webhook endpoint: http://localhost:${server.port}/webhook`);

  return server;
}

// ---------------------------------------------------------------------------
// Hookdeck SDK Integration (Approach B) — auto-provision sources/connections
// ---------------------------------------------------------------------------

async function provisionHookdeckConnections() {
  if (!API_KEY) {
    log("No HOOKDECK_API_KEY set — skipping SDK provisioning (Approach A: manual CLI mode)");
    log(`Run: hookdeck listen ${PORT} <source-name> in another terminal`);
    return;
  }

  if (SOURCES.length === 0) {
    log("HOOKDECK_API_KEY is set but no HOOKDECK_SOURCES configured");
    log("Set HOOKDECK_SOURCES=source1,source2 to auto-provision connections");
    return;
  }

  log("Provisioning Hookdeck connections via SDK...");

  const hookdeck = new HookdeckClient({ token: API_KEY });

  for (const sourceName of SOURCES) {
    try {
      const connection = await hookdeck.connection.upsert({
        name: `claude-channel-${sourceName}`,
        source: { name: sourceName },
        destination: {
          name: `claude-code-local-${sourceName}`,
          cliPath: "/webhook",
        },
      });

      log(`Source "${sourceName}" → ${connection.source.url}`);
      log(`  Connection ID: ${connection.id}`);
      log(`  Point your webhook provider at: ${connection.source.url}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`Failed to provision source "${sourceName}": ${message}`);
    }
  }

  log(`\nRun: hookdeck listen ${PORT} --cli-path /webhook`);
  log("The CLI will forward matching events to this plugin's HTTP server.");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log("Starting Hookdeck Channel Plugin for Claude Code");

  // 1. Start the local HTTP server to receive webhooks
  try {
    startHttpServer();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Warning: Could not start HTTP server on port ${PORT}: ${message}`);
    log("The MCP server will still connect, but webhooks won't be received.");
    log("Check if another process is using the port: lsof -ti:" + PORT);
  }

  // 2. Provision Hookdeck connections if API key is available (Approach B)
  await provisionHookdeckConnections();

  // 3. Connect MCP server over stdio (Claude Code spawns this process)
  const transport = new StdioServerTransport();
  await mcp.connect(transport);

  log("MCP server connected — channel is live");
}

main().catch((err) => {
  log(`Fatal error: ${err}`);
  process.exit(1);
});
