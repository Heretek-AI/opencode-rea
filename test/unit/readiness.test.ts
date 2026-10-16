import { describe, expect, test } from "bun:test"
import {
  DOCTOR_CMD,
  PINNED_REA_TOOLS,
  READINESS_TOOL_NAME,
  REA_NAMESPACE_DESCRIPTION,
  SETUP_CMD,
  UPSTREAM_SKILL_ID,
  applyReaToolCatalogPolicy,
  countReaMcpTools,
  countReaToolsByMode,
  registerReadiness,
} from "../../src/readiness.js"

describe("T08 unit: readiness & Code Mode tool catalog policy", () => {
  test("countReaMcpTools and countReaToolsByMode count MCP tools while excluding rea_readiness", () => {
    const tools = [
      { id: READINESS_TOOL_NAME, name: READINESS_TOOL_NAME, options: { codemode: false } },
      { id: "rea_binary_session", name: "rea_binary_session", options: { codemode: true, pinned: true } },
      { id: "rea_inspect_artifact", name: "rea_inspect_artifact", options: {} },
      { id: "rea_read_native_function", name: "rea_read_native_function", options: { codemode: false } },
      { id: "read", name: "read", options: { codemode: false } },
    ]
    expect(countReaMcpTools(tools, "rea")).toBe(3)
    expect(countReaToolsByMode(tools, "rea")).toEqual({
      reaToolCount: 3,
      codemodeToolCount: 2,
      directToolCount: 1,
    })
  })

  test("applyReaToolCatalogPolicy describes namespace, pins primary entry-point tools, and applies optional codemode", () => {
    const described = new Map<string, string>()
    const entries = new Map<string, any>([
      ["rea_binary_session", { id: "rea_binary_session", options: { codemode: true } }],
      ["rea_analyze_javascript_application", { id: "rea_analyze_javascript_application", options: { codemode: true } }],
      ["rea_read_native_function", { id: "rea_read_native_function", options: { codemode: true } }],
      ["read", { id: "read", options: { codemode: false } }],
    ])
    const editor = {
      add: (_tool: any) => undefined,
      namespace: (ns: { name: string; description?: string }) => void described.set(ns.name, ns.description ?? ""),
      list: () => [...entries.values()],
      update: (id: string, fn: (t: any) => void) => {
        const entry = entries.get(id)
        if (entry) fn(entry)
      },
    }

    // Default (codemode omitted): pins entry-point tools without flipping codemode
    applyReaToolCatalogPolicy(editor, { server: "rea", runtime: "ask" })
    expect(described.get("rea")).toBe(REA_NAMESPACE_DESCRIPTION)
    expect(entries.get("rea_binary_session")?.options?.pinned).toBe(true)
    expect(entries.get("rea_analyze_javascript_application")?.options?.pinned).toBe(true)
    expect(entries.get("rea_read_native_function")?.options?.pinned).toBeUndefined()
    expect(entries.get("rea_read_native_function")?.options?.codemode).toBe(true)

    // Explicit codemode: false flips all rea_* MCP tools to direct mode
    applyReaToolCatalogPolicy(editor, { server: "rea", runtime: "ask", codemode: false })
    expect(entries.get("rea_binary_session")?.options?.codemode).toBe(false)
    expect(entries.get("rea_read_native_function")?.options?.codemode).toBe(false)
    expect(entries.get("read")?.options?.codemode).toBe(false)
    expect(PINNED_REA_TOOLS.length).toBe(10)
  })

  test("registerReadiness reports codemodeToolCount, directToolCount, status, and remediation", async () => {
    const added: any[] = []
    const described = new Map<string, string>()
    const toolEntries = new Map<string, any>([
      ["rea_binary_session", { id: "rea_binary_session", name: "rea_binary_session", options: { codemode: true } }],
      ["rea_inspect_artifact", { id: "rea_inspect_artifact", name: "rea_inspect_artifact", options: { codemode: true } }],
    ])
    const ctx: any = {
      tool: {
        transform: async (cb: (editor: any) => void) => {
          cb({
            add: (t: any) => {
              added.push(t)
              toolEntries.set(t.name, t)
            },
            namespace: (ns: { name: string; description?: string }) => void described.set(ns.name, ns.description ?? ""),
            list: () => [...toolEntries.values()],
            update: (id: string, fn: (t: any) => void) => {
              const entry = toolEntries.get(id)
              if (entry) fn(entry)
            },
          })
          return { dispose: async () => {} }
        },
        list: async () => [...toolEntries.values()],
      },
      mcp: {
        list: async () => ({
          location: { directory: process.cwd() },
          data: [{ name: "rea", status: { status: "connected" } }],
        }),
      },
      skill: {
        list: async () => ({
          location: { directory: process.cwd() },
          data: [{ id: UPSTREAM_SKILL_ID }],
        }),
      },
    }

    await registerReadiness(ctx, { server: "rea", runtime: "ask", codemode: false })
    expect(described.get("rea")).toBe(REA_NAMESPACE_DESCRIPTION)
    expect(toolEntries.get("rea_binary_session")?.options?.pinned).toBe(true)
    expect(toolEntries.get("rea_binary_session")?.options?.codemode).toBe(false)

    const readinessTool = added.find((t) => t.name === READINESS_TOOL_NAME)
    expect(readinessTool).toBeDefined()
    expect(readinessTool.options?.codemode).toBe(false)

    const res = await readinessTool.execute({}, {})
    expect(res.output.server).toBe("rea")
    expect(res.output.status).toBe("connected")
    expect(res.output.statusError).toBeNull()
    expect(res.output.reaToolCount).toBe(2)
    expect(res.output.codemodeToolCount).toBe(0)
    expect(res.output.directToolCount).toBe(2)
    expect(res.output.upstreamSkillAvailable).toBe(true)
    expect(res.output.remediation).toEqual([DOCTOR_CMD, SETUP_CMD])
    expect(res.content).toContain("0 codemode, 2 direct")
  })
})
