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
  *) echo "Usage: bash scripts/service.sh {start|stop|status|restart} [service]"; exit 2 ;;
esac
