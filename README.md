# OpenCodexMicro

**Control Codex Desktop from an Ulanzi D200 Series through Ulanzi Studio.**

[中文说明](README_zh.md)

OpenCodexMicro exposes Codex's live Micro state through a loopback Bridge and
turns it into a native Ulanzi Studio plugin. It shows recent tasks, switches to
the exact task displayed on a key, and provides Fast, Usage, Pin, New, Fork,
Steer, Mic, and Submit actions.

![OpenCodexMicro on an Ulanzi D200 Series](docs/images/codex-keyboard-hero.png)

## What it does

| Feature | Behavior |
| --- | --- |
| Five live task actions | Show Codex's Most Recent tasks with idle, working, complete, attention, or error state |
| Exact task switching | Route the selected thread through Codex's own Micro event bus |
| Codex controls | Fast, Usage, Pin, New, Fork, Steer, Mic, and Submit |
| Live usage | Draw the remaining Codex allowance directly on the key; press to return to Codex |
| Ulanzi Studio integration | Let Ulanzi Studio own the device and manage the key layout |
| Local-only transport | Bind CDP and the Bridge API to loopback addresses only |

This Ulanzi-maintained project is an unofficial integration with Codex Desktop
for **macOS, Ulanzi Studio, and Ulanzi D200 Series**. It is not affiliated with or
endorsed by OpenAI. The entire project was vibe-coded with Codex.

Ulanzi's implementation and maintenance scope is limited to
`integration/com.ulanzi.codexmicro.ulanziPlugin/`. The plugin only consumes
state and action interfaces exposed through the existing local Bridge; Ulanzi
did not participate in the design, specification, development, or maintenance
of CDP or Codex's CDP implementation. See [NOTICE.md](NOTICE.md) for the full
responsibility boundary.

## Install

Requirements:

- macOS with Codex Desktop and Ulanzi Studio installed;
- Ulanzi D200 Series connected to Ulanzi Studio;
- Node.js 20 or newer.

Clone the repository, then complete these two steps.

### 1. Set up Codex Bridge.app

```bash
npm install
npm run setup
```

This builds the loopback Bridge sidecar, registers its user LaunchAgent, and
installs `Codex Bridge.app` in `~/Applications`.

### 2. Install the Ulanzi Studio plugin

```bash
npm run install:plugin
```

The repository includes the prebuilt plugin. This command only installs
`com.ulanzi.codexmicro.ulanziPlugin` under Ulanzi Studio's local plugin
directory; it does not rebuild during installation. Restart Ulanzi Studio
after installation.

Quit Codex and open `~/Applications/Codex Bridge.app`. The wrapper starts
Codex with a loopback-only CDP endpoint. Confirm the connection with:

```bash
curl http://127.0.0.1:17373/health
curl http://127.0.0.1:17373/state
```

In Ulanzi Studio, drag the Codex Micro actions onto the desired keys. See
[Setup and operations](docs/setup-and-operations.md) for installed paths,
diagnostics, updates, and uninstall instructions.

## Configure

The physical layout is managed in Ulanzi Studio. The plugin ships these
actions: Codex Task 1–5, Fast, Usage, Pin, New, Fork, Steer, Mic, and Submit.
No separate device daemon or shortcut mapping is required.

See [Configuration](docs/configuration.md) for action behavior and layout
guidance, and [CHANGELOG.md](CHANGELOG.md) for release notes.

The repository includes two reusable Codex skills:

| Skill | Purpose |
| --- | --- |
| [`setup-codex-bridge`](skills/setup-codex-bridge/SKILL.md) | Install, update, verify, or repair `Codex Bridge.app` and its sidecar |
| [`install-ulanzi-studio-plugin`](skills/install-ulanzi-studio-plugin/SKILL.md) | Install the repository's prebuilt plugin directory into Ulanzi Studio |

## LLM and coding-agent setup

LLMs and coding agents must read [AGENTS.md](AGENTS.md) before setup. The
required flow first searches the installed Ulanzi Studio plugins for the Codex
Micro manifest UUID. If it is missing, use `$install-ulanzi-studio-plugin` and
verify the installation; then use `$setup-codex-bridge`. If the plugin is
already installed, go directly to `$setup-codex-bridge` without reinstalling
the plugin.

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
