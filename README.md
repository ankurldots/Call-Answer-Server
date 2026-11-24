# Call-answer-server

Node.js (TypeScript) WebSocket server for the Exotel AgentStream Voicebot applet. It answers the applet's dynamic URL request, accepts the bidirectional audio stream, and hands the audio to a pluggable call handler. Phase 1 ships an echo handler. A Nova 2 Sonic handler is Phase 2.

Spec: `Call-Answer/.kiro/specs/node-exotel-ws-server/requirements.md`.

## Run locally

```sh
npm install
cp .env.example .env     # set CALL_TOKEN_SECRET, PUBLIC_HOST, credentials (or AUTH_MODE=none)
npm run dev              # watch mode
npm run simulate         # in another terminal: plays Exotel, prints what comes back
```

Scripts: `build`, `start`, `dev`, `test`, `lint`, `typecheck`, `simulate`. Node 22 or later.

To test with real Exotel from your laptop, run a tunnel (for example `cloudflared tunnel --url http://localhost:8080`) and set `PUBLIC_HOST` to the tunnel host name.

## Endpoints

| Path | Purpose |
|------|---------|
| `GET/POST /exotel/resolve` | Voicebot applet dynamic URL. Reads `CallSid`, `CallTo` or `To`. Returns `{"url":"wss://<PUBLIC_HOST>/stream/<token>?sample-rate=<rate>"}` |
| `WS /stream/<token>` | Exotel audio stream. Token: HMAC over `CallSid`, valid 60 s, single use |
| `GET /health` | `{"status":"ok","activeCalls":n}`, no auth |

## Exotel test flow

1. In the Exotel dashboard create a custom app (call flow).
2. Add a Greeting applet (optional).
3. Add a Voicebot applet. As URL use `https://<user>:<password>@<PUBLIC_HOST>/exotel/resolve` (or without credentials with `AUTH_MODE=none`).
4. Assign the flow to an ExoPhone and call it.
5. Press `#` to send `clear`, `*` to play a 1-second tone. Fill `docs/open-facts.md` from the frame logs.

## Deployment: one EC2 instance, GitHub Actions

Run exactly one instance until the shared stores exist (see below). Set `MAX_CONCURRENT_CALLS` from the instance size.

### 1. EC2 (once)

- Region ap-northeast-1, Ubuntu 24.04 or Amazon Linux 2023, Elastic IP.
- Security group: 22 from your IP (and see the note on GitHub runners below), 80 and 443 from anywhere. Do not expose 8080.
- DNS: an A record for `PUBLIC_HOST` to the Elastic IP.
- Instance role: none needed in Phase 1. Phase 2 adds `bedrock:InvokeModelWithBidirectionalStream`.

```sh
scp deploy/bootstrap.sh <user>@<host>:/tmp/ && ssh <user>@<host> 'sudo bash /tmp/bootstrap.sh <user>'
ssh <user>@<host> 'sudo nano /etc/call-answer-server.env'   # contents from .env.example, real secrets
```

`bootstrap.sh` installs Node 22, creates the `callanswer` service user, `/opt/call-answer-server`, and a sudoers rule that lets the deploy user run only `install.sh` as root.

### 2. Caddy for TLS (once)

Install Caddy (see caddyserver.com/docs/install), then `/etc/caddy/Caddyfile`:

```
agent.leadingdots.com {
    reverse_proxy 127.0.0.1:8080
}
```

`sudo systemctl reload caddy`. Caddy gets the Let's Encrypt certificate itself and proxies WebSocket upgrades.

### 3. GitHub (once)

Repository secrets (used by the `production` environment in `.github/workflows/deploy.yml`):

| Secret | Value |
|--------|-------|
| `EC2_HOST` | Elastic IP or DNS name |
| `EC2_USER` | the SSH user passed to `bootstrap.sh` |
| `EC2_SSH_KEY` | private key of a deploy-only key pair (public half in the user's `authorized_keys`) |
| `EC2_KNOWN_HOSTS` | output of `ssh-keyscan -t ed25519 <host>` |

GitHub-hosted runners have changing IPs, so port 22 must accept them. Either restrict by key only (accept 0.0.0.0/0 on 22, password login off) or use a self-hosted runner or SSM instead.

### 4. Every deploy

Push to `main`. The workflow runs lint, build, and tests, then packages `dist`, `package.json`, `package-lock.json` and `deploy/`, copies them to the instance, and runs `install.sh`: new release folder, `npm ci --omit=dev`, switch the `current` symlink, restart, wait for `/health`, roll back to the previous release if the check fails. Releases are kept in `/opt/call-answer-server/releases` (last 5). Logs: `journalctl -u call-answer-server -f`.

On SIGTERM (every restart) the server stops taking new calls and lets active calls finish for up to `SHUTDOWN_GRACE_SECONDS`.

### Moving to several instances behind an ALB

1. Replace `TokenUseStore` and `CallRegistry` (`src/stores.ts`) with shared implementations (for example DynamoDB with TTL). Do this before adding the second instance.
2. Target group health check: `/health`. ALB idle timeout at least 3600 s. Terminate TLS on the ALB and drop Caddy.
3. `MAX_CONCURRENT_CALLS` is per instance.

## Adding a handler (Phase 2)

Implement `CallHandler` (`src/handler.ts`), register it in `src/handlers.ts`, select it with `HANDLER=<name>`. The protocol layer owns chunking, pacing, sequence numbers and timers. Keep AWS SDK imports out of the protocol files; put the Sonic handler in its own folder.

## Privacy

Frame logs never hold payload content, credentials or tokens. `RECORD_RAW_AUDIO=true` writes caller audio to disk; leave it off unless measuring.
