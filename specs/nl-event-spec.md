# NL Event - Product and Implementation Specification

**Date:** 2026-10-24

**Status:** Phase 2 deterministic extraction and field alternatives implemented; physical-device handoff verification remains pending

**Repository / working product name:** `nl-event` / NL Event

## Goal and current state

Build a browser-first event resolver that extracts Korean or English announcements into one editable draft and hands it to Google Calendar or an `.ics` file.

The application preserves the SvelteKit 3 and Svelte 5 skeleton, with a ReScript 12 functional core and Nimble.css styling. The Git remote is `https://github.com/Leftium/nl-event`. PR #1 implements manual drafts, validation, and calendar exports; PR #2 adds deterministic parsing, candidate extraction, and per-field alternatives.

The target is a candidate resolver. Google Calendar provides advanced editing and final saving. Completion requires the state transitions below, deterministic fixture results, equivalent normalized exports, and documented device handoff results. The fixture files are adopted and remain unchanged. Unit and Chromium/WebKit tests cover the manual foundation and all 14 adopted parser fixture inputs.

## Product boundary

| Concern               | Decision                                                                              |
| --------------------- | ------------------------------------------------------------------------------------- |
| Framework             | SvelteKit 3 + Svelte 5, adapting to the installed skeleton                            |
| Domain implementation | ReScript 12, typed `@genType` boundaries, functional core / imperative shell as in pH |
| Styling               | `@leftium/nimble.css/core`, with essential layout and interaction CSS only            |
| UI / input languages  | English UI; Korean and English parsing                                                |
| Parsing               | Client-side deterministic rules with a replaceable English NLP adapter                |
| Handoff               | Primary: **Open in Google Calendar**. Secondary: **Download .ics**                    |
| Event count           | One current draft and one exported event at a time                                    |
| Privacy               | No login, backend, external LLM, or calendar-reading permission                       |

The interface has exactly five editable field groups, in this order:

| Field       | Editor          | Suggestions                                                                |
| ----------- | --------------- | -------------------------------------------------------------------------- |
| Description | Textarea at top | Sole parsing source and exported description; no alternatives              |
| Title       | Text input      | Event headlines and activity headings                                      |
| Start       | Text input      | Complete timestamps, all-day dates, or visibly unresolved partial evidence |
| End         | Text input      | Associated ends and labeled inferred duration                              |
| Location    | Text input      | Venue/address alternatives                                                 |

Description is the source for automatic candidates; direct Start/End edits may also contain independently interpreted freeform text. Description is one mutable value. Parse snapshots and revision IDs are internal evidence, not a second editable source. Parsing, selection, and export never rewrite it. Export its exact current contents, subject to transport escaping and line-ending encoding.

Render meaningful alternatives beneath their own fields; clicking one changes only that field. For Start and End, split source candidates into deduplicated Date and Time option rows. Date and Time chips are sorted chronologically. Date chips show weekday and calendar-day delta from today in the effective zone. Complete datetime candidates contribute to both rows. Selecting a date chooses its highest-ranked associated time; if it has no associated complete time, select All day. Selecting a time then preserves the chosen date, even when the combination is not paired in Description. Fill a missing date from the best available source suggestion. Retain incomplete evidence when no component is available and leave AM/PM ambiguity unresolved. Show an advisory note for source-mismatched combinations; valid manual combinations remain exportable. Place the concise "Not paired in source" advisory after the Time label. Relative to the selected date, paired clock chips use solid borders; unpaired clocks use dashed borders and muted text. Both remain selectable, with the selected checkmark and highlight retained. Tooltips explain pairing and source text, appearing after 100 ms on hover or immediately on keyboard focus. Keep secondary dates from fees, deadlines and season context separately from Auto-ranked event boundaries, with source text in their tooltips, except for the single actionable deadline rule below. Make extracted source dates available to both Start and End; never borrow a sibling's edited value. Selecting either component makes only that field Manual; typing, reset, revision handling, all-day semantics and DST choices retain their existing rules. End shows Duration before its Date and Time rows. Offer timed presets of 15m, 30m, 1h, 90m, 2h, 3h and 4h, or all-day presets of 1, 2, 3 and 7 calendar days. Add positive durations from complete, unambiguous source End suggestions relative to the resolved Start, capped at 24 elapsed hours for timed suggestions or one calendar day for all-day suggestions; deduplicate and sort all durations. Retain common presets and longer selected custom durations beyond that source-derived cap. Show the calculated duration beside the label and select its matching chip, adding a custom chip when needed. Calculating duration never rewrites explicit fields. Selecting a duration makes End Manual and keeps it relative to Start; selecting an explicit End date/time replaces that duration. All-day durations count inclusive calendar days. Incomplete or invalid ranges show no calculated duration. Show All day as a pressed option in both Time rows. Selecting it again restores the stored timed values. Selecting a clock time exits all-day mode and uses that time with the chosen date. Both Time rows reflect the shared event mode; the label row contains only Auto and the contextual zone token. Associations may emphasize related suggestions or warn about mixed activities. Do not add a whole-event picker, batch creation, native date/time pickers, recurrence controls, attendees, reminders, or a full calendar editor. Zone correction and DST choices are contextual controls near Start/End, not permanent extra fields.

### Missing components and actionable deadlines

For nonempty parsed Description without clocks or dates (`cancel netflix`), show All day while leaving Start unresolved and export blocked. Offer Today, Tomorrow, and In 7 days as generated Date choices using the fixed draft reference instant and effective event zone. Selecting a date makes only that field Manual and defaults an absent Auto End to that same inclusive date. Existing all-day durations remain available. Never borrow a generated date to complete a clock selection automatically.

When explicit clock evidence is absent (`workout tomorrow`), preserve the labeled inferred 09:00 Auto default and offer common Time choices 07:00, 09:00, 12:00, 18:00, and 19:00. Source clocks take precedence and suppress generic clocks. Generated choices carry explicit provenance with no source spans and never enter parser ranking. Generated choices do not claim source pairing. Selecting a generated Start clock preserves its date, exits All day, and makes only Start Manual. An inferred Auto End previews one elapsed hour from Start; explicit or Manual Ends remain unchanged. Existing zone, DST, duration, reset, revision and export rules apply.

Promote one unambiguous explicitly labeled dated deadline with no clock to a one-day all-day Auto event only when no other event or contextual dates compete. Label its registration/deadline origin. Undated class clocks remain separately selectable without inheriting that deadline date. Explicitly selecting those clocks with the deadline date is allowed and shows "Not paired in source". Multiple deadlines, season bounds, arbitrary fee dates and unlabeled registration prose stay outside Auto defaults. Keep past-date warnings. This does not change the E3 fixture: its unlabeled registration prose remains unresolved and its calendar metadata supplies no parser dates.

## Draft lifecycle and field ownership

### Draft identity and replacement

A draft includes Description, four field states, time-zone state, parse revision/status, fixed reference context, and an optional export UID.

| Action                                         | Required transition                                                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Initial load / Reset                           | Empty all five fields and candidates; set the four extracted fields to Auto; clear zone override, DST choices, parse state, and UID; capture a new reference context                       |
| Type, edit, or paste directly into Description | Edit the same draft; retain UID and Manual fields; refresh candidates and Auto fields from the latest revision                                                                             |
| Clear Description                              | Immediately remove candidates/evidence, clear Auto values and automatic zone inference, and cancel/invalidate pending parsing; retain Manual values, explicit zone override, and draft UID |
| Nonempty Description yields no candidates      | Leave Description and Manual fields usable; Auto fields without a supported suggestion become blank; show pending/failure status only, without generic no-suggestions prose                |
| Open Google Calendar / download `.ics`         | Retain the current draft; navigation or download does not clear it or establish that it was saved                                                                                          |

**Reset** immediately resets the draft without a confirmation dialog, including populated or manually owned state. No persistent history is required.

**Paste from clipboard** reads first. On permission/read failure, keep the draft and allow native paste. An empty clipboard does not reset a populated draft. A nonempty successful read into a populated draft immediately performs Reset and fills Description with the clipboard text, without a confirmation dialog. For an empty draft, fill Description directly. This differs intentionally from native paste into the textarea, which edits the existing draft.

The shell allocates a unique UID on the first `.ics` export and reuses it on subsequent exports from that draft, including after edits. Reset clears that identity; the next exported draft receives a different UID. Field resets do not change identity. Repeated imports are platform-dependent and do not promise update/deduplication behavior.

### Auto and Manual fields

Title, Start, End, and Location each have `auto` or `manual` ownership, separate from their value and provenance. A muted, right-aligned **Auto** switch shows ownership: on means Auto and off means Manual; selected-source and typed-text origins may be retained as evidence within Manual.

| Event                                  | Target field                                                                                                | Other fields                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Latest Description parse completes     | Replace Auto values with the coherent latest suggestions or blank where unsupported; preserve Manual values | Apply the same ownership rule independently                              |
| User types, including deleting a value | Store the exact edit and mark Manual, even when blank or equal to a suggestion                              | Values and ownership unchanged                                           |
| User clicks an alternative             | Apply that candidate, including partial-resolution rules, and mark Manual                                   | Values and ownership unchanged; related suggestions/warnings may refresh |
| User turns on **Auto**                 | Mark Auto and immediately apply the latest best suggestion, or blank if none                                | Values and ownership unchanged                                           |

Selecting text in Description exposes a compact **Use selection as Title** action. It copies the exact selection into Title, marks only Title Manual, and preserves Description and the other fields. Invalidate the selection action when Description changes or the draft is replaced.

Show one right-aligned, muted **Auto** switch per field instead of separate state labels and reset links. Switching it off marks only that field Manual without changing its value, source text, duration anchor, or DST choice. Switching it on resets that field to the latest suggestion. Reset does not reuse a candidate from an older revision. If current suggestions are pending, clear the target and fill it only when the matching parse completes; indicate pending status.

A Manual value survives source changes, but its source-span badge must not pretend to describe the new text. Mark unsupported/changed evidence and show concrete contradictions or activity mismatches; do not treat every manual correction as erroneous. Preserve selected association information as historical provenance without reusing stale spans.

Suggestions can depend on the current draft, for example an End suggested for the selected Start. Recompute those suggestions when relevant fields change, but changing one field never applies a sibling suggestion. A user can explicitly reset End to accept its newly suggested value.

### Parse revisions

Parse immediately after paste and debounce ordinary Description edits. Every request/result carries draft identity, Description revision, and parsing-context revision. Ignore results that no longer match, including those arriving after Reset, a clear, or a zone-context change. Candidate spans refer only to their matching Description revision.

Publish a coherent suggestion set atomically. During a newer pending parse, old suggestions are not actionable as current evidence. Preserve the visible draft while waiting and block export until current parsing/validation settles; failure must leave manual editing available. Ownership changes made during parsing take precedence when the result is applied.

A failed current parse is a terminal status, not a pending one. Remove its suggestions/evidence and apply the no-candidates rule to Auto fields while preserving Manual fields. Show the parse error separately from field validation; once the user supplies a valid manual draft, the parse failure itself does not block export.

## Date/time evidence and validation

### Complete and partial values

Start and End accept freeform Korean/English text as well as canonical `YYYY-MM-DD HH:mm` values in the event-local IANA zone. When applying Description suggestions, display original source date/time wording in Start/End for both initial Auto values and explicitly selected chips, retaining its resolved value and provenance separately. Join original fragments when the date and clock appear on different lines; do not invent source wording for an inferred End. Preserve the exact typed text after direct edits; small text below each field shows its resolved interpretation or a validation error. Suppress field errors before Description or that field has input. Interpreted dates show the three-letter weekday and calendar-day delta from today in the effective zone, such as `17:00 (Sun, +1d)`; refresh the display clock without changing interpretation anchors. Resolve each field independently with the draft's fixed reference instant and effective event zone, without borrowing a sibling date or applying an inferred duration to End date/time text. As explicit exceptions, Start accepts a duration from now and End accepts a duration from Start. For Start durations, the shell injects the current minute when the user edits Start, separately from the fixed draft reference used for Description and relative date phrases. Preserve that anchor through other field edits, reparses and exports; recapture it when Start is edited again, and clear it on reset or draft replacement. Resolve elapsed time from that instant in the effective event zone, preserving its unique offset through DST overlaps. End accepts duration expressions such as `4hr`, `90min`, and `1h30m`, retaining the raw duration while resolving its preview and exports from the current Start. Add elapsed minutes to the resolved Start instant, require any Start DST choice first, and retain the resulting End offset when it falls in an overlap. Recompute when Start or zone changes without rewriting End. Timed hour/minute durations must be positive whole minutes (fractional hours may resolve to whole minutes) and require a complete timed Start. In all-day mode, positive whole day/week durations set inclusive End relative to Start. Canonical `YYYY-MM-DD` values and explicitly labeled freeform all-day text such as `all day tomorrow` choose all-day semantics. Partial/vague expressions remain incomplete, and multiple interpretations require a more specific edit. Both exports consume the same interpreted values. All-day End is inclusive in the UI and exclusive in both exports. A date-only Start paired with a timed End is invalid.

Candidates carry their field, known date/time components, completeness, source revision/spans, inferred flags, rank, and association IDs. Keep time-only and date-only partial evidence distinct from complete timestamps and confirmed all-day values.

- Choosing a clock preserves the date already supplied for that field. Allow explicit combinations outside the source pairing and show a concise advisory; unresolved AM/PM still blocks export. If no date is supplied, use the best available source date, never a sibling's edited value.
- Without a date in that field or current source suggestions, selection shows `12:15` as unresolved and blocks export until the date is completed. Never invent a date from the reference clock, expectation file, or calendar oracle.
- Auto keeps a date with an unresolved time, such as **tomorrow evening**, partial. Explicitly selecting its Date chip chooses All day when no complete associated time exists; typing an explicit date-only value also chooses all-day semantics.
- E2 has four associated time ranges and no event date. Initial complete Start/End remain empty; time-only alternatives remain available. May 16 from the separate calendar context is never parser evidence.

Keep validation actionable: distinguish invalid text from missing date/time components and unresolved DST. Support the deterministic Korean/English date/time forms in direct Start/End edits; unsupported freeform text remains editable with a useful error.

### All-day option

An **All day** option appears alongside clock choices in both Time rows. Its explicit draft override is independent of field ownership. Switching it on interprets Start/End as calendar dates while preserving their raw values, source text, duration anchors, zone override and DST choices. Auto reparses may update dates without clearing the mode. Switching it off restores timed interpretation; if only date values exist, ask for times rather than silently exporting an all-day event. Reset and clipboard replacement clear the override.

Use an inclusive End date covering the current timed range; an exclusive midnight end belongs to the preceding day. Resolve duration-derived End dates from the existing timed interpretation where available. A date-only partial may become all-day when the user explicitly switches modes, but a time-only source must not gain an invented date. If End has no Auto suggestion or its preserved duration has no timed interpretation, use the known Start date for the single-day all-day event. All-day normalization ignores time-zone/DST validation while retaining the choices for returning to timed mode. Both exporters use the same exclusive all-day end.

### Defaults and ordering

When source evidence provides a complete Start but omits End, suggest a 60-minute timed duration, labeled inferred. Compute that duration as elapsed minutes from a resolved instant, then render the resulting local End; do not calculate across DST by adding wall-clock text. Without a resolved Start, do not manufacture a complete default End. For confirmed all-day input with no End, suggest the same day.

Source ranges crossing midnight place End on the following date. Do not automatically roll a manually entered earlier End forward. K2's `19:00` lesson End is a 60-minute assumption, not quoted evidence or a claim that the lesson ends when the social begins; its overlap with the social remains visible.

Block both exports when either date/time is invalid or the fields mix timed and date-only values. For timed events, End must be strictly after Start when compared as instants; for all-day events, the inclusive End must be on or after Start. Also block incomplete current Start/End values, missing Start/End, unknown/invalid zones for timed events, unresolved DST in the current values, and pending current parsing/validation. Unselected partial or ambiguous alternatives do not block an otherwise valid assembled draft. Title and Location may be empty; Description may be empty for manual entry. Inferred duration/year, past dates, and activity mismatch are warnings rather than automatic export blockers when the normalized event is otherwise valid.

## Deterministic parsing policies

Korean month lists such as `7월 4, 11, 18, 25` can inherit the explicit season year. When they immediately follow a practice/meeting time range, associate those dates with the practice range and the social ranges in the same section. Stop at the next section heading; do not pair unrelated ranges elsewhere. A nearby season window and a benefits period are context rather than event boundaries. The user-provided announcement with payment details redacted in `tests/inputs/slow-saturday-user.txt` supplies additional acceptance evidence without modifying the original 14 fixtures.

Recognize checkmark-prefixed field labels without changing their source spans. Keep party/admission fee dates as selectable secondary dates without using them for Auto event boundaries. Consecutive unambiguous 24-hour ranges immediately below one dated heading form an ordered schedule: carry later slots into the following calendar day after midnight, and offer the full first-start/last-end bounds alongside individual slots. Stop this association at the first non-range line. The user-provided announcement with payment details redacted in `tests/inputs/rhythm-party-user.txt` covers the decorated labels, fee cutoff, overnight DJ slots, Location, component selection and export bounds.

### Reference context and date inference

The shell captures `referenceInstant` and browser IANA zone at draft creation. Keep that instant fixed for edits/reparses in the same draft; Reset captures a new one. Tests inject these values. Interpret relative dates in the effective event zone, not UTC or the browser zone when those differ. Resolve source zone evidence before computing relative dates.

| Expression / evidence                                     | Policy                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Today / tomorrow / day after tomorrow; Korean equivalents | Add 0 / 1 / 2 calendar days to the event-local reference date                                                                                                                                                                                                   |
| This weekday / 이번 주 weekday                            | That weekday in the current Monday-Sunday calendar week, even if already past                                                                                                                                                                                   |
| Next weekday / 다음 주 weekday                            | That weekday in the following Monday-Sunday week                                                                                                                                                                                                                |
| Explicit year or related season year                      | Retain that year; do not change it to make an event future or repair its weekday                                                                                                                                                                                |
| Month/day without a year                                  | Consider the reference year and its immediate neighbors; reject invalid dates, prefer candidates consistent with an explicit weekday, then choose the smallest absolute calendar-day distance from the event-local reference date; ties choose the earlier date |
| No matching weekday in those candidate years              | Retain the nearest valid date and warn about the weekday mismatch; do not search remote years merely to make the weekday fit                                                                                                                                    |
| Vague evening / 저녁 without a clock time                 | Preserve a date/period suggestion; no invented exact hour                                                                                                                                                                                                       |

Mark missing-year choices `inferred-year`. An explicit related source year takes precedence over nearest-year inference. Multiple contradictory explicit dates/years remain distinct evidence with a warning, not a synthesized correction. Known past events retain their year and receive `past-event`; no automatic future rollover. Compare timed starts as instants and all-day starts as local dates.

For the supplied contexts, K1 resolves to 2026-10-25 and K2 to 2026-10-18, with K2 warned as past. `next Friday` from 2026-10-21 in Asia/Seoul resolves to 2026-10-30, not October 23. Ambiguous unsupported phrases remain unresolved rather than using an NLP library's hidden defaults.

### Relative duration reminders

Description phrases such as `in 30 days` and `in 2 weeks` add calendar days to the draft's fixed reference date in the effective zone. Without clock or meal cues, use a single-day all-day event. Explicit clock times and meal cues keep timed semantics; vague periods and competing dates remain unresolved. `in 2 hours` and `in 90 minutes` add elapsed time to the reference instant. Remove recognized duration phrases from inferred heading titles; preserve labeled and Manual titles. Reset and successful clipboard replacement of a populated draft capture a new reference instant; filling an otherwise empty draft retains its existing context.

### Time inference for date-only announcements

For a single supported date with no clock evidence, infer a 09:00 Start; breakfast, lunch and dinner cues use 09:00, 12:00 and 18:00 respectively. Mark the candidate `inferred-time` and label it in the UI. Do not apply this default to explicit all-day input, vague periods such as evening, conflicting meal cues, multiple dates, or a source that already supplies clock evidence (including unresolved/invalid clocks). The existing inferred 60-minute End rule then applies. This is an explicit default for date-only announcements; never invent a missing event date. Canonical manual date-only values still choose all-day semantics.

Unlabeled heading titles strip extracted date/time phrases and dangling connectors: `lunch tomorrow at 12p` becomes Title `lunch`. Explicit title labels and Manual titles preserve their wording. Accept `a`/`p` suffixes as AM/PM, including `12a` -> 00:00 and `12p` -> 12:00; reject explicit 12-hour clocks outside hours 1-12. English date and weekday words require word boundaries, so names such as Tomorrowland and words such as money cannot create date evidence.

### Extraction and association

English examples include `Saturday, November 14th, 2026, 8 pm - midnight`, `May 16, 12:15 - 1:15 pm`, `next Friday at 7pm`, and `Location: St Paul, MN`. English extraction currently uses deterministic rules in the same core as Korean extraction. A future `compromise` + `compromise-dates` adapter is optional and must pass the same fixtures with injected reference/zone context; its output must obey these policies.

Korean rules support numeric dates (`10/25(일)`, `10월 18일(SUN)`, `2026.07.04`), relative dates, clock/range phrases (`오후 5시`, `저녁 6:30~10:30`, `16:30~18:00`, `6시 반`), and labels such as `제목`, `일시`, `날짜`, `시간`, `장소`, and `주소`. Shared AM/PM context applies when the source supports it; in K2 the evening context supports the related `6시` lesson at 18:00. Unresolved AM/PM ambiguity must remain visible.

Rank explicit labels, complete spans, heading proximity, activity coherence, and source year/weekday evidence. Deduplicate repeated mentions without discarding associations. Season bounds and registration deadlines are context, not event starts when the source identifies them as such. Exclude prices, account/phone numbers, street numbers, and URLs from date extraction.

Select one coherent initial set, preferring K2's social over the free lesson and K3's earliest listed practice occurrence. Preserve each activity/occurrence's linked title, Start, End, and venue evidence. Field alternatives remain independent under the ownership rules. Confidence is relative ranking, not an invented probability.

## Time zones and DST

Maintain the effective IANA zone, provenance, and optional explicit user override separately from field ownership. Precedence is: user override, explicit source IANA zone or unambiguous zone evidence, recognized city mapping, browser fallback. Conflicting source zones require a contextual choice before timed export. Unsupported/ambiguous zone names require confirmation instead of pretending they were resolved.

Recognize St Paul/Minneapolis, MN as `America/Chicago`, including when viewed from `Asia/Seoul`. No geocoding service is required. Mark city-derived zones inferred. Where a foreign location is recognized but its zone cannot be resolved, ask for confirmation; do not silently export with the browser fallback. With no contrary location/zone evidence, browser fallback is usable and identified as such.

Show a compact zone token beside the Start label that opens a modal picker, available even when the zone equals the browser zone. Hide the token in all-day mode. Keep zone provenance and fallback details inside the dialog, with no separate zone label in the form. A user override survives reparsing and clearing Description. **Use suggested zone** clears only that override and applies current source inference or browser fallback; Reset clears it as part of the full reset.

Changing zone preserves all entered wall-clock field values and ownership, clears obsolete offset choices, and revalidates. Refresh suggestions against the same `referenceInstant` in the new zone without automatically applying them during the zone action; a later Description edit or explicit field reset can apply refreshed Auto suggestions. This avoids silently moving the user's displayed times during zone correction.

For each complete timed value, resolve local time in the effective zone:

- One instant: valid.
- No instant (spring-forward gap): block both exports and request correction; never silently shift the clock time.
- Two instants (fall-back overlap): expose contextual earlier/later choices labeled with UTC offsets; block both exports until that field's instant is chosen. For Chicago 2026-11-01 01:30, the choices are `-05:00` and `-06:00`.

Store a DST choice with its field, local timestamp, and zone. Choosing an offset makes that field Manual without modifying its sibling. Invalidate the choice if the timestamp or zone changes, on field reset, or on Reset. Validate Start/End ordering only after resolving both instants. All-day dates do not need an offset choice.

## Architecture and styling

Follow [`Leftium/pH`](https://github.com/Leftium/pH) for ReScript domain modules and typed Svelte/TypeScript integration; adapt to the actual scaffold rather than copying configuration blindly.

The **ReScript core** owns draft transitions, Auto/Manual policy, partial evidence, Korean extraction, ranking/associations, deterministic date policies, validation, normalization, Google query preparation, and iCalendar serialization. Inject reference context, UID, and DTSTAMP; keep inference and default-duration policies explicit in the core. No I/O, random generation, current-time reads, or browser state in the core.

The **Svelte/TS shell** owns browser/clipboard access, debounce and parse scheduling, zone discovery, UID generation, navigation, file download, and focus. A deterministic date/time adapter may supply IANA conversion and valid-instant alternatives; its output must not silently resolve DST ambiguity. Keep any future English NLP adapter behind a normalized candidate boundary.

The data flow is Description snapshot/context -> extraction -> associated candidates -> draft transitions -> validation/resolved instants -> pure exporters -> browser handoff. Manual edits enter at draft transitions. Validation and both exporters consume the same normalized draft.

Import `@leftium/nimble.css/core` once in the root layout. Use semantic HTML and Nimble defaults; custom CSS is limited to responsive layout, suggestions, overflow, validation, and accessibility. Preserve keyboard access, labels, focus indicators, touch targets, and visible ownership/selection state. Wrap each extracted field and its options in a fieldset with the input label as its legend, keeping Auto and the contextual zone token on the same heading row. Preserve the border between separate controls, including while the zone token is hidden for All day. Put subtle Reset and Paste actions at the right of the Description label row. Avoid a component library, second styling framework, decorative cards, or custom design system.

## Calendar exports

### Google Calendar: primary handoff

Build a prefilled link initially using `/calendar/render?action=TEMPLATE`, with encoded `text`, `dates`, `stz`, `etz`, `location`, and `details` where supported. Keep event zone and resolved instants consistent. All-day bounds use exclusive end dates. Compare alternate routes only if device testing reveals a compatibility issue.

The link opens an editable event form; it does not save the event. Google handles recurrence, attendees, reminders, calendar selection, and final confirmation. Do not claim that an event was saved. Long verbatim descriptions can make URLs unwieldy and appear in history; never silently truncate. Keep the local `.ics` alternative available and document observed limits.

**Owner-reported mobile observation:** With the Google Calendar app installed, the handoff appears usable; browser-only fallback shows an inconvenient small desktop form. This is device evidence, not an installation-detection capability or cross-platform guarantee. Verify macOS, iPhone Safari, and Android Chrome, with/without the app where feasible; record unavailable device combinations as unverified.

### `.ics`: secondary handoff

Generate a standards-compliant VCALENDAR with `VERSION:2.0` and a `PRODID` identifying NL Event. Its VEVENT contains a unique UID per event draft, DTSTAMP, DTSTART, DTEND, SUMMARY, DESCRIPTION, and LOCATION. Follow the draft lifecycle for UID reuse; do not reuse FEHshing's fixed UID across unrelated events. Inject UID and DTSTAMP from the shell to keep serialization pure.

Escape text, use CRLF, and fold lines at 75 octets without splitting UTF-8 characters. Serialize timed values as UTC using resolved instants; use `VALUE=DATE` for all-day bounds and convert the inclusive UI End to exclusive DTEND. Validate both export paths against the same normalized draft before handoff. Download/import behavior depends on the platform and does not imply automatic saving.

## Fixture contract and provenance

The adopted bundle lives at [`tests/fixtures/nl-event/`](../tests/fixtures/nl-event/README.md). Its 14 `.txt` inputs, 14 JSON expectation files, and one calendar-only oracle remain byte-for-byte as supplied. The fixture README adds local integration guidance. Expected assertions describe semantics rather than a required implementation data model.

A parser test reads `inputs/<id>.txt` and injects only the paired expectation's `context` (`referenceInstant`, `browserTimeZone`, optional `eventTimeZoneOverride`). Compare output to `assertions` afterward. Never supply `source`, expected candidates, or calendar metadata to text parsing. Null assertions mean missing evidence; omitted assertions are not claims that other output must be empty.

| Fixture ID                         | Provenance                                           | Required result                                                                                                               |
| ---------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `k1-wine-excerpt`                  | Recoverable user-quoted excerpt                      | Exact quoted title/location; Oct 25, 2026, 17:00; inferred 18:00 End and year                                                 |
| `k2-milonga-excerpt`               | Recoverable user-quoted excerpt                      | Oct 18 social 18:30-22:30; related lesson 18:00 with inferred 19:00 End; past/year warnings; title unasserted                 |
| `k3-slow-saturday-synthetic`       | Synthetic reconstruction of discussed schedule facts | Ten practice Start alternatives from July 4 to Sept 19, 2026; associated End suggestions; exclude season bounds               |
| `e1-st-paul-houseparty-sanitized`  | Sanitized calendar-derived test                      | Nov 14, 20:00 to Nov 15, 00:00 in America/Chicago; St Paul location, no private street address; no metadata-derived 23:55 End |
| `e2-workshop-times-only-sanitized` | Sanitized calendar-derived test                      | Four related partial time ranges; no invented date/venue; export blocked                                                      |
| `e3-series-deadline-synthetic`     | Synthetic negative test from calendar context        | Registration date is not a class date; no complete event; export blocked                                                      |
| `k4-blues-jam-sanitized`           | Sanitized calendar-derived excerpts                  | Apr 13, 2026, 20:00-22:30; workshop/social associations; deduplicate date mentions; ignore price                              |
| `en-all-day-multiday-synthetic`    | Synthetic                                            | Inclusive Oct 25-26 UI dates; exclusive Oct 27 export end                                                                     |
| `en-next-friday-synthetic`         | Synthetic                                            | Oct 30, 2026, 19:00 under the fixed Oct 21 reference context                                                                  |
| `en-vague-evening-synthetic`       | Synthetic                                            | Oct 25 date evidence; no invented hour; export blocked                                                                        |
| `en-dst-fall-back-synthetic`       | Synthetic                                            | Chicago Nov 1, 01:30 needs an explicit offset choice                                                                          |
| `en-dst-spring-gap-synthetic`      | Synthetic                                            | Chicago Mar 8, 02:30 is nonexistent; export blocked                                                                           |
| `ko-tomorrow-synthetic`            | Synthetic                                            | Oct 25, 2026, 17:00 under the fixed reference context                                                                         |
| `ko-numeric-noise-synthetic`       | Synthetic                                            | Extract Oct 25, 17:00; ignore address, price, and dummy account digits                                                        |

`oracles/e3-series-calendar-metadata.json` independently checks America/Chicago occurrences at 19:30-20:30: Oct 20/27 use `-05:00`, Nov 3/10 use `-06:00`. It is serialization/time-zone evidence only, never a source of dates for E3 parsing.

Full original K1/K2/K3 announcements remain unavailable. Do not reconstruct missing paragraphs or describe excerpts/synthetic inputs as complete originals. If originals become available, add separate `*-original` cases with unchanged input and explicit expectations. Their recovery is not a prerequisite for the supplied tests.

K2's default lesson End overlaps the social; preserve the assertion and inferred label, with relationship warnings where relevant. E4 (stale copied English dates) has no supplied input/expectation pair and remains a coverage gap; add an explicitly synthetic contradiction case or a separately sourced original later. Do not quietly weaken assertions to accommodate parser behavior.

The bundle removes a private home address, registration URLs, personal names, and real account data; it retains public venue addresses and labeled dummy digits. Review provenance and personal data before any future public push. Additional user-provided inputs live separately under `tests/inputs/`, with their redactions documented there; they do not alter the adopted bundle.

## Implementation stages and acceptance

### Phase 1: manual draft and exports

- Inspect applicable instructions, current Git/index state, scripts, and configuration before product edits. Configure ReScript/typed integration and Nimble within the existing scaffold.
- Build draft lifecycle and ownership transitions, normalized text validation, zone/DST resolution, and both pure exporters. Add clipboard handling that replaces a populated draft after a successful nonempty read, without confirmation.
- Verify UID reuse/reset, all-day bounds, DST, Unicode/escaping/folding, and normalized export parity.

Checkpoint: manual-only preparation works without language parsing.

### Phase 2: extraction and field alternatives

- Add English/Korean adapters, partial candidate representation, grouping/ranking, deterministic reference policies, and revision-safe parsing.
- Wire field alternatives/reset actions and current-evidence warnings to the ownership contract.
- Exercise all supplied input/expectation pairs; keep the E3 calendar oracle in separate conversion/serialization tests.

Checkpoint: grounded default values and alternatives are useful without overwriting Manual values or fabricating missing evidence.

### Phase 3: state-transition and handoff verification

The implementation must cover these scenarios in addition to the supplied parser fixtures:

- Auto fields update after Description edits; typing/deleting/selecting makes only that field Manual; reset uses the current suggestion or blank, with no sibling mutation.
- Clearing Description empties Auto values/evidence while preserving Manual values, UID, and zone override. Reset immediately resets everything without a confirmation dialog.
- Native paste edits the current draft. Clipboard replacement immediately starts a new draft after a successful nonempty read, without confirmation; denial, failure, or empty clipboard preserves work.
- Out-of-order results and results from discarded drafts/context revisions cannot restore stale values/spans. Ownership edits during a pending parse win.
- A failed parse clears stale Auto values/evidence and leaves Manual fields intact. Completing a valid manual draft permits export despite the parse error; unused partial alternatives do not block a valid assembled draft.
- Time selections preserve their field's date and allow explicit source-mismatched combinations with an advisory. Auto leaves vague date/period evidence partial; explicitly selecting a Date can choose All day. Missing dates and ambiguous AM/PM remain unresolved.
- A zone override survives reparses; resetting it restores source/browser inference. Zone changes preserve entered wall times and invalidate offset choices. Test relative dates near local midnight and year/week boundaries, missing-year ties, and weekday contradictions.
- Both DST overlap choices produce the intended distinct instants in both exports. Spring gaps and invalid ordering block both exports. Default durations across a transition use elapsed minutes.
- Keyboard/screen-reader access, focus, touch targets, ownership/reset labels, and form state after handoff remain usable.
- Verify Google prefill and `.ics` behavior on the device matrix in Calendar exports, including long Unicode descriptions; document actual outcomes and unavailable combinations.

Run the repository's applicable tests, check, lint, build, and focused browser smoke checks during implementation, subject to repository approval policy. Extend existing regression paths for new behavior rather than duplicating fixture coverage. For development tooling, require initial ReScript compilation, a background watcher and foreground Vite. Verify `u`, `r`, `q`, recompilation, normal-exit and Ctrl-C watcher cleanup in an interactive terminal.

## Deferred work and references

Outside v1: OAuth/direct calendar writes, calendar reads/conflict checks/sync, persistent history, batch creation/recurrence generation, imported-event updates, geocoding, multilingual UI, native share targets/extensions, screenshot/PDF/OCR input, and Outlook-specific links. Explicit reminder extraction/export is deferred because export formats differ.

- [`Leftium/pH`](https://github.com/Leftium/pH): ReScript/Svelte boundaries, `@genType`, Nimble; see `src/routes/+layout.svelte`, `src/routes/GeneratorForm.res`, `src/routes/+page.svelte`, and `docs/rescript-for-typescript-devs.md`.
- [`compromise-dates`](https://www.npmjs.com/package/compromise-dates): optional future English extraction adapter to verify against fixtures.
- [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545): iCalendar serialization semantics.
- [`Leftium/FEHshing`](https://github.com/Leftium/FEHshing): prior `.ics` example, not the architecture template.
- [`Leftium/veneer`](https://github.com/Leftium/veneer), `specs/completed/locale.md`: Paraglide/inlang direction if UI localization later enters scope.
- [Continuum v0.6.2 protocol](https://github.com/Leftium/continuum/blob/9aea3336bb10037ad92eda836c8f59972cfbde7b/protocol/CONTINUUM.md) / [bootstrap guide](https://github.com/Leftium/continuum/blob/main/docs/client.md): adopted for PR #1; writer claims precede product writes and merge stays owner-controlled.

**Implementation boundary:** See the README for the implemented parsing rules and actual verification limits. CI, remote hosting, and physical-device calendar handoffs have not been established.
