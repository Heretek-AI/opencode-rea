import { describe, expect, test } from "bun:test"
import { COMMAND_IDS, REA_PROMPT_COMMANDS, registerCommands } from "../../src/commands.js"

describe("T09 unit: slash commands registration and execution", () => {
  test("COMMAND_IDS and REA_PROMPT_COMMANDS do not overlap", () => {
    expect([...COMMAND_IDS]).toEqual(["rea", "rea-doctor", "rea-report"])
    expect(REA_PROMPT_COMMANDS).toHaveLength(6)
    for (const cmd of COMMAND_IDS) {
      expect(cmd).not.toContain(":")
      expect((REA_PROMPT_COMMANDS as ReadonlyArray<string>).includes(cmd)).toBe(false)
    }
  })

  test("registerCommands wires /rea, /rea-doctor, and /rea-report with server context and user args", async () => {
    const added: any[] = []
    const sessionCalls: Array<{ method: string; input: any }> = []
    const ctx: any = {
      command: {
        transform: async (cb: (editor: any) => void) => {
          cb({ add: (d: any) => void added.push(d) })
          return { dispose: async () => {} }
        },
      },
      session: {
        switchAgent: async (input: any) => void sessionCalls.push({ method: "switchAgent", input }),
        prompt: async (input: any) => void sessionCalls.push({ method: "prompt", input }),
      },
    }

    await registerCommands(ctx, { server: "custom.rea", runtime: "ask" })
    expect(added.map((d) => d.name)).toEqual(["rea", "rea-doctor", "rea-report"])

    // /rea switches to primary rea agent and passes target prompt + sanitized server namespace
    const reaCmd = added.find((d) => d.name === "rea")
    await reaCmd.execute({ sessionID: "s1", prompt: { text: "inspect auth flow" }, delivery: "immediate" })
    expect(sessionCalls[0]).toEqual({ method: "switchAgent", input: { sessionID: "s1", agent: "rea" } })
    expect(sessionCalls[1]?.method).toBe("prompt")
    expect(sessionCalls[1]?.input?.text).toContain("inspect auth flow")
    expect(sessionCalls[1]?.input?.text).toContain("custom_rea")
    expect(sessionCalls[1]?.input?.text).toContain("inspect_analysis_view")

    // /rea-doctor keeps constant rea_readiness tool name while naming configured server
    sessionCalls.length = 0
    const doctorCmd = added.find((d) => d.name === "rea-doctor")
    await doctorCmd.execute({ sessionID: "s2", prompt: { text: "" }, delivery: undefined })
    expect(sessionCalls.some((c) => c.method === "switchAgent")).toBe(false)
    expect(sessionCalls[0]?.input?.text).toContain("rea_readiness")
    expect(sessionCalls[0]?.input?.text).not.toContain("custom.rea_readiness")
    expect(sessionCalls[0]?.input?.text).toContain("custom.rea")

    // /rea-report includes user scope when provided and delegates audit to rea-auditor
    sessionCalls.length = 0
    const reportCmd = added.find((d) => d.name === "rea-report")
    await reportCmd.execute({ sessionID: "s3", prompt: { text: "focus on TLS pinning" }, delivery: undefined })
    expect(sessionCalls.some((c) => c.method === "switchAgent")).toBe(false)
    expect(sessionCalls[0]?.input?.text).toContain("rea-auditor")
    expect(sessionCalls[0]?.input?.text).toContain("focus on TLS pinning")
  })
})
