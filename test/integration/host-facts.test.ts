import { describe, expect, test } from "bun:test"
import { start, titleAware } from "../support/model-fixture.js"
import { mkIsolatedEnv, runOpencodeRun, writeOpencodeJson } from "../support/opencode-env.js"
import plugin from "../../src/index.js"
import { Plugin } from "@opencode/plugin"
import { OpenCode } from "@opencode/sdk"

const LIVE_NOTE = "live-model behaviour unverified"

// F1: exact return shape of ctx.mcp.list(), ctx.skill.list(), ctx.tool.list() in Promise API
// Proven: Promise plugin setup runs lazily on first session creation for that
// Location (not at OpenCode.create time). ctx.mcp.list()/ctx.skill.list()
// resolve to { location, data }; ctx.tool.list() resolves to an Array.
describe("F1 host list shapes", () => {
  test("ctx.mcp.list / ctx.skill.list / ctx.tool.list shapes", async () => {
    console.log(`[${LIVE_NOTE}] F1 proving Promise plugin list shapes via real SDK`)
    let captured: any = {}
    const probe = Plugin.define({
      id: "t02-f1-probe",
      setup: async (ctx: any) => {
        const mcp = await ctx.mcp.list()
        const skill = await ctx.skill.list()
        const tool = await ctx.tool.list()
        captured = { mcp, skill, tool }
      },
    })
    const f1env = await mkIsolatedEnv()
    let opencode: Awaited<ReturnType<typeof OpenCode.create>> | undefined
    try {
      opencode = await OpenCode.create({
        config: { directory: f1env.workspaceDir, project: false, content: "{}" },
        models: { fetch: false },
        fs: { filewatcher: false },
        plugins: [plugin, probe as any],
      })
      // Plugin setup is Location-scoped and lazy: it runs on first capability
      // acquisition for that Location (not at create/session time). Poll a
      // location-targeted list call to force instantiation.
      await opencode.sessions.create({ location: { directory: f1env.workspaceDir } })
      for (let i = 0; i < 40 && captured.mcp === undefined; i++) {
        await opencode.plugin.list({ location: { directory: f1env.workspaceDir } }).catch(() => undefined)
        if (captured.mcp !== undefined) break
        await new Promise((r) => setTimeout(r, 250))
      }
    console.log(`[${LIVE_NOTE}] F1 mcp keys:`, JSON.stringify(Object.keys(captured.mcp ?? {})))
    console.log(`[${LIVE_NOTE}] F1 skill keys:`, JSON.stringify(Object.keys(captured.skill ?? {})))
    console.log(`[${LIVE_NOTE}] F1 tool sample:`, JSON.stringify(Array.isArray(captured.tool) ? captured.tool.length : typeof captured.tool))
    expect(captured.mcp).toBeDefined()
    expect(captured.skill).toBeDefined()
    expect(captured.tool).toBeDefined()
    // Real shapes: { location, data } for mcp/skill, Array for tool
    expect(captured.mcp).toHaveProperty("data")
    expect(captured.mcp).toHaveProperty("location")
    expect(captured.skill).toHaveProperty("data")
    expect(captured.skill).toHaveProperty("location")
    expect(Array.isArray(captured.tool)).toBe(true)
    } finally {
      await opencode?.close().catch(() => {})
      await f1env.cleanup()
    }
  }, 30_000)
})

// F2: OpenCode v2 discovers ~/.agents/skills/reverse-engineer-anything in isolated home.
// Proven through the REAL CLI: the scripted model calls the native `skill` tool
// and the host loads SKILL.md from the isolated HOME (marker echoed back into
// the model request). NOTE: the in-process embedded SDK host does NOT surface
// ~/.agents/skills via ctx.skill.list() (builtins only); the full CLI server
// path does. Both outcomes are recorded in AGENTS.md.
describe("F2 skill discovery", () => {
  test("isolated home skill is discovered", async () => {
    console.log(`[${LIVE_NOTE}] F2 proving ~/.agents/skills discovery via real CLI`)
    const MARKER = "REA-F2-MARKER-7f3a9c"
    const fixture = await start({
      responses: [
        titleAware([
          { type: "tool", tool: "skill", args: { id: "reverse-engineer-anything" } },
          { type: "text", text: "F2-CLI-DONE" },
        ]),
      ],
    })
    const env = await mkIsolatedEnv()
    try {
      const skillDir = `${env.home}/.agents/skills/reverse-engineer-anything`
      const { mkdir, writeFile } = await import("node:fs/promises")
      await mkdir(skillDir, { recursive: true })
      await writeFile(
        `${skillDir}/SKILL.md`,
        `---\nname: reverse-engineer-anything\ndescription: REA test skill\n---\n\n# REA\n${MARKER}\n`,
      )
      await writeOpencodeJson(env, {
        model: "fixture-test/fixture-model",
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
      const res = await runOpencodeRun(
        env,
        ["run", "--standalone", "--format", "json", "--auto", "--model", "fixture-test/fixture-model", "Load the reverse-engineer-anything skill."],
        { timeoutMs: 120_000 },
      )
      console.log(`[${LIVE_NOTE}] F2 exit:`, res.exitCode)
      expect(res.exitCode).toBe(0)
      // The host must surface a native tool_use for the scripted skill call...
      expect(res.stdout).toContain("tool_use")
      // ...and the loaded SKILL.md body (marker) must reach the model request,
      // proving the skill was discovered under the isolated HOME.
      const bodies = fixture.requests.map((r) => JSON.stringify(r.body))
      console.log(`[${LIVE_NOTE}] F2 requests:`, fixture.requests.length, "marker:", bodies.some((b) => b.includes(MARKER)))
      expect(bodies.some((b) => b.includes(MARKER))).toBe(true)
      expect(bodies.some((b) => b.includes("reverse-engineer-anything"))).toBe(true)
    } finally {
      await env.cleanup()
      await fixture.close()
    }
  }, 150_000)
})

// F3: @opencode/cli installed from npm runs; event shapes of `opencode run --format json`
describe("F3 CLI run event shapes", () => {
  test("opencode run --format json emits typed JSON lines", async () => {
    console.log(`[${LIVE_NOTE}] F3 proving real CLI run + JSON event shapes`)
    const fixture = await start({ responses: [titleAware([{ type: "text", text: "F3-OK" }])] })
    const env = await mkIsolatedEnv()
    try {
      await writeOpencodeJson(env, {
        model: "fixture-test/fixture-model",
        providers: {
          "fixture-test": {
            package: "aisdk:@ai-sdk/openai-compatible",
            settings: { baseURL: fixture.baseUrl, apiKey: "local-fixture-key" },
            models: { "fixture-model": { name: "Fixture", capabilities: { tools: true }, limit: { context: 1_000_000, output: 4096 } } },
          },
        },
      })
      const res = await runOpencodeRun(env, ["run", "--standalone", "--format", "json", "--model", "fixture-test/fixture-model", "Say F3-OK briefly."], { timeoutMs: 90_000 })
      console.log(`[${LIVE_NOTE}] F3 exit:`, res.exitCode)
      const lines = res.stdout.split("\n").filter((l) => l.trim().startsWith("{"))
      console.log(`[${LIVE_NOTE}] F3 json lines:`, lines.length, lines.slice(0, 3).map((l) => { try { return (JSON.parse(l) as any).type } catch { return "?" } }))
      expect(res.exitCode).toBe(0)
      expect(lines.length).toBeGreaterThan(0)
      const types = lines.map((l) => { try { return (JSON.parse(l) as any).type as string } catch { return "" } })
      expect(types.every((t) => typeof t === "string" && t.length > 0)).toBe(true)
      expect(res.stdout).toContain("F3-OK")
      // Every parsed line must carry sessionID + timestamp (noninteractive emit shape)
      for (const l of lines.slice(0, 5)) {
        const o = JSON.parse(l) as any
        expect(o).toHaveProperty("type")
        expect(o).toHaveProperty("timestamp")
        expect(o).toHaveProperty("sessionID")
      }
    } finally {
      await env.cleanup()
      await fixture.close()
    }
  }, 120_000)
})

// F4: ask permission behaviour with and without --auto.
// Proven with a real permission-requesting scenario: the scripted model calls
// the native `shell` tool while `shell` is configured `ask`. Without --auto the
// host auto-rejects with feedback (tool_use error, run continues, exit 0);
// with --auto the host approves once and the command output reaches the model.
describe("F4 ask permission behaviour", () => {
  test("documents exit/behaviour difference with and without --auto", async () => {
    console.log(`[${LIVE_NOTE}] F4 proving ask-permission difference`)
    const runOnce = async (extraArgs: string[]) => {
      const fx = await start({
        responses: [
          titleAware([
            { type: "tool", tool: "shell", args: { command: "echo F4-PERM-OK" } },
            { type: "text", text: "F4 done" },
          ]),
        ],
      })
      const e = await mkIsolatedEnv()
      try {
        await writeOpencodeJson(e, {
          model: "fixture-test/fixture-model",
          permissions: [{ action: "shell", resource: "*", effect: "ask" }],
          providers: {
            "fixture-test": {
              package: "aisdk:@ai-sdk/openai-compatible",
              settings: { baseURL: fx.baseUrl, apiKey: "local-fixture-key" },
              models: { "fixture-model": { name: "Fixture", capabilities: { tools: true }, limit: { context: 1_000_000, output: 4096 } } },
            },
          },
        })
        const res = await runOpencodeRun(e, ["run", "--standalone", "--format", "json", "--model", "fixture-test/fixture-model", ...extraArgs, "Run echo F4-PERM-OK via shell."], { timeoutMs: 90_000 })
        return { res, bodies: fx.requests.map((r) => JSON.stringify(r.body)) }
      } finally {
        await e.cleanup()
        await fx.close()
      }
    }
    const withoutAuto = await runOnce([])
    const withAuto = await runOnce(["--auto"])
    console.log(`[${LIVE_NOTE}] F4 exits: withoutAuto=${withoutAuto.res.exitCode} withAuto=${withAuto.res.exitCode}`)
    const toolParts = (stdout: string) =>
      stdout.split("\n").filter((l) => l.includes('"tool_use"')).map((l) => { try { return (JSON.parse(l) as any).part } catch { return undefined } }).filter(Boolean)
    const denied = toolParts(withoutAuto.res.stdout)
    const allowed = toolParts(withAuto.res.stdout)
    console.log(`[${LIVE_NOTE}] F4 denied states:`, JSON.stringify(denied.map((p: any) => p?.state?.status)), "allowed states:", JSON.stringify(allowed.map((p: any) => p?.state?.status)))
    // Non-interactive v2 continues after auto-reject, so both runs exit 0; the
    // behaviour difference is visible in the tool result states...
    expect(withoutAuto.res.exitCode).toBe(0)
    expect(withAuto.res.exitCode).toBe(0)
    expect(denied.length).toBeGreaterThan(0)
    expect(allowed.length).toBeGreaterThan(0)
    expect(denied.some((p: any) => p?.state?.status === "error")).toBe(true)
    expect(allowed.some((p: any) => p?.state?.status === "completed")).toBe(true)
    // ...and in what reaches the model: real command output only with --auto.
    expect(withAuto.bodies.some((b) => b.includes("F4-PERM-OK"))).toBe(true)
  }, 240_000)
})

// F5: whether scripted model reaches REA tools natively or only through Code Mode execute
describe("F5 tool routing", () => {
  test("scripted tool_call reaches host tools; records native vs execute routing", async () => {
    console.log(`[${LIVE_NOTE}] F5 proving tool-call routing in default config`)
    const env = await mkIsolatedEnv()
    const fixture = await start({
      responses: [
        titleAware([
          { type: "tool", tool: "read", args: { path: `${env.workspaceDir}/t02-f5.txt` } },
          { type: "text", text: "F5-ROUTED" },
        ]),
      ],
    })
    try {
      await writeOpencodeJson(env, {
        model: "fixture-test/fixture-model",
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
        providers: {
          "fixture-test": {
            package: "aisdk:@ai-sdk/openai-compatible",
            settings: { baseURL: fixture.baseUrl, apiKey: "local-fixture-key" },
            models: { "fixture-model": { name: "Fixture", capabilities: { tools: true }, limit: { context: 1_000_000, output: 4096 } } },
          },
        },
      })
      await Bun.write(`${env.workspaceDir}/t02-f5.txt`, "hello-f5")
      const res = await runOpencodeRun(env, ["run", "--standalone", "--format", "json", "--auto", "--model", "fixture-test/fixture-model", "Read the file t02-f5.txt and report."], { timeoutMs: 90_000 })
      console.log(`[${LIVE_NOTE}] F5 exit:`, res.exitCode)
      const toolUses = res.stdout.split("\n").filter((l) => l.includes('"tool_use"')).slice(0, 5)
      console.log(`[${LIVE_NOTE}] F5 tool_use events:`, toolUses.length)
      // The fixture offered a read tool call; host must surface at least one tool_use event.
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain("tool_use")
      // Record whether routing went through native read vs execute: inspect event payload tool names
      const names = toolUses.map((l) => { try { return (JSON.parse(l) as any).part?.tool ?? (JSON.parse(l) as any).part?.type } catch { return "?" } })
      console.log(`[${LIVE_NOTE}] F5 tool names:`, JSON.stringify(names))
      // Natively routed: the host executes `read` itself (not via Code Mode `execute`).
      expect(names).toContain("read")
      // Real file bytes must reach the model request (no canned responses).
      expect(fixture.requests.map((r) => JSON.stringify(r.body)).some((b) => b.includes("hello-f5"))).toBe(true)
      // Fixture saw tool-capable requests (proves model reached host tool loop, not canned)
      expect(fixture.requests.length).toBeGreaterThan(0)
    } finally {
      await env.cleanup()
      await fixture.close()
    }
  }, 120_000)
})

// F6: REA verifier V1 vs V2 note
describe("F6 V2 provenance", () => {
  test("records CLI version string + platform for V2 proof", async () => {
    console.log(`[${LIVE_NOTE}] F6 proving V2 provenance (V1 was opencode-ai@1.18.35 POSIX only)`)
    const env = await mkIsolatedEnv()
    try {
      const ver = await runOpencodeRun(env, ["--version"], { timeoutMs: 30_000 })
      console.log(`[${LIVE_NOTE}] F6 version:`, ver.stdout.trim(), "platform:", process.platform)
      expect(ver.exitCode).toBe(0)
      expect(ver.stdout).toContain("2.0.26")
      expect(["linux", "darwin"].includes(process.platform)).toBe(true)
    } finally {
      await env.cleanup()
    }
  }, 30_000)
})
