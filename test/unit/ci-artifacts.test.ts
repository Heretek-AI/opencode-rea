import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { dumpFailureArtifacts } from "../support/artifacts.js"

describe("T16 failure artifact helper", () => {
  test("copies fixture logs and run output into a labelled directory", async () => {
    const scope = await mkdtemp(join(tmpdir(), "t16-artifacts-"))
    try {
      const fixtureDir = join(scope, "fixture")
      await mkdir(fixtureDir, { recursive: true })
      await writeFile(join(fixtureDir, "requests.jsonl"), '{"requestIndex":1}\n')
      await writeFile(join(fixtureDir, "request-1.json"), '{"model":"x"}')
      const out = await dumpFailureArtifacts({
        label: "probe",
        outDir: join(scope, "out"),
        fixture: { logDir: fixtureDir, logFile: join(fixtureDir, "requests.jsonl") },
        runs: [{ name: "opencode-run", result: { exitCode: 0, stdout: "SMOKE-READY", stderr: "" } }],
      })
      expect(out).toContain("probe")
      expect(await Bun.file(join(out, "requests.jsonl")).text()).toContain("requestIndex")
      expect(JSON.parse(await Bun.file(join(out, "request-1.json")).text())).toEqual({ model: "x" })
      expect(await Bun.file(join(out, "opencode-run.stdout.log")).text()).toContain("SMOKE-READY")
      expect(await Bun.file(join(out, "opencode-run.exitcode")).text()).toContain("0")
    } finally {
      await rm(scope, { recursive: true, force: true })
    }
  })

  test("tolerates a missing fixture log file", async () => {
    const scope = await mkdtemp(join(tmpdir(), "t16-artifacts-"))
    try {
      const out = await dumpFailureArtifacts({
        label: "missing",
        outDir: join(scope, "out"),
        fixture: { logDir: join(scope, "nope"), logFile: join(scope, "nope", "requests.jsonl") },
        runs: [],
      })
      expect(out).toContain("missing")
    } finally {
      await rm(scope, { recursive: true, force: true })
    }
  })
})
