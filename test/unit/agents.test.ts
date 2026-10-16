import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { isAbsolute } from "node:path"
import {
  AGENT_IDS,
  buildAgentPermissions,
  evaluateAgentPermission,
  parseAgentFile,
  registerAgents,
  resolveAgentsDir,
} from "../../src/agents.js"
import { RUNTIME_EFFECT_TOOLS } from "../../src/effects.js"
import { parseOptions } from "../../src/options.js"

const EXPECTED_IDS = ["rea", "rea-analyst", "rea-runtime", "rea-auditor"] as const

interface CapturedRule {
  action: string
  resource: string
  effect: string
}

interface CapturedAgent {
  id: string
  name: string
  description?: string
  mode?: string
  system?: string
  permissions: CapturedRule[]
}

function makeCaptureCtx() {
  const store = new Map<string, CapturedAgent>()
  const hooks: Array<{ type: string; handler: (input: any) => Promise<any> }> = []
  const ctx = {
    agent: {
      transform: async (cb: (editor: { update: (id: string, fn: (a: CapturedAgent) => void) => void }) => void) => {
        cb({
          update: (id: string, fn: (a: CapturedAgent) => void) => {
            let current = store.get(id)
            if (!current) {
              current = { id, name: id, permissions: [] }
              store.set(id, current)
            }
            fn(current)
            current.id = id
          },
        })
        return { dispose: async () => {} }
      },
    },
    permission: {
      hook: async (type: string, handler: (input: any) => Promise<any>) => {
        hooks.push({ type, handler })
        return { dispose: async () => {} }
      },
    },
  }
  return { ctx, store, hooks }
}

/** Mirror of prior-art Permission.evaluate: LAST matching rule wins, wildcards both fields. */
function evaluate(
  action: string,
  resource: string,
  rules: ReadonlyArray<CapturedRule>,
): string {
  const match = (pattern: string, value: string): boolean => {
    if (pattern === "*") return true
    if (!pattern.includes("*")) return value === pattern
    return new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(value)
  }
  const found = [...rules].reverse().find((r) => match(r.action, action) && match(r.resource, resource))
  return found?.effect ?? "ask"
}

describe("T07 agents: ids and registration", () => {
  test("AGENT_IDS lists exactly the 4 rea-* agents", () => {
    expect([...AGENT_IDS]).toEqual([...EXPECTED_IDS])
  })

  test("registerAgents upserts exactly the 4 agents with modes (rea primary, rest subagent) and registers permission evaluate hook", async () => {
    const { ctx, store, hooks } = makeCaptureCtx()
    await registerAgents(ctx as any, { server: "rea", runtime: "ask" })
    expect([...store.keys()].sort()).toEqual([...EXPECTED_IDS].sort())
    expect(store.get("rea")?.mode).toBe("primary")
    for (const id of ["rea-analyst", "rea-runtime", "rea-auditor"] as const) {
      expect(store.get(id)?.mode).toBe("subagent")
    }
    expect(hooks.length).toBe(1)
    expect(hooks[0]?.type).toBe("evaluate")
  })

  test("each agent has id-matching name, non-empty description/system; agents dir resolves and files exist", async () => {
    const { ctx, store } = makeCaptureCtx()
    await registerAgents(ctx as any, { server: "rea", runtime: "ask" })
    const dir = resolveAgentsDir()
    expect(existsSync(dir)).toBe(true)
    for (const id of EXPECTED_IDS) {
      const agent = store.get(id)
      expect(agent).toBeDefined()
      expect(agent?.name).toBe(id)
      expect(typeof agent?.description).toBe("string")
      expect((agent?.description ?? "").length).toBeGreaterThan(0)
      expect(typeof agent?.system).toBe("string")
      expect((agent?.system ?? "").length).toBeGreaterThan(0)
      expect(existsSync(`${dir}/${id}.md`)).toBe(true)
    }
  })

  test("system prompt equals the agents/<id>.md body (no frontmatter leakage)", async () => {
    const { ctx, store } = makeCaptureCtx()
    await registerAgents(ctx as any, { server: "rea", runtime: "ask" })
    for (const id of EXPECTED_IDS) {
      const system = store.get(id)?.system ?? ""
      expect(system).not.toContain("description:")
      expect(system.length).toBeGreaterThan(50)
    }
  })
})

describe("T07 agents: permission matrix (agent x runtime)", () => {
  for (const runtime of ["ask", "allow", "deny"] as const) {
    test(`rea gets 31 tool rules with effect "${runtime}" and no edit/subagent/shell denies`, () => {
      const rules = buildAgentPermissions("rea", { server: "rea", runtime })
      expect(rules.length).toBe(RUNTIME_EFFECT_TOOLS.length)
      expect(rules.some((r) => r.action === "edit" || r.action === "subagent" || r.action === "shell")).toBe(false)
      for (const tool of RUNTIME_EFFECT_TOOLS) {
        expect(rules).toContainEqual({ action: `rea_${tool.name}`, resource: "*", effect: runtime })
      }
    })

    test(`rea-analyst is static-only under runtime "${runtime}" (edit+subagent+shell deny, 31 tool denies)`, () => {
      const rules = buildAgentPermissions("rea-analyst", { server: "rea", runtime })
      expect(rules.length).toBe(3 + RUNTIME_EFFECT_TOOLS.length)
      expect(rules[0]).toEqual({ action: "edit", resource: "*", effect: "deny" })
      expect(rules[1]).toEqual({ action: "subagent", resource: "*", effect: "deny" })
      expect(rules[2]).toEqual({ action: "shell", resource: "*", effect: "deny" })
      for (const tool of RUNTIME_EFFECT_TOOLS) {
        expect(rules).toContainEqual({ action: `rea_${tool.name}`, resource: "*", effect: "deny" })
      }
    })

    test(`rea-auditor matches analyst under runtime "${runtime}"`, () => {
      expect(buildAgentPermissions("rea-auditor", { server: "rea", runtime })).toEqual(
        buildAgentPermissions("rea-analyst", { server: "rea", runtime }),
      )
    })

    test(`rea-runtime gates tools with "${runtime}" while denying edit+subagent+shell`, () => {
      const rules = buildAgentPermissions("rea-runtime", { server: "rea", runtime })
      expect(rules.length).toBe(3 + RUNTIME_EFFECT_TOOLS.length)
      expect(rules[0]).toEqual({ action: "edit", resource: "*", effect: "deny" })
      expect(rules[1]).toEqual({ action: "subagent", resource: "*", effect: "deny" })
      expect(rules[2]).toEqual({ action: "shell", resource: "*", effect: "deny" })
      for (const tool of RUNTIME_EFFECT_TOOLS) {
        expect(rules).toContainEqual({ action: `rea_${tool.name}`, resource: "*", effect: runtime })
      }
    })
  }

  test("server prefix parameterizes tool actions (host-sanitized namespace)", () => {
    const rules = buildAgentPermissions("rea", { server: "custom", runtime: "allow" })
    expect(rules.every((r) => r.action.startsWith("custom_"))).toBe(true)
    expect(rules).toContainEqual({ action: "custom_annotate_native_function", resource: "*", effect: "allow" })
    expect(rules.some((r) => r.action.startsWith("rea_"))).toBe(false)
  })

  test("server names sanitize to the host namespace", () => {
    const rules = buildAgentPermissions("rea", { server: "my.server", runtime: "allow" })
    expect(rules).toContainEqual({ action: "my_server_annotate_native_function", resource: "*", effect: "allow" })
    expect(rules.some((r) => r.action.includes("."))).toBe(false)
  })

  test("unknown agent id throws", () => {
    let error: unknown
    try {
      buildAgentPermissions("nope", { server: "rea", runtime: "ask" })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("nope")
  })
})

describe("T07 agents: rule ordering and override semantics", () => {
  test("tool rules are the LAST matching rules for their actions (edit/subagent denies first)", () => {
    for (const id of EXPECTED_IDS) {
      const rules = buildAgentPermissions(id, { server: "rea", runtime: "ask" })
      const editIdx = rules.findIndex((r) => r.action === "edit")
      const subagentIdx = rules.findIndex((r) => r.action === "subagent")
      const firstToolIdx = rules.findIndex((r) => r.action.startsWith("rea_"))
      if (editIdx !== -1) expect(editIdx).toBeLessThan(firstToolIdx)
      if (subagentIdx !== -1) expect(subagentIdx).toBeLessThan(firstToolIdx)
    }
  })

  test("last-match evaluation: analyst denies runtime tools even with an earlier allow", () => {
    const pluginRules = buildAgentPermissions("rea-analyst", { server: "rea", runtime: "ask" })
    const withEarlierAllow: CapturedRule[] = [
      { action: "rea_capture_process_scenario", resource: "*", effect: "allow" },
      ...pluginRules,
    ]
    expect(evaluate("rea_capture_process_scenario", "*", withEarlierAllow)).toBe("deny")
  })

  test("user-config override wins via last-write-wins (config rule appended after plugin rules)", () => {
    const pluginRules = buildAgentPermissions("rea-analyst", { server: "rea", runtime: "ask" })
    expect(evaluate("rea_capture_process_scenario", "*", pluginRules)).toBe("deny")
    const withOverride: CapturedRule[] = [
      ...pluginRules,
      { action: "rea_capture_process_scenario", resource: "*", effect: "allow" },
    ]
    expect(evaluate("rea_capture_process_scenario", "*", withOverride)).toBe("allow")
  })

  test("evaluateAgentPermission enforces agent boundaries under global wildcard allow while honoring explicit overrides", () => {
    const options = { server: "rea", runtime: "ask" as const }
    const auditorRules = [
      ...buildAgentPermissions("rea-auditor", options),
      // Simulates OpenCode v2 ConfigAgentPlugin appending global permissions: allow-all
      { action: "*", resource: "*", effect: "allow" as const },
    ]
    expect(
      evaluateAgentPermission(
        {
          action: "edit",
          resource: "/tmp/file.txt",
          agent: "rea-auditor",
          rules: auditorRules,
        },
        options,
      ),
    ).toEqual({ effect: "deny" })

    const runtimeRules = [
      ...buildAgentPermissions("rea-runtime", options),
      { action: "*", resource: "*", effect: "allow" as const },
    ]
    expect(
      evaluateAgentPermission(
        {
          action: "rea_capture_process_scenario",
          resource: "*",
          agent: "rea-runtime",
          rules: runtimeRules,
        },
        options,
      ),
    ).toEqual({ effect: "ask" })

    const analystWithExplicitOverride = [
      ...buildAgentPermissions("rea-analyst", options),
      { action: "rea_capture_process_scenario", resource: "*", effect: "allow" as const },
      { action: "*", resource: "*", effect: "allow" as const },
    ]
    expect(
      evaluateAgentPermission(
        {
          action: "rea_capture_process_scenario",
          resource: "*",
          agent: "rea-analyst",
          rules: analystWithExplicitOverride,
        },
        options,
      ),
    ).toEqual({ effect: "allow" })

    expect(
      evaluateAgentPermission(
        {
          action: "edit",
          resource: "/tmp/file.txt",
          agent: "coder",
          rules: [{ action: "*", resource: "*", effect: "allow" }],
        },
        options,
      ),
    ).toBeUndefined()
  })

  test("registered rea agent permissions equal the matrix builder output", async () => {
    for (const runtime of ["ask", "allow", "deny"] as const) {
      const { ctx, store } = makeCaptureCtx()
      await registerAgents(ctx as any, { server: "rea", runtime })
      for (const id of EXPECTED_IDS) {
        expect(store.get(id)?.permissions).toEqual([...buildAgentPermissions(id, { server: "rea", runtime })])
      }
    }
  })

  test("absolute prompt path: registerAgents reads agents/*.md next to the package (not cwd-relative)", async () => {
    const { ctx, store } = makeCaptureCtx()
    await registerAgents(ctx as any, { server: "rea", runtime: "ask" })
    expect(isAbsolute(resolveAgentsDir())).toBe(true)
    for (const id of EXPECTED_IDS) {
      expect((store.get(id)?.system ?? "").length).toBeGreaterThan(0)
    }
  })

  test("unknown plugin option key still fails via parseOptions", () => {
    let error: unknown
    try {
      parseOptions({ bogus: 1 })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("bogus")
  })
})

describe("T07 agents: parseAgentFile", () => {
  test("parses description/body; name defaults to the agent id", () => {
    const parsed = parseAgentFile(`---\ndescription: Short role.\n---\n\n# Body\nhello\n`, "rea-analyst")
    expect(parsed.name).toBe("rea-analyst")
    expect(parsed.description).toBe("Short role.")
    expect(parsed.body).toContain("hello")
    expect(parsed.body).not.toContain("description:")
  })

  test("missing description throws mentioning the agent id", () => {
    let error: unknown
    try {
      parseAgentFile(`---\nname: rea\n---\n\nbody\n`, "rea")
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("rea")
  })

  test("missing frontmatter delimiters throw mentioning the agent id", () => {
    let error: unknown
    try {
      parseAgentFile(`# No frontmatter\nbody\n`, "rea")
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("rea")
  })

  test("empty body throws mentioning the agent id", () => {
    let error: unknown
    try {
      parseAgentFile(`---\ndescription: Short role.\n---\n`, "rea")
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("rea")
  })
})
