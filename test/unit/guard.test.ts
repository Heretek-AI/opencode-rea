import { describe, expect, test } from "bun:test"
import { evaluateAgentPermission, registerAgents } from "../../src/agents.js"
import { parseOptions } from "../../src/options.js"
import type { ReaOptions } from "../../src/options.js"

const DEFAULTS = parseOptions({})
const ALLOW_ALL_OFF: ReaOptions = { server: "rea", runtime: "ask", protectTargets: false }

function denyCases(): string[] {
  return [
    // directories
    "targets/firmware.bin",
    "/abs/targets/firmware.bin",
    "fixtures/input.bin",
    "a/fixtures/b/c.bin",
    "captures/trace.bin",
    "ghidra_projects/proj/data",
    ".rea/state.json",
    "sub/.rea/lock",
    // binary / capture extensions
    "work/app.gpr",
    "work/app.idb",
    "work/app.i64",
    "work/app.hop",
    "work/app.rzdb",
    "work/app.bndb",
    "work/app.apk",
    "work/app.ipa",
    "work/app.asar",
    "work/app.pcap",
    "work/app.pcapng",
    "work/app.core",
    "work/app.dmp",
    "work/app.wasm",
    // inside *.rep/
    "proj.rep/output.txt",
    "/abs/a.rep/b/c.bin",
    // backup / bundle
    "notes.rea.backup",
    "notes.rea.backup.1",
    "evidence.bundle.json",
    // dotenv (except .env.example)
    ".env",
    ".env.local",
    "sub/.env.production",
    // secret extensions
    "certs/private.pem",
    "certs/cert.key",
    "certs/cert.pfx",
    "certs/cert.p12",
    "certs/store.keystore",
    "certs/store.jks",
    // key filenames
    "keys/id_rsa",
    "keys/id_rsa.pub",
    "keys/id_ed25519",
    "keys/id_ed25519.pub",
  ]
}

describe("M3b target-integrity edit guard", () => {
  test("parseOptions defaults protectTargets to true and validates booleans", () => {
    expect(parseOptions(undefined).protectTargets).toBe(true)
    expect(parseOptions(null).protectTargets).toBe(true)
    expect(parseOptions({}).protectTargets).toBe(true)
    expect(parseOptions({ protectTargets: false }).protectTargets).toBe(false)
    let error: unknown
    try {
      parseOptions({ protectTargets: "yes" })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("protectTargets")
  })

  for (const path of denyCases()) {
    test(`deny edit on protected path: ${path}`, () => {
      const event: any = { action: "edit", resources: [path], agent: "rea" }
      const result = evaluateAgentPermission(event, DEFAULTS)
      expect(result).toEqual({ effect: "deny" })
      expect(event.effect).toBe("deny")
      expect(typeof event.message).toBe("string")
      expect(event.message).toContain("target-integrity guard")
    })
  }

  test("deny works via singular resource field and for unknown agents (fail closed)", () => {
    const viaResource: any = { action: "edit", resource: "targets/a.bin", agent: "rea" }
    expect(evaluateAgentPermission(viaResource, DEFAULTS)).toEqual({ effect: "deny" })
    expect(viaResource.message).toContain("target-integrity guard")

    const unknown: any = { action: "edit", resources: ["targets/a.bin"], agent: "someone-else" }
    const res = evaluateAgentPermission(unknown, DEFAULTS)
    expect(res).toEqual({ effect: "deny" })
    expect(unknown.effect).toBe("deny")
  })

  test("non-edit actions are not denied by the guard", () => {
    const event: any = { action: "read", resources: ["targets/a.bin"], agent: "rea" }
    expect(evaluateAgentPermission(event, DEFAULTS)).toBeUndefined()
  })

  for (const path of ["src/x.ts", "openspec/changes/a/proposal.md", ".env.example"]) {
    test(`allow edit on benign path: ${path}`, () => {
      const event: any = { action: "edit", resources: [path], agent: "rea" }
      expect(evaluateAgentPermission(event, DEFAULTS)).toBeUndefined()
      expect(event.effect).toBeUndefined()
    })
  }

  test("protectTargets:false allows all previously denied paths (rea)", () => {
    for (const path of denyCases()) {
      const event: any = { action: "edit", resources: [path], agent: "rea" }
      const result = evaluateAgentPermission(event, ALLOW_ALL_OFF)
      expect(result).toBeUndefined()
      expect(event.effect).toBeUndefined()
    }
  })

  test("registerAgents still registers exactly one evaluate hook (no second hook)", async () => {
    const hooks: Array<{ type: string; handler: (e: any) => any }> = []
    const store = new Map<string, any>()
    const ctx: any = {
      agent: {
        transform: async (cb: any) => {
          cb({
            update: (id: string, fn: (a: any) => void) => {
              let cur = store.get(id)
              if (!cur) {
                cur = { id, name: id, permissions: [] }
                store.set(id, cur)
              }
              fn(cur)
            },
          })
          return { dispose: async () => {} }
        },
      },
      permission: {
        hook: async (type: string, handler: (e: any) => any) => {
          hooks.push({ type, handler })
          return { dispose: async () => {} }
        },
      },
    }
    await registerAgents(ctx, DEFAULTS)
    expect(hooks.length).toBe(1)
    expect(hooks[0]?.type).toBe("evaluate")
    // The single hook enforces the guard even for unknown agents.
    const event: any = { action: "edit", resources: ["captures/x.bin"], agent: "intruder" }
    await hooks[0]?.handler(event)
    expect(event.effect).toBe("deny")
  })
})
