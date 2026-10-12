// T06 tool-effect classification for runtime gating.
//
// Source: prior-art TOOL_EFFECTS destructive formula
// (review/rea/src/contracts/toolEffects.ts: destructive = mayDiscardData
// || executesForeignCode || mutatesDevice) cross-checked against the live
// rea-agents@6.4.0 tools/list (170 tools). The 7 live destructiveHint=true
// tools are a subset of this 21-tool list because the installed server
// under-flags attached-device and analyst-metadata mutations relative to the
// audited contract. Live openWorldHint (72 tools, mostly read-mostly
// launch-process/network tools such as list_adb_devices) is deliberately NOT
// a listing requirement: this module covers the
// data-loss/device/foreign-code axis only. Live-model behaviour unverified.
export type EffectCategory = "executes-foreign-code" | "mutates-device" | "may-discard-data"

export interface RuntimeEffect {
  readonly name: string
  readonly categories: ReadonlyArray<EffectCategory>
  readonly reason: string
}

export const RUNTIME_EFFECT_TOOLS: ReadonlyArray<RuntimeEffect> = [
  { name: "annotate_native_function", categories: ["may-discard-data"], reason: "Overwrites the function name and entry comments, clearing prior analyst annotations" },
  { name: "capture_browser_scenario", categories: ["executes-foreign-code", "may-discard-data"], reason: "Runs browser page code the server does not own and may overwrite prior capture state" },
  { name: "capture_electron_scenario", categories: ["executes-foreign-code", "may-discard-data"], reason: "Runs Electron app code the server does not own and may overwrite prior capture state" },
  { name: "capture_native_ui_scenario", categories: ["executes-foreign-code", "may-discard-data"], reason: "Drives native application code the server does not own and may overwrite prior capture state" },
  { name: "capture_process_scenario", categories: ["executes-foreign-code"], reason: "Runs the caller-selected executable, executing target code the server does not own" },
  { name: "close_binary", categories: ["may-discard-data"], reason: "Clears retained session records for the closed binary" },
  { name: "export_evidence_bundle", categories: ["may-discard-data"], reason: "Replaces the destination file with the exported evidence bundle" },
  { name: "install_adb_package", categories: ["mutates-device"], reason: "Installs a package on the attached Android device, changing device packages" },
  { name: "observe_native_calls", categories: ["executes-foreign-code"], reason: "Drives the caller-owned process that executes target code the server does not own" },
  { name: "observe_web_execution", categories: ["may-discard-data"], reason: "Replaces live page state during observed web execution" },
  { name: "push_adb_file", categories: ["mutates-device"], reason: "Writes a file to the attached Android device, changing device files" },
  { name: "set_address_name", categories: ["may-discard-data"], reason: "Overwrites the analyst address name, discarding the prior name" },
  { name: "set_addresses_names", categories: ["may-discard-data"], reason: "Overwrites analyst address names in bulk, discarding prior names" },
  { name: "set_bookmark", categories: ["may-discard-data"], reason: "Overwrites the analyst bookmark at the address, discarding the prior bookmark" },
  { name: "set_comment", categories: ["may-discard-data"], reason: "Overwrites the analyst comment, discarding the prior comment" },
  { name: "set_inline_comment", categories: ["may-discard-data"], reason: "Overwrites the analyst inline comment, discarding the prior comment" },
  { name: "start_adb_activity", categories: ["mutates-device"], reason: "Starts an activity on the attached Android device, changing running apps" },
  { name: "start_adb_app", categories: ["mutates-device"], reason: "Starts an app on the attached Android device, changing running apps" },
  { name: "stop_adb_app", categories: ["mutates-device"], reason: "Stops an app on the attached Android device, changing running apps" },
  { name: "uninstall_adb_package", categories: ["mutates-device"], reason: "Uninstalls a package from the attached Android device, changing device packages" },
  { name: "unset_bookmark", categories: ["may-discard-data"], reason: "Clears the analyst bookmark, discarding the retained bookmark" },
]

export function isRuntimeEffectTool(name: string): boolean {
  return RUNTIME_EFFECT_TOOLS.some((entry) => entry.name === name)
}
