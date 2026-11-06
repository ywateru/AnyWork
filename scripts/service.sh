#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .remote-agent
chmod 700 .remote-agent
case "${1:-status}" in
  start)
    if supervisorctl -c supervisord.conf pid >/dev/null 2>&1; then
      supervisorctl -c supervisord.conf start all
    else
      supervisord -c supervisord.conf
    fi
    ;;
  stop|status|restart) supervisorctl -c supervisord.conf "$1" "${2:-all}" ;;
  url) python3 -c 'import pathlib,re; matches=re.findall(r"https://[a-z0-9-]+\.trycloudflare\.com",pathlib.Path(".remote-agent/tunnel.log").read_text()); print(matches[-1] if matches else "Tunnel URL not available yet")' ;;
  *) echo "Usage: bash scripts/service.sh {start|stop|status|restart|url} [service]"; exit 2 ;;
esac
