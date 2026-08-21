---
name: setup-codex-bridge
description: Install, update, verify, diagnose, or remove OpenCodexMicro's local Codex Bridge on Windows or macOS. Use for Bridge setup and lifecycle, not Ulanzi Studio plugin installation.
---

# Setup Codex Bridge

Resolve the project root as two directories above this file. Require
`package.json`, `scripts/install.mjs`, and `src/bridge/`; otherwise ask for the
OpenCodexMicro checkout.

## Workflow

1. Inspect `git status --short`, `package.json`, and the current Bridge state.
   Preserve unrelated worktree changes.
2. Verify Windows 10+ or macOS 13+, Node.js 20+, and an installed Codex Desktop.
   On Windows, discover `OpenAI.Codex` or `OpenAI.CodexBeta` through Appx package
   metadata; never pin a versioned `WindowsApps` path.
3. Install or update the Bridge:

   ```bash
   npm install
   npm run setup
   ```

   Use `npm run setup -- --no-start` only when the user explicitly wants the
   sidecar installed but stopped.
4. Verify the installed artifacts and service. Windows stores Bridge data under
   `%LOCALAPPDATA%\OpenCodexMicro`; macOS uses
   `~/Library/Application Support/OpenCodexMicro` and a user LaunchAgent.

   ```bash
    curl --fail http://127.0.0.1:17373/health
   ```

5. Do not launch Codex merely to verify installation. Applying CDP arguments may
   restart the selected Codex channel; do so only when the user asks and has had
   a chance to save current work.
6. When launched, verify `/state` and report whether `connected` is true. If it
   is false, inspect `bridge-error.log` and confirm Codex was opened through the
   Bridge launcher.

## Boundaries

- Keep CDP at `127.0.0.1:9222` and the sidecar at `127.0.0.1:17373`.
- Do not create version-pinned Codex shortcuts or modify Ulanzi Studio plugins in this skill.
- Run `npm run uninstall` only when the user explicitly requests removal; it
  also removes the installed Codex Micro plugin.
