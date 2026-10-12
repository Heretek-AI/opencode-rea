import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { start, titleAware, type ScriptedResponse } from "../support/model-fixture.js"
import { mkIsolatedEnv, runOpencodeRun, runReaSetup, writeOpencodeJson, type IsolatedEnv } from "../support/opencode-env.js"
import { buildAgentPermissions, parseAgentFile } from "../../src/agents.js"

const LIVE_NOTE = "live-model behaviour unverified"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function requireBuilt(): Promise<void> {
  if (!(await Bun.file("dist/index.js").exists())) {
    throw new Error("run bun run build first")
  }
}

// T12 staging pattern: the built plugin dir has no root index.js (which the
// real CLI's Bun directory resolution silently drops), so stage symlinks to
// dist+skills+agents+package.json under a staging dir with a root index.js
// re-export. The test always exercises the current build.
async function stagePlugin(env: IsolatedEnv): Promise<string> {
  const stageDir = join(env.root, "plugin")
  await mkdir(stageDir, { recursive: true })
  for (const name of ["dist", "skills", "agents", "package.json"]) {
    await symlink(join(process.cwd(), name), join(stageDir, name))
  }
  await writeFile(join(stageDir, "index.js"), `export { default } from "./dist/index.js"\n`)
  return stageDir
}

// Host limitation (T12, proven by AgentNotFoundError): a plugin-registered
// agent id is NOT resolvable via `run --agent` at session-select time —
// plugin setup is lazy per Location and select runs first. Seed the same
// definitions (single-sourced from agents/*.md) via config `agents` so the
// `--agent <id>` invocation resolves; the plugin's registerAgents upsert
// still applies the permission rules on top during the run.
async function seedAgents(ids: Array<{ id: string; mode: "primary" | "subagent" }>): Promise<Record<string, { description: string; mode: string; system: string }>> {
  const out: Record<string, { description: string; mode: string; system: string }> = {}
  for (const { id, mode } of ids) {
    const raw = await readFile(join(process.cwd(), "agents", `${id}.md`), "utf8")
    const parsed = parseAgentFile(raw, id)
    out[id] = { description: parsed.description, mode, system: parsed.body }
  }
  return out
}

function providers(baseUrl: string): Record<string, unknown> {
  return {
    "fixture-test": {
      package: "aisdk:@ai-sdk/openai-compatible",
      settings: { baseURL: baseUrl, apiKey: "local-fixture-key" },
      models: {
        "fixture-model": {
          name: "Fixture",
          capabilities: { tools: true },
          limit: { context: 1_000_000, output: 4096 },
        },
      },
    },
  }
}

// F4 pattern: parse tool_use parts from newline-delimited --format json stdout.
function toolParts(stdout: string): any[] {
  return stdout
    .split("\n")
    .filter((l) => l.includes('"tool_use"'))
    .map((l) => {
      try {
        return (JSON.parse(l) as any).part
      } catch {
        return undefined
      }
    })
    .filter(Boolean)
}

function summarizeParts(parts: any[]): string {
  return JSON.stringify(parts.map((p: any) => ({ tool: p?.tool, status: p?.state?.status })))
}

// QA hardening (D1/D2): extract human-readable error text from --format json
// tool_use parts. The CLI emits MiniToolPart where state.error is a STRING
// (event.data.error.message); the session schema uses an OBJECT
// {type,message}. Handle both so the permission-regex assert is robust.
function errorTexts(parts: any[]): string[] {
  return parts
    .filter((p: any) => p?.state?.status === "error")
    .map((p: any) => {
      const e = p?.state?.error
      if (typeof e === "string") return e
      if (e && typeof e === "object") {
        const joined = [e.message, e.type, e.text, e.feedback].filter((s) => typeof s === "string" && s.length > 0).join(" | ")
        return joined.length > 0 ? joined : JSON.stringify(e)
      }
      return JSON.stringify(p?.state ?? "")
    })
}

describe("T13 delegation: rea delegates to rea-analyst through subagent", () => {
  test("rea delegates to rea-analyst through subagent and receives its result", async () => {
    console.log(`[${LIVE_NOTE}] T13 test 1 proving delegation through the native subagent tool`)
    await requireBuilt()

    // The bare marker is named in the delegation prompt, so ordering is
    // asserted on the FULL child-result string (marker + " static finding"),
    // which originates ONLY from the scripted child response: it first
    // appears in a parent request after the child session ran, proving the
    // result flowed back through the subagent tool result.
    const CHILD_TOKEN = "T13-CHILD-PROMPT-4d8e22"
    const CHILD_RESULT = "T13-ANALYST-RESULT-9f2c71 static finding"
    const FINAL_TEXT = "T13-DELEGATION-DONE T13-ANALYST-RESULT-9f2c71"

    const fixture = await start({
      responses: [
        titleAware([
          // Parent turn 1: delegate. (Parent turn consumes entry 1.)
          {
            type: "tool",
            tool: "subagent",
            args: {
              agent: "rea-analyst",
              description: "T13 delegation probe",
              prompt: `T13 delegation probe ${CHILD_TOKEN}: reply with the code T13-ANALYST-RESULT-9f2c71 followed by one sentence of static-analysis context.`,
            },
          },
          // Child session turn: the child (running rea-analyst on the same
          // fixture model) answers with the marker. (Child consumes entry 2.)
          { type: "text", text: CHILD_RESULT },
          // Parent followup after the subagent result lands: report.
          { type: "text", text: FINAL_TEXT },
        ]),
      ],
    })
    const env = await mkIsolatedEnv()
    try {
      const stageDir = await stagePlugin(env)
      await writeOpencodeJson(env, {
        model: "fixture-test/fixture-model",
        plugins: [stageDir],
        // Host-level allow-all so agent-level rules are what get exercised.
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
        agents: await seedAgents([
          { id: "rea", mode: "primary" },
          { id: "rea-analyst", mode: "subagent" },
        ]),
        providers: providers(fixture.baseUrl),
      })

      const prompt =
        `Delegate a bounded static question to the rea-analyst specialist via the subagent tool, ` +
        `then report T13-DELEGATION-DONE along with whatever code it returned.`
      const res = await runOpencodeRun(
        env,
        ["run", "--standalone", "--agent", "rea", "--format", "json", "--auto", "--print-logs", "--model", "fixture-test/fixture-model", prompt],
        { timeoutMs: 300_000 },
      )
      console.log(`[${LIVE_NOTE}] T13 test 1 opencode run exit:`, res.exitCode)
      if (res.exitCode !== 0) {
        console.log(`[${LIVE_NOTE}] T13 test 1 run stderr:`, res.stderr.slice(-2000))
      }
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain("T13-DELEGATION-DONE")
      expect(res.stdout).toContain("tool_use")

      const parts = toolParts(res.stdout)
      console.log(`[${LIVE_NOTE}] T13 test 1 tool_use parts:`, summarizeParts(parts))
      const subagentParts = parts.filter((p: any) => typeof p?.tool === "string" && (p.tool as string).includes("subagent"))
      expect(subagentParts.length).toBeGreaterThan(0)
      expect(subagentParts.some((p: any) => p?.state?.status === "completed")).toBe(true)

      const bodies = fixture.requests.map((r) => JSON.stringify(r.body))
      console.log(`[${LIVE_NOTE}] T13 test 1 model requests:`, fixture.requests.length)
      expect(bodies.some((b) => b.includes("rea-analyst"))).toBe(true)
      const firstIdx = (s: string) => bodies.findIndex((b) => b.includes(s))
      const childPromptIdx = firstIdx(CHILD_TOKEN)
      const resultIdx = firstIdx(CHILD_RESULT)
      console.log(`[${LIVE_NOTE}] T13 test 1 child-prompt first in request:`, childPromptIdx + 1, "child-result first in request:", resultIdx + 1)
      expect(childPromptIdx).toBeGreaterThanOrEqual(0)
      // The full child-result string cannot exist before the child session
      // ran: it appears in a LATER request than the delegation prompt,
      // proving the subagent result returned to the parent.
      expect(resultIdx).toBeGreaterThan(childPromptIdx)
    } finally {
      await env.cleanup()
      await fixture.close()
    }
  }, 300_000)
})

describe("T13 permissions: edit attempted as rea-auditor is denied", () => {
  test("edit attempted as rea-auditor is denied", async () => {
    console.log(`[${LIVE_NOTE}] T13 test 2 proving agent-level edit deny for rea-auditor`)
    await requireBuilt()

    // Deterministic unit cross-check alongside the E2E asserts: the auditor
    // rules must deny the `edit` action (which edit/write/patch share).
    const auditorRules = buildAgentPermissions("rea-auditor", { server: "rea", runtime: "ask" })
    expect(auditorRules.some((r) => r.action === "edit" && r.effect === "deny")).toBe(true)

    const env = await mkIsolatedEnv()
    // The native `write` tool input schema (verified live against
    // node_modules/@opencode/core/dist/chunks/location-services-0gyy4w8j.js):
    // write = Struct({ path: String, content: String }); its permission
    // action is `edit`, so the auditor deny fires on it. No host-level
    // permissions are configured (see deviation note below): the agent deny
    // is then the last matching rule and must fire even with --auto.
    const target = join(env.workspaceDir, "t13-audit-probe.txt")
    const fixture = await start({
      responses: [
        titleAware([
          { type: "tool", tool: "write", args: { path: target, content: "T13-AUDIT-PAYLOAD\n" } },
          { type: "text", text: "T13-AUDIT-DONE" },
        ]),
      ],
    })
    try {
      const stageDir = await stagePlugin(env)
      // DEVIATION from the ticket spec (proven by probe, round 1): the spec
      // prescribes host-level `permissions: allow-all` so agent denies are
      // exercised, but on this host (opencode 2.0.26) that defeats every
      // deny. Cause: the host's config-agent bootstrap (prior-art
      // config/plugin/agent.ts) pushes global `permissions` onto EVERY
      // agent AFTER plugin transforms, and evaluation is last-match
      // (permission.ts evaluate/findLast over merge(agent, session)). With
      // allow-all present the write completed and the file was created
      // (probe: rea_readiness completed + write completed). Omitting host
      // permissions leaves the agent deny as the last (only) match for the
      // tested action, so the deny fires; unrelated actions fall back to the
      // default ask behaviour.
      await writeOpencodeJson(env, {
        model: "fixture-test/fixture-model",
        plugins: [stageDir],
        agents: await seedAgents([{ id: "rea-auditor", mode: "subagent" }]),
        providers: providers(fixture.baseUrl),
      })

      const res = await runOpencodeRun(
        env,
        ["run", "--standalone", "--agent", "rea-auditor", "--format", "json", "--auto", "--print-logs", "--model", "fixture-test/fixture-model",
          `Attempt to write the file ${target} with the content T13-AUDIT-PAYLOAD, then report T13-AUDIT-DONE.`],
        { timeoutMs: 180_000 },
      )
      console.log(`[${LIVE_NOTE}] T13 test 2 opencode run exit:`, res.exitCode)
      if (res.exitCode !== 0) {
        console.log(`[${LIVE_NOTE}] T13 test 2 run stderr:`, res.stderr.slice(-2000))
      }
      // F4 pattern: the run continues past the denial and exits 0.
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain("T13-AUDIT-DONE")
      expect(res.stdout).toContain("tool_use")

      const parts = toolParts(res.stdout)
      console.log(`[${LIVE_NOTE}] T13 test 2 tool_use parts:`, summarizeParts(parts))
      const writeParts = parts.filter((p: any) => p?.tool === "write")
      expect(writeParts.length).toBeGreaterThan(0)
      expect(writeParts.some((p: any) => p?.state?.status === "error")).toBe(true)
      // QA hardening (D1): the deny must surface as a permission-flavoured
      // error, not just any error. LIVE DEVIATION (observed 2026-10-12):
      // actual deny-path text is
      //   "No tool named \"write\" is currently available. Please use a tool from the available tool list."
      // which does NOT match /permission|denied|not allowed|rejected/i — the
      // host hides the wholly-denied write tool from the catalog and the
      // scripted call fails generically. Per ticket rule the regex assert is
      // NOT added (no faking); the texts are logged for the record and the
      // status asserts above stay as-is.
      const writeErrors = errorTexts(writeParts)
      console.log(`[${LIVE_NOTE}] T13 test 2 write error texts:`, JSON.stringify(writeErrors).slice(0, 2000))
      expect(writeErrors.length).toBeGreaterThan(0)
      // A completed-state write must NOT appear: the deny must hold.
      expect(writeParts.some((p: any) => p?.state?.status === "completed")).toBe(false)
      // The file must NOT have been created.
      expect(existsSync(target)).toBe(false)
    } finally {
      await env.cleanup()
      await fixture.close()
    }
  }, 240_000)
})

describe("T13 permissions: runtime-effect tool gated by agent and runtime option", () => {
  // capture_process_scenario is the runtime-effect tool with the simplest
  // completable shape: only `executable` is required (verified live against
  // node_modules/rea-agents/dist/domain/process/processScenario.js —
  // strictObject with every other field defaulted), and running /usr/bin/true
  // needs no open binary, no session, and no attached device. All rea_* bytes
  // below come from the live rea-agents MCP server; no canned REA responses.
  const RUNTIME_TOOL_FRAGMENT = "capture_process_scenario"
  const RUNTIME_ARGS = { executable: "/usr/bin/true" }

  const findRuntimeTool = (body: any): string | undefined => {
    const tools = (body?.tools ?? []) as any[]
    const names = tools.map((t) => t?.function?.name ?? t?.name ?? "")
    return names.find((n) => typeof n === "string" && n.includes(RUNTIME_TOOL_FRAGMENT))
  }

  interface RuntimeFlow {
    calls: number
    advertised: string[]
  }

  const delayed = (ms: number, resp: ScriptedResponse): ScriptedResponse => (async () => {
    await sleep(ms)
    return resp
  }) as ScriptedResponse

  // Shared per-case runner: isolated env + fixture + staged plugin + live rea
  // setup, then one `opencode run` asserting the permission-state signal.

  test("runtime-effect tool denied for analyst, gated by runtime option for rea-runtime", async () => {
    console.log(`[${LIVE_NOTE}] T13 test 3 proving runtime-effect gating against the live REA server`)
    await requireBuilt()

    // Deterministic unit cross-checks: analyst denies the runtime tool
    // action; rea-runtime gates it on the runtime option.
    const analystRules = buildAgentPermissions("rea-analyst", { server: "rea", runtime: "ask" })
    expect(analystRules.some((r) => r.action === "rea_capture_process_scenario" && r.effect === "deny")).toBe(true)
    const runtimeAskRules = buildAgentPermissions("rea-runtime", { server: "rea", runtime: "ask" })
    expect(runtimeAskRules.some((r) => r.action === "rea_capture_process_scenario" && r.effect === "ask")).toBe(true)
    const runtimeAllowRules = buildAgentPermissions("rea-runtime", { server: "rea", runtime: "allow" })
    expect(runtimeAllowRules.some((r) => r.action === "rea_capture_process_scenario" && r.effect === "allow")).toBe(true)
    // QA hardening (D4): pure unit cover for the deny option value.
    const runtimeDenyRules = buildAgentPermissions("rea-runtime", { server: "rea", runtime: "deny" })
    expect(runtimeDenyRules.some((r) => r.action === "rea_capture_process_scenario" && r.effect === "deny")).toBe(true)

    const runCase = async (c: {
      label: string
      agentId: "rea-analyst" | "rea-runtime"
      pluginOptions?: Record<string, unknown>
      auto: boolean
      // "hidden": the deny removes the tool from the model catalog
      // (whollyDisabled), so no tool_use can occur — assert absence with an
      // MCP-connected proof via a non-gated sibling tool. "error": the call
      // is attempted and surfaces error with no completed. "completed": the
      // call reaches the live server and completes.
      expectation: "hidden" | "error" | "completed"
      finalText: string
    }): Promise<void> => {
      console.log(`[${LIVE_NOTE}] T13 test 3 ${c.label}: agent=${c.agentId} auto=${c.auto} expectation=${c.expectation}`)
      const flow: RuntimeFlow = { calls: 0, advertised: [] }
      // Filler fallback (read) fires only if the MCP catalog has not
      // converged yet; the filler path is per-case so it is parameterized.
      const callRuntimeWithFiller = (filler: string) => ({ body }: { body: any; requestIndex: number }): ScriptedResponse => {
        const tools = (body?.tools ?? []) as any[]
        if (flow.advertised.length === 0) {
          flow.advertised = tools.map((t) => t?.function?.name ?? t?.name ?? "").filter((n) => typeof n === "string" && (n as string).includes("rea_")).slice(0, 10) as string[]
          console.log(`[${LIVE_NOTE}] T13 test 3 ${c.label} advertised rea_* tools sample:`, JSON.stringify(flow.advertised))
        }
        const found = findRuntimeTool(body)
        // Log the advertised tool def once for debuggability (arg shape for
        // the allow-path must match the live server).
        const def = tools.find((t) => (t?.function?.name ?? t?.name ?? "") === found)
        if (def) console.log(`[${LIVE_NOTE}] T13 test 3 ${c.label} runtime tool def:`, JSON.stringify(def).slice(0, 800))
        else console.log(`[${LIVE_NOTE}] T13 test 3 ${c.label} discover: ${tools.length} advertised tools; runtime tool: (none)`)
        if (found) {
          flow.calls++
          return { type: "tool", tool: found, args: { ...RUNTIME_ARGS } }
        }
        return { type: "tool", tool: "read", args: { path: filler } }
      }
      const followup = ({ body }: { body: any; requestIndex: number }): ScriptedResponse => {
        const found = findRuntimeTool(body)
        if (found && flow.calls < 2) {
          console.log(`[${LIVE_NOTE}] T13 test 3 ${c.label} followup: retrying runtime call`)
          flow.calls++
          return { type: "tool", tool: found, args: { ...RUNTIME_ARGS } }
        }
        return { type: "text", text: c.finalText }
      }
      const env = await mkIsolatedEnv()
      const filler = join(env.workspaceDir, "t13-filler.txt")
      await writeFile(filler, "t13 runtime filler without markers\n")
      const fixture = await start({
        responses: [
          titleAware([
            // Cold-boot accommodation (T12: two 5s delayed skill turns before
            // discovery; the rea `mcp` catalog is not converged at session
            // start). Two delayed filler turns buy ~14s+ so the discovery
            // turn sees the full ~170-tool MCP catalog. NOTE: denied tools
            // are hidden from LATER snapshots (whollyDisabled), so the
            // discovery call must land while the catalog still advertises
            // the tool and the deny fires at execution — the same window
            // test 2 proves for the write tool.
            delayed(7000, { type: "tool", tool: "read", args: { path: filler } }),
            delayed(7000, callRuntimeWithFiller(filler)),
            followup,
            { type: "text", text: c.finalText },
          ]),
        ],
      })
      try {
        const stageDir = await stagePlugin(env)
        // Host permissions OMITTED here (same deviation as test 2): a
        // host-level wildcard allow would be appended after the plugin's
        // agent rules by the host config bootstrap and last-match-win over
        // both the analyst deny (3a) and the runtime ask gate (3b). With no
        // host rule matching the tested action, the agent rule is the last
        // match: deny fires for 3a, ask auto-rejects for 3b (no --auto),
        // allow reaches the live server for 3c (plugin options runtime
        // allow + --auto).
        const plugins: unknown[] = c.pluginOptions ? [{ package: stageDir, options: c.pluginOptions }] : [stageDir]
        await writeOpencodeJson(env, {
          model: "fixture-test/fixture-model",
          plugins,
          agents: await seedAgents([{ id: c.agentId, mode: "subagent" }]),
          providers: providers(fixture.baseUrl),
        })

        const setupRes = await runReaSetup(env, [], { timeoutMs: 120_000 })
        console.log(`[${LIVE_NOTE}] T13 test 3 ${c.label} rea setup exit:`, setupRes.exitCode)
        expect(setupRes.exitCode).toBe(0)
        const cfgPath = join(env.configDir, "opencode.json")
        const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as any
        expect(JSON.stringify(cfg.mcp ?? {})).toContain('"rea"')
        cfg.mcp = { servers: { rea: { ...cfg.mcp.rea, codemode: false } } }
        await writeFile(cfgPath, JSON.stringify(cfg, null, 2) + "\n")

        const args = ["run", "--standalone", "--agent", c.agentId, "--format", "json"]
        if (c.auto) args.push("--auto")
        args.push("--print-logs", "--model", "fixture-test/fixture-model",
          `Run the REA process-scenario capture tool on /usr/bin/true with default settings, then report ${c.finalText}.`)
        const res = await runOpencodeRun(env, args, { timeoutMs: 300_000 })
        console.log(`[${LIVE_NOTE}] T13 test 3 ${c.label} opencode run exit:`, res.exitCode)
        // Always log the server-stderr tail: MCP connection progress (or
        // failure) is diagnosed here, not in stdout.
        console.log(`[${LIVE_NOTE}] T13 test 3 ${c.label} stderr tail:`, res.stderr.slice(-1500))
        if (res.exitCode !== 0) {
          console.log(`[${LIVE_NOTE}] T13 test 3 ${c.label} run stderr full tail:`, res.stderr.slice(-2000))
        }
        expect(res.exitCode).toBe(0)
        expect(res.stdout).toContain(c.finalText)
        expect(res.stdout).toContain("tool_use")

        const parts = toolParts(res.stdout)
        console.log(`[${LIVE_NOTE}] T13 test 3 ${c.label} tool_use parts:`, summarizeParts(parts))
        const runtimeParts = parts.filter((p: any) => typeof p?.tool === "string" && (p.tool as string).includes(RUNTIME_TOOL_FRAGMENT))
        const bodies = fixture.requests.map((r) => JSON.stringify(r.body))
        // Advertised catalog names across every model request (proves what
        // the model could see on each turn).
        const advertised = new Set<string>()
        for (const req of fixture.requests) {
          const tools = (req.body as any)?.tools ?? []
          for (const t of tools) {
            const n = t?.function?.name ?? t?.name
            if (typeof n === "string") advertised.add(n)
          }
        }
        const sibling = [...advertised].find((n) => n.includes("analyze_javascript_application"))
        const runtimeAdvertised = [...advertised].find((n) => n.includes(RUNTIME_TOOL_FRAGMENT))
        console.log(`[${LIVE_NOTE}] T13 test 3 ${c.label} sibling advertised:`, sibling ?? "(none)", "runtime advertised:", runtimeAdvertised ?? "(none)")
        if (c.expectation === "completed") {
          // Allow-path: the call must reach the live server and COMPLETE
          // (running /usr/bin/true needs no session or device). Do NOT fake
          // success: if the live server returns a domain error instead, this
          // assert fails loudly and the deviation is documented.
          expect(runtimeParts.length).toBeGreaterThan(0)
          expect(runtimeParts.some((p: any) => p?.state?.status === "completed")).toBe(true)
        } else if (c.expectation === "error") {
          // Ask-path (no --auto): the agent ask gate must surface as an
          // error, the run must continue to final text, and a completed
          // runtime call must NOT appear.
          expect(runtimeParts.length).toBeGreaterThan(0)
          expect(runtimeParts.some((p: any) => p?.state?.status === "error")).toBe(true)
          expect(runtimeParts.some((p: any) => p?.state?.status === "completed")).toBe(false)
          // QA hardening (D2): permission-flavoured error requested, but
          // LIVE DEVIATION (observed 2026-10-12): actual ask-path text is
          //   "Unable to execute rea_capture_process_scenario"
          // which does NOT match /permission|denied|not allowed|rejected/i.
          // Per ticket rule the regex assert is NOT added (no faking); the
          // texts are logged for the record and the status asserts above
          // stay as-is.
          const runtimeErrors = errorTexts(runtimeParts)
          console.log(`[${LIVE_NOTE}] T13 test 3 ${c.label} runtime error texts:`, JSON.stringify(runtimeErrors).slice(0, 2000))
          expect(runtimeErrors.length).toBeGreaterThan(0)
        } else {
          // Deny-path (analyst): the host hides wholly-denied tools from the
          // model catalog (whollyDisabled), so no runtime tool_use can occur.
          // Assert the hiding directly: the MCP catalog demonstrably
          // converged (a non-gated sibling rea tool was advertised) yet the
          // runtime tool never appears in any turn's catalog nor in any
          // tool_use.
          expect(sibling).toBeDefined()
          expect(runtimeAdvertised).toBeUndefined()
          expect(runtimeParts.length).toBe(0)
        }
        // Log-only reachability signal (non-authoritative substring: it can
        // match tool descriptions, not just cataloged tool names — see the
        // scoped `advertised` set above for the authoritative signal).
        // Behaviour identical: logging only, no assert on live-server bytes.
        console.log(`[${LIVE_NOTE}] T13 test 3 ${c.label} runtime tool substring in requests (non-authoritative):`, bodies.some((b) => b.includes(RUNTIME_TOOL_FRAGMENT)))
        console.log(`[${LIVE_NOTE}] T13 test 3 ${c.label} runtime tool in advertised catalog (authoritative):`, runtimeAdvertised ?? "(none)")
        console.log(`[${LIVE_NOTE}] T13 test 3 ${c.label} model requests:`, fixture.requests.length, "runtimeCalls:", flow.calls)
      } finally {
        await env.cleanup()
        await fixture.close()
      }
    }

    // 3a/3b/3c sequential sub-cases sharing the helpers above.
    // DEVIATION from the ticket spec for 3a (proven round 2): the spec
    // expects a tool_use error for the analyst's runtime call, but the host
    // hides wholly-denied tools from the model catalog (whollyDisabled in
    // prior-art tool.ts) before the model can call them — 159 MCP tools
    // converged with the runtime tool absent. The deny is therefore asserted
    // as catalog absence with an MCP-connected sibling proof, not as a
    // tool_use error. 3b/3c follow the spec (ask-tools stay advertised).
    await runCase({
      label: "3a-analyst-deny",
      agentId: "rea-analyst",
      auto: true,
      expectation: "hidden",
      finalText: "T13-ANALYST-RUNTIME-DENIED",
    })
    await runCase({
      label: "3b-runtime-ask-noauto",
      agentId: "rea-runtime",
      auto: false,
      expectation: "error",
      finalText: "T13-RUNTIME-ASK-DENIED",
    })
    // 3c passes plugin options via the object-form plugins entry
    // (schema @opencode/schema config/plugin.ts Entry {package, options});
    // default runtime is "ask", so this is the only case that flips it.
    await runCase({
      label: "3c-runtime-allow",
      agentId: "rea-runtime",
      pluginOptions: { runtime: "allow" },
      auto: true,
      expectation: "completed",
      finalText: "T13-RUNTIME-ALLOW-DONE",
    })
  // Measured wall-clock for the 3 sequential sub-cases is ~60s; outer
  // timeout raised to 900s headroom for cold MCP boot + fixture delays.
  }, 900_000)
})
