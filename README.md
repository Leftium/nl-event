# NL Event

Paste a Korean or English announcement into Description, review suggestions for Title, Start, End, and Location, then open an editable Google Calendar form or download an `.ics` file. Description, Title, Start, End, and Location remain editable after export. Nothing saves to a calendar automatically.

The application preserves SvelteKit 3 and Svelte 5, uses ReScript 12 for the functional core, and imports `@leftium/nimble.css/core` once in the root layout. Ranked alternatives appear beneath each field. Selecting one changes only that field and marks it Manual; typing, including deleting, also makes a field Manual. **Reset to suggested** restores its latest coherent suggestion, or blank when unsupported. Description is exported exactly as entered.

Parsing uses deterministic Korean/English rules, with no server, external LLM, geocoding, or NLP library defaults. Candidate evidence includes source spans, completeness, inference labels, rank, and activity/occurrence associations. Source details show the quoted evidence and associations. Picking a different Start emphasizes its associated End alternatives without changing End; reset End explicitly to apply its related suggestion. Mixed activities and retained selections from an older Description receive visible warnings.

Time-only options stay unresolved unless that same field already has a compatible manually supplied date. A vague period such as "tomorrow evening" supplies a date, not an exact hour or an all-day event. Missing dates, deadlines, and unrelated sections cannot supply a complete event. Unused partial alternatives do not block a valid manually assembled draft.

## Development

Use Node 24 and pnpm. Run `pnpm install`, then `pnpm dev`. The dev command builds ReScript before starting Vite and watches both sources. `pnpm check`, `pnpm test`, and `pnpm build` also regenerate the typed boundary before running. Generated `.res.js` and `.gen.ts` files are ignored; edit `.res` sources instead. JavaScript checking is disabled for compiler output; ReScript checks the core and `@genType` supplies the TypeScript boundary.

- `pnpm check`: ReScript compilation and Svelte/TypeScript diagnostics.
- `pnpm test`: focused Vitest tests for state, validation, time zones, and exports.
- `pnpm test:browser`: Chromium and WebKit smoke checks against a running `pnpm dev` server. Install local browser binaries with `pnpm exec playwright install chromium webkit` if needed. Set `NL_EVENT_BASE_URL` to test another local server.
- `pnpm lint`: Prettier and ESLint.
- `pnpm build`: production build through the existing adapter-auto setup.

`src/lib/core/Parser.res` owns Korean/English extraction, date-inference policy, ranking, and associations. `EventCore.res` owns draft transitions, revision checks, ownership, partial selection, validation decisions, normalization, and both serializers. `calendarAdapter.ts` provides deterministic Temporal calendar arithmetic, elapsed durations, date/zone conversion, and all possible matching instants, without choosing an ambiguous offset. `primitives.ts` supplies lexical matching, Unicode, and string operations. The Svelte page owns clipboard access, confirmations, captured reference context, debounce/parse scheduling, UID/DTSTAMP generation, focus, and downloads. There is no backend or persistent draft history.

## Manual input

Enter timed values as `YYYY-MM-DD HH:mm` in the displayed IANA zone. Enter both Start and End as `YYYY-MM-DD` for all-day events; End includes that date. Both exports use the same normalized event and exclusive all-day end. Invalid dates, mixed formats, reversed ranges, unknown timed zones, DST gaps, and unresolved overlaps block export. For repeated local times, choose an offset independently for Start and End. Changing zone keeps wall-clock text and clears those choices. Source IANA zones take precedence over recognized city inference (St Paul/Minneapolis, MN -> America/Chicago), then browser fallback. A manual override takes precedence over all three and survives Description edits/clearing. Conflicting or unsupported source zones require confirmation. Zone edits refresh suggestions against the fixed reference instant without applying new Auto values; reset a field or edit Description to apply them.

Ordinary Description edits debounce for 250 ms; paste starts parsing immediately. Pending evidence is hidden and exports wait for the current parse. Draft identity, Description revision, and zone-context revision reject stale results. Manual edits during parsing win. Clearing Description removes evidence and Auto values while retaining Manual fields, zone override, and UID. Parse failure clears suggestions and Auto values but leaves manual completion and export available.

**New event** confirms before discarding populated or manually owned state. Native paste into Description edits the current draft. **Paste from clipboard** reads first, preserves the draft on failure or empty text, and confirms replacement before starting a fresh draft. Clipboard access requires browser permission and a secure context such as HTTPS or localhost.

The first `.ics` download allocates a UID reused after edits and later downloads. New event clears it. Imports may still duplicate events depending on the calendar application. Long Google URLs can exceed platform limits and expose the description in browser history; the file export keeps the complete description without a URL handoff.

## Scope and verification

The [product specification](specs/nl-event-spec.md) defines the broader resolver. The [fixture contract](tests/fixtures/nl-event/README.md) defines the 14 adopted source cases. Inputs, expectations, provenance, and the independent calendar oracle remain unchanged. Fixture tests inject only reference context into parsing and compare assertions afterward. The E3 calendar oracle remains separate conversion/serialization evidence; it never supplies parser dates. K1/K2 remain excerpts and K3 remains synthetic. Missing originals and E4 source coverage remain follow-ups.

Unit tests cover all 14 parser fixtures plus ownership and stale-result races, partial resolution, associated End resets, relative/week/year rules, midnight zone context, weekday contradictions, inferred elapsed durations, UID reuse/reset, strict dates, all-day bounds, time-zone overrides, Chicago DST gaps and both overlap choices, normalized Google/ICS equivalence, query encoding, text escaping, CRLF, and UTF-8-safe folding. Chromium and WebKit smoke checks exercise all 14 inputs and their preferred/blocked outcomes through the UI, field alternatives and sibling independence, partial selection/completion, pending/new-draft invalidation, real file downloads, clipboard failure/empty/cancellation/replacement (with stubbed reads), confirmation cancellation, ownership, UID reuse/reset, DST controls, focus, and a 390px viewport. Google URL contents are checked locally; signed-in Google prefill and actual calendar import remain unverified. Implementation verification is recorded in PR #2. Physical macOS calendar import, iPhone Safari and Android Chrome with/without the Google Calendar app require device verification. A responsive desktop browser viewport does not verify those device combinations.
