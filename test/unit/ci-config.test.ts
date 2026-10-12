import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const WORKFLOW_PATH = join(import.meta.dir, "../../.github/workflows/ci.yml")

interface WorkflowStep {
  name?: unknown
  uses?: unknown
  run?: unknown
  with?: Record<string, unknown>
}

interface WorkflowJob {
  "runs-on"?: unknown
  steps?: WorkflowStep[]
}

interface Workflow {
  on?: {
    push?: { branches?: unknown }
    pull_request?: unknown
  }
  permissions?: Record<string, unknown>
  concurrency?: Record<string, unknown>
  jobs?: Record<string, WorkflowJob>
}

async function loadWorkflow(): Promise<{ text: string; yaml: Workflow }> {
  const text = await Bun.file(WORKFLOW_PATH).text()
  const yaml = Bun.YAML.parse(text) as unknown as Workflow
  return { text, yaml }
}

function allRuns(job: WorkflowJob): string[] {
  return (job.steps ?? []).map((s) => (typeof s.run === "string" ? s.run : "")).filter(Boolean)
}

function allUses(job: WorkflowJob): WorkflowStep[] {
  return job.steps ?? []
}

describe("T03 CI skeleton (.github/workflows/ci.yml)", () => {
  test("triggers on push to main and pull_request", async () => {
    const { yaml } = await loadWorkflow()
    const branches = yaml.on?.push?.branches
    expect(Array.isArray(branches) ? branches.map(String) : []).toContain("main")
    expect(yaml.on ?? {}).toSatisfy((on) => "pull_request" in (on as object))
  })

  test("top-level permissions restrict to contents: read", async () => {
    const { yaml } = await loadWorkflow()
    expect(yaml.permissions?.["contents"]).toBe("read")
  })

  test("top-level concurrency cancels superseded runs", async () => {
    const { yaml } = await loadWorkflow()
    expect(typeof yaml.concurrency?.["group"]).toBe("string")
    expect(String(yaml.concurrency?.["group"]).length).toBeGreaterThan(0)
    expect(yaml.concurrency?.["cancel-in-progress"]).toBe(true)
  })

  test("defines static, unit, integration and e2e jobs on ubuntu", async () => {
    const { yaml } = await loadWorkflow()
    for (const id of ["static", "unit", "integration", "e2e"]) {
      expect(yaml.jobs ?? {}).toSatisfy((jobs) => id in (jobs as object))
      expect(String(yaml.jobs?.[id]?.["runs-on"] ?? "")).toMatch(/ubuntu/)
    }
  })

  test("every job checks out, sets up bun + node 24, and runs bun install", async () => {
    const { yaml } = await loadWorkflow()
    for (const id of ["static", "unit", "integration", "e2e"]) {
      const job = yaml.jobs?.[id] as WorkflowJob
      const steps = allUses(job)
      expect(steps.some((s) => String(s.uses ?? "").startsWith("actions/checkout"))).toBe(true)
      expect(steps.some((s) => String(s.uses ?? "").startsWith("oven-sh/setup-bun"))).toBe(true)
      const node = steps.find((s) => String(s.uses ?? "").startsWith("actions/setup-node"))
      expect(node).toBeDefined()
      expect(String(node?.with?.["node-version"] ?? "")).toMatch(/^24/)
      expect(allRuns(job).some((r) => r.includes("bun install"))).toBe(true)
    }
  })

  test("static job runs typecheck, format check and actionlint", async () => {
    const { yaml } = await loadWorkflow()
    const job = yaml.jobs?.["static"] as WorkflowJob
    const runs = allRuns(job)
    expect(runs.some((r) => r.includes("bun run check"))).toBe(true)
    const names = (job.steps ?? []).map((s) => String(s.name ?? ""))
    expect(names.some((n) => /format/i.test(n))).toBe(true)
    const steps = job.steps ?? []
    expect(
      steps.some(
        (s) => String(s.uses ?? "").includes("actionlint") || String(s.run ?? "").includes("actionlint"),
      ),
    ).toBe(true)
  })

  test("test jobs target test/ explicitly with review/ excluded (unit, integration, e2e)", async () => {
    const { yaml } = await loadWorkflow()
    const expected: Record<string, string> = {
      unit: "bun test --path-ignore-patterns 'review/**' test/unit",
      integration: "bun test --path-ignore-patterns 'review/**' test/integration",
      e2e: "bun test --path-ignore-patterns 'review/**' test/e2e",
    }
    for (const [id, cmd] of Object.entries(expected)) {
      const runs = allRuns(yaml.jobs?.[id] as WorkflowJob)
      expect(runs.some((r) => r.includes(cmd))).toBe(true)
    }
  })

  test("no job runs a bare bun test", async () => {
    const { text } = await loadWorkflow()
    const occurrences = [...text.matchAll(/bun test[^\n]*/g)].map((m) => m[0])
    expect(occurrences.length).toBeGreaterThan(0)
    for (const occurrence of occurrences) {
      expect(occurrence).toMatch(/bun test\s+--path-ignore-patterns 'review\/\*\*'\s+test\/(unit|integration|e2e)/)
      expect(occurrence).toContain("--path-ignore-patterns")
      expect(occurrence).toContain("review/**")
    }
  })

  test("package.json scripts exclude review/ via --path-ignore-patterns", async () => {
    const pkgPath = join(import.meta.dir, "../../package.json")
    const pkg = JSON.parse(await Bun.file(pkgPath).text()) as {
      scripts?: Record<string, string>
    }
    const scripts = pkg.scripts ?? {}
    for (const name of ["test", "test:unit", "test:integration", "test:e2e"]) {
      expect(scripts[name]).toBeDefined()
      expect(String(scripts[name])).toContain("--path-ignore-patterns 'review/**'")
    }
    expect(String(scripts["test"])).toContain("test/unit")
    expect(String(scripts["test:unit"])).toContain("test/unit")
    expect(String(scripts["test:integration"])).toContain("test/integration")
    expect(String(scripts["test:e2e"])).toContain("test/e2e")
  })
})

describe("T16 CI hardening (compat lane, bun cache, failure artifacts)", () => {
  interface T16Step {
    name?: unknown
    uses?: unknown
    run?: unknown
    if?: unknown
    with?: Record<string, unknown>
  }

  interface T16Job {
    name?: unknown
    "runs-on"?: unknown
    steps?: T16Step[]
  }

  async function load(): Promise<Record<string, T16Job>> {
    const text = await Bun.file(WORKFLOW_PATH).text()
    const yaml = Bun.YAML.parse(text) as unknown as { jobs?: Record<string, T16Job> }
    return yaml.jobs ?? {}
  }

  function runs(job: T16Job): string[] {
    return (job.steps ?? []).map((s) => (typeof s.run === "string" ? s.run : "")).filter(Boolean)
  }

  test("e2e-compat job exists on ubuntu and installs latest compat versions", async () => {
    const jobs = await load()
    expect(jobs).toSatisfy((j) => "e2e-compat" in (j as object))
    const job = jobs["e2e-compat"] as T16Job
    expect(String(job["runs-on"] ?? "")).toMatch(/ubuntu/)
    expect(String(job.name ?? "")).toMatch(/compat/i)
    const all = runs(job)
    expect(all.some((r) => r.includes("rea-agents@latest") && r.includes("@opencode/cli@latest"))).toBe(true)
  })

  test("e2e-compat runs the e2e suite with review/** excluded", async () => {
    const jobs = await load()
    const all = runs(jobs["e2e-compat"] as T16Job)
    expect(all.some((r) => r.includes("bun test --path-ignore-patterns 'review/**' test/e2e"))).toBe(true)
  })

  test("pinned versions preserved: other jobs never install @latest", async () => {
    const jobs = await load()
    for (const id of ["static", "unit", "integration", "e2e"]) {
      const all = runs(jobs[id] as T16Job)
      expect(all.some((r) => r.includes("@latest"))).toBe(false)
    }
  })

  test("bun dependency caching present across all jobs", async () => {
    const jobs = await load()
    for (const id of ["static", "unit", "integration", "e2e", "e2e-compat"]) {
      const steps = (jobs[id] as T16Job).steps ?? []
      const setupBunCached = steps.some(
        (s) => String(s.uses ?? "").startsWith("oven-sh/setup-bun") && s.with !== undefined && "cache" in (s.with as object),
      )
      const actionsCache = steps.some((s) => String(s.uses ?? "").startsWith("actions/cache"))
      expect(setupBunCached || actionsCache).toBe(true)
    }
  })

  test("e2e jobs upload failure artifacts with scoped names", async () => {
    const jobs = await load()
    const expected: Record<string, string> = {
      e2e: "e2e-logs-e2e",
      "e2e-compat": "e2e-logs-e2e-compat",
    }
    for (const [id, name] of Object.entries(expected)) {
      const steps = ((jobs[id] as T16Job).steps ?? []) as T16Step[]
      const upload = steps.find((s) => String(s.uses ?? "").includes("upload-artifact"))
      expect(upload).toBeDefined()
      expect(String((upload as T16Step).if ?? "")).toContain("failure()")
      expect(String((upload?.with?.["name"] ?? ""))).toContain(name)
      expect(String(upload?.with?.["path"] ?? "")).toContain("test-results")
    }
  })
})
