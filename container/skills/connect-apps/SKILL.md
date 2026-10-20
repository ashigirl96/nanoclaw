---
name: connect-apps
description: Standing context for offering an app connection when the user asks to connect a service. Ships as instructions.md composed into the group's CLAUDE.md at spawn; there is no workflow to invoke.
---

# Connect apps — standing context

A carrier for standing context, not an on-demand workflow. The payload is
`instructions.md` in this directory, which the host composes into the
CLAUDE.md of every group whose skill selection includes it (the default `all`
does) at spawn.

Fragments reach those groups regardless of the selected gateway and their
`cli_scope`, so the content names neither a gateway nor `ncl`. It only gets
the Agent to put a gateway's own `connect_url` on its own line, which the
Console renders as an app card (`web/src/apps.ts`).
