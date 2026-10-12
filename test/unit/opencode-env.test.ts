import { describe, expect, test } from "bun:test"
import { stat } from "node:fs/promises"
import { mkIsolatedEnv, providerFragment, runReaSetup, writeOpencodeJson } from "../support/opencode-env.js"

const LIVE_NOTE = "live-model behaviour unverified"

describe("opencode-env helpers", () => {
  test("mkIsolatedEnv isolates HOME/XDG and cleans up", async () => {
    const env = await mkIsolatedEnv()
    try {
      for (const dir of [env.home, env.configDir, env.dataDir, env.cacheDir, env.workspaceDir]) {
        expect((await stat(dir)).isDirectory()).toBe(true)
      }
      expect(env.env.HOME).toBe(env.home)
      expect(env.env.OPENCODE_TEST_HOME).toBe(env.home)
      expect(env.env.OPENCODE_CONFIG_DIR).toBe(env.configDir)
      expect(env.env.HOME).not.toBe(process.env.HOME)
      // No HOME leak into the test process itself.
      expect(process.env.HOME).not.toBe(env.home)
    } finally {
      const root = env.root
      await env.cleanup()
      await expect(stat(root)).rejects.toThrow()
    }
  })

  test("writeOpencodeJson writes v2 providers entry at OPENCODE_CONFIG_DIR/opencode.json", async () => {
    const env = await mkIsolatedEnv()
    try {
      const path = await writeOpencodeJson(env, providerFragment("http://127.0.0.1:9/v1"))
      expect(path).toBe(`${env.configDir}/opencode.json`)
      const cfg = (await Bun.file(path).json()) as any
      expect(cfg.model).toBe("fixture-test/fixture-model")
      expect(cfg.providers["fixture-test"].package).toBe("aisdk:@ai-sdk/openai-compatible")
      expect(cfg.providers["fixture-test"].settings.baseURL).toBe("http://127.0.0.1:9/v1")
      expect(cfg.providers["fixture-test"].models["fixture-model"].capabilities.tools).toBe(true)
    } finally {
      await env.cleanup()
    }
  })

  test("runReaSetup dry-run plans opencode client without writing", async () => {
    console.log(`[${LIVE_NOTE}] rea dry-run via real rea-agents binary`)
    const env = await mkIsolatedEnv()
    try {
      const res = await runReaSetup(env, ["--dry-run"], { timeoutMs: 60_000 })
      expect(res.exitCode).toBe(0)
      const parsed = JSON.parse(res.stdout) as any
      expect(parsed.status).toBe("planned")
      expect(JSON.stringify(parsed.plannedActions)).toContain("opencode")
      // Dry-run writes nothing.
      expect(await Bun.file(`${env.configDir}/opencode.json`).exists()).toBe(false)
    } finally {
      await env.cleanup()
    }
  }, 90_000)
})
