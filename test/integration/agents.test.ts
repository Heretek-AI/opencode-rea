import { describe, expect, test } from "bun:test"
import { mkIsolatedEnv } from "../support/opencode-env.js"
import plugin from "../../src/index.js"
import { AGENT_IDS, buildAgentPermissions, registerAgents } from "../../src/agents.js"
import { RUNTIME_EFFECT_TOOLS } from "../../src/effects.js"
import { Plugin } from "@opencode/plugin"
import { OpenCode } from "@opencode/sdk"

// T07: the real rea plugin registers its 4 dedicated agents through the real
// @opencode/sdk host. Setup runs lazily on first capability acquisition for
// that Location (F1 fact), so poll a location-targeted list call to force
// instantiation. Per the F2-caveat pattern from skills.test.ts, the in-process
// embedded SDK host may surface builtins only via ctx.agent.list(), so agent
// visibility is recorded explicitly and the test falls back to asserting
// registration via direct registerAgents() against a capturing fake ctx plus
// the in-process load smoke (rea active, no failure). No model calls are made
// (plugin inventory only, no opencode run; live-model behaviour unverified).
describe("T07 agents via real host", () => {
  test("rea plugin loads active; agent list shape holds; rea-* visibility recorded with fallback", async () => {
    const env = await mkIsolatedEnv()
    try {
      let agentListResult: any
      const probe = Plugin.define({
        id: "t07-agent-probe",
        setup: async (ctx: any) => {
          agentListResult = await ctx.agent.list()
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
          if (agentListResult !== undefined) break
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      // In-process load smoke: rea must be present and healthy.
      expect(inventory).toBeDefined()
      const rea = (inventory ?? []).find((p: any) => p?.id === "rea")
      expect(rea).toBeDefined()
      expect((rea as any)?.state?.status).toBe("active")

      // Probe shape check: record whatever ctx.agent.list() returns in-process
      // (live-model behaviour unverified).
      expect(agentListResult).toBeDefined()
      console.log(
        "[live-model behaviour unverified] T07 in-process agent.list keys:",
        JSON.stringify(Object.keys(agentListResult ?? {})),
      )
      const data = (agentListResult as any)?.data ?? agentListResult
      const ids: string[] = Array.isArray(data)
        ? data.map((a: any) => a?.id).filter((id: unknown) => typeof id === "string")
        : Object.keys(data ?? {})
      console.log("[live-model behaviour unverified] T07 in-process agent ids:", JSON.stringify(ids))
      const visible = [...AGENT_IDS].every((id) => ids.includes(id))
      if (!visible) {
        // F2-caveat outcome: in-process host shows builtins only. Record it
        // and fall back to direct registration proof for every runtime option
        // value plus server-prefix parameterization.
        console.log(
          "[live-model behaviour unverified] T07 F2-caveat: rea-* agents not visible via in-process ctx.agent.list(); proving registration via direct registerAgents()",
        )
        for (const runtime of ["ask", "allow", "deny"] as const) {
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
          await registerAgents(fakeCtx as any, { server: "rea", runtime })
          expect([...store.keys()].sort()).toEqual([...AGENT_IDS].sort())
          expect(store.get("rea")?.mode).toBe("primary")
          for (const id of AGENT_IDS) {
            const agent = store.get(id)
            expect(agent?.name).toBe(id)
            expect((agent?.description ?? "").length).toBeGreaterThan(0)
            expect((agent?.system ?? "").length).toBeGreaterThan(0)
            expect(agent?.permissions).toEqual(buildAgentPermissions(id, { server: "rea", runtime }))
          }
          // Lead keeps defaults: no edit/subagent/shell denies; specialists deny all three.
          expect(store.get("rea")?.permissions.some((r: any) => r.action === "edit")).toBe(false)
          expect(store.get("rea")?.permissions.some((r: any) => r.action === "shell")).toBe(false)
          for (const id of ["rea-analyst", "rea-runtime", "rea-auditor"] as const) {
            expect(store.get(id)?.permissions).toContainEqual({ action: "edit", resource: "*", effect: "deny" })
            expect(store.get(id)?.permissions).toContainEqual({ action: "subagent", resource: "*", effect: "deny" })
            expect(store.get(id)?.permissions).toContainEqual({ action: "shell", resource: "*", effect: "deny" })
          }
          // Runtime-effect tool coverage on every agent.
          for (const id of AGENT_IDS) {
            const actions = (store.get(id)?.permissions as Array<any>).map((r) => r.action)
            for (const tool of RUNTIME_EFFECT_TOOLS) {
              expect(actions).toContain(`rea_${tool.name}`)
            }
          }
        }
        // Server-prefix parameterization through the real register path.
        {
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
          await registerAgents(fakeCtx as any, { server: "custom", runtime: "allow" })
          const actions = (store.get("rea")?.permissions as Array<any>).map((r) => r.action)
          expect(actions.every((a: string) => a.startsWith("custom_"))).toBe(true)
        }
        // User-config override wins, documented via direct editor semantics:
        // external plugins activate before config plugins, so the config rule
        // is appended last and wins under last-match evaluation.
        {
          const rules = buildAgentPermissions("rea-analyst", { server: "rea", runtime: "ask" })
          const match = (pattern: string, value: string) => pattern === "*" || pattern === value
          const evaluate = (action: string, all: typeof rules) =>
            [...all].reverse().find((r) => match(r.action, action))?.effect ?? "ask"
          expect(evaluate("rea_capture_process_scenario", rules)).toBe("deny")
          expect(
            evaluate("rea_capture_process_scenario", [
              ...rules,
              { action: "rea_capture_process_scenario", resource: "*", effect: "allow" },
            ]),
          ).toBe("allow")
        }
      } else {
        expect(visible).toBe(true)
        // Live visibility: assert the registered permission rules per agent
        // (defaults use runtime "ask"; live-model behaviour unverified).
        const byId = new Map<string, any>(
          (data as Array<any>).filter((a: any) => typeof a?.id === "string").map((a: any) => [a.id, a]),
        )
        const perms = (id: string): Array<any> => byId.get(id)?.permissions ?? []
        expect(perms("rea")).toContainEqual({ action: "rea_capture_process_scenario", resource: "*", effect: "ask" })
        expect(perms("rea").some((r: any) => r.action === "edit" && r.effect === "deny")).toBe(false)
        expect(perms("rea").some((r: any) => r.action === "subagent" && r.effect === "deny")).toBe(false)
        expect(perms("rea").some((r: any) => r.action === "shell" && r.effect === "deny")).toBe(false)
        for (const id of ["rea-analyst", "rea-auditor"] as const) {
          expect(perms(id)).toContainEqual({ action: "edit", resource: "*", effect: "deny" })
          expect(perms(id)).toContainEqual({ action: "subagent", resource: "*", effect: "deny" })
          expect(perms(id)).toContainEqual({ action: "shell", resource: "*", effect: "deny" })
          expect(perms(id)).toContainEqual({ action: "rea_capture_process_scenario", resource: "*", effect: "deny" })
        }
        expect(perms("rea-runtime")).toContainEqual({ action: "edit", resource: "*", effect: "deny" })
        expect(perms("rea-runtime")).toContainEqual({ action: "subagent", resource: "*", effect: "deny" })
        expect(perms("rea-runtime")).toContainEqual({ action: "shell", resource: "*", effect: "deny" })
        expect(perms("rea-runtime")).toContainEqual({
          action: "rea_capture_process_scenario",
          resource: "*",
          effect: "ask",
        })
        for (const id of AGENT_IDS) {
          const actions = perms(id).map((r: any) => r.action)
          for (const tool of RUNTIME_EFFECT_TOOLS) {
            expect(actions).toContain(`rea_${tool.name}`)
          }
          expect(typeof byId.get(id)?.description).toBe("string")
          expect((byId.get(id)?.description ?? "").length).toBeGreaterThan(0)
        }
        expect(byId.get("rea")?.mode).toBe("primary")
      }
      await opencode.close().catch(() => {})
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
