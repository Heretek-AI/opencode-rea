---
name: rea-opencode
description: Use when working with REA inside OpenCode v2 — rea_* tool names, permission actions, Code Mode execute/search, /rea: commands, and OpenCode-specific recovery.
---

# REA in OpenCode

This skill describes how REA appears inside OpenCode v2. It does NOT replace
the upstream `reverse-engineer-anything` skill: use that skill for target
routing (which analysis tool answers which question). Use this skill for the
OpenCode-specific surface around it.

## Tool names and permissions

- REA MCP tools surface in OpenCode with an `rea_` prefix (the `rea_<tool>`
  pattern). Always use the connected server's actual tool list and input
  schemas; a skill installed from repository main may describe capabilities
  absent from an older npm release.
- Permission actions for REA tools follow the host's permission model. A
  client can independently require approval for calls the server would
  otherwise run directly; follow the declared request scope and the host's
  actual access requirements.
- If a call is blocked by client policy, do not repeat it unchanged. Client
  approval, shell PATH, registration, and engine availability each have
  different remedies; diagnose the observed blocker and resume the original
  task after repair.

## Code Mode

- Scripted model tool calls route natively in the default config: host tools
  execute as themselves (for example `read` executes as `read`, with real
  file bytes returned), not through Code Mode `execute`.
- Code Mode `execute`/`search` is the fallback path, not the primary route
  for REA analysis tools. Use `search` to discover the exact tool path and
  signature first; never guess tool names or call an unadvertised tool.
- Installing a skill supplies instructions only. It does not register the
  REA MCP server, install analysis engines, or add tools to an already
  running agent; prefer an existing `rea` CLI when one is installed.

## Commands

- Commands under the `/rea:` namespace are host commands, not MCP tools.
  Resolve them through the host's actual command list; do not invent command
  names beyond the `/rea:` pattern.
- Keep command arguments caller-selected (paths, output directories, digests)
  and preserve them verbatim through the call.

## Recovery

- If REA tools are absent, read the connection-and-recovery guidance from the
  upstream skill's references, then continue useful supported work while the
  blocker stands.
- Configuration repair starts with a read-only setup plan: show paths,
  backups, and skill replacement before applying authorized changes.
- Preserve existing approval and target-execution boundaries. REA setup never
  installs or upgrades unrelated software.
- When the retained parent Evidence ID is unknown, page from a summary view
  before requesting the complete record; do not repeat an identical analysis
  or a rejected call without a changed input or a resolved blocker.
