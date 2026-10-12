export type RuntimeOption = "ask" | "allow" | "deny"

export interface ReaOptions {
  readonly server: string
  readonly runtime: RuntimeOption
}

const RUNTIMES: ReadonlyArray<RuntimeOption> = ["ask", "allow", "deny"]

/** Mirror the host MCP namespace derivation (prior-art tool/mcp.ts name()). */
export function sanitizeServerNamespace(server: string): string {
  return server.replace(/[^a-zA-Z0-9_-]/g, "_")
}

export function parseOptions(raw?: unknown): ReaOptions {
  if (raw === undefined || raw === null) return { server: "rea", runtime: "ask" }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`invalid plugin options: expected an object, got ${Array.isArray(raw) ? "array" : typeof raw}`)
  }
  const input = raw as Record<string, unknown>
  for (const key of Object.keys(input)) {
    if (key !== "server" && key !== "runtime") {
      throw new Error(`unknown plugin option: "${key}"`)
    }
  }
  const server = input.server === undefined ? "rea" : input.server
  if (typeof server !== "string") {
    throw new Error(`invalid plugin option "server": expected a string, got ${typeof server}`)
  }
  if (server.trim().length === 0) {
    throw new Error(`invalid plugin option "server": expected a non-empty string, got ${JSON.stringify(server)}`)
  }
  const runtime = input.runtime === undefined ? "ask" : input.runtime
  if (typeof runtime !== "string" || !(RUNTIMES as ReadonlyArray<string>).includes(runtime)) {
    throw new Error(`invalid plugin option "runtime": expected one of "ask"|"allow"|"deny", got ${JSON.stringify(runtime) ?? typeof runtime}`)
  }
  return { server, runtime: runtime as RuntimeOption }
}
