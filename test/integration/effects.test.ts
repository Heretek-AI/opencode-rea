import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { RUNTIME_EFFECT_TOOLS } from "../../src/effects.js"

const LIVE_NOTE = "live-model behaviour unverified"

interface LiveTool {
  name: string
  annotations?: {
    destructiveHint?: boolean
    openWorldHint?: boolean
    [key: string]: unknown
  }
}

async function listLiveTools(timeoutMs = 60_000): Promise<LiveTool[]> {
  const child = spawn("node", ["node_modules/rea-agents/scripts/rea.mjs", "mcp"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (d) => {
    stdout += d.toString()
  })
  child.stderr.on("data", (d) => {
    stderr += d.toString()
  })
  try {
    const write = (obj: unknown): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        child.stdin.write(`${JSON.stringify(obj)}\n`, (err) => (err ? reject(err as Error) : resolve()))
      })
    await write({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t06-drift", version: "0" } },
    })
    await write({ jsonrpc: "2.0", method: "notifications/initialized" })
    await write({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    const deadline = Date.now() + timeoutMs
    for (;;) {
      for (const line of stdout.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("{")) continue
        try {
          const msg = JSON.parse(trimmed) as { id?: number; result?: { tools?: LiveTool[] } }
          if (msg.id === 2 && Array.isArray(msg.result?.tools)) return msg.result.tools as LiveTool[]
        } catch {
          // keep scanning: partial line
        }
      }
      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for tools/list response; stderr: ${stderr.slice(0, 500)}`)
      }
      if (child.exitCode !== null) {
        throw new Error(`REA MCP server exited early (${child.exitCode}); stderr: ${stderr.slice(0, 1000)}`)
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  } finally {
    child.kill()
    await new Promise((r) => setTimeout(r, 250))
  }
}

describe("T06 live-server drift test (real rea-agents MCP over stdio, no canned responses)", () => {
  test("live tools/list matches RUNTIME_EFFECT_TOOLS classification", async () => {
    console.log(`[${LIVE_NOTE}] T06 probing real rea-agents MCP server via stdio`)
    const tools = await listLiveTools()
    console.log(`[${LIVE_NOTE}] T06 live tools:`, tools.length)
    // (a) tools array non-empty with name strings
    expect(tools.length).toBeGreaterThan(0)
    for (const t of tools) {
      expect(typeof t.name).toBe("string")
      expect(t.name.length).toBeGreaterThan(0)
    }
    // (b) every tool carries boolean destructiveHint AND openWorldHint
    for (const t of tools) {
      expect(typeof t.annotations).toBe("object")
      expect(typeof t.annotations?.destructiveHint).toBe("boolean")
      expect(typeof t.annotations?.openWorldHint).toBe("boolean")
    }
    const liveByName = new Map(tools.map((t) => [t.name, t]))
    const classified = new Set(RUNTIME_EFFECT_TOOLS.map((e) => e.name))
    // (c) every live destructiveHint===true tool is classified
    const liveDestructive = tools.filter((t) => t.annotations?.destructiveHint === true).map((t) => t.name)
    console.log(`[${LIVE_NOTE}] T06 live destructiveHint=true:`, JSON.stringify(liveDestructive))
    for (const name of liveDestructive) {
      expect(classified.has(name)).toBe(true)
    }
    // (d) every classified name exists live
    for (const name of classified) {
      expect(liveByName.has(name)).toBe(true)
    }
  }, 60_000)
})
