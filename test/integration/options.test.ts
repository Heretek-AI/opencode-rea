import { describe, expect, test } from "bun:test"
import { mkIsolatedEnv } from "../support/opencode-env.js"
import plugin from "../../src/index.js"
import { OpenCode } from "@opencode/sdk"

// T04: the real rea plugin registers through the real @opencode/sdk host and
// its setup validates default options (embedded SDK passes options: {}) without
// throwing. Setup runs lazily on first capability acquisition for that Location
// (F1 fact), so poll a location-targeted list call to force instantiation, then
// assert the inventory shows rea healthy (not failed).
//
// Finding: ctx.options reaches setup only via config `plugins: [{package,
// options}]` on the full server path (core plugin/module.ts injects
// operation.options); the embedded SDK path always passes `options: {}` (core
// plugin/host.ts). Host-level injection of bad options is therefore not
// possible via OpenCode.create — bad-option throws are covered by the pure
// parseOptions unit tests + the direct-setup wiring test in
// test/unit/options.test.ts.
describe("T04 options boundary via real host", () => {
  test("real plugin setup succeeds on defaults (smoke)", async () => {
    const env = await mkIsolatedEnv()
    let opencode: Awaited<ReturnType<typeof OpenCode.create>> | undefined
    try {
      opencode = await OpenCode.create({
        config: { directory: env.workspaceDir, project: false, content: "{}" },
        models: { fetch: false },
        fs: { filewatcher: false },
        plugins: [plugin as any],
      })
      await opencode.sessions.create({ location: { directory: env.workspaceDir } })
      let inventory: Array<any> | undefined
      for (let i = 0; i < 40; i++) {
        const res = await opencode.plugin.list({ location: { directory: env.workspaceDir } }).catch(() => undefined)
        const data = (res as any)?.data ?? res
        if (Array.isArray(data) && data.some((p: any) => p?.id === "rea")) {
          inventory = data
          break
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      expect(inventory).toBeDefined()
      const rea = (inventory ?? []).find((p: any) => p?.id === "rea")
      expect(rea).toBeDefined()
      // Healthy: setup must have run without throwing (a setup throw would
      // mark it failed — verified with a throwing-setup negative control).
      expect((rea as any)?.state?.status).toBe("active")
    } finally {
      await opencode?.close().catch(() => {})
      await env.cleanup()
    }
  }, 30_000)
})
