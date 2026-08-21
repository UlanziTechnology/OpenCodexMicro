# Architecture

OpenCodexMicro uses Ulanzi Studio as the only device owner.

```text
Codex renderer Micro store
  ├─ local and SSH tasks
  ├─ Most Recent order, status, and selection
  └─ thread -> project and host assignment
                    |
             loopback CDP snapshot
                    |
        Bridge sidecar (127.0.0.1:17373)
                    |
          Ulanzi Studio Node plugin
                    |
             Ulanzi keypad device
```

## Codex Bridge

Codex Bridge launches the real Codex executable with CDP restricted to
`127.0.0.1:9222`. Windows discovers Stable or Beta through Appx metadata and the
Ulanzi plugin supervises the user-level sidecar; macOS retains the wrapper app
and user LaunchAgent. The sidecar keeps a persistent renderer connection and
refreshes an in-memory snapshot every 500 ms. `/state` reads that cache rather
than triggering a fresh renderer scan for every plugin poll.

The initial discovery locates Codex's Micro store, event bus, resolver,
context map, and usage query clients. Those references are cached for the
renderer lifecycle and rediscovered only when they become invalid.

Task activation and Fast, Fork, Submit, and Mic use Codex Micro events. Pin,
New, Steer, and the three model presets invoke semantic renderer controls. The
model adapter requires the visible intelligence trigger, validates the exact
model option and reasoning-effort ordering, and verifies the final selection.
An uncertain HTTP failure is never replayed through another mechanism because
the first request may already have executed.

## Ulanzi Studio plugin

The plugin is a Node.js JavaScript plugin using protocol V3.0.0. It polls the
Bridge state, keeps each Ulanzi action instance keyed by its context, updates
task icons and titles, and forwards keydown/keyup events to the Bridge.

The distributed entry point is the committed CommonJS file `dist/app.js`.
Build and smoke checks happen during development; `scripts/install-plugin.mjs`
only validates and atomically copies the prebuilt `.ulanziPlugin` directory.

Ulanzi's implementation and maintenance scope is limited to
`integration/com.ulanzi.codexmicro.ulanziPlugin/`. The plugin is only the
receiving/consuming side of state and action interfaces made available through
the existing Bridge. Ulanzi did not participate in the design, specification,
development, or maintenance of CDP or Codex's CDP implementation.

## Installation boundary

- `scripts/install.mjs` installs only the Bridge sidecar and
  its platform-specific user-level launcher/lifecycle files.
- `scripts/install-plugin.mjs` installs only the Ulanzi Studio plugin directory.
- `scripts/uninstall.mjs` removes those two installed components.
