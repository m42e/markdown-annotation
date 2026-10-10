# Changelog

## 2.0.0 — 2026-10-10

This release makes breaking changes to the annotation payload contract.
Consumers must reject version 1.0.0 payloads unless the user explicitly
requests migration. Migration must preserve the original and write to a
separate destination.

- Require consistent operation, kind, selection, and event data in the schema.
- Define `add` placement (`before` or `after`), verbatim insertion, and document
  boundary anchors.
- Specify deterministic heading and anchor resolution, explicit ambiguous and
  fuzzy results, and separate relocation status. Normalized-only matches need
  review; unique literal matches can be applied automatically only when they
  remain in their original section.
- Make correction detection idempotent and define append-only event lifecycle,
  immutable anchors, and read-only resolution.
- Separate embedded-block recognition from payload selection, parsing, and
  schema validation. Define duplicate-payload diagnostics and prohibit
  implicit merging or fallback from a recognized invalid embedded payload.
- Define write preconditions, atomic replacement, partial-commit recovery, and
  handling for overlapping edits.
- Version the schema identifier for 2.0.0. The browser editor now reads and writes 2.0.0 payloads, with the limitations
  described in the README.
