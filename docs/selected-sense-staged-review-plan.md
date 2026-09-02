# Selected-Sense Staged Review Plan

## Scope

This flow applies only to meanings entered through the selected dictionary-sense
path. Existing words and their assessment history retain their current behavior.
No migration, backfill, cache wipe, or mastery rewrite is part of this change.

## Persistent Contract

Each checked dictionary sense remains one `words` row. The row receives the
`selected_sense_flow_v1` quality flag at creation. `entered_at` remains the
entry timestamp; no new database column is needed.

The existing `assessments.assessment_kind` column records the flow stage:

1. `initial_context`: the first audited contextual fill-in. It never supplies
   mastery evidence.
2. `review`: a four-choice meaning recognition check. It never supplies
   mastery evidence and has no generic judgement copy.
3. `context_evidence`: an independently generated, AI-semantic-audited
   contextual fill-in after the recognition check. Two correct records at this
   stage are required for mastery.

## Flow

1. The selected-sense entry request explicitly marks each new row.
2. The first formal cache question for a marked row is submitted as
   `initial_context`.
3. A recognition review is created for every marked initial-context row,
   regardless of whether the initial answer was correct. It contains the word
   and four distinct Chinese meaning options, with option order randomized.
4. A submitted recognition review unlocks later contextual questions. The
   review result itself cannot change mastery.
5. Each later contextual question is `context_evidence`. It must come from the
   normal durable generation pipeline, including the mandatory semantic audit.
   A wrong answer leaves already earned evidence untouched; a later fresh
   audited context can supply the missing evidence.
6. Mastery for a marked row requires two correct `context_evidence` records.

## Compatibility And Safety

- Legacy review endpoints and non-selected-sense records retain their current
  behavior.
- The implementation only writes new rows for new selected-sense entries and
  their ordinary assessments or review rows.
- The durable question-generation worker remains the sole producer of new
  contextual cache questions. This feature does not delete or directly rebuild
  cache rows.
- Tests cover stage assignment, recognition choice construction, no mastery
  from the first context or recognition review, and the two-context evidence
  requirement.
