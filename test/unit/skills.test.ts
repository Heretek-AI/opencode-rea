import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { isAbsolute } from "node:path"
import { parseSkillFile, registerSkills, SKILL_IDS } from "../../src/skills.js"

const EXPECTED_IDS: Array<(typeof SKILL_IDS)[number]> = [
  "rea-opencode",
  "rea-investigation",
  "rea-evidence-report",
  "rea-reconstruction",
]

interface AddedSkill {
  id: string
  name: string
  description?: string
  path: string
  content: string
}

function makeCaptureCtx() {
  const added: AddedSkill[] = []
  const ctx = {
    skill: {
      transform: async (cb: (editor: { add: (s: AddedSkill) => void }) => void) => {
        cb({ add: (s: AddedSkill) => void added.push(s) })
        return { dispose: async () => {} }
      },
    },
  }
  return { ctx, added }
}

describe("T05 skills: registerSkills via fake ctx", () => {
  test("registers exactly the 4 rea-* skills", async () => {
    const { ctx, added } = makeCaptureCtx()
    await registerSkills(ctx as any, { server: "rea", runtime: "ask" })
    expect([...SKILL_IDS]).toEqual(EXPECTED_IDS)
    expect(added.map((s) => s.id)).toEqual(EXPECTED_IDS)
  })

  test("does not register reverse-engineer-anything", async () => {
    const { ctx, added } = makeCaptureCtx()
    await registerSkills(ctx as any, { server: "rea", runtime: "ask" })
    expect(added.some((s) => s.id === "reverse-engineer-anything")).toBe(false)
  })

  test("each skill has non-empty name/description/path/content; absolute path exists; name matches id", async () => {
    const { ctx, added } = makeCaptureCtx()
    await registerSkills(ctx as any, { server: "rea", runtime: "ask" })
    expect(added.length).toBe(4)
    for (const s of added) {
      expect(typeof s.name).toBe("string")
      expect(s.name.length).toBeGreaterThan(0)
      expect(typeof s.description).toBe("string")
      expect((s.description ?? "").length).toBeGreaterThan(0)
      expect(typeof s.path).toBe("string")
      expect(s.path.length).toBeGreaterThan(0)
      expect(typeof s.content).toBe("string")
      expect(s.content.length).toBeGreaterThan(0)
      expect(isAbsolute(s.path)).toBe(true)
      expect(existsSync(s.path)).toBe(true)
      // Frontmatter name matches the directory id.
      expect(s.name).toBe(s.id)
    }
  })

  test("options passthrough does not throw for all runtimes", async () => {
    for (const runtime of ["ask", "allow", "deny"] as const) {
      const { ctx, added } = makeCaptureCtx()
      await registerSkills(ctx as any, { server: "rea", runtime })
      expect(added.length).toBe(4)
    }
    const { ctx, added } = makeCaptureCtx()
    await registerSkills(ctx as any, { server: "custom-server", runtime: "allow" })
    expect(added.length).toBe(4)
  })
})

describe("T05 skills: parseSkillFile", () => {
  test("parses name/description/body", () => {
    const parsed = parseSkillFile(
      `---\nname: rea-opencode\ndescription: Use when testing.\n---\n\n# Body\nhello\n`,
      "rea-opencode",
    )
    expect(parsed.name).toBe("rea-opencode")
    expect(parsed.description).toBe("Use when testing.")
    expect(parsed.body).toContain("hello")
    expect(parsed.body).not.toContain("name: rea-opencode")
  })

  test("strips surrounding quotes", () => {
    const parsed = parseSkillFile(
      `---\nname: 'rea-opencode'\ndescription: "Use when testing."\n---\n\nbody\n`,
      "rea-opencode",
    )
    expect(parsed.name).toBe("rea-opencode")
    expect(parsed.description).toBe("Use when testing.")
  })

  test("missing description throws mentioning the skill id", () => {
    let error: unknown
    try {
      parseSkillFile(`---\nname: rea-opencode\n---\n\nbody\n`, "rea-opencode")
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("rea-opencode")
  })

  test("missing frontmatter delimiters throw mentioning the skill id", () => {
    let error: unknown
    try {
      parseSkillFile(`# No frontmatter\nbody\n`, "rea-opencode")
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("rea-opencode")
  })

  test("empty body throws mentioning the skill id", () => {
    let error: unknown
    try {
      parseSkillFile(`---\nname: rea-opencode\ndescription: Use when testing.\n---\n`, "rea-opencode")
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain("rea-opencode")
  })
})
