#!/usr/bin/env bash
# Test webhook delivery to the Hookdeck Channel Plugin
# Usage: ./test/test-webhook.sh [port]

PORT="${1:-8788}"
BASE="http://localhost:${PORT}"

echo "=== Health check ==="
curl -s "${BASE}/" | jq .
echo

echo "=== Simulated GitHub push event ==="
curl -s -X POST "${BASE}/webhook" \
  -H "Content-Type: application/json" \
  -H "x-hookdeck-source-name: github-webhooks" \
  -H "x-hookdeck-event-id: evt_test_gh_001" \
  -H "x-github-event: push" \
  -d '{
    "ref": "refs/heads/main",
    "repository": { "full_name": "acme/my-app" },
    "pusher": { "name": "dev" },
    "commits": [
      { "id": "abc123", "message": "fix: resolve login bug", "author": { "name": "dev" } }
    ]
  }' | jq .
echo

echo "=== Simulated Stripe invoice.paid event ==="
curl -s -X POST "${BASE}/webhook" \
  -H "Content-Type: application/json" \
  -H "x-hookdeck-source-name: stripe-payments" \
  -H "x-hookdeck-event-id: evt_test_stripe_001" \
  -d '{
    "type": "invoice.paid",
    "data": {
      "object": {
        "id": "in_1234",
        "amount_paid": 5000,
        "currency": "usd",
        "customer": "cus_abc"
      }
    }
  }' | jq .
echo

echo "=== Simulated CI failure event ==="
curl -s -X POST "${BASE}/webhook" \
  -H "Content-Type: application/json" \
  -H "x-hookdeck-source-name: ci-pipeline" \
  -H "x-hookdeck-event-id: evt_test_ci_001" \
  -d '{
    "type": "build.failed",
    "pipeline": "deploy-production",
    "commit": "def456",
    "error": "Test suite failed: 3 tests failing in auth module",
    "url": "https://ci.example.com/builds/789"
  }' | jq .
echo

echo "=== Simulated plain text webhook ==="
curl -s -X POST "${BASE}/webhook" \
  -H "Content-Type: text/plain" \
  -H "x-hookdeck-source-name: monitoring" \
  -H "x-hookdeck-event-id: evt_test_plain_001" \
  -d 'ALERT: CPU usage above 90% on prod-web-3' | jq .
echo

echo "Done. Check Claude Code session for channel events."
