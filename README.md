# OpenCodexMicro

**Control Codex Desktop from an Ulanzi D200 Series through Ulanzi Studio.**

[中文说明](README_zh.md)

OpenCodexMicro exposes Codex's live Micro state through a loopback Bridge and
turns it into a native Ulanzi Studio plugin. It shows recent tasks, switches to
the exact task displayed on a key, and provides Fast, Usage, Pin, New, Fork,
Steer, Mic, Submit, and Latest Task & Scroll Encoder actions.

![OpenCodexMicro on an Ulanzi D200 Series](docs/images/codex-keyboard-hero.png)

## What it does

| Feature | Behavior |
| --- | --- |
| Five live task actions | Show Codex's Most Recent tasks with idle, working, complete, attention, or error state |
| Exact task switching | Route the selected thread through Codex's own Micro event bus |
| Codex controls | Fast, Usage, Pin, New, Fork, Steer, Mic, and Submit |
| Encoder navigation | Press to open task 1; turn left/right to scroll up/down through Ulanzi Studio's hotkey protocol |
| Live usage | Draw the remaining Codex allowance directly on the key; press to return to Codex |
| Ulanzi Studio integration | Let Ulanzi Studio own the device and manage the key layout |
| Local-only transport | Bind CDP and the Bridge API to loopback addresses only |

This Ulanzi-maintained project is an unofficial integration with Codex Desktop
for **Windows or macOS, Ulanzi Studio, and Ulanzi D200 Series**. It is not
affiliated with or endorsed by OpenAI.

Ulanzi's implementation and maintenance scope is limited to
`integration/com.ulanzi.codexmicro.ulanziPlugin/`. The plugin only consumes
state and action interfaces exposed through the existing local Bridge; Ulanzi
did not participate in the design, specification, development, or maintenance
of CDP or Codex's CDP implementation. See [NOTICE.md](NOTICE.md) for the full
responsibility boundary.

## Installation

### Installation environment

- Windows 10 or later, or macOS 13 or later;
- Codex Desktop Stable or Beta;
- Ulanzi Studio 3.0.1 or later;
- Ulanzi D200 Series connected to Ulanzi Studio;
- Node.js 20 or newer only for repository-based manual installation.

### 1. LLM / Agent installation

An LLM or coding agent must follow these steps:

1. Read [AGENTS.md](AGENTS.md) and inspect the installed Ulanzi Studio plugin
   manifests under `%APPDATA%\Ulanzi\UlanziDeck\Plugins` on Windows or
   `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins` on macOS.
2. Treat Codex Micro as installed only when manifest UUID
   `com.ulanzi.ulanzistudio.codexmicro` is present and its `CodePath` exists.
3. If it is missing or invalid, load
   [`$install-ulanzi-studio-plugin`](skills/install-ulanzi-studio-plugin/SKILL.md),
   install the plugin, and verify its manifest and entry point.
4. After the plugin is verified, load
   [`$setup-codex-bridge`](skills/setup-codex-bridge/SKILL.md), install or repair
   Codex Bridge and its sidecar, and verify the local health endpoint.
5. Report plugin installation and Bridge connectivity separately. Do not
   reinstall a valid plugin unless an update or repair was requested.

### 2. Install Bridge from Ulanzi Studio

After installing the Codex Micro plugin, drag any Codex Micro action onto a
key and select it. Its shared **Codex Bridge Setup** page can:

- show whether Codex Bridge, its user-level service, and CDP are available;
- install or repair the bundled Bridge without a repository or npm directory;
- launch Codex with loopback-only CDP arguments; and
- recheck the connection or open the full installation guide.

The installer uses `%LOCALAPPDATA%\OpenCodexMicro` on Windows. On macOS it uses
the current user's Applications, Application Support, and LaunchAgents
directories. Neither path requires administrator access.

### 3. Manual installation

```bash
git clone https://github.com/UlanziTechnology/OpenCodexMicro.git
cd OpenCodexMicro
npm install
npm run install:plugin
npm run setup
```

Quit Ulanzi Studio before running `npm run install:plugin`. The command
validates and atomically installs the prebuilt plugin. If Bridge is already
installed, the command also verifies its version and runtime hash, then safely
updates and restarts it when needed. `npm run setup` performs the initial Bridge
installation or an explicit repair.

Reopen Ulanzi Studio and use **Launch Codex Bridge** in any Action setup page,
or run `npm run bridge:start`. On Windows the launcher discovers the current
Stable or Beta Appx package dynamically; it never pins a versioned WindowsApps
directory. Confirm the connection with:

```bash
curl http://127.0.0.1:17373/health
curl http://127.0.0.1:17373/state
```

In Ulanzi Studio, drag the Codex Micro actions onto the desired keys. See
[Setup and operations](docs/setup-and-operations.md) for installed paths,
diagnostics, updates, and uninstall instructions.

> **Important:** Codex must be started with the loopback CDP arguments shown in
> the setup page. If `9222` is already available, Launch only focuses the current
> Codex instance; otherwise it starts the configured Stable or Beta channel.

## Configure

The physical layout is managed in Ulanzi Studio. The plugin ships these
actions: Codex Task 1–5, Fast, Usage, Pin, New, Fork, Steer, Mic, Submit, and
Latest Task & Scroll for Encoder controls.
No separate device daemon or shortcut mapping is required.

Select any configured action to open the shared **Codex Bridge Setup** page.
It shows Bridge installation, service, and CDP status and provides Install /
Repair and Launch controls.

On macOS, enable Ulanzi Studio in **System Settings > Privacy & Security >
Accessibility** so Encoder rotation can send mouse-wheel events.

See [Configuration](docs/configuration.md) for action behavior and layout
guidance.

The repository includes two reusable Codex skills:

| Skill | Purpose |
| --- | --- |
| [`setup-codex-bridge`](skills/setup-codex-bridge/SKILL.md) | Install, update, verify, or repair Codex Bridge and its sidecar |
| [`install-ulanzi-studio-plugin`](skills/install-ulanzi-studio-plugin/SKILL.md) | Install the repository's prebuilt plugin directory into Ulanzi Studio |

## Documentation

- [Configuration](docs/configuration.md)
- [Setup and operations](docs/setup-and-operations.md)
- [Architecture](docs/architecture.md)
- [Engineering constraints](docs/errors.md)

## License

Project-authored code is released under the [MIT License](LICENSE). See the
[modification and responsibility notice](NOTICE.md) for upstream attribution,
material changes, Ulanzi maintainership, independence from OpenAI, and
responsibility boundaries. Bundled and build-time dependencies are documented in
[third-party notices](THIRD_PARTY_NOTICES.md).
