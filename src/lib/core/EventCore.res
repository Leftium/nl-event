@genType
type fieldName = Parser.fieldName
@genType
type ownership = [#auto | #manual]
@genType
type field = {value: string, ownership: ownership, offset: string}
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
  event: option<normalized>,
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
  uid: None,
  identity: {reference: context.referenceInstant},
  revision: 0,
  contextRevision: 0,
  parseStatus: "idle",
  parseError: "",
  suggestions: {
    candidates: [],
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
    let coherent = switch chosenStart {
    | Some(start) if name == #title || name == #end => associated(start, c)
    | _ => true
    }
    complete && coherent
  })
}
let autoField = (draft, name) =>
  best(draft, name)->Option.map(c => {...emptyField, value: c.value})->Option.getOr(emptyField)
@genType
let edit = (draft, name, value) =>
  setField(removeSelection(draft, name), name, {value, ownership: #manual, offset: ""})
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
      {...draft.suggestions, candidates: [], warnings: []},
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
  suggestions: {...draft.suggestions, candidates: [], warnings: []},
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
  [draft.title, draft.start, draft.end, draft.location]->Array.some(f =>
    f.value != "" || f.ownership == #manual
  )
@genType
let replaceClipboard = (draft, text, confirmed, context) =>
  if text == "" || (populated(draft) && !confirmed) {
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
    "Use a valid YYYY-MM-DD or YYYY-MM-DD HH:mm value."
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
@genType
let validate = (draft: draft): validation => {
  let zone = effectiveZone(draft)
  let start = resolve(draft.start.value, zone)
  let end = resolve(draft.end.value, zone)
  let partialError = (name, field, resolution) => {
    switch selection(draft, name) {
    | Some(s)
      if s.candidate.completeness == "date-only" ||
        s.candidate.completeness == "time-only" => "Complete the missing date/time components, or type an explicit all-day date."
    | _ => fieldError(field, resolution)
    }
  }
  let startError = partialError(#start, draft.start, start)
  let endError = partialError(#end, draft.end, end)
  let startError = draft.parseStatus == "pending" ? "Parsing current Description..." : startError
  let startError =
    start.kind == "timed" &&
    draft.zoneOverride->Option.isNone &&
    draft.suggestions.zoneWarning != ""
      ? draft.suggestions.zoneWarning
      : startError
  let allDay = start.kind == "date"
  let startInstant = selected(draft.start, start)
  let endInstant = selected(draft.end, end)
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
  {event, startError, endError, startChoices: start.choices, endChoices: end.choices, warnings}
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
