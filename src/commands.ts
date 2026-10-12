import type { ReaOptions } from "./options.js"
import { READINESS_TOOL_NAME } from "./readiness.js"

export const COMMAND_IDS = ["rea", "rea-doctor", "rea-report"] as const

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
// REA_PROMPT_COMMANDS, so the three slash commands never shadow or duplicate
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

function reaInvestigationText(args: string): string {
  const template = [
    "You are now acting as the rea reverse-engineering investigator agent.",
    "Run a staged investigation following the rea-investigation skill:",
    "scope the target, gather observations with evidence, then infer only from cited evidence.",
    "Keep a strict observation-vs-inference discipline: every claim cites its evidence,",
    "and unknowns stay explicit until verified by a tool.",
  ].join(" ")
  return appendArgs(template, args)
}

function reaDoctorText(readinessTool: string): string {
  return [
    `Run the REA readiness check by calling the ${readinessTool} tool.`,
    `Report each readiness item and act on the returned remediation:`,
    "apply the safe fixes you can, and list the remaining follow-ups with owners.",
  ].join(" ")
}

function reaReportText(): string {
  return [
    "Produce the REA evidence report for this session: organize observations vs",
    "inferences vs unknowns, cite every claim with its Evidence ID, and flag",
    "residual unknowns explicitly. When the report is complete, delegate a check",
    "to the rea-auditor agent for an independent audit pass.",
  ].join(" ")
}

/** Register the 3 rea slash commands via ctx.command.transform. */
export async function registerCommands(ctx: CommandCtxLike, _options: ReaOptions): Promise<void> {
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
          text: reaInvestigationText(userText(input)),
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
          text: reaDoctorText(readinessTool),
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
          text: reaReportText(),
          delivery: input.delivery,
        })
      },
    })
  })
}

/** Convention alias: the module exposes one `register` alongside `registerCommands`. */
export const register = registerCommands
