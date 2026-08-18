---
name: setup-codex-bridge
description: Install, update, verify, diagnose, or remove openCodexMicro's Codex Bridge.app and loopback sidecar on macOS. Use when the request concerns Bridge setup or its local LaunchAgent, not Ulanzi Studio plugin installation.
---

# Setup Codex Bridge

Resolve the project root as two directories above this file. Require
`package.json`, `scripts/install.mjs`, and `src/bridge/`; otherwise ask for the
openCodexMicro checkout.

## Workflow

1. Inspect `git status --short`, `package.json`, and the current Bridge state.
   Preserve unrelated worktree changes.
2. Verify macOS, Node.js 20+, and
   `/Applications/ChatGPT.app/Contents/MacOS/ChatGPT`.
3. Install or update the Bridge:

   ```bash
   npm install
   npm run setup
   ```

   Use `npm run setup -- --no-start` only when the user explicitly wants the
   sidecar installed but stopped.
4. Verify the installed artifacts and service:

   ```bash
   test -x "$HOME/Applications/Codex Bridge.app/Contents/MacOS/Codex Bridge"
   launchctl print "gui/$(id -u)/io.opencodexmicro.bridge"
   curl --fail http://127.0.0.1:17373/health
   ```

5. Do not launch `Codex Bridge.app` merely to verify installation. Launching it
   quits any running Codex instance; do so only when the user asks and has had
   a chance to save current work.
6. When launched, verify `/state` and report whether `connected` is true. If it
   is false, inspect `bridge-error.log` and confirm Codex was opened through the
   wrapper app.

## Boundaries

- Keep CDP at `127.0.0.1:9222` and the sidecar at `127.0.0.1:17373`.
- Do not modify Codex shortcuts or Ulanzi Studio plugins in this skill.
- Run `npm run uninstall` only when the user explicitly requests removal; it
  also removes the installed Codex Micro plugin.
