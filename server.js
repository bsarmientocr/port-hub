#!/usr/bin/env node

const http = require("http");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// --- CLI args ---
const args = process.argv.slice(2);

function getFlag(name, fallback) {
  const i = args.indexOf(name);
  if (i !== -1 && args[i + 1]) return args[i + 1];
  return fallback;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
  Port Hub — Local dev server dashboard

  Usage: port-hub [options]

  Options:
    -p, --port <port>       Dashboard port (default: 9000)
    -r, --range <from-to>   Port scan range (default: 3000-9999)
    -h, --help              Show this help
    -v, --version           Show version
  `);
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "package.json"), "utf-8")
  );
  console.log(pkg.version);
  process.exit(0);
}

const PORT = parseInt(getFlag("-p", getFlag("--port", "9000")), 10);
const range = getFlag("-r", getFlag("--range", "3000-9999")).split("-");
const SCAN_START = parseInt(range[0], 10);
const SCAN_END = parseInt(range[1], 10);

// Process names to ignore (desktop apps, not dev servers)
const IGNORED_PROCESSES = [
  "Spotify",
  "NTKDaemon",
  "Slack",
  "Discord",
  "Figma",
  "Google Chrome",
  "Firefox",
  "Safari",
  "Arc",
  "Brave",
  "Microsoft",
  "zoom",
  "Dropbox",
  "iCloud",
  "rapportd",
  "sharingd",
  "ControlCenter",
  "SystemUIServer",
  "WindowServer",
  "loginwindow",
];

function getProcessCommand(pid) {
  try {
    return execSync(`ps -p ${pid} -o comm= 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 1000,
    }).trim();
  } catch {
    return "";
  }
}

function isIgnoredProcess(pid) {
  const cmd = getProcessCommand(pid);
  return IGNORED_PROCESSES.some((name) =>
    cmd.toLowerCase().includes(name.toLowerCase())
  );
}

function getDockerContainers() {
  try {
    const output = execSync(
      `docker ps --format "{{.Ports}}\\t{{.Names}}\\t{{.Image}}" 2>/dev/null`,
      { encoding: "utf-8", timeout: 3000 }
    );
    const containers = [];
    for (const line of output.split("\n").filter(Boolean)) {
      const [ports, name, image] = line.split("\t");
      const portMatches = ports.matchAll(/0\.0\.0\.0:(\d+)->/g);
      for (const match of portMatches) {
        const port = parseInt(match[1], 10);
        if (port >= SCAN_START && port <= SCAN_END && port !== PORT) {
          containers.push({ port, name, image });
        }
      }
    }
    return containers;
  } catch {
    return [];
  }
}

function getListeningPorts() {
  try {
    const output = execSync(`lsof -iTCP -sTCP:LISTEN -Fn -Fp 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 5000,
    });

    const entries = [];
    let currentPid = null;

    for (const line of output.split("\n")) {
      if (line.startsWith("p")) {
        currentPid = line.slice(1);
      } else if (line.startsWith("n") && currentPid) {
        const portMatch = line.match(/:(\d+)$/);
        if (portMatch) {
          const port = parseInt(portMatch[1], 10);
          if (port >= SCAN_START && port <= SCAN_END && port !== PORT) {
            if (!entries.find((e) => e.port === port)) {
              if (!isIgnoredProcess(currentPid)) {
                entries.push({ port, pid: currentPid });
              }
            }
          }
        }
      }
    }

    return entries;
  } catch {
    return [];
  }
}

function getProjectInfo(pid) {
  try {
    const cwdOutput = execSync(
      `lsof -a -p ${pid} -d cwd -Fn 2>/dev/null`,
      { encoding: "utf-8", timeout: 2000 }
    );
    const cwdMatch = cwdOutput.match(/^n(.+)$/m);
    if (cwdMatch) {
      const cwd = cwdMatch[1];
      let dir = cwd;
      for (let i = 0; i < 8; i++) {
        const pkgPath = path.join(dir, "package.json");
        if (fs.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
            return { name: pkg.name || path.basename(dir), cwd: dir };
          } catch {
            return { name: path.basename(dir), cwd: dir };
          }
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return { name: path.basename(cwd), cwd };
    }
  } catch {}

  return { name: null, cwd: null };
}

function scanPorts() {
  const entries = getListeningPorts();
  const dockerContainers = getDockerContainers();
  const results = [];
  const seenPorts = new Set();

  for (const c of dockerContainers) {
    seenPorts.add(c.port);
    results.push({
      port: c.port,
      name: c.name,
      cwd: c.image,
      isDocker: true,
    });
  }

  for (const { port, pid } of entries) {
    if (seenPorts.has(port)) continue;
    const info = getProjectInfo(pid);
    results.push({
      port,
      name: info.name || `Port ${port}`,
      cwd: info.cwd,
      isDocker: false,
    });
  }

  results.sort((a, b) => a.port - b.port);
  return results;
}

function renderHTML(servers) {
  const cards = servers
    .map(
      (s) => `
      <a href="http://localhost:${s.port}" target="_blank" class="card">
        <div class="monitor">
          <div class="monitor-bar">
            <span class="dot red"></span>
            <span class="dot yellow"></span>
            <span class="dot green"></span>
            <span class="monitor-url">localhost:${s.port}</span>
          </div>
          <div class="monitor-screen">
            <iframe src="http://localhost:${s.port}" sandbox="allow-same-origin allow-scripts" loading="lazy" tabindex="-1"></iframe>
          </div>
        </div>
        <div class="info">
          <div class="port">:${s.port}${s.isDocker ? ' <span class="badge">Docker</span>' : ""}</div>
          <div class="name">${escapeHtml(s.name)}</div>
          ${s.cwd ? `<div class="cwd">${escapeHtml(s.cwd)}</div>` : ""}
          <div class="status">&bull; Running</div>
        </div>
      </a>`
    )
    .join("\n");

  const empty =
    servers.length === 0
      ? `<div class="empty">No dev servers detected on ports ${SCAN_START}\u2013${SCAN_END}</div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Port Hub</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <meta http-equiv="refresh" content="10" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f0f0f;
      color: #e0e0e0;
      min-height: 100vh;
      padding: 40px 24px;
    }
    .header { text-align: center; margin-bottom: 48px; }
    .header h1 { font-size: 28px; font-weight: 600; letter-spacing: 0.05em; color: #fff; }
    .header p { margin-top: 8px; font-size: 14px; color: #666; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 20px;
      max-width: 1400px;
      margin: 0 auto;
    }
    .card {
      display: block;
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      overflow: hidden;
      text-decoration: none;
      color: inherit;
      transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
    }
    .card:hover {
      border-color: #4a9;
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(68, 170, 153, 0.1);
    }
    .monitor { background: #111; border-bottom: 1px solid #2a2a2a; }
    .monitor-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      background: #222;
    }
    .dot { width: 10px; height: 10px; border-radius: 50%; }
    .dot.red { background: #ff5f57; }
    .dot.yellow { background: #febc2e; }
    .dot.green { background: #28c840; }
    .monitor-url {
      margin-left: 8px;
      font-size: 11px;
      font-family: "SF Mono", "Fira Code", monospace;
      color: #666;
    }
    .monitor-screen {
      position: relative;
      width: 100%;
      height: 200px;
      overflow: hidden;
      background: #fff;
    }
    .monitor-screen iframe {
      position: absolute;
      top: 0; left: 0;
      width: 200%; height: 200%;
      transform: scale(0.5);
      transform-origin: top left;
      border: none;
      pointer-events: none;
    }
    .info { padding: 16px 20px; }
    .port {
      font-size: 24px;
      font-weight: 700;
      font-family: "SF Mono", "Fira Code", monospace;
      color: #4a9;
    }
    .name { margin-top: 4px; font-size: 16px; font-weight: 600; color: #fff; }
    .cwd {
      margin-top: 4px;
      font-size: 11px;
      color: #555;
      font-family: "SF Mono", "Fira Code", monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .status { margin-top: 8px; font-size: 12px; color: #4a9; font-weight: 500; }
    .badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 600;
      background: #1d63ed;
      color: #fff;
      padding: 2px 6px;
      border-radius: 4px;
      vertical-align: middle;
      margin-left: 6px;
      font-family: -apple-system, sans-serif;
    }
    .empty {
      text-align: center;
      color: #555;
      font-size: 16px;
      grid-column: 1 / -1;
      padding: 60px 20px;
    }
    .footer { text-align: center; margin-top: 48px; font-size: 12px; color: #333; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Port Hub</h1>
    <p>Auto-refreshes every 10s &middot; ${servers.length} server${servers.length !== 1 ? "s" : ""} detected &middot; scanning :${SCAN_START}&ndash;${SCAN_END}</p>
  </div>
  <div class="grid">
    ${cards}
    ${empty}
  </div>
  <div class="footer">localhost:${PORT}</div>
</body>
</html>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const faviconPath = path.join(__dirname, "favicon.svg");
const faviconSvg = fs.existsSync(faviconPath)
  ? fs.readFileSync(faviconPath, "utf-8")
  : "";

const server = http.createServer((req, res) => {
  if (req.url === "/favicon.svg" || req.url === "/favicon.ico") {
    if (faviconSvg) {
      res.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
      });
      res.end(faviconSvg);
    } else {
      res.writeHead(204);
      res.end();
    }
    return;
  }

  try {
    const servers = scanPorts();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderHTML(servers));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Error scanning ports: " + err.message);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Port Hub running at http://localhost:${PORT}\n`);
});
