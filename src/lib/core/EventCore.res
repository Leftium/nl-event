@genType
type fieldName = Parser.fieldName
@genType
type ownership = [#auto | #manual]
@genType
type field = {
  value: string,
  ownership: ownership,
  offset: string,
  input?: string,
  durationReference?: string,
}
@genType
type context = {referenceInstant: string, browserTimeZone: string}
@genType
type identity = {reference: string}
@genType
type ticket = {identity: identity, revision: int, contextRevision: int}
@genType
type selection = {name: fieldName, candidate: Parser.candidate, revision: int}
@genType
type draft = {
  description: string,
  title: field,
  start: field,
  end: field,
  location: field,
  context: context,
  zoneOverride: option<string>,
  allDayOverride: option<bool>,
  uid: option<string>,
  identity: identity,
  revision: int,
  contextRevision: int,
  parseStatus: string,
  parseError: string,
  suggestions: Parser.output,
  selections: array<selection>,
  pendingResets: array<fieldName>,
}
@genType
type instantChoice = {offset: string, instant: string, epoch: float}
@genType
type resolution = {kind: string, date: string, nextDate: string, choices: array<instantChoice>}
@genType
type normalized = {
  title: string,
  description: string,
  location: string,
  zone: string,
  allDay: bool,
  start: string,
  end: string,
}
@genType
type validation = {
  allDay: bool,
  event: option<normalized>,
  startValue: string,
  endValue: string,
  startError: string,
  endError: string,
  startChoices: array<instantChoice>,
  endChoices: array<instantChoice>,
  warnings: array<string>,
}
@module("./calendarAdapter.ts") external resolve: (string, string) => resolution = "resolve"
@module("./calendarAdapter.ts") external localDate: (string, string) => string = "localDate"
@module("./primitives.ts") external codePoints: string => array<string> = "codePoints"
@module("./primitives.ts") external byteLength: string => int = "byteLength"
@module("./primitives.ts") external replaceAll: (string, string, string) => string = "replaceAll"
@scope("Date") @val external parseInstant: string => float = "parse"
@module("./calendarAdapter.ts") external validZone: string => bool = "validZone"
@val external encode: string => string = "encodeURIComponent"

let emptyField: field = {value: "", ownership: #auto, offset: ""}
@genType
let create = (context: context): draft => {
  description: "",
  title: emptyField,
  start: emptyField,
  end: emptyField,
  location: emptyField,
  context,
  zoneOverride: None,
  allDayOverride: None,
  uid: None,
  identity: {reference: context.referenceInstant},
  revision: 0,
  contextRevision: 0,
  parseStatus: "idle",
  parseError: "",
  suggestions: {
    candidates: [],
    contextDates: [],
    zone: context.browserTimeZone,
    zoneProvenance: "Browser fallback",
    zoneWarning: "",
    warnings: [],
  },
  selections: [],
  pendingResets: [],
}
@genType
let getField = (draft: draft, name: fieldName): field =>
  switch name {
  | #title => draft.title
  | #start => draft.start
  | #end => draft.end
  | #location => draft.location
  }
let setField = (draft: draft, name: fieldName, field: field): draft =>
  switch name {
  | #title => {...draft, title: field}
  | #start => {...draft, start: field}
  | #end => {...draft, end: field}
  | #location => {...draft, location: field}
  }
let removeSelection = (draft: draft, name) => {
  ...draft,
  selections: draft.selections->Array.filter(s => s.name != name),
  pendingResets: draft.pendingResets->Array.filter(n => n != name),
}
let selection = (draft: draft, name) => draft.selections->Array.find(s => s.name == name)
let associated = (a: Parser.candidate, b: Parser.candidate) =>
  a.groups->Array.includes("overall") ||
  b.groups->Array.includes("overall") ||
  a.groups->Array.some(g => b.groups->Array.includes(g))
@genType
let alternatives = (draft: draft, name): array<Parser.candidate> => {
  let values = draft.suggestions.candidates->Array.filter(c => c.field == name)
  switch (name, selection(draft, #start)) {
  | (#end, Some(start)) if start.revision == draft.revision =>
    values->Array.toSorted((a, b) => {
      let aRelated = associated(start.candidate, a)
      let bRelated = associated(start.candidate, b)
      aRelated == bRelated ? 0. : aRelated ? -1. : 1.
    })
  | _ => values
  }
}
let best = (draft, name) => {
  let chosenStart = switch selection(draft, #start) {
  | Some(s) if s.revision == draft.revision => Some(s.candidate)
  | _ =>
    draft.suggestions.candidates->Array.find(c =>
      c.field == #start && (c.completeness == "complete" || c.completeness == "all-day")
    )
  }
  alternatives(draft, name)->Array.find(c => {
    let complete =
      c.completeness == "text" || c.completeness == "complete" || c.completeness == "all-day"
    // Generated Start choices have no source group. Resetting Auto End can
    // restore its inferred duration without claiming a source association.
    let coherent = switch chosenStart {
    | Some(start) if name == #title || name == #end =>
      associated(start, c) ||
      (name == #end &&
      start.inferred->Array.includes("generated-suggestion") &&
      c.inferred->Array.includes("assumed-end"))
    | _ => true
    }
    complete && coherent
  })
}
// Keep extracted text separate from its resolved value. Source fragments may
// need Description context (shared PM, year, next-day End) that a field alone
// cannot safely reconstruct. Typing discards this display text and reinterprets
// the exact edit through TimeInput instead.
@genType
let candidateInput = (draft: draft, candidate: Parser.candidate) => {
  if (
    (candidate.field != #start && candidate.field != #end) ||
      candidate.inferred->Array.includes("assumed-end")
  ) {
    candidate.value
  } else if candidate.date == "" {
    let index = candidate.field == #end ? Array.length(candidate.spans) - 1 : 0
    candidate.spans
    ->Array.get(index)
    ->Option.map(span => Parser.slice(draft.description, span.start, span.end))
    ->Option.getOr(candidate.value)
  } else {
    let first = candidate.spans->Array.get(0)
    let clock = candidate.spans->Array.get(candidate.field == #end ? 2 : 1)
    switch (first, clock) {
    | (Some(date), Some(time)) => {
        let from = date.start < time.start ? date.start : time.start
        let until = date.end > time.end ? date.end : time.end
        let between = Parser.slice(draft.description, from, until)
        Parser.has(between, "[\\r\\n]")
          ? `${Parser.slice(draft.description, date.start, date.end)} ${Parser.slice(
                draft.description,
                time.start,
                time.end,
              )}`
          : between
      }
    | (Some(source), None) => Parser.slice(draft.description, source.start, source.end)
    | _ => candidate.value
    }
  }
}
// A missing-date default is a generated field value, never parser evidence.
let defaultDateField = (draft: draft, name): option<field> => {
  if (
    name == #start &&
    draft.parseStatus == "ready" &&
    draft.description->String.trim != "" &&
    !Parser.has(draft.description, "\\bin\\s+[-+\\d.]") &&
    Array.length(draft.suggestions.contextDates) == 0 &&
    !(draft.suggestions.warnings->Array.includes("unresolved-source-day")) &&
    !(
      draft.suggestions.candidates->Array.some(c =>
        c.date != "" || c.time != "" || c.completeness == "month-only"
      )
    )
  ) {
    let zone = draft.zoneOverride->Option.getOr(draft.suggestions.zone)
    let date =
      Parser.referenceDate(
        draft.context.referenceInstant,
        validZone(zone) ? zone : draft.context.browserTimeZone,
      )->Parser.addDays(1)
    Some({...emptyField, value: date, input: "Tomorrow"})
  } else {
    None
  }
}
let autoField = (draft, name) =>
  best(draft, name)
  ->Option.map(c => {
    let field = {...emptyField, value: c.value}
    name == #start || name == #end ? {...field, input: candidateInput(draft, c)} : field
  })
  ->Option.orElse(defaultDateField(draft, name))
  ->Option.getOr(emptyField)
@genType
let edit = (draft, name, value) =>
  setField(removeSelection(draft, name), name, {value, ownership: #manual, offset: ""})
// The shell captures "now" only when this field is edited. Pure callers may
// use the draft's injected reference instant as a deterministic fallback.
@genType
let editAt = (draft, name, value, referenceInstant) => {
  let next = edit(draft, name, value)
  name == #start && TimeInput.duration(value)->Option.isSome
    ? {...next, start: {...next.start, durationReference: referenceInstant}}
    : next
}
@genType
let reset = (draft, name) => {
  let next = setField(removeSelection(draft, name), name, autoField(draft, name))
  {
    ...next,
    pendingResets: draft.parseStatus == "pending"
      ? Array.concat(next.pendingResets, [name])
      : next.pendingResets,
  }
}
@genType
let describe = (draft: draft, description) => {
  let clear = description == ""
  let clearAuto = field => clear && field.ownership == #auto ? emptyField : field
  let clearTimed = field => {
    let field = clearAuto(field)
    clear &&
    draft.zoneOverride->Option.isNone &&
    draft.suggestions.zone != draft.context.browserTimeZone
      ? {...field, offset: ""}
      : field
  }
  {
    ...draft,
    description,
    revision: draft.revision + 1,
    parseStatus: clear ? "idle" : "pending",
    parseError: "",
    pendingResets: [],
    suggestions: {
      candidates: [],
      contextDates: [],
      warnings: [],
      zone: clear ? draft.context.browserTimeZone : draft.suggestions.zone,
      zoneProvenance: clear ? "Browser fallback" : draft.suggestions.zoneProvenance,
      zoneWarning: clear ? "" : draft.suggestions.zoneWarning,
    },
    title: clearAuto(draft.title),
    start: clearTimed(draft.start),
    end: clearTimed(draft.end),
    location: clearAuto(draft.location),
  }
}
@genType
let effectiveZone = draft => draft.zoneOverride->Option.getOr(draft.suggestions.zone)
@genType
let parseTicket = (draft: draft): ticket => {
  identity: draft.identity,
  revision: draft.revision,
  contextRevision: draft.contextRevision,
}
let current = (draft: draft, ticket: ticket) =>
  draft.identity === ticket.identity &&
  draft.revision == ticket.revision &&
  draft.contextRevision == ticket.contextRevision
@genType
let extract = (draft: draft) =>
  Parser.parse(
    draft.description,
    draft.context.referenceInstant,
    draft.context.browserTimeZone,
    draft.zoneOverride,
  )
@genType
let completeParse = (draft: draft, ticket: ticket, output: Parser.output, applyValues: bool) => {
  if !current(draft, ticket) || draft.parseStatus != "pending" {
    draft
  } else {
    let next = {...draft, parseStatus: "ready", parseError: "", suggestions: output}
    let zoneChanged = effectiveZone(next) != effectiveZone(draft)
    let apply = name => {
      let field = getField(next, name)
      let field = (name == #start || name == #end) && zoneChanged ? {...field, offset: ""} : field
      (applyValues || draft.pendingResets->Array.includes(name)) && field.ownership == #auto
        ? autoField(next, name)
        : field
    }
    {
      ...next,
      pendingResets: [],
      title: apply(#title),
      start: apply(#start),
      end: apply(#end),
      location: apply(#location),
    }
  }
}
@genType
let failParse = (draft: draft, ticket: ticket, error) => {
  if !current(draft, ticket) || draft.parseStatus != "pending" {
    draft
  } else {
    let next = completeParse(
      draft,
      ticket,
      {...draft.suggestions, candidates: [], contextDates: [], warnings: []},
      true,
    )
    {...next, parseStatus: "failed", parseError: error}
  }
}
@genType
let setZone = (draft: draft, zoneOverride) => {
  ...draft,
  zoneOverride,
  contextRevision: draft.contextRevision + 1,
  pendingResets: [],
  parseStatus: draft.description == "" ? "idle" : "pending",
  suggestions: {...draft.suggestions, candidates: [], contextDates: [], warnings: []},
  start: {...draft.start, offset: ""},
  end: {...draft.end, offset: ""},
}
@genType
let selectCandidate = (draft: draft, name, id) => {
  switch alternatives(draft, name)->Array.find(c => c.id == id) {
  | None => draft
  | Some(c) => {
      let old = getField(draft, name)
      // A time-only option can use this field's own manually supplied date,
      // unless explicit source dates conflict. Sibling dates are never borrowed.
      let ownDate = Parser.slice(old.value, 0, 10)
      let dates =
        draft.suggestions.candidates
        ->Array.filter(v => v.field == name && associated(c, v) && v.date != "")
        ->Array.map(v => v.date)
        ->Parser.unique
      let compatible =
        c.completeness == "time-only" &&
        old.ownership == #manual &&
        Parser.has(ownDate, "^\\d{4}-\\d{2}-\\d{2}$") &&
        !(c.inferred->Array.includes("ambiguous-am-pm")) &&
        (Array.length(dates) == 0 || (Array.length(dates) == 1 && dates->Array.includes(ownDate)))
      let value = compatible ? `${ownDate} ${c.time}` : c.value
      let chosen = compatible ? {...c, value, date: ownDate, completeness: "complete"} : c
      let next = edit(draft, name, value)
      {
        ...next,
        selections: Array.concat(
          next.selections,
          [{name, candidate: chosen, revision: draft.revision}],
        ),
      }
    }
  }
}
let currentEvidence = (draft, name) => {
  switch selection(draft, name) {
  | Some(s) if s.revision == draft.revision => Some(s.candidate)
  | _ =>
    draft.suggestions.candidates->Array.find(c =>
      c.field == name && c.value == getField(draft, name).value
    )
  }
}
@genType
let evidenceWarnings = (draft: draft, name) => {
  switch selection(draft, name) {
  | Some(s) if s.revision != draft.revision => [
      "Selected evidence belongs to an earlier Description. Your Manual value is retained.",
    ]
  | Some(s) if s.candidate.inferred->Array.includes("manual-combination") => [
      "Not paired in source",
    ]
  | _ =>
    switch (currentEvidence(draft, #start), currentEvidence(draft, name)) {
    | (Some(start), Some(value)) if name != #start && !associated(start, value) => [
        "Selected fields refer to different activities or occurrences.",
      ]
    | _ => []
    }
  }
}
@genType
let chooseOffset = (draft, name, offset) =>
  setField(draft, name, {...getField(draft, name), ownership: #manual, offset})
@genType
let withUid = (draft: draft, uid) => {...draft, uid: Some(draft.uid->Option.getOr(uid))}
@genType
let populated = (draft: draft) =>
  draft.description != "" ||
  draft.zoneOverride->Option.isSome ||
  draft.allDayOverride->Option.isSome ||
  [draft.title, draft.start, draft.end, draft.location]->Array.some(f =>
    f.value != "" || f.ownership == #manual
  )
@genType
let replaceClipboard = (draft, text, context) =>
  if text == "" {
    draft
  } else if populated(draft) {
    describe(create(context), text)
  } else {
    describe(draft, text)
  }

let selected = (field: field, resolution: resolution) =>
  resolution.choices->Array.find(c =>
    Array.length(resolution.choices) == 1 || c.offset == field.offset
  )
let fieldError = (field: field, resolution: resolution) => {
  if field.value == "" {
    "Enter a complete date or date and time."
  } else if resolution.kind == "invalid" {
    "Enter a valid date and time, or an all-day date (YYYY-MM-DD)."
  } else if resolution.kind == "zone" {
    "Choose a valid IANA time zone."
  } else if resolution.kind == "timed" && Array.length(resolution.choices) == 0 {
    "This local time does not exist (DST gap). Choose another time."
  } else if resolution.kind == "timed" && selected(field, resolution)->Option.isNone {
    "Choose an offset for this repeated local time."
  } else {
    ""
  }
}
type durationEnd = {value: string, offset: string}
@module("./calendarAdapter.ts")
external advanceInstant: (float, string, float) => durationEnd = "advanceInstant"
// Generated Start choices retain an inferred Auto End as elapsed duration.
// The sibling's stored value and ownership stay intact; explicit Ends win.
@genType
let inferredEndFollowsStart = (draft: draft) => {
  let generatedStart =
    selection(draft, #start)
    ->Option.map(s => s.candidate.inferred->Array.includes("generated-suggestion"))
    ->Option.getOr(false)
  generatedStart &&
  draft.end.ownership == #auto &&
  currentEvidence(draft, #end)
  ->Option.map(c => c.inferred->Array.includes("assumed-end"))
  ->Option.getOr(false)
}
let validateBase = (draft: draft): validation => {
  let zone = effectiveZone(draft)
  let startDuration = TimeInput.duration(draft.start.value)
  let (startInput: TimeInput.interpretation, startDurationOffset) = switch startDuration {
  | None => (
      TimeInput.interpret(draft.start.value, draft.context.referenceInstant, zone, false),
      "",
    )
  | Some(d) if d.error != "" => ({value: "", error: d.error}, "")
  | Some(_) if !validZone(zone) => ({value: "", error: "Choose a valid IANA time zone."}, "")
  | Some(d) => {
      let reference = draft.start.durationReference->Option.getOr(draft.context.referenceInstant)
      let result = advanceInstant(parseInstant(reference), zone, d.minutes)
      (
        {
          value: result.value,
          error: result.value == "" ? "This duration exceeds the supported date range." : "",
        },
        result.offset,
      )
    }
  }
  let startField = {
    ...draft.start,
    value: startInput.value,
    offset: startDuration->Option.isSome ? startDurationOffset : draft.start.offset,
  }
  let start = resolve(startField.value, zone)
  let startInstant = selected(startField, start)
  let duration = TimeInput.duration(inferredEndFollowsStart(draft) ? "1hr" : draft.end.value)
  let (endInput: TimeInput.interpretation, durationOffset) = switch duration {
  | None => (TimeInput.interpret(draft.end.value, draft.context.referenceInstant, zone, true), "")
  | Some(d) if d.error != "" => ({value: "", error: d.error}, "")
  | Some(d) =>
    switch startInstant {
    | Some(instant) if startInput.error == "" && start.kind == "timed" => {
        let end = advanceInstant(instant.epoch, zone, d.minutes)
        (
          {
            value: end.value,
            error: end.value == "" ? "This duration exceeds the supported date range." : "",
          },
          end.offset,
        )
      }
    | _ => (
        {value: "", error: "Complete a timed Start, including any DST choice, to use a duration."},
        "",
      )
    }
  }
  let endField = {
    ...draft.end,
    value: endInput.value,
    offset: duration->Option.isSome ? durationOffset : draft.end.offset,
  }
  let end = resolve(endField.value, zone)
  let partialError = (name, field, resolution) => {
    switch selection(draft, name) {
    | Some(s)
      if s.candidate.completeness == "date-only" ||
        s.candidate.completeness == "time-only" => "Complete the missing date/time components, or type an explicit all-day date."
    | _ => fieldError(field, resolution)
    }
  }
  let startError =
    startInput.error != "" ? startInput.error : partialError(#start, startField, start)
  let endError = endInput.error != "" ? endInput.error : partialError(#end, endField, end)
  let startError = draft.parseStatus == "pending" ? "Parsing current Description..." : startError
  let startError =
    start.kind == "timed" &&
    draft.zoneOverride->Option.isNone &&
    draft.suggestions.zoneWarning != ""
      ? draft.suggestions.zoneWarning
      : startError
  let allDay = start.kind == "date"
  let endInstant = selected(endField, end)
  let endError = if startError == "" && endError == "" {
    if start.kind != end.kind {
      "Start and End must both be dates or both include times."
    } else if allDay && end.date < start.date {
      "End date must be on or after Start."
    } else {
      switch (startInstant, endInstant) {
      | (Some(s), Some(e)) if e.epoch <= s.epoch => "End must be after Start."
      | _ => ""
      }
    }
  } else {
    endError
  }
  let event = if startError != "" || endError != "" {
    None
  } else {
    switch (allDay, startInstant, endInstant) {
    | (true, _, _) =>
      Some({
        title: draft.title.value,
        description: draft.description,
        location: draft.location.value,
        zone: validZone(zone) ? zone : draft.context.browserTimeZone,
        allDay,
        start: start.date,
        end: end.nextDate,
      })
    | (false, Some(s), Some(e)) =>
      Some({
        title: draft.title.value,
        description: draft.description,
        location: draft.location.value,
        zone,
        allDay,
        start: s.instant,
        end: e.instant,
      })
    | _ => None
    }
  }
  let warnings = switch event {
  | Some(e) => {
      let past = if allDay {
        e.start <
        localDate(
          draft.context.referenceInstant,
          validZone(zone) ? zone : draft.context.browserTimeZone,
        )
      } else {
        switch startInstant {
        | Some(s) => s.epoch < parseInstant(draft.context.referenceInstant)
        | None => false
        }
      }
      past ? ["Start is in the past."] : []
    }
  | None => []
  }
  {
    allDay,
    event,
    startValue: startInput.value,
    endValue: endInput.value,
    startError,
    endError,
    startChoices: startDuration->Option.isSome ? [] : start.choices,
    endChoices: duration->Option.isSome ? [] : end.choices,
    warnings,
  }
}

@genType
let setAllDay = (draft: draft, allDay) => {...draft, allDayOverride: Some(allDay)}

let fieldDate = (draft, name, interpreted) => {
  if Parser.has(interpreted, "^\\d{4}-\\d{2}-\\d{2}(?:$| )") {
    Parser.slice(interpreted, 0, 10)
  } else {
    let field = getField(draft, name)
    let zone = effectiveZone(draft)
    let zone = validZone(zone) ? zone : draft.context.browserTimeZone
    let candidates = if field.value == "" && field.ownership == #auto {
      alternatives(draft, name)
    } else {
      let parsed = Parser.parse(field.value, draft.context.referenceInstant, zone, Some(zone))
      let ends =
        parsed.candidates->Array.filter(c =>
          c.field == #end && !(c.inferred->Array.includes("assumed-end"))
        )
      name == #end && Array.length(ends) > 0
        ? ends
        : parsed.candidates->Array.filter(c => c.field == #start)
    }
    let dates = candidates->Array.map(c => c.date)->Array.filter(date => date != "")->Parser.unique
    Array.length(dates) == 1 ? dates->Array.get(0)->Option.getOr("") : ""
  }
}

@genType
let validate = (draft: draft): validation => {
  let base = validateBase(draft)
  let mode =
    draft.allDayOverride->Option.orElse(
      base.allDay &&
      base.startError == "" &&
      (TimeInput.calendarDays(draft.end.value)->Option.isSome ||
        (draft.end.value == "" && draft.end.ownership == #auto))
        ? Some(true)
        : None,
    )
  switch mode {
  | None => {
      let noClock =
        draft.description->String.trim != "" &&
        draft.parseStatus == "ready" &&
        draft.start.value == "" &&
        draft.end.value == "" &&
        !(draft.suggestions.candidates->Array.some(c => c.time != "" || c.date != ""))
      {...base, allDay: noClock || (base.allDay && base.startError == "")}
    }
  | Some(false) => {
      let startDateOnly = String.length(base.startValue) == 10
      let endDateOnly = String.length(base.endValue) == 10
      {
        ...base,
        allDay: false,
        event: startDateOnly || endDateOnly ? None : base.event,
        startError: startDateOnly ? "Add a time to Start, or turn on All day." : base.startError,
        endError: endDateOnly ? "Add a time to End, or turn on All day." : base.endError,
      }
    }
  | Some(true) => {
      let startDate = fieldDate(draft, #start, base.startValue)
      let endDuration = TimeInput.duration(draft.end.value)
      let durationOnly = endDuration->Option.map(d => d.error == "")->Option.getOr(false)
      // A duration is retained for timed mode; All day uses an inclusive date.
      let defaultEnd =
        (durationOnly && base.endValue == "") ||
          (draft.end.value == "" && draft.end.ownership == #auto)
      let calendarDays = TimeInput.calendarDays(draft.end.value)
      let endDate = switch calendarDays {
      | Some(days) if startDate != "" => Parser.addDays(startDate, days - 1)
      | _ => defaultEnd ? startDate : fieldDate(draft, #end, base.endValue)
      }
      // A timed midnight end is exclusive. Cover only the days it occupied.
      let endDate =
        calendarDays->Option.isNone &&
        !defaultEnd &&
        Parser.slice(base.endValue, 11, 16) == "00:00" &&
        endDate > startDate
          ? Parser.addDays(endDate, -1)
          : endDate
      let asDates = {
        ...draft,
        start: {...draft.start, value: startDate, offset: ""},
        end: {...draft.end, value: endDate, offset: ""},
        selections: draft.selections->Array.filter(s => s.name != #start && s.name != #end),
      }
      let result = validateBase(asDates)
      {...result, allDay: true}
    }
  }
}

// Freeze a derived preview only at the ownership transition. Start choices
// continue to leave the stored End untouched while it is Auto.
@genType
let setAutomatic = (draft, name, automatic) => {
  if automatic {
    reset(draft, name)
  } else if name == #end && inferredEndFollowsStart(draft) {
    let result = validate(draft)
    let offset =
      result.event
      ->Option.flatMap(event =>
        resolve(result.endValue, effectiveZone(draft)).choices->Array.find(choice =>
          choice.instant == event.end
        )
      )
      ->Option.map(choice => choice.offset)
      ->Option.getOr("")
    let next = edit(draft, #end, result.endValue)
    {...next, end: {...next.end, offset}}
  } else {
    let next = {...draft, pendingResets: draft.pendingResets->Array.filter(n => n != name)}
    setField(next, name, {...getField(next, name), ownership: #manual})
  }
}

@module("./calendarAdapter.ts")
external rangeDuration: (string, string, bool) => int = "rangeDuration"
@genType
let durationLabel = (amount, allDay) => {
  if amount <= 0 {
    ""
  } else if allDay {
    amount == 7 ? "1 week" : `${Int.toString(amount)} ${amount == 1 ? "day" : "days"}`
  } else {
    let hours = amount / 60
    let minutes = mod(amount, 60)
    hours == 0
      ? `${Int.toString(minutes)}m`
      : minutes == 0
      ? `${Int.toString(hours)}h`
      : `${Int.toString(hours)}h ${Int.toString(minutes)}m`
  }
}
let durationValueFrom = (result: validation) =>
  switch result.event {
  | Some(event) => rangeDuration(event.start, event.end, event.allDay)
  | None => 0
  }
@genType
let durationValue = (draft: draft) => durationValueFrom(validate(draft))
@genType
type durationOption = {amount: int, label: string, selected: bool, source: string, custom: bool}
@genType
let durationOptions = (draft: draft): array<durationOption> => {
  let result = validate(draft)
  let actual = durationValueFrom(result)
  let presets = result.allDay ? [1, 2, 3, 7] : [15, 30, 60, 90, 120, 180, 240]
  let starts = resolve(result.startValue, effectiveZone(draft))
  let start = selected(draft.start, starts)
  let derived = alternatives(draft, #end)->Array.filterMap(c => {
    let complete = c.completeness == "complete" || c.completeness == "all-day"
    let amount = if result.startError != "" || !complete {
      0
    } else if result.allDay && c.date != "" {
      let endDate =
        c.time == "00:00" && c.date > result.startValue ? Parser.addDays(c.date, -1) : c.date
      rangeDuration(
        replaceAll(result.startValue, "-", ""),
        replaceAll(Parser.addDays(endDate, 1), "-", ""),
        true,
      )
    } else if c.completeness == "complete" {
      let ends = resolve(c.value, effectiveZone(draft))
      switch (start, ends.choices) {
      | (Some(start), [end]) => rangeDuration(start.instant, end.instant, false)
      | _ => 0
      }
    } else {
      0
    }
    amount > 0 && amount <= (result.allDay ? 1 : 1440)
      ? Some((amount, candidateInput(draft, c)))
      : None
  })
  let amounts = Array.concat(presets, derived->Array.map(((amount, _)) => amount))
  let amounts = actual > 0 ? Array.concat(amounts, [actual]) : amounts
  amounts
  ->Array.toSorted((a, b) => a < b ? -1. : a == b ? 0. : 1.)
  ->Array.reduce([], (options: array<durationOption>, amount) => {
    if options->Array.some(o => o.amount == amount) {
      options
    } else {
      let source =
        derived
        ->Array.find(((value, _)) => value == amount)
        ->Option.map(((_, source)) => source)
        ->Option.getOr("")
      Array.concat(
        options,
        [
          {
            amount,
            label: durationLabel(amount, result.allDay),
            selected: actual == amount,
            source,
            custom: !(presets->Array.includes(amount)) && source == "",
          },
        ],
      )
    }
  })
}
@genType
let selectDuration = (draft: draft, amount) => {
  let result = validate(draft)
  if result.startError != "" || !(durationOptions(draft)->Array.some(o => o.amount == amount)) {
    draft
  } else {
    let text = result.allDay ? `${Int.toString(amount)} days` : durationLabel(amount, false)
    setAllDay(edit(draft, #end, text), result.allDay)
  }
}

@genType
type temporalPart = [#date | #time]
@genType
type temporalParts = {date: string, time: string}
@genType
type temporalOption = {
  value: string,
  selected: bool,
  source: string,
  label: string,
  generated: bool,
  note: string,
  paired: option<bool>,
}
@genType
let temporalParts = (draft: draft, name): temporalParts => {
  let evidence = selection(draft, name)
  switch evidence {
  | Some(s)
    if s.revision == draft.revision &&
      (s.candidate.completeness == "date-only" || s.candidate.completeness == "time-only") => {
      date: s.candidate.date,
      time: s.candidate.time,
    }
  | _ => {
      let result = validate(draft)
      let value = name == #start ? result.startValue : result.endValue
      {
        date: Parser.has(value, "^\\d{4}-\\d{2}-\\d{2}") ? Parser.slice(value, 0, 10) : "",
        time: Parser.has(value, "^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}$")
          ? Parser.slice(value, 11, 16)
          : "",
      }
    }
  }
}
// Context dates remain selectable without participating in Auto ranking.
let sourceTemporalCandidates = (draft, name): array<Parser.candidate> =>
  Array.concat(
    Array.concat(
      alternatives(draft, name),
      draft.suggestions.candidates
      ->Array.filter(c => (c.field == #start || c.field == #end) && c.field != name && c.date != "")
      ->Array.map(c => {
        ...c,
        id: `date:${c.id}`,
        field: name,
        value: c.date,
        time: "",
        completeness: "date-only",
      }),
    ),
    draft.suggestions.contextDates->Array.map(d => {
      let candidate: Parser.candidate = {
        id: `context:${name == #start ? "start" : "end"}:${d.value}`,
        field: name,
        value: d.value,
        date: d.value,
        time: "",
        completeness: "date-only",
        spans: d.spans,
        inferred: [],
        rank: 0,
        groups: [`context:${d.value}`],
        label: d.label,
      }
      candidate
    }),
  )
// Generated choices have no source spans and never enter parser/Auto ranking.
let generated = (c: Parser.candidate) => c.inferred->Array.includes("generated-suggestion")
let temporalCandidates = (draft: draft, name): array<Parser.candidate> => {
  let source = sourceTemporalCandidates(draft, name)
  if draft.description->String.trim == "" || draft.parseStatus != "ready" {
    source
  } else {
    let make = (value, date, time, label): Parser.candidate => {
      id: `generated:${value}`,
      field: name,
      value,
      date,
      time,
      completeness: date == "" ? "time-only" : "date-only",
      spans: [],
      inferred: ["generated-suggestion", date == "" ? "generated-time" : "generated-date"],
      rank: 0,
      groups: ["generated"],
      label,
    }
    let reference = Parser.referenceDate(
      draft.context.referenceInstant,
      validZone(effectiveZone(draft)) ? effectiveZone(draft) : draft.context.browserTimeZone,
    )
    let dates =
      source->Array.some(c => c.date != "")
        ? []
        : [(0, "Today"), (1, "Tomorrow"), (7, "In 7 days"), (30, "In 30 days")]->Array.map(((
            days,
            label,
          )) => {
            let date = Parser.addDays(reference, days)
            make(date, date, "", label)
          })
    let hasExplicitClock =
      draft.suggestions.candidates->Array.some(c =>
        c.time != "" &&
        !(c.inferred->Array.includes("inferred-time")) &&
        !(c.inferred->Array.includes("assumed-end"))
      )
    let times = hasExplicitClock
      ? []
      : ["07:00", "09:00", "12:00", "18:00", "19:00"]->Array.map(time => make(time, "", time, time))
    Array.concat(source, Array.concat(dates, times))
  }
}
@genType
let temporalOptions = (draft: draft, name, part: temporalPart): array<temporalOption> => {
  let current = temporalParts(draft, name)
  let options = temporalCandidates(draft, name)
  let values =
    options
    ->Array.map(c => part == #date ? c.date : c.time)
    ->Array.filter(v => v != "")
    ->Parser.unique
  let values = values->Array.toSorted((a, b) => a == b ? 0. : a < b ? -1. : 1.)
  values->Array.map(value => {
    let matching =
      part == #time && current.date != ""
        ? options->Array.find(c => c.date == current.date && c.time == value)
        : None
    let c =
      matching
      ->Option.orElse(options->Array.find(c => (part == #date ? c.date : c.time) == value))
      ->Option.getOrThrow
    let note =
      part == #date
        ? ""
        : c.inferred->Array.includes("ambiguous-am-pm")
        ? "AM/PM unresolved"
        : c.inferred->Array.includes("assumed-end")
        ? "inferred 60 min"
        : c.inferred->Array.includes("inferred-time")
        ? "inferred time"
        : ""
    {
      value,
      label: generated(c) ? c.label : value,
      generated: generated(c),
      selected: (part == #date ? current.date : current.time) == value,
      paired: part == #time && current.date != "" && !generated(c)
        ? Some(matching->Option.isSome)
        : None,
      source: generated(c)
        ? "Suggested choice (not extracted from Description)"
        : c.groups->Array.some(g => g == "deadline" || Parser.has(g, "^context:"))
        ? c.label
        : candidateInput(draft, c),
      note,
    }
  })
}
@genType
let selectTemporalPart = (draft: draft, name, part: temporalPart, value) => {
  if name != #start && name != #end {
    draft
  } else {
    let options = temporalCandidates(draft, name)
    let current = temporalParts(draft, name)
    switch options->Array.find(c => (part == #date ? c.date : c.time) == value) {
    | None => draft
    | Some(chosen) => {
        let natural =
          part == #date
            ? options->Array.find(c =>
                c.date == value && (c.completeness == "complete" || c.completeness == "all-day")
              )
            : None
        let useAllDay =
          part == #date && natural->Option.map(c => c.completeness == "all-day")->Option.getOr(true)
        let draft = setAllDay(draft, useAllDay)
        let allDay = useAllDay
        let date = part == #date ? value : current.date
        let time = part == #time ? value : natural->Option.map(c => c.time)->Option.getOr("")
        let date =
          date != ""
            ? date
            : options
              ->Array.find(c => !generated(c) && c.date != "" && c.time == time)
              ->Option.orElse(options->Array.find(c => !generated(c) && c.date != ""))
              ->Option.map(c => c.date)
              ->Option.getOr("")
        let time = allDay
          ? ""
          : time != ""
          ? time
          : options
            ->Array.find(c => c.time != "" && c.date == date)
            ->Option.orElse(options->Array.find(c => c.time != ""))
            ->Option.map(c => c.time)
            ->Option.getOr("")
        let exact =
          options->Array.find(c => c.date == date && c.time == time && c.completeness == "complete")
        let clock =
          options
          ->Array.find(c => c.time == time && c.date == date)
          ->Option.orElse(options->Array.find(c => c.time == time && time != ""))
        let ambiguous =
          clock->Option.map(c => c.inferred->Array.includes("ambiguous-am-pm"))->Option.getOr(false)
        let complete = date != "" && time != "" && !ambiguous
        let generatedDate =
          part == #date
            ? generated(chosen)
            : selection(draft, name)
              ->Option.map(s =>
                s.candidate.date == date && s.candidate.inferred->Array.includes("generated-date")
              )
              ->Option.getOr(false)
        let isGenerated =
          generatedDate || generated(chosen) || clock->Option.map(generated)->Option.getOr(false)
        let mixed = complete && exact->Option.isNone && !isGenerated
        let candidate: Parser.candidate = {
          ...chosen,
          id: `manual:${date}:${time}`,
          value: date != "" && time != "" ? `${date} ${time}` : date != "" ? date : time,
          date,
          time,
          completeness: allDay && date != ""
            ? "all-day"
            : complete
            ? "complete"
            : time != ""
            ? "time-only"
            : "date-only",
          groups: exact->Option.map(c => c.groups)->Option.getOr(chosen.groups),
          inferred: mixed
            ? ["manual-combination"]
            : ambiguous
            ? ["ambiguous-am-pm"]
            : isGenerated
            ? Array.concat(
              ["generated-suggestion"],
              generatedDate ? ["generated-date"] : ["generated-time"],
            )
            : [],
        }
        let sourcePart = (c: Parser.candidate, part: temporalPart) => {
          if part == #date && generated(c) {
            c.label
          } else if (
            part == #time &&
              (c.inferred->Array.includes("assumed-end") ||
                c.inferred->Array.includes("inferred-time"))
          ) {
            c.time
          } else {
            let index =
              part == #date
                ? 0
                : c.date == ""
                ? name == #end ? Array.length(c.spans) - 1 : 0
                : name == #end
                ? 2
                : 1
            c.spans
            ->Array.get(index)
            ->Option.map(span => Parser.slice(draft.description, span.start, span.end))
            ->Option.getOr(part == #date ? c.date : c.time)
          }
        }
        let input = switch exact {
        | Some(c) => candidateInput(draft, c)
        | None => {
            let dateSource =
              options
              ->Array.find(c => c.date == date)
              ->Option.map(c => sourcePart(c, #date))
              ->Option.getOr(date)
            let timeSource = clock->Option.map(c => sourcePart(c, #time))->Option.getOr(time)
            date == "" ? timeSource : time == "" ? dateSource : `${dateSource} ${timeSource}`
          }
        }
        let next = edit(draft, name, candidate.value)
        let next = setField(next, name, {...getField(next, name), input: input->String.trim})
        {
          ...next,
          selections: Array.concat(next.selections, [{name, candidate, revision: draft.revision}]),
        }
      }
    }
  }
}

@genType
let googleUrl = (event: normalized) => {
  let query =
    [
      ("action", "TEMPLATE"),
      ("text", event.title),
      ("dates", `${event.start}/${event.end}`),
      ("stz", event.zone),
      ("etz", event.zone),
      ("location", event.location),
      ("details", event.description),
    ]
    ->Array.map(((key, value)) => `${key}=${encode(value)}`)
    ->Array.join("&")
  `https://calendar.google.com/calendar/render?${query}`
}
let escapeText = text =>
  text
  ->replaceAll("\\", "\\\\")
  ->replaceAll("\r\n", "\n")
  ->replaceAll("\r", "\n")
  ->replaceAll("\n", "\\n")
  ->replaceAll(";", "\\;")
  ->replaceAll(",", "\\,")
let fold = text => {
  let (lines, current, _) = codePoints(text)->Array.reduce(([], "", 0), (
    (lines, current, size),
    char,
  ) => {
    let bytes = byteLength(char)
    if size + bytes > 75 {
      (Array.concat(lines, [current]), ` ${char}`, 1 + bytes)
    } else {
      (lines, current ++ char, size + bytes)
    }
  })
  Array.concat(lines, [current])->Array.join("\r\n")
}
@genType
let ics = (event: normalized, uid: string, dtstamp: string) => {
  let dateParam = event.allDay ? ";VALUE=DATE" : ""
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NL Event//Manual Event Draft//EN",
    "BEGIN:VEVENT",
    `UID:${escapeText(uid)}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART${dateParam}:${event.start}`,
    `DTEND${dateParam}:${event.end}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    `LOCATION:${escapeText(event.location)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
  ->Array.map(fold)
  ->Array.join("\r\n") ++ "\r\n"
}

@genType
let partialLabels = (draft: draft, name) =>
  alternatives(draft, name)
  ->Array.filter(c =>
    c.completeness == "month-only" ||
      (c.completeness == "date-only" && c.inferred->Array.some(i => Parser.has(i, "^vague-")))
  )
  ->Array.map(c => c.completeness == "month-only" ? c.label : `${c.date}: ${c.label}`)
  ->Parser.unique
