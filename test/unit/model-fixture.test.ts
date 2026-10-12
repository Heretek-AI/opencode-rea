import { describe, expect, test } from "bun:test"
import { start, titleAware } from "../support/model-fixture.js"

describe("model-fixture loopback server", () => {
  test("records requests, serves scripted sequence, lists models, falls back", async () => {
    const fx = await start({
      responses: [titleAware([{ type: "text", text: "hello-main" }])],
      modelIds: ["fixture-model"],
    })
    try {
      // Models probe.
      const models = await (await fetch(`${fx.baseUrl}/models`)).json() as any
      expect(models.object).toBe("list")
      expect(models.data.map((m: any) => m.id)).toContain("fixture-model")

      // Title (tool-less) request gets the title text...
      const t1 = await (await fetch(`${fx.url}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer secret" },
        body: JSON.stringify({ model: "fixture-model", messages: [{ role: "user", content: "hi" }] }),
      })).json() as any
      expect(t1.choices[0].message.content).toBe("fixture-title")

      // ...tool-capable request gets the queued script, draining to the default.
      const post = () => fetch(`${fx.url}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "fixture-model", messages: [{ role: "user", content: "hi" }], tools: [{ type: "function", function: { name: "read" } }] }),
      }).then((r) => r.json()) as Promise<any>
      expect((await post()).choices[0].message.content).toBe("hello-main")
      expect((await post()).choices[0].message.content).toBe("fixture-default")

      // Recording: every chat request captured with redacted auth + log file.
      expect(fx.requests.length).toBe(3)
      expect(fx.requests[0]?.headers["authorization"]).toBe("[REDACTED]")
      expect(await Bun.file(fx.logFile).exists()).toBe(true)
      const logLines = (await Bun.file(fx.logFile).text()).trim().split("\n")
      expect(logLines.length).toBe(3)

      // Unknown paths probe 404 without breaking the fixture.
      const probe = await fetch(`${fx.baseUrl}/responses`, { method: "POST", body: "{}" })
      expect(probe.status).toBe(404)
      expect(fx.probes.length).toBe(1)
    } finally {
      await fx.close()
    }
  })

  test("streams tool_calls as SSE when body.stream is true", async () => {
    const fx = await start({ responses: [{ type: "tool", tool: "read", args: { path: "x" } }] })
    try {
      const res = await fetch(`${fx.url}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "m", stream: true, messages: [{ role: "user", content: "hi" }] }),
      })
      const text = await res.text()
      expect(text).toContain("data: [DONE]")
      expect(text).toContain("tool_calls")
      expect(text).toContain("read")
    } finally {
      await fx.close()
    }
  })
})
