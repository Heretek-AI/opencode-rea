import { spawn, spawnSync } from "node:child_process"

/**
 * M1 bootstrap runner: installs the reverse-engineering stack (skill packs,
 * operator-memory, parallel-fan-out workflows) on demand. Ported from the
 * Unity kit's `bootstrap.ts` (runCommand/runBootstrap/formatResults pattern);
 * every step below installs an MIT/Apache-2.0 pack — nothing is vendored.
 */

export interface BootstrapOptions {
  installSkills?: boolean
  installMemory?: boolean
  installWorkflows?: boolean
}

export interface BootstrapStep {
  label: string
  command: string
  args: string[]
  /** Skip this step when the function returns a reason. */
  skip?: () => string | undefined
}

export interface StepResult {
  label: string
  status: "ok" | "failed" | "skipped"
  detail: string
}

/** Label of the workflows install step (guarded by a version-probe `skip`; see docs/NOTES.md D5). */
export const WORKFLOWS_STEP_LABEL = "OpenCode Workflows plugin"

/** MIT/Apache-2.0 skill packs installed via `npx skills add`. */
export const REA_SKILL_PACKS: ReadonlyArray<{ label: string; repo: string }> = [
  { label: "p4nda0s/reverse-skills", repo: "p4nda0s/reverse-skills" },
  { label: "ljagiello/ctf-skills", repo: "ljagiello/ctf-skills" },
  { label: "cyberkaida/reverse-engineering-assistant", repo: "cyberkaida/reverse-engineering-assistant" },
  { label: "rehan-remade/universal-modder", repo: "rehan-remade/universal-modder" },
]

/**
 * Synchronous guard for the workflows step. `@rphang/opencode-workflows`
 * upstream pins opencode 2.0.15; only an install + load proves it works on a
 * newer CLI, so this check just verifies an `opencode` CLI is present and
 * reports a parseable version. Anything else fails closed with a skip reason
 * instead of running a doomed install.
 */
export function workflowsSkipReason(): string | undefined {
  try {
    const windows = process.platform === "win32"
    const probed = spawnSync("opencode", ["--version"], {
      encoding: "utf8",
      timeout: 15_000,
      shell: windows,
      windowsHide: true,
      env: { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
    })
    if (probed.error) {
      return `opencode CLI not runnable (${(probed.error as Error).message}) — skipping @rphang/opencode-workflows install; verify it loads manually (see docs/NOTES.md)`
    }
    const text = `${probed.stdout ?? ""} ${probed.stderr ?? ""}`
    if (!/opencode\s+v?\d+\.\d+\.\d+/i.test(text)) {
      return `could not determine opencode version (${JSON.stringify(text.trim().slice(0, 120))}) — skipping @rphang/opencode-workflows install; verify it loads manually (see docs/NOTES.md)`
    }
    return undefined
  } catch (error) {
    return `opencode version check failed (${error instanceof Error ? error.message : String(error)}) — skipping @rphang/opencode-workflows install; verify it loads manually (see docs/NOTES.md)`
  }
}

export function reaBootstrapSteps(cwd: string, o: BootstrapOptions = {}): BootstrapStep[] {
  void cwd
  const steps: BootstrapStep[] = []
  if (o.installSkills ?? true) {
    for (const pack of REA_SKILL_PACKS) {
      steps.push({
        label: `Skill pack ${pack.label}`,
        command: "npx",
        args: ["-y", "skills@latest", "add", pack.repo, "--agent", "opencode", "--yes"],
      })
    }
  }
  if (o.installMemory ?? true) {
    steps.push({
      label: "Operator Helper CLI",
      command: "npm",
      args: ["install", "--global", "@aerovato/operator-helper@latest"],
    })
    steps.push({
      label: "Operator Helper for OpenCode V2",
      command: "operator-helper",
      args: ["install", "opencode-v2"],
    })
  }
  if (o.installWorkflows ?? true) {
    steps.push({
      label: WORKFLOWS_STEP_LABEL,
      command: "opencode",
      args: ["plugin", "add", "@rphang/opencode-workflows"],
      skip: () => workflowsSkipReason(),
    })
  }
  return steps
}

const TAIL = 1500

/** Runs one command without a TTY. On Windows, npm/npx are .cmd shims, which Node only starts through a shell. */
export function runCommand(
  command: string,
  args: string[],
  o: { cwd: string; signal?: AbortSignal; timeoutMs?: number },
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const windows = process.platform === "win32"
    const child = spawn(command, windows ? args.map(quoteWindowsArg) : args, {
      cwd: o.cwd,
      signal: o.signal,
      timeout: o.timeoutMs ?? 300_000,
      shell: windows,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
      windowsHide: true,
    })
    let output = ""
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-TAIL * 4)
    }
    child.stdout.on("data", collect)
    child.stderr.on("data", collect)
    child.on("error", reject)
    child.on("close", (code) => resolve({ code, output }))
  })
}

function quoteWindowsArg(arg: string) {
  return /^[\w@./:=-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '\\"')}"`
}

export async function runBootstrap(
  cwd: string,
  o: BootstrapOptions = {},
  hooks: { signal?: AbortSignal; onStep?: (label: string, i: number, total: number) => void } = {},
): Promise<StepResult[]> {
  const steps = reaBootstrapSteps(cwd, o)
  const results: StepResult[] = []
  for (const [index, step] of steps.entries()) {
    hooks.signal?.throwIfAborted()
    const skipped = step.skip?.()
    if (skipped) {
      results.push({ label: step.label, status: "skipped", detail: skipped })
      continue
    }
    hooks.onStep?.(step.label, index + 1, steps.length)
    try {
      const { code, output } = await runCommand(step.command, step.args, { cwd, signal: hooks.signal })
      results.push({
        label: step.label,
        status: code === 0 ? "ok" : "failed",
        detail: `$ ${step.command} ${step.args.join(" ")}\n${output.trim().slice(-TAIL)}`.trim(),
      })
    } catch (error) {
      if (hooks.signal?.aborted) throw error
      results.push({
        label: step.label,
        status: "failed",
        detail: `$ ${step.command} ${step.args.join(" ")}\n${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }
  return results
}

export function formatResults(results: readonly StepResult[]) {
  const mark = { ok: "OK", failed: "FAILED", skipped: "SKIPPED" } as const
  const summary = results.map((result) => `[${mark[result.status]}] ${result.label}`).join("\n")
  const failures = results
    .filter((result) => result.status === "failed")
    .map((result) => `--- ${result.label}\n${result.detail}`)
    .join("\n\n")
  return failures ? `${summary}\n\nFailure output:\n${failures}` : summary
}
