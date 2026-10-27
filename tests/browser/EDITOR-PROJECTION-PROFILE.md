# Editor projection and evidence profile - PR #56

This is a measurement-only investigation for [#43](https://github.com/Leftium/nl-event/issues/43)
and [#45](https://github.com/Leftium/nl-event/issues/45). The implementation changes
tooling only. Application source, debounce, validation, textarea handling, draft
ownership and exports remain unchanged.

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
