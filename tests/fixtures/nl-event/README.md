# NL Event parser fixtures

**Prepared:** 2026-10-24. **Purpose:** reproducible, reviewable fixture inputs and separately stated expectations for `nl-event`.

## Layout

- `inputs/<id>.txt`: text the user would paste into the single Description textarea. Tests must pass **only this text** into the parser (plus the explicitly injected test context).
- `expected/<id>.json`: expected field values, per-field alternatives, provenance, warnings and date/time context. These files are **test oracles**, not parser input or generated UI copy. Assertions describe semantics, not a required internal data model.
- `oracles/`: independent calendar metadata for time-zone/serialization checks; **never inject it into text-only parsing**.

Each expectation names a fixed UTC `referenceInstant`, browser IANA time zone, and optional explicit event-zone override. A missing `eventTimeZoneOverride` means the app must infer it from the source or fall back to browser context, rather than receiving a privileged calendar value.

## Provenance and limits

| Fixture | Origin | Completeness |
| --- | --- | --- |
| `k1-wine-excerpt` | Exact quoted user-provided lines | Excerpt; full announcement unavailable |
| `k2-milonga-excerpt` | Exact quoted user-provided lines | Excerpt; full announcement unavailable |
| `k3-slow-saturday-synthetic` | Constructed from known user-mentioned dates and times | **Synthetic**, not recovered original |
| `e1-st-paul-houseparty-sanitized` | Adapted from a stored calendar description | Sanitized; private residence address removed |
| `e2-workshop-times-only-sanitized` | Adapted from a stored calendar description | Sanitized; original did not contain parent date |
| `e3-series-deadline-synthetic` | Constructed from calendar context | **Synthetic**; calendar's recurrence dates omitted |
| `k4-blues-jam-sanitized` | Selected calendar-description lines | Excerpt, excludes financial/personal information |
| Other `*-synthetic` | Explicitly created regression cases | Synthetic |

Do **not** claim these inputs are the missing complete originals. In particular, K1/K2 represent quoted excerpts from the earlier conversation. K3 cannot be restored from a summary. If the owner finds the full announcements, add separate `*-original` cases with unchanged source text and explicit expectations; do not overwrite these regression examples.

The fixtures intentionally omit third-party account numbers, registration URLs, personal names, and a private home address. Inspect them before publishing a repository and avoid committing raw calendar data.

## Expected behavior / reviewing failures

- Some fixtures intentionally have no complete event date/time. `exportable:false` means an export must be blocked until required information is provided. Time-only candidates must not silently acquire the parent date from a separate calendar record.
- `preferred` is the best grounded initial interpretation where one is supported. A missing field is *not* permission to invent it. `candidateValues` and `partialCandidateValues` are alternatives the UI may offer under the corresponding field.
- `endInferred`, `inferred-year`, `past-event`, relationship group labels, and other prose rules capture behavior. T3 may adapt the assertion format to existing test conventions without weakening those semantics.
- When multiple activities overlap, preserve relationships and show warnings; clicking one field's suggestion must not silently edit other fields.
- All Day: user-visible End is inclusive; exporters use an exclusive ending date.
- `e3-series-calendar-metadata.json` checks the fall DST transition. It is an independent oracle only.

## Integration

The bundle is integrated here at `tests/fixtures/nl-event/`, preserving its IDs and input/expectation/oracle bytes. No test framework or parser has been added. The behavior contract is in [the product spec](../../../specs/nl-event-spec.md).

When implementing tests, load `inputs/<id>.txt` and only the paired expectation's `context` as parser arguments. Compare the result with `assertions` afterward. Keep `source`, `assertions`, and `oracles/` out of parser arguments. Null fields express missing evidence; omitted assertions leave behavior unasserted rather than requiring empty output. Candidate collections assert semantic values and relationships, not a new internal API.

The current bundle does not exercise draft lifecycle, field ownership/reset, clipboard cancellation, stale parse results, or zone-override persistence. Those require state-transition tests during implementation; see the spec's acceptance scenarios. E4 (contradictory copied dates) is not supplied and remains a coverage gap. K2's inferred lesson end overlaps the social; preserve that assertion and label it inferred rather than treating it as a source fact.
