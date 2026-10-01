# Markdown and MDX Annotation Extension Specification

Version 1.0.0

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
   required `schemaVersion` value `1.0.0`.
4. JSON whitespace before or after the object is permitted. No other text is
   permitted in a sidecar or in the body of an embedded block.
5. A Consumer MUST parse the payload as data. It MUST NOT execute values from
   the payload as code, Markdown, or MDX.
6. The association between a payload and its Document is determined by the
   storage location: a sidecar is associated through its filename, and an
   embedded payload is associated with the Document that contains it. The
   payload does not contain a document-path property.

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
  "$schema": "https://base.bmwgroup.net/schema/document-comments.json",
  "schemaVersion": "1.0.0",
  "createdAt": "2026-09-30T12:00:00Z",
  "updatedAt": "2026-09-30T12:00:00Z",
  "entries": []
}
```
````

The embedded syntax is defined as follows:

1. The separator MUST be a line containing exactly three hyphen-minus
   characters (`---`), optionally surrounded by spaces or tabs.
2. The separator MUST be followed by zero or more blank lines and then an
   opening fence line containing exactly three backticks and the exact info
   string `json:annotation`. The `json:annotation` info string identifies the
   annotation extension and its JSON payload; the block body remains JSON.
3. The JSON payload MUST start after the opening fence and MUST end before the
   closing fence.
4. The closing fence MUST be a line containing exactly three backticks,
   optionally surrounded by spaces or tabs.
5. After the closing fence, the Document MAY contain whitespace only. A
   non-whitespace character after the closing fence means the block is not an
   annotation block.
6. The separator and fences are storage syntax and MUST NOT be included in the
   JSON payload.
7. A conforming Markdown or MDX renderer MUST exclude the recognized annotation
   block from the rendered Document. A generic renderer that does not
   implement this extension MAY render it as a code block.

The embedded block is located at the following logical annotation locator:

```text
embedded:path/to/document.md#markdown-annotation
embedded:path/to/component.mdx#markdown-annotation
```

Line endings MAY be LF or CRLF. The exact three-backtick form is used so that a
normal fenced code block elsewhere in the Document is not treated as
annotation metadata.

## 5. Payload discovery algorithm

Given a Document path and its contents, a Consumer MUST apply these steps in
order:

1. Inspect the Document for an embedded block that satisfies all rules in
   section 4.2.
2. If a valid embedded block exists, select the embedded representation.
3. Otherwise, derive the optional sidecar path by appending `.annotations` to
   the Document path.
4. If the sidecar exists as a regular file, select the sidecar representation.
5. If neither representation exists, report that the Document has no
   annotation payload. This is not itself a malformed-document error.

The embedded representation is preferred because it travels with the Document.
The sidecar is optional and provides an alternative when annotations should be
kept outside the Document. A Consumer MUST NOT silently fall back to a
sidecar when a recognized embedded block cannot be parsed or does not validate.
It MUST report the embedded-payload error instead.

If both representations exist and the selected embedded payload is valid, the
Consumer MAY inspect the sidecar for diagnostics, but MUST use the embedded
payload as authoritative. If both payloads are valid but differ, the Consumer
SHOULD report a duplicate-payload conflict and MUST NOT merge their entries
implicitly.

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
| `value` | For `add` and `reword`, the replacement or inserted text. |

`selection.prefix` and `selection.suffix` SHOULD each contain at least 32 and at
most 128 characters of adjacent Document text, truncated at the Document
boundary. Longer context increases resolution accuracy, and a Producer SHOULD
NOT omit them.

For an `add` operation, `selection.text` identifies the insertion anchor and
`value` is the text to insert. For a `comment` operation, resolution identifies
a read-only region and MUST NOT modify the Document.

### 6.2 Search scope and normalization

1. The searchable content is the Document body **excluding** the embedded
   annotation block defined in section 4.2. A Consumer MUST NOT resolve an
   anchor against the annotation payload itself.
2. Matching operates on Document source text. For MDX, this is the source, not
   the rendered output.
3. For comparison only, a Consumer MUST apply the same normalization to both
   the anchor strings and the searchable content: convert CRLF to LF, apply
   Unicode NFC normalization, and collapse each run of whitespace to a single
   space.
4. Normalization MUST NOT modify the Document. A Consumer MUST map any match
   back to the corresponding offsets in the original, unnormalized text.

### 6.3 Resolution algorithm

For each entry, a Consumer MUST evaluate the following stages in order and stop
at the first stage that yields a match.

**Stage 0 — Determine the candidate region.**
Locate the heading equal to `section.heading`. If it is found, the candidate
region is that heading's body, ending before the next heading of the same or
higher level. If it is not found, the candidate region is the entire searchable
content and the result MUST be reported as relocated.

**Stage 1 — Anchored exact match.**
Search the candidate region for the concatenation `selection.prefix` +
`selection.text` + `selection.suffix`. A single occurrence resolves the entry
with `exact` confidence.

**Stage 2 — Contextual match in region.**
Search the candidate region for `selection.text`. For each occurrence, compute a
context score from the length of the longest common suffix with
`selection.prefix` and the longest common prefix with `selection.suffix`. If one
occurrence has the highest score, it resolves the entry with `exact` confidence.

**Stage 3 — Document-wide match.**
Repeat stages 1 and 2 over the entire searchable content. A match resolves the
entry with `relocated` confidence, indicating that the section changed.

**Stage 4 — Similarity match.**
Compute a normalized similarity between `selection.text` and candidate spans. A
best candidate at or above the similarity threshold resolves the entry with
`fuzzy` confidence. The threshold is RECOMMENDED to be 0.8. A `fuzzy` result
MUST NOT be applied automatically without review.

**Stage 5 — Applied-correction detection.**
Apply section 6.4. If the entry's correction is already present, the result is
`applied`.

**Stage 6 — Unmatched.**
If no stage matches, the result is `unmatched`.

Ties MUST be resolved deterministically: prefer the match inside the candidate
region, then the higher context score, then the earliest position in Document
order. Resolution MUST be deterministic for identical inputs.

### 6.4 Detecting already-applied corrections

An entry whose `selection.text` is absent is not necessarily unmatched, because
the requested change may already have been made. A Consumer MUST test for this
before reporting `unmatched`, using the before and after context to locate the
original position:

| Operation | Already-applied condition |
| --- | --- |
| `delete` | `selection.text` is absent and `selection.prefix` is now immediately followed by `selection.suffix`. |
| `reword` | `selection.text` is absent and `value` appears between `selection.prefix` and `selection.suffix`. |
| `add` | `value` already appears adjacent to the anchor position implied by `selection.prefix` and `selection.suffix`. |
| `comment` | Not applicable. A comment implies no Document change, so a missing `selection.text` is `unmatched`. |

When an applied correction is detected, a Consumer:

- MUST NOT apply the change again;
- MUST NOT report the entry as `unmatched`; and
- SHOULD append an `addressed` event to the entry.

### 6.5 Result states

| State | Required behavior |
| --- | --- |
| `exact` | Use the resolved range. The change MAY be applied automatically. |
| `relocated` | Use the resolved range and report that the section anchor no longer matches. |
| `fuzzy` | Report the candidate range and require confirmation before applying. |
| `applied` | Treat the entry as already satisfied per section 6.4. |
| `unmatched` | Do not modify the Document and append an `unmatched` event. |

A Consumer MUST NOT silently discard an `unmatched` entry, because the payload
is append-only.

After applying a change, a Consumer SHOULD refresh `selection.prefix`,
`selection.suffix`, and `section.text` for the remaining entries so that
subsequent resolutions anchor against current Document content.

## 7. Write and update behavior

Consumers that modify annotations SHOULD preserve the representation selected
by the payload discovery algorithm:

- If an embedded block is selected, replace only the JSON body of that block.
- If a sidecar is selected, update the sidecar JSON and leave the Markdown
   Document unchanged.
- If no payload exists, create an embedded block by default. A Consumer MAY
   create a sidecar instead when the caller explicitly requests external
   annotation storage.
- If both representations exist, update the embedded block and report that the
   sidecar is not authoritative. A Consumer MUST NOT delete either
   representation without an explicit request.

When creating an embedded payload, a Consumer MUST append it after the
Document's existing content and MUST ensure that no non-whitespace content
follows the closing fence. When rewriting a Document, it SHOULD preserve all
content before the annotation separator byte-for-byte where practical.

## 8. Validation and diagnostics

A Consumer MUST distinguish these conditions:

| Condition | Required behavior |
| --- | --- |
| No sidecar and no embedded block | Treat the Document as having no annotations. |
| Invalid sidecar JSON when no valid embedded block exists | Report a sidecar error. |
| Sidecar JSON fails `schema.json` when no valid embedded block exists | Report a sidecar error. |
| Malformed embedded fence or trailing content | Treat it as no embedded annotation block, then inspect the optional sidecar. |
| Invalid embedded JSON or schema mismatch | Report an embedded-payload error; do not use the sidecar as a fallback. |
| Valid sidecar and valid embedded payloads that differ | Use the embedded payload and report a duplicate-payload conflict. |

Diagnostics SHOULD identify the selected or failing location, such as
`path/to/document.md.annotations` or
`path/to/document.md#markdown-annotation`. For an MDX Document, the
corresponding locations use `path/to/component.mdx.annotations` and
`path/to/component.mdx#markdown-annotation`.

## 9. Compatibility and versioning

The extension version in this document and the annotation `schemaVersion` are
separate version values. A Consumer MUST validate `schemaVersion` according to
the referenced schema and MUST reject unsupported schema versions rather than
silently interpreting them as `1.0.0`.

Unknown payload properties MAY be preserved and MAY be interpreted by a
future extension version. Consumers SHOULD preserve unknown properties when
rewriting an annotation payload.

## 10. Conformance checklist

A Consumer conforms to Markdown Annotation Extension 1.0.0 if it:

- derives the sidecar by appending `.annotations` to the Document path;
- recognizes the exact final embedded syntax in section 4.2;
- applies embedded precedence and error behavior from section 5;
- resolves entry locations using the staged algorithm in section 6.3;
- excludes the embedded annotation block from anchor matching;
- detects already-applied corrections per section 6.4 before reporting
  `unmatched`;
- validates the selected JSON against [schema.json](schema.json); and
- does not silently merge or discard duplicate annotation payloads.
