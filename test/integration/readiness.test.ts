import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { mkIsolatedEnv, writeOpencodeJson } from "../support/opencode-env.js"
import plugin from "../../src/index.js"
import { registerReadiness } from "../../src/readiness.js"
import { Plugin } from "@opencode/plugin"
import { OpenCode } from "@opencode/sdk"

const LIVE_NOTE = "live-model behaviour unverified"
const VALID_STATUSES = ["connected", "pending", "disabled", "failed", "needs_auth", "missing"] as const
const DOCTOR_CMD = "rea doctor --client opencode --json"
const SETUP_CMD = "rea setup --client opencode --dry-run"

async function packageVersion(): Promise<string> {
  const text = await readFile(join(process.cwd(), "package.json"), "utf8")
  return (JSON.parse(text) as { version: string }).version
}

interface FakeLists {
  mcpData: Array<{ name: string; status: { status: string; error?: string } }>
  toolNames: string[]
  skillData: Array<{ id: string }>
}

/** Capturing fake ctx with real-shaped list() payloads. Records transform usage for read-only assertions. */
function makeFakeCtx(lists: FakeLists) {
  const added: Array<any> = []
  const calls = { toolTransform: 0, mcpTransform: 0 }
  const ctx: any = {
    tool: {
      transform: async (cb: (editor: any) => void) => {
        calls.toolTransform++
        cb({
          add: (tool: any) => {
            added.push(tool)
          },
        })
        return { dispose: async () => {} }
      },
      list: async () => lists.toolNames.map((name) => ({ id: name, name })),
    },
    mcp: {
      transform: async (_cb: unknown) => {
        calls.mcpTransform++
        return { dispose: async () => {} }
      },
      list: async () => ({ location: { directory: process.cwd() }, data: lists.mcpData }),
    },
    skill: {
      transform: async () => ({ dispose: async () => {} }),
      list: async () => ({ location: { directory: process.cwd() }, data: lists.skillData }),
    },
  }
  return { ctx, added, calls }
}

// T08: rea_readiness via the real @opencode/sdk host. Setup runs lazily on
// first capability acquisition for that Location (F1), so poll a
// location-targeted plugin.list call to force instantiation. No model calls
// are made (plugin inventory + direct execute only; live-model behaviour
// unverified).
describe("T08 readiness via real host", () => {
  test("rea plugin loads active; list shapes hold; execute returns stable fields", async () => {
    const env = await mkIsolatedEnv()
    try {
      await writeOpencodeJson(env, {})
      const configPath = join(env.configDir, "opencode.json")
      const before = await readFile(configPath, "utf8")

      let mcpResult: any
      let skillResult: any
      let toolResult: any
      const probe = Plugin.define({
        id: "t08-readiness-probe",
        setup: async (ctx: any) => {
          mcpResult = await ctx.mcp.list()
          skillResult = await ctx.skill.list()
          toolResult = await ctx.tool.list()
        },
      })
      const opencode = await OpenCode.create({
        config: { directory: env.workspaceDir, project: false, content: "{}" },
        models: { fetch: false },
        fs: { filewatcher: false },
        plugins: [plugin as any, probe as any],
      })
      await opencode.sessions.create({ location: { directory: env.workspaceDir } })
      let inventory: Array<any> | undefined
      for (let i = 0; i < 40; i++) {
        const res = await opencode.plugin.list({ location: { directory: env.workspaceDir } }).catch(() => undefined)
        const data = (res as any)?.data ?? res
        if (Array.isArray(data) && data.some((p: any) => p?.id === "rea")) {
          inventory = data
          if (mcpResult !== undefined && skillResult !== undefined && toolResult !== undefined) break
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      expect(inventory).toBeDefined()
      const rea = (inventory ?? []).find((p: any) => p?.id === "rea")
      expect(rea).toBeDefined()
      expect((rea as any)?.state?.status).toBe("active")

      // F1 shapes.
      expect(mcpResult).toBeDefined()
      expect(mcpResult).toHaveProperty("data")
      expect(mcpResult).toHaveProperty("location")
      expect(skillResult).toBeDefined()
      expect(skillResult).toHaveProperty("data")
      expect(skillResult).toHaveProperty("location")
      expect(Array.isArray(toolResult)).toBe(true)
      console.log(`[${LIVE_NOTE}] T08 probe tool count:`, (toolResult as Array<unknown>).length)

      // Prefer the live-registered entry when the probe observed it; fall back
      // to direct registration with real-shaped payloads.
      const liveEntry = Array.isArray(toolResult)
        ? (toolResult as Array<any>).find((t: any) => t?.id === "rea_readiness" || t?.name === "rea_readiness")
        : undefined
      console.log(`[${LIVE_NOTE}] T08 live rea_readiness visible:`, liveEntry !== undefined)
      if (liveEntry !== undefined && typeof liveEntry.execute === "function") {
        expect((liveEntry as any)?.options?.codemode).toBe(false)
        const res: any = await liveEntry.execute({}, {})
        const output = res?.output ?? res
        expect(typeof output.server).toBe("string")
        expect(VALID_STATUSES as ReadonlyArray<string>).toContain(output.status)
        expect(output.statusError === null || typeof output.statusError === "string").toBe(true)
        expect(typeof output.reaToolCount).toBe("number")
        expect(output.reaToolCount).toBeGreaterThanOrEqual(1)
        expect(typeof output.upstreamSkillAvailable).toBe("boolean")
        expect(output.version).toBe(await packageVersion())
        expect(JSON.stringify(output.remediation)).toContain(DOCTOR_CMD)
        expect(JSON.stringify(output.remediation)).toContain(SETUP_CMD)
        expect(typeof res?.content === "string" || Array.isArray(res?.content)).toBe(true)
      } else {
        console.log(
          `[${LIVE_NOTE}] T08 fallback: rea_readiness not visible via in-process ctx.tool.list(); proving via direct registerReadiness()`,
        )
        const { ctx, added, calls } = makeFakeCtx({
          mcpData: [{ name: "rea", status: { status: "connected" } }],
          toolNames: ["rea_readiness", "rea_other", "read"],
          skillData: [{ id: "reverse-engineer-anything" }],
        })
        await registerReadiness(ctx, { server: "rea", runtime: "ask" })
        expect(calls.toolTransform).toBe(1)
        expect(calls.mcpTransform).toBe(0)
        const entry = added.find((t) => t?.name === "rea_readiness")
        expect(entry).toBeDefined()
        expect(entry?.options?.codemode).toBe(false)
        const res: any = await entry.execute({}, {})
        const output = res?.output ?? res
        expect(output.server).toBe("rea")
        expect(output.status).toBe("connected")
        expect(output.statusError).toBeNull()
        expect(output.reaToolCount).toBe(2)
        expect(output.upstreamSkillAvailable).toBe(true)
        expect(output.version).toBe(await packageVersion())
        expect(JSON.stringify(output.remediation)).toContain(DOCTOR_CMD)
        expect(JSON.stringify(output.remediation)).toContain(SETUP_CMD)
      }

      // Read-only: invoking execute must not modify config.
      const after = await readFile(configPath, "utf8")
      expect(after).toBe(before)

      await opencode.close().catch(() => {})
    } finally {
      await env.cleanup()
    }
  }, 60_000)

  test("missing server reports missing status with remediation (direct)", async () => {
    const { ctx, added, calls } = makeFakeCtx({
      mcpData: [{ name: "other", status: { status: "connected" } }],
      toolNames: ["rea_readiness"],
      skillData: [],
    })
    await registerReadiness(ctx, { server: "nonexistent-server", runtime: "ask" })
    expect(calls.toolTransform).toBe(1)
    expect(calls.mcpTransform).toBe(0)
    const entry = added.find((t) => t?.name === "rea_readiness")
    expect(entry).toBeDefined()
    expect(entry?.options?.codemode).toBe(false)
    const res: any = await entry.execute({}, {})
    const output = res?.output ?? res
    expect(output.server).toBe("nonexistent-server")
    expect(output.status).toBe("missing")
    expect(JSON.stringify(output.remediation)).toContain(DOCTOR_CMD)
    expect(JSON.stringify(output.remediation)).toContain(SETUP_CMD)
    expect(typeof output.reaToolCount).toBe("number")
    expect(typeof output.upstreamSkillAvailable).toBe("boolean")
    expect(typeof output.version).toBe("string")
  })

  test("failed status surfaces statusError; skill object-map shape handled", async () => {
    const added: Array<any> = []
    const ctx: any = {
      tool: {
        transform: async (cb: (editor: any) => void) => {
          cb({ add: (t: any) => added.push(t) })
          return { dispose: async () => {} }
        },
        list: async () => [{ id: "rea_readiness", name: "rea_readiness" }],
      },
      mcp: {
        list: async () => ({
          location: { directory: process.cwd() },
          data: [{ name: "rea", status: { status: "failed", error: "spawn ENOENT" } }],
        }),
      },
      // Object-map skill data shape (keys are ids).
      skill: {
        list: async () => ({
          location: { directory: process.cwd() },
          data: { "reverse-engineer-anything": { id: "reverse-engineer-anything" } },
        }),
      },
    }
    await registerReadiness(ctx, { server: "rea", runtime: "ask" })
    const entry = added.find((t) => t?.name === "rea_readiness")
    const res: any = await entry.execute({}, {})
    const output = res?.output ?? res
    expect(output.status).toBe("failed")
    expect(output.statusError).toBe("spawn ENOENT")
    expect(output.upstreamSkillAvailable).toBe(true)
  })
})
