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
Bridge Setup** page, choose **Install / Repair**. **Launch Codex Bridge** remains
available for manual startup and diagnostics, but it is not required before each
Task press.
The bundled installer requires no repository path, npm directory, or fixed Codex
package version. On Windows, **Install / Repair** requests administrator approval
once to register or update a highest-privilege on-demand scheduled task. Normal
Bridge starts are silent and do not display UAC again.

Initial Bridge installation remains an explicit setup action. After that, every
plugin startup compares the bundled version and SHA-256 with both the installed
runtime and the identity reported by the running Bridge. Windows code updates are
deferred to the next explicit **Install / Repair** action because replacing
administrator-protected code requires UAC; ordinary offline restarts remain
silent. An approved update changes only the managed Bridge files, restarts that
Bridge process, and waits for the new process to report the expected build; Codex
Desktop is not terminated.
Interrupted updates restore both runtime and metadata backups and retry once in
the same lifecycle operation. Other transient startup failures use three bounded
background retries with backoff while Ulanzi Studio remains open.

After Bridge is installed and current, pressing a configured Task key while
ChatGPT/CDP is unavailable invokes the same launch path automatically. The plugin
waits for Bridge state to reconnect before resolving the displayed slot and
requesting navigation. This automatic path does not use a desktop shortcut and
does not store a versioned `WindowsApps` executable path.

Windows installs Bridge data under:

```text
%LOCALAPPDATA%\OpenCodexMicro
```

The capability token and active runtime metadata remain in that user directory.
Executable copies used by the highest-privilege task are hash-addressed and
administrator-protected under:

```text
%PROGRAMDATA%\OpenCodexMicro\Bridge
```

The on-demand task is named `OpenCodexMicro Codex Bridge`, has no trigger, is
restricted to the current interactive user, and uses `RunLevel Highest`. Its
definition contains protected paths and hashes but never the capability token.
The Ulanzi plugin starts and stops that task silently. The
launcher reads Appx metadata for `OpenAI.Codex` and `OpenAI.CodexBeta`, preferring
Stable unless `CODEX_DESKTOP_CHANNEL=beta` is configured.

macOS keeps the wrapper and LaunchAgent flow:

```text
~/Applications/Codex Bridge.app
~/Library/Application Support/OpenCodexMicro
~/Library/LaunchAgents/io.opencodexmicro.bridge.plist
```

## Install from the repository

From `plugins/codex-console`:

```text
npm install
npm run install:plugin
npm run setup
```

Quit Ulanzi Studio before replacing a loaded plugin. `install:plugin` validates
the manifest, entry point, Property Inspector, icons, banners, locales, and
bundled Bridge resources before atomically replacing the installed directory.
When Bridge is already installed, the same command verifies it and, when Bridge
code changed, requests one administrator confirmation to update the protected
runtime before safely restarting it. A failed Bridge restart restores the
previous Bridge runtime and rolls the plugin directory back to its previous
installation.

The Windows elevated helper restores the machine-level Windows PowerShell module
path before loading `Microsoft.PowerShell.Security`, so an inherited PowerShell 7
module path cannot shadow the system `Set-Acl` implementation. If the repository
installer is already elevated, it executes the protected transaction directly
instead of requesting a redundant second elevation.

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
stored. A Task key uses this same behavior when the cached Bridge state is
disconnected, then polls for readiness for up to approximately six seconds.

Task navigation and native window focus run concurrently, but the request returns
success only after both postconditions hold. Bridge confirms the target thread
from the composer/sidebar state after native Micro dispatch, uses a bounded DOM
fallback when needed, and treats either final activation or foreground failure as
an HTTP error. The plugin logs a redacted failure category and shows an alert; it
does not report partial success or replay an uncertain write.

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
| Bridge is offline | Press a configured Task key once or use **Launch Codex Bridge**; on Windows verify the `OpenCodexMicro Codex Bridge` task exists and reports `HighestAvailable` |
| CDP is disconnected | A Task key should dynamically relaunch the current Appx channel; if it still fails, confirm the three loopback arguments and `/json/version` |
| A task key does not switch or focus | Confirm `/state` contains the displayed thread, then inspect the redacted trace for `task.verify-final` and `focus.complete`; success requires both |
| Usage is blank | Treat `rate-limit-status: null` as unavailable account data, not as a Windows transport failure |

## Update and uninstall

```text
npm install
npm run check
npm run setup
npm run install:plugin
```

`install:plugin` reconciles an existing Bridge; Windows asks for administrator
approval only when protected Bridge code must be installed or updated. `setup`
remains available for first installation or an explicit repair. Restart Ulanzi
Studio after updating the plugin. Remove Bridge and the installed plugin only
when explicitly intended:

```text
npm run uninstall
```

The Windows uninstaller stops the managed scheduled task, verifies that the
loopback Bridge is offline, requests administrator approval to remove the task
and protected runtime, and then removes user data. It does not remove or
terminate Codex Desktop.

## Development

The committed release entry points are
`integration/com.ulanzi.codexmicro.ulanziPlugin/dist/app.js` and
`integration/com.ulanzi.codexmicro.ulanziPlugin/installer/bridge.mjs` plus
`installer/elevated-launcher.mjs`. Run the
repository verification gate after platform, installer, manifest, localization,
or build changes.
