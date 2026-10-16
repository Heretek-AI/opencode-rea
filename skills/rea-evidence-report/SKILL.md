---
name: rea-evidence-report
description: Use when writing up REA findings — distinguish observations from inferences and unknowns, and cite Evidence IDs for every claim.
---

# REA Evidence Report

Every conclusion in a report must distinguish observations, inferences, and
unknowns. Cite Evidence IDs, preserve limitations and incomplete coverage,
and never imply that static analysis observed execution.

## Observations

- An observation is a fact returned by a tool: bytes, addresses, strings,
  graph edges, captured records, and their digests.
- Quote the retained Evidence ID for each observation, plus the operation and
  target it came from so the claim can be re-paged later.
- Preserve the producer's raw locations and identity fields verbatim. Do not
  reformat digests, addresses, node IDs, or ordinals into a lossy form.
- When a result was returned as `detail: "summary"` or truncated by the
  transport or the client, mark the observation as a preview: page via
  `inspect_analysis_view` using the retained parent `evidence_id` for smaller
  views or export the complete record (`export_evidence_bundle`) before
  drawing conclusions from it.

## Inferences

- An inference is a conclusion drawn from observations: feature behavior,
  version comparison, provenance, or reconstructed logic.
- Label each inference with its confidence and the evidence type that
  supports it. Corroborate with the evidence type the claim requires; static
  evidence alone never establishes runtime behavior.
- Runtime requests execute the declared target and lifecycle only. Do not
  broaden the target or action beyond those fields when inferring behavior.
- Treat decoded or derived values (selectors, argument strings, decoded
  payloads) as candidates until corroborated, and say so in the report.

## Unknowns

- An unknown is a question the evidence does not answer: coverage gaps,
  unavailable providers, truncated records, and unexamined paths.
- List each unknown with the search boundary that produced it (what was
  examined, what was excluded) so a later pass can resume precisely.
- Unresolved identity or applicability stays unknown. Never present an
  unexamined area as absent, foreign, or aligned.
- Keep bounded negative searches bounded: report what was searched and stop
  there instead of widening silently.

## Report shape

- Explain findings in plain language and tie each paragraph to its evidence.
- One claim per bullet where possible, each with its Evidence ID citation.
- End with the ledger: answered, partially answered, and unresolved items
  from the investigation checklist, each with remaining gaps.
