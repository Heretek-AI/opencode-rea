import { WORKFLOWS_STEP_LABEL, formatResults, runBootstrap, type BootstrapOptions, type StepResult } from "./bootstrap.js"

/**
 * M2 native tool: `rea_bootstrap_stack`. Mirrors the Unity kit's
 * `gamedev_bootstrap_stack` (permission-gated, progress-reporting installs,
 * skill reload afterwards) for the REA stack. Thin by design: it reuses the
 * M1 runner in `src/bootstrap.ts` and adds no runtime dependencies.
 */

export const BOOTSTRAP_TOOL_NAME = "rea_bootstrap_stack"
export const BOOTSTRAP_PERMISSION_ACTION = "rea_bootstrap_stack"

/** JSON-Schema input: three optional booleans, nothing else. */
export const BootstrapToolInputSchema = {
  type: "object",
  properties: {
    installSkills: { type: "boolean", description: "Install the four RE skill packs. Default: true." },
    installMemory: { type: "boolean", description: "Install @aerovato/operator-helper and run `operator-helper install opencode-v2`. Default: true." },
    installWorkflows: { type: "boolean", description: "Install @rphang/opencode-workflows. Default: true." },
  },
  additionalProperties: false,
} as const

export interface BootstrapToolInput {
  readonly installSkills?: boolean
  readonly installMemory?: boolean
  readonly installWorkflows?: boolean
}

export interface BootstrapToolCallContext {
  readonly sessionID: string
  readonly agent?: string
  readonly messageID?: string
  readonly id?: string
  readonly signal?: AbortSignal
  readonly progress: (update: { status: string }) => Promise<unknown> | unknown
}

interface BootstrapToolEditorLike {
  add(tool: {
    name: string
    description?: string
    input: unknown
    options?: { codemode?: boolean }
    execute: (input: BootstrapToolInput, context: BootstrapToolCallContext) => Promise<unknown>
  }): void
}

interface BootstrapToolCtxLike {
  tool: {
    transform(cb: (editor: BootstrapToolEditorLike) => void): unknown
  }
  skill: {
    reload(): Promise<unknown>
  }
  /** `permission` is untyped: `assert` exists on newer hosts only (see D6). */
  permission: unknown
  location: {
    directory: string
  }
}

interface PermissionAssertRequest {
  readonly sessionID: string
  readonly agent?: string
  readonly source?: { type: string; messageID?: string; id?: string }
  readonly action: string
  readonly resources: ReadonlyArray<string>
  readonly save: ReadonlyArray<string>
}

/**
 * Fail-closed permission gate. Newer hosts (observed: 2.0.32) provide
 * `ctx.permission.assert`; the pinned 2.0.26 host does not (see docs/NOTES.md
 * D6). When the capability is missing we refuse to run installs rather than
 * running them unapproved.
 */
export function readPermissionAssert(permission: unknown): (request: PermissionAssertRequest) => Promise<unknown> {
  const assert = (permission as { assert?: unknown } | null | undefined)?.assert
  if (typeof assert !== "function") {
    throw new Error(
      `${BOOTSTRAP_TOOL_NAME}: host permission.assert is unavailable — refusing to run installs without approval. ` +
        `Use a host that provides permission.assert (observed on @opencode/cli 2.0.32), or install the stack manually.`,
    )
  }
  return assert as (request: PermissionAssertRequest) => Promise<unknown>
}

/**
 * D5: the OpenCode Workflows step is known to fail on hosts the plugin does
 * not support (its upstream pins opencode 2.0.15; it fails to load on
 * 2.0.32). A non-ok workflows step must not fail the whole bootstrap:
 * bounded fan-out falls back to REA's own subagent delegation. Surface that
 * fallback next to the formatted results.
 */
export function withWorkflowsFallbackNote(content: string, results: readonly StepResult[]): string {
  const workflows = results.find((result) => result.label === WORKFLOWS_STEP_LABEL)
  if (workflows && workflows.status !== "ok") {
    return (
      `${content}\n\nNote: the "${WORKFLOWS_STEP_LABEL}" step did not complete (${workflows.status}); ` +
      `bounded fan-out falls back to REA's own subagent delegation (see docs/NOTES.md D5).`
    )
  }
  return content
}

function normalizeInput(input: BootstrapToolInput | undefined): BootstrapOptions {
  return {
    ...(input?.installSkills === undefined ? {} : { installSkills: input.installSkills }),
    ...(input?.installMemory === undefined ? {} : { installMemory: input.installMemory }),
    ...(input?.installWorkflows === undefined ? {} : { installWorkflows: input.installWorkflows }),
  }
}

/** Register the `rea_bootstrap_stack` native tool via ctx.tool.transform (never ctx.mcp.transform). */
export async function registerBootstrapTool(ctx: BootstrapToolCtxLike): Promise<void> {
  const directory = ctx.location.directory
  await ctx.tool.transform((tools) => {
    tools.add({
      name: BOOTSTRAP_TOOL_NAME,
      description:
        "Install the REA reverse-engineering stack (skill packs, operator-memory, parallel-fan-out workflows). Runs package installs, so it asks the user first.",
      input: BootstrapToolInputSchema,
      options: { codemode: false },
      execute: async (input, context) => {
        const args = normalizeInput(input ?? {})
        await readPermissionAssert(ctx.permission)({
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.messageID, id: context.id },
          action: BOOTSTRAP_PERMISSION_ACTION,
          resources: [directory],
          save: ["*"],
        })
        const results = await runBootstrap(directory, args, {
          signal: context.signal,
          onStep: (label, index, total) => {
            void context.progress({ status: `${index}/${total} ${label}` })
          },
        })
        await ctx.skill.reload()
        const content = withWorkflowsFallbackNote(formatResults(results), results)
        return { content, metadata: { results } }
      },
    })
  })
}

/** Convention alias: the module exposes one `register` alongside `registerBootstrapTool`. */
export const register = registerBootstrapTool
