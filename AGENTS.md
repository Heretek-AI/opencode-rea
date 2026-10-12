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
