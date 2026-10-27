# Browser coverage inventory

Originally reviewed for #41 / PR #46 at `d8eaa06`; updated for PR #48 fixture
retirement below. This inventory separates the contracts inside each journey;
it does not authorize removing the whole journey.

| Browser journey / group                                                                                                                                                  | Pure behavior already covered by Vitest                                                                                                                                          | Unique browser proof and proposed disposition                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkInitialFocus` (four fresh contexts per engine)                                                                                                                     | Core draft creation                                                                                                                                                              | Hydration autofocus, existing focus ownership, enable race and scroll preservation. Retain; a shared-page test cannot substitute for fresh hydration.                                                                                                                                                      |
| `checkCandidates` (3 representative fixtures plus interactions)                                                                                                          | `parser.test.ts`: all 14 preferred-value fixtures, candidate selection, stale tickets, Manual ownership                                                                          | Keep representative Korean/English raw source presentation, chip selection, export blocking, geometry and debounce/reset wiring. Eleven fixture permutations per engine are retired below; the interaction journey remains.                                                                                |
| `checkSlowSaturday`, `checkRhythmParty`, `checkNumericDateReports`, `checkOvernightParty`, `checkBulletedWorkshop`, `checkReviewedMidnight`, imported `checkSpacedClock` | `parser.test.ts`, `time-input.test.ts`: numeric/clock formats, ranking, session association, midnight and inferred End, exact source offsets                                     | Keep representative source-to-controls/export wiring. Repeated fixture-value and Google/ICS interval matrices are candidates for contraction after checking which control/evidence contracts are unique. Spaced-clock touch activation is distinct from clock parsing.                                     |
| `checkEnglishDates`, `checkLunch`, `checkFallbacks`, inline relative-all-day/source-clipboard checks                                                                     | `english-dates.test.ts`, `parser.test.ts`, `temporal-parts.test.ts`: precision, generated fallback choices and inferred clocks                                                   | Retain blocked-export feedback, source versus generated presentation, and a representative chip/Auto/Manual journey. Pure phrase permutations need not repeat in both engines.                                                                                                                             |
| `checkTemporalParts`, `checkDurations`, `checkFreeform`, `checkAllDay`, inline DST/all-day checks                                                                        | `temporal-parts.test.ts`, `duration-options.test.ts`, `time-input.test.ts`, `event-core.test.ts`: range, duration, DST and all-day semantics                                     | Retain actual choice/radio controls, interpretation/error feedback and ownership wiring. Pure value/serialization permutations are candidates; do not equate equal numbers with equivalent DOM controls.                                                                                                   |
| `checkCompactDates`                                                                                                                                                      | Temporal option generation in `temporal-parts.test.ts`; date compaction currently lives in Svelte                                                                                | Keep collapsed/expanded state, selected options staying visible, button focus/activation and touch target/layout. Boundary-count sweeps are not yet fully replaceable by a unit helper.                                                                                                                    |
| `checkEvidenceHighlights`, `checkTitleEvidence`, `checkEvidenceLabels`                                                                                                   | `evidence-highlight.test.ts`: layered segmentation, original UTF-16 offsets, emoji/CRLF, inferred/generated evidence                                                             | Keep mirror alignment, native hover/focus, keyboard tooltips, scroll dismissal, label/chip wiring, stale highlight clearing and source reveal. Pure range permutations can remain unit-only.                                                                                                               |
| `checkDescriptionEditor`, `checkStickyDescription`, inline desktop/mobile geometry                                                                                       | `evidence-highlight.test.ts` covers segmentation, not native editor behavior                                                                                                     | Keep native Enter/undo/redo, Chromium CDP composition, composition Escape, textarea identity/selection, wrap/fullscreen, scroll and overflow restoration, responsive sizing and sticky geometry. Success PNG capture is diagnostic evidence, not an image-baseline assertion; measure its cost separately. |
| `checkSelectionActions`, `checkSelectedTitle`, `checkSelectOnFocus`                                                                                                      | Core field edits and stale identity/revision rejection; selection validation is partly in Svelte                                                                                 | Keep native mouse/keyboard/touch selection, focus transfer, fullscreen actions, replacement invalidation and WebKit mouseup/dialog behavior. Inspect expensive permutations individually; the highest cost does not establish redundancy.                                                                  |
| `checkPendingClipboard`, inline read outcomes, copy checks inside `checkCalendarDescription`                                                                             | `event-core.test.ts`: empty/replacement transitions and identity                                                                                                                 | Keep deferred read/write completion, reset/replacement races, error/empty feedback and native focus wiring. Browser clipboard methods are stubbed; OS permissions and the real system clipboard are outside this proof.                                                                                    |
| `checkMapLocations`                                                                                                                                                      | `parser.test.ts` and `announcement-links.test.ts`: address-first locations and URL classification                                                                                | Keep one address/venue choice through DOM and export wiring. Coordinate changes in supported map recognition with #32 rather than silently changing policy during test retirement.                                                                                                                         |
| `checkAnnouncementLinks`                                                                                                                                                 | `announcement-links.test.ts`: discovery, roles, equivalence and grouping                                                                                                         | Keep no request before opt-in, one panel, link activation, fullscreen/Escape/focus, and coarse-pointer use. Form requests are intercepted, not live service proofs.                                                                                                                                        |
| `checkCalendarDescription`, `checkDescriptionReviewRegressions`                                                                                                          | `calendar-description.test.ts`: text composition, edited section tracking/replacement; `form-metadata.test.ts`: cache/alias ordering; `form-meta-proxy.test.ts`: server boundary | Keep actual Svelte confirmation persistence across parse/sibling edits (#40), deferred fetch/reset/replacement, plain-text rendering, request policy, copy outcomes and description-to-export wiring. Pure text matrices can be cheaper, but extraction of remaining component workflow belongs in #43.    |
| Imported `checkOvernightExport`, inline actual download/UID checks                                                                                                       | `overnight-export.test.ts`, `event-core.test.ts`: trimming, serialization, escaping/folding, UID state                                                                           | Keep real Blob/download events and representative checkbox/help/description wiring. Repeated interval/body assertions across all modes are candidates. Google checks inspect the generated link, not a saved event in Google Calendar.                                                                     |
| Inline touch controls/compact dates                                                                                                                                      | Pure parsing and transition outcomes as above                                                                                                                                    | Keep coarse-pointer detection, target sizes, tap selection, fullscreen and narrow layout. Emulation does not prove physical iOS/Android keyboards, toolbars or clipboard permissions.                                                                                                                      |

## Selection policy

Retain each meaningful native event, DOM, asynchronous ordering and download
boundary. Before retiring a browser permutation, name its cheaper owner and the
browser contract that remains. A prior regression or an existing test is evidence
to consider, not automatic permanent admission.

Chromium and WebKit both remain covered. Their native focus, selection and touch
differences are especially relevant here. Touch emulation cannot replace a device
check. Do not introduce an extended suite merely to park every removed duplicate;
keep it only for useful nonroutine coverage with a deliberate execution path.

Helpers currently share clock, viewport, clipboard and draft state. Keep their
order during this investigation. Filtering or parallelism needs explicit setup
and is a separate change. The under-60-second routine target does not justify
weakening these browser contracts.

## Fixture retirement - PR #48

`checkCandidates` now replays three fixtures per desktop engine instead of 14
(six instead of 28 fixture spans across Chromium and WebKit). This removes 11
permutations per engine, not any input, expectation, or core test. The full suite
still includes touch journeys and real downloads; no browser groups are filtered,
reordered, parallelized, or moved to another tier.

### Retained browser representatives

| Fixture                           | Browser proof                                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `e1-st-paul-houseparty-sanitized` | English source phrases in Start/End, selected date/time chips, title/location fields, unchanged Description, midnight End presentation. |
| `en-vague-evening-synthetic`      | Incomplete event keeps the actual Download .ics control disabled.                                                                       |
| `k1-wine-excerpt`                 | Korean source phrase in Start, selected date/time chips, title/location fields, unchanged Description, inferred End presentation.       |

Every retained iteration also checks four fieldsets, hint-to-options spacing
(at most 12px), and absence of raw internal warning tokens. Warning semantics
remain in the core fixture loop and focused parser tests; this DOM assertion
proves those tokens are not exposed verbatim. `checkTemporalParts` retains the
actual pairing-warning element assertion. Geometry and warning presentation are
sampled on the representatives rather than on every source permutation.

### Retired replay and functional-core owners

Every row remains an `accepted source fixture: <id>` case in `tests/parser.test.ts`.
That driver checks `preferred`, candidate inclusion/exact order where declared,
relationships, partial candidates, warnings, validation and evidence bounds.
The following focused tests supplement those fixture assertions. Prose-only JSON
properties remain review guidance, as documented in the fixture README.

| Retired fixture                    | Core contract and owner                                                                                                                                                                                             | Remaining browser proof                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2-workshop-times-only-sanitized` | Fixture loop: missing dates, partial clocks, related ranges, blocked export. Parser ownership/incomplete-evidence tests: a selected time cannot borrow a sibling date.                                              | Unchanged time-only selection, blocked Download .ics, compatible date completion and manual End in `checkCandidates`.                                                   |
| `e3-series-deadline-synthetic`     | Fixture loop: title, empty temporal candidates, blocked export. Parser date-policy test rejects deadlines/unrelated dates; `event-core.test.ts` separately checks the E3 calendar oracle.                           | Vague representative and inline validation retain incomplete-event export blocking.                                                                                     |
| `en-all-day-multiday-synthetic`    | Fixture loop: inclusive dates, all-day validation and exclusive ICS End. `event-core.test.ts`: inclusive single/multiday bounds and normalized exports.                                                             | `checkAllDay` and inline relative/all-day checks retain controls and export wiring.                                                                                     |
| `en-dst-fall-back-synthetic`       | Fixture loop: preferred values, zone, ambiguous offsets and blocked export before choice. `event-core.test.ts`: independent overlap choices and instant ordering.                                                   | Unchanged inline zone/offset radio selection checks both Google intervals and export gating.                                                                            |
| `en-dst-spring-gap-synthetic`      | Fixture loop: preferred values, zone and blocked export. `event-core.test.ts` and `english-dates.test.ts`: gap rejection without shifting.                                                                          | `inline-dst-gap-reset` retains disabled Download .ics, visible DST error and Reset.                                                                                     |
| `en-next-friday-synthetic`         | Fixture loop and parser date-policy cases: next-Friday resolution with explicit reference context, including year boundaries.                                                                                       | English representative plus `checkEnglishDates` retain phrase-to-chip presentation.                                                                                     |
| `k2-milonga-excerpt`               | Fixture loop: preferred fields, ordered alternatives, related lesson/social ranges and warnings. Focused parser activity-selection test: inferred lesson End, evidence, sibling preservation, reset and Google/ICS. | K1 retains Korean presentation; unchanged K3 interactions retain independent Start/End selection, Auto reset and real export.                                           |
| `k3-slow-saturday-synthetic`       | Fixture loop: preferred values, alternative dates/times, related ranges and excluded boundary. Parser ownership test: selected Start preserves End and reset follows the selected activity.                         | This same source is still loaded after the representative loop for tooltip, chip clicks, ownership, Google URL and real ICS download; `checkSlowSaturday` also remains. |
| `k4-blues-jam-sanitized`           | Fixture loop: preferred title/start/end/location, ordered de-duplicated Start and related ranges. Parser numeric-date tests supplement format/noise cases.                                                          | Korean representative, `checkNumericDateReports` and `checkRhythmParty` retain source-to-controls integration.                                                          |
| `ko-numeric-noise-synthetic`       | Fixture loop: preferred title/Start. Parser date-policy and numeric-noise tests reject unrelated numeric tokens.                                                                                                    | K1 and numeric-date journeys retain Korean controls; numeric exclusion semantics belong to core tests.                                                                  |
| `ko-tomorrow-synthetic`            | Fixture loop: preferred title/Start and candidate values. Parser date-policy tests retain Korean relative dates and source-zone context.                                                                            | K1 retains Korean presentation; relative-date journeys remain in `checkEnglishDates` and inline checks.                                                                 |

### State and coverage boundaries

The three representatives retain their original relative execution order. The
clock is installed before replay, set from each retained fixture's context, and
explicitly restored to `2026-10-24T03:00:00Z` before the remaining candidate
interactions. That is the final reference instant left by the old 14-fixture loop;
subsequent helpers share it. Viewport, reset order and all interactions after the
loop remain intact, including debounce ownership, clearing, stale/new-draft
invalidation, partial completion, Google URL checks and actual ICS downloads.

Accepted reduction: these 11 inputs no longer each prove their preferred values,
raw Description, fieldset/option geometry, internal-warning-token suppression or
export gating through the browser loop. The retained representatives and named
interaction journeys cover those browser boundaries; the complete source/value
matrix belongs to Vitest. Core evidence bounds do not prove exact source slices
unless a focused test asserts them. The fixture documentation's missing E4
contradictory-date example remains a gap. No physical-device, OS clipboard
permission, live Form-service or saved Google Calendar-event proof is added.

See [the retirement measurements](FIXTURE-RETIREMENT.md) for comparable full-run
wall times, engine times, counts and verification. The under-60-second routine
browser target remains separate follow-up work.

## Selection setup timing

[PR #49's setup measurements and retained timing contracts](SELECTION-SETUP.md)
cover the immediate paste-input preparation in `checkSelectionActions`. Its
activation matrix and all assertions remain. Ordinary debounced Manual-field
reparses remain for both fields in every engine/mode; the remaining preparation
uses the real immediate input handler without whole-draft clipboard replacement.
