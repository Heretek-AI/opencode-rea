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
  pattern, or `<sanitized-server>_<tool>` when `options.server` is customized).
  Always use the connected server's actual tool list and input schemas; a
  skill installed from repository main may describe capabilities absent from
  an older npm release.
- Permission actions for REA tools follow the `<sanitized-server>_<tool>`
  pattern (`resource: "*"`). The 31 destructive / runtime-effect tools
  (scenario captures, interactive Frida/GDB/Rizin debug commands, Cutter
  commands, analysis-DB mutations, session teardowns, and ADB mutations) are
  gated by the plugin's `runtime` option (`"ask"` | `"allow"` | `"deny"`) on
  `rea` and `rea-runtime`, and are always denied on `rea-analyst` and
  `rea-auditor`.
- Starting an interactive debugger or Frida session (`start_frida_session`,
  `start_gdb_session`) is classified by REA as session setup
  (`destructiveHint: false`), while subsequent code-injection or
  debug-execution tools (`load_frida_script`, `resume_frida_session`,
  `instrument_with_frida`, `gdb_console`, `start_rizin_debug_session`,
  `rizin_debug_command`, `execute_rizin_command`, `cutter_command`) and
  teardown tools (`close_gdb_session`, `close_rizin_debug_session`,
  `close_binary`) carry runtime-effect gating.
- If a call is blocked by client policy, do not repeat it unchanged. Client
  approval, shell PATH, registration, and engine availability each have
  different remedies; diagnose the observed blocker and resume the original
  task after repair.

## Code Mode and Direct Tool Routing

- Native host tools (`read`, `skill`, `subagent`, and the plugin's own
  `rea_readiness` tool) always have `codemode: false` and execute directly as
  native tool calls.
- For REA MCP tools (`rea_<tool>`):
  - When `codemode: false` is configured (either via plugin option
    `{ "codemode": false }` or on `mcp.servers.rea` in `opencode.json`),
    every `rea_<tool>` is advertised directly in the model's native tool list.
  - Under OpenCode v2's default MCP Code Mode (`codemode: true`), REA MCP
    tools are grouped under the `tools.rea` namespace inside `execute`
    (`await tools.rea.<tool>(input)`). Primary REA entry-point tools
    (`analyze_javascript_application`, `binary_session`,
    `inspect_analysis_view`, `inspect_android_package`, `inspect_artifact`,
    `inspect_binary_layout`, `inspect_managed_artifact`, `list_unknowns`,
    `open_binary`, `record_unknown`) are pinned in the Code Mode catalog
    summary; use `search` to discover the exact signature of any additional
    REA tool before calling it via `execute`. Never guess tool names or call
    an unadvertised tool.
- Installing a skill supplies instructions only. It does not register the
  REA MCP server, install analysis engines, or add tools to an already
  running agent; prefer an existing `rea` CLI when one is installed.

## Compact-First Views and Large Tool Outputs

- Prefer `detail: "summary"` on first read or inventory calls, then page
  specific slices via `inspect_analysis_view` using the retained parent
  `evidence_id` rather than requesting full dumps upfront.
- If OpenCode offloads a large MCP response to a `tool-output/tool_*` file,
  do not re-run the same analysis tool; page via `inspect_analysis_view` with
  the retained `evidence_id` or inspect the targeted keys from the saved
  output.

## Commands

- Plugin slash commands (`/rea`, `/rea-doctor`, `/rea-report`) and REA MCP
  prompt commands under the `/rea:` namespace (`rea:investigate_feature`,
  `rea:compare_application_versions`, `rea:verify_reconstruction`,
  `rea:trace_crash`, `rea:audit_residual_unknowns`,
  `rea:prepare_bounded_process_capture`) are host commands, not MCP tools.
  Resolve them through the host's actual command list; do not invent command
  names beyond the advertised list.
- Keep command arguments caller-selected (paths, output directories, digests)
  and preserve them verbatim through the call.

## Recovery

- Run `rea_readiness` (or `/rea-doctor`) first when REA tools appear missing
  or disconnected; it reports live MCP status, total `reaToolCount`, plus
  `codemodeToolCount` and `directToolCount` without mutating configuration.
- If REA tools are absent, read the connection-and-recovery guidance from the
  upstream skill's references, then continue useful supported work while the
  blocker stands.
- Configuration repair starts with a read-only setup plan
  (`rea doctor --client opencode --json` and
  `rea setup --client opencode --dry-run`): show paths, backups, and skill
  replacement before applying authorized changes.
- Preserve existing approval and target-execution boundaries. REA setup never
  installs or upgrades unrelated software.
- When the retained parent Evidence ID is unknown, page from a summary view
  before requesting the complete record; do not repeat an identical analysis
  or a rejected call without a changed input or a resolved blocker.
