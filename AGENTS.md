# openCodexMicro LLM Guide

This file is the repository entry point for LLMs and coding agents. It explains
what the project contains and how to route setup work through the repository's
skills.

## Project overview

openCodexMicro connects Codex Desktop to an Ulanzi Studio plugin through a
loopback-only Bridge:

```text
Codex Desktop -> Codex Bridge.app / sidecar -> Ulanzi Studio plugin -> device
```

The Ulanzi-maintained implementation scope is limited to
`integration/com.ulanzi.codexmicro.ulanziPlugin/`. The plugin consumes state
and action interfaces exposed by the existing Bridge. Ulanzi did not design,
specify, develop, or maintain CDP or Codex's CDP implementation. Read
`NOTICE.md` before making attribution or responsibility claims.

## Required setup routing

When asked to install, configure, repair, or start openCodexMicro, inspect the
installed Ulanzi Studio plugins before choosing a skill. Do not infer plugin
installation from the presence of this repository.

1. Search under:

   ```text
   ~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/
   ```

   Inspect plugin `manifest.json` files and treat Codex Micro as installed only
   when a manifest contains this exact UUID:

   ```text
   com.ulanzi.ulanzistudio.codexmicro
   ```

   Also verify that the manifest's `CodePath` exists in the same plugin
   directory. Do not rely only on the directory name.

2. If the plugin is not installed or its `CodePath` is missing, load and use
   `$install-ulanzi-studio-plugin` from
   `skills/install-ulanzi-studio-plugin/SKILL.md`. After successful installation
   and verification, continue to step 3.

3. If the plugin is already installed, or was just installed in step 2, load
   and use `$setup-codex-bridge` from `skills/setup-codex-bridge/SKILL.md`.

4. Report the plugin and Bridge verification results separately. Do not
   reinstall a valid plugin unless the user explicitly requests an update or
   repair.

Follow the authorization, application-shutdown, verification, and scope
boundaries in each selected `SKILL.md`. Do not restore or invoke the removed
Python/D200 standalone runtime.

## Key repository paths

- `integration/com.ulanzi.codexmicro.ulanziPlugin/`: prebuilt Ulanzi Studio
  plugin and its source.
- `src/bridge/`: inherited local Bridge implementation.
- `scripts/install-plugin.mjs`: atomic local plugin installer.
- `scripts/install.mjs`: Codex Bridge.app and sidecar installer.
- `LICENSE`, `NOTICE.md`, and `THIRD_PARTY_NOTICES.md`: centralized licensing,
  attribution, modification, and responsibility information.
