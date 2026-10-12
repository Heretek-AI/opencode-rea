import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"

export interface IsolatedEnv {
  root: string
  home: string
  configDir: string
  dataDir: string
  cacheDir: string
  stateDir: string
  workspaceDir: string
  env: Record<string, string>
  cleanup: () => Promise<void>
}

function pickEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") out[k] = v
  }
  return out
}

/** Create hermetic temp roots for HOME, XDG_*, OPENCODE_CONFIG_DIR and a workspace. */
export async function mkIsolatedEnv(): Promise<IsolatedEnv> {
  const root = await mkdtemp(join(tmpdir(), "opencode-rea-t02-"))
  const home = join(root, "home")
  const configDir = join(root, "config")
  const dataDir = join(root, "data")
  const cacheDir = join(root, "cache")
  const stateDir = join(root, "state")
  const workspaceDir = join(root, "workspace")
  for (const d of [home, configDir, dataDir, cacheDir, stateDir, workspaceDir]) {
    await mkdir(d, { recursive: true })
  }
  const base = pickEnv()
  const env: Record<string, string> = {
    ...base,
    HOME: home,
    USERPROFILE: home,
    OPENCODE_TEST_HOME: home,
    XDG_CONFIG_HOME: configDir,
    XDG_DATA_HOME: dataDir,
    XDG_CACHE_HOME: cacheDir,
    XDG_STATE_HOME: stateDir,
    OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    OPENCODE_DISABLE_MODELS_FETCH: "true",
    OPENCODE_PURE: "true",
  }
  // Never leak a real API key into the hermetic run.
  for (const k of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) delete env[k]
  return {
    root,
    home,
    configDir,
    dataDir,
    cacheDir,
    stateDir,
    workspaceDir,
    env,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true })
    },
  }
}

/** v2 `providers` fragment pointing at the loopback fixture (matches embedded.test.ts shape). */
export function providerFragment(
  baseUrl: string,
  opts?: { providerId?: string; modelId?: string; apiKey?: string },
): Record<string, unknown> {
  const providerId = opts?.providerId ?? "fixture-test"
  const modelId = opts?.modelId ?? "fixture-model"
  return {
    model: `${providerId}/${modelId}`,
    providers: {
      [providerId]: {
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: baseUrl, apiKey: opts?.apiKey ?? "local-fixture-key" },
        models: {
          [modelId]: {
            name: "Fixture model",
            capabilities: { tools: true },
            limit: { context: 1_000_000, output: 4096 },
          },
        },
      },
    },
  }
}

/** Write (merge) opencode.json into the isolated OPENCODE_CONFIG_DIR. Returns the file path. */
export async function writeOpencodeJson(env: IsolatedEnv, value: Record<string, unknown>): Promise<string> {
  const path = join(env.configDir, "opencode.json")
  let current: Record<string, unknown> = {}
  try {
    const text = await Bun.file(path).text()
    current = JSON.parse(text) as Record<string, unknown>
  } catch {
    current = {}
  }
  const merged = { ...current, ...value }
  await writeFile(path, JSON.stringify(merged, null, 2) + "\n")
  return path
}

export interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
}

function runBin(
  bin: string,
  args: string[],
  env: IsolatedEnv,
  opts?: { cwd?: string; timeoutMs?: number; stdin?: string },
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: opts?.cwd ?? env.workspaceDir,
      env: env.env,
      stdio: ["pipe", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d) => (stdout += String(d)))
    child.stderr.on("data", (d) => (stderr += String(d)))
    const timer =
      opts?.timeoutMs !== undefined
        ? setTimeout(() => {
            child.kill("SIGKILL")
            reject(new Error(`command timed out: ${bin} ${args.join(" ")}`))
          }, opts.timeoutMs)
        : undefined
    child.on("error", (e) => {
      if (timer) clearTimeout(timer)
      reject(e)
    })
    child.on("close", (code) => {
      if (timer) clearTimeout(timer)
      resolve({ exitCode: code ?? 1, stdout, stderr })
    })
    try {
      child.stdin.end(opts?.stdin ?? "")
    } catch {
      // ignore stdin errors (closed pipe)
    }
  })
}

function worktreeBin(name: string): string {
  return resolve(process.cwd(), "node_modules", ".bin", name)
}

/** Run `rea setup --client opencode --yes --format json` (plus extra args) with the isolated env. */
export async function runReaSetup(env: IsolatedEnv, args: string[] = [], opts?: { timeoutMs?: number }): Promise<RunResult> {
  // Installed rea-agents uses `--format json` (verified against the real CLI).
  return runBin(worktreeBin("rea"), ["setup", "--client", "opencode", "--yes", "--format", "json", ...args], env, {
    timeoutMs: opts?.timeoutMs ?? 60_000,
  })
}

/** Run the real @opencode/cli against the isolated env. */
export async function runOpencodeRun(
  env: IsolatedEnv,
  args: string[],
  opts?: { timeoutMs?: number; cwd?: string },
): Promise<RunResult> {
  // `opencode run` reads stdin; close it immediately for non-interactive use.
  return runBin(worktreeBin("opencode"), args, env, { timeoutMs: opts?.timeoutMs ?? 120_000, cwd: opts?.cwd ?? env.workspaceDir })
}
