# Selection setup runtime - PR #49

Selection preparation in `checkSelectionActions` now dispatches the existing
`insertFromPaste` input event instead of scheduling the ordinary 250 ms debounce.
It still runs the application's Description handler, extraction, completion and
rendering. The clipboard toolbar is deliberately avoided because whole-draft
replacement resets Manual fields.

## Coverage and timing contracts

Across both engines and desktop/touch, 60 input operations use the immediate
path: 24 initial selection-matrix preparations, 16 later reparses, eight cached
range preparations and 12 edit/reset/clipboard invalidation preparations.
All 68 existing selection parse-status predicates remain, including their polling
and timeout semantics. Immediate parsing still requires settlement before capture.

Eight ordinary debounced reparses remain: Title and Location, in each engine and
mode, after non-fullscreen mouse/touch activation. They prove selected Manual
values survive ordinary Description input and that Auto restores the new parsed
value. Other activation permutations prove the same ownership behavior after
immediate input. This is the intentional timing-coverage difference.

The actual `edit` invalidation and final whitespace input remain ordinary fills.
Mouse clicks, keyboard Tab/Enter, WebKit Alt+Tab, taps, fullscreen transitions,
focus transfer, body-style restoration, cached-offset rejection and reset/clipboard
invalidation keep their assertions. Runner order, clocks and production code are
unchanged. The separate `checkSelectedTitle` typing/Manual proof, initial-focus
real typing, editor native Enter/undo/redo/IME and ordinary-versus-paste timer
assertion, candidate debounce/Manual/stale-ticket proofs, and clipboard/import
race checks are unchanged. Synthetic paste setup does not claim trusted OS
clipboard coverage; touch remains browser emulation.

## Comparable measurements

| Metric (seconds unless count)         | Warm before | After 1 | After 2 |
| ------------------------------------- | ----------: | ------: | ------: |
| Total external command wall           |     117.488 |  99.296 | 100.508 |
| Chromium engine                       |      61.482 |  52.000 |  53.019 |
| WebKit engine                         |      55.672 |  47.017 |  47.143 |
| checkSelectionActions, all four calls |      25.016 |   7.166 |   7.415 |
| Selection parse-status wait count     |          68 |      68 |      68 |
| Selection parse-status wait duration  |      18.849 |   2.677 |   2.679 |
| Full-suite parse-status wait count    |         156 |     156 |     156 |
| Full-suite parse-status wait duration |      39.991 |  23.800 |  23.701 |

After command wall averages **99.902 s**, an observed **17.587 s (14.97%)**
reduction from the fresh 117.488 s baseline. The historical 117.16 s average is
context only. Selection actions average 7.291 s, down 17.725 s; their parse-status
waits average 2.678 s, down 16.172 s. These inclusive spans overlap their engine
and command parents. Wait durations include polling/rendering/application work;
they are not isolated parser CPU or timer measurements. Other operations also
vary, so the wait reduction is not an additive wall-time attribution.

Every run passed both engines, with 104 scenario spans, six fixture spans, 32
screenshots, four modes, 676 wait spans, zero failed spans and no unfinished
spans. Parse-status counts remain 156 overall and 68 in selection. Measured
locator actions fall from 1,470 to 1,410 because 60 fills become evaluations;
evaluations are not instrumented action spans. Assertions were not removed.

## Conditions, evidence and validation

- Same agent-started Vite 8.3.5 server at `127.0.0.1:5173`, runner URL
  `http://localhost:5173/`, reused for all four runs. Startup is outside timing.
- One complete unchanged warmup passed in 119.038 s and is excluded from the
  comparison. Then one warm before and two warm after samples ran sequentially.
  No other tests/builds or browser work ran concurrently with these profiles.
- External Python `time.perf_counter()` surrounds the complete pnpm invocation,
  including compilation and process startup/shutdown, as in PR #48. The existing
  PR #46 profiler supplies engine/helper/wait spans without runner changes.
- Apple M4, 10 logical CPUs, 16 GiB RAM; Darwin 24.6.0 arm64; Node v24.16.0,
  pnpm 12.5.1, Playwright 1.64.1; Chromium 156.0.8078.4, WebKit 27.2.
- Baseline HEAD: `d68e0f128e014f39dc54951d92783e7080b63c5c`. After profiles use
  the same HEAD plus the runner edit. Both after samples use identical runner
  bytes. Profile headers preserve the original working-tree state; documentation
  was added during measurement without changing the runner or production code.
- `pnpm test`: 12 files and 573 tests passed. `pnpm check`: zero errors/warnings.
  `pnpm lint`: passed after formatting. Both after full browser profiles passed,
  including touch, actual downloads and later shared-state journeys. No retries,
  skips, timeout increases, clock changes or runner reordering were added.

[Evidence directory](profile-data/2026-10-27/selection-setup/) retains all four
losslessly compressed raw profiles, logs, external wall records, derived metrics,
source hashes and measurement scripts, plus unit/check/lint output. The manifest
identifies measured runner bytes and unchanged imported browser/profiling files.
One warm baseline and two after samples establish the observed local change,
not a statistical performance guarantee or a long-term flake-rate estimate.

## Reproduce

Start `pnpm exec vite dev --host 127.0.0.1 --port 5173 --strictPort` once. Run the
retained `measure.py` with a fresh label to time the complete
`pnpm test:browser:profile <output>` command externally. Its output directory is
the original session's `/tmp/nl-event-pr49`; change that path when reproducing.
Run `summarize.py` beside the resulting profiles and command records to aggregate
the spans; it accepts the original JSONL, so decompress retained `.jsonl.gz` first.
