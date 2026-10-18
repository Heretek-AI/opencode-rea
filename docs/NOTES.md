# M0 — Load-spike discovery log

Date: 2026-10-17. Branch: `claude/project-thread-gnv9zf`.
Worktree: `/home/john/Projects/RE/opencode-rea/.worktrees/m0-spike` (tracking `origin/main @ e337e39`).
Spec: `docs/IMPLEMENTATION_PROMPT.md` §6 M0, reconciled against §4 (Verified facts).

## Spike 1 — plugin loads in the real CLI

Commands (all in the worktree):

```
$ bun install
bun install v1.4.2 (744846f84)
...
+ @opencode/cli@2.0.26
+ @opencode/plugin@2.0.26
+ @opencode/sdk@2.0.26
+ @types/bun@1.3.4
+ rea-agents@6.5.0
+ typescript@5.9.2
532 packages installed [3.66s]
```

```
$ bun run build
$ tsc -p tsconfig.build.json
(exit 0; emits dist/index.js)
```

Root `index.js` re-export present (verbatim):

```js
export { default } from "./dist/index.js";
export * from "./dist/index.js";
```

```
$ bun test --path-ignore-patterns 'review/**' test/e2e/smoke.test.ts
bun test v1.4.2 (744846f84)
test/e2e/smoke.test.ts:
[live-model behaviour unverified] smoke proving built plugin loads in real CLI
[live-model behaviour unverified] smoke exit: 0
 1 pass
 0 fail
 6 expect() calls
Ran 1 test across 1 file. [2.26s]
EXIT_CODE=0
```

The passing test asserts exit 0, `SMOKE-READY` on stdout, a non-empty
fixture request log, and the **absence** of `LoadError` / `Plugin must export`
in server stderr — i.e. the built plugin loads. Matches §4.2.

## Spike 2 — `rea setup` in a throwaway HOME

Exact isolation env (nothing else overridden; `PATH`/etc. inherited):

```
SPIKE_HOME=$(mktemp -d /tmp/opencode-m0-spike-XXXXXX)   # -> /tmp/opencode-m0-spike-qoa12s
mkdir -p "$SPIKE_HOME/home" "$SPIKE_HOME/config"
HOME="$SPIKE_HOME/home" XDG_CONFIG_HOME="$SPIKE_HOME/config" \
  OPENCODE_CONFIG_DIR="$SPIKE_HOME/config" \
  node_modules/.bin/rea setup --client opencode --yes
```

Result: exit 0. A re-run in the same env reports the opencode client
`state: aligned` (idempotent).

Written file — `$SPIKE_HOME/config/opencode.json` (note: `rea setup`
honoured `OPENCODE_CONFIG_DIR`, writing `$SPIKE_HOME/config/opencode.json`
rather than `$HOME/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "rea": {
      "type": "local",
      "command": [
        "/home/john/Projects/RE/opencode-rea/.worktrees/m0-spike/node_modules/.bin/rea",
        "mcp"
      ],
      "enabled": true
    }
  }
}
```

This is exactly the shape §4.3 specifies
(`"mcp": { "rea": { "type": "local", "command": [..., "mcp"], "enabled": true } }`).

Skill side-effect (confirms §4.3 second sentence): the setup also installed
`reverse-engineer-anything` into the isolated home:

```
$ ls "$SPIKE_HOME/home/.agents/skills/"
reverse-engineer-anything
```

Real-user-config safety: the user's real `~/.config/opencode/opencode.json`
was untouched (mtime still `Oct 15 20:34`, two days before this spike).

## Toolchain versions

```
$ node_modules/.bin/opencode --version
opencode v2.0.26                          # matches §3 pin exactly

$ node --version
v26.10.0                                  # see discrepancy D1 below

$ node_modules/.bin/rea --version
6.5.0                                     # matches §4.5 rea-agents pin

$ bun --version
1.4.2
```

## Discrepancies vs Section 4 (reconciled, none blocking)

- **D1 — Node major differs from §3.** §3 says `node --version` should print
  `v22.x (>=22.19)`. This machine has `v26.10.0`. Reconciliation: §4.4 states
  REA needs `^22.19 || ^24.11 || >=26`; v26.10.0 satisfies that range, and
  `rea doctor --client opencode --json` (run with the real home, informational)
  reports `"name":"node","ok":true,"classification":"healthy","detail":"26.10.0"`.
  Both spikes pass on v26, so M0 is green. re-box (M4) still pins Node 22 per
  the Dockerfile spec — this observation does not change that.
- **D2 — Local Ghidra is 12.1.2, not the §4.4 pinned 12.1.4.** `rea doctor`
  reports `ghidra-version: 12.1.2; compatible 12.1.x release (verified build
  12.1.4)` at `/home/john/.local/ghidra`. Informational only: M0 requires no
  engines, and M5 pins `Ghidra_12.1.4_build` for re-box regardless.
- **D3 — Engine auto-detection is NOT HOME-isolated.** Even under the throwaway
  `HOME`, the `rea setup` provider inspection referenced the real
  `/home/john/.local/ghidra` (absolute well-known-path probing), and the
  inherited `JAVA_HOME` (an Android Studio flatpak JBR) leaked into the
  `ghidra-java` check, which doctor flags `missing_dependency` (JBR is not a
  full JDK 21+). Isolation covered *config writes* (proven by the untouched
  real `opencode.json`) but not *engine search paths*. Lesson for re-box/M5:
  engine paths must be set explicitly via absolute `REA_*` env vars
  (which is already the plan in `config/env.defaults`); never rely on
  HOME-relative discovery. No spec change needed — recorded here.
- **D4 — `rea doctor` healthy=false on this dev machine.** Causes: missing
  JADX/IDA config (expected — caller-supplied per §4.4), the JBR JAVA_HOME
  (D3), and `skill:identity` missing in the real home. All out of M0 scope;
  none contradicts §4.

API lookups needed: none. M0 required no `@opencode/plugin` type lookups;
no new code was written.

## M0 acceptance verdict

- [x] `opencode --version` prints `opencode v2.0.26`.
- [x] Smoke test prints `1 pass`, exit code 0.
- [x] Throwaway-HOME `opencode.json` contains the exact `mcp.rea` local-command block.
- [x] Both observations written here in `docs/NOTES.md`; discrepancies D1–D4
      reconciled against §4 above (D1 against the §4.4 Node range + doctor
      evidence). No stop-and-reconcile blocker: nothing contradicts §4.

---

# M1 — Bootstrap runner discovery log

Date: 2026-10-17/18 (UTC 2026-10-18 ~00:0x). Branch: `claude/project-thread-gnv9zf`.
Worktree: `/home/john/Projects/RE/opencode-rea/.worktrees/m0-spike`.
Spec: `docs/IMPLEMENTATION_PROMPT.md` §6 M1.

## M1.1 — `src/bootstrap.ts` port

Ported from `unity.gamedev.kit/src/bootstrap.ts` (read in full) + `src/v2.ts`
(tool-registration shape, reference only — M1 adds no tool yet) +
`src/shared.ts` (SKILL_PACKS shape reference; REA packs defined fresh, no
Unity packs copied). Only `node:child_process` (`spawn`, `spawnSync`),
no `node:fs`/`node:path` use needed (`void cwd` keeps the `reaBootstrapSteps`
signature honest without fake filesystem probes). No new runtime dependencies
(`package.json` untouched; `@opencode/plugin` stays peer+dev).

Exact spec signatures implemented verbatim (`src/bootstrap.ts`):

- `BootstrapOptions { installSkills?; installMemory?; installWorkflows? }`
- `StepResult { label; status: "ok"|"failed"|"skipped"; detail }`
- `BootstrapStep { label, command, args, skip? }` (skip returns reason or undefined)
- `reaBootstrapSteps(cwd, o?)`, `runCommand(command, args, {cwd, signal?, timeoutMs?})`,
  `runBootstrap(cwd, o?, {signal?, onStep?})`, `formatResults(results)`

Step labels in exact order (asserted in test):

1. `Skill pack p4nda0s/reverse-skills` — `npx -y skills@latest add p4nda0s/reverse-skills --agent opencode --yes`
2. `Skill pack ljagiello/ctf-skills` — same shape
3. `Skill pack cyberkaida/reverse-engineering-assistant` — same shape
4. `Skill pack rehan-remade/universal-modder` — same shape
5. `Operator Helper CLI` — `npm install --global @aerovato/operator-helper@latest`
6. `Operator Helper for OpenCode V2` — `operator-helper install opencode-v2`
7. `OpenCode Workflows plugin` — `opencode plugin add @rphang/opencode-workflows`
   with a `skip` guard (`workflowsSkipReason()`, exported): probes
   `opencode --version` via `spawnSync` (15 s timeout, Windows shell parity);
   returns a skip reason when the CLI is missing/unparseable (fail closed —
   no doomed install). A parseable version proceeds; sandbox-level
   incompatibility then surfaces as a step failure (see M1.3).

`runCommand` parity with the Unity kit: no TTY (`stdio: ignore/pipe/pipe`),
`CI=1 NO_COLOR=1 FORCE_COLOR=0`, Windows `.cmd` shim quoting + `shell: true`,
300 s default timeout, output tailed to ~1500 bytes (buffer capped at
`TAIL*4` during collection). `runBootstrap` checks `signal.throwIfAborted()`
per step, honors `skip`, wires `onStep(label, i, total)`, records
`$ cmd args` + tail in `detail`, and rethrows on abort. `formatResults`
renders `[OK]`/`[FAILED]`/`[SKIPPED]` summary lines plus a `Failure output:`
section (failures only; skipped reasons stay on the summary line).

## M1.2 — unit tests

`test/unit/bootstrap.test.ts` (9 tests), run as:

```
$ bun test --path-ignore-patterns 'review/**' test/unit/bootstrap.test.ts
bun test v1.4.2 (744846f84)
 9 pass
 0 fail
 32 expect() calls
Ran 9 tests across 1 file. [167.00ms]
```

Covers the three acceptance assertions (exact labels in order;
`installSkills:false` drops exactly the four skill steps; `formatResults`
renders `[OK]`/`[FAILED]`/`[SKIPPED]`) plus: exact pack commands, the
workflows `skip` presence, `installMemory:false`/`installWorkflows:false`
drops, failure-append vs clean-summary `formatResults` shapes, `runCommand`
exit-code/output capture and tail bound, and `runBootstrap`
all-disabled → `[]` (no network touched — the only `runCommand` tests use
local `echo`/`node -e`).

```
$ bun run check   # tsc --noEmit -p tsconfig.json → exit 0
$ bun run build   # tsc -p tsconfig.build.json → exit 0 (dist/index.js emitted)
```

## M1.3 — workflows-load fact (Not-verified item 1): FAILS on 2.0.32

Question: does `@rphang/opencode-workflows` (upstream pinned to opencode
2.0.15) load and run under `@opencode/cli@2.0.32`? Answer: **NO — it fails
to load on 2.0.32; it loads on its pinned 2.0.15.** All scratch work in
`/tmp/opencode/wf-check` (2.0.32) and `/tmp/opencode/wf-2015` (2.0.15
control); the repo and the real `~/.config/opencode/opencode.json` were
never touched (`grep -c rphang ~/.config/opencode/opencode.json` → `0`).

Registry facts:

```
$ npm view @rphang/opencode-workflows version dist-tags
version = '0.2.0'          # latest; only releases are 0.1.0, 0.2.0 — no newer fix exists
$ npm view @rphang/opencode-workflows dependencies peerDependencies engines
dependencies = { ajv, acorn, effect: '4.0.0-rc.112', '@opencode/codemode': '2.0.15' }
peerDependencies = { '@opencode/plugin': '2.0.15' }
engines = { opencode: '2.0.15' }
```

Install step (the exact M1 bootstrap command) works on both CLIs, fully
isolated (`HOME`/`XDG_*`/`OPENCODE_CONFIG_DIR` under the scratch dir):

```
$ ./node_modules/.bin/opencode --version
opencode v2.0.32
$ ./node_modules/.bin/opencode plugin add @rphang/opencode-workflows
Plugin "@rphang/opencode-workflows" installed and added to /tmp/opencode/wf-check/config/opencode.json
EXIT=0
```

(The package lands in `<cache>/opencode/npm/@rphang/opencode-workflows@latest/<ts>/node_modules/…`.)

Load probe: minimal loopback OpenAI-compatible fixture (`fixture.mjs`,
answers title probes + one text line) + `opencode run --standalone
--format json --auto --print-logs --model fixture-test/fixture-model`.

2.0.32 result — plugin REFUSED by the host sandbox:

```
timestamp=... level=WARN ... message="failed to load plugin" target=@rphang/opencode-workflows
  cause="Cause([Die(Error: Cannot load \"effect/dist/unstable/http/index.js\"
  from plugin node_modules: \"effect/dist/unstable/http/index.js\" is not
  provided by OpenCode; plugins must use the host's \"effect\" and
  \"@opencode/plugin\" modules.)])" role=server
```

2.0.15 control — plugin LOADS (same probe shape, provider block rewritten
to the 2.0.15 `provider:` schema after a `configuration normalization
diagnostic … kind=invalid` told us `providers:`+`settings:` is rejected there):

```
$ grep -c "failed to load plugin" run-stderr2.log
0
$ grep -c "WORKFLOWS-LOAD-PROBE-OK" run-stdout2.jsonl
11
```

(`EXIT=1` on both runs is a fixture artifact, not a product signal: the
minimal fixture omits `finish_reason` on the terminal stream chunk, so the
host reports `provider.invalid-output … stream ended without finish_reason`
*after* delivering the model text. The repo's `test/support/model-fixture.ts`
emits the finish chunk correctly; the scratch fixture was throwaway.)

Root-cause chain (all paths inside the scratch cache):

- `@rphang/opencode-workflows@0.2.0/dist/index.js` → bundled
  `@opencode/codemode@2.0.15` → `dist/openapi/{runtime,types,index}.js`
  contain `import { HttpClient[,…] } from "effect/unstable/http"`.
- The 2.0.32 plugin sandbox does not provide that `effect` subpath, so the
  plugin dies at load. The 2.0.15 host provides it (pinned peer), so it loads.

## Discrepancy vs Section 4 (new)

- **D5 — Not-verified item 1 resolves NEGATIVE.** `@rphang/opencode-workflows`
  does not load under `@opencode/cli@2.0.32` (sandbox rejects its bundled
  `effect/dist/unstable/http` via `@opencode/codemode@2.0.15`; no newer
  plugin release exists). Per §6 M1 / §7.6: **fall back to REA's own
  subagent delegation for bounded fan-out; do not depend on (or block the
  build on) opencode-workflows.** The `OpenCode Workflows plugin` bootstrap
  step stays (guarded by its version-probe `skip`), and M2 must treat a
  workflows-install failure as non-fatal. Nothing else in §4 changes.

## M1 acceptance verdict

- [x] `test/unit/bootstrap.test.ts` asserts exact labels in order,
      `installSkills:false` drops the four skill steps,
      `formatResults` renders `[OK]`/`[FAILED]`/`[SKIPPED]`.
- [x] `bun test --path-ignore-patterns 'review/**' test/unit/bootstrap.test.ts` → all pass (9/9).
- [x] Workflows-load fact verified in `/tmp` scratch and recorded here (D5: fails on 2.0.32, loads on pinned 2.0.15; fallback = REA subagent delegation, build not blocked).

---

# M2 — `rea_bootstrap_stack` tool + `/rea-bootstrap` command discovery log

Date: 2026-10-18 (UTC). Branch: `claude/project-thread-gnv9zf`.
Worktree: `/home/john/Projects/RE/opencode-rea/.worktrees/m0-spike`.
Spec: `docs/IMPLEMENTATION_PROMPT.md` §6 M2 + §4.1 (tool transform editor
shapes, permission assert), §7, §5 layout. CLI pin stays 2.0.26 (no bump).

## M2.1 — `ctx.permission.assert` availability probe (new discrepancy D6)

§4.1/§6-M2 say to call `ctx.permission.assert(...)` before running, citing
`unity.gamedev.kit/src/v2.ts`. But `@opencode/plugin@2.0.26` types declare no
`assert`: `dist/promise/permission.d.ts` is
`Pick<PermissionApi, "list" | "get" | "reply"> & { hook }`, and the bundled
`@opencode/client@2.0.26` generated permission API has only
`request/saved/create/list/get/reply` — no `assert` anywhere in the package.
The Unity kit targets `@opencode/plugin@2.0.32`, so the reference may postdate
our pin. Verified empirically with a scratch probe plugin (tool returning
`typeof ctx.permission.assert` + `Object.keys(ctx.permission)`, driven by the
real CLI + fixture model, scratch deleted afterwards):

- 2.0.26 (`node_modules/.bin/opencode`, `opencode v2.0.26`):
  `{"typeofAssert":"undefined","permissionKeys":["hook","list","get","reply"]}`
- 2.0.32 (`/tmp/opencode/wf-check/node_modules/.bin/opencode`, `opencode v2.0.32`):
  `{"typeofAssert":"function","permissionKeys":["hook","list","get","reply","assert"]}`

## Discrepancy vs Section 4 (new)

- **D6 — `permission.assert` does not exist on the pinned 2.0.26 host; it was
  added by 2.0.32.** Calling it unconditionally would throw
  `TypeError: not a function` at runtime on our pin. Design (fail-closed per
  Agency rules): `src/bootstrap-tool.ts` `readPermissionAssert()` calls the
  host capability when present and otherwise throws a descriptive error
  refusing to run installs without approval. Nothing proceeds unapproved on
  any host. re-box (2.0.32) gates normally. Build not blocked.

## M2.2 — implementation

File placement: new `src/bootstrap-tool.ts` (thin; reuses the M1 runner —
no `node:fs`/`node:path`, no new runtime deps, no `ctx.mcp.transform`).
`src/index.ts` `setup()` registers it after readiness; `src/commands.ts`
gains `/rea-bootstrap`; `src/readiness.ts` + `src/bootstrap.ts` adjusted
(see below). Exports added to `src/index.ts` for tests/docs-guard.

- Tool registration mirrors `gamedev_bootstrap_stack`:
  `editor.add({ name: "rea_bootstrap_stack", input: { installSkills?,
  installMemory?, installWorkflows? } booleans, additionalProperties: false,
  options: { codemode: false } })`. `execute` calls `readPermissionAssert`
  with `{ sessionID, agent, source: { type: "tool", messageID, id }, action:
  "rea_bootstrap_stack", resources: [directory], save: ["*"] }` **before**
  `runBootstrap(...)` with `onStep` wired to `context.progress`, then
  `await ctx.skill.reload()`. Returns `{ content, metadata: { results } }`.
- D5 (workflows failure non-fatal): `runBootstrap` already records step
  failures instead of throwing; the tool additionally appends an explicit
  fallback note via `withWorkflowsFallbackNote()` when the workflows step is
  not `ok` ("bounded fan-out falls back to REA's own subagent delegation").
  New shared const `WORKFLOWS_STEP_LABEL` in `src/bootstrap.ts` (value
  unchanged, M1 unit assertions untouched).
- New-tool fallout in `src/readiness.ts`: the plugin's own
  `rea_bootstrap_stack` matches the `rea_` prefix, so without an exclusion it
  would inflate the MCP-only `reaToolCount` (T08/T10 hermetic `0` broke: got
  1) and a global `codemode` option would clobber its direct mode. Added
  `PLUGIN_OWN_TOOL_NAMES = { rea_readiness, rea_bootstrap_stack }` skipping it
  in `countReaToolsByMode` and in the `applyReaToolCatalogPolicy` codemode
  loop. `test/unit/readiness.test.ts` extended with a bootstrap entry (counts
  unchanged).
- `/rea-bootstrap` (`COMMAND_IDS` + definition): prompt tells the agent to
  call `rea_bootstrap_stack` (passing requested flags), then `rea_readiness`,
  and report per-step results + readiness summary + the workflows-fallback
  note when applicable. No agent switch. `test/unit/commands.test.ts` and
  `test/integration/commands.test.ts` exact lists updated to the four
  commands; `test/unit/options.test.ts` setup stub gains the host-guaranteed
  `location` (unity kit relies on `ctx.location.directory` too).
- Docs: `README.md` gains a `/rea-bootstrap` row ("three" → "four") and a
  "Bootstrap tool: `rea_bootstrap_stack`" section (flags, permission gate +
  D6 host note, workflows non-fatal + D5 note, `codemode: false`,
  `{ content, metadata: { results } }`, `ctx.skill.reload()`).
  `test/unit/docs.test.ts` extended: `"rea-bootstrap"` in the command-id
  loop + a dedicated test asserting README tokens and `src/bootstrap-tool.ts`
  markers (`permission.assert`, `ctx.skill.reload`, `runBootstrap`,
  `codemode`).

## M2.3 — live gating evidence (real hosts, built plugin, scratch tests deleted)

Zero-step calls (`installSkills/installMemory/installWorkflows: false`, so no
command ever runs) driven by the real CLI + fixture model:

- 2.0.26 + `--auto`: `tool_use` `status: "error"`,
  `error: "rea_bootstrap_stack: host permission.assert is unavailable —
  refusing to run installs without approval. ..."` — fail-closed, exit 0.
- 2.0.32 + `--auto`: `tool_use` `status: "completed"`,
  `metadata: { results: [], ... }`, `output: ""` — host `assert` approved the
  call end to end.
- 2.0.32 without `--auto`: `status: "completed"` as well (standalone-run
  host policy auto-resolves the programmatic assert; the user-facing denial
  path — assert rejects → execute rejects before any install — is proven
  deterministically in `test/integration/bootstrap.test.ts` via an injected
  rejecting assert, plus the D6 fail-closed path via an assert-less host).
  Recorded as observed; host approval policy is not this plugin's logic.

## M2.4 — test evidence

```
$ bun run check   # tsc --noEmit -p tsconfig.json → exit 0
$ bun run build   # tsc -p tsconfig.build.json → exit 0
$ bun test --path-ignore-patterns 'review/**' test/unit test/integration
126 pass, 0 fail, 2737 expect() calls, 22 files
```

Includes new `test/integration/bootstrap.test.ts` (6 tests: tool listed
after `setup()` with `codemode: false` + closed boolean schema; denial
rejects with exact assert shape `{ action: "rea_bootstrap_stack",
resources: [directory], save: ["*"] }` and no reload; approved all-false run
returns `metadata.results: []` + one `skill.reload()`; assert-less host
refuses via `/permission\.assert/`; D5 note only on non-ok workflows;
`COMMAND_IDS` contains `rea-bootstrap`, no `":"`, command prompt names both
tools).

## M2 acceptance verdict

- [x] `test/integration/bootstrap.test.ts`: after `setup()`,
      `ctx.tool.list()` includes `rea_bootstrap_stack`; calling it without
      approval is rejected (permission asserted with the exact spec shape);
      `COMMAND_IDS` includes `rea-bootstrap` and contains no `":"`.
- [x] `bun run check` passes.
      `bun test --path-ignore-patterns 'review/**' test/unit test/integration`
      → all pass (126/126).
- [x] `docs.test.ts` (extended) confirms README documents the new tool and
      command (fails without the README section).
- [x] Workflows failure handled non-fatal (D5 note helper + unit-covered;
      step failures never throw out of `runBootstrap`).

---

# M3 — Agent-prompt upgrades discovery log

Date: 2026-10-18 (UTC). Branch: `claude/project-thread-gnv9zf`.
Worktree: `/home/john/Projects/RE/opencode-rea/.worktrees/m0-spike`.
Spec: `docs/IMPLEMENTATION_PROMPT.md` §6 M3 + §4.4b (WASM routing rule) + §8.

## M3.1 — `agents/rea.md` edits (prompt only, no code)

Added three short sections after `## Reporting`, consistent with the
existing observations/inferences/unknowns discipline (no contradiction):

- `## Checkpoint/resume` — before a long/branching step, write a one-line
  resume capsule (target identity, open Evidence IDs, question in flight) so
  a cold session can continue; capsule is a pointer, not evidence.
- `## Challenger branch` — when the leading hypothesis is weakly supported,
  spin one bounded alternate (one question, one entry point, disconfirming
  evidence type) before committing; record both in the ledger.
- `## WASM routing` — `open_binary` refuses WASM
  (`wasm_requires_static_inspection`); route `.wasm` to
  `inspect_wasm_artifact` (or `rea inspect-wasm-artifact <path> --format
  json`), static only, WABT 1.0.42 via `REA_WABT_BIN_DIRECTORY`.
  Source: `rea/docs/wasm-artifacts.md:7-11`.

Borrowed Goblin-D.M.T. discipline ideas only; no dependency added.
Frontmatter `description` untouched; no `src/` changes, so
permission/effects behaviour is unchanged by construction. Body avoids the
literal `description:` token (keeps the no-frontmatter-leakage test green).

## M3.2 — test evidence

```
$ bun test --path-ignore-patterns 'review/**' test/unit/agents.test.ts
  30 pass, 0 fail, 406 expect() calls
$ bun run check   # tsc --noEmit -p tsconfig.json → exit 0
$ bun test --path-ignore-patterns 'review/**' test/unit/docs.test.ts
  6 pass, 0 fail
```

## M3 acceptance verdict

- [x] `agents.test.ts` still passes (file parses, non-empty `description`
      frontmatter + body).
- [x] `rea.md` gains checkpoint/resume + challenger-branch sections and the
      WASM routing rule.
- [x] Permission/effects tests unchanged (no `src/` edits).

---

# M3b — Target-integrity edit guard discovery log

Date: 2026-10-18 (UTC). Branch: `claude/project-thread-gnv9zf`.
Worktree: `/home/john/Projects/RE/opencode-rea/.worktrees/m0-spike`.
Spec: `docs/IMPLEMENTATION_PROMPT.md` §6 M3b (exact deny list) + §7 + §8.

## M3b.1 — implementation (no second hook, effect-gating untouched)

- `src/options.ts`: exposed `protectTargets?: boolean` (default `true`).
  `KNOWN_KEYS` gains `"protectTargets"`; non-boolean fails with
  `invalid plugin option "protectTargets"`; `parseOptions(undefined|null|{})`
  returns `protectTargets: true`. Guard checks `options.protectTargets !== false`,
  so `undefined` (older callers) stays enabled — fail closed.
- `src/agents.ts`: added `getProtectedTargetReason()` /
  `isProtectedTargetPath()` + `findProtectedTargetResource()` (checks both
  `event.resource` and `event.resources[]`). `evaluateAgentPermission()` runs the
  guard first — for **every** agent, before any effect-gating logic — denying
  `action === "edit"` on a protected target with
  `Permission denied: edit of "<path>" is blocked by target-integrity guard (<reason>).`
  `protectTargets: false` skips only the guard. Existing specialist
  (`rea-analyst`/`rea-auditor`/`rea-runtime`) and `runtime` gating untouched.
- Single hook preserved: `registerAgents()` still calls
  `ctx.permission.hook("evaluate", …)` exactly once (asserted in test). Removed
  the `if (!isKnownAgentId(event.agent)) return` early-return so the guard runs
  for unknown agents too; the `ctx.agent.get` tail-override lookup stays
  known-agent-only. `src/index.ts` re-exports the two helpers.

Deny coverage (case-sensitive dirs, case-insensitive extensions/names):
`targets/|fixtures/|captures/|ghidra_projects/|`.rea/` as any path segment;
any segment ending `.rep`; basename `*.rea.backup*` (contains `.rea.backup`),
`*.bundle.json`, `.env*` except exact `.env.example`,
`\.(gpr|idb|i64|hop|rzdb|bndb|apk|ipa|asar|pcap|pcapng|core|dmp|wasm)$`,
`\.(pem|key|pfx|p12|keystore|jks)$`, `id_rsa*`/`id_ed25519*` prefix.

## M3b.2 — test evidence

```
$ bun run check   # tsc --noEmit -p tsconfig.json → exit 0
$ bun test --path-ignore-patterns 'review/**' test/unit/guard.test.ts
  48 pass, 0 fail
$ bun test --path-ignore-patterns 'review/**' test/unit test/integration
  174 pass, 0 fail, 2998 expect() calls, 23 files
```

`test/unit/guard.test.ts` (48 tests): per-path deny table (each dir, each of
the 14 binary/capture extensions, `*.rep/`, `*.rea.backup*`, `*.bundle.json`,
`.env*`, each secret extension, each key prefix) via `evaluateAgentPermission`
with `agent: "rea"`; singular-`resource` + unknown-agent fail-closed rows;
non-`edit` action untouched; allows for `src/x.ts`,
`openspec/changes/a/proposal.md`, `.env.example`; `protectTargets:false` allows
every denied path; `parseOptions` default/validation; single-hook assertion
plus live hook-handler deny for an unknown agent.
`test/unit/options.test.ts` updated for the new `protectTargets: true` default.

## M3b acceptance verdict

- [x] Guard table covers each deny case + the three allows; `protectTargets:false`
      allows all.
- [x] `bun run check` and
      `bun test --path-ignore-patterns 'review/**' test/unit test/integration` pass.

## M3c — license discovery (third-party skill packs)

All paths below are read-only references under `/home/john/Projects/RE/review/`;
nothing was edited there. Commands used:

```
$ for d in reverse-skills ctf-skills reverse-engineering-assistant universal-modder reverse-skill Anthropic-Cybersecurity-Skills; do echo "-- $d"; git -C /home/john/Projects/RE/review/$d log -1 --format=%H; git -C /home/john/Projects/RE/review/$d remote get-url origin; done
$ find <each pack> -maxdepth 2 -iname 'LICENSE*'; find review/reverse-engineering-assistant -maxdepth 3 -iname 'NOTICE*'
$ head -5 <each LICENSE>; diff -q review/reverse-engineering-assistant/LICENSE review/reverse-engineering-assistant/ReVa/LICENSE
```

### On-demand packs (M1 `REA_SKILL_PACKS`, installed via `npx skills add`)

| Pack dir | LICENSE path | First 5 lines | Commit SHA | Remote |
| --- | --- | --- | --- | --- |
| `review/reverse-skills` | *(none — no LICENSE file in repo)*; license declared as `MIT` in `README.md` § `## 许可证` and `README_EN.md` § `## License` | `npx skills remove rev-symbol rev-struct` / ` ``` ` / (blank) / `## 许可证` / (blank) + `MIT` | `a2baa31c58a3567977188414da68c8c842057152` | `https://github.com/p4nda0s/reverse-skills` |
| `review/ctf-skills` | `LICENSE` | `MIT License` / (blank) / `Copyright (c) 2026 Lukasz Jagiello` / (blank) / `Permission is hereby granted, free of charge, to any person obtaining a copy` | `3bb6bad1a06664840d07b6e1e69bf19e6ca4672d` | `https://github.com/ljagiello/ctf-skills` |
| `review/reverse-engineering-assistant` | `LICENSE` **and** `ReVa/LICENSE` (byte-identical, `diff -q` → SAME) | `Apache License` / `Version 2.0, January 2004` / `http://www.apache.org/licenses/` / (blank) / `TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION` | `a05a6b0a18649efd6d74ec8447bdadf8d468c365` | `https://github.com/cyberkaida/reverse-engineering-assistant` |
| `review/universal-modder` | `LICENSE` | `MIT License` / (blank) / `Copyright (c) 2026 Rehan and universal-modder contributors` / (blank) / `Permission is hereby granted, free of charge, to any person obtaining a copy` | `b8675c10d7091d7e4e00a2e40a15c601040b69a8` | `https://github.com/rehan-remade/universal-modder` |

### NOTICE check (Apache-2.0 ReVa)

`find review/reverse-engineering-assistant -maxdepth 3 -iname 'NOTICE*'` →
no output: **no NOTICE file exists** upstream, so there is nothing to copy.
Recorded in `THIRD_PARTY_NOTICES.md` with the instruction to copy it if one
appears later.

### Deliberately NOT vendored

- `review/reverse-skill` (`zhaoxuya520/reverse-skill`, MIT, 89 skills,
  `cab634bd855fc287f6e420c1f36fd1a6b9245960`) and
  `review/Anthropic-Cybersecurity-Skills`
  (`mukul975/Anthropic-Cybersecurity-Skills`, Apache-2.0, 818 skills,
  `54a798831d2266a3ca61ce68a7acb80b81160d57`): on demand via `npx skills add`
  only, never vendored.
- `review/reverse-skill/CTF-Sandbox-Orchestrator/LICENSE` first 5 lines:
  `GNU GENERAL PUBLIC LICENSE` / `Version 3, 29 June 2007` / (blank) /
  `Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>` /
  `Everyone is permitted to copy and distribute verbatim copies` → **GPLv3:
  NEVER copy** (Gotcha 18).
- IDA/Hopper: licensed, mount-or-host via `REA_IDA_MCP_CONFIG` /
  `HOPPER_LAUNCHER_PATH`; not baked (Gotcha 11).

### Thin-plugin verification (Decision 1)

```
$ ls skills/   # → rea-evidence-report rea-investigation rea-opencode rea-reconstruction (only the 4 rea-* skills)
$ grep -ril 'reverse-engineer-anything' skills/  # → only rea-opencode/SKILL.md mentions it, as a pointer ("use that skill for target…"), not a shadow registration
$ grep -n SKILL_IDS src/skills.ts  # → 4 ids, unchanged; no SKILL_IDS edit in this stage
```

No skill files vendored into `skills/` in this stage.

### Packaging note (`package.json` `files` list)

`package.json` `"files"` is `["dist", "skills", "agents", "index.js"]` — the
new root `THIRD_PARTY_NOTICES.md` is **not** in the published tarball file
list. Per the stage spec it stays at the repo root (as §5/§8 require); the
publish list is left untouched so `docs.test.ts` (README/package identity)
and the release footprint do not change. If attribution must ship inside the
npm tarball, add `"THIRD_PARTY_NOTICES.md"` to `files` in a later stage and
re-run the docs guard.

## M8 — validation pass (2026-10-18 UTC)

Branch: `claude/project-thread-gnv9zf` (6 commits ahead of `origin/main`:
`05f1eca` M0 … `0b729f4` M3c). Worktree:
`/home/john/Projects/RE/opencode-rea/.worktrees/m0-spike` (clean —
`git status --short` empty at validation time). Spec:
`docs/IMPLEMENTATION_PROMPT.md` §6 M8 + §8 Definition of done (opencode-rea
items). No code changes needed this milestone: every gate below passed on
the as-built tree, so this entry is the only change.

### Gates (exact commands + observed output)

```
$ bun run check            # tsc --noEmit -p tsconfig.json
$ tsc --noEmit -p tsconfig.json
(exit 0, no output)
```

```
$ bun test --path-ignore-patterns 'review/**' test/unit test/integration
174 pass
0 fail
2998 expect() calls
Ran 174 tests across 23 files. [22.77s]
(exit 0)
```

```
$ bun test --path-ignore-patterns 'review/**' test/e2e/smoke.test.ts
[live-model behaviour unverified] smoke exit: 0
1 pass
0 fail
6 expect() calls
Ran 1 test across 1 file. [2.05s]
(exit 0)
```

### §8 Definition-of-done check (opencode-rea items)

- M0 spikes re-run, observations in NOTES: yes (`docs(m0)` commit `05f1eca`,
  §M0 entry above matches §4: `opencode v2.0.26`, smoke `1 pass`, `opencode.json`
  `mcp.rea` block).
- `src/bootstrap.ts` ported, unit tests pass, workflows-load fact recorded:
  yes (M1 entry; `test/unit/bootstrap.test.ts` green inside the 174).
- `rea_bootstrap_stack` + `/rea-bootstrap` registered, permission-gated,
  integration + docs tests pass: yes (M2 entry; `test/integration/bootstrap.test.ts`
  + `docs.test.ts` green inside the 174).
- `rea` prompt gains checkpoint/resume + challenger-branch + WASM routing,
  agent tests still pass: verified live this milestone —
  `agents/rea.md:49 ## Checkpoint/resume`, `:59 ## Challenger branch`,
  `:68 ## WASM routing` (routes `.wasm` to `inspect_wasm_artifact`, static
  only, WABT 1.0.42); `test/unit/agents.test.ts` green inside the 174.
- Target-integrity edit guard + `protectTargets` + guard table: yes (M3b entry;
  `test/unit/guard.test.ts` green inside the 174; `protectTargets:true` default).
- `THIRD_PARTY_NOTICES.md` lists every ported set with license + commit: yes
  (M3c commit `0b729f4`; 4 on-demand packs, GPL `CTF-Sandbox-Orchestrator`
  explicitly excluded, no NOTICE file upstream for ReVa).
- `docs/NOTES.md` exists with every discovery/discrepancy: this file.
- No PR template in this repo (`find`: no hits outside `node_modules`), so the
  fixed §6 body format is used verbatim for the PR.
- Gotcha re-check: no `ctx.mcp.transform` in plugin setup, no `review/`
  edits, no `effect`/`@opencode/plugin` runtime deps, opencode-rea pin still
  2.0.26 (only re-box moves to 2.0.32) — all hold; `bun run check` + the 174
  would fail otherwise.

No blockers. 3x-fail budget untouched (0 failures this milestone).
