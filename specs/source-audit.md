# Advisory source audit

Adopt Knip 6.43.0 for import/export and dependency triage. Defer Fallow after
the bounded pilot below. These tools do not authorize deletion, and no audit
is part of tests, builds, CI, or deployment. This implements the pilot in
[#42](https://github.com/Leftium/nl-event/issues/42); cleanup needs a separate PR.

## Running Knip

Use Node 24 and `pnpm install --frozen-lockfile`, then run both views:

```sh
pnpm audit:knip
pnpm audit:knip:production
```

Each command compiles ReScript and synchronizes SvelteKit before analysis, so a
clean checkout needs no checked-in generated output. Findings exit zero through
Knip's `--no-exit-code`; invalid configuration and other execution errors still
exit nonzero. Do not use `--fix`. Run these commands after import/export,
dependency, route, or ReScript FFI changes, and compare the reports manually.
They are optional, with no required clean baseline.

For machine-readable output after those prerequisites:

```sh
pnpm exec knip --no-gitignore --no-exit-code --reporter json
pnpm exec knip --no-gitignore --no-exit-code --production --reporter json
```

Normal mode includes test and tooling consumers. Production mode excludes those
roots; an export reported only there may have deliberate test/API intent.
Neither view measures bundle size, runtime loading cost, or native `.res`
dead code. Use ReScript diagnostics and source review for the latter.

## Graph validation

Measured on 2026-10-28 against bootstrap head `908de109` plus this pilot, with
Knip 6.43.0 and Fallow 3.36.0. No application sources or dependencies were removed.

The SvelteKit plugin discovers routes from the `sveltekit()` call in
`vite.config.ts`, including `+page.svelte`, `+layout.svelte`, and
`api/form-meta/+server.ts`. Vitest discovers `tests/**/*.test.ts`.
`knip.jsonc` adds the standalone Node test files, profile report CLI, and archived
measurement script as development roots. It does not declare every library or
adapter an entry. Existing package scripts discover browser tools and their
imports. CSS usage in the layout keeps Nimble.css reachable.

The critical bridge is the import from `+page.svelte` to `EventCore.gen.ts`,
then `.res.js` output, including `Parser.res.js`, and finally the TS adapters.
`Parser.res` declares `elapsedEnd` with `@module("./calendarAdapter.ts")` and
calls it for inferred endings; generated JS calls `CalendarAdapterTs.elapsedEnd`.
ReScript's generated JS also imports `@rescript/runtime`.

The unconfigured run incorrectly reported `calendarAdapter.elapsedEnd`, eight
other calendar exports, nine primitive exports, and `@rescript/runtime` as
unused. Gitignored `.gen.ts` and `.res.js` were absent from the graph. The
adopted commands use `--no-gitignore` with bounded `project` globs, including
generated source in production. `ignoreIssues` suppresses only unused
files/exports/types on `src/lib/core/*.{gen.ts,res.js}`. It leaves traversal,
dependency, and unresolved-import findings enabled. There are no adapter or
runtime dependency exemptions.

After configuration, `elapsedEnd`, the primitive exports, and the runtime
dependency are absent from both issue reports. The test-only canaries appear
only in production. This validates these particular edges, not every possible
FFI convention; repeat the canaries after changing generation or Knip versions.

## Recorded output and triage

Normal report: one unused file, three unused exported types, no unused value
exports, and no dependency or unresolved-import findings. Production report:
one unused file, six unused value exports, four unused exported types, and no
dependency or unresolved-import findings. Selected real output:

```text
Normal:
  src/lib/index.ts                     files: src/lib/index.ts
  src/lib/announcementLinks.ts          types: LinkKind, LinkRole
  src/lib/evidenceHighlight.ts          types: EvidenceKind
Production adds:
  src/lib/calendarDescription.ts        exports: composeDescription,
    leadingVeneerLink, existingVeneerLinks, addFormIntroduction
  src/lib/announcementLinks.ts          exports: primarySignup
  src/lib/evidenceHighlight.ts          exports: evidenceSegments
  src/lib/evidenceHighlight.ts          types: EvidenceSegment
```

| Candidate                                                        | Production / normal reachability | Confidence and evidence                                                                               | Recommended action                                                                   |
| ---------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `calendarAdapter.elapsedEnd`                                     | Used / used                      | High: `Parser.res` external and generated calls; absent from both reports                             | Preserve; known-use canary                                                           |
| `primarySignup`                                                  | Unused / test-used               | High for test-only status: `tests/announcement-links.test.ts` imports and calls it                    | Review API intent and helper assertions in a separate cleanup PR                     |
| `addFormIntroduction`                                            | Unused / test-used               | High for test-only status: `tests/calendar-description.test.ts`; wrapper over `writeFormIntroduction` | Review intent with affected assertions; retain tests for active description behavior |
| `evidenceSegments`                                               | Unused / test-used               | High for test-only status: `tests/evidence-highlight.test.ts`; UI uses `styledEvidenceSegments`       | Review helper and tests together; preserve active highlighting coverage              |
| `composeDescription`, `leadingVeneerLink`, `existingVeneerLinks` | Unused / test-used               | Production-only findings; calendar-description tests import them                                      | Confirm API and test intent before proposing cleanup                                 |
| `src/lib/index.ts`                                               | Unused / unused                  | High for scaffold status; `package.json` still maps bare `#lib` to `./src/lib/index.js`               | Decide scaffold and bare-alias intent together; preserve `#lib/*` consumers          |
| `LinkKind`, `LinkRole`, `EvidenceKind`                           | Unused export / unused export    | Type declarations are used within their own modules, with no external consumers reported              | Consider removing export modifiers separately; keep local types                      |
| `EvidenceSegment`                                                | Unused export / test-used        | Production-only type finding; return type of test-used `evidenceSegments`, with no direct test import | Review type API intent separately                                                    |
| `@rescript/runtime`                                              | Used / used                      | Generated JS imports; false positive before bridge inclusion                                          | Preserve dependency                                                                  |

Known accepted limitations: compiler-generated exports are intentionally
suppressed, `.res` internals are outside Knip's analysis, and archived/manual
tools are legitimate development roots. Do not expand roots or ignores merely
to reach zero findings. An unexpected unused known-use canary invalidates the
report for deletion decisions.

Normal mode also prints a configuration hint that the manifest's bare
`./src/lib/index.js` entry does not exist. The scaffold is `index.ts`; resolve
the alias/API intent with its cleanup rather than suppressing this hint.

## Fallow pilot and decision

Fallow 3.36.0 was invoked with `pnpm dlx`, without adding a dependency, hook,
baseline, or CI integration. Initial whole-project health found 53 functions
above thresholds across 46 files; duplication found 29 clone groups, all in
tests/tooling. Its default health invocation exited 1 on findings, so it cannot
be copied unchanged into an advisory workflow.

For a bounded source-only rerun, create this temporary config outside the repo:

```sh
cat > /tmp/nl-fallow-source.json <<'JSON'
{"ignorePatterns":["tests/**","scripts/**","**/*.res.js","**/*.gen.ts","lib/**",".svelte-kit/**"]}
JSON
pnpm dlx fallow@3.36.0 health --config /tmp/nl-fallow-source.json --production --format json --no-cache --report-only
pnpm dlx fallow@3.36.0 dupes --config /tmp/nl-fallow-source.json --production --format json --no-cache
```

These source exclusions are for complexity/duplication only. Do not reuse them
for reachability: they deliberately remove the generated bridge.

Both bounded commands exited zero. Health analyzed 18 files and 173 functions,
with 52 above thresholds; it explicitly reported a `static_estimated` coverage
model. Selected cyclomatic/cognitive measurements were:

| Location                                                 | Cyclomatic | Cognitive | Interpretation                                             |
| -------------------------------------------------------- | ---------- | --------- | ---------------------------------------------------------- |
| `AnnouncementLinks.svelte` template, line 147            | 38         | 65        | Review UI branching when changing this component           |
| `AnnouncementLinks.svelte:show`, line 80                 | 23         | 20        | Positioning/visibility logic warrants focused review       |
| `calendarDescription.ts:trackFormIntroduction`, line 176 | 23         | 19        | Review state transitions during future description changes |
| `fastTooltips.ts:position`, line 34                      | 21         | 14        | Geometry branches are a review candidate                   |

Duplication analyzed 13 files / 3,670 lines and reported zero clone groups.
The different file totals reflect each detector's supported source selection;
they do not establish complete template or ReScript coverage. `.res` source is
not analyzed. Estimated coverage/CRAP scores are not measured test coverage,
and diagnostics said boundaries and rule packs were not configured.

Decision: defer adoption. Complexity adds a useful review list, but the bounded
duplication run adds no cleanup candidates, and the parser/domain core remains
invisible. Maintaining a second tool and source-selection policy is not yet
justified. Revisit during a substantial TS/Svelte refactor if these hotspots
become actionable. Keep any future invocation opt-in and report-only.

References: [Knip project scope](https://knip.dev/guides/configuring-project-files),
[Knip issue-specific suppression](https://knip.dev/reference/configuration#ignoreissues),
and [Fallow documentation](https://www.fallow.tools/docs/).

## Verification

`pnpm test` passed all 573 tests in 12 files; `pnpm check` reported zero errors
and warnings; `pnpm lint` and `pnpm build` passed. The build retained its large
chunk advisory. Both audit commands exited zero with the recorded findings,
including after `rescript clean` forced regeneration of all three modules.
`pnpm install --frozen-lockfile` passed. Browser tests were not run because this
pilot changes tooling and documentation without changing application behavior.
Independent review checked graph assumptions, root selection, suppression,
exit handling, the pilot output, and lockfile peer-context changes; it found
no actionable defects.
