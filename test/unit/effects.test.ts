import { describe, expect, test } from "bun:test"
import {
  DEBUGGER_SESSION_TOOLS,
  RUNTIME_EFFECT_TOOLS,
  isDebuggerSessionTool,
  isRuntimeEffectTool,
} from "../../src/effects.js"

describe("T06 tool-effect classification", () => {
  test("list is non-empty with exactly 31 entries (rea-agents@6.5.0 destructiveHint===true)", () => {
    expect(RUNTIME_EFFECT_TOOLS.length).toBe(31)
  })

  test("names are unique and sorted", () => {
    const names = RUNTIME_EFFECT_TOOLS.map((e) => e.name)
    expect(new Set(names).size).toBe(names.length)
    expect([...names].sort()).toEqual(names)
  })

  test("includes all 10 rea-agents@6.5.0 debugger/instrumentation/rizin/cutter tools", () => {
    const names = new Set(RUNTIME_EFFECT_TOOLS.map((e) => e.name))
    for (const addedIn650 of [
      "close_gdb_session",
      "close_rizin_debug_session",
      "cutter_command",
      "execute_rizin_command",
      "gdb_console",
      "instrument_with_frida",
      "load_frida_script",
      "resume_frida_session",
      "rizin_debug_command",
      "start_rizin_debug_session",
    ]) {
      expect(names.has(addedIn650)).toBe(true)
    }
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
    expect(isRuntimeEffectTool("start_frida_session")).toBe(false)
    expect(isRuntimeEffectTool("start_gdb_session")).toBe(false)
  })

  test("DEBUGGER_SESSION_TOOLS and isDebuggerSessionTool cover non-destructive session lifecycle tools", () => {
    expect([...DEBUGGER_SESSION_TOOLS]).toEqual([
      "close_frida_session",
      "start_frida_session",
      "start_gdb_session",
      "unload_frida_script",
    ])
    for (const name of DEBUGGER_SESSION_TOOLS) {
      expect(isDebuggerSessionTool(name)).toBe(true)
      expect(isRuntimeEffectTool(name)).toBe(false)
    }
    expect(isDebuggerSessionTool("gdb_console")).toBe(false)
  })
})
