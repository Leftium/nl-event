# Browser engine selection - PR #50

The routine Chromium command meets the under-60-second browser target in this
warm-server sample, with the complete Chromium engine block retained.

## Commands and policy

- `pnpm test:browser:chromium`: every Chromium scenario, for routine UI changes.
- `pnpm test:browser:webkit`: every WebKit scenario.
- `pnpm test:browser`: Chromium followed by WebKit, as before.

The runner and profiler use `scripts/browser-engines.mjs` to validate
`NL_EVENT_BROWSER_ENGINE`. Unset or `both` selects both engines; `chromium` and
`webkit` select one. Empty, misspelled, list, whitespace-padded, and unsupported
values throw before browser launch. Named commands set the selector explicitly.
There are no scenario filters or alternative scenario implementations.

For profiling, use a new output path:

```sh
NL_EVENT_BROWSER_ENGINE=chromium pnpm test:browser:profile /tmp/chromium.jsonl
NL_EVENT_BROWSER_ENGINE=webkit pnpm test:browser:profile /tmp/webkit.jsonl
pnpm test:browser:profile /tmp/both.jsonl
```

Profiles record the requested `selectedEngines`; existing browser launch records
identify actual engine/version/executable and engine spans record completion.
A selected engine is not evidence of successful completion on a failed run.

Use Chromium for routine UI changes, accepting the risk that WebKit-specific
regressions can escape that run. Run both engines for focus, native selection,
textarea/IME, touch, clipboard, browser-specific events, fullscreen, WebKit fixes,
and risky integrations. Run both before releases and at least weekly while UI
work is active. Choose by affected behavior and reviewer judgment.

Qualifying parser/domain-only changes can use `pnpm test` without browser work
when established functional-core tests prove their contract. Follow the
[fixture guide](../fixtures/nl-event/README.md#choosing-core-only-or-browser-verification)
and escalate changes affecting DOM, effects, or cross-cutting integration.

## Comparable measurements

External wall time surrounds each complete public `pnpm` command, including
ReScript compilation and process startup/shutdown, using Node's monotonic clock.
All commands ran sequentially against the same agent-started Vite development
server at `http://localhost:5173/`, after one excluded full-suite warmup
(99.933 s, passed). Existing profile hooks were enabled identically for all
three measured commands to prove scenario parity. These are actual standalone
command measurements, not estimates from an engine block inside the full suite.

| Public command               | External wall (s) | Result              |
| ---------------------------- | ----------------: | ------------------- |
| `pnpm test:browser:chromium` |            52.169 | Chromium passed     |
| `pnpm test:browser:webkit`   |            47.396 | WebKit passed       |
| `pnpm test:browser`          |           100.246 | Both engines passed |

Chromium has 7.831 s of margin below 60 s in this sample. This establishes the
routine target on the measured hardware/server conditions; one sample per
selection does not establish a universal time bound or flake rate. Full regression
coverage remains available and takes about 100 s. No coverage was retired,
parallelized, retried, split into groups, or given longer timeouts. No production
code changed.

Environment: Apple M4, macOS Darwin 24.6.0 arm64, Node v24.16.0, Playwright 1.64.1.
Raw launch records retain browser versions and executable paths. The same binaries,
dependencies, and warmed server process served all samples.

## Coverage and verification evidence

The only runner control-flow change replaces the fixed two-engine list with the
validated names. The complete engine body is unchanged. Four fresh-focus contexts,
hydration, desktop/touch, native selection, clipboard races and actual downloads
remain in each selected engine, including existing engine-specific branches.

`compare.py` checks passed/completed spans and browser exit status, reconstructs
engine/mode/scenario/fixture ancestry, then compares ordered records for each
standalone engine against its full-suite block. Both match exactly: per engine,
52 scenario records, three fixture records, two mode records, and one engine
record (58 total). Full engine order remains Chromium then WebKit. This proves
recorded journey parity; the unchanged scenario source retains the assertions
inside those journeys.

Verification passed: 573 Vitest tests, `pnpm check` (zero errors/warnings),
`pnpm lint`, and eight focused Node selector/profiler tests, including invalid
values through both entry points. The three public browser commands passed.
The profiler wrapper also passed with each single-engine selection (Chromium
52.983 s, WebKit 47.797 s external wall); each environment selection and actual
launch record matched.

Raw profiles, command wall times, logs, environment, measurement/comparison scripts,
and implementation source hashes are retained under
[profile-data/2026-10-27/engine-selection](profile-data/2026-10-27/engine-selection).
Run Node tooling tests separately from Vitest:

```sh
node --test tests/browser-engines.test.mjs tests/browser-profile.test.mjs
```
