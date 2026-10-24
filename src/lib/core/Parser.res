@genType
type fieldName = [#title | #start | #end | #location]
@genType
type span = {start: int, end: int}
@genType
type candidate = {
  id: string,
  field: fieldName,
  value: string,
  date: string,
  time: string,
  completeness: string,
  spans: array<span>,
  inferred: array<string>,
  rank: int,
  groups: array<string>,
  label: string,
}
@genType
type output = {
  candidates: array<candidate>,
  zone: string,
  zoneProvenance: string,
  zoneWarning: string,
  warnings: array<string>,
}
type lexical = {text: string, groups: array<string>, start: int, end: int}
type parts = {year: int, month: int, day: int, weekday: int}
@module("./primitives.ts") external matches: (string, string) => array<lexical> = "matches"
@module("./primitives.ts") external slice: (string, int, int) => string = "slice"
@module("./primitives.ts") external trim: string => string = "trim"
@module("./primitives.ts") external lower: string => string = "lower"
@module("./primitives.ts") external number: string => int = "number"
@module("./calendarAdapter.ts") external referenceDate: (string, string) => string = "referenceDate"
@module("./calendarAdapter.ts") external dateParts: string => parts = "dateParts"
@module("./calendarAdapter.ts") external makeDate: (int, int, int) => string = "makeDate"
@module("./calendarAdapter.ts") external addDays: (string, int) => string = "addDays"
@module("./calendarAdapter.ts") external distance: (string, string) => int = "distance"
@module("./calendarAdapter.ts") external elapsedEnd: (string, string, int) => string = "elapsedEnd"
@module("./calendarAdapter.ts") external validZone: string => bool = "validZone"
@module("./primitives.ts") external replaceAll: (string, string, string) => string = "replaceAll"
let group = (m: lexical, i) => m.groups->Array.get(i)->Option.getOr("")
let has = (text, pattern) => Array.length(matches(text, pattern)) > 0
let pad = n => n < 10 ? `0${Int.toString(n)}` : Int.toString(n)
let unique = values =>
  values->Array.reduce([], (acc, v) => acc->Array.includes(v) ? acc : Array.concat(acc, [v]))
let weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
let weekday = text => {
  let english = matches(
    lower(text),
    "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun",
  )
  switch english->Array.get(0) {
  | Some(m) => weekdays->Array.findIndex(v => has(m.text, `^${v}`)) + 1
  | None => {
      let korean = matches(text, "([월화수목금토일])(?:요일|\\))")
      switch korean->Array.get(0) {
      | Some(m) =>
        ["월", "화", "수", "목", "금", "토", "일"]->Array.findIndex(v =>
          v == group(m, 1)
        ) + 1
      | None => 0
      }
    }
  }
}
type dateEvidence = {date: string, span: span, inferred: array<string>, mismatch: bool}
let inferDate = (year, month, day, dayOfWeek, reference, sourceSpan): dateEvidence => {
  let years =
    year != 0
      ? [year]
      : [dateParts(reference).year - 1, dateParts(reference).year, dateParts(reference).year + 1]
  let dates = years->Array.map(y => makeDate(y, month, day))->Array.filter(v => v != "")
  let consistent = dates->Array.filter(d => dayOfWeek == 0 || dateParts(d).weekday == dayOfWeek)
  let eligible = Array.length(consistent) > 0 ? consistent : dates
  let sorted = eligible->Array.toSorted((a, b) => {
    let diff = distance(a, reference) - distance(b, reference)
    diff == 0 ? String.compare(a, b) : Int.toFloat(diff)
  })
  {
    date: sorted->Array.get(0)->Option.getOr(""),
    span: sourceSpan,
    inferred: year == 0 ? ["inferred-year"] : [],
    mismatch: dayOfWeek != 0 && Array.length(consistent) == 0,
  }
}
let monthNames = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]
let dateEvidence = (line: lexical, reference, seasonYear) => {
  let text = line.text
  let explicit = matches(
    text,
    "(?<![\\d])(?:(\\d{4})[./-])?(\\d{1,2})[./-](\\d{1,2})(?![\\d])|(?:(\\d{4})년\\s*)?(\\d{1,2})월\\s*(\\d{1,2})일",
  )
  let english = matches(
    text,
    "(January|February|March|April|May|June|July|August|September|October|November|December)\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?",
  )
  let numeric = explicit->Array.map(m => {
    let korean = group(m, 5) != ""
    let y = korean ? group(m, 4) : group(m, 1)
    let month = number(group(m, korean ? 5 : 2))
    let day = number(group(m, korean ? 6 : 3))
    inferDate(
      y == "" ? seasonYear : number(y),
      month,
      day,
      weekday(text),
      reference,
      {start: line.start + m.start, end: line.start + m.end},
    )
  })
  let named =
    english->Array.map(m =>
      inferDate(
        group(m, 3) == "" ? seasonYear : number(group(m, 3)),
        monthNames->Array.findIndex(v => v == lower(group(m, 1))) + 1,
        number(group(m, 2)),
        weekday(text),
        reference,
        {start: line.start + m.start, end: line.start + m.end},
      )
    )
  let relative = matches(
    text,
    "day after tomorrow|tomorrow|today|모레|내일|오늘|(?:next|this)\\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)|(?:이번\\s*주|다음\\s*주)\\s*[월화수목금토일]요일",
  )
  let relatives = relative->Array.map(m => {
    let delta = if has(m.text, "day after tomorrow|모레") {
      2
    } else if has(m.text, "tomorrow|내일") {
      1
    } else if has(m.text, "today|오늘") {
      0
    } else {
      let next = has(m.text, "next|다음") ? 7 : 0
      weekday(m.text) - dateParts(reference).weekday + next
    }
    {
      date: addDays(reference, delta),
      span: {start: line.start + m.start, end: line.start + m.end},
      inferred: [],
      mismatch: false,
    }
  })
  [numeric, named, relatives]->Array.flatMap(v => v)->Array.filter(d => d.date != "")
}
type clock = {time: string, minutes: int, span: span, ambiguous: bool}
let clocks = (line: lexical, evening) => {
  let tokens = matches(
    line.text,
    "(?<![\\d:/])(?:(오전|오후|저녁|아침)\\s*)?(\\d{1,2})(?::(\\d{2})|시(?:\\s*(반|\\d{1,2}분))?)\\s*(am|pm)?|(?<![\\d:/])(\\d{1,2})\\s*(am|pm)\\b|\\bmidnight\\b",
  )
  // A bare first hour is meaningful only as part of an explicit range.
  let bare = matches(
    line.text,
    "(?<![\\d:])(\\d{1,2})\\s*(?=[~–-]\\s*\\d{1,2}(?::\\d{2})?\\s*(?:am|pm))",
  )
  let all = Array.concat(tokens, bare)->Array.toSorted((a, b) => Int.toFloat(a.start - b.start))
  let sharedPM = has(line.text, "pm\\b|오후|저녁") || evening
  let sharedAM = has(line.text, "am\\b|오전|아침")
  all
  ->Array.map(m => {
    let hourText = group(m, 2) != "" ? group(m, 2) : group(m, 6) != "" ? group(m, 6) : group(m, 1)
    let midnight = lower(m.text) == "midnight"
    let h = midnight ? 0 : number(hourText)
    let minute =
      group(m, 4) == "반"
        ? 30
        : group(m, 4) != ""
        ? number(replaceAll(group(m, 4), "분", ""))
        : number(group(m, 3))
    let explicitPM = has(m.text, "pm|오후|저녁")
    let explicitAM = has(m.text, "am|오전|아침")
    // 12:15 before a PM end means noon, rather than 00:15.
    let pm = explicitPM || (!explicitAM && sharedPM)
    let am = explicitAM || (!explicitPM && sharedAM && !sharedPM)
    let hour = if midnight {
      0
    } else if pm && h < 12 {
      h + 12
    } else if am && h == 12 {
      0
    } else {
      h
    }
    let explicit24 = has(m.text, "^0\\d:") || has(line.text, "(?:1[3-9]|2[0-3]):")
    let ambiguous = !midnight && !pm && !am && h < 13 && !explicit24
    {
      time: `${pad(hour)}:${pad(minute)}`,
      minutes: minute > 59 || h > 23 ? -1 : hour * 60 + minute,
      span: {start: line.start + m.start, end: line.start + m.end},
      ambiguous,
    }
  })
  ->Array.filter(c => c.minutes >= 0 && c.minutes < 1440)
}

@genType
let parse = (text, referenceInstant, browserZone, override: option<string>): output => {
  let lines = matches(text, "[^\\r\\n]+")
  let ianas =
    matches(text, "\\b[A-Za-z_]+/[A-Za-z_]+(?:/[A-Za-z_]+)?\\b")
    ->Array.map(m => m.text)
    ->Array.filter(validZone)
    ->unique
  let city = has(text, "(?:St\\.?\\s*Paul|Minneapolis),?\\s*MN")
  let zoneWarning =
    Array.length(ianas) > 1
      ? "Conflicting source zones. Choose an IANA time zone."
      : has(text, "(?:time\\s*zone|timezone)\\s*:") && Array.length(ianas) == 0
      ? "Unrecognized source zone. Confirm an IANA time zone."
      : has(text, "Location:\\s*(?:London|Paris|Tokyo|Berlin|Sydney)|\\b(?:CST|EST|PST|BST)\\b")
      ? "Confirm the event's IANA time zone."
      : ""
  let suggestedZone = ianas->Array.get(0)->Option.getOr(city ? "America/Chicago" : browserZone)
  let zone = override->Option.getOr(suggestedZone)
  let reference = referenceDate(referenceInstant, validZone(zone) ? zone : browserZone)
  let season = lines->Array.filter(l => has(l.text, "운영기간|season"))
  let seasonYear =
    season
    ->Array.flatMap(l => matches(l.text, "\\d{4}"))
    ->Array.get(0)
    ->Option.map(m => number(m.text))
    ->Option.getOr(0)
  let excluded = line =>
    has(
      line,
      "운영기간|season|registration|registrations|sign-ups|deadline|마감|참가비|입금|계좌|https?://",
    )
  let dateLines =
    lines->Array.filter(l =>
      !excluded(l.text) && !has(l.text, "^(?:제목|Title|장소|주소|Location)\\s*[:：]?|^📍")
    )
  let dates = dateLines->Array.flatMap(l => dateEvidence(l, reference, seasonYear))
  let distinctDates = dates->Array.map(d => d.date)->unique
  let schedule = has(text, "연습일정")
  let sharedDate = Array.length(distinctDates) == 1 ? dates->Array.get(0) : None
  let evening = has(text, "저녁|오후")
  let candidates = ref([])
  let add = (
    field: fieldName,
    value,
    date,
    time,
    completeness,
    spans,
    inferred,
    rank,
    groups,
    label,
  ) => {
    if value != "" {
      let fieldText = switch field {
      | #title => "title"
      | #start => "start"
      | #end => "end"
      | #location => "location"
      }
      let id = `${fieldText}:${value}:${groups->Array.join("+")}`
      candidates :=
        Array.concat(
          candidates.contents,
          [{id, field, value, date, time, completeness, spans, inferred, rank, groups, label}],
        )
    }
  }
  // Only labeled values and credible headings become title/location evidence.
  lines->Array.forEachWithIndex((line, index) => {
    let titleLabel = matches(line.text, "^\\s*(?:제목|Title)\\s*[:：]\\s*(.+)$")->Array.get(0)
    let locationLabel =
      matches(
        line.text,
        "^\\s*(?:장소|주소|Location)\\s*[:：]?\\s+(.+)$|^\\s*📍\\s*(.+)$",
      )->Array.get(0)
    let sourceSpan = [{start: line.start, end: line.end}]
    switch titleLabel {
    | Some(m) => add(#title, group(m, 1), "", "", "text", sourceSpan, [], 200, ["overall"], "Title")
    | None =>
      if index == 0 && !has(line.text, "^(?:날짜|시간|일시|When|Tomorrow|All day)|:") {
        add(#title, trim(line.text), "", "", "text", sourceSpan, [], 100, ["overall"], "Heading")
      }
    }
    switch locationLabel {
    | Some(m) =>
      add(
        #location,
        group(m, 1) != "" ? group(m, 1) : group(m, 2),
        "",
        "",
        "text",
        sourceSpan,
        [],
        200,
        ["overall"],
        "Location",
      )
    | None =>
      if has(line.text, "^공간") {
        add(#location, line.text, "", "", "text", sourceSpan, [], 80, ["overall"], "Venue")
      }
    }
  })
  lines->Array.forEachWithIndex((line, index) => {
    if (
      !excluded(line.text) &&
      !has(line.text, "^(?:제목|Title|장소|주소|Location)\\s*[:：]?|^📍")
    ) {
      let localDates = dateEvidence(line, reference, seasonYear)
      let lineClocks = clocks(line, evening)
      let allDay = has(line.text, "all[ -]day|종일")
      let labeled = has(line.text, "일시|날짜|시간|Date and time|When:|All day")
      let overall = labeled && !has(line.text, "강습|워크샵|소셜")
      let activity = has(line.text, "Class\\s*([1-4])")
        ? `class-${matches(line.text, "Class\\s*([1-4])")
            ->Array.get(0)
            ->Option.map(m => group(m, 1))
            ->Option.getOr("")}`
        : has(line.text, "무료강습")
        ? "free-lesson"
        : has(line.text, "Workshop|워크샵")
        ? "mini-workshop"
        : has(line.text, "Social|소셜")
        ? "social"
        : has(line.text, "연습:")
        ? "practice"
        : overall
        ? "overall"
        : `activity-${Int.toString(index)}`
      let rank = overall ? 200 : activity == "practice" ? 180 : activity == "free-lesson" ? 70 : 100
      let label = trim(line.text)
      let dateOptions = if Array.length(localDates) > 0 {
        localDates
      } else if schedule {
        dates
      } else {
        sharedDate->Option.map(d => [d])->Option.getOr([])
      }
      let startClock = lineClocks->Array.get(0)
      let endClock = lineClocks->Array.get(1)
      if allDay && Array.length(localDates) > 0 {
        let first = localDates->Array.get(0)->Option.getOrThrow
        let last = localDates->Array.get(1)->Option.getOr(first)
        add(
          #start,
          first.date,
          first.date,
          "",
          "all-day",
          [first.span],
          first.inferred,
          rank,
          [activity],
          label,
        )
        add(
          #end,
          last.date,
          last.date,
          "",
          "all-day",
          [last.span],
          last.inferred,
          rank,
          [activity],
          label,
        )
      } else {
        switch startClock {
        | Some(start) => {
            let applicableDates =
              Array.length(dateOptions) > 0
                ? dateOptions
                : [{date: "", span: start.span, inferred: [], mismatch: false}]
            applicableDates->Array.forEach(d => {
              let groupId = `${activity}:${d.date}`
              let complete = d.date != "" && !start.ambiguous
              let value = complete ? `${d.date} ${start.time}` : start.time
              let spans = d.date == "" ? [start.span] : [d.span, start.span]
              let inferred = Array.concat(d.inferred, start.ambiguous ? ["ambiguous-am-pm"] : [])
              add(
                #start,
                value,
                d.date,
                start.time,
                complete ? "complete" : "time-only",
                spans,
                inferred,
                rank,
                [groupId],
                label,
              )
              if activity != "overall" && !overall && !has(line.text, "^(?:시간|연습:)") {
                let before = trim(slice(line.text, 0, start.span.start - line.start))
                let lastClock = endClock->Option.getOr(start)
                let after = trim(
                  slice(line.text, lastClock.span.end - line.start, line.text->String.length),
                )
                let heading = before != "" && !has(before, "^[^\\p{L}]*$") ? before : after
                if heading != "" {
                  add(
                    #title,
                    heading,
                    "",
                    "",
                    "text",
                    [{start: line.start, end: line.end}],
                    [],
                    rank - 20,
                    [groupId],
                    label,
                  )
                }
              }
              switch endClock {
              | Some(ending) => {
                  let endDate =
                    d.date != "" && ending.minutes <= start.minutes ? addDays(d.date, 1) : d.date
                  add(
                    #end,
                    complete && !ending.ambiguous ? `${endDate} ${ending.time}` : ending.time,
                    endDate,
                    ending.time,
                    complete && !ending.ambiguous ? "complete" : "time-only",
                    Array.concat(spans, [ending.span]),
                    inferred,
                    rank,
                    [groupId],
                    label,
                  )
                }
              | None =>
                if complete {
                  let ending = elapsedEnd(value, zone, 60)
                  if ending != "" {
                    add(
                      #end,
                      ending,
                      slice(ending, 0, 10),
                      slice(ending, 11, 16),
                      "complete",
                      spans,
                      Array.concat(inferred, ["assumed-end"]),
                      rank - 1,
                      [groupId],
                      "Inferred 60-minute duration",
                    )
                  }
                }
              }
            })
          }
        | None =>
          if Array.length(localDates) > 0 && !schedule {
            localDates->Array.forEach(d =>
              add(
                #start,
                d.date,
                d.date,
                "",
                "date-only",
                [d.span],
                d.inferred,
                50,
                [activity],
                has(line.text, "evening|저녁")
                  ? "Date known; evening has no exact time"
                  : "Date known; time missing",
              )
            )
          }
        }
      }
    }
  })
  // Merge duplicate values while preserving every association and source span.
  let ranked = candidates.contents->Array.toSorted((a, b) => {
    let rank = b.rank - a.rank
    rank == 0 ? String.compare(a.value, b.value) : Int.toFloat(rank)
  })
  let merged = ranked->Array.reduce([], (acc, c) => {
    switch acc->Array.find(v =>
      v.field == c.field && v.value == c.value && v.completeness == c.completeness
    ) {
    | None => Array.concat(acc, [c])
    | Some(_) =>
      acc->Array.map(v =>
        v.field == c.field && v.value == c.value && v.completeness == c.completeness
          ? {
              ...v,
              spans: Array.concat(v.spans, c.spans),
              groups: unique(Array.concat(v.groups, c.groups)),
              inferred: unique(Array.concat(v.inferred, c.inferred)),
            }
          : v
      )
    }
  })
  let warnings = unique(
    [
      merged->Array.flatMap(c => c.inferred),
      dates->Array.some(d => d.mismatch) ? ["weekday-mismatch"] : [],
      Array.length(distinctDates) > 1 && !schedule && !has(text, "all[ -]day")
        ? ["multiple-source-dates"]
        : [],
      merged->Array.some(c => c.field == #start && c.date != "" && c.date < reference)
        ? ["past-event"]
        : [],
      has(text, "무료강습") && has(text, "저녁")
        ? ["Inferred lesson end may overlap the social."]
        : [],
    ]->Array.flatMap(v => v),
  )
  {
    candidates: merged,
    zone: suggestedZone,
    zoneProvenance: Array.length(ianas) > 0
      ? "Source IANA zone"
      : city
      ? "Inferred from recognized city"
      : "Browser fallback",
    zoneWarning,
    warnings,
  }
}
