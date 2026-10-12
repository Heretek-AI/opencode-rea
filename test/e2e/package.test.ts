import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { start, titleAware } from "../support/model-fixture.js"
import { mkIsolatedEnv, runOpencodeRun, writeOpencodeJson } from "../support/opencode-env.js"

const LIVE_NOTE = "live-model behaviour unverified"

const EXPECTED_SKILLS = ["rea-evidence-report", "rea-investigation", "rea-opencode", "rea-reconstruction"].sort()
const EXPECTED_AGENTS = ["rea-analyst.md", "rea-auditor.md", "rea-runtime.md", "rea.md"].sort()

async function ensureBuilt(): Promise<void> {
  if (!(await Bun.file("dist/index.js").exists())) {
    throw new Error("run bun run build first")
  }
}

// Pack the current package into a hermetic tmp dir and return the .tgz path.
// Prefers `bun pm pack`; falls back to `npm pack`. Produces a real tarball
// (proof of the `files` list) — never --dry-run as the sole mechanism.
async function packToTmp(): Promise<{ tgz: string; dir: string }> {
  await ensureBuilt()
  const dir = await mkdtemp(join(tmpdir(), "t14-pack-"))
  const findTgz = async (): Promise<string | undefined> => {
    const found = (await readdir(dir)).find((f) => f.endsWith(".tgz"))
    return found ? join(dir, found) : undefined
  }
  let tgz = await findTgz()
  const tryPack = (cmd: string, args: string[]): boolean => {
    const r = spawnSync(cmd, args, { cwd: process.cwd(), encoding: "utf8" })
    return r.status === 0
  }
  if (tgz === undefined) {
    if (tryPack(process.execPath, ["pm", "pack", "--destination", dir])) {
      tgz = await findTgz()
    }
  }
  if (tgz === undefined) {
    if (tryPack("npm", ["pack", "--pack-destination", dir, "--silent"])) {
      tgz = await findTgz()
    }
  }
  if (tgz === undefined || !existsSync(tgz)) {
    await rm(dir, { recursive: true, force: true })
    throw new Error("pack produced no .tgz (tried bun pm pack, npm pack)")
  }
  return { tgz, dir }
}

function listTarball(tgz: string): string[] {
  const r = spawnSync("tar", ["-tzf", tgz], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`tar -tzf failed: ${(r.stderr as string).slice(0, 300)}`)
  return (r.stdout as string).split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
}

// Extract the tarball hermetically; npm/bun pack nests payload under package/.
async function extractToTmp(tgz: string): Promise<{ pkgDir: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "t14-extract-"))
  const r = spawnSync("tar", ["-xzf", tgz, "-C", dir], { encoding: "utf8" })
  if (r.status !== 0) {
    await rm(dir, { recursive: true, force: true })
    throw new Error(`tar -xzf failed: ${(r.stderr as string).slice(0, 300)}`)
  }
  const pkgDir = join(dir, "package")
  if (!existsSync(pkgDir)) {
    await rm(dir, { recursive: true, force: true })
    throw new Error("extracted tarball has no package/ dir")
  }
  return { pkgDir, dir }
}

describe("T14 E2E package verification: packed tarball installs and loads", () => {
  test("tarball contents + no-bundling rule + on-disk files", async () => {
    console.log(`[${LIVE_NOTE}] T14 proving packed tarball contains dist/skills/agents without bundled deps`)
    const { tgz, dir: packDir } = await packToTmp()
    let extractDir = ""
    try {
      const entries = listTarball(tgz)
      console.log(`[${LIVE_NOTE}] T14 tarball entries:`, entries.length)

      expect(entries).toContain("package/dist/index.js")
      // Packaging finding (probed live): the host resolves a local plugin
      // directory via a root index.js and ignores package.json
      // main/exports — the extracted dir as-is (no root index.js) is
      // silently never loaded (12 builtin tools, no rea_readiness, no
      // LoadError; cf. T11 wrapper dir, T12 staging index.js). The root
      // re-export must therefore ship in the tarball.
      expect(entries).toContain("package/index.js")

      const skillDirs = entries
        .filter((e) => e.startsWith("package/skills/") && e.endsWith("/SKILL.md"))
        .map((e) => e.split("/")[2])
        .sort()
      expect(skillDirs).toEqual(EXPECTED_SKILLS)

      const agentFiles = entries
        .filter((e) => e.startsWith("package/agents/") && e.endsWith(".md"))
        .map((e) => e.split("/")[2])
        .sort()
      expect(agentFiles).toEqual(EXPECTED_AGENTS)

      const { pkgDir, dir } = await extractToTmp(tgz)
      extractDir = dir
      const packed = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>
        peerDependencies?: Record<string, string>
      }
      // effect (host-transitive via src/readiness.ts) and @opencode/plugin
      // must stay peer + dev only — never bundled as runtime dependencies.
      expect(packed.dependencies?.["effect"]).toBeUndefined()
      expect(packed.dependencies?.["@opencode/plugin"]).toBeUndefined()
      expect(packed.peerDependencies?.["@opencode/plugin"]).toBeDefined()

      // All 8 skill/agent files resolve on disk in the extracted dir.
      for (const skill of EXPECTED_SKILLS) {
        expect(existsSync(join(pkgDir, "skills", skill, "SKILL.md"))).toBe(true)
      }
      for (const agent of EXPECTED_AGENTS) {
        expect(existsSync(join(pkgDir, "agents", agent))).toBe(true)
      }
      expect(existsSync(join(pkgDir, "dist", "index.js"))).toBe(true)
      expect(existsSync(join(pkgDir, "index.js"))).toBe(true)
    } finally {
      await rm(packDir, { recursive: true, force: true })
      if (extractDir) await rm(extractDir, { recursive: true, force: true })
    }
  }, 60_000)

  test("extracted tarball dir loads in real CLI smoke", async () => {
    console.log(`[${LIVE_NOTE}] T14 proving extracted tarball dir loads as a plugin in the real CLI`)
    const { tgz, dir: packDir } = await packToTmp()
    let extractDir = ""
    const fixture = await start({
      responses: [
        titleAware([
          // If the extracted dir loads, rea_readiness is advertised — call it
          // to prove registration end to end. If it is silently dropped (the
          // pre-fix shape), this falls through to NO-TOOL text and the
          // rea_readiness asserts below fail.
          ({ body }: { body: any }) => {
            const names = ((body?.tools ?? []) as any[]).map(
              (t) => t?.function?.name ?? t?.name ?? "",
            )
            console.log(`[${LIVE_NOTE}] T14 advertised tools:`, names.length)
            if (names.includes("rea_readiness")) {
              return { type: "tool", tool: "rea_readiness", args: {} }
            }
            return { type: "text", text: "PACK-READY-NO-TOOL" }
          },
          { type: "text", text: "PACK-READY" },
        ]),
      ],
    })
    const env = await mkIsolatedEnv()
    try {
      const { pkgDir, dir } = await extractToTmp(tgz)
      extractDir = dir
      await writeOpencodeJson(env, {
        model: "fixture-test/fixture-model",
        plugins: [pkgDir],
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
        ["run", "--standalone", "--format", "json", "--auto", "--model", "fixture-test/fixture-model", "Say PACK-READY."],
        { timeoutMs: 120_000 },
      )
      console.log(`[${LIVE_NOTE}] T14 exit:`, res.exitCode)
      expect(res.exitCode).toBe(0)
      expect(res.stdout).toContain("PACK-READY")
      expect(res.stdout).toContain("rea_readiness")
      expect(res.stderr).not.toContain("LoadError")
      expect(res.stderr).not.toContain("Plugin must export")
      expect(fixture.requests.length).toBeGreaterThan(0)
    } finally {
      await env.cleanup()
      await fixture.close()
      await rm(packDir, { recursive: true, force: true })
      if (extractDir) await rm(extractDir, { recursive: true, force: true })
    }
  }, 150_000)
})
