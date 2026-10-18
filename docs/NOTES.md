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
