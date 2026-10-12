import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { RUNTIME_EFFECT_TOOLS } from "./effects.js"
import type { ReaOptions, RuntimeOption } from "./options.js"
import { sanitizeServerNamespace } from "./options.js"

export const AGENT_IDS = ["rea", "rea-analyst", "rea-runtime", "rea-auditor"] as const

export type AgentId = (typeof AGENT_IDS)[number]

export interface ParsedAgentFile {
  readonly name: string
  readonly description: string
  readonly body: string
}

export interface AgentPermissionRule {
  readonly action: string
  readonly resource: string
  readonly effect: RuntimeOption | "deny"
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

/** Register the 4 shipped rea-* agents via ctx.agent.transform (update upserts). */
export async function registerAgents(ctx: AgentCtxLike, options: ReaOptions): Promise<void> {
  const dir = resolveAgentsDir()
  for (const id of AGENT_IDS) {
    const path = join(dir, `${id}.md`)
    let raw: string
    try {
      raw = await readFile(path, "utf8")
    } catch {
      throw new Error(`missing agent file for agent "${id}" at ${path}`)
    }
    const parsed = parseAgentFile(raw, id)
    const permissions = buildAgentPermissions(id, options)
    await ctx.agent.transform((editor) => {
      // update() upserts (prior-art agent.ts): pushes append after the host
      // defaults and after earlier transforms, so config agents.<id> rules
      // registered later still win via last-match evaluation.
      editor.update(id, (agent) => {
        agent.name = id
        agent.description = parsed.description
        agent.mode = agentMode(id)
        agent.system = parsed.body
        for (const rule of permissions) {
          agent.permissions.push({ ...rule })
        }
      })
    })
  }
}

/** Convention alias: the module exposes one `register` alongside `registerAgents`. */
export const register = registerAgents
