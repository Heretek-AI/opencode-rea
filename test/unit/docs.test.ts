import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { DEBUGGER_SESSION_TOOLS, RUNTIME_EFFECT_TOOLS } from "../../src/effects.js"
import { PINNED_REA_TOOLS } from "../../src/readiness.js"

/**
 * T15 docs guard: README.md must state the release facts accurately, and
 * every agent/skill/command it names must exist on disk / in src/exports.
 * Real over mocks: resolves against package.json, src/, agents/, skills/.
 */
describe("T15 docs guard (README accuracy)", () => {
  test("package.json identity matches what README states", async () => {
    const pkg = (await Bun.file("package.json").json()) as {
      name: string
      version: string
      exports: unknown
      files: string[]
      devDependencies?: Record<string, string>
    }
    // Hard-assert known release values (fail loudly on drift).
    expect(pkg.name).toBe("@heretek-ai/opencode-rea")
    expect(pkg.version).toBe("0.1.1")
    expect(pkg.exports).toEqual({ ".": "./dist/index.js" })
    expect(pkg.devDependencies?.["rea-agents"]).toBe("6.5.0")
    for (const entry of ["dist", "skills", "agents", "index.js"]) {
      expect(pkg.files).toContain(entry)
    }

    const readme = await Bun.file("README.md").text()
    // README must mention the same identity (not invented values).
    expect(readme).toContain("opencode-rea")
    expect(readme).toContain("0.1.2")
    expect(readme).toContain("6.5.0")
    expect(readme).toContain("./dist/index.js")
    for (const entry of ["dist", "skills", "agents", "index.js"]) {
      expect(readme).toContain(entry)
    }
  })

  test("every agent README names exists on disk and README lists all 31 runtime-effect tools", async () => {
    const readme = await Bun.file("README.md").text()
    const agentIds = ["rea", "rea-analyst", "rea-runtime", "rea-auditor"]
    for (const id of agentIds) {
      expect(readme).toContain(id)
      expect(existsSync(`agents/${id}.md`)).toBe(true)
    }
    // Cross-check against the source of truth.
    const agentsSrc = await Bun.file("src/agents.ts").text()
    for (const id of agentIds) {
      expect(agentsSrc).toContain(`"${id}"`)
    }
    for (const tool of RUNTIME_EFFECT_TOOLS) {
      expect(readme).toContain(`rea_${tool.name}`)
    }
    for (const sessionTool of DEBUGGER_SESSION_TOOLS) {
      expect(readme).toContain(sessionTool)
    }
    for (const pinnedTool of PINNED_REA_TOOLS) {
      expect(readme).toContain(pinnedTool)
    }
  })

  test("every skill README names exists on disk", async () => {
    const readme = await Bun.file("README.md").text()
    const skillIds = ["rea-opencode", "rea-investigation", "rea-evidence-report", "rea-reconstruction"]
    for (const id of skillIds) {
      expect(readme).toContain(id)
      expect(existsSync(`skills/${id}/SKILL.md`)).toBe(true)
    }
    const skillsSrc = await Bun.file("src/skills.ts").text()
    for (const id of skillIds) {
      expect(skillsSrc).toContain(`"${id}"`)
    }
    // Plugin does NOT vendor upstream `reverse-engineer-anything`; it points to it.
    expect(readme).toContain("reverse-engineer-anything")
  })

  test("every command README names exists in src/commands.ts exports", async () => {
    const readme = await Bun.file("README.md").text()
    const commandsSrc = await Bun.file("src/commands.ts").text()
    for (const id of ["rea", "rea-doctor", "rea-report"]) {
      expect(readme).toContain(id)
      expect(commandsSrc).toContain(`"${id}"`)
    }
    // REA's six MCP prompts surface as `rea:<prompt>` and are not duplicated.
    for (const prompt of [
      "investigate_feature",
      "compare_application_versions",
      "verify_reconstruction",
      "trace_crash",
      "audit_residual_unknowns",
      "prepare_bounded_process_capture",
    ]) {
      expect(commandsSrc).toContain(prompt)
      expect(readme).toContain(`rea:${prompt}`)
    }
  })

  test("README states options and readiness contract accurately", async () => {
    const readme = await Bun.file("README.md").text()
    const optionsSrc = await Bun.file("src/options.ts").text()
    expect(optionsSrc).toContain('"rea"') // default server
    expect(optionsSrc).toContain('"ask"') // default runtime
    for (const token of ["server", "runtime", "codemode", "ask", "allow", "deny"]) {
      expect(readme).toContain(token)
    }
    // Unknown keys / wrong types fail setup.
    expect(optionsSrc).toContain("unknown plugin option")
    expect(optionsSrc).toContain("invalid plugin option")

    const readinessSrc = await Bun.file("src/readiness.ts").text()
    expect(readinessSrc).toContain("rea_readiness")
    expect(readme).toContain("rea_readiness")
    expect(readme).toContain("codemodeToolCount")
    expect(readme).toContain("directToolCount")
    // Remediation is advice text only.
    expect(readme).toContain("rea doctor --client opencode --json")
    expect(readme).toContain("rea setup --client opencode --dry-run")
    // Prerequisites: registration happens via rea setup first.
    expect(readme).toContain("rea setup --client opencode")
    // Plugin never registers or edits an MCP server.
    expect(readme).toContain("ctx.mcp.transform")
  })
})
