import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Schema } from "effect"
import type { ReaOptions } from "./options.js"

export const READINESS_TOOL_NAME = "rea_readiness"
export const UPSTREAM_SKILL_ID = "reverse-engineer-anything"
export const DOCTOR_CMD = "rea doctor --client opencode --json"
export const SETUP_CMD = "rea setup --client opencode --dry-run"

export interface ReadinessOutput {
  readonly server: string
  readonly status: string
  readonly statusError: string | null
  readonly reaToolCount: number
  readonly upstreamSkillAvailable: boolean
  readonly version: string
  readonly remediation: ReadonlyArray<string>
}

interface ToolEditorLike {
  add(tool: any): void
}

interface ReadinessCtxLike {
  tool: {
    transform(cb: (editor: ToolEditorLike) => void): unknown
    list(): Promise<unknown>
  }
  mcp: {
    list(): Promise<unknown>
  }
  skill: {
    list(): Promise<unknown>
  }
}

const ReadinessInputSchema = Schema.Struct({})
const ReadinessOutputSchema = Schema.Struct({
  server: Schema.String,
  status: Schema.String,
  statusError: Schema.NullOr(Schema.String),
  reaToolCount: Schema.Number,
  upstreamSkillAvailable: Schema.Boolean,
  version: Schema.String,
  remediation: Schema.Array(Schema.String),
})

/** Advice strings only: never executed or written by the tool. */
export function buildRemediation(): string[] {
  // Rationale (read-only reference
  // review/rea/.agents/skills/reverse-engineer-anything/references/connection-and-recovery.md):
  // doctor checks registration but cannot see the live connection; OpenCode can,
  // so the tool reports live status here and points at doctor/setup for repair.
  return [DOCTOR_CMD, SETUP_CMD]
}

/** Read plugin version from package.json; never throws (falls back to "unknown"). */
export async function resolvePluginVersion(): Promise<string> {
  const candidates: string[] = []
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url))
    candidates.push(join(moduleDir, "..", "package.json"), join(moduleDir, "..", "..", "package.json"))
  } catch {
    // import.meta.url unavailable: fall through to cwd.
  }
  candidates.push(join(process.cwd(), "package.json"))
  for (const candidate of candidates) {
    try {
      const text = await readFile(candidate, "utf8")
      const parsed = JSON.parse(text) as { version?: unknown }
      if (typeof parsed.version === "string" && parsed.version.length > 0) return parsed.version
    } catch {
      // try next candidate; never throw.
    }
  }
  return "unknown"
}

function unwrapData(result: unknown): unknown {
  if (result !== null && typeof result === "object" && "data" in (result as Record<string, unknown>)) {
    return (result as { data: unknown }).data
  }
  return result
}

function extractMcpStatus(mcpListResult: unknown, server: string): { status: string; statusError: string | null } {
  const data = unwrapData(mcpListResult)
  const entries: Array<any> = Array.isArray(data) ? data : data !== null && typeof data === "object" ? Object.values(data) : []
  const entry = entries.find((e) => e?.name === server)
  if (!entry) {
    return { status: "missing", statusError: null }
  }
  const raw = entry.status
  if (typeof raw === "string") return { status: raw, statusError: null }
  if (raw !== null && typeof raw === "object" && typeof (raw as { status?: unknown }).status === "string") {
    const status = (raw as { status: string }).status
    const error = (raw as { error?: unknown }).error
    return { status, statusError: typeof error === "string" ? error : null }
  }
  return { status: "missing", statusError: null }
}

function countReaTools(toolListResult: unknown, server: string): number {
  // Effective names carry the `<server>_` prefix (default server is "rea", so
  // this is the rea_ count). Entries expose `id` and/or `name`; check both.
  const prefix = `${server}_`
  const entries: Array<any> = Array.isArray(toolListResult)
    ? toolListResult
    : Array.isArray((toolListResult as { data?: unknown } | null)?.data)
      ? ((toolListResult as { data: Array<any> }).data)
      : []
  let count = 0
  for (const entry of entries) {
    const name = typeof entry?.id === "string" ? entry.id : typeof entry?.name === "string" ? entry.name : ""
    if (name.startsWith(prefix)) count++
  }
  return count
}

function isUpstreamSkillAvailable(skillListResult: unknown): boolean {
  const data = unwrapData(skillListResult)
  if (Array.isArray(data)) {
    return data.some((s) => s?.id === UPSTREAM_SKILL_ID)
  }
  if (data !== null && typeof data === "object") {
    return Object.keys(data).includes(UPSTREAM_SKILL_ID)
  }
  return false
}

/** Register the read-only `rea_readiness` native tool (no writes, no config mutation). */
export async function registerReadiness(ctx: ReadinessCtxLike, options: ReaOptions): Promise<void> {
  await ctx.tool.transform((tools) => {
    tools.add({
      name: READINESS_TOOL_NAME,
      description:
        "Report REA MCP readiness: live server status, rea_ tool count, upstream skill availability, and remediation.",
      input: ReadinessInputSchema,
      output: ReadinessOutputSchema,
      options: { codemode: false },
      execute: async () => {
        const [mcpRes, toolRes, skillRes, version] = await Promise.all([
          ctx.mcp.list(),
          ctx.tool.list(),
          ctx.skill.list(),
          resolvePluginVersion(),
        ])
        const { status, statusError } = extractMcpStatus(mcpRes, options.server)
        const reaToolCount = countReaTools(toolRes, options.server)
        const upstreamSkillAvailable = isUpstreamSkillAvailable(skillRes)
        const remediation = buildRemediation()
        const output: ReadinessOutput = {
          server: options.server,
          status,
          statusError,
          reaToolCount,
          upstreamSkillAvailable,
          version,
          remediation: [...remediation],
        }
        const skillText = upstreamSkillAvailable ? "upstream skill available" : "upstream skill missing"
        const content =
          `rea_readiness: server "${options.server}" status "${status}"` +
          (statusError ? ` (${statusError})` : "") +
          `, ${reaToolCount} ${options.server}_ tool(s), ${skillText}, version ${version}.` +
          ` Remediation: ${remediation.join(" ; ")}`
        return { output, content }
      },
    })
  })
}

/** Convention alias: the module exposes one `register` alongside `registerReadiness`. */
export const register = registerReadiness
