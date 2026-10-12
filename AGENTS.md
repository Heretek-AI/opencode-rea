# AGENTS.md — opencode-rea

## Build / Test

- Install (worktree only): `bun install`
- Typecheck: `bun run check` (`tsc --noEmit -p tsconfig.json`)
- Build: `bun run build` (`tsc -p tsconfig.build.json`, emits `dist/index.js`)
- Tests (always target `test/` explicitly):
  - All unit: `bun test test/unit`
  - Single file: `bun test test/unit/scaffold.test.ts`

## Constitution

- NEVER edit, build, or test inside `review/` (read-only prior art).
- NEVER use `ctx.mcp.transform` in plugin setup.
- NEVER `git add -A` / `git add .`; stage explicit paths only.
- NEVER run bare `bun test` or bare `tsc` over the root; always target `test/` explicitly
  (e.g. `bun test test/unit`, `bun test test/unit/scaffold.test.ts`) and use the
  `tsconfig.json` / `tsconfig.build.json` excludes (which cover `review/`).
- Do NOT add `effect` or `@opencode/plugin` as runtime dependencies
  (do-not-bundle; `@opencode/plugin` is a peer + dev dependency only).
- Do NOT stage `MASTER_ORCHESTRATOR_PROMPT.md`, `review/`, or `.worktrees/`.

## Host Facts Proven (T02)

Real-toolchain harness: `test/support/model-fixture.ts` (loopback OpenAI-compatible
HTTP server, real `node:http`, records every request, redacts auth) +
`test/support/opencode-env.ts` (temp `HOME`/`XDG_*`/`OPENCODE_CONFIG_DIR`,
v2 `providers` entry with `package: "aisdk:@ai-sdk/openai-compatible"`,
`capabilities: { tools: true }` required for the host to offer tools,
`runReaSetup` uses `--format json`, `runOpencodeRun` drives the real CLI).
Only the LLM is scripted; every report path notes live-model behaviour unverified.

- F1 PASS (`test/integration/host-facts.test.ts`): Promise API `ctx.mcp.list()` and
  `ctx.skill.list()` resolve to `{ location, data }`; `ctx.tool.list()` resolves to
  an `Array` (17 tools in default config). Plugin `setup` runs lazily on first
  capability acquisition for that Location, not at `OpenCode.create`/session time.
- F2 PASS (`test/integration/host-facts.test.ts`): full CLI server discovers
  `<isolated-HOME>/.agents/skills/reverse-engineer-anything/SKILL.md`; the native
  `skill` tool loads it and its bytes reach the model request. Caveat: the
  in-process embedded SDK host surfaces builtins only (`opencode`, `report`) via
  `ctx.skill.list()` — global discovery applies to the real server path.
- F3 PASS (`test/integration/host-facts.test.ts`): `@opencode/cli` 2.0.26 runs;
  `opencode run --standalone --format json` emits newline-delimited JSON with
  `type`/`timestamp`/`sessionID` (`step_start`, `text`, `tool_use`, `step_finish`).
- F4 PASS (`test/integration/host-facts.test.ts`): non-interactive v2 with
  `shell: ask` — without `--auto` the host auto-rejects with feedback
  (`tool_use` `error`, run continues, exit 0); with `--auto` it approves once
  (`tool_use` `completed`, real command output reaches the model, exit 0).
- F5 PASS (`test/integration/host-facts.test.ts`): scripted `tool_calls` route
  natively in default config (`read` executes as `read`, real file bytes return;
  not via Code Mode `execute`). The host offers 12 native tools incl. `skill`.
- F6 PASS (`test/integration/host-facts.test.ts`): V1 verifier ran against
  `opencode-ai@1.18.35` POSIX only; T02 proves V2 `opencode v2.0.26` on linux
  (plus E2E smoke `test/e2e/smoke.test.ts`: built plugin loads, run exits 0,
  no `LoadError` in server logs).
