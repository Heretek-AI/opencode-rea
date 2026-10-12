import { describe, expect, test } from "bun:test"
import { start, titleAware } from "../support/model-fixture.js"
import { mkIsolatedEnv, runOpencodeRun, writeOpencodeJson } from "../support/opencode-env.js"

const LIVE_NOTE = "live-model behaviour unverified"

describe("T02 E2E smoke: built plugin loads in real CLI", () => {
  test("opencode run with plugin configured returns success", async () => {
    console.log(`[${LIVE_NOTE}] smoke proving built plugin loads in real CLI`)
    // Build must have run so dist/index.js exists
    const dist = await Bun.file("dist/index.js").exists()
    expect(dist).toBe(true)
    const fixture = await start({ responses: [titleAware([{ type: "text", text: "SMOKE-READY" }])] })
    const env = await mkIsolatedEnv()
    try {
      await writeOpencodeJson(env, {
        model: "fixture-test/fixture-model",
        plugins: [process.cwd()],
        providers: {
          "fixture-test": {
            package: "aisdk:@ai-sdk/openai-compatible",
            settings: { baseURL: fixture.baseUrl, apiKey: "local-fixture-key" },
            models: { "fixture-model": { name: "Fixture", capabilities: { tools: true }, limit: { context: 1_000_000, output: 4096 } } },
          },
        },
      })
      const res = await runOpencodeRun(env, ["run", "--standalone", "--format", "json", "--auto", "--print-logs", "--model", "fixture-test/fixture-model", "Say SMOKE-READY."], { timeoutMs: 90_000 })
      console.log(`[${LIVE_NOTE}] smoke exit:`, res.exitCode)
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain("SMOKE-READY")
      expect(fixture.requests.length).toBeGreaterThan(0)
      // The built plugin must load without errors: a broken plugins entry or
      // entrypoint surfaces LoadError diagnostics in the server logs.
      expect(res.stderr).not.toContain("LoadError")
      expect(res.stderr).not.toContain("Plugin must export")
    } finally {
      await env.cleanup()
      await fixture.close()
    }
  }, 120_000)
})
