import { describe, expect, test } from "bun:test"
import plugin from "../../src/index.js"
import {
  BOOTSTRAP_TOOL_NAME,
  BootstrapToolInputSchema,
  registerBootstrapTool,
  withWorkflowsFallbackNote,
} from "../../src/bootstrap-tool.js"
import { COMMAND_IDS, REA_PROMPT_COMMANDS, registerCommands } from "../../src/commands.js"

const LIVE_NOTE = "live-model behaviour unverified"

interface CapturedTool {
  name: string
  description?: string
  input: unknown
  options?: { codemode?: boolean }
  execute: (input: any, context: any) => Promise<any>
}

interface SetupCapture {
  addedTools: CapturedTool[]
  asserted: Array<Record<string, unknown>>
  reloaded: { count: number }
  progressCalls: Array<unknown>
  directory: string
  deny: boolean
  ctx: any
}

/** Fake host ctx proving registration + permission gating without network (all-flag-false runs zero steps). */
function makeSetupCapture(opts?: { deny?: boolean; withAssert?: boolean; directory?: string }): SetupCapture {
  const cap: SetupCapture = {
    addedTools: [],
    asserted: [],
    reloaded: { count: 0 },
    progressCalls: [],
    directory: opts?.directory ?? "/tmp/rea-m2-bootstrap-ws",
    deny: opts?.deny ?? true,
    ctx: undefined as any,
  }
  const permission: Record<string, unknown> =
    opts?.withAssert === false
      ? {}
      : {
          assert: async (request: Record<string, unknown>) => {
            cap.asserted.push(request)
            if (cap.deny) throw new Error("permission denied: rea_bootstrap_stack not approved")
          },
        }
  cap.ctx = {
    options: {},
    location: { directory: cap.directory },
    skill: {
      transform: async (cb: (editor: any) => void) => {
        cb({ add: () => {} })
        return { dispose: async () => {} }
      },
      reload: async () => {
        cap.reloaded.count++
      },
    },
    agent: {
      transform: async (cb: (editor: any) => void) => {
        cb({ update: () => {} })
        return { dispose: async () => {} }
      },
    },
    tool: {
      transform: async (cb: (editor: any) => void) => {
        cb({
          add: (tool: CapturedTool) => void cap.addedTools.push(tool),
          namespace: () => {},
          update: () => {},
          list: () => [],
        })
        return { dispose: async () => {} }
      },
      list: async () => cap.addedTools.map((tool) => ({ id: tool.name, ...tool })),
    },
    command: {
      transform: async (cb: (editor: any) => void) => {
        cb({ add: () => {} })
        return { dispose: async () => {} }
      },
    },
    session: { switchAgent: async () => {}, prompt: async () => {} },
    mcp: { list: async () => [] },
    permission: { hook: async () => ({}), ...permission },
  }
  return cap
}

function callContext(cap: SetupCapture) {
  return {
    sessionID: "ses-m2-test",
    agent: "rea",
    messageID: "msg-m2-test",
    id: "call-m2-test",
    progress: async (update: unknown) => void cap.progressCalls.push(update),
  }
}

// M2 acceptance: after setup(), ctx.tool.list() includes rea_bootstrap_stack;
// calling it without approval is rejected (permission asserted); COMMAND_IDS
// includes rea-bootstrap and contains no ":". No model calls, no network:
// installs run zero steps under all-false flags (live-model unverified).
describe("M2 integration: rea_bootstrap_stack tool + rea-bootstrap command", () => {
  test("setup() registers rea_bootstrap_stack; tool.list() includes it with codemode:false and a closed input schema", async () => {
    const cap = makeSetupCapture()
    const setup = (plugin as unknown as { setup: (ctx: unknown) => Promise<unknown> }).setup
    await setup(cap.ctx)
    const listed = (await cap.ctx.tool.list()) as Array<{ id: string }>
    const ids = listed.map((entry) => entry.id)
    console.log(`[${LIVE_NOTE}] M2 tool ids after setup:`, JSON.stringify(ids))
    expect(ids).toContain(BOOTSTRAP_TOOL_NAME)
    expect(BOOTSTRAP_TOOL_NAME).toBe("rea_bootstrap_stack")

    const entry = cap.addedTools.find((tool) => tool.name === BOOTSTRAP_TOOL_NAME)
    expect(entry).toBeDefined()
    expect(entry?.options).toMatchObject({ codemode: false })
    expect(entry?.input).toEqual(BootstrapToolInputSchema)
    const schema = entry?.input as { type: string; properties: Record<string, { type: string }>; additionalProperties: boolean }
    expect(schema.type).toBe("object")
    expect(schema.additionalProperties).toBe(false)
    expect(Object.keys(schema.properties).sort()).toEqual(["installMemory", "installSkills", "installWorkflows"])
    for (const prop of Object.values(schema.properties)) {
      expect(prop.type).toBe("boolean")
    }
    expect(typeof entry?.description).toBe("string")
    expect((entry?.description ?? "").length).toBeGreaterThan(0)
  })

  test("calling rea_bootstrap_stack without approval is rejected; permission.assert runs first with the exact shape", async () => {
    const cap = makeSetupCapture({ deny: true })
    await registerBootstrapTool(cap.ctx)
    const entry = cap.addedTools.find((tool) => tool.name === BOOTSTRAP_TOOL_NAME)
    expect(entry).toBeDefined()
    await expect(entry!.execute({}, callContext(cap))).rejects.toThrow(/not approved/)
    // Permission was asserted exactly once, BEFORE any install ran.
    expect(cap.asserted).toHaveLength(1)
    expect(cap.asserted[0]).toMatchObject({
      action: "rea_bootstrap_stack",
      resources: [cap.directory],
      save: ["*"],
    })
    expect(cap.asserted[0]?.sessionID).toBe("ses-m2-test")
    expect(cap.asserted[0]?.agent).toBe("rea")
    expect(cap.asserted[0]?.source).toMatchObject({ type: "tool", messageID: "msg-m2-test", id: "call-m2-test" })
    // Denial means no installs ran and no skill reload happened.
    expect(cap.reloaded.count).toBe(0)
  })

  test("approved call with all flags false runs zero steps, reports results metadata, and reloads skills", async () => {
    const cap = makeSetupCapture({ deny: false })
    await registerBootstrapTool(cap.ctx)
    const entry = cap.addedTools.find((tool) => tool.name === BOOTSTRAP_TOOL_NAME)
    expect(entry).toBeDefined()
    const res = await entry!.execute(
      { installSkills: false, installMemory: false, installWorkflows: false },
      callContext(cap),
    )
    expect(cap.asserted).toHaveLength(1)
    expect(res?.metadata?.results).toEqual([])
    expect(typeof res?.content).toBe("string")
    expect(cap.reloaded.count).toBe(1)
    console.log(`[${LIVE_NOTE}] M2 approved zero-step content:`, JSON.stringify(res?.content))
  })

  test("fail-closed: a host without permission.assert refuses instead of running unapproved installs (D6)", async () => {
    const cap = makeSetupCapture({ deny: false, withAssert: false })
    await registerBootstrapTool(cap.ctx)
    const entry = cap.addedTools.find((tool) => tool.name === BOOTSTRAP_TOOL_NAME)
    expect(entry).toBeDefined()
    await expect(entry!.execute({}, callContext(cap))).rejects.toThrow(/permission\.assert/)
    expect(cap.reloaded.count).toBe(0)
  })

  test("workflows fallback note is appended only when the workflows step did not complete (D5)", () => {
    const clean = withWorkflowsFallbackNote("[OK] OpenCode Workflows plugin", [
      { label: "OpenCode Workflows plugin", status: "ok", detail: "done" },
    ])
    expect(clean).not.toContain("falls back")
    for (const status of ["failed", "skipped"] as const) {
      const noted = withWorkflowsFallbackNote(`[${status === "failed" ? "FAILED" : "SKIPPED"}] OpenCode Workflows plugin`, [
        { label: "OpenCode Workflows plugin", status, detail: "reason" },
      ])
      expect(noted).toContain("falls back to REA's own subagent delegation")
      expect(noted).toContain("D5")
    }
  })

  test("COMMAND_IDS includes rea-bootstrap and contains no ':'", async () => {
    expect(COMMAND_IDS).toContain("rea-bootstrap")
    for (const id of COMMAND_IDS) {
      expect(id).not.toContain(":")
      expect((REA_PROMPT_COMMANDS as ReadonlyArray<string>).includes(id)).toBe(false)
    }
    const added: Array<any> = []
    const prompts: Array<any> = []
    const fakeCtx = {
      command: {
        transform: async (cb: (editor: any) => void) => {
          cb({ add: (d: any) => void added.push(d) })
          return { dispose: async () => {} }
        },
      },
      session: { switchAgent: async () => {}, prompt: async (input: any) => void prompts.push(input) },
    }
    await registerCommands(fakeCtx as any, { server: "rea", runtime: "ask" } as any)
    const def = added.find((d) => d.name === "rea-bootstrap")
    expect(def).toBeDefined()
    expect(typeof def?.description).toBe("string")
    expect((def?.description ?? "").length).toBeGreaterThan(0)
    await def.execute({ sessionID: "s-bootstrap", prompt: { text: "" }, delivery: undefined })
    const text = String(prompts[0]?.text ?? "")
    expect(text).toContain("rea_bootstrap_stack")
    expect(text).toContain("rea_readiness")
  })
})
