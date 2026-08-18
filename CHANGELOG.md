# Changelog

## Unreleased

### Changed

- Make the Ulanzi Studio plugin the only device integration.
- Reduce setup to two explicit operations: install `Codex Bridge.app`, then
  install the `.ulanziPlugin` directory into Ulanzi Studio.
- Commit the prebuilt plugin output and keep installation limited to validating
  and atomically copying the plugin directory.
- Replace the previous skills with focused Bridge setup and Ulanzi Studio
  plugin installation skills.
- Preserve upstream attribution, declare the fork's material changes and
  responsibility boundaries, and centralize project and third-party license
  notices at the repository root.
- Define Ulanzi's maintained component as the plugin directory only, and record
  that the plugin consumes existing Bridge/CDP-facing interfaces without
  participating in CDP design, specification, development, or maintenance.
- Add a repository-level LLM guide that detects the installed plugin by
  manifest UUID, routes missing plugins through the plugin-install skill, and
  routes verified installations through the Bridge-setup skill.

### Removed

- Remove the standalone device runtime, its installer, dependencies, tests,
  configuration, documentation, and maintenance skills.

## 0.3.1 — 2026-07-31

### Changed

- Route Fast, Pin, New, Fork, Mic, Steer, and Submit through the renderer
  Bridge. Micro actions preserve press/release events; Pin and New invoke their
  semantic renderer controls.
- Suppress action replay after uncertain Bridge failures.
- Wait up to 30 seconds for a cold Codex Bridge launch.
- Cache renderer Micro references and refresh state snapshots every 500 ms.
