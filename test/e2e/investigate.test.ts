import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { start, titleAware, type ScriptedResponse } from "../support/model-fixture.js"
import { mkIsolatedEnv, runOpencodeRun, runReaSetup, writeOpencodeJson } from "../support/opencode-env.js"
import { parseAgentFile } from "../../src/agents.js"

const LIVE_NOTE = "live-model behaviour unverified"

// NOTE (deviation from spike fact 4, verified against rea-agents 6.4.0):
// Evidence embeds source *identifiers* verbatim (function names, binding
// labels, module paths, node ids) but NOT string-literal return values.
// Fixture markers are therefore distinctive function identifiers; the return
// literals are kept for ticket shape but are not asserted.
const MARKERS = ["t12Add7f3a9c", "t12Multiply421337", "t12Greet3e8b21", "t12Helper5d2f77"]
const FINAL_TEXT = "T12-INVESTIGATION-DONE t12Add7f3a9c t12Multiply421337 t12Greet3e8b21 t12Helper5d2f77"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("T12 E2E golden path: investigate fixture JS app with real REA", () => {
  test("setup installs rea, scripted model drives real analyze tool, Evidence reaches model", async () => {
    console.log(`[${LIVE_NOTE}] T12 golden path proving real REA investigation end to end`)
    // Build must have run so dist/index.js exists (build itself stays outside the test).
    if (!(await Bun.file("dist/index.js").exists())) {
      throw new Error("run bun run build first")
    }
    const FIXTURE_ABS = join(process.cwd(), "test", "fixtures", "js-app")
    expect(existsSync(join(FIXTURE_ABS, "index.js"))).toBe(true)
    expect(existsSync(join(FIXTURE_ABS, "lib.js"))).toBe(true)

    // Host limitation (proven by AgentNotFoundError): a plugin-registered
    // agent id is NOT resolvable via `run --agent` at session-select time —
    // plugin setup is lazy per Location and select runs first. Seed the same
    // `rea` definition (single-sourced from agents/rea.md) via config
    // `agents` so the ticket's `--agent rea` invocation resolves; the
    // plugin's registerAgents upsert still applies on top during the run.
    const agentRaw = await readFile(join(process.cwd(), "agents", "rea.md"), "utf8")
    const agentParsed = parseAgentFile(agentRaw, "rea")

    // Exact MCP tool name unknown statically (rea_ prefix inside OpenCode, per
    // skills/rea-opencode/SKILL.md): discover it from the advertised tools
    // list in the request body. One-shot inside titleAware's queue —
    // titleAware shifts queued entries per tool-capable request (only its
    // outer wrapper is sticky), so each fires once; the trailing final-text
    // entry ends the run, so the analyze tool cannot be called in a loop.
    // MCP schema (probed live against rea-agents 6.4.0 tools/list): the
    // analyze tool requires `input_path`, not `path`.
    const findAnalyzeTool = (body: any): string | undefined => {
      const tools = (body?.tools ?? []) as any[]
      const names = tools.map((t) => t?.function?.name ?? t?.name ?? "")
      return names.find((n) => typeof n === "string" && n.includes("analyze_javascript_application"))
    }
    const flow = { reaCalls: 0 }
    const discoverA = ({ body }: { body: any; requestIndex: number }): ScriptedResponse => {
      const tools = (body?.tools ?? []) as any[]
      const found = findAnalyzeTool(body)
      console.log(`[${LIVE_NOTE}] T12 discoverA: ${tools.length} advertised tools; analyze:`, found ?? "(none)")
      if (found) {
        flow.reaCalls++
        return { type: "tool", tool: found, args: { input_path: FIXTURE_ABS } }
      }
      // Stay alive for a retry: read a marker-free filler file (package.json
      // carries no T12 markers, so a later marker sighting still proves an
      // Evidence round-trip, not this filler).
      return { type: "tool", tool: "read", args: { path: join(FIXTURE_ABS, "package.json") } }
    }
    // The host offloads large MCP results to a tool-output file and hands the
    // model a pointer ("full output saved to .../tool-output/tool_*"), and
    // its `read` tool pages by lines — useless for REA's single-line JSON
    // (only ~2.4KB of 237KB comes back). So extract the assertable Evidence
    // bytes with a `shell` grep over the REAL output file: marker identifiers,
    // node ids, and evidence ids land inline in a later model request (F4
    // pattern proves shell output reaches the model; no canned REA responses
    // anywhere — grep reads the live server artifact).
    const followup = ({ body }: { body: any; requestIndex: number }): ScriptedResponse => {
      const text = JSON.stringify(body)
      const match = text.match(/\/[^\s"']*tool-output\/tool_[A-Za-z0-9]+/)
      const grepIt = (path: string): ScriptedResponse => ({
        type: "tool",
        tool: "shell",
        args: { command: `grep -o -e 't12[A-Za-z0-9]*' -e 'jag_node_[a-f0-9]*' -e 'jsrg_node_[a-f0-9]*' -e 'ev_[a-f0-9]*' '${path}' | sort -u` },
      })
      if (match) {
        console.log(`[${LIVE_NOTE}] T12 followup: extracting Evidence markers from`, match[0])
        return grepIt(match[0])
      }
      const found = findAnalyzeTool(body)
      if (found && flow.reaCalls < 2) {
        console.log(`[${LIVE_NOTE}] T12 followup: no pointer yet, retrying analyze call`)
        flow.reaCalls++
        return { type: "tool", tool: found, args: { input_path: FIXTURE_ABS } }
      }
      return { type: "text", text: `T12-ANALYZE-UNAVAILABLE reaCalls=${flow.reaCalls}` }
    }
    // Cold-boot accommodation (measured: rea `mcp` answers initialize ~1.9s
    // after spawn; the host connects in the background while the session
    // runs): delay the skill turns so discovery sees the full 170-tool
    // catalog deterministically instead of racing it.
    const delayed = (ms: number, resp: ScriptedResponse): ScriptedResponse => (async () => {
      await sleep(ms)
      return resp
    }) as ScriptedResponse

    const fixture = await start({
      responses: [
        titleAware([
          delayed(5000, { type: "tool", tool: "skill", args: { id: "rea-opencode" } }),
          delayed(5000, { type: "tool", tool: "skill", args: { id: "reverse-engineer-anything" } }),
          discoverA,
          followup,
          { type: "text", text: FINAL_TEXT },
        ]),
      ],
    })
    const env = await mkIsolatedEnv()
    try {
      // Host limitation (proven: a plugin dir without a root index.js is
      // silently never loaded — package.json main/exports are ignored for
      // local plugin dirs): stage the BUILT plugin (dist + skills + agents,
      // symlinked so the test always exercises the current build) under a
      // staging dir with a root index.js re-export. No repo packaging change.
      const stageDir = join(env.root, "plugin")
      await mkdir(stageDir, { recursive: true })
      for (const name of ["dist", "skills", "agents", "package.json"]) {
        await symlink(join(process.cwd(), name), join(stageDir, name))
      }
      await writeFile(join(stageDir, "index.js"), `export { default } from "./dist/index.js"\n`)
      expect(existsSync(join(stageDir, "index.js"))).toBe(true)

      await writeOpencodeJson(env, {
        model: "fixture-test/fixture-model",
        plugins: [stageDir],
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
        agents: { rea: { description: agentParsed.description, mode: "primary", system: agentParsed.body } },
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

      const setupRes = await runReaSetup(env, [], { timeoutMs: 120_000 })
      console.log(`[${LIVE_NOTE}] T12 rea setup exit:`, setupRes.exitCode, "stdout:", setupRes.stdout.slice(0, 300))
      if (setupRes.exitCode !== 0) {
        console.log(`[${LIVE_NOTE}] T12 setup stderr:`, setupRes.stderr.slice(0, 1000))
      }
      expect(setupRes.exitCode).toBe(0)

      // Setup writes a flat `mcp.rea` entry. Assert the registration, then
      // move it to the documented `mcp.servers` shape with `codemode: false`
      // (proven: flat-shape entries connect, but their tools are only exposed
      // via Code Mode `execute`; codemode:false keeps rea_* on the provider's
      // native tool list where the scripted model can call them).
      const cfgPath = join(env.configDir, "opencode.json")
      const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as any
      expect(JSON.stringify(cfg.mcp ?? {})).toContain('"rea"')
      expect(JSON.stringify(cfg.mcp?.rea?.command ?? [])).toContain("mcp")
      cfg.mcp = { servers: { rea: { ...cfg.mcp.rea, codemode: false } } }
      await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + "\n")

      const skillPath = join(env.home, ".agents", "skills", "reverse-engineer-anything", "SKILL.md")
      console.log(`[${LIVE_NOTE}] T12 upstream skill installed:`, existsSync(skillPath))
      expect(existsSync(skillPath)).toBe(true)

      const prompt =
        `Investigate the JavaScript application at ${FIXTURE_ABS}: ` +
        `load the rea-opencode skill, then run the REA JavaScript application analysis on that directory and summarize the exported functions.`
      const res = await runOpencodeRun(
        env,
        ["run", "--standalone", "--agent", "rea", "--format", "json", "--auto", "--print-logs", "--model", "fixture-test/fixture-model", prompt],
        { timeoutMs: 300_000 },
      )
      console.log(`[${LIVE_NOTE}] T12 opencode run exit:`, res.exitCode)
      if (res.exitCode !== 0) {
        console.log(`[${LIVE_NOTE}] T12 run stderr:`, res.stderr.slice(-2000))
      }
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain("T12-INVESTIGATION-DONE")

      // The host must surface a native tool_use for the REA analyze call
      // (prefix-tolerant: rea_ prefix inside OpenCode) that COMPLETED on the
      // real server, plus a completed load of the plugin's rea-opencode skill
      // (proves plugin registration end to end).
      const toolUseLines = res.stdout.split("\n").filter((l) => l.includes("tool_use"))
      console.log(`[${LIVE_NOTE}] T12 tool_use lines:`, toolUseLines.length)
      const completed = toolUseLines.filter((l) => l.includes('"completed"'))
      console.log(`[${LIVE_NOTE}] T12 completed tool_use lines:`, completed.length)
      const analyzeCompleted = completed.some((l) => l.includes("analyze_javascript_application"))
      const pluginSkillLoaded = completed.some((l) => l.includes('"skill"') && l.includes("rea-opencode"))
      const upstreamSkillLoaded = completed.some((l) => l.includes('"skill"') && l.includes("reverse-engineer-anything"))
      console.log(
        `[${LIVE_NOTE}] T12 analyzeCompleted:${analyzeCompleted} pluginSkill:${pluginSkillLoaded} upstreamSkill:${upstreamSkillLoaded}`,
      )
      expect(res.stdout).toContain("tool_use")
      expect(analyzeCompleted).toBe(true)
      expect(pluginSkillLoaded).toBe(true)
      expect(upstreamSkillLoaded).toBe(true)

      // Real Evidence round-trip: the read-back of the tool-output file must
      // carry the fixture markers (and graph node ids) into a later model
      // request. NOTE: bare `evidence_id` also appears in REA tool-schema
      // descriptions, so markers — unique to this fixture's Evidence — are
      // the load-bearing proof; per-request marker presence is logged.
      const bodies = fixture.requests.map((r) => JSON.stringify(r.body))
      console.log(`[${LIVE_NOTE}] T12 model requests:`, fixture.requests.length)
      expect(bodies.some((b) => b.includes("rea_analyze_javascript_application"))).toBe(true)
      expect(bodies.some((b) => b.includes("reverse-engineer-anything"))).toBe(true)
      expect(bodies.some((b) => b.includes("rea-opencode") || b.includes("REA in OpenCode"))).toBe(true)
      expect(bodies.some((b) => b.includes("evidence_id"))).toBe(true)
      expect(bodies.some((b) => b.includes("tool-output/tool_"))).toBe(true)
      expect(
        bodies.some((b) => b.includes("jag_node_") || b.includes("jsrg_node_") || b.includes("graph_id")),
      ).toBe(true)
      for (const marker of MARKERS) {
        const hits = bodies.map((b, i) => (b.includes(marker) ? i + 1 : -1)).filter((i) => i > 0)
        console.log(`[${LIVE_NOTE}] T12 marker ${marker} in requests:`, JSON.stringify(hits))
        expect(hits.length).toBeGreaterThan(0)
      }
    } finally {
      await env.cleanup()
      await fixture.close()
    }
  }, 420_000)
})
