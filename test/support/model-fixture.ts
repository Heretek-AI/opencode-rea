import { createServer, type Server } from "node:http"
import { appendFile, mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface FixtureToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export interface FixtureAssistantMessage {
  role: "assistant"
  content: string | null
  tool_calls?: FixtureToolCall[]
}

/** Scripted model reply. Text or a single tool call; raw passthrough also allowed. */
export type ScriptedResponse =
  | { type: "text"; text: string }
  | { type: "tool"; tool: string; args: Record<string, unknown>; content?: string | null }
  | { type: "raw"; message: Record<string, unknown> }
  | ((ctx: { body: any; requestIndex: number }) => ScriptedResponse | Promise<ScriptedResponse>)

export interface RecordedRequest {
  method: string
  path: string
  headers: Record<string, string | string[] | undefined>
  body: unknown
  requestIndex: number
  timestamp: number
}

export interface RecordedProbe {
  method: string
  path: string
  status: number
}

export interface FixtureHandle {
  /** Base URL for OpenAI-compatible provider settings, e.g. http://127.0.0.1:PORT/v1 */
  baseUrl: string
  url: string
  port: number
  requests: RecordedRequest[]
  probes: RecordedProbe[]
  logDir: string
  logFile: string
  close: () => Promise<void>
}

function redactHeaders(raw: Record<string, string | string[] | undefined>): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (["authorization", "x-api-key", "api-key", "proxy-authorization"].includes(k.toLowerCase())) {
      out[k] = "[REDACTED]"
    } else {
      out[k] = v
    }
  }
  return out
}

async function resolveResponse(
  scripted: ScriptedResponse | undefined,
  ctx: { body: any; requestIndex: number },
  callId: string,
): Promise<FixtureAssistantMessage> {
  const r = typeof scripted === "function" ? await scripted(ctx) : scripted
  if (r === undefined) return { role: "assistant", content: "fixture-default" }
  if (typeof r === "function") return resolveResponse(await (r as any)(ctx), ctx, callId)
  const v = r as Exclude<ScriptedResponse, Function>
  if ((v as any).role === "assistant") return v as unknown as FixtureAssistantMessage
  switch ((v as any).type) {
    case "text":
      return { role: "assistant", content: (v as any).text }
    case "tool":
      return {
        role: "assistant",
        content: (v as any).content ?? null,
        tool_calls: [
          {
            id: callId,
            type: "function",
            function: { name: (v as any).tool, arguments: JSON.stringify((v as any).args ?? {}) },
          },
        ],
      }
    case "raw":
      return (v as any).message as FixtureAssistantMessage
    default:
      return { role: "assistant", content: "fixture-default" }
  }
}

/**
 * Title-aware script wrapper: OpenCode issues a tool-less session-title request
 * before the real prompt. Answer it with `titleText` and serve the queued
 * one-shot responses to tool-capable requests in order (default fallback
 * `"fixture-default"` when the queue drains). Place no other entries ahead of
 * the returned handler: function handlers are sticky, one-shot objects shift.
 */
export function titleAware(script: ScriptedResponse[], titleText = "fixture-title"): ScriptedResponse {
  const queue = [...script]
  return ({ body }: { body: any; requestIndex: number }) =>
    (body?.tools ?? []).length === 0
      ? { type: "text", text: titleText }
      : (queue.shift() ?? { type: "text", text: "fixture-default" })
}

export async function start(options: { responses?: ScriptedResponse[]; logDir?: string; modelIds?: string[] }): Promise<FixtureHandle> {
  const responses = [...(options.responses ?? [])]
  const modelIds = options.modelIds ?? ["fixture-model", "rea-client-fixture"]
  const requests: RecordedRequest[] = []
  const probes: RecordedProbe[] = []
  const logDir = options.logDir ?? (await mkdtemp(join(tmpdir(), "t02-fixture-")))
  await mkdir(logDir, { recursive: true })
  const logFile = join(logDir, "requests.jsonl")

  const server: Server = createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET"
      const url = req.url ?? "/"
      const path = url.split("?")[0]

      // Models listing probe (OpenCode may probe models before chat)
      if (method === "GET" && (path === "/v1/models" || path === "/models" || path.endsWith("/models"))) {
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify({ object: "list", data: modelIds.map((id) => ({ id, object: "model", owned_by: "local-fixture" })) }))
        return
      }

      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of req) {
        const buf = chunk as Buffer
        bytes += buf.length
        if (bytes > 10 * 1024 * 1024) throw new Error("fixture request exceeded 10 MiB budget")
        chunks.push(buf)
      }
      const raw = Buffer.concat(chunks).toString("utf8")
      let body: unknown = null
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw)
        } catch {
          body = { _raw: raw.slice(0, 4096) }
        }
      }

      if (path !== "/v1/chat/completions" && path !== "/chat/completions") {
        probes.push({ method, path: url, status: 404 })
        await appendFile(logFile, JSON.stringify({ method, path: url, headers: redactHeaders(req.headers as any), body, probe: true }) + "\n").catch(() => {})
        res.statusCode = 404
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify({ error: "fixture exposes models and chat completions only" }))
        return
      }

      const requestIndex = requests.length + 1
      const record: RecordedRequest = {
        method,
        path: url,
        headers: redactHeaders(req.headers as any),
        body,
        requestIndex,
        timestamp: Date.now(),
      }
      requests.push(record)
      await appendFile(logFile, JSON.stringify(record) + "\n").catch(() => {})
      await writeFile(join(logDir, `request-${requestIndex}.json`), JSON.stringify(body)).catch(() => {})

      const b = (body ?? {}) as any
      // One-shot objects shift per request; function handlers are sticky and
      // answer every request until a later object is queued ahead of them.
      const head = responses[0]
      const scripted = typeof head === "function" ? head : responses.length > 0 ? responses.shift() : undefined
      const message = await resolveResponse(scripted, { body: b, requestIndex }, `call_fixture_${requestIndex}`)
      const base = {
        id: `chatcmpl-fixture-${requestIndex}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: typeof b.model === "string" ? b.model : modelIds[0],
      }
      const finish = (message as any).tool_calls ? "tool_calls" : "stop"
      const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }

      if (b.stream) {
        res.setHeader("Content-Type", "text/event-stream")
        const emit = (delta: unknown, finishReason: string | null = null) =>
          res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`)
        if ((message as any).tool_calls) {
          const calls = (message as any).tool_calls as FixtureToolCall[]
          const fragments = calls.map((call) => {
            const args = call.function.arguments ?? ""
            const split = Math.floor(args.length / 2)
            return {
              first: { index: 0, ...call, function: { name: call.function.name, arguments: args.slice(0, split) } },
              second: { index: 0, function: { arguments: args.slice(split) } },
            }
          })
          emit({ role: "assistant", content: (message as any).content ?? null, tool_calls: fragments.map((f) => f.first) })
          emit({ tool_calls: fragments.map((f) => f.second) })
        } else {
          emit(message)
        }
        emit({}, finish)
        res.write(`data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [], usage })}\n\n`)
        res.end("data: [DONE]\n\n")
      } else {
        res.setHeader("Content-Type", "application/json")
        res.end(JSON.stringify({ ...base, choices: [{ index: 0, message, finish_reason: finish }], usage }))
      }
    } catch (cause) {
      res.statusCode = 400
      res.setHeader("Content-Type", "application/json")
      res.end(JSON.stringify({ error: { message: String(cause), type: "invalid_request_error" } }))
    }
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const addr = server.address()
  if (addr === null || typeof addr === "string") throw new Error("fixture failed to bind")
  const port = (addr as any).port as number
  const baseUrl = `http://127.0.0.1:${port}/v1`
  return {
    baseUrl,
    url: baseUrl,
    port,
    requests,
    probes,
    logDir,
    logFile,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  }
}
