#!/bin/bash
set -e
DIR="/Users/udingethe/Dev/earlynotwrong/videos/casper-buildathon-demo/terminal"
mkdir -p "$DIR"

# Free MCP query - parse SSE data lines and pretty-print JSON
cat > /tmp/free_query_demo.sh <<'EOF'
echo "$ curl -sS -X POST http://144.202.117.160:31777/mcp -H 'content-type: application/json' -d '{...get_latest_conviction...}'"
curl -sS -X POST http://144.202.117.160:31777/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_latest_conviction","arguments":{"subjectHash":"0x4a937673ea542abdf587e6b509793b2173980228cc65180a2f32c24fd3ac459a"}}}' \
  | grep '^data: ' | sed 's/^data: //' | python3 -m json.tool
EOF

asciinema rec "$DIR/free_mcp.cast" --cols 120 --rows 35 --command "bash /tmp/free_query_demo.sh" --title "Free MCP query - get_latest_conviction" --overwrite

# Paid MCP query (402 challenge)
cat > /tmp/paid_query_demo.sh <<'EOF'
echo "$ curl -sS -o /tmp/402.json -w '---STATUS:%{http_code}---\\n' -X POST http://144.202.117.160:31777/mcp -H 'content-type: application/json' -d '{...get_agent_reputation...}'"
curl -sS -o /tmp/402.json -w '\n---STATUS:%{http_code}---\n' -X POST http://144.202.117.160:31777/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_agent_reputation",
      "arguments": {
        "subjectHash": "0x4a937673ea542abdf587e6b509793b2173980228cc65180a2f32c24fd3ac459a"
      }
    }
  }'
cat /tmp/402.json | python3 -m json.tool
EOF

asciinema rec "$DIR/paid_mcp.cast" --cols 120 --rows 40 --command "bash /tmp/paid_query_demo.sh" --title "Paid MCP query - x402 402 challenge" --overwrite
