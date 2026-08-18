# Setup and Operations

openCodexMicro has two installed components:

```text
Codex Desktop <-> Codex Bridge sidecar <-> Ulanzi Studio plugin <-> D200
```

## Dependencies

- macOS;
- Codex Desktop;
- Ulanzi Studio with a supported keypad device;
- Node.js 20 or newer.

## 1. Set up Codex Bridge.app

From the repository root:

```bash
npm install
npm run setup
```

The installer builds the sidecar, writes and starts
`io.opencodexmicro.bridge`, and ad-hoc signs:

```text
~/Applications/Codex Bridge.app
```

To install without starting the sidecar LaunchAgent:

```bash
npm run setup -- --no-start
```

## 2. Install the Ulanzi Studio plugin

Quit Ulanzi Studio before replacing a plugin that is currently loaded, then
run:

```bash
npm run install:plugin
```

The repository ships the prebuilt `dist/app.js`. The command validates that
the manifest entry point exists and atomically replaces:

```text
~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.codexmicro.ulanziPlugin
```

Restart Ulanzi Studio and confirm the **Codex Micro** category and actions are
visible.

Plugin development still uses `npm run build:plugin` and `npm run check`; commit
the updated `dist/app.js` and `dist/package.json` with source changes.

## Starting Codex

Quit a normally launched Codex instance, then open:

```text
~/Applications/Codex Bridge.app
```

The wrapper launches `/Applications/ChatGPT.app/Contents/MacOS/ChatGPT` with:

```text
--remote-debugging-address=127.0.0.1
--remote-debugging-port=9222
--remote-allow-origins=http://127.0.0.1:9222
```

CDP binds to `127.0.0.1:9222` and the sidecar API to `127.0.0.1:17373`.
Neither endpoint is reachable from the LAN.

## Installed files and service

```text
~/Applications/Codex Bridge.app
~/Library/Application Support/openCodexMicro/bridge.mjs
~/Library/Application Support/openCodexMicro/bridge.log
~/Library/Application Support/openCodexMicro/bridge-error.log
~/Library/LaunchAgents/io.opencodexmicro.bridge.plist
~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.codexmicro.ulanziPlugin
```

Inspect or restart the Bridge sidecar:

```bash
launchctl print "gui/$(id -u)/io.opencodexmicro.bridge"
launchctl kickstart -k "gui/$(id -u)/io.opencodexmicro.bridge"
```

## Diagnostics

```bash
curl http://127.0.0.1:17373/health
curl http://127.0.0.1:17373/state
tail -f "$HOME/Library/Application Support/openCodexMicro/bridge.log"
tail -f "$HOME/Library/Application Support/openCodexMicro/bridge-error.log"
```

| Symptom | Check |
| --- | --- |
| Plugin category is missing | Confirm the installed plugin directory contains `manifest.json` and `dist/app.js`, then restart Ulanzi Studio |
| Plugin keys show offline | Start Codex with `Codex Bridge.app` and check `/health` and `/state` |
| A task key does not switch | Check `bridge-error.log` and confirm `/state` contains the displayed thread |
| Steer does nothing | Confirm a running task exposes the visible composer Steer action |
| An action has no effect | Confirm the plugin can reach `127.0.0.1:17373` and inspect the Bridge log |

## Update

```bash
git pull
npm install
npm run check
npm run setup
npm run install:plugin
```

Restart Ulanzi Studio after updating the plugin.

## Uninstall

```bash
npm run uninstall
```

This stops and removes the Bridge LaunchAgent, Bridge runtime, wrapper app, and
installed Codex Micro plugin directory.

## Development

```bash
npm install
npm run check
```

Main entry points:

- `src/bridge/`: Codex renderer bridge;
- `scripts/build-bridge.mjs`: bundle the loopback sidecar;
- `scripts/install.mjs`: install the sidecar and wrapper app;
- `scripts/install-plugin.mjs`: validate and install the prebuilt Ulanzi plugin;
- `integration/com.ulanzi.codexmicro.ulanziPlugin/`: Ulanzi Studio plugin;
- `scripts/uninstall.mjs`: remove both installed components.
