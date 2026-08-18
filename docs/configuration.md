# Configuration

The openCodexMicro layout is configured entirely in Ulanzi Studio. Open the
Codex Micro category and drag any action onto a keypad position.

## Actions

| Action | Behavior |
| --- | --- |
| Codex Task 1–5 | Show the matching Most Recent task title and state; press to open it |
| Fast | Toggle Fast mode for the active task |
| Usage | Show remaining usage; press to focus Codex |
| Pin | Pin or unpin the active task |
| New | Create a new Codex task |
| Fork | Fork the active task |
| Steer | Send the visible composer text as steering input to a running task |
| Mic | Press and release the Codex Micro microphone action |
| Submit | Submit or queue the composer text |

Task actions dynamically use the plugin's idle, working, complete, attention,
error, and offline artwork. Usage is rendered at runtime from the allowance
returned by the Bridge.

## Recommended layout

Keep Task 1–5 together in Most Recent order. Place frequently used controls on
the remaining keys; the layout is not hard-coded, and the same action can be
placed on more than one key.

## Runtime requirements

- Start Codex through `~/Applications/Codex Bridge.app`.
- Keep the Bridge sidecar running at `127.0.0.1:17373`.
- Restart Ulanzi Studio after installing a new plugin build.

The plugin does not require a separate device service, shortcut file, or theme
configuration. To change shipped artwork, edit the files under
`integration/com.ulanzi.codexmicro.ulanziPlugin/assets/icons/`, rebuild, and
reinstall the plugin.
