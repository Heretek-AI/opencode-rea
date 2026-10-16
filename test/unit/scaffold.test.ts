import { describe, expect, test } from "bun:test"

describe("T01 package scaffold", () => {
  test("package.json fields", async () => {
    const pkg = await Bun.file("package.json").json()
    expect(pkg.name).toBe("opencode-rea")
    expect(pkg.type).toBe("module")
    expect(pkg.exports).toEqual({ ".": "./dist/index.js" })
    expect(pkg.files).toEqual(expect.arrayContaining(["dist", "skills", "agents", "index.js"]))
    expect(pkg.peerDependencies?.["@opencode/plugin"]).toBe("^2")
    expect(pkg.devDependencies?.["@opencode/plugin"]).toBe("2.0.26")
    expect(pkg.devDependencies?.["@opencode/sdk"]).toBe("2.0.26")
    expect(pkg.devDependencies?.["@opencode/cli"]).toBe("2.0.26")
    expect(pkg.devDependencies?.["rea-agents"]).toBe("6.5.0")
    expect(pkg.devDependencies?.["typescript"]).toBeDefined()
    expect(pkg.devDependencies?.["@types/bun"]).toBeDefined()
    expect(pkg.scripts?.check).toBeDefined()
    expect(pkg.scripts?.build).toBeDefined()
    expect(pkg.scripts?.test).toBeDefined()
    // Do NOT bundle: no runtime deps on effect or @opencode/plugin
    expect(pkg.dependencies?.["effect"]).toBeUndefined()
    expect(pkg.dependencies?.["@opencode/plugin"]).toBeUndefined()
  })

  test("tsconfig excludes review/", async () => {
    for (const f of ["tsconfig.json", "tsconfig.build.json"]) {
      const cfg = await Bun.file(f).json()
      const exclude: string[] = cfg.exclude ?? []
      for (const entry of ["review", "node_modules", "dist", ".worktrees"]) {
        expect(exclude).toContain(entry)
      }
    }
  })

  test("src entry shape", async () => {
    const src = await Bun.file("src/index.ts").text()
    expect(src).toContain('Plugin.define')
    expect(src).toContain('"rea"')
    expect(src).toContain("setup")
    expect(src).toContain("export default")
    expect(src).not.toContain("ctx.mcp.transform")
  })
})
