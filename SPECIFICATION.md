# Markdown and MDX Annotation Extension Specification

Version 2.0.0

## 1. Scope

The Markdown Annotation Extension associates a Markdown (`.md`) or MDX (`.mdx`)
document with one JSON annotation payload. The payload contains structured
review requests, text edits, and their event history. The payload format is defined by
[schema.json](schema.json).

This specification defines:

- the two supported physical locations for the payload;
- how an implementation discovers the payload for a Markdown or MDX document;
- how embedded payloads are delimited and extracted; and
- how implementations handle duplicate, invalid, and missing payloads.

The physical location of the payload is a storage concern. It is not a field in
the JSON payload. The same payload can therefore be moved between the sidecar
and embedded representations without changing its schema-defined content.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**,
**SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this
specification are to be interpreted as normative requirements.

## 2. Terminology

**Document**
: A Markdown (`.md`) or MDX (`.mdx`) file being annotated.

**Annotation payload**
: A UTF-8 JSON object that conforms to [schema.json](schema.json).

**Sidecar**
: A separate annotation file stored beside the Document.

**Embedded block**
: An annotation payload stored at the end of the Document inside a fenced
   `json:annotation` block.

**Consumer**
: A tool that reads, validates, displays, or edits a Document and its
  annotation payload.

## 3. Payload contract

1. An annotation payload MUST be encoded as UTF-8 JSON.
2. The top-level JSON value MUST be an object.
3. The object MUST validate against [schema.json](schema.json), including the
   required `schemaVersion` value `2.0.0`.
4. JSON whitespace before or after the object is permitted. No other text is
   permitted in a sidecar or in the body of an embedded block.
5. A Consumer MUST reject a JSON object that contains duplicate member names
   at any nesting level, comparing names after JSON escape processing. A
   parser that silently keeps one duplicate value does not satisfy this
   requirement.
6. A Consumer MUST parse the payload as data. It MUST NOT execute values from
   the payload as code, Markdown, or MDX.
7. The association between a payload and its Document is determined by the
   storage location: a sidecar is associated through its filename, and an
   embedded payload is associated with the Document that contains it. The
   payload does not contain a document-path property.

The optional top-level `editor` object identifies the application that last wrote
this payload. It MUST contain a non-empty string `name`; it MAY contain a
non-empty string `version` and an absolute URI `url` for the application's
homepage or source repository. For example:

```json
"editor": {
  "name": "Simple Annotator",
  "url": "https://m42e.de/markdown-annotation/"
}
```

This metadata is informational, not authenticated authorship. Consumers MUST
accept payloads without it and MUST NOT fetch or execute its URL automatically.
Writers MAY replace `editor` when writing a payload; writers that do not set it
MUST preserve existing metadata, including unknown properties. The application
version is independent of `schemaVersion`.

## 4. Supported storage locations

A Document MAY have no annotation payload. If it has an annotation payload, it
SHOULD use exactly one of the following formats. If both physical forms exist,
the duplicate-payload rules in section 5 apply.

### 4.1 Sidecar file

For a Document at `path/to/document.md` or `path/to/component.mdx`, the sidecar
path is formed by appending `.annotations` to the complete Document filename:

```text
path/to/document.md.annotations
path/to/component.mdx.annotations
```

The sidecar:

- MUST be in the same directory as the Document;
- MUST use the exact `.md.annotations` or `.mdx.annotations` suffix matching
   the Document's `.md` or `.mdx` suffix;
- MUST contain only the JSON payload, without Markdown fences or a `---`
  separator; and
- MUST be encoded as UTF-8.

The extension is appended, not replaced. For example, `README.md` maps to
`README.md.annotations`, and `Component.mdx` maps to
`Component.mdx.annotations`. Neither maps to a sidecar with the source
extension removed.

The sidecar is located at the following logical annotation locator:

```text
sidecar:path/to/document.md.annotations
sidecar:path/to/component.mdx.annotations
```

### 4.2 Embedded block

An embedded payload MUST be the final non-whitespace content of the Document.
It consists of a separator line followed by a fenced `json:annotation` block:

````markdown
# Example document

Document content.

---
```json:annotation
{
  "$schema": "urn:markdown-annotation:document-comments:2.0.0",
  "schemaVersion": "2.0.0",
  "createdAt": "2026-09-30T12:00:00Z",
  "updatedAt": "2026-09-30T12:00:00Z",
  "entries": []
}
```
````

Embedded-block recognition is a structural check. It does not parse or validate
the JSON. A Consumer MUST first identify whether the Document contains one
recognized embedded block, then select a representation under section 5, then
extract and parse the selected payload, and finally validate the parsed value
under sections 3 and 8.

For recognition, a line is terminated by LF or CRLF; a bare CR does not end a
line. A blank line contains only spaces or tabs. A separator line contains
exactly three hyphen-minus characters (`---`) with zero or more spaces or tabs
before or after them. The separator MUST be outside any fenced code block and
MUST immediately follow exactly two line-ending sequences, each LF or CRLF.
These are storage framing: a Consumer MUST exclude these two sequences from the
searchable Document body. Any earlier trailing whitespace belongs to the
original Document and MUST be preserved. A Producer MUST append both framing
sequences even when the original Document already ends in line breaks. This
guarantees a blank line before the separator and prevents it from becoming a
Setext heading in a generic Markdown renderer. For an empty Document, the two
framing sequences precede the separator at the beginning of the file. The
separator MUST be followed by zero or more blank lines and then an opening line whose
entire content is exactly three backticks immediately followed by
`json:annotation`. The opening line has no indentation or trailing characters.
The info string identifies the annotation extension; the block body remains
JSON.

The opening line is eligible only when it is preceded by the separator and
optional blank lines above, with no intervening nonblank line. Consumers MUST
scan source lines from the beginning while tracking ordinary fenced code
blocks, so a matching separator and opening line inside another fenced block
are not considered. For this scan, an ordinary fence opens with zero to three
leading spaces followed by at least three identical backticks or tildes. A
backtick opener is invalid if its remaining line contains a backtick. It closes
on a line with zero to three leading spaces, the same marker repeated at least
as many times as the opener, and only spaces or tabs afterward. An eligible
annotation opening line is handled as a candidate block, not as an ordinary
fence.

The candidate block ends at the first later line whose content consists of
exactly three backticks, optionally surrounded by spaces or tabs. This exact
closing marker is required; a longer backtick run, a tilde run, or a line with
other content does not close the candidate. Once a candidate has opened, any
later annotation-shaped opening line before that close is part of its body and
is not considered a nested candidate. The first such closing line is used even
when the body is not valid JSON. The candidate is recognized only if
that close exists and every character after its line ending, or after the close
at end of file, is Unicode `White_Space` as listed in section 6.2. Thus a
non-whitespace character after the close makes the candidate unrecognized.
Consumers MUST continue scanning after a closed candidate followed by
non-whitespace content, because a later candidate may be the final block.
An eligible opener with no exact closing line is malformed and does not create
a recognized embedded block.

When more than one annotation-shaped fenced block occurs, only a block that
satisfies the final-content rule is recognized. An earlier complete block
followed by another block or any other non-whitespace content is not an
embedded block. A structurally recognized final block takes precedence over
all earlier annotation-shaped fences; the specification defines no multiple
embedded-payload merge. The framing line endings, separator, and fence lines
are storage syntax and MUST NOT be included in the searchable Document body or
payload. The payload is exactly the source text between the opening line
ending and the closing line. JSON whitespace within
that text is permitted by section 3.

A conforming Markdown or MDX renderer MUST exclude the recognized embedded
block, including its separator, from rendered content. A generic renderer that
does not implement this extension MAY render it as a code block.

The embedded block is located at the following logical annotation locator:

```text
embedded:path/to/document.md#markdown-annotation
embedded:path/to/component.mdx#markdown-annotation
```

Documents MAY use LF or CRLF line endings. Structural matching treats those
line endings equivalently; payload extraction preserves the original body
bytes. The exact opener, separator context, and final-content requirement keep
ordinary fenced code examples elsewhere in the Document from being treated as
annotation metadata.

## 5. Payload discovery algorithm

Given a Document path and its contents, a Consumer MUST perform these phases in
order:

1. **Recognize.** Apply the structural rules in section 4.2. Recognition is
   independent of JSON syntax and schema validity. A malformed delimiter or a
   candidate with non-whitespace trailing content is not a recognized block.
2. **Select.** If a recognized embedded block exists, select it as the
   authoritative representation. Otherwise derive the optional sidecar path by
   appending `.annotations` to the complete Document filename. If it is
   conclusively absent, report that the Document has no annotation payload;
   this is not itself an error. If the path exists as a regular file, select
   the sidecar. If its status cannot be determined or it exists but is not a
   regular file, report a sidecar selection error.
3. **Read, extract, and parse.** Read the selected sidecar file, or extract
   only the payload body from the selected embedded block as defined in
   section 4.2. Decode the payload as UTF-8 and parse it as JSON. A read,
   decoding, or parse failure at the selected location is an error.
4. **Validate.** Require a top-level JSON object and validate it against
   [schema.json](schema.json), including the supported `schemaVersion`. A
   failure at the selected location is an error.

A Consumer MUST NOT change the selected representation after a parsing or
validation error. In particular, it MUST NOT fall back to a sidecar when a
recognized embedded block contains invalid JSON, a non-object JSON value, or a
schema-invalid payload. Conversely, a malformed embedded delimiter or a
candidate disqualified by trailing content is not a recognized block, so a
sidecar MAY be selected in those cases.

The embedded representation is preferred because it travels with the Document.
The sidecar is optional and provides an alternative when annotations should be
kept outside the Document. A Consumer MUST report the location and phase of a
selected-payload failure so callers can distinguish recognition, parse, and
schema-validation errors.

If a recognized embedded payload parses and validates, it is the selected
payload. The Consumer MUST then inspect the sidecar path to determine whether a
second representation exists. A conclusively absent path produces no sidecar
diagnostic. If the path is a regular file, the Consumer MUST read, parse, and
validate it for duplicate-payload comparison. If it cannot determine the path
status, the path exists but is not a regular file, or it cannot read the file,
the Consumer MUST retain the embedded payload and report a secondary
`sidecar-unavailable` warning. A readable sidecar that fails UTF-8 decoding,
JSON parsing, top-level-object checks, or schema validation likewise produces a
secondary `sidecar-invalid` warning. These secondary conditions MUST NOT turn
the valid embedded result into a failure or select the sidecar instead.

When both payloads parse and validate, the Consumer MUST compare their parsed
JSON values as defined below. If they are equal, report no duplicate-payload
diagnostic. If they differ, the Consumer MUST report a `duplicate-payload`
warning and use the embedded payload as authoritative. It MUST NOT merge the
payloads or choose individual entries from the sidecar. A secondary warning
does not change the primary result, which remains `valid` at the embedded
location. If the recognized embedded payload fails parsing or validation, the
Consumer MUST report that primary embedded error and MUST NOT inspect or use
the sidecar; this is the no-fallback rule. Multiple annotation-shaped fences
do not constitute duplicate representations: only the final structurally
recognized block, if any, is the embedded representation under section 4.2.

For duplicate comparison, JSON object member order is ignored and array order
is significant. Numbers compare by exact mathematical value, so `1`, `1.0`,
and `1e0` compare equal; booleans, strings, null, and numbers remain distinct
JSON types. Strings compare by their decoded Unicode scalar sequence, without
normalization. JSON strings with an unpaired surrogate escape MUST be rejected
during parsing. Number comparison MUST preserve exact decimal value and MUST NOT
round through binary floating point. Compare every member, including unknown
properties; do not discard unknown fields or apply defaults before comparison.
An absent property is different from the same property with an explicit value,
even if a schema consumer or a future schema assigns that property a default.
Duplicate object member names are rejected during parsing as required by
section 3, so they cannot produce an ambiguous equality result.

## 6. Annotation location resolution

Section 5 determines where the payload is stored. This section determines where
an individual entry applies inside the Document. Resolution is both
location-based and content-based, so that an entry can still be located after
the Document has been edited, reordered, or already corrected.

### 6.1 Anchor model

Each entry carries the following anchor data:

| Field | Role |
| --- | --- |
| `section.heading` | Positional anchor. The heading text of the section that contained the selection. |
| `section.text` | Optional snapshot of the section body at annotation time. |
| `selection.text` | Content anchor. The exact text the entry refers to. |
| `selection.prefix` | The *before* context: Document text immediately preceding `selection.text`. |
| `selection.suffix` | The *after* context: Document text immediately following `selection.text`. |
| `selection.placement` | For `add`, whether `value` is inserted before or after `selection.text`. |
| `value` | For `add` and `reword`, the replacement or inserted text. |

`selection.prefix` and `selection.suffix` SHOULD each contain at least 32 and at
most 128 Unicode code points of adjacent Document source text, truncated at the
Document boundary. A Unicode code point is a Unicode scalar value; offsets are
zero-based, half-open code-point offsets, never UTF-8 byte or UTF-16 code-unit
offsets. Longer context increases resolution accuracy, and a Producer SHOULD
NOT omit either field.

For an `add` operation, `selection.text` identifies the insertion anchor.
`selection.placement` MAY be `before` or `after`; if it is absent, `after` is
the default. The Consumer MUST insert `value` verbatim at that side of the
anchor and MUST NOT add, remove, or infer whitespace. For example, adding the
value `very ` before the anchor `red` in `A red car.` produces `A very red
car.`; the trailing space comes from `value`.

An empty `selection.text` is permitted only for `add` at a Document boundary.
Both context fields MUST be present, and at least one MUST be empty. In the
source Document, a present-empty `prefix` asserts that the insertion point is
at the beginning; a present-empty `suffix` asserts that it is at the end. If
both are empty, the source Document MUST be empty. During already-applied
detection, these boundary assertions apply to the outer completed pattern, not
to the original anchor's new position. Thus an add to an empty source Document
is already applied when `value` spans the entire current Document. A missing
context field means unknown context and MUST NOT be interpreted as a boundary
assertion. For a non-empty selection, a present-empty `prefix` asserts that
the selection begins at the Document boundary; a present-empty `suffix`
asserts that it ends at the Document boundary. For a `comment` operation,
resolution identifies a read-only region and MUST NOT modify the Document.

Examples of `add` insertion points:

| Document before | `selection` | `value` | Document after |
| --- | --- | --- | --- |
| `A red car.` | `{"text":"red","prefix":"A ","suffix":" car."}` (default `after`) | `!` | `A red! car.` |
| `A red car.` | `{"text":"red","prefix":"A ","suffix":" car.","placement":"before"}` | `very ` | `A very red car.` |
| `A red car.` | `{"text":"","prefix":"","suffix":"A red car."}` (beginning boundary) | `Start: ` | `Start: A red car.` |
| `A red car.` | `{"text":"","prefix":"A red car.","suffix":""}` (end boundary) | ` End` | `A red car. End` |
| *(empty)* | `{"text":"","prefix":"","suffix":""}` | `Start here.` | `Start here.` |

The operation contract is:

| `operation` | Required known fields | Forbidden known fields | Required `kind` |
| --- | --- | --- | --- |
| `comment` | non-empty `comment`; non-empty `selection.text` | `value`, `selection.placement` | `comment` |
| `delete` | non-empty `selection.text` | `value`, `selection.placement` | `text-edit` |
| `add` | `value`; `selection.text` (empty only under the boundary rules above) | — | `text-edit` |
| `reword` | `value`; non-empty `selection.text` | `selection.placement` | `text-edit` |

Every operation MUST include `selection`. `selection.placement` is permitted
only for `add`, and `value` is permitted only for `add` and `reword`. The
`comment` property is REQUIRED for `comment` and MAY provide explanatory
rationale on a text-edit operation. A Consumer MUST reject an entry whose
`kind` does not correspond to its `operation`.

### 6.2 Search scope and normalization

1. The searchable content is the original Document body **excluding** the
   embedded block and its two framing line endings as defined in section 4.2.
   A Consumer MUST NOT resolve an anchor against storage syntax or the payload.
2. Matching operates on Document source text. For MDX, this is the source, not
   the rendered output. All source offsets and context lengths are measured in
   Unicode code points as defined in section 6.1.
3. For comparison, normalize a string in this exact order: replace each CRLF
   pair with LF; apply Unicode 15.1 NFC; then replace each maximal run of Unicode
   `White_Space` code points with one U+0020 SPACE. The `White_Space` set is
   U+0009–U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000–U+200A, U+2028,
   U+2029, U+202F, U+205F, and U+3000. A lone CR is in this set and is
   collapsed in the final step.
4. For a complete anchor or completed pattern, concatenate raw components in
   the specified order first, then normalize the concatenated string once; do
   not normalize components separately, since whitespace runs may straddle
   boundaries. Carry component split markers through normalization. If a split
   falls inside one normalized code point (for example, within a collapsed
   whitespace run or composed sequence), that split is unmappable for a
   normalized-only match. Before using normalized offsets, Consumers MUST also
   search the raw source for the complete literal concatenation and use its
   literal component boundaries when they satisfy the recorded component
   strings. This preserves literal anchors whose component boundary lies within
   a source whitespace run. For context scoring, normalize each stored context
   field and its adjacent source window separately before comparison.
5. Normalization is for candidate discovery and comparison only; it MUST NOT
   modify the Document. To build an interoperable offset map, carry the source
   code-point indices through normalization: CRLF's output LF carries both
   indices; during NFC, decomposition and canonical reordering preserve each
   index and composition carries the union of the composed code points'
   indices; when a `White_Space` run is collapsed, its output space carries
   the union of all source indices in the run. For each normalized code point,
   retain the smallest contiguous source code-point span covering its carried
   indices. A source code point that contributes to more than one normalized
   code point is included in each mapping. A normalized span maps to the
   smallest contiguous source span covering the mappings of all its code
   points. A normalized boundary maps to a source boundary only when it lies between
   mapped spans and no source code point is consumed on both sides of that
   boundary; otherwise it is unmappable. Never infer a cut inside a consumed
   span: expand the candidate to the enclosing source span and mark the target
   boundary unmappable. Any match whose required target boundary is unmappable
   MUST be `ambiguous` with that enclosing source range for review; it cannot be
   an automatic exact or applied match. Candidate ranges MUST be mapped to
   original source offsets and deduplicated by their half-open source ranges.
6. Producers MUST store `selection.text`, `prefix`, and `suffix` as exact source
   slices, not normalized forms. Normalized equality alone is not literal
   equality and MUST NOT justify automatic edits or an `applied` result.

Examples: `🙂x` is two Unicode code points (one emoji plus `x`), regardless of
its UTF-16 length. A recorded `red car` and source `red   car` normalize alike,
but are not literal-equal and therefore cannot produce an automatic `exact`
edit. Likewise, precomposed `é` and source `e` + U+0301 normalize alike but
require review. For a normalized query `colour` (`n=6`), Stage 5 generates span
lengths 5 through 7; `colours` has similarity `6/7` and meets the fixed 0.8
threshold if no stronger candidate exists in the region.
### 6.2.1 Heading extraction and regions

For section resolution, a Consumer MUST extract headings from the searchable
Markdown or MDX source using this line-based grammar. This is source scanning,
not a complete Markdown or MDX parser: raw source lines are considered
regardless of whether they appear inside HTML or JSX constructs. Only fenced
code blocks and the embedded annotation block are excluded. A fenced code
block opens on a line with zero to three leading spaces followed by at least
three backticks or tildes; the opening marker is the initial run of one
character, and a backtick opener is invalid if its remaining line contains a
backtick. It closes on a line with zero to three leading spaces, the same
marker character repeated at least as many times, and only spaces or tabs
afterward. Fence detection takes precedence over heading detection, and heading
lines inside a fence are ignored. Outside fences, test each line for ATX syntax
first; only a line not recognized as ATX syntax may participate as the content
line of a Setext heading. A Setext underline line cannot also be an ATX heading.

An ATX heading is a line with zero to three leading spaces, one to six `#`
characters, then a space, tab, or end of line. Its label is the remaining line
content after removing an optional closing run of `#` characters preceded by
space or tab, then trimming surrounding spaces and tabs. A Setext heading is a
nonblank source line with at most three leading spaces immediately followed
by a line with at most three leading spaces and one or more `=` or `-`
characters plus optional trailing spaces or tabs. The first form is level 1;
the second is level 2. Its label is the preceding line trimmed of surrounding
spaces and tabs. A heading with an empty label is ignored. The label retains
inline Markdown syntax as written. Heading-label comparison is case-sensitive
and uses the normalization in section 6.2.

An `ATX` or `Setext` heading starts a section region that includes its whole
heading block (the single ATX line or both Setext lines) and ends immediately
before the next extracted heading of the same or
higher level. Lower-level regions are nested within their parent region. The
empty string in `section.heading` always means the entire searchable document;
this convention covers the preamble, documents with no headings, and selections
that cross top-level sections. A non-empty `section.heading` refers to every
region whose normalized label equals it; duplicate headings MUST all be
considered and MUST NOT be resolved by choosing the first occurrence. Candidate
locations found through overlapping regions MUST be deduplicated by their
document offsets before resolution.

A Producer MUST set `section.heading` to the innermost heading region containing
the whole selected range, including a range in the heading line. If no single
heading region contains the whole range, it MUST use the empty document scope.
This permits a selection crossing nested sections to use a containing parent
region, and a selection crossing top-level sections to use document scope.
A Consumer cannot know whether a current candidate lies in the recorded
heading region until the candidate span has been found. If a found source or
completion span lies outside every region for the stored non-empty heading,
search document-wide and set `relocated=true` for that result. If the heading is
missing, document-wide search is used from the outset and `relocated=true`.

### 6.3 Resolution algorithm

Each resolution result MUST contain a `state` and a separate Boolean
`relocated`. `state` is one of `exact`, `fuzzy`, `applied`, `ambiguous`, or
`unmatched`. Every reported candidate MUST also identify its `purpose` as
`source` (a location for the proposed edit) or `completion` (evidence the edit
may already have been made); an ambiguous result retains the purpose of each
candidate. A normalized-only source-anchor match is review-only `fuzzy` with
`purpose=source`. A normalized-only completed pattern with complete, present
contexts is review-only `fuzzy` with `purpose=completion`; human confirmation
may mark it addressed but MUST NOT apply the edit again. A literal unique
completion is `applied`, not a source-edit candidate. Any review-only completion
candidate MUST stop resolution before actionable source matching. The
`relocated` flag MUST be true when a non-empty
`section.heading` cannot be found, or when a reported match or candidate lies
outside the candidate region set. For `unmatched`, a missing non-empty heading
still sets `relocated` to true. For `ambiguous`, the flag is true if any
reported candidate is outside the candidate regions. An empty heading, which
always means document scope, does not itself set `relocated`. In a
region-specific stage, a candidate target span MUST be contained by the region;
its prefix and suffix context MAY extend beyond it and MUST be checked against
the surrounding searchable document text. Document-wide stages may report spans
outside the candidate regions and set `relocated=true`.

For each entry, a Consumer MUST evaluate the following stages in order. Stage 1
detects whether a proposed correction is already present before later stages
can identify the original text as an actionable match. This makes repeated
processing idempotent. A stage that finds ambiguous candidates MUST return
`ambiguous` and stop; it MUST NOT continue to a weaker stage to select one.

**Stage 0 — Determine the candidate region.**
Use section 6.2.1 to build the candidate region set. If a non-empty heading is
not found, use the entire searchable content for matching and set
`relocated=true`; do not change the result `state`. For an empty heading, use
the whole searchable content. Whether a found candidate span lies inside the
candidate regions is determined from that span and handled by Stage 4. Duplicate
heading labels produce a set containing every matching region. Deduplicate
identical match ranges found through overlapping regions before classifying
them.

**Stage 1 — Applied-correction detection.**
Apply section 6.4 to completed patterns whose corrected target span is within
the candidate region; context MAY extend beyond the region and is checked
against the surrounding searchable document text. If the entry's correction is
already present there, check the entire searchable content for indistinguishable
competing candidates before reporting `applied`. If no applied correction is
found in the candidate region, repeat the applied-correction check over the
entire searchable content before proceeding to Stage 2. A unique
document-wide contextual match has `state=applied` and `relocated=true` when it
lies outside the candidate regions. Competing candidates are `ambiguous`. This
allows an already-corrected passage to be recognized after it has moved while
its original heading remains. If the heading was not found, the candidate
region is already the entire searchable content as defined in Stage 0 and
`relocated` remains true.

**Stage 2 — Anchored full-context match in the candidate region.**
Find occurrences of the complete literal concatenation
`selection.prefix` + `selection.text` + `selection.suffix` in the raw source
first, retaining the literal component boundaries. Also find normalized
full-context occurrences by normalizing that complete concatenation once and
mapping the selected-text span back to source offsets. Both context fields MUST
be present. Empty fields count only as the explicit Document-boundary
assertions in section 6.1. A unique candidate is `exact` only if the raw source
slices for the selected text and both contexts are each literally equal to the
recorded strings, and all target boundaries map uniquely. A unique
normalized-only match is a review-only `fuzzy` result with `purpose=source`
(this special outcome does not use the Stage 5 similarity score); it MUST NOT
be edited automatically. Retain normalized-only candidates until Stage 4 has
checked for literal full-context matches across the Document. If any required
component boundary is unmappable,
retain the enclosing source range for review and continue checking for a
literal full-context match in the whole Document before returning it as
`ambiguous`. Multiple candidates are retained for review. Missing context is
unknown, not an empty boundary assertion. For non-`add` operations,
`selection.text` MUST be non-empty.

**Stage 3 — Contextual candidates in region.**
Search the normalized selected text for occurrences whose mapped source spans
are within the candidate regions. If a selected-span boundary is unmappable,
retain its enclosing source range as an ambiguous candidate instead of
inferring an edit boundary. At each occurrence, normalize the adjacent
source text and compare it with the recorded context. The context score is the
sum of (a) the number of normalized code points in the longest common suffix
of the available normalized prefix context and normalized `selection.prefix`,
and (b) the number in the longest common prefix of the available normalized
suffix context and normalized `selection.suffix`. Each available context window
is the immediately adjacent source text, up to the normalized code-point length
of its stored context, clipped at the Document boundary. A missing context
contributes zero; a present-empty context contributes zero and is valid only
when its boundary assertion is true. If selected-text occurrences exist but
Stage 2 did not produce one unique literal exact match, retain them as
partial-context candidates. Do not return them yet: Stage 4 checks whether a
unique full-context match exists elsewhere in the Document. Context scores MAY
order these candidates for display only; they MUST NOT promote a partial match
to `exact` or select it for an edit.

For an `add` whose `selection.text` is empty, skip Stages 3 and 4: an empty
string is not searched as a source candidate. Only the boundary-anchored checks
in Stages 1 and 2 may resolve it; otherwise continue to `unmatched` without
producing contextual or similarity candidates.

**Stage 4 — Document-wide full-context match and candidate classification.**
Search the entire searchable content for the complete literal anchor and
normalized full-context occurrences, even when Stage 3 retained partial
candidates in the candidate region. A unique literal full-context match has
`state=exact` and `relocated=true` when it lies outside the candidate regions.
Multiple literal full-context matches are `ambiguous`. A unique normalized-only
full-context match is review-only `fuzzy` with `purpose=source`; if its required
target boundary is unmappable, report the enclosing source range as
`ambiguous`. If multiple normalized-only full-context matches remain, report
them as `ambiguous`. If there is no full-context match, return `ambiguous` when
any selected-text or partial-context candidates were retained in Stages 2–4.
These candidates require human review and MUST NOT be edited automatically.

**Stage 5 — Similarity match.**
Do not run this stage for an empty `selection.text`; boundary-only add anchors
are resolved by the exact/applied rules and otherwise are `unmatched`. Let `q`
be the normalized selected text with length `n>0`. In each search scope, generate
all non-empty contiguous spans of the normalized searchable content whose
length is between `max(1, ceil(4n/5))` and `floor(5n/4)`, inclusive. Map each
span to a source range; discard spans whose source range falls outside the
scope. For spans `q` and `c`, define similarity as `1 - Levenshtein(q,c) / max(len(q),len(c))`, using Levenshtein distance over Unicode code points in the
normalized strings. A span qualifies at the fixed
threshold 0.8 (four fifths); compare scores as exact rational values, not
rounded display decimals. Search candidate regions first and search the whole
document only when no region span qualifies. Map qualifying spans to source
ranges and discard those outside the scope. Deduplicate identical mapped
source ranges. If a qualifying span with the highest score has unmappable
target boundaries, return `ambiguous` with the enclosing source range; do not
report a fuzzy candidate with an inferred edit boundary. A unique
highest-scoring mapped span has `state=fuzzy`, `purpose=source`, and requires
human review; any tie for highest score is `ambiguous`. Fuzzy results MUST NOT
be applied automatically. Set `relocated=true` for a selected span outside the
candidate regions.

**Stage 6 — Unmatched.**
If no stage matches, the result is `unmatched`.

When candidates must be displayed, Consumers MUST order them deterministically:
candidate-region matches first, then higher context scores, then earliest
position in Document order. This ordering is for display only. Consumers MUST
NOT use it to break a tie or silently select an ambiguous candidate. Resolution
MUST be deterministic for identical inputs.

### 6.4 Detecting already-applied corrections

Before an actionable source-text match, a Consumer MUST look for the expected
operation-specific completed pattern. A completion candidate is never an
arbitrary occurrence of `value`: it must contain the operation's full expected
outer pattern at one location, including every supplied context component in
its required position. Context and value are concatenated in the operation's
order and normalized once as specified in section 6.2 for candidate discovery.

The operation-specific completed patterns are:

| Operation | Completed pattern and target range |
| --- | --- |
| `delete` | `prefix` + `suffix`; the deleted target range is the zero-length source position between the two adjacent context slices. |
| `reword` | `prefix` + `value` + `suffix`; the target range is the source span occupied by `value`. |
| `add` after/default | `prefix` + `selection.text` + `value` + `suffix`; the target range is the inserted `value`. |
| `add` before | `prefix` + `value` + `selection.text` + `suffix`; the target range is the inserted `value`. |
| `comment` | No completed pattern. |

A Consumer MUST search for literal completed patterns in the candidate region
and across the entire searchable Document before searching for normalized-only
completed patterns. A normalized-only candidate in the region MUST NOT hide a
unique literal completion elsewhere. After literal completion candidates have
been classified, search for normalized-only completions and report them for
review; then consider incomplete-context evidence as specified below.

A result is `applied` only when both context fields are present, both boundary
assertions (including present-empty fields) hold, every component in the
completed pattern is literally equal to its recorded or expected source string
(including `selection.text` for `add`), the pattern occurs at one unique
location, and target boundaries map uniquely to source offsets. For `delete`,
`selection.text` is absent from the completed pattern and the reported target
range is the zero-length splice point between the literal contexts. For an
empty-text add, the completed pattern is `prefix` + `value` + `suffix`; the
original start/end assertions constrain the outer completed pattern. The
document-wide check applies when the paragraph moved but its old heading remains.

A normalized complete-pattern match whose raw source differs only by Unicode
composition or whitespace normalization is a review candidate, never
`applied`; if both contexts are present, their boundary assertions hold, and
all required boundaries map uniquely, return `fuzzy` with
`purpose=completion`. A possible applied correction with incomplete evidence is
defined narrowly: the normalized operation-specific target is found at one
location and every present context component matches adjacent text there in the
correct order, but a context is missing or a boundary assertion fails. At least
one context field MUST be present and match at that location (a present-empty
field counts only when its boundary assertion holds); with both context fields
missing, there is no possible applied candidate. Incomplete or unmappable
completion evidence is `ambiguous`; it MUST NOT be called `applied`. If no
expected target-and-context pattern is found, continue to actionable source-text
matching. A bare `value` elsewhere is never evidence of completion.

A Consumer MUST check the candidate region first, then the whole searchable
Document to find completions outside it and to test uniqueness. The target span
must be within a candidate region for its local check; contexts may cross the
region boundary. Deduplicate matches by mapped source ranges. If multiple
completed patterns are possible, or an unchanged source-text occurrence and a
completed pattern share the same recorded complete context, return `ambiguous`.
A distinct occurrence of the old source text elsewhere does not prevent a
unique literal completion from being `applied`.

For example, a `reword` from `color` to `colour` is `applied` when literal
`prefix` + `colour` + `suffix` occurs once, even if another paragraph contains
`color` with different context. If `colour` is separated from the recorded
context, its occurrence alone is not a completion. If the only match uses a
space run or composed character that normalizes to the recorded text but differs
in source, report it for review rather than calling it `applied`.

For deletion, if the literal recorded contexts are `A ` and ` car`, then the
completed source `A car` identifies a zero-length target range between those
slices. It is `applied` only at one unique splice point with both contexts
literally matching.

When a literal applied correction is detected, a Consumer MUST NOT apply it
again or report it as `unmatched`. Resolution is read-only; detecting completion
does not itself append an event. A writer MAY persist an `addressed` event
according to section 6.6 after the correction is confirmed.

### 6.5 Result states

| State | Required behavior |
| --- | --- |
| `exact` | Use the resolved range. Automatic application is permitted only when `relocated=false`; a relocated exact match requires human confirmation. |
| `fuzzy` | For `purpose=source`, report the candidate range and require confirmation before applying. For `purpose=completion`, allow confirmation that it is already addressed; MUST NOT apply the edit again. |
| `applied` | Treat the entry as already satisfied per section 6.4. |
| `ambiguous` | Report the ordered candidate ranges and require human review. MUST NOT apply a change or append an `unmatched` event. |
| `unmatched` | Report that no unique location was found. Do not modify the Document or payload during resolution. |

The `relocated` Boolean is independent of `state` and MUST NOT be presented as
a state. It reports that the recorded section could not constrain the result;
it does not change the matching classification. A Consumer MUST NOT
automatically apply any result with `relocated=true`.

A Consumer MUST NOT silently discard an `unmatched` entry, because the payload
is append-only.

### 6.6 Entry lifecycle and event history

Resolution MUST be read-only. It returns a result for each eligible entry but
does not change the Document or annotation payload. A writer that persists a
result MUST follow these event rules:

| Event | Allowed transition and meaning |
| --- | --- |
| `created` | Exactly one initial event. It MUST be first and makes the entry active. |
| `unmatched` | May follow an active entry after an unmatched resolution. It records that result but the entry remains active and eligible for later resolution. |
| `addressed` | May follow an active entry after the request is confirmed satisfied. It makes the entry inactive. |
| `submitted` | May follow `created` to record initial submission, or `addressed` to explicitly reopen the entry. It makes the entry active. It MUST NOT be used as a duplicate submission event while the entry is already active. |
| `deleted` | May follow any non-deleted state after an explicit deletion request. It is terminal; the entry is retained but no longer eligible for resolution or application. |

Current status is derived from the last event: `created`, `unmatched`, and
`submitted` mean active; `addressed` means inactive; and `deleted` means
terminal. A Consumer MUST skip addressed and deleted entries during ordinary
resolution. Reopening an addressed entry is supported only by appending
`submitted`; deleted entries cannot be reopened. An `ambiguous` result does not
change status and MUST NOT be persisted as `unmatched` or `addressed`.

Writers MUST suppress duplicate status events. They MUST NOT append another
`unmatched` event when the last event is already `unmatched`, or another
`addressed` event when the entry is already addressed. Once a later event has
changed the status, a subsequent transition to the same status is allowed.
`deleted` MUST be appended at most once, and no event may follow it.

An entry MUST begin with exactly one `created` event. Its timestamp MUST be the
same instant as the entry's `createdAt`. Event order is append order, and
timestamps MUST be non-decreasing in that order. Equality is permitted for
events written in one transaction. Each `eventId` MUST be a valid UUID and MUST
be unique across the payload; each entry `id` MUST also be a valid UUID and
unique across the payload. Date-time fields MUST be valid RFC 3339 date-times
with a time-zone offset. Consumers MUST validate these formats even when their
JSON Schema library treats `format` as annotation only.

When a payload is first created, its `createdAt` and `updatedAt` MUST represent
the same instant.

The payload's `createdAt` MUST be no later than every entry's `createdAt` and
event timestamp. The payload's `updatedAt` MUST be no earlier than its
`createdAt`, any entry's `createdAt`, or any event timestamp, and MUST NOT move
backward on update. Writers MUST set `updatedAt` to the time of each payload
write. These ordering and uniqueness requirements are semantic constraints in
addition to the JSON Schema.

After entry creation, its `id`, `kind`, `operation`, `createdAt`, `section`,
`selection`, `comment`, `value`, and any extension properties are immutable.
Writers MUST append entries and events without deleting, reordering, or
rewriting existing ones. The mutable payload fields are `updatedAt`, which
advances on writes, and the optional `editor` metadata described in section 3. To revise an existing request or its anchors, a writer MUST
append a new entry with a new `id`.

## 7. Write and update behavior

Consumers that modify annotations SHOULD preserve the representation selected
by the payload discovery algorithm:

- If an embedded block is selected, replace only the JSON body of that block.
- If a sidecar is selected, update the sidecar JSON and leave the Markdown
   Document unchanged.
- If no payload exists, create an embedded block by default. A Consumer MAY
   create a sidecar instead when the caller explicitly requests external
   annotation storage.
- If a recognized embedded block is selected and valid, update it and report
   that any sidecar is not authoritative. If the selected embedded payload
   fails parsing or validation, report the error and MUST NOT update the
   sidecar as a fallback. A Consumer MUST NOT delete either representation
   without an explicit request.

When creating an embedded payload, a Consumer MUST append it after the
Document's existing content and MUST ensure that no non-whitespace content
follows the closing fence. When rewriting a Document, it SHOULD preserve all
content before the annotation separator byte-for-byte where practical.

Before writing, a Consumer MUST reread the Document and every selected payload
file, repeat discovery and validation, and confirm that each file has the exact
same bytes as the snapshot used to resolve the edit. The snapshot MUST include
whether each candidate path was absent. If any relevant file differs, appears,
or disappears, the Consumer MUST stop with a write conflict; it MUST reload,
validate, and resolve again before retrying. Here, `no payload exists` means
that no embedded block is recognized and the sidecar path is conclusively
absent. An indeterminate or unreadable selected path, or a selected payload
that fails parsing or validation, is unavailable rather than absent and MUST
NOT be overwritten or replaced with a new empty payload. A
new payload MAY be created only when fresh discovery conclusively finds no
payload and no access or validation error. If discovery ignored a malformed
embedded candidate and found no sidecar, a new embedded block MUST be appended
without replacing or discarding the existing Document content.

The reread check MUST be protected through commit by an exclusive lock honored
by conforming writers, conditional replacement, or another mechanism that
detects concurrent changes to the target. Recheck the precondition immediately
before replacement. A Consumer MUST NOT overwrite content changed after its
precondition check. If it cannot protect or recheck the target at commit, it
MUST report a write conflict instead of writing stale content.

Each individual file update MUST be an atomic replacement: write the complete
new file to a temporary file in the same directory, flush and synchronize the
temporary file, and atomically replace the destination only after the new
contents are complete. Readers MUST see either the old complete file or the new
complete file, never a partially written destination. A failure before
replacement MUST leave the original destination intact. A Consumer MUST NOT
update a file by truncating and rewriting it in place. If atomic replacement is
unavailable, report a write error and leave the destination unchanged. A
Consumer SHOULD synchronize the containing directory after replacement where
the platform supports it. Leftover temporary files are not annotation payloads
and MUST NOT be selected during discovery.

An operation that changes both a Document and a separate sidecar cannot be
committed atomically as a pair. Before either commit, the Consumer MUST prepare
both new files and recheck both preconditions. It MUST then atomically replace
the Document first and the sidecar second. If the Document replacement fails,
leave the sidecar unchanged. If the Document replacement succeeds but the
sidecar replacement fails or conflicts, report a `partial-commit` result that
identifies the committed Document and the unchanged sidecar; do not claim that
the annotation event was persisted and do not try to roll back the Document.
If the process stops between the two replacements, recovery MUST treat the
state as the same partial commit. On retry, reread both files and resolve the
entry again. If section 6.4 finds
the unique literal completed pattern, treat the edit as already applied and
MUST NOT apply it again; the writer MAY then append the still-missing event if
the entry remains active and the requested completion is confirmed. If a
concurrent update changed the entry or either precondition, stop and report a
write conflict instead of appending stale state.

Applying a text edit changes the Document but MUST NOT rewrite annotation
anchors. After each applied edit, a Consumer MUST resolve the remaining active
entries again against the current Document using their immutable stored
anchors. Any entry that no longer has a unique, safe resolution requires
review.

When applying multiple edits resolved against one Document snapshot, a Consumer
MUST detect overlapping target ranges before writing. Overlapping ranges,
including insertions at the same source offset, MUST NOT be applied
automatically. Disjoint edits MAY be applied in descending source-offset order
so earlier offsets remain stable, but after each edit the Consumer MUST resolve
the remaining active entries again against the changed Document and MUST NOT
reuse stale source offsets. If a remaining edit no longer resolves uniquely
and safely, stop the batch for review.

## 8. Validation and diagnostics

A Consumer MUST report recognition, selection, parsing, and schema validation
as separate outcomes. In particular, a recognized embedded block is selected
before its body is parsed or validated; neither failure makes the sidecar
eligible as a fallback. A malformed or incomplete delimiter sequence is not a
recognized block and does not prevent sidecar selection.

A Consumer MUST distinguish these conditions:

| Condition | Required behavior |
| --- | --- |
| No recognized embedded block and no sidecar | Treat the Document as having no annotations. |
| Malformed separator, ineligible opener, missing exact closing marker, or non-whitespace after a closing marker | Treat that candidate as unrecognized; continue scanning for a later final candidate, then inspect the optional sidecar if none is recognized. |
| Recognized embedded block with invalid UTF-8 or invalid JSON | Report an embedded parse error; do not use the sidecar as a fallback. |
| A payload contains duplicate JSON object member names | Reject it during parsing. If selected, report a primary parse error; if it is the inspected sidecar beside a valid embedded payload, report `sidecar-invalid` as a secondary warning. |
| Recognized embedded block whose JSON is not an object or fails `schema.json` | Report an embedded schema/contract error; do not use the sidecar as a fallback. |
| No recognized embedded block; sidecar path status cannot be determined or identifies a non-regular file | Report a sidecar selection error. |
| No recognized embedded block; selected sidecar cannot be read | Report a sidecar read error. |
| No recognized embedded block; sidecar has invalid UTF-8 or invalid JSON | Report a sidecar parse error. |
| No recognized embedded block; sidecar JSON is not an object or fails `schema.json` | Report a sidecar schema/contract error. |
| Valid embedded payload; sidecar conclusively absent | Use the embedded payload without a sidecar diagnostic. |
| Valid embedded payload; sidecar path is inaccessible, non-regular, unreadable, or invalid | Use the embedded payload and report a secondary warning with code `sidecar-unavailable` or `sidecar-invalid`, as applicable. |
| Valid embedded and valid sidecar payloads with equal parsed JSON values | Use the embedded payload; report no duplicate-payload diagnostic. |
| Valid embedded and valid sidecar payloads with unequal parsed JSON values | Use the embedded payload and report a `duplicate-payload` warning; do not merge entries. Compare values according to section 5. |
| Earlier annotation-shaped block followed by another block or other non-whitespace content | The earlier block is not embedded metadata because it is not final; only a later structurally recognized final block can be selected. |
| Structurally recognized final embedded block with invalid JSON and a valid sidecar | Report the embedded parse error and do not inspect or use the sidecar. |

The selected representation determines the primary result. Errors parsing or
validating the selected payload are primary errors and make the payload
unavailable. Sidecar inspection warnings when a valid embedded payload is
selected are always secondary: they MUST NOT change the primary result from
`valid` to `error`. Consumers MUST report a duplicate-payload conflict and
sidecar-unavailable/invalid condition consistently as warnings; they MUST
order multiple secondary warnings by code (`duplicate-payload`, then
`sidecar-invalid`, then `sidecar-unavailable`). Diagnostics MUST identify the
selected or failing location, such as
`path/to/document.md.annotations` or
`path/to/document.md#markdown-annotation`. For an MDX Document, the
corresponding locations use `path/to/component.mdx.annotations` and
`path/to/component.mdx#markdown-annotation`.

## 9. Compatibility and versioning

The extension version in this document and the annotation `schemaVersion` are
separate version values; both are `2.0.0` for this release. Version 2.0.0 makes
breaking changes to the 1.0.0 payload contract, including required operation,
kind, selection, event, and placement semantics. A Consumer MUST reject a
`schemaVersion` of `1.0.0` by default, as well as any other unsupported value.
It MUST NOT reinterpret or migrate a 1.0.0 payload as 2.0.0 while loading it.

A v1-to-v2 migration MUST be explicitly requested. It MUST preserve the
original v1 Document and payload bytes and write the migrated v2 result to a
separate destination. The migration MUST validate the result against the v2
schema and semantics. It MUST NOT guess missing or conflicting operation,
`kind`, selection/context, placement, or event data. Each source entry that
cannot be migrated without guessing MUST be reported by entry ID with the
reason and surfaced for human review; it MUST NOT be silently dropped or
included as a v2 entry.

Unknown payload properties MAY be preserved and MAY be interpreted by a
future extension version. Consumers SHOULD preserve unknown properties when
rewriting an annotation payload.

## 10. Conformance checklist

A Consumer conforms to Markdown Annotation Extension 2.0.0 if it:

- derives the sidecar by appending `.annotations` to the Document path;
- separates structural embedded-block recognition from representation
  selection, payload parsing, and schema validation as defined in sections
  4.2, 5, and 8;
- applies embedded precedence and no-fallback behavior from sections 5 and 8;
- resolves entry locations using the staged algorithm in section 6.3;
- excludes the embedded annotation block from anchor matching;
- detects already-applied corrections per section 6.4 before source-text
  matching;
- requires unique, literal source equality of the complete selected span and
  contexts for `exact`, and of the complete operation-specific pattern for
  `applied`; normalized-only matches require review;
- reports ties or partial-context candidates as `ambiguous` for human review;
- uses deterministic candidate ordering for display only and never to break a
  resolution tie;
- permits empty `selection.text` only for `add`, with both context fields
  present, and applies the placement and boundary rules in section 6.1;
- validates the selected JSON against [schema.json](schema.json);
- compares valid embedded and sidecar payloads using section 5's JSON equality,
  reports unequal copies as a warning, and never merges them;
- checks fresh write preconditions, uses atomic file replacement, and reports
  partial commits and conflicts according to section 7;
- does not reuse stale edit offsets or automatically apply overlapping edits.
