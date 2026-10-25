# NL Event

NL Event turns Korean and English event announcements into one editable calendar draft. Paste text into Description, review the suggested Title, Start, End, and Location, then open the event in Google Calendar or download an `.ics` file. Nothing is saved to a calendar automatically.

For example, `lunch tomorrow` suggests the title `lunch`, a noon start tomorrow, and an inferred one-hour end. The current Description is included in either export.

Parsing runs in the browser. There is no account, backend, external LLM, or calendar-reading permission.

## Editing a draft

Each field has an Auto switch. When it's on, the field follows parsing. Typing or choosing a chip makes only that field Manual. Turn Auto back on to accept the latest suggestion. Start and End show their interpreted values below the input, even when the input contains the announcement's original wording.

Suggestions for Start and End are split into Date and Time chips. Choosing a date uses its associated time when available; choosing a time keeps that field's date. Unpaired combinations are allowed but flagged. Date chips show the weekday and days from today, and long lists start collapsed. Hovering or focusing source-backed suggestions highlights the matching text in Description. When an announcement has no date or clock, generated choices include Tomorrow and common times.

Select text in Description to use it as Title or Location. Reset discards the draft without confirmation. Native paste edits Description; **Paste from clipboard** replaces the draft when a nonempty read succeeds. Word wrap and fullscreen controls change how Description is displayed, not its contents.

## Dates and times

Start and End accept Korean or English expressions such as `내일 오후 5시` or `tomorrow at 7pm`, as well as `YYYY-MM-DD HH:mm`. Start can also take a duration from the time of editing (`30min`); End can take a duration from Start (`90min`, `2hr`). The Duration chips under End are shortcuts for the same relative behavior.

Use **All day** for date-only events. End is inclusive in the editor: a Start of November 1 and End of November 3 covers all three days. Incomplete dates, vague times, invalid ranges, and unresolved daylight-saving overlaps need correction before export.

Dates are interpreted in the event's time zone, taken from the announcement when possible or otherwise from the browser. You can change it beside Start. The preview below each field shows what will be exported.

## Calendar handoff

Each export contains one event. Google Calendar opens an editable event form where you can add recurrence, reminders, and other details; downloading `.ics` gives you a file to import into a calendar app. Neither action confirms that the event was saved.

The Google Calendar link includes event details in its URL, which may appear in browser history or exceed URL-length limits. The `.ics` file avoids that handoff, but importing the same file repeatedly may create duplicates.

## Development

Requires Node 24 and pnpm.

```sh
pnpm install
pnpm dev
```

`pnpm dev` compiles ReScript, starts its watcher, and runs Vite. Edit the `.res` source files rather than generated `.res.js` or `.gen.ts` output.

```sh
pnpm check
pnpm test
pnpm lint
pnpm build
pnpm test:browser
```

Browser tests use Chromium and WebKit against a running dev server. Install the browsers with `pnpm exec playwright install chromium webkit`. Set `NL_EVENT_BASE_URL` to test a different server.

The app uses SvelteKit 3, Svelte 5, ReScript 12, and Nimble.css. The main pieces are:

- `src/routes/+page.svelte`: editor, focus, clipboard, and calendar handoff.
- `src/lib/core/Parser.res` and `src/lib/core/englishDatesAdapter.ts`: Korean/English extraction and date evidence.
- `src/lib/core/EventCore.res`: draft state, field ownership, validation, and exports.
- `src/lib/core/TimeInput.res` and `src/lib/core/calendarAdapter.ts`: freeform time input, calendar arithmetic, time zones, and DST.

For parser rules, edge cases, and current verification gaps, see the [product specification](specs/nl-event-spec.md). The [fixture contract](tests/fixtures/nl-event/README.md) explains the adopted test inputs and why calendar oracles are kept separate from text parsing.
