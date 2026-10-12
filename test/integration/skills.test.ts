import { describe, expect, test } from "bun:test"
import { mkIsolatedEnv } from "../support/opencode-env.js"
import plugin from "../../src/index.js"
import { registerSkills, SKILL_IDS } from "../../src/skills.js"
import { Plugin } from "@opencode/plugin"
import { OpenCode } from "@opencode/sdk"

// T05: the real rea plugin registers its 4 dedicated skills through the real
// @opencode/sdk host. Setup runs lazily on first capability acquisition for
// that Location (F1 fact), so poll a location-targeted list call to force
// instantiation. Per the F2 caveat, the in-process embedded SDK host surfaces
// builtins only (`opencode`, `report`) via ctx.skill.list(), so plugin skills
// may NOT be visible in-process: that outcome is recorded explicitly and the
// test falls back to asserting registration via direct registerSkills()
// against a capturing fake ctx plus the in-process load smoke (rea active, no
// failure). No model calls are made (plugin inventory only, no opencode run;
// live-model behaviour unverified).
describe("T05 skills via real host", () => {
  test("rea plugin loads active; skill list shape holds; rea-* visibility recorded with fallback", async () => {
    const env = await mkIsolatedEnv()
    try {
      let skillListResult: any
      const probe = Plugin.define({
        id: "t05-skill-probe",
        setup: async (ctx: any) => {
          skillListResult = await ctx.skill.list()
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
          if (skillListResult !== undefined) break
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      // In-process load smoke: rea must be present and healthy.
      expect(inventory).toBeDefined()
      const rea = (inventory ?? []).find((p: any) => p?.id === "rea")
      expect(rea).toBeDefined()
      expect((rea as any)?.state?.status).toBe("active")

      // Probe shape check (F1): { location, data }.
      expect(skillListResult).toBeDefined()
      expect(skillListResult).toHaveProperty("data")
      expect(skillListResult).toHaveProperty("location")
      const data = (skillListResult as any).data
      const ids: string[] = Array.isArray(data)
        ? data.map((s: any) => s?.id).filter((id: unknown) => typeof id === "string")
        : Object.keys(data ?? {})
      console.log("[live-model behaviour unverified] T05 in-process skill ids:", JSON.stringify(ids))
      const visible = [...SKILL_IDS].every((id) => ids.includes(id))
      if (!visible) {
        // F2-caveat outcome: in-process host shows builtins only. Record it
        // and fall back to direct registration proof.
        console.log(
          "[live-model behaviour unverified] T05 F2-caveat: rea-* skills not visible via in-process ctx.skill.list(); proving registration via direct registerSkills()",
        )
        const added: Array<{ id: string }> = []
        const fakeCtx = {
          skill: {
            transform: async (cb: (editor: { add: (s: { id: string }) => void }) => void) => {
              cb({ add: (s: { id: string }) => void added.push(s) })
              return { dispose: async () => {} }
            },
          },
        }
        await registerSkills(fakeCtx as any, { server: "rea", runtime: "ask" })
        expect(added.map((s) => s.id)).toEqual([...SKILL_IDS])
      } else {
        expect(visible).toBe(true)
      }
      await opencode.close().catch(() => {})
    } finally {
      await env.cleanup()
    }
  }, 60_000)
})
