import { describe, expect, test } from "bun:test"
import {
  formatResults,
  reaBootstrapSteps,
  runBootstrap,
  runCommand,
  workflowsSkipReasonForVersionText,
  type StepResult,
} from "../../src/bootstrap.js"

/** M1 acceptance: exact step labels in order, flag-gated packs, formatted output. */
describe("M1 unit: REA bootstrap runner", () => {
  test("reaBootstrapSteps() returns the exact labels in order", () => {
    const labels = reaBootstrapSteps("/tmp/rea-bootstrap-label-probe").map((s) => s.label)
    expect(labels).toEqual([
      "Skill pack p4nda0s/reverse-skills",
      "Skill pack ljagiello/ctf-skills",
      "Skill pack cyberkaida/reverse-engineering-assistant",
      "Skill pack rehan-remade/universal-modder",
      "Operator Helper CLI",
      "Operator Helper for OpenCode V2",
      "OpenCode Workflows plugin",
    ])
  })

  test("reaBootstrapSteps() uses the exact MIT/Apache pack commands", () => {
    const steps = reaBootstrapSteps("/tmp/rea-bootstrap-cmd-probe")
    const skills = steps.slice(0, 4)
    const repos = [
      "p4nda0s/reverse-skills",
      "ljagiello/ctf-skills",
      "cyberkaida/reverse-engineering-assistant",
      "rehan-remade/universal-modder",
    ]
    for (const [i, step] of skills.entries()) {
      expect(step.command).toBe("npx")
      expect(step.args).toEqual(["-y", "skills@latest", "add", repos[i], "--agent", "opencode", "--yes"])
    }
    expect(steps[4]).toMatchObject({
      command: "npm",
      args: ["install", "--global", "@aerovato/operator-helper@latest"],
    })
    expect(steps[5]).toMatchObject({ command: "operator-helper", args: ["install", "opencode-v2"] })
    expect(steps[6]).toMatchObject({
      command: "opencode",
      args: ["plugin", "add", "@rphang/opencode-workflows"],
    })
    expect(typeof steps[6].skip).toBe("function")
  })

  test("installSkills:false drops the four skill steps and keeps memory + workflows", () => {
    const labels = reaBootstrapSteps("/tmp/rea-bootstrap-noskills", { installSkills: false }).map((s) => s.label)
    expect(labels).toEqual(["Operator Helper CLI", "Operator Helper for OpenCode V2", "OpenCode Workflows plugin"])
  })

  test("installMemory:false drops the two memory steps; installWorkflows:false drops the workflows step", () => {
    expect(
      reaBootstrapSteps("/tmp/rea-bootstrap-nomem", { installMemory: false }).map((s) => s.label),
    ).toEqual([
      "Skill pack p4nda0s/reverse-skills",
      "Skill pack ljagiello/ctf-skills",
      "Skill pack cyberkaida/reverse-engineering-assistant",
      "Skill pack rehan-remade/universal-modder",
      "OpenCode Workflows plugin",
    ])
    expect(
      reaBootstrapSteps("/tmp/rea-bootstrap-nowf", { installWorkflows: false }).map((s) => s.label),
    ).toEqual([
      "Skill pack p4nda0s/reverse-skills",
      "Skill pack ljagiello/ctf-skills",
      "Skill pack cyberkaida/reverse-engineering-assistant",
      "Skill pack rehan-remade/universal-modder",
      "Operator Helper CLI",
      "Operator Helper for OpenCode V2",
    ])
  })

  test("formatResults renders [OK]/[FAILED]/[SKIPPED] lines and appends failure output", () => {
    const results: StepResult[] = [
      { label: "Skill pack p4nda0s/reverse-skills", status: "ok", detail: "$ npx …\ninstalled" },
      { label: "Operator Helper CLI", status: "failed", detail: "$ npm …\nEACCES denied" },
      { label: "OpenCode Workflows plugin", status: "skipped", detail: "opencode CLI not runnable" },
    ]
    const out = formatResults(results)
    expect(out).toContain("[OK] Skill pack p4nda0s/reverse-skills")
    expect(out).toContain("[FAILED] Operator Helper CLI")
    expect(out).toContain("[SKIPPED] OpenCode Workflows plugin")
    expect(out).toContain("Failure output:")
    expect(out).toContain("EACCES denied")
    // Skipped detail rides on the summary line (not the failure dump) so the
    // skip reason stays visible without failing the run.
    expect(out).toContain("[SKIPPED] OpenCode Workflows plugin — opencode CLI not runnable")
  })

  test("workflowsSkipReasonForVersionText allows only the pinned 2.0.15 line (D5)", () => {
    expect(workflowsSkipReasonForVersionText("opencode v2.0.15")).toBeUndefined()
    // Known-incompatible 2.0.32 (sandbox rejects effect/unstable/http): skip.
    const skip32 = workflowsSkipReasonForVersionText("opencode v2.0.32")
    expect(skip32).toContain("2.0.32")
    expect(skip32).toContain("2.0.15")
    // Other parseable versions are unverified too: skip fail-closed.
    expect(workflowsSkipReasonForVersionText("opencode v2.0.26")).toContain("2.0.15")
    // Unparseable output still fails closed with a skip reason.
    expect(workflowsSkipReasonForVersionText("")).toContain("could not determine")
  })

  test("formatResults with no failures returns only the summary", () => {
    const out = formatResults([{ label: "Operator Helper CLI", status: "ok", detail: "$ npm …" }])
    expect(out).toBe("[OK] Operator Helper CLI")
  })

  test("runCommand captures output and exit codes without a TTY", async () => {
    const ok = await runCommand("echo", ["hello-rea"], { cwd: "/tmp" })
    expect(ok.code).toBe(0)
    expect(ok.output).toContain("hello-rea")

    const failed = await runCommand("node", ["-e", "process.exit(3)"], { cwd: "/tmp" })
    expect(failed.code).toBe(3)
  })

  test("runCommand tails long output to ~1500 bytes", async () => {
    const big = await runCommand("node", ["-e", "process.stdout.write('x'.repeat(100000))"], { cwd: "/tmp" })
    expect(big.code).toBe(0)
    expect(big.output.length).toBeLessThanOrEqual(6000)
    expect(big.output.length).toBeGreaterThan(0)
  })

  test("runBootstrap with everything disabled runs zero steps", async () => {
    const seen: string[] = []
    const results = await runBootstrap(
      "/tmp/rea-bootstrap-empty",
      { installSkills: false, installMemory: false, installWorkflows: false },
      { onStep: (label) => void seen.push(label) },
    )
    expect(results).toEqual([])
    expect(seen).toEqual([])
    expect(formatResults(results)).toBe("")
  })
})
