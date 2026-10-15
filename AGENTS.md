# OpenCodexMicro — Codex operating guide

Repository instructions for coding, review, diagnostics and installation. Run
commands from the repository root. [README.md](README.md) is the user guide for
installation, capabilities, usage and diagnostics; this file owns agent workflows
and implementation contracts.

## Start with the affected component

- Check `git status --short` and preserve existing work. Use `rg` to locate the
  relevant handler, its callers and its tests before expanding the search.
- Use source code, manifests and `package.json` to establish current behavior.
  Report any discrepancy with the documentation explicitly.
- Edit canonical sources, validate the affected behavior, and inspect the final
  diff. Report what changed, checks actually run and any unverified behavior.
- Parallelize independent investigation when useful. Keep overlapping edits,
  builds and operations on installed applications sequential.
- Documentation-only work needs path/link/command checks and `git diff --check`;
  it does not require installing components or rebuilding the application.

## Runtime map and source ownership

Ulanzi Studio owns the physical device. There are four plugins and three
background bridges. All HTTP endpoints below bind to `127.0.0.1` by default;
each developer bridge serves WebSocket `/events` on its own HTTP port.

| Component | Source and application connection | Local port | Plugin directory under `integration/` |
| --- | --- | --- | --- |
| Codex App | `src/bridge/`; Desktop renderer via CDP `127.0.0.1:9222` | `17373` | `com.ulanzi.codexmicro.ulanziPlugin/` |
| Antigravity | `src/bridge-antigravity/`; Desktop controls plus saved history/artifacts | `17374` | `com.ulanzi.antigravity.ulanziPlugin/` |
| Codex CLI | `src/bridge-codex-cli/`; managed app-server via Unix WebSocket | `17376` | `com.ulanzi.codexcli.ulanziPlugin/` |
| Spotify | Plugin-local macOS player and optional Spotify Web API | `17375` | `com.ulanzi.spotify.ulanziPlugin/` |

The Ulanzi-maintained implementation scope is limited to
`integration/com.ulanzi.codexmicro.ulanziPlugin/`. The plugins consume state
and action interfaces exposed by the existing Bridges. Ulanzi did not design,
specify, develop, or maintain CDP or Codex's CDP implementation. Read
[NOTICE.md](NOTICE.md) before making attribution or responsibility claims.
Preserve [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Do not restore or invoke the removed Python/D200 standalone runtime. Files under
`poc/` are unsupported experiments, outside the build and installation workflow.

| Task | Start here |
| --- | --- |
| Codex task discovery, routing or actions | `src/bridge/codex-cdp.mjs`, `server.mjs`, `thread-key.mjs` |
| Codex attention, approval indicators or model selection | `src/bridge/task-attention.mjs`, `model-picker.mjs`; Codex plugin `plugin/approval-state.js` |
| Antigravity live controls vs. saved history | `src/bridge-antigravity/desktop-client.mjs`, `desktop-state.mjs`, `state-reader.mjs`, `server.mjs` |
| CLI protocol, ownership, drafts or goals | `src/bridge-codex-cli/app-server-client.mjs`, `actions.mjs`, `server.mjs`; `src/shared/cli-launcher.mjs` |
| Spotify playback, catalog or credentials | Spotify plugin `plugin/spotify-local.js`, `spotify-api.js`, `app.js`; `src/shared/spotify-uri.mjs`, `storage.mjs` |
| Keys, encoders, display or settings | Affected plugin's `plugin/app.js`, `manifest.json`, `property-inspector/setup.html` and locale JSON files |
| Shared lifecycle, rendering or authentication | `src/shared/plugin-runtime.mjs`, `deck-cards.mjs`, `token-metrics.mjs`, `local-api.mjs`, `inspector-api.js`, `prompt-shortcuts.mjs` |
| Installation or removal | `scripts/install*.mjs`, `scripts/uninstall.mjs`, `src/shared/plugin-installer.mjs`, `bridge-files.mjs`; Codex plugin `plugin/bridge-installer.js` |

### Generated files

Edit `src/`, plugin `plugin/` sources and build scripts; do not patch bundles.
Bridge builds write root `dist/*.mjs`. Plugin builds write CommonJS
`dist/app.js` and `dist/package.json` despite the source packages using ESM.

The Codex App plugin build also generates `installer/bridge.mjs` and copies the
icon and root legal notices into `installer/`. The other three plugin builds
copy `src/shared/inspector-api.js` into `property-inspector/inspector-api.js`.
These copies, the Codex plugin bundle and its installer assets are tracked;
root bridge outputs and other plugins' `dist/` directories are ignored.
Build only the affected components during iteration and inspect generated
diffs before delivery. Regenerate tracked outputs when their sources change.

## Behavioral invariants

- **Exact task identity:** keep renderer task order, host assignment and
  `client-new-thread:<uuid>` aliases until promotion. Actions target the displayed
  task and expected turn; recheck selection before mutations. Preserve drafts.
- **Attention is not approval:** user questions and errors can require attention.
  Codex Approve/Reject indicators use `hasSelectedApproval` for the selected task;
  a global attention count is insufficient. Reject and Stop remain distinct.
- **No duplicate actions:** preserve required down/up pairs and never replay a
  mutation after a timeout or uncertain response. Unavailable or ambiguous
  controls must fail explicitly rather than target the foreground application.
- **State and rendering:** serve cached `/state`; do not trigger renderer
  discovery or polling from `/state` requests. Preserve context-keyed action
  instances, replay displays on reconnect, bound caches and prevent stale async renders.
- **Studio image updates:** a custom image must remain the final update for its
  action instance in a `state` batch. Do not append a `type: 0` manifest-state
  reset after a `type: 1` image; it replaces the card on Studio 3.4.4. Use the
  case-sensitive `textData` field. The current correction retains the supported
  legacy protocol; validate any later display-protocol migration against the
  supported Studio versions.
- **Metrics:** unknown stays unknown; measured zero stays zero. Do not infer
  quotas from activity or substitute cumulative tokens for context usage.
- **Platform limits:** CLI uses WebSocket framing over its Unix socket, not raw
  JSONL. Respect tasks owned by another writer. Antigravity Boost/Grill-me/Goal
  are explicitly unavailable; do not invent slash-command fallbacks.
- **Local API:** retain loopback binding, private bearer credentials, Host/Origin
  validation and bounded input. Inspector requests use the native plugin relay;
  never expose credentials in HTML, URLs or logs. Preserve Spotify URI validation,
  fixed-script arguments and last-good catalog on failed refreshes.
- **Distribution:** keep manifest UUIDs, CodePath, assets, inspectors and all eight
  locales consistent: `en`, `zh_CN`, `zh_HK`, `ja_JP`, `de_DE`, `ko_KR`, `pt_PT`, `es_ES`.

## Adapter contracts

- Displayed metadata belongs to the exact task. Unknown values must not fall back
  to another slot's metrics, model or plan. Required action press/release pairs
  remain paired; a timeout never causes automatic mutation replay.
- Codex App task/Latest cards use the latest loaded local plan for the same turn.
  A new turn clears the previous plan; remote, unloaded or missing plans stay
  unknown. CLI cards use that task/turn's structured live plan. Antigravity uses
  saved native `task.md` checklists only when at least as recent as the latest
  input; missing, stale or oversized files stay unknown. Counts include nested
  steps and measure checklist completion, not time remaining. Active work without
  a plan can show an activity segment; context keeps its separate bar.
- CLI token monitoring prefers the selected task when running, otherwise the most
  recently started running task, falling back to update time. Tokens accumulate
  for that task, independently of deck selection; they are not summed across
  tasks or reset per turn. No running task shows "No running task"; missing usage
  shows "Waiting for usage". Context and cumulative tokens remain distinct.
- Codex App/CLI execution duration includes approval and question waits, freezes
  when execution ends and resets on the next execution. CLI prefers reported turn
  start times, otherwise detection time. Locally observed App timing can be lost
  after restart or eviction from tracking.
- CLI model, reasoning and Fast settings apply to the next deck prompt, not an
  active turn. Preserve task-bound drafts and their uncertain-delivery state;
  limits and storage behavior are documented in [README](README.md#cli-sessions-and-drafts).
  Monitor instances rotate independently and select only their own displayed task.
  Stop carries its displayed turn ID; approval carries the selected pending request ID.
- CLI microphone is unavailable: thread-only realtime append/stop methods lack
  the session ownership precondition needed to protect another client's session.
  Protocol method presence alone does not establish a usable capture adapter.
- Antigravity Steer promotes one eligible message from the expanded selected-task
  queue using Send Now, preserving the composer. Missing, collapsed or ambiguous
  controls fail explicitly. Fork depends on the latest response and available
  workspace control and likewise preserves drafts.
- Codex App Goal pauses/resumes an existing goal; create objectives in Codex.
  CLI goal creation requires explicit inspector input. Antigravity Goal, Boost
  and Grill-me remain unavailable; permission modes or invented commands are not
  substitutes. Missing subagent counts remain unknown.
- Codex plan viewing requires the unique enabled native plan control; opening it
  can materialize its Markdown file but must not choose Implement or submit.
  CLI exposes read-only saved plan text/live steps and incomplete/error states;
  delayed history must not replace newer live content. Antigravity opens existing
  saved plan/walkthrough artifacts. No dedicated Codex App/CLI walkthrough opener
  is implemented.

## Development and proportional verification

Use Node.js 20+ and npm. When dependencies need installation, use the root
lockfile with `npm ci`; do not reinstall dependencies on every task. This is
JavaScript ESM with Node's test runner and esbuild; no lint/typecheck script or
tracked CI workflow is currently provided.

For source changes, start with the relevant tests below (`node --test` followed
by the listed paths), then build/check the affected plugin. Build its bridge
when bridge sources change. Shared changes require coverage of their consumers.

| Area | Targeted test paths | Plugin build, then validation |
| --- | --- | --- |
| Codex App / bridge | `test/bridge_test.mjs test/model_picker_test.mjs test/task_attention_test.mjs` | `npm run build:plugin` then `npm run check:plugin` |
| Antigravity | `test/antigravity_bridge_test.mjs test/antigravity_desktop_test.mjs` | `npm run build:antigravity:plugin` then `npm run check:antigravity:plugin` |
| Codex CLI | `test/codex_cli*_test.mjs test/cli_launcher_test.mjs` | `npm run build:codexcli:plugin` then `npm run check:codexcli:plugin` |
| Spotify | `test/spotify_test.mjs` | `npm run build:spotify:plugin` then `npm run check:spotify:plugin` |
| Shared API/runtime | `test/shared_runtime_test.mjs` plus affected component tests | Relevant plugin builds/checks above |
| Installers/removal | `test/plugin_installer_test.mjs test/bridge-installer_test.mjs test/cli_launcher_test.mjs` | Affected build/check; no real installation required |

Bridge build commands are `npm run build:bridge`, `npm run build:antigravity:bridge`
and `npm run build:codexcli:bridge`. The Codex plugin smoke suite reads its
distributed bundle, so build it before relying on that smoke result.

- `npm test` runs all root `test/*_test.mjs` files.
- `npm run check:node` checks a fixed subset; use `node --check path/to/changed.js`
  (or `.mjs`) for changed source files outside that list.
- `npm run check` is the full gate: root tests, syntax, seven builds and all four
  plugin checks/smokes. Use it for cross-component changes and release validation,
  not every small iteration. **It writes generated files.**
- Fixtures use temporary storage, mocks and local servers; some tests need
  loopback/Unix-socket access. Report sandbox restrictions separately from failures.
  Passing fixtures do not prove live app or physical deck behavior.
- Do not import runtime entrypoints to inspect them: importing
  `src/bridge/server.mjs` starts a server. Read the source or use syntax checks.

## Required setup routing

This section applies when asked to install, configure, repair or start components,
not to ordinary code or documentation review. Runtime setup requires macOS 13+,
Node.js 20+, Ulanzi Studio 3.0.1+ and the relevant application.

1. Inspect installed `manifest.json` files under
   `~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/`. Check the target
   UUID below and verify its `CodePath` exists inside that plugin directory.
   A repository checkout or matching directory name does not prove installation.
2. For Codex plugin installation use [the prebuilt procedure](#prebuilt-codex-plugin-installation);
   for its sidecar use [Codex Bridge setup](#codex-bridge-setup). Verify macOS,
   Node.js 20+ and `/Applications/Ulanzi Studio.app` before runtime setup.
3. Do not reinstall a valid plugin unless the user requests update or repair.
   If Studio is running, obtain permission before quitting it or ask the user to
   quit it. Reopen it after replacement to load the new plugin.

| Component | Manifest UUID | Plugin installation | Bridge setup |
| --- | --- | --- | --- |
| Codex App | `com.ulanzi.ulanzistudio.codexmicro` | `npm run install:plugin` | `npm run setup` |
| Antigravity | `com.ulanzi.ulanzistudio.antigravity` | `npm run install:plugin:antigravity` | `npm run setup:antigravity` |
| Spotify | `com.ulanzi.ulanzistudio.spotify` | `npm run install:plugin:spotify` | Runs inside the plugin |
| Codex CLI | `com.ulanzi.ulanzistudio.codexcli` | `npm run install:plugin:codexcli` | `npm run setup:codexcli` |

Use `npm run install:all` for all four plugins and `npm run setup:all` for all
three bridges only when that scope is requested. Installer scripts build before
preflight/replacement by default. `install:all` completes all builds/preflights
before the first replacement; rollback/backups are per plugin, not a global
transaction. Backups live outside Studio discovery in
`~/Library/Application Support/OpenCodexMicro/plugin-backups/`.

For CLI setup, verify the standalone managed daemon installation using
`src/shared/cli-launcher.mjs` and [README](README.md#starting-applications).
A plain terminal `codex` process is not necessarily attached to the shared daemon.

### Prebuilt Codex plugin installation

Require `integration/com.ulanzi.codexmicro.ulanziPlugin/manifest.json` and
`scripts/install-plugin.mjs`. Check source and installed UUID/CodePath, bundle
hashes and `dist/package.json`; matching version strings alone do not prove that
files match. Preflight the intended package:

```bash
node --input-type=module -e 'import { preflightPlugin } from "./src/shared/plugin-installer.mjs"; await preflightPlugin("integration/com.ulanzi.codexmicro.ulanziPlugin", "codexmicro");'
test -f integration/com.ulanzi.codexmicro.ulanziPlugin/dist/package.json
```

Preflight covers the entry point, inspectors, icons, eight locales and bundled
Bridge resources/notices. For a prebuilt installation, missing or stale outputs
require a development build and validation before continuing; do not silently
rebuild as part of the prebuilt-only procedure. With Studio stopped, install:

```bash
ULANZI_PREBUILT=1 npm run install:plugin
```

This updates only Codex App and retains the previous package outside discovery.
Never use the flag for stale bundles. Repeat preflight against the installed
`~/Library/Application Support/Ulanzi/UlanziDeck/Plugins/com.ulanzi.codexmicro.ulanziPlugin/`
directory and verify `dist/package.json`. Reopen Studio and check the category,
actions and live cards; switch profiles to check display restoration. Diagnose
bridge/application connectivity separately. Local installation does not authorize
marketplace publication or replacement of sibling plugins.

### Codex Bridge setup

Require `package.json`, `scripts/install.mjs`, `src/bridge/` and the executable
`/Applications/ChatGPT.app/Contents/MacOS/ChatGPT`. An authorized `npm run setup`
builds/copies the Bridge, replaces `~/Applications/Codex Bridge.app` and writes
application/LaunchAgent files, normally restarting the sidecar. It does not open
the wrapper or modify Studio plugins or Codex shortcuts. For diagnosis alone,
verify existing artifacts and health instead of running setup:

```bash
test -x "$HOME/Applications/Codex Bridge.app/Contents/MacOS/Codex Bridge"
launchctl print "gui/$(id -u)/io.opencodexmicro.bridge"
node scripts/bridge-status.mjs codex health
node scripts/bridge-status.mjs codex state
```

Use `npm run setup -- --no-start` only when the user wants the sidecar installed
but stopped; it still writes artifacts and unloads an existing service. A stopped
service intentionally fails running-health checks. `npm run bridge:start` opens
the wrapper, quits/relaunches Codex and requires a requested launch plus time for
the user to save work; never launch merely to verify installation. After an
authorized launch, recheck `connected`; if false, inspect the component error log
and confirm the wrapper was used. Keep CDP at `127.0.0.1:9222` and the sidecar at
`127.0.0.1:17373`.

### Diagnostics and completion

Use `node scripts/bridge-status.mjs <component> health` or `state`, with
`codex`, `antigravity`, `codex-cli` or `spotify`. This supplies authentication;
old bare `curl` examples return 403. Spotify diagnostics use `/status` internally.
The helper may create a missing local token and adjust private file permissions;
do not run it for a strictly static review or print credential files.

Report separately: plugin manifest/files, bridge/service health, application
connection, and any observed Studio/device behavior. Inspect component logs under
`~/Library/Application Support/OpenCodexMicro/{codex,antigravity,codex-cli}/`.
For authentication changes, update matching plugin and bridge versions together.
For static or apparently stale cards after a Studio update, follow
[card display diagnostics](README.md#static-or-apparently-outdated-cards).
Compare installed bundles with the intended build; matching version strings do
not establish matching files. A plugin-only display fix does not require bridge
setup or profile recreation. Record visual Studio checks separately from physical
device acceptance, using [recorded validation](README.md#recorded-validation)
as evidence with a date and scope, not a guarantee of current runtime health.
Do not use personal tasks for live Approve/Reject/Stop/Submit, goals or microphone
tests; use deliberately selected disposable tasks within the authorized scope.
See [capabilities](README.md#capabilities-and-limits) and the live checks below.

Run removal only when explicitly requested: `npm run uninstall` removes Codex App
and its bridge; `npm run uninstall:all` removes all project components. Preserve
sibling runtimes, backups and unrelated files during component work.

## Live validation

Installed files, fixtures, services and Studio previews do not prove physical
hardware or mutation behavior. Use deliberately selected disposable tasks within
the authorized scope; do not approve/reject/stop personal work, submit fabricated
objectives or record audio merely to complete a checklist.

| Area | Required controlled observation |
| --- | --- |
| Keys and encoders | The intended task opens and the correct viewport/task list moves on actual hardware. |
| Approve, Reject and Stop | Only the intended request/turn changes, once. |
| Drafts, Submit and Steer | Drafts survive and sent/promoted content belongs to the intended task, using each adapter's distinct steering behavior. |
| New and Fork | One new/forked task appears in the intended workspace; unavailable controls fail explicitly. |
| Model, reasoning and Fast | The correct task or next prompt reflects the supported setting. |
| Plans and subagents | The selected task's available native view/read-only content appears; missing/incomplete data is identified. |
| Goals | Explicit creation or a supported toggle affects only the intended task. |
| Microphone | Deliberate initiation, permission, recording indication, task binding and stop work on supported applications; CLI stays unavailable. |
| Spotify | Playback, picker, volume and optional catalog/Like actions affect the intended player/account; playback/authentication failures are surfaced. |
| Reconnect and restart | Compatible installed builds reconnect and restore displays; reboot persistence needs a separate observation. |

Record installed versions, observed results and unverified behavior. Repeat the
relevant observations after changes to the app, Studio, firmware or installation.
Keep dated evidence in [README](README.md#recorded-validation) separate from claims
about current runtime health.

## Documentation ownership

Keep user-facing overview, installation, operation, capabilities, diagnostics and
validation records in [README.md](README.md). Keep agent workflows, source maps,
implementation invariants and development checks here. Update these two guides
when contracts change; do not create parallel operational Markdown guides or
standalone installation skills. Preserve legal notices and their required
installer copies as separate distribution files.
