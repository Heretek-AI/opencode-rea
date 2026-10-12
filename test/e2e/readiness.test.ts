import { describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { DOCTOR_CMD, READINESS_TOOL_NAME, SETUP_CMD } from "../../src/readiness.js"
import { start, titleAware } from "../support/model-fixture.js"
import { mkIsolatedEnv, runOpencodeRun, writeOpencodeJson } from "../support/opencode-env.js"

const LIVE_NOTE = "live-model behaviour unverified"

describe("T11 E2E readiness: missing server reports remediation, config unchanged", () => {
  test("rea_readiness reports missing server with remediation and leaves config unchanged", async () => {
    console.log(`[${LIVE_NOTE}] T11 proving rea_readiness missing-server path via real CLI`)
    // Plugin must be built so the real CLI can load the built artifact.
    const built = join(process.cwd(), "dist", "index.js")
    expect(await Bun.file(built).exists()).toBe(true)

    const fixture = await start({
      responses: [
        titleAware([
          { type: "tool", tool: READINESS_TOOL_NAME, args: {} },
          { type: "text", text: "T11-READINESS-DONE" },
        ]),
      ],
    })
    const env = await mkIsolatedEnv()
    try {
      // The built plugin directory has no root index.js, which the real CLI's
      // Bun directory resolution silently drops (no entrypoint, no LoadError;
      // proven: plugins entry [process.cwd()] never offers rea_readiness).
      // Wrap it in a tmp plugin dir whose index.js re-exports the built
      // artifact, so the CLI loads the exact dist bytes under test.
      const wrapper = join(env.root, "rea-plugin")
      await mkdir(wrapper, { recursive: true })
      await writeFile(join(wrapper, "package.json"), JSON.stringify({ name: "t11-rea-wrapper", type: "module" }))
      await writeFile(join(wrapper, "index.js"), `export { default } from ${JSON.stringify(built)};\n`)

      // Isolated env with the plugin but NO rea setup (no mcp entry).
      const configPath = await writeOpencodeJson(env, {
        model: "fixture-test/fixture-model",
        plugins: [wrapper],
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
        providers: {
          "fixture-test": {
            package: "aisdk:@ai-sdk/openai-compatible",
            settings: { baseURL: fixture.baseUrl, apiKey: "local-fixture-key" },
            models: {
              "fixture-model": {
                name: "Fixture",
                capabilities: { tools: true },
                limit: { context: 1_000_000, output: 4096 },
              },
            },
          },
        },
      })
      const before = await Bun.file(configPath).text()
      expect(JSON.parse(before).mcp).toBeUndefined()

      const res = await runOpencodeRun(
        env,
        ["run", "--standalone", "--format", "json", "--auto", "--model", "fixture-test/fixture-model", "Check REA readiness with the rea_readiness tool and report the result."],
        { timeoutMs: 120_000 },
      )
      console.log(`[${LIVE_NOTE}] T11 exit:`, res.exitCode)
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain("tool_use")
      expect(res.stdout).toContain(READINESS_TOOL_NAME)

      // The missing status + remediation must reach the model requests
      // (tool result is fed back into the follow-up request).
      const bodies = fixture.requests.map((r) => JSON.stringify(r.body))
      console.log(`[${LIVE_NOTE}] T11 requests:`, fixture.requests.length)
      expect(bodies.some((b) => b.includes("missing"))).toBe(true)
      expect(bodies.some((b) => b.includes(DOCTOR_CMD) || b.includes("rea doctor"))).toBe(true)
      expect(bodies.some((b) => b.includes(SETUP_CMD) || b.includes("rea setup"))).toBe(true)

      // Read-only tool: config file must be byte-for-byte unchanged.
      const after = await Bun.file(configPath).text()
      expect(after).toBe(before)
    } finally {
      await env.cleanup()
      await fixture.close()
    }
  }, 150_000)
})
