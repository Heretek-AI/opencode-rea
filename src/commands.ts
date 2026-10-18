import type { ReaOptions } from "./options.js"
import { sanitizeServerNamespace } from "./options.js"
import { BOOTSTRAP_TOOL_NAME } from "./bootstrap-tool.js"
import { READINESS_TOOL_NAME } from "./readiness.js"

export const COMMAND_IDS = ["rea", "rea-doctor", "rea-report", "rea-bootstrap"] as const

export type CommandId = (typeof COMMAND_IDS)[number]

/** Base MCP prompt names (see review/rea/docs/mcp-prompts.md). */
export const REA_PROMPT_BASE_NAMES = [
  "investigate_feature",
  "compare_application_versions",
  "verify_reconstruction",
  "trace_crash",
  "audit_residual_unknowns",
  "prepare_bounded_process_capture",
] as const

export type ReaPromptBaseName = (typeof REA_PROMPT_BASE_NAMES)[number]

/** MCP prompts surface as `rea:<name>` commands; plugin commands must not shadow them. */
export const REA_PROMPT_COMMANDS = REA_PROMPT_BASE_NAMES.map((name) => `rea:${name}` as const)

// Invariant: none of COMMAND_IDS contains ":" and none equals any of
// REA_PROMPT_COMMANDS, so the four slash commands never shadow or duplicate
// the six `rea:<prompt>` MCP prompt commands.

export interface CommandPromptLike {
  readonly text?: unknown
  readonly [key: string]: unknown
}

export interface CommandInvocationLike {
  readonly sessionID: string
  readonly prompt: CommandPromptLike
  readonly delivery: unknown
}

export interface CommandDefinitionLike {
  readonly name: string
  readonly description?: string
  readonly execute: (input: CommandInvocationLike) => Promise<unknown>
}

interface CommandEditorLike {
  add(definition: CommandDefinitionLike): void
}

interface CommandCtxLike {
  command: {
    transform(cb: (editor: CommandEditorLike) => void): unknown
  }
  session: {
    switchAgent(input: { sessionID: string; agent: string }): Promise<unknown>
    prompt(input: Record<string, unknown>): Promise<unknown>
  }
}

function userText(input: CommandInvocationLike): string {
  const text = (input.prompt as { text?: unknown }).text
  return typeof text === "string" ? text.trim() : ""
}

function appendArgs(template: string, args: string): string {
  if (!args) return template
  return `${template}\n\n${args}`
}

function reaInvestigationText(args: string, options: ReaOptions): string {
  const namespace = sanitizeServerNamespace(options.server)
  const template = [
    "You are now acting as the rea reverse-engineering investigator agent.",
    "Run a staged investigation following the rea-investigation skill:",
    "scope the target, gather observations with evidence (preferring detail: \"summary\" first and paging via inspect_analysis_view with parent_evidence_id),",
    `then infer only from cited evidence using the ${namespace} MCP tool surface.`,
    "Keep a strict observation-vs-inference discipline: every claim cites its evidence,",
    "and unknowns stay explicit until verified by a tool.",
  ].join(" ")
  return appendArgs(template, args)
}

function reaDoctorText(readinessTool: string, options: ReaOptions): string {
  return [
    `Run the REA readiness check for server "${options.server}" by calling the ${readinessTool} tool.`,
    "Report each readiness item (server status, total/codemode/direct tool counts, upstream skill availability, version) and act on the returned remediation:",
    "apply the safe fixes you can, and list the remaining follow-ups with owners.",
  ].join(" ")
}

function reaReportText(args: string): string {
  const template = [
    "Produce the REA evidence report for this session following the rea-evidence-report skill: organize observations vs",
    "inferences vs unknowns, cite every claim with its Evidence ID, preserve null/unknown states without coercing them, and flag",
    "residual unknowns explicitly. When the report is complete, delegate a check",
    "to the rea-auditor agent for an independent audit pass.",
  ].join(" ")
  return appendArgs(template, args)
}

function reaBootstrapText(args: string): string {
  const template = [
    `Install the REA reverse-engineering stack by calling the ${BOOTSTRAP_TOOL_NAME} tool (passing through any requested installSkills/installMemory/installWorkflows flags), then call the ${READINESS_TOOL_NAME} tool to verify the installation.`,
    "Report what installed: the per-step results from the bootstrap tool ([OK] / [FAILED] / [SKIPPED] lines) plus the readiness summary (server status, tool counts, skill availability, version).",
    "If the workflows step did not complete, note that bounded fan-out falls back to REA's own subagent delegation.",
  ].join(" ")
  return appendArgs(template, args)
}

/** Register the 4 rea slash commands via ctx.command.transform. */
export async function registerCommands(ctx: CommandCtxLike, options: ReaOptions): Promise<void> {
  const readinessTool = READINESS_TOOL_NAME
  await ctx.command.transform((editor) => {
    editor.add({
      name: "rea",
      description: "Switch to the rea investigator agent and run a staged investigation",
      execute: async (input) => {
        await ctx.session.switchAgent({ sessionID: input.sessionID, agent: "rea" })
        await ctx.session.prompt({
          ...input.prompt,
          sessionID: input.sessionID,
          text: reaInvestigationText(userText(input), options),
          delivery: input.delivery,
        })
      },
    })
    editor.add({
      name: "rea-doctor",
      description: "Run the REA readiness check and act on remediation",
      execute: async (input) => {
        await ctx.session.prompt({
          ...input.prompt,
          sessionID: input.sessionID,
          text: reaDoctorText(readinessTool, options),
          delivery: input.delivery,
        })
      },
    })
    editor.add({
      name: "rea-report",
      description: "Produce the REA evidence report, then delegate a check to rea-auditor",
      execute: async (input) => {
        await ctx.session.prompt({
          ...input.prompt,
          sessionID: input.sessionID,
          text: reaReportText(userText(input)),
          delivery: input.delivery,
        })
      },
    })
    editor.add({
      name: "rea-bootstrap",
      description: "Install the REA reverse-engineering stack, verify with rea_readiness, and report what installed",
      execute: async (input) => {
        await ctx.session.prompt({
          ...input.prompt,
          sessionID: input.sessionID,
          text: reaBootstrapText(userText(input)),
          delivery: input.delivery,
        })
      },
    })
  })
}

/** Convention alias: the module exposes one `register` alongside `registerCommands`. */
export const register = registerCommands
