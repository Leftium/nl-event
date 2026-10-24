# NL Event

Prepare one calendar event manually, then open its editable Google Calendar form or download an `.ics` file. Description, Title, Start, End, and Location remain editable after export. Nothing saves to a calendar automatically.

This foundation preserves SvelteKit 3 and Svelte 5, uses ReScript 12 for the functional core, and imports `@leftium/nimble.css/core` once in the root layout. Natural-language parsing and candidate extraction are deferred. Auto fields stay blank until edited; **Reset to suggested** returns a Manual field to blank Auto state. Description is exported as entered.

## Development

Use Node 24 and pnpm. Run `pnpm install`, then `pnpm dev`. The dev command builds ReScript before starting Vite and watches both sources. `pnpm check`, `pnpm test`, and `pnpm build` also regenerate the typed boundary before running. Generated `.res.js` and `.gen.ts` files are ignored; edit `.res` sources instead. JavaScript checking is disabled for compiler output; ReScript checks the core and `@genType` supplies the TypeScript boundary.

- `pnpm check`: ReScript compilation and Svelte/TypeScript diagnostics.
- `pnpm test`: focused Vitest tests for state, validation, time zones, and exports.
- `pnpm test:browser`: Chromium and WebKit smoke checks against a running `pnpm dev` server. Install local browser binaries with `pnpm exec playwright install chromium webkit` if needed. Set `NL_EVENT_BASE_URL` to test another local server.
- `pnpm lint`: Prettier and ESLint.
- `pnpm build`: production build through the existing adapter-auto setup.

`src/lib/core/EventCore.res` owns draft transitions, ownership, validation decisions, normalization, and both serializers. `calendarAdapter.ts` provides deterministic Temporal date/zone conversion and all possible matching instants, without choosing an ambiguous offset. `primitives.ts` supplies Unicode and string operations. The Svelte page owns clipboard access, confirmations, captured reference context, UID/DTSTAMP generation, focus, and downloads. There is no backend or persistent draft history.

## Manual input

Enter timed values as `YYYY-MM-DD HH:mm` in the displayed IANA zone. Enter both Start and End as `YYYY-MM-DD` for all-day events; End includes that date. Both exports use the same normalized event and exclusive all-day end. Invalid dates, mixed formats, reversed ranges, unknown timed zones, DST gaps, and unresolved overlaps block export. For repeated local times, choose an offset independently for Start and End. Changing zone keeps wall-clock text and clears those choices.

**New event** confirms before discarding populated or manually owned state. Native paste into Description edits the current draft. **Paste from clipboard** reads first, preserves the draft on failure or empty text, and confirms replacement before starting a fresh draft. Clipboard access requires browser permission and a secure context such as HTTPS or localhost.

The first `.ics` download allocates a UID reused after edits and later downloads. New event clears it. Imports may still duplicate events depending on the calendar application. Long Google URLs can exceed platform limits and expose the description in browser history; the file export keeps the complete description without a URL handoff.

## Scope and verification

The [product specification](specs/nl-event-spec.md) defines the broader resolver. The [fixture contract](tests/fixtures/nl-event/README.md) reserves source-text fixtures for the later parser milestone. Inputs, expectations, and the independent calendar oracle are preserved unchanged. Only the calendar oracle is used by the manual foundation's conversion tests.

Unit tests cover draft transitions, UID reuse/reset, strict dates, all-day bounds, time-zone overrides, Chicago DST gaps and both overlap choices, normalized Google/ICS equivalence, query encoding, text escaping, CRLF, and UTF-8-safe folding. Chromium and WebKit smoke checks cover real file downloads, clipboard failure/empty/cancellation/replacement (with stubbed reads), confirmation cancellation, ownership, UID reuse/reset, DST controls, focus, and a 390px viewport. Google URL contents are checked locally; signed-in Google prefill and actual calendar import remain unverified. Results are recorded in PR #1. Physical macOS calendar import, iPhone Safari and Android Chrome with/without the Google Calendar app require device verification. A responsive desktop browser viewport does not verify those device combinations.
