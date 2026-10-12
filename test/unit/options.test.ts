import { describe, expect, test } from "bun:test"
import { parseOptions, sanitizeServerNamespace } from "../../src/options.js"
import plugin from "../../src/index.js"

describe("T04 options boundary: parseOptions", () => {
  test("undefined options yield defaults", () => {
    expect(parseOptions(undefined)).toEqual({ server: "rea", runtime: "ask" })
  })

  test("null options yield defaults", () => {
    expect(parseOptions(null)).toEqual({ server: "rea", runtime: "ask" })
  })

  test("valid values pass through", () => {
    expect(parseOptions({ server: "custom", runtime: "allow" })).toEqual({ server: "custom", runtime: "allow" })
    expect(parseOptions({ runtime: "deny" })).toEqual({ server: "rea", runtime: "deny" })
    expect(parseOptions({ server: "x" })).toEqual({ server: "x", runtime: "ask" })
    expect(parseOptions({})).toEqual({ server: "rea", runtime: "ask" })
  })

  test("unknown key fails with error naming the key", () => {
    let error: unknown
    try {
      parseOptions({ bogus: 1 })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("bogus")
  })

  test("server non-string fails with error naming server", () => {
    let error: unknown
    try {
      parseOptions({ server: 42 })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("server")
  })

  test("runtime invalid string fails with error naming runtime", () => {
    let error: unknown
    try {
      parseOptions({ runtime: "sometimes" })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("runtime")
  })

  test("runtime non-string fails with error naming runtime", () => {
    let error: unknown
    try {
      parseOptions({ runtime: 7 })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("runtime")
  })

  test("non-object options fail", () => {
    for (const bad of [42, "rea", true, []]) {
      let error: unknown
      try {
        parseOptions(bad)
      } catch (e) {
        error = e
      }
      expect(error).toBeInstanceOf(Error)
    }
  })

  test("empty/whitespace server fails with non-empty error", () => {
    for (const bad of ["", "   ", "\t\n"]) {
      let error: unknown
      try {
        parseOptions({ server: bad })
      } catch (e) {
        error = e
      }
      expect(error).toBeInstanceOf(Error)
      expect(String((error as Error).message)).toContain("non-empty")
    }
  })

  test("sanitizeServerNamespace mirrors the host MCP namespace", () => {
    expect(sanitizeServerNamespace("rea")).toBe("rea")
    expect(sanitizeServerNamespace("custom")).toBe("custom")
    expect(sanitizeServerNamespace("my-server_1")).toBe("my-server_1")
    expect(sanitizeServerNamespace("ABC")).toBe("ABC")
    expect(sanitizeServerNamespace("rea:foo")).toBe("rea_foo")
    expect(sanitizeServerNamespace("my.server")).toBe("my_server")
    expect(sanitizeServerNamespace("a b")).toBe("a_b")
  })
})

describe("T04 options boundary: setup wiring", () => {
  test("setup validates ctx.options: bad options throw, defaults pass", async () => {
    // Plugin.define preserves setup, so invoke it directly with a fake ctx.
    // Setup also registers skills (T05), agents (T07), readiness (T08) and
    // commands (T09), so stub skill/agent/tool/command.transform as no-ops.
    const setup = (plugin as unknown as { setup: (ctx: unknown) => Promise<unknown> }).setup
    expect(typeof setup).toBe("function")
    const withSkill = (options: unknown) => ({
      options,
      skill: { transform: async () => ({ dispose: async () => {} }) },
      agent: { transform: async () => ({ dispose: async () => {} }) },
      tool: { transform: async () => ({ dispose: async () => {} }) },
      command: { transform: async () => ({ dispose: async () => {} }) },
    })
    await setup(withSkill(undefined))
    await setup(withSkill({}))
    let error: unknown
    try {
      await setup(withSkill({ bogus: true }))
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("bogus")
  })
})
