import { describe, expect, test } from "bun:test"
import { mkIsolatedEnv } from "../support/opencode-env.js"
import plugin from "../../src/index.js"
import { COMMAND_IDS, REA_PROMPT_COMMANDS, registerCommands } from "../../src/commands.js"
import { Plugin } from "@opencode/plugin"
import { OpenCode } from "@opencode/sdk"

// T09: the real rea plugin registers its 3 slash commands through the real
// @opencode/sdk host. Setup runs lazily on first capability acquisition for
// that Location (F1 fact), so poll a location-targeted list call to force
// instantiation. Per the F2-caveat pattern from skills/agents tests, the
// in-process embedded SDK host may surface no plugin commands via
// ctx.command.list(), so visibility is recorded explicitly and the test falls
// back to asserting registration via direct registerCommands() against a
// capturing fake ctx plus the in-process load smoke (rea active, no failure).
// No model calls are made (plugin inventory only, no opencode run;
// live-model behaviour unverified).
describe("T09 commands via real host", () => {
  test("rea plugin loads active; command list shape holds; rea commands recorded with fallback", async () => {
    const env = await mkIsolatedEnv()
    try {
      let commandListResult: any
      const probe = Plugin.define({
        id: "t09-command-probe",
        setup: async (ctx: any) => {
          commandListResult = await ctx.command.list()
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
          if (commandListResult !== undefined) break
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      // In-process load smoke: rea must be present and healthy.
      expect(inventory).toBeDefined()
      const rea = (inventory ?? []).find((p: any) => p?.id === "rea")
      expect(rea).toBeDefined()
      expect((rea as any)?.state?.status).toBe("active")

      // Probe shape: command Info is { name, description? }; handle BOTH
      // {location,data} and Array shapes (live-model behaviour unverified).
      expect(commandListResult).toBeDefined()
      const data = (commandListResult as any)?.data ?? commandListResult
      const ids: string[] = Array.isArray(data)
        ? data.map((c: any) => c?.name).filter((id: unknown) => typeof id === "string")
        : Object.keys(data ?? {})
      console.log("[live-model behaviour unverified] T09 in-process command names:", JSON.stringify(ids))
      const visible = [...COMMAND_IDS].every((id) => ids.includes(id))
      if (visible) {
        expect(visible).toBe(true)
        const byName = new Map<string, any>(
          (data as Array<any>).filter((c: any) => typeof c?.name === "string").map((c: any) => [c.name, c]),
        )
        for (const id of COMMAND_IDS) {
          expect(typeof byName.get(id)?.description).toBe("string")
          expect((byName.get(id)?.description ?? "").length).toBeGreaterThan(0)
        }
        for (const id of COMMAND_IDS) {
          expect((REA_PROMPT_COMMANDS as ReadonlyArray<string>).includes(id)).toBe(false)
        }
      } else {
        // F2-caveat outcome: plugin commands not visible in-process. Record it
        // and prove registration via direct registerCommands().
        console.log(
          "[live-model behaviour unverified] T09 F2-caveat: rea commands not visible via in-process ctx.command.list(); proving registration via direct registerCommands()",
        )
        await assertDirectRegistration()
      }
      await opencode.close().catch(() => {})
    } finally {
      await env.cleanup()
    }
  }, 60_000)

  test("COMMAND_IDS exact; no shadowing of rea:<prompt> commands", () => {
    expect([...COMMAND_IDS]).toEqual(["rea", "rea-doctor", "rea-report"])
    expect(REA_PROMPT_COMMANDS).toHaveLength(6)
    for (const name of COMMAND_IDS) {
      expect(name).not.toContain(":")
      expect((REA_PROMPT_COMMANDS as ReadonlyArray<string>).includes(name)).toBe(false)
    }
  })
})

async function collectDefinitions(options: { server: string; runtime: "ask" | "allow" | "deny" }) {
  const added: Array<{ name: string; description?: string; execute: (input: any) => Promise<unknown> }> = []
  const fakeCtx = {
    command: {
      transform: async (cb: (editor: { add: (d: any) => void }) => void) => {
        cb({ add: (d: any) => void added.push(d) })
        return { dispose: async () => {} }
      },
    },
    session: { switchAgent: async () => {}, prompt: async () => {} },
  }
  await registerCommands(fakeCtx as any, options as any)
  return added
}

async function assertDirectRegistration() {
  const added = await collectDefinitions({ server: "rea", runtime: "ask" })
  expect(added.map((d) => d.name)).toEqual(["rea", "rea-doctor", "rea-report"])
  for (const d of added) {
    expect(typeof d.description).toBe("string")
    expect((d.description ?? "").length).toBeGreaterThan(0)
    expect(d.name).not.toContain(":")
    expect((REA_PROMPT_COMMANDS as ReadonlyArray<string>).includes(d.name)).toBe(false)
  }

  // rea: switches agent then prompts with template + user args.
  {
    const calls: Array<{ method: string; input: any }> = []
    const fakeSession = {
      command: {
        transform: async (cb: (editor: { add: (d: any) => void }) => void) => {
          const defs: Array<any> = []
          cb({ add: (d: any) => void defs.push(d) })
          const def = defs.find((d) => d.name === "rea")
          await def.execute({ sessionID: "s1", prompt: { text: "my feature" }, delivery: undefined })
          return { dispose: async () => {} }
        },
      },
      session: {
        switchAgent: async (input: any) => void calls.push({ method: "switchAgent", input }),
        prompt: async (input: any) => void calls.push({ method: "prompt", input }),
      },
    }
    await registerCommands(fakeSession as any, { server: "rea", runtime: "ask" })
    expect(calls[0]).toEqual({ method: "switchAgent", input: { sessionID: "s1", agent: "rea" } })
    expect(calls[1]?.method).toBe("prompt")
    const text = String(calls[1]?.input?.text ?? "")
    expect(text).toContain("my feature")
    expect(text).toContain("rea")
  }

  // rea-doctor: prompts without switching; embeds the readiness tool name.
  {
    const calls: Array<{ method: string; input: any }> = []
    const fakeSession = {
      command: {
        transform: async (cb: (editor: { add: (d: any) => void }) => void) => {
          const defs: Array<any> = []
          cb({ add: (d: any) => void defs.push(d) })
          const def = defs.find((d) => d.name === "rea-doctor")
          await def.execute({ sessionID: "s2", prompt: { text: "" }, delivery: undefined })
          return { dispose: async () => {} }
        },
      },
      session: {
        switchAgent: async (input: any) => void calls.push({ method: "switchAgent", input }),
        prompt: async (input: any) => void calls.push({ method: "prompt", input }),
      },
    }
    await registerCommands(fakeSession as any, { server: "rea", runtime: "ask" })
    expect(calls.some((c) => c.method === "switchAgent")).toBe(false)
    const promptCall = calls.find((c) => c.method === "prompt")
    expect(promptCall).toBeDefined()
    expect(String(promptCall?.input?.text ?? "")).toContain("rea_readiness")
  }

  // rea-report: prompts without switching; evidence report + rea-auditor check.
  {
    const calls: Array<{ method: string; input: any }> = []
    const fakeSession = {
      command: {
        transform: async (cb: (editor: { add: (d: any) => void }) => void) => {
          const defs: Array<any> = []
          cb({ add: (d: any) => void defs.push(d) })
          const def = defs.find((d) => d.name === "rea-report")
          await def.execute({ sessionID: "s3", prompt: { text: "" }, delivery: undefined })
          return { dispose: async () => {} }
        },
      },
      session: {
        switchAgent: async (input: any) => void calls.push({ method: "switchAgent", input }),
        prompt: async (input: any) => void calls.push({ method: "prompt", input }),
      },
    }
    await registerCommands(fakeSession as any, { server: "rea", runtime: "ask" })
    expect(calls.some((c) => c.method === "switchAgent")).toBe(false)
    const promptCall = calls.find((c) => c.method === "prompt")
    const text = String(promptCall?.input?.text ?? "")
    expect(text).toContain("rea-auditor")
    expect(text.toLowerCase()).toContain("evidence")
  }

  // Custom server does NOT change the rea-doctor readiness tool name:
  // the readiness tool is a constant native tool (rea_readiness).
  {
    const calls: Array<any> = []
    const ctx = {
      command: {
        transform: async (cb: (editor: { add: (d: any) => void }) => void) => {
          const defs: Array<any> = []
          cb({ add: (d: any) => void defs.push(d) })
          await defs.find((d: any) => d.name === "rea-doctor").execute({
            sessionID: "s",
            prompt: { text: "" },
            delivery: undefined,
          })
          return { dispose: async () => {} }
        },
      },
      session: {
        switchAgent: async () => {},
        prompt: async (input: any) => void calls.push(input),
      },
    }
    await registerCommands(ctx as any, { server: "custom", runtime: "ask" })
    expect(String(calls[0]?.text ?? "")).toContain("rea_readiness")
    expect(String(calls[0]?.text ?? "")).not.toContain("custom_readiness")
  }
}
