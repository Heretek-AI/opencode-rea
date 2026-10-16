import { Plugin } from "@opencode/plugin"
import { registerAgents } from "./agents.js"
import { registerCommands } from "./commands.js"
import { parseOptions } from "./options.js"
import { registerReadiness } from "./readiness.js"
import { registerSkills } from "./skills.js"

export {
  AGENT_IDS,
  buildAgentPermissions,
  evaluateAgentPermission,
  parseAgentFile,
  registerAgents,
  resolveAgentsDir,
  type AgentId,
  type ParsedAgent,
  type PermissionRule,
} from "./agents.js"
export {
  COMMAND_IDS,
  REA_PROMPT_COMMANDS,
  registerCommands,
  type CommandId,
} from "./commands.js"
export {
  DEBUGGER_SESSION_TOOLS,
  RUNTIME_EFFECT_TOOLS,
  isDebuggerSessionTool,
  isRuntimeEffectTool,
  type DebuggerSessionToolName,
  type EffectCategory,
  type RuntimeEffectTool,
} from "./effects.js"
export {
  parseOptions,
  sanitizeServerNamespace,
  type PluginOptions,
  type RuntimePolicy,
} from "./options.js"
export {
  DOCTOR_CMD,
  PINNED_REA_TOOLS,
  READINESS_TOOL_NAME,
  REA_NAMESPACE_DESCRIPTION,
  ReadinessOutputSchema,
  SETUP_CMD,
  UPSTREAM_SKILL_ID,
  applyReaToolCatalogPolicy,
  countReaMcpTools,
  countReaToolsByMode,
  registerReadiness,
  type PinnedReaToolName,
  type ReadinessOutput,
} from "./readiness.js"
export {
  SKILL_IDS,
  parseSkillFile,
  registerSkills,
  resolveSkillsDir,
  type ParsedSkill,
  type SkillId,
} from "./skills.js"

export default Plugin.define({
  id: "rea",
  setup: async (ctx) => {
    const options = parseOptions(ctx.options)
    await registerSkills(ctx as any, options)
    await registerAgents(ctx as any, options)
    await registerReadiness(ctx as any, options)
    await registerCommands(ctx as any, options)
  },
})
