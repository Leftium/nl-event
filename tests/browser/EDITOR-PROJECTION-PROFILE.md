# Editor projection and evidence profiles - PR #56 / #57

The original PR #56 measurement-only investigation is retained below. The PR #57
follow-up implements shared validation for [#43](https://github.com/Leftium/nl-event/issues/43)
and [#45](https://github.com/Leftium/nl-event/issues/45).

## Shared validation follow-up - PR #57

`EventCore.editorProjection(draft)` validates once, then derives Start/End date
and time options and duration values/options from that result. The page consumes
one Svelte `$derived` projection, including its validation for errors and exports.
Highlights, labels and chips read the same four option arrays. No persistent or
global cache is involved; the pure call receives the current draft, including
its injected context, selections, ownership and revisions. Existing public
`validate`, `temporalParts`, `temporalOptions`, `durationValue` and
`durationOptions` APIs retain their behavior. Partial candidate selections still
override normalized temporal parts before reading validation.

The fresh before/after runs on 2026-10-28 (Seoul) used the unchanged PR #56 harness:
Chromium 156.0.8078.4 and WebKit 27.2 on Apple M4, 10 logical CPUs, 16 GiB,
Darwin 24.6.0 arm64, Node 24.16.0, Vite 8.3.5, Svelte 5.57.2, ReScript 12.3.1
and Playwright 1.64.1. Each run retained 660 stages with no dropped spans or page
errors. Conditions were identical: short/long inputs of 108/6,739 UTF-16 units,
1280x900 viewport, Asia/Seoul zone, fixed Date, two warmup journeys then five
retained journeys per size and mode. Mode order was normal, disabled, enabled;
baseline ran first. No tests/builds ran during measurement.

Manual freeform Start (`December 19 2026 at 6pm`), before / after medians in ms:

| Engine / input | Parser calls | validate / validateBase | Disjoint instrumented work | Normal wall latency | Normal wall range         |
| -------------- | ------------ | ----------------------- | -------------------------- | ------------------- | ------------------------- |
| Chromium short | 15 / 1       | 15 / 15 -> 1 / 1        | 32.0 / 6.2                 | 62.24 / 43.94       | 61.24-63.35 / 29.87-46.19 |
| Chromium long  | 15 / 1       | 15 / 15 -> 1 / 1        | 28.6 / 6.6                 | 62.94 / 43.01       | 61.22-63.04 / 29.81-45.54 |
| WebKit short   | 15 / 1       | 15 / 15 -> 1 / 1        | 29.0 / 5.0                 | 63.16 / 31.47       | 62.04-63.28 / 29.44-46.05 |
| WebKit long    | 15 / 1       | 15 / 15 -> 1 / 1        | 22.0 / 6.0                 | 62.96 / 30.26       | 61.00-70.95 / 29.95-46.48 |

Counts are exact in every retained sample in both engines and sizes. Manual
Title/canonical Start validations also fall from 15 to 1, with zero parser calls.
Description paste/keypress (pending plus settled) validations fall from 26 to 2;
the one Description parser call is unchanged. Each ordinary Manual edit builds
four option arrays once rather than twelve times. Hover, focus and idle still
perform no validation or parsing; mirror update counts are unchanged.

Overhead controls, freeform Start wall medians (before / after, ms):

| Engine / input | Collection disabled | Collection enabled |
| -------------- | ------------------- | ------------------ |
| Chromium short | 61.23 / 29.71       | 70.69 / 43.00      |
| Chromium long  | 62.75 / 44.19       | 59.12 / 45.01      |
| WebKit short   | 62.05 / 31.03       | 58.21 / 29.76      |
| WebKit long    | 62.95 / 30.55       | 45.67 / 29.46      |

Both measured synchronous work and normal, unprofiled interaction latency
improve for this warmed development scenario. This supports the narrow reuse
change beyond its lower call counts. It does not establish a precise percentage
speedup or a production/mobile guarantee. Wall latency includes Playwright and
two frame waits; the after samples split around 30 and 45ms, so scheduling and
frame boundaries materially affect the medians. Five samples in fixed mode and
before/after order do not control all JIT, GC or system noise. Disabled/enabled
controls are not interchangeable with normal source, and WebKit has coarser
timer resolution. Inclusive parser/validation spans overlap; they are never
summed as savings. Evidence hover timings vary (for example Chromium long
1.8 / 3.1ms); this change makes no evidence rendering performance claim.

The opt-in plugin now instruments `editorProjection` and its shared helpers.
`projection.editor` contains the actual derivation; highlights/labels/chips and
duration page spans now measure property reads, not option construction. Original
public wrappers remain instrumented for other callers. Core hooks still avoid
extra draft property reads. Missing anchors fail explicitly, and the tooling
test compiles the transformed real Svelte page and checks generated helper
anchors. Production remains free of profiling transforms.

[Raw before/after runs, source hashes, summaries and verification logs](profile-data/shared-validation-2026-10-28/)
are retained. The baseline records HEAD `538c5d5`, whose complete source tree is
identical to PR #57 bootstrap `2246bd1` (tree
`86010bf5f9d761495e7460e913c3220274d708bc`). The after run records the bootstrap
HEAD plus the uncommitted source identified by its SHA-256 hashes. Only the core,
page and profiling plugin hashes changed; parser, time interpretation, mirror,
harness, lockfile and compiler configuration hashes match.

Reproduce each phase using a new output filename with the appropriate source
checked out, outside other tests/builds:

```sh
pnpm profile:editor /tmp/shared-validation-before.json
pnpm profile:editor /tmp/shared-validation-after.json
pnpm profile:editor:report /tmp/shared-validation-before.json
pnpm profile:editor:report /tmp/shared-validation-after.json
```

Focused parity coverage compares all option properties, validation/errors,
duration values/options and Google/ICS outputs against the public APIs for
canonical/freeform Start and End, relative End/duration, date-only/time-only and
invalid input. Cases include partial selections, source pairing/spans, generated
choices, stale parse tickets/evidence, Manual/Auto changes, zone/context revision
changes, all-day overrides, DST gaps/folds and selected offsets. Existing browser
contracts exercise the page's Svelte invalidation and native editor behavior.

Verification passed: `pnpm test` (594 tests), `pnpm check`, `pnpm lint`,
`pnpm build`, both Knip audits (no findings), all 12 Node tooling tests
(including four editor profiler tests), and the complete `pnpm test:browser`
Chromium/WebKit matrix with no page errors. The production client bundle
contains no profiling hook strings. Build warnings remain the existing bundle
size and adapter-auto deployment-target notices.
[Independent review](profile-data/shared-validation-2026-10-28/independent-review.md)
found no blocking issues and reproduced the raw benchmark rows. One public
`validate` call can still normalize all-day inputs through two `validateBase`
calls; the timed freeform counts above do not describe that separate path.

## Original PR #56 investigation

This was a measurement-only investigation. Its tooling changes left application
source, debounce, validation, textarea handling, draft ownership and exports
unchanged. The findings below describe that baseline, before PR #57.

## Findings and recommendation

**Prioritize a narrow follow-up for repeated freeform field interpretation. Leave
evidence segmentation, full mirror replacement and canonical projections alone
for now.** There is no measured case here for a Worker or debounce change.

The accepted run on 2026-10-28 (Seoul) contains 660 retained stages and 175,686
completed application spans, with no dropped spans or page errors. The synthetic
English/Korean inputs contain 108/6,739 UTF-16 units (138/9,489 UTF-8 bytes).
Environment: Apple M4, 10 logical CPUs, 16 GiB, Darwin 24.6.0 arm64; Node 24.16.0,
Chromium 156.0.8078.4 and WebKit 27.2; Vite 8.3.5, Svelte 5.57.2,
ReScript 12.3.1 and Playwright 1.64.1. These are warmed Vite development results
on one desktop, not a production or mobile performance guarantee.

Median disjoint instrumented work per interaction, milliseconds (five samples):

| Trigger                              | Chromium short | Chromium long | WebKit short | WebKit long |
| ------------------------------------ | -------------: | ------------: | -----------: | ----------: |
| Single paste, through settled parse  |            9.9 |          18.4 |         10.0 |        16.0 |
| Real keypress, through settled parse |           25.3 |          38.8 |         26.0 |        40.0 |
| Settled idle frames                  |            0.0 |           0.0 |          0.0 |         0.0 |
| Manual Title                         |            8.0 |           7.6 |          8.0 |         8.0 |
| Manual canonical Start               |            6.6 |           7.0 |          6.0 |         6.0 |
| Manual freeform Start                |           30.3 |          31.1 |         30.0 |        27.0 |
| Evidence chip hover                  |            0.4 |           1.9 |          1.0 |         1.0 |
| Evidence chip keyboard focus         |            0.4 |           1.8 |          1.0 |         1.0 |
| Editor scroll handler                |            0.0 |           0.0 |          0.0 |         0.0 |
| Viewport resize                      |            0.6 |           0.8 |          1.0 |         2.0 |

Counts were identical across both engines, input sizes and all five repetitions:

| Trigger                                     | validate / validateBase | temporalOptions (highlight / label / chip) | durationValue / durationOptions | Parser.parse | Mirror updates |
| ------------------------------------------- | ----------------------: | ------------------------------------------ | ------------------------------- | -----------: | -------------: |
| Single paste or keypress, pending + settled |                 26 / 26 | 20 (4 / 8 / 8)                             | 2 / 2                           |            1 |              2 |
| Manual Title or canonical Start             |                 15 / 15 | 12 (4 / 4 / 4)                             | 1 / 1                           |            0 |              1 |
| Manual freeform Start                       |                 15 / 15 | 12 (4 / 4 / 4)                             | 1 / 1                           |           15 |              1 |
| Chip hover/focus                            |                   0 / 0 | 0                                          | 0 / 0                           |            0 |              1 |
| Idle, scroll or resize                      |                   0 / 0 | 0                                          | 0 / 0                           |            0 |              0 |

1. **Repeated freeform interpretation is the first optimization candidate.**
   `December 19 2026 at 6pm` is parsed 15 times through
   `temporalOptions -> temporalParts -> validate -> validateBase -> TimeInput.interpret`
   and the independent validation/duration projections. The 15 parser calls total
   median 24.8-25.1ms in Chromium and 21-25ms in WebKit, already included in the
   validation/projection totals above. A later PR can test sharing a validated
   result within a draft projection, with separate before/after behavior and
   production-mode measurements. The nested figures cannot be added into a
   savings estimate.
2. **Recommend no evidence rendering optimization for these inputs.** Ordinary
   long-input paste/keypress mirror synchronization costs 3.0-3.2ms in Chromium;
   hover/focus costs 1.7-1.8ms. Full segmentation/node creation/replacement costs
   only 0.1-0.4ms per ordinary interaction in Chromium (WebKit medians 0-1ms at
   coarser resolution). Segmentation itself rounds to zero. Geometry/layout is
   larger: Chromium reports 4 layouts/4.88ms for the long paste, 7/9.00ms for the
   keypress and 3/1.61ms for hover, overlapping JavaScript spans. This does not
   justify replacing the mirror or risking textarea behavior.
3. **Leave canonical repeated validation and normal source parsing alone for now.**
   Repetition is real but the canonical Manual edit has only 5-7ms of measured
   work, including mirror costs. Description parsing happens once per edit;
   long-source parser medians are 9.9ms for paste and 28.1ms for keypress in
   Chromium (9/29ms in WebKit). Capture production/lower-end evidence before
   proposing a parser execution change. Idle and presentation interactions do
   not continuously revalidate.

### Automation and overhead controls

Multiline Playwright `fill` emitted 9 input events for the short announcement and
169 for the long one, causing 10/170 mirror updates and 114/1,874 validations.
That explains the alarming long-fill geometry result: 173ms in Chromium mirror
synchronization and 342 layouts/180ms browser layout. A single paste emits one
input and causes two mirror updates. Do not treat the fill result as a native
paste bottleneck.

Median wall latency controls below are milliseconds; they include browser
automation and scheduling, and do not establish a speedup:

| Long-input stage      | Engine   | Normal | Disabled collection | Enabled |
| --------------------- | -------- | -----: | ------------------: | ------: |
| Single paste          | Chromium |  44.47 |               44.42 |   54.95 |
| Single paste          | WebKit   |  45.40 |               45.73 |   55.48 |
| Manual freeform Start | Chromium |  62.90 |               61.75 |   58.39 |
| Manual freeform Start | WebKit   |  61.74 |               62.34 |   59.62 |
| Multiline fill        | Chromium | 367.35 |              367.24 |  367.85 |
| Multiline fill        | WebKit   | 287.54 |              287.54 |  543.22 |

Empty-loop medians for 10,000 calls were 0.1/0.2/1.2ms
(plain/disabled/enabled) in Chromium and 0/0/1ms in WebKit, over three repetitions.
This calibration does not reproduce transformed application work, allocation,
GC or JIT effects. Enabled long WebKit fill has a large perturbation; its timing
is unsuitable for optimization sizing. Counts and nesting are stronger evidence
than small control differences. Enabled real keypress wall latency was about
297-317ms, including the existing 250ms debounce.

## Reproduce

```sh
pnpm profile:editor /tmp/editor-profile.json
pnpm profile:editor:report /tmp/editor-profile.json > /tmp/editor-summary.json
node --test tests/editor-profile.test.mjs
```

The output path must be new. The harness compiles ReScript, starts and closes its
own Vite dev server on port 5174, and retains failed/partial results. Keep that
port free and avoid running tests/builds during measurement. This is an optional
investigation command, outside the mandatory browser matrix.

The Vite plugin transforms only an explicitly enabled dev server
(`NL_EVENT_EDITOR_PROFILE=1`). Default dev runs return the original source;
production builds never apply the plugin. Hooks are inserted in memory into the
page call sites, generated ReScript functions and Description editor functions.
Generated files are not rewritten. Missing function/call-site anchors fail
explicitly. A page without a collector uses synchronous pass-through hooks.

## Method and interpretation

Each mode uses fresh browser contexts in Chromium and WebKit, a 1280x900 viewport
and Asia/Seoul time zone. Date is fixed to 2026-10-24; the profiler binds
`performance.now`, and the command uses Node's monotonic `performance.now`.
Each input size has two full warmup journeys followed by five retained journeys.
Fonts are ready before measurement. The fixed mode order is normal source,
transformed source with collection disabled, then collection enabled. Dependency
optimization is excluded by warmup; server startup is outside the stage spans.
The fill stage adds a newline and 3-7 spaces in retained samples; paste restores
the base text and the real keypress adds one space. Input records retain exact
lengths for every event.

Every stage records wall latency, input-event count/type/UTF-16 length and
completed synchronous spans. Parser/interpretation spans also record their
actual string length; mirror spans record Description length. Core hooks do not
read extra draft properties, which could change Svelte's dependency tracking.
The collector retains no source text, caps each stage at 100,000 spans, and fails
the harness if records were dropped. Context teardown removes the collector and
its observational input listener.

Inclusive spans overlap their descendants. `selfMs` subtracts measured direct
children only; it includes unmeasured work and profiler bookkeeping. Summed
parentless spans are disjoint **instrumented synchronous work**, not total main
thread CPU. Segmentation sits inside node mapping, which sits inside
`replaceChildren`; their inclusive times must not be added. Mirror geometry and
style synchronization can force layout. Chromium's CDP layout/style duration and
count deltas provide a browser-level cross-check, overlapping the JavaScript
spans. Raster/GPU paint time is not measured, and WebKit has no equivalent CDP
counter in this harness.

Stage wall times include Playwright IPC/actionability, assertions, frame waits
and, for a real Description keypress, the unchanged 250ms parse debounce. They
are interaction latency rather than parser CPU. Normal/disabled/enabled controls
and an empty-span loop expose overhead; five samples in fixed order cannot
establish a precise speedup. Timer quantization particularly limits submillisecond
WebKit measurements. Do not subtract calibration mechanically from nested spans.

The journeys include multiline Playwright `fill`, a single synthetic
`insertFromPaste` input using the existing immediate parse path, a real keyboard
space followed by settled parsing, idle frames, Manual title/canonical/freeform
Start edits, source-chip hover/keyboard focus, editor scroll and viewport resize.
The paste setup exercises the application's input path, not OS clipboard access.
Scroll sets `scrollTop` and dispatches a scroll event; short input can execute the
handler without moving. Chip hover/focus does not benchmark textarea character
hit-testing. Existing browser contracts cover native interactions separately.

## Evidence and verification

[Raw runs, derived metrics, attempts and verification logs](profile-data/editor-2026-10-28/)
include the accepted `final3.json.gz`, its source hashes and `summary.json`.
The accepted run used base `0a18816527187b28e66bbf34e531ce5bf1132026` plus the
uncommitted tooling identified by those hashes. Earlier attempts are retained and
excluded: two warmup selector/assertion mistakes, one diagnostic run with a Vite
restart, a run whose calibration used the clock-replaced timer, and a run with previous-text
length metadata for editor updates. Final spans
and calibration both use the captured clock; no fake-time advancement is used.

Passed: `pnpm test` (578 tests), `pnpm check`, `pnpm lint`, `pnpm build`,
`pnpm audit:knip`, `pnpm audit:knip:production`, the complete `pnpm test:browser`
(Chromium and WebKit), and 11 Node tooling tests including three profiler tests.
Both Knip reports contain no findings. The production client bundle contains no
profiling hook strings. Browser contracts retain native selection/focus, editor
IME/fullscreen/scroll behavior, ownership/reset and Google/ICS export parity;
the opt-in journeys passed their Description and source-highlight assertions.
Independent agent review accepted the corrected tooling and evidence with no
blocking findings; its [acceptance record](profile-data/editor-2026-10-28/independent-review.md)
includes the size-attribution correction and review limits.
