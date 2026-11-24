#!/usr/bin/env bash
# One-time EC2 setup (Ubuntu/Debian or Amazon Linux). Run as root: sudo bash bootstrap.sh <deploy-ssh-user>
set -euo pipefail
DEPLOY_USER="${1:?usage: bootstrap.sh <deploy-ssh-user>}"
APP=/opt/call-answer-server

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  if command -v apt-get >/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    dnf install -y nodejs
  fi
fi

id callanswer >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin callanswer
install -d -o "$DEPLOY_USER" -g callanswer -m 0750 "$APP" "$APP/releases"
install -d -o callanswer -g callanswer -m 0750 /var/lib/call-answer-server

if [ ! -f /etc/call-answer-server.env ]; then
  install -m 0640 -o root -g callanswer /dev/null /etc/call-answer-server.env
  echo "Created /etc/call-answer-server.env (empty). Fill it from .env.example before the first deploy."
fi

# Let the deploy user run only the install script as root.
cat > /etc/sudoers.d/call-answer-server <<SUDO
$DEPLOY_USER ALL=(root) NOPASSWD: $APP/install.sh
SUDO
chmod 0440 /etc/sudoers.d/call-answer-server
echo "Bootstrap done. Node: $(node -v)"
