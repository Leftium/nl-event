# NL Event parser fixtures

**Prepared:** 2026-10-24. **Purpose:** reproducible, reviewable fixture inputs and separately stated expectations for `nl-event`.

## Layout

- `inputs/<id>.txt`: text the user would paste into the single Description textarea. Tests must pass **only this text** into the parser (plus the explicitly injected test context).
- `expected/<id>.json`: expected field values, per-field alternatives, provenance, warnings and date/time context. These files are **test oracles**, not parser input or generated UI copy. Assertions describe semantics, not a required internal data model.
- `oracles/`: independent calendar metadata for time-zone/serialization checks; **never inject it into text-only parsing**.

Each expectation names a fixed UTC `referenceInstant`, browser IANA time zone, and optional explicit event-zone override. A missing `eventTimeZoneOverride` means the app must infer it from the source or fall back to browser context, rather than receiving a privileged calendar value.

## Provenance and limits

| Fixture                            | Origin                                                | Completeness                                       |
| ---------------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| `k1-wine-excerpt`                  | Exact quoted user-provided lines                      | Excerpt; full announcement unavailable             |
| `k2-milonga-excerpt`               | Exact quoted user-provided lines                      | Excerpt; full announcement unavailable             |
| `k3-slow-saturday-synthetic`       | Constructed from known user-mentioned dates and times | **Synthetic**, not recovered original              |
| `e1-st-paul-houseparty-sanitized`  | Adapted from a stored calendar description            | Sanitized; private residence address removed       |
| `e2-workshop-times-only-sanitized` | Adapted from a stored calendar description            | Sanitized; original did not contain parent date    |
| `e3-series-deadline-synthetic`     | Constructed from calendar context                     | **Synthetic**; calendar's recurrence dates omitted |
| `k4-blues-jam-sanitized`           | Selected calendar-description lines                   | Excerpt, excludes financial/personal information   |
| Other `*-synthetic`                | Explicitly created regression cases                   | Synthetic                                          |

Do **not** claim these inputs are the missing complete originals. In particular, K1/K2 represent quoted excerpts from the earlier conversation. K3 cannot be restored from a summary. If the owner finds the full announcements, add separate `*-original` cases with unchanged source text and explicit expectations; do not overwrite these regression examples.

The fixtures intentionally omit third-party account numbers, registration URLs, personal names, and a private home address. Inspect them before publishing a repository and avoid committing raw calendar data.

## Expected behavior / reviewing failures

- Some fixtures intentionally have no complete event date/time. `exportable:false` means an export must be blocked until required information is provided. Time-only candidates must not silently acquire the parent date from a separate calendar record.
- `preferred` is the best grounded initial interpretation where one is supported. A missing field is _not_ permission to invent it. `candidateValues` and `partialCandidateValues` are alternatives the UI may offer under the corresponding field.
- `endInferred`, `inferred-year`, `past-event`, relationship group labels, and other prose rules capture behavior. T3 may adapt the assertion format to existing test conventions without weakening those semantics.
- When multiple activities overlap, preserve relationships and show warnings; clicking one field's suggestion must not silently edit other fields.
- All Day: user-visible End is inclusive; exporters use an exclusive ending date.
- `e3-series-calendar-metadata.json` checks the fall DST transition. It is an independent oracle only.

## Integration

The bundle is integrated here at `tests/fixtures/nl-event/`, preserving its IDs, input bytes, and independent oracle data. Expectations can gain focused regression assertions as coverage grows. The behavior contract is in [the product spec](../../../specs/nl-event-spec.md).

When implementing tests, load `inputs/<id>.txt` and only the paired expectation's `context` as parser arguments. Compare the result with `assertions` afterward. Keep `source`, `assertions`, and `oracles/` out of parser arguments. Null fields express missing evidence; omitted assertions leave behavior unasserted rather than requiring empty output. Candidate collections assert semantic values and relationships, not a new internal API.

The JSON fixture loop checks extraction; state-transition tests in `tests/parser.test.ts` and `tests/event-core.test.ts` cover draft lifecycle, field ownership/reset, stale parse results, and zone overrides. Clipboard completion and cancellation also require shell integration coverage; see the spec's acceptance scenarios. E4 (contradictory copied dates) is not supplied and remains a coverage gap. K2's inferred lesson end overlaps the social; preserve that assertion and label it inferred rather than treating it as a source fact.

## Adding an announcement regression

1. Add the text to `inputs/<id>.txt` and the matching `expected/<id>.json`.
   Record whether it is original, an excerpt, sanitized, or synthetic in `source`.
   Preserve public wording, punctuation and line breaks; redact private data and
   describe the changes. Existing reports in `tests/inputs/` may instead stay
   there with a focused test in `tests/parser.test.ts`.
2. Set `context.referenceInstant` to a fixed UTC instant and
   `context.browserTimeZone` to an explicit IANA zone. Set
   `eventTimeZoneOverride` only when the user actually chose one. Derive expected
   dates from that context and the announcement, never from a separate calendar
   record or the machine's current clock/zone.
3. Write expectations from the reported behavior before inspecting parser output.
   Use `preferred` for initial field values, `candidateValues` for required
   alternatives, and `orderedCandidateValues` for a small complete list whose
   membership and order matter. For example:

   ```json
   "orderedCandidateValues": {
     "title": ["Community house party", "Music from"],
     "end": ["2026-11-15 00:00"]
   }
   ```

   `candidateValues` allows extra alternatives (except `[]`, which requires none).
   `orderedCandidateValues` compares the exact value list from `Core.alternatives`,
   rejecting extra, duplicate, missing, or reordered candidates. It stores no IDs,
   rank numbers, labels, or full candidate snapshots. Use it selectively; long
   series and intentionally open-ended lists are better checked with focused
   inclusion, exclusion, and relationship assertions.

4. Use `relationships` to require a shared Start/End association, including
   `endInferred: true` for a proposed default. `group` is a descriptive oracle
   label, not a required internal group ID. The runner also handles
   `additionalRelatedTimeRanges`, `excludeAsEventBoundary` (Start only), warnings,
   partial candidates, zone, all-day and blocked-export assertions. Prose such as
   `notExpected`, `timezoneProvenance`, or `candidateSelectionRule` is review
   guidance, not executable coverage. Add a focused TypeScript assertion when
   that behavior matters; do not assume every JSON property is executed.
5. For a new semantic gap, add a focused test beside the fixture loop. Check
   rejected candidates in the relevant collection, relative ranking or association
   after selection, and exact source slices/offsets where relevant. Offsets are
   UTF-16 indices into the unchanged Description, including emoji and CRLF.
   Inferred ends must not claim a source clock. The loop checks bounds for every
   evidence span; bounds alone do not prove that the right text was used.
   Exercise selection, Auto/Manual ownership, validation and Google/ICS output
   only where existing transition/export tests do not already prove the contract.
6. Run the focused parser suite, then the required project checks:

   ```sh
   pnpm test tests/parser.test.ts
   pnpm test
   pnpm check
   pnpm lint
   ```

   To isolate one paired fixture, use
   `pnpm test tests/parser.test.ts -t 'accepted source fixture: <id>'`.
   `pnpm test` compiles ReScript and runs Vitest; no dev server or browser is
   required. Do not edit generated `.res.js` or `.gen.ts` files.

## Choosing core-only or browser verification

Core-only verification is sufficient for announcement parsing and domain changes
when the behavior is fully expressed through extraction, `Core.alternatives`,
selection/reset, ownership, validation and serialization. A new parser example
should prove its candidate alternatives and relevant negative/evidence cases
here. An unchanged UI does not need a browser replay for each new announcement.
This policy also applies to future parser fixes, although this PR changes only
tests and documentation.

Use browser tests when a change affects Svelte controls or rendering, native
focus/selection/touch, evidence highlighting in the DOM, debounce/effect ordering,
clipboard or fetch completion, or actual link/download activation. Core exports
prove URL/ICS contents; they cannot prove control wiring, a download event, or a
saved Google Calendar event. A UI/integration change still needs the appropriate
browser journey even when its core tests pass. Server and adapter contracts also
need their relevant integration tests; intercepted browser requests do not prove
live services.

The [browser coverage inventory](../../browser/COVERAGE.md) remains the authority
for the retained browser contracts. In particular, `checkCandidates` retains raw
source presentation, chip/control wiring, geometry and debounce/reset proof;
evidence journeys retain mirror alignment and native hover/focus; export journeys
retain actual download and control wiring. The ordered fixture assertions and
activity-selection tests close pure gaps identified in that inventory. They do
not retire any browser tests or establish the separate under-60-second target.
