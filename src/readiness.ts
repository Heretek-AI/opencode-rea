import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ReaOptions } from "./options.js"
import { sanitizeServerNamespace } from "./options.js"

export const READINESS_TOOL_NAME = "rea_readiness"
export const UPSTREAM_SKILL_ID = "reverse-engineer-anything"
export const DOCTOR_CMD = "rea doctor --client opencode --json"
export const SETUP_CMD = "rea setup --client opencode --dry-run"

/**
 * Primary REA entry-point tools pinned in OpenCode v2's Code Mode catalog so
 * the 2,000-token inline summary always surfaces target-routing entry points
 * ahead of arbitrary short-signature helpers.
 */
export const PINNED_REA_TOOLS = [
  "analyze_javascript_application",
  "binary_session",
  "inspect_analysis_view",
  "inspect_android_package",
  "inspect_artifact",
  "inspect_binary_layout",
  "inspect_managed_artifact",
  "list_unknowns",
  "open_binary",
  "record_unknown",
] as const

export type PinnedReaToolName = (typeof PINNED_REA_TOOLS)[number]

export const REA_NAMESPACE_DESCRIPTION =
  "REA reverse-engineering analysis, artifact inspection, version comparison, and runtime observation tools."

export interface ReadinessOutput {
  readonly server: string
  readonly status: string
  readonly statusError: string | null
  readonly reaToolCount: number
  readonly codemodeToolCount: number
  readonly directToolCount: number
  readonly upstreamSkillAvailable: boolean
  readonly version: string
  readonly remediation: ReadonlyArray<string>
}

export interface ToolEditorLike {
  add(tool: any): void
  list?: () => Iterable<any> | ReadonlyArray<any>
  update?: (id: string, fn: (tool: any) => void) => void
  namespace?: (ns: { name: string; description?: string }) => void
  describe?: (ns: string, description: string) => void
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

export const ReadinessInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const

export const ReadinessOutputSchema = {
  type: "object",
  properties: {
    server: { type: "string" },
    status: { type: "string" },
    statusError: { anyOf: [{ type: "string" }, { type: "null" }] },
    reaToolCount: { type: "number" },
    codemodeToolCount: { type: "number" },
    directToolCount: { type: "number" },
    upstreamSkillAvailable: { type: "boolean" },
    version: { type: "string" },
    remediation: { type: "array", items: { type: "string" } },
  },
  required: [
    "server",
    "status",
    "statusError",
    "reaToolCount",
    "codemodeToolCount",
    "directToolCount",
    "upstreamSkillAvailable",
    "version",
    "remediation",
  ],
  additionalProperties: false,
} as const

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

export interface ReaToolCounts {
  readonly reaToolCount: number
  readonly codemodeToolCount: number
  readonly directToolCount: number
}

export function countReaToolsByMode(toolListResult: unknown, server: string): ReaToolCounts {
  // Effective names carry the `<sanitized-server>_` prefix (default server is "rea", so
  // this is the rea_ count). Entries expose `id` and/or `name`; check both.
  // The plugin's own readiness tool matches the default prefix, so exclude it:
  // the count reflects MCP-server tools only (0 when the server is absent).
  const prefix = `${sanitizeServerNamespace(server)}_`
  const entries: Array<any> = Array.isArray(toolListResult)
    ? toolListResult
    : Array.isArray((toolListResult as { data?: unknown } | null)?.data)
      ? ((toolListResult as { data: Array<any> }).data)
      : []
  let reaToolCount = 0
  let codemodeToolCount = 0
  let directToolCount = 0
  for (const entry of entries) {
    const id = typeof entry?.id === "string" ? (entry.id as string) : ""
    const name = typeof entry?.name === "string" ? (entry.name as string) : ""
    if (id === READINESS_TOOL_NAME || name === READINESS_TOOL_NAME) continue
    if (id.startsWith(prefix) || name.startsWith(prefix)) {
      reaToolCount++
      if (entry?.options?.codemode === false) directToolCount++
      else codemodeToolCount++
    }
  }
  return { reaToolCount, codemodeToolCount, directToolCount }
}

export function countReaMcpTools(toolListResult: unknown, server: string): number {
  return countReaToolsByMode(toolListResult, server).reaToolCount
}

export const countReaTools = countReaMcpTools

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

function entriesFromEditorList(raw: unknown): Array<any> {
  if (Array.isArray(raw)) return raw
  if (raw instanceof Map) return [...raw.values()]
  if (raw && typeof (raw as Iterable<any>)[Symbol.iterator] === "function") {
    return [...(raw as Iterable<any>)]
  }
  return []
}

/**
 * Configure the REA namespace description, pin primary entry-point tools in
 * OpenCode v2's Code Mode catalog, and apply any explicit `options.codemode`
 * override via `ctx.tool.transform` (never touching `ctx.mcp.transform`).
 */
export function applyReaToolCatalogPolicy(tools: ToolEditorLike, options: ReaOptions): void {
  const namespace = sanitizeServerNamespace(options.server)
  if (typeof tools.namespace === "function") {
    tools.namespace({
      name: namespace,
      description: REA_NAMESPACE_DESCRIPTION,
    })
  }
  if (typeof tools.describe === "function") {
    tools.describe(namespace, REA_NAMESPACE_DESCRIPTION)
  }
  if (typeof tools.update === "function") {
    const pinnedIds = new Set(PINNED_REA_TOOLS.map((name) => `${namespace}_${name}`))
    for (const id of pinnedIds) {
      tools.update(id, (tool) => {
        tool.options = {
          ...(tool.options ?? {}),
          pinned: true,
          ...(options.codemode === undefined ? {} : { codemode: options.codemode }),
        }
      })
    }
    if (options.codemode !== undefined && typeof tools.list === "function") {
      const prefix = `${namespace}_`
      for (const entry of entriesFromEditorList(tools.list())) {
        const id =
          typeof entry?.id === "string"
            ? (entry.id as string)
            : typeof entry?.name === "string"
              ? (entry.name as string)
              : ""
        if (!id.startsWith(prefix) || id === READINESS_TOOL_NAME || pinnedIds.has(id)) continue
        tools.update(id, (tool) => {
          tool.options = {
            ...(tool.options ?? {}),
            codemode: options.codemode,
          }
        })
      }
    }
  }
}

/** Register the read-only `rea_readiness` native tool and REA tool catalog policy (no writes, no MCP config mutation). */
export async function registerReadiness(ctx: ReadinessCtxLike, options: ReaOptions): Promise<void> {
  await ctx.tool.transform((tools) => {
    applyReaToolCatalogPolicy(tools, options)
    tools.add({
      name: READINESS_TOOL_NAME,
      description:
        "Report REA MCP readiness: live server status, rea_ tool count (including Code Mode vs direct native counts), upstream skill availability, and remediation.",
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
        const counts = countReaToolsByMode(toolRes, options.server)
        const { reaToolCount, codemodeToolCount, directToolCount } = counts
        const upstreamSkillAvailable = isUpstreamSkillAvailable(skillRes)
        const remediation = buildRemediation()
        const output: ReadinessOutput = {
          server: options.server,
          status,
          statusError,
          reaToolCount,
          codemodeToolCount,
          directToolCount,
          upstreamSkillAvailable,
          version,
          remediation: [...remediation],
        }
        const skillText = upstreamSkillAvailable ? "upstream skill available" : "upstream skill missing"
        const toolPrefix = `${sanitizeServerNamespace(options.server)}_`
        const modeSummary =
          reaToolCount > 0 ? ` (${codemodeToolCount} codemode, ${directToolCount} direct)` : ""
        const content =
          `rea_readiness: server "${options.server}" status "${status}"` +
          (statusError ? ` (${statusError})` : "") +
          `, ${reaToolCount} ${toolPrefix} tool(s)${modeSummary}, ${skillText}, version ${version}.` +
          ` Remediation: ${remediation.join(" ; ")}`
        return { output, content }
      },
    })
  })
}

/** Convention alias: the module exposes one `register` alongside `registerReadiness`. */
export const register = registerReadiness
