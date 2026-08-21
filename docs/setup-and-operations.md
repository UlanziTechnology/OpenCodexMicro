# Setup and Operations

OpenCodexMicro has two installed components:

```text
Codex Desktop <-> Codex Bridge sidecar <-> Ulanzi Studio plugin <-> D200
```

## Dependencies

- Windows 10+ or macOS 13+;
- Codex Desktop Stable or Beta;
- Ulanzi Studio 3.0.1+ with a supported D200 Series device;
- Node.js 20+ only for repository-based installation.

## Install from Ulanzi Studio

Drag any Codex Micro Action onto a key and select it. In the shared **Codex
Bridge Setup** page, choose **Install / Repair**, then **Launch Codex Bridge**.
The bundled installer requires no repository path, npm directory, administrator
service, or fixed Codex package version.

Initial Bridge installation remains an explicit setup action. After that, every
plugin startup compares the bundled version and SHA-256 with both the installed
runtime and the identity reported by the running Bridge. A mismatch updates only
the managed Bridge files, restarts that Bridge process, and waits for the new
process to report the expected build; Codex Desktop is not terminated.
Interrupted updates restore both runtime and metadata backups and retry once in
the same lifecycle operation. Other transient startup failures use three bounded
background retries with backoff while Ulanzi Studio remains open.

Windows installs Bridge data under:

```text
%LOCALAPPDATA%\OpenCodexMicro
```

The Ulanzi plugin starts and supervises the user-level Bridge process. The
launcher reads Appx metadata for `OpenAI.Codex` and `OpenAI.CodexBeta`, preferring
Stable unless `CODEX_DESKTOP_CHANNEL=beta` is configured.

macOS keeps the wrapper and LaunchAgent flow:

```text
~/Applications/Codex Bridge.app
~/Library/Application Support/OpenCodexMicro
~/Library/LaunchAgents/io.opencodexmicro.bridge.plist
```

## Install from the repository

From the `OpenCodexMicro` repository root:

```text
npm install
npm run install:plugin
npm run setup
```

Quit Ulanzi Studio before replacing a loaded plugin. `install:plugin` validates
the manifest, entry point, Property Inspector, icons, banners, locales, and
bundled Bridge resources before atomically replacing the installed directory.
When Bridge is already installed, the same command automatically verifies,
updates, and safely restarts it. A failed Bridge restart restores the previous
Bridge runtime and rolls the plugin directory back to its previous installation.

Plugin destinations are:

```text
Windows: %APPDATA%\Ulanzi\UlanziDeck\Plugins\com.ulanzi.codexmicro.ulanziPlugin
macOS:   ~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.codexmicro.ulanziPlugin
```

Use `npm run setup -- --no-start` to install Bridge without launching Codex, or
`npm run bridge:start` to launch an existing installation.

## Codex and CDP lifecycle

Codex must be launched with:

```text
--remote-debugging-address=127.0.0.1
--remote-debugging-port=9222
--remote-allow-origins=http://127.0.0.1:9222
```

Bridge probes `127.0.0.1:9222` first. If it is already available, Launch only
focuses Codex. If it is unavailable on Windows, Launch dynamically resolves the
selected Appx package, stops only that channel's main process, and starts its
current executable with the arguments above. No versioned WindowsApps path is
stored.

CDP binds to `127.0.0.1:9222` and Bridge to `127.0.0.1:17373`. Bridge `POST`
actions require the random capability token stored in the user data directory;
the plugin reads it locally and never sends it to the Property Inspector.

## Diagnostics

Read-only health endpoints remain available on loopback:

```text
http://127.0.0.1:17373/health
http://127.0.0.1:17373/state
http://127.0.0.1:9222/json/version
http://127.0.0.1:9222/json/list
```

Windows logs can be inspected from the Ulanzi Studio plugin log and the Bridge
status page. macOS sidecar logs remain under
`~/Library/Application Support/OpenCodexMicro`.

| Symptom | Check |
| --- | --- |
| Plugin category is missing | Confirm the platform plugin directory contains `manifest.json` and `dist/app.js`, then restart Ulanzi Studio |
| Bridge is not installed | Use **Install / Repair** and confirm the user data directory contains `bridge.mjs`, `bridge-token`, and `install.json` |
| Bridge is offline | Use **Launch Codex Bridge**; on Windows confirm no endpoint security product blocked the user-level Node process |
| CDP is disconnected | Confirm Codex was launched with the three loopback arguments and `/json/version` responds |
| A task key does not switch | Confirm `/state` contains the displayed thread and the current Codex renderer still exposes Micro handlers |
| Usage is blank | Treat `rate-limit-status: null` as unavailable account data, not as a Windows transport failure |

## Update and uninstall

```text
npm install
npm run check
npm run setup
npm run install:plugin
```

`install:plugin` now reconciles an existing Bridge automatically; `setup` remains
available for first installation or an explicit repair. Restart Ulanzi Studio
after updating the plugin. Remove Bridge and the installed plugin only when
explicitly intended:

```text
npm run uninstall
```

The Windows uninstaller stops only the Bridge process whose command line points
to the installed `bridge.mjs`; it does not remove or terminate Codex Desktop.

## Development

The committed release entry points are
`integration/com.ulanzi.codexmicro.ulanziPlugin/dist/app.js` and
`integration/com.ulanzi.codexmicro.ulanziPlugin/installer/bridge.mjs`. Run the
repository verification gate after platform, installer, manifest, localization,
or build changes.
