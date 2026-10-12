import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { FixtureHandle } from "./model-fixture.js"
import type { RunResult } from "./opencode-env.js"

export interface ArtifactRun {
  name: string
  result: RunResult
}

export interface DumpOptions {
  /** Label scoping this dump, e.g. the test file name. */
  label: string
  /** Fixture whose persisted request logs should be copied. */
  fixture?: Pick<FixtureHandle, "logDir" | "logFile">
  /** CLI runs whose stdout/stderr/exit code should be persisted. */
  runs?: ArtifactRun[]
  /** Artifact root override (defaults to repo-relative test-results/). */
  outDir?: string
}

export function artifactRoot(outDir?: string): string {
  return outDir ?? join(process.cwd(), "test-results")
}

/**
 * Persist fixture request logs + CLI stdout/stderr under
 * `<root>/<label>/` so CI failure-artifact uploads (test-results/) have
 * real files to collect. Best-effort per file: never throws for missing
 * fixture output, always returns the label directory.
 */
export async function dumpFailureArtifacts(opts: DumpOptions): Promise<string> {
  const dir = join(artifactRoot(opts.outDir), opts.label)
  await mkdir(dir, { recursive: true })
  if (opts.fixture) {
    try {
      await copyFile(opts.fixture.logFile, join(dir, "requests.jsonl"))
    } catch {
      // Fixture may not have flushed yet; per-file best effort.
    }
    try {
      const files = await readdir(opts.fixture.logDir)
      for (const f of files) {
        if (!f.startsWith("request-") || !f.endsWith(".json")) continue
        try {
          await copyFile(join(opts.fixture.logDir, f), join(dir, f))
        } catch {
          // Per-file best effort.
        }
      }
    } catch {
      // Missing fixture dir; per-file best effort.
    }
  }
  for (const r of opts.runs ?? []) {
    await writeFile(join(dir, `${r.name}.stdout.log`), r.result.stdout)
    await writeFile(join(dir, `${r.name}.stderr.log`), r.result.stderr)
    await writeFile(join(dir, `${r.name}.exitcode`), `${r.result.exitCode}\n`)
  }
  return dir
}
