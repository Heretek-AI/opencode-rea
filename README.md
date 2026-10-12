# opencode-rea

OpenCode v2 plugin that wires [REA](https://github.com/morluto/rea) reverse-engineering
agents, skills, slash commands, and a readiness tool into OpenCode — on top of an
already-registered REA MCP server.

- Package: `opencode-rea`
- Version: `0.1.0`
- Entry: `./dist/index.js` (`exports: { ".": "./dist/index.js" }`)
- Shipped files: `dist`, `skills`, `agents`, `index.js`
  (`index.js` at the repo root re-exports `./dist/index.js`: the host resolves a
  local plugin directory via a root `index.js`, so a packed+extracted directory
  without it is silently never loaded)
- Peer: `@opencode/plugin@^2` (dev: `2.0.26`; also dev: `@opencode/cli`/`@opencode/sdk`
  `2.0.26`, `rea-agents` `6.4.0`)
- Plugin id: `rea` (`src/index.ts`: `Plugin.define({ id: "rea", setup ... })`;
  setup parses options, then registers skills, agents, readiness, commands)

Machine-checkable docs guard: `test/unit/docs.test.ts`
(build/test rules: `AGENTS.md`).

## Prerequisites — register REA first

This plugin **reuses** your existing REA MCP server registration. It never
registers, edits, or writes MCP server configuration (it only *reads* via
`ctx.mcp.list()` — it never calls `ctx.mcp.transform`).

Run **before** installing the plugin:

```sh
rea setup --client opencode
```

If tools are missing later, the readiness tool points you back at doctor/setup
(see below) — the plugin itself still writes nothing.

## Install

```sh
opencode plugin add opencode-rea
# or a git spec, e.g.
# opencode plugin add git@github.com:<org>/opencode-rea.git
```

## Options

Configure under the plugin's options (keyed by plugin id `rea`):

| Key       | Type                       | Default | Meaning                                                        |
|-----------|----------------------------|---------|----------------------------------------------------------------|
| `server`  | string (non-empty)     | `"rea"` | MCP server name; permission actions and tool counts use the host-sanitized namespace (`server.replace(/[^a-zA-Z0-9_-]/g, "_")` + `_<tool>`) |
| `runtime` | `"ask"` \| `"allow"` \| `"deny"` | `"ask"` | Approval policy applied to the 21 runtime-effect tools (see Agents) |

Validation (`src/options.ts`, `parseOptions`):

- Omitted/`null` options → `{ server: "rea", runtime: "ask" }`.
- Unknown keys fail setup: `unknown plugin option: "<key>"`.
- Wrong types fail setup:
  - `invalid plugin option "server": expected a string, got <typeof>`
  - empty/whitespace-only `server` fails setup: `invalid plugin option "server": expected a non-empty string, got <value>`
  - `invalid plugin option "runtime": expected one of "ask"|"allow"|"deny", got <value>`
- A non-object (e.g. an array) fails setup:
  `invalid plugin options: expected an object, got <array|typeof>`.

## Agents

Source of truth: `src/agents.ts` + `agents/*.md` (registered via
`ctx.agent.transform` `update`, which upserts; host defaults and any later
`agents.<id>` config rules still win via last-match evaluation).

| Agent         | File                | Mode       | Role |
|---------------|---------------------|------------|------|
| `rea`         | `agents/rea.md`     | `primary`  | Lead investigator. Owns the investigation end to end: plans, runs, keeps the finding ledger, writes the final report, delegates bounded scopes to subagents. |
| `rea-analyst` | `agents/rea-analyst.md` | `subagent` | Static-only analyst. One bounded question per assignment from static evidence (bytes, addresses, strings, graph edges, saved DBs, bookmarks). |
| `rea-runtime` | `agents/rea-runtime.md` | `subagent` | Runtime observer. Answers what static evidence cannot by observing execution within the declared target scope. |
| `rea-auditor` | `agents/rea-auditor.md` | `subagent` | Evidence auditor. Verifies findings against the observations/inferences/unknowns discipline; verifies, never redoes. |

Edit / subagent / shell / runtime-effect gating (`buildAgentPermissions`, `src/agents.ts`;
permission actions for REA tools use the `<sanitized-server>_<tool>` shape, resource `"*"`):

- `rea`: keeps defaults — **no** `edit`/`subagent`/`shell` denies. Only the 21
  runtime-effect tools (`src/effects.ts`, `RUNTIME_EFFECT_TOOLS`) gate on the
  `runtime` option (`effect: options.runtime`).
- `rea-analyst`: static-only — `edit → deny`, `subagent → deny`, `shell → deny`, **and** all 21
  runtime-effect tools → `deny` regardless of the `runtime` option.
- `rea-runtime`: no edits, no subagents, no shell (`edit → deny`, `subagent → deny`, `shell → deny`), but
  runtime-effect tools gate on the `runtime` option.
- `rea-auditor`: read-only — `edit → deny`, `subagent → deny`, `shell → deny`, all 21
  runtime-effect tools → `deny`.

The 21 runtime-effect tools (`src/effects.ts`, data-loss/device/foreign-code axis
only) are, with `<server> = rea` shown as `rea_<tool>`: `rea_annotate_native_function`,
`rea_capture_browser_scenario`, `rea_capture_electron_scenario`,
`rea_capture_native_ui_scenario`, `rea_capture_process_scenario`, `rea_close_binary`,
`rea_export_evidence_bundle`, `rea_install_adb_package`, `rea_observe_native_calls`,
`rea_observe_web_execution`, `rea_push_adb_file`, `rea_set_address_name`,
`rea_set_addresses_names`, `rea_set_bookmark`, `rea_set_comment`,
`rea_set_inline_comment`, `rea_start_adb_activity`, `rea_start_adb_app`,
`rea_stop_adb_app`, `rea_uninstall_adb_package`, `rea_unset_bookmark`.

## Skills

Source of truth: `src/skills.ts` + `skills/*/SKILL.md` (registered via
`ctx.skill.transform` `editor.add({ id, name, description, path, content })`,
where `content` is the body after frontmatter and `path` is the absolute
`SKILL.md` path so sibling references resolve).

| Skill                 | File                              | When to use |
|-----------------------|-----------------------------------|-------------|
| `rea-opencode`        | `skills/rea-opencode/SKILL.md`     | Working with REA inside OpenCode v2: `rea_` tool names, permission actions, Code Mode `execute`/`search` fallback, `/rea:` commands, recovery. |
| `rea-investigation`   | `skills/rea-investigation/SKILL.md` | Multi-step investigation spanning features/subsystems: staged workflow, subagent delegation, finding ledger. |
| `rea-evidence-report` | `skills/rea-evidence-report/SKILL.md` | Writing up findings: observations vs inferences vs unknowns, Evidence ID citations. |
| `rea-reconstruction`  | `skills/rea-reconstruction/SKILL.md` | Turning findings into an implementation: findings→build-step mapping, observed-behavior vs design-choice separation, verification obligations. |

Upstream note: the plugin does **NOT** vendor the upstream
`reverse-engineer-anything` skill. `rea-opencode` states it does not replace that
skill (use upstream for target routing — which analysis tool answers which
question; use `rea-opencode` for the OpenCode-specific surface). The readiness
tool reports whether `reverse-engineer-anything` is visible to the host.

## Commands

Source of truth: `src/commands.ts` (registered via `ctx.command.transform`).

| Command      | Description |
|--------------|-------------|
| `/rea`       | Switch to the `rea` investigator agent and run a staged investigation (`rea-investigation` skill: scope → gather with evidence → infer only from cited evidence). |
| `/rea-doctor`| Run the REA readiness check by calling the `rea_readiness` tool; report each item and act on the returned remediation. |
| `/rea-report`| Produce the REA evidence report (observations vs inferences vs unknowns, every claim with its Evidence ID), then delegate a check to the `rea-auditor` agent. |

REA's six MCP prompts surface as host commands under the `rea:<prompt>` namespace
and are **not** duplicated by this plugin (`COMMAND_IDS` contain no `":"`, so the
three slash commands never shadow them):

- `rea:investigate_feature`
- `rea:compare_application_versions`
- `rea:verify_reconstruction`
- `rea:trace_crash`
- `rea:audit_residual_unknowns`
- `rea:prepare_bounded_process_capture`

## Readiness tool: `rea_readiness`

Source of truth: `src/readiness.ts` (registered via `ctx.tool.transform` as a
native tool with `codemode: false`; read-only — no writes, no config mutation).

- Input: `{}` (empty struct).
- Output: `{ server, status, statusError, reaToolCount, upstreamSkillAvailable, version, remediation }`.
- What it reports:
  - `server`: the configured server name (default `"rea"`).
  - `status` / `statusError`: live MCP status for that server from `ctx.mcp.list()`
    (`"missing"` when absent; otherwise the host's status string plus error).
  - `reaToolCount`: number of tools in `ctx.tool.list()` whose `id`/`name` starts
    with `<sanitized-server>_` (default the `rea_` count).
  - `upstreamSkillAvailable`: whether `reverse-engineer-anything` is visible in
    `ctx.skill.list()`.
  - `version`: plugin version read from `package.json` (falls back to `"unknown"`,
    never throws).
  - `remediation`: advice strings **only** (never executed or written by the tool):
    `rea doctor --client opencode --json` and `rea setup --client opencode --dry-run`.
- Human summary `content`: e.g.
  `rea_readiness: server "rea" status "connected", 170 rea_ tool(s), upstream skill available, version 0.1.0. Remediation: rea doctor --client opencode --json ; rea setup --client opencode --dry-run`.

Use it via `/rea-doctor`, or call `rea_readiness` directly.

## What this plugin deliberately does NOT do

- **No MCP registration or config writes.** Setup only calls `agent`/`skill`/`tool`/
  `command` transforms plus read-only `mcp.list()`/`tool.list()`/`skill.list()`.
  It never calls `ctx.mcp.transform` and never touches MCP server configuration —
  run `rea setup --client opencode` yourself (first) for that.
- **Remediation is advice text only.** `rea_readiness` returns the strings
  `rea doctor --client opencode --json` and
  `rea setup --client opencode --dry-run` for *you* (or the agent, with approval)
  to run. The tool executes nothing and writes nothing.

## Development

See `AGENTS.md` for build/test rules and proven host facts. Quick reference:

```sh
bun install
bun run check   # tsc --noEmit -p tsconfig.json
bun test --path-ignore-patterns 'review/**' test/unit  # all unit tests
```
