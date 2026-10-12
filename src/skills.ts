import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { ReaOptions } from "./options.js"

export const SKILL_IDS = ["rea-opencode", "rea-investigation", "rea-evidence-report", "rea-reconstruction"] as const

export type SkillId = (typeof SKILL_IDS)[number]

export interface ParsedSkillFile {
  readonly name: string
  readonly description: string
  readonly body: string
}

interface SkillEditorLike {
  add(s: { id: string; name: string; description?: string; path: string; content: string }): void
}

interface SkillCtxLike {
  skill: {
    transform(cb: (editor: SkillEditorLike) => void): unknown
  }
}

/** Resolve the shipped `skills/` dir at runtime and under bun test. */
export function resolveSkillsDir(): string {
  const candidates: string[] = []
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url))
    candidates.push(join(moduleDir, "..", "skills"), join(moduleDir, "..", "..", "skills"))
  } catch {
    // import.meta.url unavailable: fall through to cwd.
  }
  candidates.push(join(process.cwd(), "skills"))
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return candidates[0] ?? join(process.cwd(), "skills")
}

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim()
    }
  }
  return trimmed
}

/** Split a SKILL.md file into frontmatter (`name:`/`description:`) and body. */
export function parseSkillFile(content: string, skillId = "unknown"): ParsedSkillFile {
  const lines = content.split("\n")
  if (lines[0]?.trim() !== "---") {
    throw new Error(`invalid SKILL.md for skill "${skillId}": missing opening frontmatter delimiter`)
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---")
  if (end === -1) {
    throw new Error(`invalid SKILL.md for skill "${skillId}": missing closing frontmatter delimiter`)
  }
  let name = ""
  let description = ""
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^(name|description)\s*:\s*(.*)$/)
    if (!match) continue
    if (match[1] === "name") name = stripQuotes(match[2] ?? "")
    else description = stripQuotes(match[2] ?? "")
  }
  if (!name) name = skillId
  if (!name || name === "unknown") {
    throw new Error(`invalid SKILL.md for skill "${skillId}": missing non-empty "name:" in frontmatter`)
  }
  if (!description) {
    throw new Error(`invalid SKILL.md for skill "${skillId}": missing non-empty "description:" in frontmatter`)
  }
  const body = lines
    .slice(end + 1)
    .join("\n")
    .trim()
  if (!body) {
    throw new Error(`invalid SKILL.md for skill "${skillId}": missing body after frontmatter`)
  }
  return { name, description, body }
}

/** Register the 4 shipped rea-* skills via ctx.skill.transform. */
export async function registerSkills(ctx: SkillCtxLike, _options: ReaOptions): Promise<void> {
  const dir = resolveSkillsDir()
  for (const id of SKILL_IDS) {
    const path = join(dir, id, "SKILL.md")
    let raw: string
    try {
      raw = await readFile(path, "utf8")
    } catch {
      throw new Error(`missing SKILL.md for skill "${id}" at ${path}`)
    }
    const parsed = parseSkillFile(raw, id)
    await ctx.skill.transform((editor) => {
      // content = body after frontmatter, path = absolute SKILL.md path so
      // sibling references resolve via dirname (prior-art skill-file.ts shape).
      editor.add({ id, name: parsed.name, description: parsed.description, path, content: parsed.body })
    })
  }
}
