# Port Hub

A zero-dependency local dashboard that auto-detects your running dev servers and displays them as live preview cards.

![screenshot](screenshot.png)

## Features

- **Auto-detection** — scans for listening TCP ports, no config needed
- **Live previews** — each server renders in a mini browser iframe
- **Project names** — reads `package.json` from each process's working directory
- **Docker support** — detects containers and labels them with a badge
- **Smart filtering** — hides desktop apps (Spotify, Slack, browsers, etc.)
- **Zero dependencies** — just Node.js
- **Secure** — binds to `127.0.0.1` only

## Install

```bash
# Run directly with npx
npx port-hub

# Or install globally
npm install -g port-hub
```

## Usage

```bash
# Start with defaults (port 9000, scan 3000-9999)
port-hub

# Custom dashboard port
port-hub -p 8080

# Custom scan range
port-hub -r 3000-5000

# Combine
port-hub -p 8080 -r 3000-5000
```

Then open [http://localhost:9000](http://localhost:9000).

The dashboard auto-refreshes every 10 seconds.

## How it works

1. Uses `lsof` to find all TCP ports in LISTEN state
2. Filters out known desktop apps (Spotify, browsers, etc.)
3. Queries `docker ps` for running containers
4. Resolves each process's working directory to find `package.json`
5. Renders an HTML dashboard with iframe previews of each server

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port` | Dashboard port | `9000` |
| `-r, --range` | Port scan range | `3000-9999` |
| `-h, --help` | Show help | |
| `-v, --version` | Show version | |

## Requirements

- Node.js 18+
- macOS or Linux (uses `lsof` and `ps`)
- Docker CLI (optional, for container detection)

## License

MIT
