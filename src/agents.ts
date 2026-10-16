import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { DEBUGGER_SESSION_TOOLS, RUNTIME_EFFECT_TOOLS, isDebuggerSessionTool, isRuntimeEffectTool } from "./effects.js"
import type { ReaOptions, RuntimeOption } from "./options.js"
import { sanitizeServerNamespace } from "./options.js"

export const AGENT_IDS = ["rea", "rea-analyst", "rea-runtime", "rea-auditor"] as const

export type AgentId = (typeof AGENT_IDS)[number]

export interface ParsedAgentFile {
  readonly name: string
  readonly description: string
  readonly body: string
}

export type ParsedAgent = ParsedAgentFile

export interface AgentPermissionRule {
  readonly action: string
  readonly resource: string
  readonly effect: RuntimeOption | "deny"
}

export type PermissionRule = AgentPermissionRule

export interface PermissionEvaluationEventLike {
  readonly sessionID?: string
  readonly agent?: string
  readonly action: string
  readonly resource?: string
  readonly resources?: ReadonlyArray<string>
  readonly rules?: ReadonlyArray<{ action: string; resource: string; effect: string }>
  effect?: RuntimeOption | "deny"
  message?: string
}

interface AgentMutableLike {
  name: unknown
  description?: unknown
  mode?: unknown
  system?: unknown
  permissions: Array<{ action: string; resource: string; effect: string }>
}

interface AgentEditorLike {
  update(id: string, fn: (agent: AgentMutableLike) => void): void
}

interface AgentCtxLike {
  agent: {
    transform(cb: (editor: AgentEditorLike) => void): unknown
    get?: (input: { agentID: string }) => Promise<unknown>
  }
  permission?: {
    hook(
      name: "evaluate",
      cb: (event: PermissionEvaluationEventLike) => Promise<unknown> | unknown,
    ): unknown
  }
}

/** Resolve the shipped `agents/` dir at runtime and under bun test. */
export function resolveAgentsDir(): string {
  const candidates: string[] = []
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url))
    candidates.push(join(moduleDir, "..", "agents"), join(moduleDir, "..", "..", "agents"))
  } catch {
    // import.meta.url unavailable: fall through to cwd.
  }
  candidates.push(join(process.cwd(), "agents"))
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0] ?? join(process.cwd(), "agents")
}

/** Split an agent .md file into frontmatter (`description:`) and body (the prompt). */
export function parseAgentFile(content: string, agentId = "unknown"): ParsedAgentFile {
  const lines = content.split("\n")
  if (lines[0]?.trim() !== "---") {
    throw new Error(`invalid agent file for agent "${agentId}": missing opening frontmatter delimiter`)
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (end === -1) {
    throw new Error(`invalid agent file for agent "${agentId}": missing closing frontmatter delimiter`)
  }
  let description = ""
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^description\s*:\s*(.*)$/)
    if (match) description = match[1]?.trim() ?? ""
  }
  if (!description) {
    throw new Error(`invalid agent file for agent "${agentId}": missing non-empty "description:" in frontmatter`)
  }
  const body = lines
    .slice(end + 1)
    .join("\n")
    .trim()
  if (!body) {
    throw new Error(`invalid agent file for agent "${agentId}": missing body after frontmatter`)
  }
  return { name: agentId, description, body }
}

/**
 * Permission rules for one agent. Tool actions use the MCP permission shape
 * `<sanitized-server>_<tool>` (prior-art tool/mcp.ts name(), mirrored via
 * sanitizeServerNamespace); edit/write/patch share
 * the `edit` action. Rules do not overlap except by design, and wildcard
 * denies come first so tool rules are the LAST matching rules for their
 * actions (prior-art permission.ts evaluate uses findLast).
 */
export function buildAgentPermissions(
  agentId: AgentId | string,
  options: ReaOptions,
): ReadonlyArray<AgentPermissionRule> {
  const namespace = sanitizeServerNamespace(options.server)
  const toolRules = RUNTIME_EFFECT_TOOLS.map((tool) => ({
    action: `${namespace}_${tool.name}`,
    resource: "*",
  }))
  switch (agentId) {
    case "rea":
      // Lead investigator keeps defaults: only runtime-effect tools gate on
      // the `runtime` option; no edit/subagent/shell denies.
      return toolRules.map((rule) => ({ ...rule, effect: options.runtime }))
    case "rea-analyst":
    case "rea-auditor":
      // Static-only / audit-only: everything gates to deny.
      return [
        { action: "edit", resource: "*", effect: "deny" as const },
        { action: "subagent", resource: "*", effect: "deny" as const },
        { action: "shell", resource: "*", effect: "deny" as const },
        ...toolRules.map((rule) => ({ ...rule, effect: "deny" as const })),
      ]
    case "rea-runtime":
      return [
        { action: "edit", resource: "*", effect: "deny" as const },
        { action: "subagent", resource: "*", effect: "deny" as const },
        { action: "shell", resource: "*", effect: "deny" as const },
        ...toolRules.map((rule) => ({ ...rule, effect: options.runtime })),
      ]
    default:
      throw new Error(`unknown agent id: "${agentId}"`)
  }
}

function agentMode(agentId: AgentId): "primary" | "subagent" {
  return agentId === "rea" ? "primary" : "subagent"
}

function isKnownAgentId(id: string | undefined): id is AgentId {
  return typeof id === "string" && (AGENT_IDS as ReadonlyArray<string>).includes(id)
}

function matchPattern(pattern: string, value: string): boolean {
  if (pattern === "*") return true
  if (!pattern.includes("*")) return value === pattern
  return new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(value)
}

/**
 * Evaluate the plugin's boundary policy for an OpenCode v2 `permission.evaluate`
 * hook event. In OpenCode v2, `ConfigAgentPlugin` runs in `post` (after external
 * plugins) and appends top-level `opencode.json` `permissions` (often
 * `{ action: "*", resource: "*", effect: "allow" }`) onto every agent's
 * permissions list, which would otherwise override `rea-*` specialist denies via
 * `findLast`. This evaluator restores the specialist boundary unless an explicit
 * non-wildcard per-agent rule (`action !== "*"`) was configured after the
 * plugin's rules.
 */
export function evaluateAgentPermission(
  event: PermissionEvaluationEventLike,
  options: ReaOptions,
  tailOverrides?: ReadonlyArray<{ action: string; resource: string; effect: string }>,
): { effect: RuntimeOption | "deny" } | undefined {
  if (!isKnownAgentId(event.agent)) return undefined

  const baselineRules = buildAgentPermissions(event.agent, options)
  const effectiveTail =
    tailOverrides !== undefined
      ? tailOverrides
      : Array.isArray(event.rules) && event.rules.length > baselineRules.length
        ? event.rules.slice(baselineRules.length)
        : []

  // Respect explicit non-wildcard per-agent overrides configured in agents.<id>.permissions.
  const explicitOverride = [...effectiveTail]
    .reverse()
    .find((rule) => rule.action !== "*" && matchPattern(rule.action, event.action))
  if (
    explicitOverride &&
    (explicitOverride.effect === "allow" || explicitOverride.effect === "ask" || explicitOverride.effect === "deny")
  ) {
    event.effect = explicitOverride.effect
    return { effect: explicitOverride.effect }
  }

  const namespace = sanitizeServerNamespace(options.server)
  const prefix = `${namespace}_`
  const baseToolName = event.action.startsWith(prefix) ? event.action.slice(prefix.length) : ""
  const isGatedReaTool = baseToolName.length > 0 && isRuntimeEffectTool(baseToolName)
  const isDeniedHostTool = event.action === "edit" || event.action === "subagent" || event.action === "shell"

  switch (event.agent) {
    case "rea-analyst":
    case "rea-auditor": {
      if (isDeniedHostTool || isGatedReaTool) {
        const role = event.agent === "rea-analyst" ? "static-only" : "read-only"
        event.effect = "deny"
        event.message = `Permission denied: ${event.agent} is ${role} and cannot execute "${event.action}".`
        return { effect: "deny" }
      }
      return event.effect ? { effect: event.effect } : undefined
    }
    case "rea-runtime": {
      if (isDeniedHostTool) {
        event.effect = "deny"
        event.message = `Permission denied: rea-runtime is an observation specialist and cannot execute "${event.action}".`
        return { effect: "deny" }
      }
      if (isGatedReaTool) {
        if (options.runtime === "deny") {
          event.effect = "deny"
          event.message = `Permission denied: runtime-effect tool "${event.action}" is disabled by plugin option runtime="deny".`
          return { effect: "deny" }
        }
        event.effect = options.runtime
        return { effect: options.runtime }
      }
      return event.effect ? { effect: event.effect } : undefined
    }
    case "rea": {
      if (isGatedReaTool) {
        if (options.runtime === "deny") {
          event.effect = "deny"
          event.message = `Permission denied: runtime-effect tool "${event.action}" is disabled by plugin option runtime="deny".`
          return { effect: "deny" }
        }
        event.effect = options.runtime
        return { effect: options.runtime }
      }
      return event.effect ? { effect: event.effect } : undefined
    }
  }
}

/** Register the 4 shipped rea-* agents via a single ctx.agent.transform and optional permission hook. */
export async function registerAgents(ctx: AgentCtxLike, options: ReaOptions): Promise<void> {
  const dir = resolveAgentsDir()
  const loaded = await Promise.all(
    AGENT_IDS.map(async (id) => {
      const path = join(dir, `${id}.md`)
      let raw: string
      try {
        raw = await readFile(path, "utf8")
      } catch {
        throw new Error(`missing agent file for agent "${id}" at ${path}`)
      }
      const parsed = parseAgentFile(raw, id)
      const permissions = buildAgentPermissions(id, options)
      return { id, parsed, permissions }
    }),
  )

  const baselineLengths = new Map<AgentId, number>()
  await ctx.agent.transform((editor) => {
    // update() upserts (prior-art agent.ts): pushes append after the host
    // defaults and after earlier transforms, so config agents.<id> rules
    // registered later still win via last-match evaluation.
    for (const { id, parsed, permissions } of loaded) {
      editor.update(id, (agent) => {
        agent.name = id
        agent.description = parsed.description
        agent.mode = agentMode(id)
        agent.system = parsed.body
        for (const rule of permissions) {
          agent.permissions.push({ ...rule })
        }
        baselineLengths.set(id, agent.permissions.length)
      })
    }
  })

  if (typeof ctx.permission?.hook === "function") {
    await ctx.permission.hook("evaluate", async (event) => {
      if (!isKnownAgentId(event.agent)) return
      let tailOverrides: Array<{ action: string; resource: string; effect: string }> | undefined
      if (typeof ctx.agent.get === "function") {
        try {
          const res = (await ctx.agent.get({ agentID: event.agent })) as any
          const data = res?.data ?? res
          const perms: Array<{ action: string; resource: string; effect: string }> = Array.isArray(data?.permissions)
            ? data.permissions
            : []
          const baseline = baselineLengths.get(event.agent) ?? 0
          if (perms.length > baseline) {
            tailOverrides = perms.slice(baseline)
          }
        } catch {
          // Best-effort lookup; fall back to undefined tailOverrides.
        }
      }
      evaluateAgentPermission(event, options, tailOverrides)
    })
  }
}

export { DEBUGGER_SESSION_TOOLS, isDebuggerSessionTool }

/** Convention alias: the module exposes one `register` alongside `registerAgents`. */
export const register = registerAgents
