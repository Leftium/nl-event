@genType
type fieldName = [#title | #start | #end | #location]
@genType
type ownership = [#auto | #manual]
@genType
type field = {value: string, ownership: ownership, offset: string}
@genType
type context = {referenceInstant: string, browserTimeZone: string}
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
@genType
let edit = (draft, name, value) => setField(draft, name, {value, ownership: #manual, offset: ""})
@genType
let reset = (draft, name) => setField(draft, name, emptyField)
@genType
let describe = (draft: draft, description) => {
  let clearAuto = field => field.ownership == #auto ? emptyField : field
  {
    ...draft,
    description,
    title: clearAuto(draft.title),
    start: clearAuto(draft.start),
    end: clearAuto(draft.end),
    location: clearAuto(draft.location),
  }
}
@genType
let effectiveZone = draft => draft.zoneOverride->Option.getOr(draft.context.browserTimeZone)
@genType
let setZone = (draft: draft, zoneOverride) => {
  ...draft,
  zoneOverride,
  start: {...draft.start, offset: ""},
  end: {...draft.end, offset: ""},
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
  let startError = fieldError(draft.start, start)
  let endError = fieldError(draft.end, end)
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
