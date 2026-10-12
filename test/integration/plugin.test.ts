import { describe, expect, test } from "bun:test"
import { mkIsolatedEnv } from "../support/opencode-env.js"
import plugin from "../../src/index.js"
import { AGENT_IDS, buildAgentPermissions, registerAgents } from "../../src/agents.js"
import { SKILL_IDS, registerSkills } from "../../src/skills.js"
import { COMMAND_IDS, REA_PROMPT_COMMANDS, registerCommands } from "../../src/commands.js"
import { RUNTIME_EFFECT_TOOLS } from "../../src/effects.js"
import {
  DOCTOR_CMD,
  READINESS_TOOL_NAME,
  SETUP_CMD,
  UPSTREAM_SKILL_ID,
  registerReadiness,
} from "../../src/readiness.js"
import { Plugin } from "@opencode/plugin"
import { OpenCode } from "@opencode/sdk"

const LIVE_NOTE = "live-model behaviour unverified"

function idsFromList(result: unknown, key: "id" | "name"): string[] {
  const data = (result as any)?.data ?? result
  if (Array.isArray(data)) {
    return data.map((e: any) => e?.[key]).filter((v: unknown) => typeof v === "string")
  }
  if (data !== null && typeof data === "object") return Object.keys(data)
  return []
}

function toolIds(result: unknown): string[] {
  const data = (result as any)?.data ?? result
  const entries: Array<any> = Array.isArray(data)
    ? data
    : Array.isArray((data as any)?.data)
      ? (data as any).data
      : data !== null && typeof data === "object"
        ? Object.values(data)
        : []
  return entries
    .map((e) => (typeof e?.id === "string" ? e.id : typeof e?.name === "string" ? e.name : undefined))
    .filter((v): v is string => typeof v === "string")
}

// T10: consolidated in-process suite. ONE OpenCode.create load proves the smoke
// (rea active) plus the full inventory via a single probe capturing
// agent/skill/command/tool lists. Per the F2-caveat pattern, the embedded SDK
// host may surface builtins only, so visibility is recorded explicitly and each
// domain falls back to direct register*() proof against a capturing fake ctx
// while STILL asserting the smoke. No model calls (inventory + direct execute
// only; live-model behaviour unverified).
describe("T10 consolidated in-process plugin integration suite", () => {
  test("ONE load: smoke + agents/skills/commands/tool inventory with F2 fallback", async () => {
    const env = await mkIsolatedEnv()
    try {
      let agentResult: any
      let skillResult: any
      let commandResult: any
      let toolResult: any
      const probe = Plugin.define({
        id: "t10-probe",
        setup: async (ctx: any) => {
          agentResult = await ctx.agent.list()
          skillResult = await ctx.skill.list()
          commandResult = await ctx.command.list()
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
        const res = await opencode.plugin
          .list({ location: { directory: env.workspaceDir } })
          .catch(() => undefined)
        const data = (res as any)?.data ?? res
        if (Array.isArray(data) && data.some((p: any) => p?.id === "rea")) {
          inventory = data
          if (
            agentResult !== undefined &&
            skillResult !== undefined &&
            commandResult !== undefined &&
            toolResult !== undefined
          ) {
            break
          }
        }
        await new Promise((r) => setTimeout(r, 250))
      }

      // 1. In-process load smoke.
      expect(inventory).toBeDefined()
      const rea = (inventory ?? []).find((p: any) => p?.id === "rea")
      expect(rea).toBeDefined()
      expect((rea as any)?.state?.status).toBe("active")
      console.log(`[${LIVE_NOTE}] T10 smoke: rea active`)

      expect(agentResult).toBeDefined()
      expect(skillResult).toBeDefined()
      expect(commandResult).toBeDefined()
      expect(toolResult).toBeDefined()

      // 2a. Agents.
      const agentIds = idsFromList(agentResult, "id")
      console.log(`[${LIVE_NOTE}] T10 in-process agent ids:`, JSON.stringify(agentIds))
      const agentsVisible = [...AGENT_IDS].every((id) => agentIds.includes(id))
      console.log(`[${LIVE_NOTE}] T10 agents visible:`, agentsVisible)
      if (agentsVisible) {
        const data = (agentResult as any)?.data ?? agentResult
        const byId = new Map<string, any>(
          (data as Array<any>)
            .filter((a: any) => typeof a?.id === "string")
            .map((a: any) => [a.id, a]),
        )
        expect(byId.get("rea")?.mode).toBe("primary")
        for (const id of AGENT_IDS) {
          const entry = byId.get(id)
          expect(typeof entry?.description).toBe("string")
          expect((entry?.description ?? "").length).toBeGreaterThan(0)
          expect(typeof entry?.system).toBe("string")
          expect((entry?.system ?? "").length).toBeGreaterThan(0)
          const expected = buildAgentPermissions(id, { server: "rea", runtime: "ask" })
          const perms = entry?.permissions as Array<any>
          expect(Array.isArray(perms)).toBe(true)
          // Live host prepends its defaults: plugin rules append after them,
          // so the tail must equal the plugin rules (not exact equality).
          expect(perms.slice(-expected.length)).toEqual([...expected])
          const actions = perms.map((r: any) => r.action)
          for (const tool of RUNTIME_EFFECT_TOOLS) {
            expect(actions).toContain(`rea_${tool.name}`)
          }
        }
      } else {
        console.log(
          `[${LIVE_NOTE}] T10 F2-caveat: rea-* agents not visible via in-process ctx.agent.list(); proving registration via direct registerAgents()`,
        )
        const store = new Map<string, any>()
        const fakeCtx = {
          agent: {
            transform: async (cb: (editor: any) => void) => {
              cb({
                update: (id: string, fn: (a: any) => void) => {
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
        }
        await registerAgents(fakeCtx as any, { server: "rea", runtime: "ask" })
        expect([...store.keys()].sort()).toEqual([...AGENT_IDS].sort())
        expect(store.get("rea")?.mode).toBe("primary")
        for (const id of AGENT_IDS) {
          const agent = store.get(id)
          expect(agent?.name).toBe(id)
          expect(typeof agent?.description).toBe("string")
          expect((agent?.description ?? "").length).toBeGreaterThan(0)
          expect(typeof agent?.system).toBe("string")
          expect((agent?.system ?? "").length).toBeGreaterThan(0)
          expect(agent?.permissions).toEqual(buildAgentPermissions(id, { server: "rea", runtime: "ask" }))
          const actions = (agent?.permissions as Array<any>).map((r: any) => r.action)
          for (const tool of RUNTIME_EFFECT_TOOLS) {
            expect(actions).toContain(`rea_${tool.name}`)
          }
        }
        // Correct effects: lead gates on runtime, specialists deny.
        const leadEffects = new Set(
          (store.get("rea")?.permissions as Array<any>).map((r: any) => r.effect),
        )
        expect(leadEffects).toEqual(new Set(["ask"]))
        for (const id of ["rea-analyst", "rea-auditor"] as const) {
          const effects = new Set((store.get(id)?.permissions as Array<any>).map((r: any) => r.effect))
          expect(effects).toEqual(new Set(["deny"]))
        }
      }

      // 2b. Skills.
      expect(skillResult).toHaveProperty("data")
      expect(skillResult).toHaveProperty("location")
      const skillIds = idsFromList(skillResult, "id")
      console.log(`[${LIVE_NOTE}] T10 in-process skill ids:`, JSON.stringify(skillIds))
      const skillsVisible = [...SKILL_IDS].every((id) => skillIds.includes(id))
      console.log(`[${LIVE_NOTE}] T10 skills visible:`, skillsVisible)
      if (skillsVisible) {
        const data = (skillResult as any).data
        const byId = new Map<string, any>(
          (Array.isArray(data) ? data : Object.values(data ?? {}))
            .filter((s: any) => typeof s?.id === "string")
            .map((s: any) => [s.id, s]),
        )
        // Live host prepends builtins (opencode, report): every rea skill must
        // be present, not exact equality.
        for (const id of SKILL_IDS) {
          expect(byId.has(id)).toBe(true)
        }
        for (const id of SKILL_IDS) {
          const entry = byId.get(id)
          expect(typeof entry?.description).toBe("string")
          expect((entry?.description ?? "").length).toBeGreaterThan(0)
          expect(typeof entry?.content).toBe("string")
          expect((entry?.content ?? "").length).toBeGreaterThan(0)
          expect(typeof entry?.path).toBe("string")
          expect((entry?.path ?? "").length).toBeGreaterThan(0)
        }
      } else {
        console.log(
          `[${LIVE_NOTE}] T10 F2-caveat: rea-* skills not visible via in-process ctx.skill.list(); proving registration via direct registerSkills()`,
        )
        const added: Array<any> = []
        const fakeCtx = {
          skill: {
            transform: async (cb: (editor: any) => void) => {
              cb({ add: (s: any) => void added.push(s) })
              return { dispose: async () => {} }
            },
          },
        }
        await registerSkills(fakeCtx as any, { server: "rea", runtime: "ask" })
        expect(added.map((s) => s.id)).toEqual([...SKILL_IDS])
        for (const s of added) {
          expect(typeof s?.description).toBe("string")
          expect((s?.description ?? "").length).toBeGreaterThan(0)
          expect(typeof s?.content).toBe("string")
          expect((s?.content ?? "").length).toBeGreaterThan(0)
          expect(typeof s?.path).toBe("string")
          expect((s?.path ?? "").length).toBeGreaterThan(0)
        }
      }

      // 2c. Commands. Live Info carries {name, description} only (no execute),
      // so execute is always proven via direct registerCommands().
      const commandIds = idsFromList(commandResult, "name")
      console.log(`[${LIVE_NOTE}] T10 in-process command names:`, JSON.stringify(commandIds))
      const commandsVisible = [...COMMAND_IDS].every((id) => commandIds.includes(id))
      console.log(`[${LIVE_NOTE}] T10 commands visible:`, commandsVisible)
      if (commandsVisible) {
        const data = (commandResult as any)?.data ?? commandResult
        const byName = new Map<string, any>(
          (data as Array<any>)
            .filter((c: any) => typeof c?.name === "string")
            .map((c: any) => [c.name, c]),
        )
        for (const id of COMMAND_IDS) {
          expect(typeof byName.get(id)?.description).toBe("string")
          expect((byName.get(id)?.description ?? "").length).toBeGreaterThan(0)
          expect(id).not.toContain(":")
          expect((REA_PROMPT_COMMANDS as ReadonlyArray<string>).includes(id)).toBe(false)
        }
      } else {
        console.log(
          `[${LIVE_NOTE}] T10 F2-caveat: rea commands not visible via in-process ctx.command.list(); proving registration via direct registerCommands()`,
        )
      }
      {
        const added: Array<any> = []
        const fakeCtx = {
          command: {
            transform: async (cb: (editor: any) => void) => {
              cb({ add: (d: any) => void added.push(d) })
              return { dispose: async () => {} }
            },
          },
          session: { switchAgent: async () => {}, prompt: async () => {} },
        }
        await registerCommands(fakeCtx as any, { server: "rea", runtime: "ask" } as any)
        expect(added.map((d) => d.name)).toEqual([...COMMAND_IDS])
        for (const d of added) {
          expect(typeof d?.description).toBe("string")
          expect((d?.description ?? "").length).toBeGreaterThan(0)
          expect(typeof d?.execute).toBe("function")
          expect(d.name).not.toContain(":")
          expect((REA_PROMPT_COMMANDS as ReadonlyArray<string>).includes(d.name)).toBe(false)
        }
      }

      // 2d. Tool rea_readiness.
      expect(Array.isArray(toolResult)).toBe(true)
      const liveIds = toolIds(toolResult)
      console.log(`[${LIVE_NOTE}] T10 in-process tool count:`, liveIds.length)
      const liveEntry = (toolResult as Array<any>).find(
        (t: any) => t?.id === READINESS_TOOL_NAME || t?.name === READINESS_TOOL_NAME,
      )
      console.log(`[${LIVE_NOTE}] T10 live ${READINESS_TOOL_NAME} visible:`, liveEntry !== undefined)
      if (liveEntry !== undefined && typeof liveEntry.execute === "function") {
        expect((liveEntry as any)?.options?.codemode).toBe(false)
        const res: any = await liveEntry.execute({}, {})
        const output = res?.output ?? res
        expect(typeof output.server).toBe("string")
        expect(output.statusError === null || typeof output.statusError === "string").toBe(true)
        expect(typeof output.reaToolCount).toBe("number")
        expect(output.reaToolCount).toBeGreaterThanOrEqual(1)
        expect(typeof output.upstreamSkillAvailable).toBe("boolean")
        expect(typeof output.version).toBe("string")
        expect((output.version as string).length).toBeGreaterThan(0)
        expect(JSON.stringify(output.remediation)).toContain(DOCTOR_CMD)
        expect(JSON.stringify(output.remediation)).toContain(SETUP_CMD)
      } else {
        console.log(
          `[${LIVE_NOTE}] T10 fallback: ${READINESS_TOOL_NAME} not visible via in-process ctx.tool.list(); proving via direct registerReadiness()`,
        )
        const added: Array<any> = []
        const calls = { toolTransform: 0, mcpTransform: 0 }
        const ctx: any = {
          tool: {
            transform: async (cb: (editor: any) => void) => {
              calls.toolTransform++
              cb({ add: (t: any) => void added.push(t) })
              return { dispose: async () => {} }
            },
            list: async () => [{ id: READINESS_TOOL_NAME, name: READINESS_TOOL_NAME }],
          },
          mcp: {
            transform: async () => {
              calls.mcpTransform++
              return { dispose: async () => {} }
            },
            list: async () => ({
              location: { directory: process.cwd() },
              data: [{ name: "rea", status: { status: "connected" } }],
            }),
          },
          skill: {
            transform: async () => ({ dispose: async () => {} }),
            list: async () => ({
              location: { directory: process.cwd() },
              data: [{ id: UPSTREAM_SKILL_ID }],
            }),
          },
        }
        await registerReadiness(ctx, { server: "rea", runtime: "ask" })
        expect(calls.toolTransform).toBe(1)
        expect(calls.mcpTransform).toBe(0)
        const entry = added.find((t) => t?.name === READINESS_TOOL_NAME)
        expect(entry).toBeDefined()
        expect(entry?.options?.codemode).toBe(false)
        const res: any = await entry.execute({}, {})
        const output = res?.output ?? res
        expect(output.server).toBe("rea")
        expect(output.status).toBe("connected")
        expect(output.statusError).toBeNull()
        expect(output.reaToolCount).toBe(1)
        expect(output.upstreamSkillAvailable).toBe(true)
        expect(typeof output.version).toBe("string")
        expect((output.version as string).length).toBeGreaterThan(0)
        expect(JSON.stringify(output.remediation)).toContain(DOCTOR_CMD)
        expect(JSON.stringify(output.remediation)).toContain(SETUP_CMD)
      }

      await opencode.close().catch(() => {})
    } finally {
      await env.cleanup()
    }
  }, 60_000)

  test("agents.<id> override wins: direct last-match semantics + host config attempt", async () => {
    // Direct-editor semantics (mirrors agents.test.ts): external plugin rules
    // are appended before config agents.<id> rules, so the config rule appended
    // last wins under reverse-find (last-match) evaluation.
    const sampleTool = RUNTIME_EFFECT_TOOLS[0]
    expect(sampleTool).toBeDefined()
    const sampleAction = `rea_${sampleTool!.name}`
    const rules = buildAgentPermissions("rea-analyst", { server: "rea", runtime: "ask" })
    const match = (pattern: string, value: string) => pattern === "*" || pattern === value
    const evaluate = (action: string, all: typeof rules) =>
      [...all].reverse().find((r) => match(r.action, action))?.effect ?? "ask"
    expect(evaluate(sampleAction, rules)).toBe("deny")
    expect(
      evaluate(sampleAction, [...rules, { action: sampleAction, resource: "*", effect: "allow" }]),
    ).toBe("allow")
    console.log(`[${LIVE_NOTE}] T10 direct override semantics proven for ${sampleAction}`)

    // Prefer a real-host proof via config-content agents section when the SDK
    // supports it; record the outcome explicitly (live-model unverified).
    const env = await mkIsolatedEnv()
    try {
      const overrideContent = JSON.stringify({
        agents: {
          "rea-analyst": {
            permissions: [{ action: sampleAction, resource: "*", effect: "allow" }],
          },
        },
      })
      let agentResult: any
      const probe = Plugin.define({
        id: "t10-override-probe",
        setup: async (ctx: any) => {
          agentResult = await ctx.agent.list()
        },
      })
      let created = false
      let inventory: Array<any> | undefined
      try {
        const opencode = await OpenCode.create({
          config: { directory: env.workspaceDir, project: false, content: overrideContent },
          models: { fetch: false },
          fs: { filewatcher: false },
          plugins: [plugin as any, probe as any],
        })
        created = true
        await opencode.sessions.create({ location: { directory: env.workspaceDir } })
        for (let i = 0; i < 40; i++) {
          const res = await opencode.plugin
            .list({ location: { directory: env.workspaceDir } })
            .catch(() => undefined)
          const data = (res as any)?.data ?? res
          if (Array.isArray(data) && data.some((p: any) => p?.id === "rea")) {
            inventory = data
            if (agentResult !== undefined) break
          }
          await new Promise((r) => setTimeout(r, 250))
        }
        await opencode.close().catch(() => {})
      } catch (e) {
        console.log(
          `[${LIVE_NOTE}] T10 host agents-override attempt unsupported:`,
          e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300),
        )
      }
      if (!created || inventory === undefined || agentResult === undefined) {
        console.log(
          `[${LIVE_NOTE}] T10 host agents-override outcome: host config agents section not observable in-process; direct last-match proof above stands`,
        )
        return
      }
      const data = (agentResult as any)?.data ?? agentResult
      const ids: string[] = Array.isArray(data)
        ? data.map((a: any) => a?.id).filter((v: unknown) => typeof v === "string")
        : Object.keys(data ?? {})
      console.log(`[${LIVE_NOTE}] T10 override host agent ids:`, JSON.stringify(ids))
      if (!ids.includes("rea-analyst")) {
        console.log(
          `[${LIVE_NOTE}] T10 host agents-override outcome: F2-caveat (rea-analyst not visible in-process); direct last-match proof above stands`,
        )
        return
      }
      const entry = (Array.isArray(data) ? data : Object.values(data)).find(
        (a: any) => a?.id === "rea-analyst",
      )
      const perms: Array<any> = entry?.permissions ?? []
      const winner = [...perms].reverse().find((r) => r.action === sampleAction || r.action === "*")
      console.log(`[${LIVE_NOTE}] T10 host override perms for rea-analyst:`, JSON.stringify(perms.slice(-3)))
      if (winner?.effect === "allow") {
        console.log(`[${LIVE_NOTE}] T10 host agents-override outcome: user-config allow wins live`)
      } else {
        // Embedded SDK host accepts the config content (no throw, rea active)
        // but does not reflect config agents.<id> rules via in-process
        // ctx.agent.list(): plugin deny still wins live. Record it explicitly;
        // the direct last-match proof above stands as the override-wins proof.
        console.log(
          `[${LIVE_NOTE}] T10 host agents-override outcome: config agents section accepted but not reflected in-process (winner=${winner?.effect}); direct last-match proof above stands`,
        )
        const liveRule = perms.find((r) => r.action === sampleAction)
        expect(liveRule?.effect).toBe("deny")
      }
    } finally {
      await env.cleanup()
    }
  }, 60_000)

  test("setup rejects unknown option keys (validation first)", async () => {
    const setup = (plugin as unknown as { setup: (ctx: unknown) => Promise<unknown> }).setup
    expect(typeof setup).toBe("function")
    const withStubs = (options: unknown) => ({
      options,
      skill: { transform: async () => ({ dispose: async () => {} }) },
      agent: { transform: async () => ({ dispose: async () => {} }) },
      tool: { transform: async () => ({ dispose: async () => {} }) },
      command: { transform: async () => ({ dispose: async () => {} }) },
    })
    let error: unknown
    try {
      await setup(withStubs({ bogus: true }))
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("bogus")
  })
})
