@genType
type interpretation = {value: string, error: string}

// Field text is independent input. Never borrow a sibling date or an inferred
// duration: "tomorrow at 8pm" means 8pm even when typed into End.
@genType
let interpret = (text, referenceInstant, zone, isEnd): interpretation => {
  let text = Parser.trim(text)
  let canonical = Parser.replaceAll(text, "T", " ")
  if text == "" {
    {value: "", error: "Enter a date and time, or an all-day date."}
  } else if Parser.has(canonical, "^\\d{4}-\\d{2}-\\d{2}( \\d{2}:\\d{2})?$") {
    // Calendar validation handles impossible dates, DST and invalid zones.
    {value: canonical, error: ""}
  } else if Parser.has(text, "(?:\\dZ|[+-]\\d{2}:?\\d{2})$") {
    {value: "", error: "Enter the event's local time and choose its time zone below."}
  } else if !Parser.validZone(zone) {
    {value: "", error: "Choose a valid IANA time zone."}
  } else {
    let parsed = Parser.parse(text, referenceInstant, zone, Some(zone))
    if parsed.zoneWarning != "" || parsed.zone != zone {
      {value: "", error: "Choose the event's time zone below, then enter its local date and time."}
    } else {
      let explicitEnds =
        parsed.candidates->Array.filter(c =>
          c.field == #end && !(c.inferred->Array.includes("assumed-end"))
        )
      let evidence =
        isEnd && Array.length(explicitEnds) > 0
          ? explicitEnds
          : parsed.candidates->Array.filter(c => c.field == #start)
      let complete =
        evidence->Array.filter(c => c.completeness == "complete" || c.completeness == "all-day")
      let values = complete->Array.map(c => c.value)->Parser.unique
      switch values->Array.get(0) {
      | Some(value) if Array.length(values) == 1 => {value, error: ""}
      | Some(_) => {
          value: "",
          error: "This text has multiple dates or times. Enter one date and time.",
        }
      | None =>
        switch evidence->Array.get(0) {
        | Some(c) if c.inferred->Array.includes("ambiguous-am-pm") => {
            value: "",
            error: "Specify AM or PM, or use a 24-hour time.",
          }
        | Some(c) if c.date != "" => {
            value: "",
            error: `${c.date}: time missing. Add a time or say all day.`,
          }
        | Some(c) if c.time != "" => {
            value: "",
            error: `${c.time}: date missing. Add a date, such as tomorrow.`,
          }
        | _ => {
            value: "",
            error: "Could not interpret this date/time. Try tomorrow at 7pm or YYYY-MM-DD HH:mm.",
          }
        }
      }
    }
  }
}

@genType
type duration = {minutes: float, error: string}
@module("./primitives.ts") external asFloat: string => float = "number"
@scope("Math") @val external floor: float => float = "floor"

// A fully matched unit expression is explicit duration input, rather than a
// clock time. Keep malformed or nonpositive durations out of date parsing.
let duration = text => {
  let amount = "([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))"
  let unit = "(hours?|hrs?|h|minutes?|mins?|m)"
  let pattern = `${amount}\\s*${unit}`
  if !Parser.has(text, `^\\s*(?:${pattern}\\s*)+$`) {
    None
  } else {
    let parts = Parser.matches(text, pattern)
    let minutes = parts->Array.reduce(0., (sum, part) => {
      let value = asFloat(Parser.group(part, 1))
      sum +. value *. (Parser.has(Parser.group(part, 2), "^h") ? 60. : 1.)
    })
    let negative = parts->Array.some(part => asFloat(Parser.group(part, 1)) < 0.)
    let error = if negative || minutes <= 0. || minutes > 9007199254740991. {
      "Use a positive duration, such as 4hr or 90min."
    } else if floor(minutes) != minutes {
      "Use a duration in whole minutes, such as 1.5hr or 90min."
    } else {
      ""
    }
    Some({minutes, error})
  }
}

let calendarDays = text => {
  let matches = Parser.matches(Parser.lower(text), "^\\s*(\\d+)\\s*(days?|d|weeks?|w)\\s*$")
  switch matches->Array.get(0) {
  | Some(m) => {
      let amount = asFloat(Parser.group(m, 1)) *. (Parser.has(Parser.group(m, 2), "^w") ? 7. : 1.)
      amount > 0. && amount <= 3652059. ? Some(Int.fromFloat(amount)) : None
    }
  | None => None
  }
}
