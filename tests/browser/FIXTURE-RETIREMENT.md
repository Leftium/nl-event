# Browser fixture retirement - PR #48

Measured on 2026-10-27 for [#41](https://github.com/Leftium/nl-event/issues/41).
The full suite retains Chromium and WebKit desktop/touch journeys and real
Google-link/ICS download checks. Only the `checkCandidates` fixture replay is
contracted; see [the coverage map](COVERAGE.md#fixture-retirement---pr-48).

## Comparable wall time

The warm baseline took **124.500 s**. The two after runs averaged
**117.160 s**, an observed reduction of **7.340 s (5.90%)**.
Individual reductions were 6.849 s and 7.832 s.

| Run               | External wall (s) | Chromium (s) | WebKit (s) | Fixtures per engine | Result |
| ----------------- | ----------------: | -----------: | ---------: | ------------------: | ------ |
| Warmup (excluded) |           125.640 |       65.751 |     59.533 |                  14 | Passed |
| Warm before       |           124.500 |       64.852 |     59.316 |                  14 | Passed |
| Warm after 1      |           117.651 |       61.511 |     55.853 |                   3 | Passed |
| Warm after 2      |           116.668 |       60.631 |     55.713 |                   3 | Passed |

External wall is Python `time.perf_counter()` around the complete
`pnpm test:browser:profile <new-output-path>` subprocess, including pnpm startup,
ReScript compilation, the browser runner and shutdown. The existing profile
wrapper uses Node's monotonic clock; no browser clock is used for measurement.
Engines run sequentially. Engine/mode/helper/fixture spans are inclusive and must
not be added to their ancestors.

| Profile span                  | Warm before (s) | Warm after 1 (s) | Warm after 2 (s) |
| ----------------------------- | --------------: | ---------------: | ---------------: |
| Profile wrapper               |         124.424 |          117.579 |          116.589 |
| Compile                       |           0.081 |            0.046 |            0.079 |
| Browser runner                |         124.322 |          117.521 |          116.497 |
| checkCandidates, both engines |          13.295 |            5.941 |            6.044 |
| Fixture spans, both engines   |           9.254 |            1.945 |            1.977 |
| Chromium desktop              |          46.569 |           42.988 |           43.076 |
| Chromium touch                |          16.607 |           16.915 |           15.973 |
| WebKit desktop                |          45.164 |           41.499 |           41.286 |
| WebKit touch                  |          12.231 |           12.268 |           12.345 |

The retired baseline fixture spans total **7.294 s** across both engines.
That disjoint span sum is not the measured wall-time reduction. The observed
whole-command saving above also includes ordinary variation outside the loop.
This is one warm before sample and two warm after samples, not a statistical
performance guarantee or flake-rate estimate. The comparable 124.500 s baseline
agrees closely with PR #46's warm 124.575/124.642 s samples; the fresh same-session
baseline is the comparison used here. The full suite remains above 60 seconds;
no routine tier or sub-60-second result is claimed.

## Conditions and source identity

- Apple M4, 10 logical CPUs, 16 GiB RAM; macOS/Darwin 24.6.0 arm64.
- Node v24.16.0, pnpm 12.5.1, Playwright 1.64.1; Chromium 156.0.8078.4 and WebKit 27.2.
- Agent-started `pnpm exec vite dev --host 127.0.0.1 --port 5173 --strictPort`,
  reused for every sample. Runner base URL: `http://localhost:5173/`.
  Server startup is outside the command timing. One complete unchanged run
  warmed the server/dependencies; it is retained but excluded from the comparison.
- No tests/builds or other agent browser work ran concurrently with a profile.
  Core/check/lint ran between the before and after measurements. Independent
  review was read-only and ran during the after measurements.
- Baseline: clean PR head `931149e8b19e8bfb17be169e40eb8288f77fc716`.
  After runs: that same commit with the fixture-retirement test/documentation
  edits in the working tree. The environment records intentionally retain that
  pre-commit HEAD and the dirty-state listing. Both after runs use identical
  runner bytes, subsequently committed in this PR.
- Browser runner SHA-256 before: `9dbcbe4686789c8bd4577234dcca6e7e3d891be9eb5bbf57b921bff21ae8872c`.
- Browser runner SHA-256 after: `4fc0b8b93ecf83729643d2fd033af77900d3485a2ead886814dfddbe65b6b544`.

[Raw profiles, logs, external command timings, derived metrics and source hashes](profile-data/2026-10-27/fixture-retirement/)
are retained, including the excluded warmup. `measure.py` and `summarize.py`
preserve the exact external timing and aggregation code used for these samples;
their absolute paths refer to this run's temporary directory. Each `.jsonl.gz`
contains the unmodified existing profiler output. Metric fixture counts describe
profile spans inside the replay loop, not every later reuse of fixture text.

## Verification and remaining boundaries

- `pnpm test`: 12 files, 573 tests passed, including all 14 parser fixtures.
- `pnpm check`: zero errors and warnings.
- `pnpm lint`: passed.
- Both after full profiles passed Chromium and WebKit, including touch checks,
  actual ICS downloads, ownership/reset, stale parsing and later shared-state
  journeys. No retries or timeout increases were used.
- Independent agent static review found no actionable issues in the runner and
  coverage mapping, including the original relative fixture order and explicit
  restoration of the old final reference instant. A subsequent independent
  evidence audit recomputed the wall-time reduction, engine/fixture counts,
  retired spans and source hashes with no actionable findings. The reviewer did
  not run tests; server reuse and lack of concurrent workloads are session
  provenance rather than facts independently established by the profile data.

The accepted coverage reduction is per-input DOM replay for the 11 retired cases;
[the coverage map](COVERAGE.md#retired-replay-and-functional-core-owners) identifies
the core owners and retained browser proofs. No new semantic coverage gaps were
identified. Exact evidence slices still require focused assertions beyond generic
bounds, and the fixture README's missing E4 example remains unsupplied. Touch is
emulated; clipboard and Form requests are stubbed; Google checks prove generated
links rather than saved calendar events. Production code, debounce setup, runner
order and engine/mode selection remain unchanged. Incidental debounce waits in
selection setup belong to the next separate PR.
