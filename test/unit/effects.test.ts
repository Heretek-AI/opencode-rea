import { describe, expect, test } from "bun:test"
import { RUNTIME_EFFECT_TOOLS, isRuntimeEffectTool } from "../../src/effects.js"

describe("T06 tool-effect classification", () => {
  test("list is non-empty with exactly 21 entries", () => {
    expect(RUNTIME_EFFECT_TOOLS.length).toBe(21)
  })

  test("names are unique and sorted", () => {
    const names = RUNTIME_EFFECT_TOOLS.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
    expect([...names].sort()).toEqual(names)
  })

  test("every entry has at least one valid category and a non-empty one-line reason", () => {
    const valid = ["executes-foreign-code", "mutates-device", "may-discard-data"]
    for (const entry of RUNTIME_EFFECT_TOOLS) {
      expect(entry.categories.length).toBeGreaterThan(0)
      for (const c of entry.categories) {
        expect(valid).toContain(c)
      }
      expect(entry.reason.trim().length).toBeGreaterThan(0)
      expect(entry.reason).not.toContain("\n")
    }
  })

  test("isRuntimeEffectTool matches the list", () => {
    for (const entry of RUNTIME_EFFECT_TOOLS) {
      expect(isRuntimeEffectTool(entry.name)).toBe(true)
    }
    expect(isRuntimeEffectTool("binary_session")).toBe(false)
    expect(isRuntimeEffectTool("list_adb_devices")).toBe(false)
  })
})
