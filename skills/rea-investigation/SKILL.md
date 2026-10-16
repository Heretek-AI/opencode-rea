---
name: rea-investigation
description: Use when planning or running a multi-step REA investigation that spans features or subsystems — staged workflow, subagent delegation, and finding ledger.
---

# REA Investigation

Use this skill when the request spans multiple features or subsystems. For a
single narrow question answered by one analysis tool, call that tool directly
instead of running the full staged workflow.

## Staged workflow

1. Turn the request into a checklist of questions plus the evidence each
   answer needs. Resolve target identity and constraints from the
   conversation and workspace before asking for information again.
2. Inspect the current REA session, artifact identity, saved analysis
   database, bookmarks, and prior evidence. Reuse matching state; do not
   open duplicate sessions or repeat identical analysis.
3. Start with the smallest useful overview or inventory (`detail: "summary"`
   where supported, paging targeted slices with `inspect_analysis_view` via
   the retained parent `evidence_id`). Follow each question from its entry
   point through relevant data and state changes to its result. Batch related
   operations around a specific hypothesis, then expand only when the
   returned evidence leaves a concrete gap.
4. Inspect relevant packaged resources and configuration alongside code when
   they affect the question. Use format-aware inventory and parsers; do not
   infer behavior from filenames, strings, or layout alone.
5. Corroborate a conclusion with the evidence type it requires. Use runtime
   observation (scenario capture or interactive Frida/GDB/Rizin debugging)
   only when static evidence cannot answer the question and the required host
   runtime and OS access are available. Close any opened binary or debugger
   session (`close_binary`, `close_frida_session`, `close_gdb_session`,
   `close_rizin_debug_session`, `unload_frida_script`) once its scope finishes.
6. Revisit the original checklist before finishing. Mark each question as
   answered, partially answered, or unresolved based on its evidence; keep
   bounded negative searches bounded.

## Delegation to REA subagents

- Decompose work into independent questions. When parallel workers are
  available and the questions do not depend on one another, assign distinct
  scopes, point workers at existing evidence, and ask them to return sources,
  conclusions, and unresolved gaps. Otherwise work sequentially.
- Give each worker (`rea-analyst` for static questions, `rea-runtime` for
  runtime observation, `rea-auditor` for evidence verification) a bounded
  scope (one question, one entry point) and the Evidence IDs it should start
  from. Workers must not re-run the overview or open new sessions when usable
  state already exists.
- If the user names only "my app" without a name, path, or already-selected
  target, ask which app before searching for artifacts. Never choose an
  example app on the user's behalf.

## Finding ledger

- Keep a concise finding ledger linking each conclusion to Evidence IDs,
  confidence and evidence type, search boundary, and remaining unknowns.
- Update the shared index or investigation report so later passes can reuse
  results instead of re-deriving them.
- Do not describe a broad investigation as complete while required questions
  remain open; partially answered and unresolved items stay listed with the
  gap that blocks them.
