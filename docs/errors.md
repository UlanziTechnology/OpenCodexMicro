# Engineering notes

## Bridge state

- The renderer Micro store is the single source of truth for task order,
  status, selection, and host assignment.
- Refresh the sidecar cache on its own interval; `/state` must only read the
  cache and must not trigger a renderer scan per request.
- Cache discovered Micro and React references for the renderer lifecycle and
  rediscover them only after invalidation.
- Preserve `client-new-thread:<uuid>` keys until Codex promotes them to formal
  thread UUIDs.
- Bridge navigation must use the displayed slot's exact thread key and let
  Codex resolve the stored project and host assignment.
- Steer must invoke the renderer's real Steer action. Do not substitute an
  Enter variant that could submit or queue instead.
- Preserve both keydown and keyup for Micro actions that use press/release
  semantics.
- Never replay an action after a timeout or uncertain HTTP response.

## Security and lifecycle

- CDP and the Bridge API must bind only to loopback addresses.
- The Bridge launcher must allow slow Codex cold starts and fail early only if
  the Codex process exits.
- Long-lived Bridge and plugin dispatch loops must isolate individual request
  failures so one error cannot stop later actions.
- Plugin `add`, `setactive`, and `clear` events must maintain action instances
  by context; switching pages must not be treated as deletion.

## Plugin display

- Keep the last usable display during routine refreshes; use offline artwork
  only when the Bridge is actually unavailable.
- Task updates use self-contained runtime SVG data, draw the title into the
  image, and must not send either a host title overlay or a state index when the
  manifest disables automatic states.
- Usage refreshes must not block task input or action dispatch.
- Runtime assets referenced by the manifest or plugin code must exist in the
  installed `.ulanziPlugin` directory.
