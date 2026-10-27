# Browser runtime profile - PR #46

Measured on 2026-10-27 for [#41](https://github.com/Leftium/nl-event/issues/41).
This PR adds observation only: no selection, ordering, assertion, timeout, fixture,
product behavior or browser coverage was removed or optimized.

## Results

| Run                | External command wall (s) | Profile wrapper wall (s) |  Compile (s) | Browser runner process (s) | Outcome             |
| ------------------ | ------------------------: | -----------------------: | -----------: | -------------------------: | ------------------- |
| Untouched baseline |                   129.369 |         not instrumented | not isolated |               not isolated | Both engines passed |
| Instrumented 1     |                   124.642 |                  124.574 |        0.059 |                    124.503 | Both engines passed |
| Instrumented 2     |                   124.575 |                  124.496 |        0.062 |                    124.421 | Both engines passed |

External wall uses Python `time.perf_counter()` around the complete `pnpm`
invocation, including frontend startup and shutdown. Wrapper wall uses Node
`process.hrtime.bigint()` from wrapper initialization through runner completion;
it excludes pnpm frontend startup, initial Node module loading, and final output
printing. Compilation and the browser subprocess are separate children of that
wrapper span. The unchanged baseline uses `pnpm test:browser`; instrumented runs
use `pnpm test:browser:profile <new-output-path>`.

The roughly 4.7-second difference from baseline is **not an optimization result**.
The baseline was the first real browser run after server/dependency startup;
instrumented runs reused its warmed Vite dependency/server state. Instrumentation
also has overhead. These samples describe costs and repeatability, not a precise
overhead estimate, speedup or long-term flake rate.

### Engine and mode blocks

| Block                           | Instrumented 1 (s) | Instrumented 2 (s) |
| ------------------------------- | -----------------: | -----------------: |
| Chromium, entire engine         |             64.625 |             64.861 |
| Chromium desktop, inside engine |             46.715 |             47.095 |
| Chromium touch, inside engine   |             16.485 |             16.148 |
| WebKit, entire engine           |             59.718 |             59.408 |
| WebKit desktop, inside engine   |             45.535 |             45.317 |
| WebKit touch, inside engine     |             12.135 |             12.018 |

Engines execute sequentially. Each engine includes launch, four fresh
initial-focus journeys, desktop, touch and close. Desktop and touch do not include
the fresh initial-focus journeys. Engine and mode rows overlap: do not add them.

### Largest journey groups

These sums combine the same named helper across its existing engine/mode calls.
The listed helpers are separate sequential groups; their nested operations are
already included. The fixture row is a child of `checkCandidates`.

| Group                                               | Instrumented 1 (s) | Instrumented 2 (s) | Interpretation                                                    |
| --------------------------------------------------- | -----------------: | -----------------: | ----------------------------------------------------------------- |
| `checkSelectionActions`                             |             24.842 |             25.096 | Native selection/activation matrix and replacement invalidation   |
| `checkCandidates`                                   |             13.358 |             13.280 | Fixture replay plus unique chip/ownership/reset/race interactions |
| All 28 fixture executions, inside `checkCandidates` |              9.139 |              9.212 | Fourteen fixtures per desktop engine                              |
| `checkOvernightExport`                              |              7.483 |              7.434 | Desktop/touch checkbox/help/export journeys                       |
| `checkCompactDates`                                 |              6.823 |              6.865 | Count boundaries, expansion, source/focus behavior                |
| `checkDescriptionReviewRegressions`                 |              6.283 |              6.215 | Confirmation and import lifecycle regressions                     |
| `checkEvidenceHighlights`                           |              5.848 |              5.682 | DOM evidence, tooltip/focus and scrolling                         |
| `checkCalendarDescription`                          |              5.748 |              5.697 | Metadata/import/copy/export wiring and races                      |

The expensive selection matrix has meaningful browser value. Cost alone is not
a deletion recommendation. The [coverage inventory](COVERAGE.md) identifies the
pure and browser-specific contracts inside each group.

### Operations and waits

| Observed operation              | Count per valid run | Instrumented 1 (s) | Instrumented 2 (s) |
| ------------------------------- | ------------------: | -----------------: | -----------------: |
| Engine launch                   |                   2 |              0.238 |              0.325 |
| Context/page creation API calls |                  24 |              1.045 |              1.083 |
| `goto` navigation               |                  12 |              0.181 |              0.202 |
| Parse-status predicates         |                 178 |             45.913 |             46.113 |
| Other DOM predicates            |                 194 |             10.082 |             10.310 |
| Locator `waitFor`               |                 244 |             10.610 |             10.459 |
| Download event waits            |                  78 |              3.125 |              2.954 |
| Explicit 350 ms sleeps          |                   4 |              1.408 |              1.408 |
| Measured locator actions        |               1,514 |             44.251 |             43.914 |
| Screenshots                     |                  32 |              1.058 |              1.038 |

These are **inclusive observations, not additive attribution buckets**. In
particular, download waits can overlap click actions, and every operation also
overlaps its fixture/helper/mode/engine ancestors. Actions include Playwright
actionability/scrolling and effects completed before the API returns. Predicates
include polling, application work, rendering and any remaining debounce delay;
they are not isolated parser CPU measurements. Only predicates whose function
source mentions `#parse-status` are labeled parse-status; other waits can also
include parsing. Context and page creation are measured as public API boundaries,
not an internal browser-process startup decomposition.

Selection journeys alone contain 68 parse-status waits totaling 18.758/18.972 s.
The production input handler schedules normal Description parsing after 250 ms.
Repeatedly waiting for that path during selection setup is a stronger follow-up
candidate than startup or screenshots. A microtask deferral does not move parsing
off the browser main thread, but this profile does not establish a parser CPU
bottleneck.

## Recommended next PR

First investigate **selection-journey setup**, preserving the native mouse,
keyboard, touch, fullscreen, focus and replacement matrix. Use the existing
immediate paste-input path for setup that is not proving typing/debounce, while
retaining explicit real-typing, ownership and stale/debounce proofs. Do not use
whole-draft clipboard replacement where it would reset Manual fields. A direct
paste input and ordinary typing have different timing contracts; name the
retained typing cases before changing setup.

There is a 17-second nominal timer budget across 68 waits (`68 * 250 ms`), within
the observed 18.8-19.0-second wait component. That is an opportunity ceiling,
not a promised wall-time saving: not every wait begins at timer scheduling, and
replacement setup, rendering and polling still cost time. Measure a focused
before/after implementation before assigning a gain. No product debounce change,
fake parser output, Worker, runner migration or browser parallelism is needed for
this experiment.

A subsequent bounded retirement candidate is the complete 14-fixture browser
replay. Keeping the existing English E1, Korean K1 and vague-English blocked
fixture, while removing the other 11 from both engines, would omit disjoint
fixture spans totaling **7.175/7.247 s** in these runs. About seven seconds is a
defensible initial estimate for that exact selection change, before any added
representative checks. It is not the whole 13.3-second `checkCandidates` cost.
Keep its interactive candidate/race checks and explicitly retain the DOM
contracts currently spread across omitted fixtures. All 14 pure fixtures remain
in Vitest.

Repeated parser/date/serialization assertions inside overnight/spaced-clock and
numeric-date journeys are further candidates, but this profile does not isolate
their removable subcases well enough to estimate savings. Preserve real
downloads and the distinct controls/help/ownership paths. Pure compaction logic
is still in Svelte, so shrinking its count-boundary sweep needs a coverage owner,
not an assumption that Vitest already proves it.

Making success screenshots optional has an observed maximum direct capture saving
of only about one second. Launch and navigation are also small. Leave them alone
in the next PR. Do not move useful tests into an extended suite just to lower the
routine count.

## Environment and retained attempts

- Apple M4, Mac16,10, 10 logical CPUs, 16 GiB RAM, macOS 15.8.1 / Darwin 24.6.0,
  arm64.
- Node 24.16.0, pnpm 12.5.1, Playwright 1.64.1, Vite 8.3.5. Launched browser
  versions: Chromium 156.0.8078.4, WebKit 27.2.
- Agent-started `pnpm dev` server at `http://localhost:5173/`, retained across all
  runs. Initial ReScript compilation and server startup are outside command
  timing. No server was silently reused or swapped; no product source changed.
- Base source: `d8eaa06`; Continuum bootstrap commit:
  `d78133640ed35e7bad1f9e30263ad4e3c2880f00`. Profile headers record that commit
  and the uncommitted harness state. [Source hashes](profile-data/2026-10-27/measured-source-sha256.json)
  identify the measured launcher/runner/profiler and unchanged imported checks.

The [evidence directory](profile-data/2026-10-27/) contains external wall records,
logs, compact derived metrics, and losslessly gzipped raw JSONL. Each valid run
contains 2,435 completed spans, 28 fixtures, 32 screenshots, the same operation
counts, zero failed spans and both engine PASS messages. Failed evidence is kept:

| Attempt              | Result / reason                                                                                                            | Treatment                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `baseline-attempt-1` | 0.253 s, missing Chromium executable, exit 1                                                                               | Setup failure; not a runtime baseline                                                                         |
| `baseline-attempt-2` | 0.296 s, launch attempted before browser installation finished, exit 1                                                     | Setup failure; not a runtime baseline                                                                         |
| `run-1`              | Both browser engines passed; launcher overwrote some JSONL records                                                         | Profiling writer defect; raw corrupt artifact/log retained, excluded from timing conclusions                  |
| `run-2`              | Stopped deliberately after 56.525 s when the same writer defect was identified; browser teardown produced an error; exit 1 | Interrupted investigation, not a product regression or a valid full sample; partial raw artifact/log retained |

The writer now uses exclusive append mode in both processes. A focused regression
test verifies interleaved child/launcher output, refusal to overwrite existing
reports, and compile failure exit propagation. The baseline plus `profile-1` and
`profile-2` are the three valid full-suite samples; failed investigations are not
quietly substituted into them. No retries, skips or timeout increases were added.

## Reproduce and interpret

Start the existing development server and confirm its URL before measuring:

```sh
pnpm dev
```

In another terminal, use a new output path for each run:

```sh
NL_EVENT_PROFILE_SERVER='pnpm dev on 5173; describe warm/cold state' \
  pnpm test:browser:profile /tmp/nl-event-profile.jsonl
node scripts/report-browser-profile.mjs /tmp/nl-event-profile.jsonl > /tmp/nl-event-summary.json
node scripts/report-browser-profile.mjs tests/browser/profile-data/2026-10-27/profile-1.jsonl.gz > /tmp/nl-event-recorded-summary.json
node --test tests/browser-profile.test.mjs
```

The profile command compiles ReScript and executes the same smoke entrypoint.
Normal `pnpm test:browser` retains its command, coverage and order; profiling
hooks, clock reads and JSONL writes are disabled there. The small `measure`
pass-through returns the original promise without another async boundary.

The launcher refuses an existing filename, writes environment and stage records,
and propagates child failure status. The browser profiler records starts and
completions, emits uncaught errors without swallowing them, and finalizes open
scopes on ordinary failure/exit. Hard termination can leave starts without
completions; an interrupted final JSONL record is reported, while malformed
interior records cause an error. Reporter output retains failed and unfinished
spans. It does not turn a partial profile into a successful run.

All recorded times are relative to one monotonic origin shared by the launcher
and its Node child. Each span has `id`, `parentId`, category, start/end and status.
The reporter's `uncoveredMs` subtracts the **union of completed direct-child
intervals**, clipped to the parent. For a 100 ms parent with children at 10-70 ms
and 40-90 ms, the uncovered time is 20 ms, not -10 ms. Grandchildren already fall
inside their parent and are not subtracted again. Uncovered time is time outside
recorded children, not CPU self-time; incomplete children limit its interpretation.

## Verification boundary

The untouched baseline and both valid instrumented suites passed Chromium and
WebKit, including touch and actual downloads. A syntax-tree comparison preserved
all 514 assertion sites, all 38 check calls in order, and both explicit sleep
sites in `browser-smoke.mjs`; imported browser checks are unchanged. Focused Node
tests cover disabled passthrough, overlap accounting, truncated records, failure
finalization and writer integrity. Formatting/lint validation is recorded in the
PR. No product code, shared typing or build configuration changed, so no
production build or unrelated unit matrix was needed for this harness-only PR.
