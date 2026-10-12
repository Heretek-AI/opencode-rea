---
name: rea-reconstruction
description: Use when turning REA findings into an implementation — map findings to build steps, separate observed behavior from design choices, and verify the result.
---

# REA Reconstruction

Use this skill when the user asks to build something from REA findings: a
reimplementation, a patch, a compatibility shim, or a verification harness.
Analysis findings are inputs; every design choice beyond them belongs to the
implementation and must be labeled as such.

## Findings-to-implementation mapping

- Start from the finding ledger, not from raw tool output. Each build step
  maps to one or more ledger conclusions with their Evidence IDs.
- Ledger items with no implementation consequence stay out of the plan; plan
  steps with no ledger backing are design choices and must be labeled so.
- Reuse the smallest finding that answers each build question. Do not
  re-run analysis to justify a step the ledger already supports.
- When a finding is partially answered or unresolved, either scope the step
  down to what the evidence supports or state the assumption explicitly and
  carry it as a verification obligation.

## Separation of concerns

- Separate observed behavior from design choices in both the plan and the
  code. Observed behavior cites Evidence IDs; choices cite requirements,
  constraints, or judgment.
- Use normal coding tools for the build. Close any opened native session
  with the appropriate teardown call when the investigation is complete.
- Preserve caller-selected inputs (paths, output directories, digests,
  metadata) verbatim into the build configuration.
- Never widen the target or action beyond the declared fields when moving
  from analysis to implementation.

## Verification obligations

- Every mapped step needs a check: what behavior proves the step correct,
  and which evidence type that check requires.
- Prefer checks against the actual artifact or runtime (tests, probes,
  captures) over re-reading static findings. Static evidence cannot confirm
  runtime behavior.
- Record unverified coverage explicitly. A passing build alone does not
  establish that the reconstruction matches the observed behavior.
- Revisit the original checklist at the end: each question is answered,
  partially answered, or unresolved, with the verification result attached.
