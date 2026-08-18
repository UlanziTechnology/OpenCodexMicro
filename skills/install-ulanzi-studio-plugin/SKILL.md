---
name: install-ulanzi-studio-plugin
description: Install, update, verify, or diagnose the repository's prebuilt Codex Micro .ulanziPlugin directory in Ulanzi Studio on macOS. Use for local Ulanzi Studio plugin installation, not plugin development or Codex Bridge.app setup.
---

# Install the Ulanzi Studio Plugin

Resolve the project root as two directories above this file. Require
`integration/com.ulanzi.codexmicro.ulanziPlugin/manifest.json` and
`scripts/install-plugin.mjs`; otherwise ask for the OpenCodexMicro checkout.

## Workflow

1. Inspect `git status --short`, the plugin `manifest.json`, and its committed
   `CodePath`. Preserve unrelated worktree changes.
2. Verify macOS, Node.js 20+, and `/Applications/Ulanzi Studio.app`.
3. If Ulanzi Studio is running, ask the user to quit it before replacing the
   loaded plugin. Do not terminate the app without permission.
4. From the project root, run:

   ```bash
   npm run install:plugin
   ```

   The installer validates the prebuilt manifest entry point, then atomically
   replaces the installed directory. It must not rebuild the plugin during
   installation.
5. Verify:

   ```bash
   plugin="$HOME/Library/Application Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.codexmicro.ulanziPlugin"
   test -f "$plugin/manifest.json"
   test -f "$plugin/dist/app.js"
   test -f "$plugin/dist/package.json"
   for locale in en zh_CN zh_HK ja_JP de_DE ko_KR pt_PT es_ES; do
     test -f "$plugin/$locale.json"
   done
   ```

6. Ask the user to reopen Ulanzi Studio and confirm that the **Codex Micro**
   category and actions appear. If actions show offline, verify the Bridge with
   `curl --fail http://127.0.0.1:17373/state` and use the
   `$setup-codex-bridge` skill if Bridge repair is requested.

## Boundaries

- Install only `com.ulanzi.codexmicro.ulanziPlugin`; do not alter other Ulanzi
  Studio plugins.
- Preserve the previous installed directory until the replacement is ready.
- Do not publish or submit the plugin to a marketplace as part of local
  installation.
