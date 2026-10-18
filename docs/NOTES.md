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
