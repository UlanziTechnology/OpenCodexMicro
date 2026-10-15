# OpenCodexMicro

Control Codex Desktop, Codex CLI, Antigravity Desktop and Spotify from an Ulanzi
D200 Series keypad through Ulanzi Studio.

![OpenCodexMicro on an Ulanzi D200 Series](docs/images/ulanzi-deck-showcase.jpg)

This README covers installation, use and diagnostics. [AGENTS.md](AGENTS.md)
contains source ownership, development checks and agent installation procedures.

## Components

Ulanzi Studio owns the physical device. Four native plugins use local interfaces:

| Plugin | Connection | Main capabilities |
| --- | --- | --- |
| Codex App | Bridge `127.0.0.1:17373`; Desktop CDP `127.0.0.1:9222` | Six task keys, usage and selected-task controls |
| Codex CLI | Bridge `127.0.0.1:17376`; managed app-server over a Unix WebSocket | Six task keys, approvals, drafts, next-prompt settings and plans |
| Antigravity | Desktop bridge `127.0.0.1:17374` | Six session keys, desktop controls, history and saved artifacts |
| Spotify | Plugin-local API `127.0.0.1:17375` | Playback, artwork, ten music slots, volume and optional Web API catalog/library access |

The three developer bridges serve WebSocket `/events` on their HTTP port.
Local APIs require private credentials; use the diagnostic helper below.

## Install or update

Requires macOS 13+, Node.js 20+, Ulanzi Studio 3.0.1+, an Ulanzi D200 Series deck
and the applications for the selected plugins. The display correction was visually
verified in Studio 3.4.4; see [recorded validation](#recorded-validation).

Install only the components you need, running commands from the repository root:

| Component | Plugin installation | Bridge setup |
| --- | --- | --- |
| Codex App | `npm run install:plugin` | `npm run setup` |
| Antigravity | `npm run install:plugin:antigravity` | `npm run setup:antigravity` |
| Codex CLI | `npm run install:plugin:codexcli` | `npm run setup:codexcli` |
| Spotify | `npm run install:plugin:spotify` | Runs inside the plugin |

For a fresh installation of all four plugins and all three bridges, quit Studio:

```bash
npm ci
npm run install:all
npm run setup:all
```

Reopen Studio afterward. Plugin installers build and preflight before replacement;
no separate build is needed for normal repository installation. Reuse a valid
dependency installation; run `npm ci` when dependencies need installation or
synchronization with the root lockfile. Development changes require the checks in
[AGENTS.md](AGENTS.md#development-and-proportional-verification) before installation.

Quit Studio before replacing plugins; an agent needs your authorization to quit
it. Previous packages are retained under
`~/Library/Application Support/OpenCodexMicro/plugin-backups/`, outside Studio's
plugin discovery directory. Profiles are preserved. Update plugins and bridges
together when authentication or their API contract changes. A plugin-only display
correction can reuse a healthy, compatible bridge.

### Starting applications

Codex Desktop: launch `~/Applications/Codex Bridge.app` when its local debugging
endpoint is not enabled. The wrapper quits and relaunches Codex, so save work
first. Setup installs/restarts the sidecar but does not open the wrapper; do not
launch it merely to verify installation. For a deliberately stopped sidecar,
see [agent setup procedures](AGENTS.md#codex-bridge-setup).

Antigravity: open Antigravity Desktop for live controls. The bridge requires one
matching desktop page and rejects ambiguous targets. Saved history can remain
available without a live desktop connection; VS Code history alone does not
provide live controls.

Codex CLI: install the official standalone managed app-server first. This project
was verified against CLI 0.154.0; the npm-only CLI package does not provide that
daemon. See the [official installer documentation](https://learn.chatgpt.com/docs/config-file/environment-variables#installation-variables).
The bridge launcher runs the idempotent `codex app-server daemon start`. Attach
terminals to the same daemon:

```bash
~/.codex/packages/standalone/current/bin/codex --remote unix://
```

Use that explicit path when an npm CLI is also on `PATH`. A plain `codex`
terminal can use a separate server; see [CLI sessions and drafts](#cli-sessions-and-drafts).

## Configure and use

Place actions on keys and encoders in Studio. The developer plugins have six
task/session slots; select the intended task before using its controls. Attention
includes questions and errors and does not establish approval readiness. Approve
and Reject refer to the selected task's pending request; Stop is a separate action.

Unknown metrics stay unknown and measured zero stays zero. Context usage differs
from cumulative tokens. Plan progress counts checklist steps, not elapsed time or
remaining work. Codex App and CLI cards show selection and execution duration;
timing freezes when execution ends and can lose locally observed history after a
restart. Adapter-specific rendering and action contracts are in
[AGENTS.md](AGENTS.md#adapter-contracts).

### Capabilities and limits

Matching action names do not guarantee equivalent behavior:

| Capability | Codex App | Codex CLI | Antigravity |
| --- | --- | --- | --- |
| Six task keys | Native task identity and selection | Paginated daemon tasks; dial navigation | Exact sidebar conversation selection |
| Status and model | Native application state | Selected daemon task, including ownership errors | Selected desktop task plus saved history |
| Task monitor | Rotate through active tasks; press to open the displayed task | Rotate through known active/attention tasks across pages; press to select the displayed task | Selected desktop task |
| Tokens and context | Reported metrics; unknown capacity stays unknown | Protocol metrics; cumulative tokens are not context usage | Transcript token estimates; missing capacity stays unknown |
| Five-hour and weekly usage | Application/account state | App-server quota windows | Only explicitly labeled, valid quota windows |
| New and Fork | Native task creation and Micro fork control | `thread/start` and `thread/fork` | Desktop controls; fork depends on the latest response and available workspace control |
| Approve and Reject | One native dispatch for the selected task | Method-specific, task-bound pending request | Unique enabled control in the selected conversation |
| Stop | Unique enabled native Stop control | Exact active `turn/interrupt` | Composer cancel or selected sidebar Stop execution |
| Attention navigation | Tasks requiring attention | Unique tasks with approvals, protocol-reported questions or errors | Conversations requiring feedback |
| Submit | Current application composer | Task-bound inspector draft, persisted across bridge restarts | Selected desktop composer |
| Steer | Native Steer action on the current composer | Task-bound draft and expected active turn ID | Promote one eligible message from the expanded selected-task queue using Send Now; preserve the composer |
| Test, review and commit-message prompts | Preserve existing draft | Typed turn request | Preserve draft and recheck selected conversation |
| Model and reasoning | Cycle native available options and confirm the selected task's value | Settings for the next prompt sent from the deck | Native model menu and supported reasoning choices |
| Fast | Native Micro control | Next deck prompt's service tier, when supported | No verified equivalent; Boost is unavailable |
| Pin | Native task control | No supported pin interface | Selected sidebar pin control |
| Encoder | Task-scoped native joystick/scroll | Task navigation; no terminal scroll or focus | Selected conversation viewport |
| Microphone | Native microphone control | Unavailable; no capture adapter | Native desktop microphone control |
| Plan and walkthrough | Open the selected task's existing native plan side panel; no dedicated walkthrough opener | Read-only inspector for saved native plan text and live checklist; no walkthrough opener | Open existing saved plan/walkthrough artifacts |
| Subagents | Native selected-task summary/open control, otherwise unknown | Exact parent-thread listing with bounded pagination | History/state summary |
| Goal | Pause/resume an existing goal | Explicit inspector objective creation and active/paused goal toggle | No verified equivalent |
| Grill-me | No dedicated action | No dedicated action | Unavailable |
| Inspector | Bridge installer/status | Ownership, errors, drafts, next-prompt settings, plans and goal input | Bridge/desktop connectivity and task errors |

Spotify controls local playback, track navigation, shuffle, repeat and volume
through macOS automation, which may require permission. Keys show track metadata
and artwork, and the picker opens saved Spotify links. Optional OAuth enables
Web API catalog synchronization and saving the current track. Manual links remain
separate from imported entries; a failed refresh preserves the last usable catalog.
Check the component's reported error before changing system permissions.

### CLI sessions and drafts

Recent CLI sessions refresh every three seconds without changing selection.
Running tasks and tasks needing attention keep stable keys; completed/stopped
tasks release their key after 30 seconds. Active work can reclaim an inactive key
sooner when all six are occupied. Idle history appears temporarily when selected
through navigation. History navigation and Task Monitor reach tasks outside the
six keys; selection remains visible in Status and the inspector after key expiry.
Pressing a key verifies its displayed task identity before selecting it.

Task Monitor rotates through known active/attention tasks without changing the
selected task. Press it to select the task that monitor currently displays.
Stop is available only for a controllable turn with a known ID. Questions are
answered in the CLI; they never enable Approve/Reject. Model, reasoning and Fast
changes are pending settings for the next prompt sent from the deck.

The inspector reports task access/ownership errors separately from daemon health.
A task can appear in history but refuse writes with `already has an active writer`
when another process owns it. Exit that terminal normally before resuming the same
task through the shared daemon. Opening a new shared session does not require
closing it. A `source: vscode` label alone does not prove ownership; interactive
loaded tasks on the shared daemon are included alongside recent CLI history.
Startup prefers the most recently updated loaded task; later discovery preserves
selection. Filtered session listings allow 30 seconds; other requests use an
eight-second deadline. Commands are never automatically replayed after a timeout.

Drafts survive bridge restarts in private
`~/Library/Application Support/OpenCodexMicro/codex-cli/drafts-<socket-hash>.json`
files, separately per daemon socket, limited to 100 drafts of 16,000 characters.
Save an empty prompt to clear a draft. After uncertain delivery, check the
conversation before explicitly saving again to retry. Unreadable draft files are
preserved and reported; a disk failure before sending prevents submission, and a
cleanup failure after sending does not replay it. Removing the CLI bridge removes
its drafts.

## Diagnostics

```bash
node scripts/bridge-status.mjs codex health
node scripts/bridge-status.mjs antigravity health
node scripts/bridge-status.mjs codex-cli health
node scripts/bridge-status.mjs spotify health
```

Use `state` instead of `health` for details. The helper supplies private Bearer
credentials and can initialize a missing token or tighten file permissions.
Spotify uses `/status` internally for both modes. Bare unauthenticated requests
return 403; never put credentials in HTML, URLs or logs. Static documentation or
code reviews do not need to run these helpers.

Bridge files live under `~/Library/Application Support/OpenCodexMicro/`:

| Directory | Logs | LaunchAgent |
| --- | --- | --- |
| `codex/` | `bridge.log`, `bridge-error.log` | `io.opencodexmicro.bridge` |
| `antigravity/` | `bridge-antigravity.log`, `bridge-antigravity-error.log` | `io.openantigravitymicro.bridge` |
| `codex-cli/` | `bridge-codex-cli.log`, `bridge-codex-cli-error.log` | `io.opencodexmicro.codexcli.bridge` |

Check separately: installed plugin files, service health, application connection
and Studio/device behavior. A healthy bridge does not prove that a control or
display works. For Antigravity, check `applicationConnected` separately from saved
history. If a control is unavailable, inspect the selected task and reported error.

### Static or apparently outdated cards

A sample manifest icon such as `79%` is a placeholder, not a quota measurement.
On Studio 3.4.4, earlier plugin builds sent the dynamic image and then reset the
same action to its manifest icon. The corrected builds send the intended image
and use the case-sensitive `textData` field. They retain the supported legacy
`state` protocol documented by the [official Node SDK](https://github.com/UlanziTechnology/plugin-common-node#set-button-icon).

1. Inspect the installed manifest UUID, `CodePath` and bundle. Compare bundle
   hashes with the intended build: both the old and corrected builds say `0.4.1`.
2. Compare the authenticated component state with the card. A running plugin and
   reachable bridge alone do not establish that Studio applies the image.
3. If necessary, validate and update the affected plugin, then reopen Studio.
   Update all four only when that scope is intended. This display fix requires
   neither bridge setup nor profile recreation. For a verified prebuilt Codex
   package, follow [the agent procedure](AGENTS.md#prebuilt-codex-plugin-installation).
4. Switch profiles and return to check that cards are restored. Allow Spotify
   artwork to finish loading. Record physical-device observations separately.

## Recorded validation

On 2026-10-15, corrected 0.4.1 builds were checked on macOS with Studio 3.4.4:

- `npm run check` passed: 146 root tests, syntax checks, seven builds and all four
  plugin checks/smokes, including regressions for image overwrites.
- All installed plugins passed preflight and matched the tested bundles. Dynamic
  cards appeared in all four profiles after restart and profile switching; the
  CLI weekly card showed the then-reported 100% instead of the static 79% image.
- All 12 existing profile files remained byte-identical to the backup.
- Codex App and the CLI daemon were connected. Antigravity provided saved history
  without live desktop controls. Spotify catalog cards and artwork rendered.

This records a dated observation. Physical displays, keys, encoders, application
mutations, playback actions, reboot persistence and other Studio versions were
not verified. See [live validation](AGENTS.md#live-validation) for controlled
acceptance checks; Studio previews alone do not establish hardware behavior.

## Removal

Run `npm run uninstall` to remove Codex App and its bridge, or
`npm run uninstall:all` to remove all project components. Removal must be explicitly
requested. Sibling runtimes, backups and unrelated files are preserved; the
separate official CLI installation is not removed.

## License and attribution

Project-authored code is released under the [MIT License](LICENSE).
[NOTICE.md](NOTICE.md) defines provenance, independence and responsibility;
Ulanzi's declared maintenance scope is the Codex App plugin directory, not the
inherited Bridges or CDP. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) records
dependency licenses. Their copies inside the plugin installer remain required.
