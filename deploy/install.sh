#!/usr/bin/env bash
# Installs a release archive and restarts the service. Run as root via sudo from the deploy workflow.
# Usage: install.sh /tmp/release.tgz
set -euo pipefail
ARCHIVE="${1:?usage: install.sh <release.tgz>}"
APP=/opt/call-answer-server
REL="$APP/releases/$(date +%Y%m%d%H%M%S)"
PREV="$(readlink -f "$APP/current" 2>/dev/null || true)"

mkdir -p "$REL"
tar -xzf "$ARCHIVE" -C "$REL"
(cd "$REL" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
install -m 0644 "$REL/deploy/call-answer-server.service" /etc/systemd/system/call-answer-server.service
chown -R callanswer:callanswer "$REL"
ln -sfn "$REL" "$APP/current"
systemctl daemon-reload
systemctl enable call-answer-server >/dev/null
systemctl restart call-answer-server

PORT="$(grep -E '^PORT=' /etc/call-answer-server.env | cut -d= -f2 || true)"
PORT="${PORT:-8080}"
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    echo "Healthy: $REL"
    # keep the last 5 releases
    ls -1dt "$APP"/releases/* | tail -n +6 | xargs -r rm -rf
    exit 0
  fi
  sleep 1
done

echo "Health check failed; rolling back" >&2
if [ -n "$PREV" ] && [ -d "$PREV" ]; then
  ln -sfn "$PREV" "$APP/current"
  systemctl restart call-answer-server
fi
journalctl -u call-answer-server -n 30 --no-pager >&2 || true
exit 1
