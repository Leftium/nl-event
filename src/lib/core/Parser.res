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
type contextDate = {value: string, spans: array<span>, label: string}
@genType
type output = {
  contextDates: array<contextDate>,
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
    "\\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\\b",
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
let relativeDurations = text =>
  matches(text, "\\bin\\s+(\\d+)\\s*(days?|weeks?|hours?|hrs?|minutes?|mins?)\\b(?!\\s*\\d)")
let calendarDuration = (m: lexical) => has(group(m, 2), "^(?:day|week)")
@module("./calendarAdapter.ts")
external advanceReference: (string, string, int) => string = "advanceReference"

let monthList = text =>
  matches(text, "^\\s*(\\d{1,2})월\\s*(\\d{1,2}(?:\\s*,\\s*\\d{1,2})+)\\s*$")->Array.get(0)
let dateEvidence = (line: lexical, reference, seasonYear) => {
  let text = line.text
  let explicit = matches(
    text,
    "(?<![\\d])(?:(\\d{4})[./-])?(\\d{1,2})[./-](\\d{1,2})(?![\\d])|(?:(\\d{4})년\\s*)?(\\d{1,2})월\\s*(\\d{1,2})일",
  )
  let english = matches(
    text,
    "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?",
  )
  let numeric =
    explicit
    ->Array.filter(m =>
      !has(
        slice(text, m.end, String.length(text)),
        "^\\s*(?:days?|weeks?|hours?|hrs?|minutes?|mins?)\\b",
      )
    )
    ->Array.map(m => {
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
        monthNames->Array.findIndex(v => has(v, `^${lower(group(m, 1))}`)) + 1,
        number(group(m, 2)),
        weekday(text),
        reference,
        {start: line.start + m.start, end: line.start + m.end},
      )
    )
  let relative = matches(
    text,
    "\\b(?:day after tomorrow|tomorrow|today|(?:next|this)\\s+(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))\\b|모레|내일|오늘|(?:이번\\s*주|다음\\s*주)\\s*[월화수목금토일]요일",
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
  let durations =
    relativeDurations(text)
    ->Array.filter(calendarDuration)
    ->Array.map(m => {
      date: addDays(reference, number(group(m, 1)) * (has(group(m, 2), "^week") ? 7 : 1)),
      span: {start: line.start + m.start, end: line.start + m.end},
      inferred: [],
      mismatch: false,
    })
  let listed =
    monthList(text)
    ->Option.map(m => {
      let days = matches(group(m, 2), "\\d{1,2}")
      days->Array.map(day =>
        inferDate(
          seasonYear,
          number(group(m, 1)),
          number(day.text),
          weekday(text),
          reference,
          {start: line.start + m.start, end: line.start + m.end},
        )
      )
    })
    ->Option.getOr([])
  [numeric, named, relatives, durations, listed]
  ->Array.flatMap(v => v)
  ->Array.filter(d => d.date != "")
}
type englishEvidence = {start: int, end: int, unit: string, offset: int, day: int, period: string}
@module("./englishDatesAdapter.ts")
external recognizeEnglishDates: (string, string, string) => array<englishEvidence> =
  "recognizeEnglishDates"

type clock = {time: string, minutes: int, span: span, ambiguous: bool}
let clocks = (line: lexical, evening) => {
  let tokens = matches(
    line.text,
    "(?<![\\d:/])(?:(오전|오후|저녁|아침)\\s*)?(\\d{1,2})(?::(\\d{2})|시(?:\\s*(반|\\d{1,2}분))?)\\s*([ap]m?\\b)?|(?<![\\d:/])(\\d{1,2})\\s*([ap]m?)\\b|\\bmidnight\\b",
  )
  // A bare first hour is meaningful only as part of an explicit range.
  let bare = matches(
    line.text,
    "(?<![\\d:])(\\d{1,2})\\s*(?=[~–-]\\s*\\d{1,2}(?::\\d{2})?\\s*(?:[ap]m?)\\b)",
  )
  let all = Array.concat(tokens, bare)->Array.toSorted((a, b) => Int.toFloat(a.start - b.start))
  let sharedPM = has(line.text, "(?<=\\d)\\s*p(?:m)?\\b|오후|저녁") || evening
  let sharedAM = has(line.text, "(?<=\\d)\\s*a(?:m)?\\b|오전|아침")
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
    let explicitPM = has(m.text, "p(?:m)?\\b|오후|저녁")
    let explicitAM = has(m.text, "(?<=\\d)\\s*a(?:m)?\\b|오전|아침")
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
    let invalidMeridiem = has(m.text, "[ap]m?\\b") && (h < 1 || h > 12)
    let explicit24 = has(m.text, "^0\\d:") || has(line.text, "(?:1[3-9]|2[0-3]):")
    let ambiguous = !midnight && !pm && !am && h < 13 && !explicit24
    {
      time: `${pad(hour)}:${pad(minute)}`,
      minutes: minute > 59 || h > 23 || invalidMeridiem ? -1 : hour * 60 + minute,
      span: {start: line.start + m.start, end: line.start + m.end},
      ambiguous,
    }
  })
  ->Array.filter(c => c.minutes >= 0 && c.minutes < 1440)
}

let headingTitle = (line: lexical, reference, seasonYear, evening, englishSpans: array<span>) => {
  let spans = Array.concat(
    Array.concat(dateEvidence(line, reference, seasonYear)->Array.map(d => d.span), englishSpans),
    Array.concat(
      clocks(line, evening)->Array.map(c => c.span),
      relativeDurations(line.text)
      ->Array.filter(m => !calendarDuration(m))
      ->Array.map(m => {
        start: line.start + m.start,
        end: line.start + m.end,
      }),
    ),
  )
  let spans =
    unique(spans)->Array.filter(s =>
      !(
        spans->Array.some(other =>
          other.start <= s.start &&
          other.end >= s.end &&
          (other.start < s.start || other.end > s.end)
        )
      )
    )
  let cleaned =
    spans
    ->Array.toSorted((a, b) => Int.toFloat(b.start - a.start))
    ->Array.reduce(line.text, (text, span) => {
      slice(text, 0, span.start - line.start) ++
      slice(text, span.end - line.start, String.length(text))
    })
  let cleaned =
    Array.length(spans) > 0
      ? matches(
          cleaned,
          "\\b(?:in the )?(?:tonight|morning|afternoon|evening|night)\\b|(?:아침|오후|저녁)",
        )->Array.reduce(cleaned, (text, m) => replaceAll(text, m.text, ""))
      : cleaned
  let cleaned =
    matches(cleaned, "\\b(?:at|on|from|to)\\s*$|^[\\s,:;~–-]+|[\\s,:;~–-]+$")
    ->Array.toSorted((a, b) => Int.toFloat(b.start - a.start))
    ->Array.reduce(cleaned, (text, m) =>
      slice(text, 0, m.start) ++ slice(text, m.end, String.length(text))
    )
  matches(cleaned, "\\s{2,}")
  ->Array.reduce(cleaned, (text, m) => replaceAll(text, m.text, " "))
  ->trim
}

// Keep lexical offsets while removing presentation only at the edges.
let locationContent = (line: lexical): lexical => {
  let leading = matches(line.text, "^[\\s~*#>•·✓✔☑✅-]+")->Array.get(0)
  let start = leading->Option.map(m => m.end)->Option.getOr(0)
  let rest = slice(line.text, start, String.length(line.text))
  let trailing = matches(rest, "[\\s*~]+$")->Array.get(0)
  let end = trailing->Option.map(m => m.start)->Option.getOr(String.length(rest))
  {text: slice(rest, 0, end), groups: [], start: line.start + start, end: line.start + start + end}
}
let locationLabel = (line: lexical) =>
  matches(
    line.text,
    "^(?:(?:장소|주소|위치|Location|Venue)(?:\\*{1,2})?(?:\\s*[:：]\\s*|\\s+|$)|📍\\s*)(.*)$",
  )->Array.get(0)
let locationSectionBoundary = text =>
  has(
    text,
    "^(?:날짜|시간|일시|제목|신청|등록|마감|회비|비용|문의|연락처|준비물|Date|Time|When|Title|Registration|Deadline|Fee|Cost|Contact|Tickets?|Price|Admission)(?:\\s|[:：]|$)",
  )
let locationBoundary = text =>
  has(
    text,
    "^(?:(?:날짜|시간|일시|제목|신청|등록|마감|회비|비용|문의|연락처|준비물|Date|Time|When|Title|Registration|Deadline|Fee|Cost|Contact|Tickets?|Price|Admission|https?)(?:\\s|[:：]|$)|[♥❤])|https?://|www\\.|@|\\d+\\s*(?:시|원|번\\s*출구)|(?:역\\s*\\d*\\s*번?\\s*출구)|\\b(?:directions?|exit\\s+\\d+|walk(?:ing)?\\s+\\d+\\s*(?:minutes?|mins?)|(?:walk|turn)\\s+(?:left|right|straight|towards?|for|to|from)|(?:subway|station)\\s+(?:exit|directions?))\\b|^(?:Take\\s+(?:the\\s+)?(?:subway|train|bus)|(?:subway|station|exit)\\s*[:：])|(?:역에서|에서\\s*도보|도보\\s*\\d+\\s*분|(?:좌|우)회전)|^(?:B\\d+|지하\\s*\\d+층|\\d+층)(?:\\s|$)",
  )
let locationAddresses = text =>
  matches(
    text,
    "(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|제주|[가-힣]+(?:특별시|광역시|도|시|군|구))\\s+)*[가-힣0-9]+(?:동|읍|면|리|로\\d*길|로|길)\\s+(?:산\\s*)?\\d+(?:-\\d+)?(?:번지)?(?![\\d가-힣-])|\\b\\d+[A-Za-z]?\\s+(?:[A-Za-z0-9.'-]+\\s+){1,5}(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct)\\b\\.?",
  )
let locationVenue = (line: lexical): lexical => {
  let annotation =
    matches(
      line.text,
      "\\s*(?:\\((?:B\\d+|지하[^)]*|\\d+\\s*(?:층|F)|(?:floor|unit|suite)[^)]*)\\)|(?:지하\\s*)?\\d+\\s*층|\\d+호|\\b(?:floor|unit|suite)\\b|[가-힣]+역\\s*\\d+\\s*번?\\s*출구)",
    )->Array.get(0)
  let end = annotation->Option.map(m => m.start)->Option.getOr(String.length(line.text))
  locationContent({...line, text: slice(line.text, 0, end), end: line.start + end})
}
let credibleVenue = text =>
  text != "" &&
  String.length(text) <= 100 &&
  !locationBoundary(text) &&
  !has(
    text,
    "^(?:Come\\s+(?:dance|join|along|and|to)\\b|Join\\s+us\\b|Please\\b|We\\s+|Let's\\b|Enjoy\\s+|See\\s+you\\b|Bring\\s+|Don't\\b|Everyone\\b)",
  ) &&
  !has(
    text,
    "^(?:안내|공지|없음|미정|추후|장소|주소|위치)(?:\\s|$)|(?:합니다|입니다|하세요|있습니다|없습니다|예정)|[!?]|^\\d|^[,;:：-]+$|^(?:TBD|TBA|none|unknown)\\b",
  )

@genType
let parse = (text, referenceInstant, browserZone, override: option<string>): output => {
  let lines = matches(text, "[^\\r\\n]+")->Array.map(line => {
    let prefix = matches(line.text, "^\\s*[✔✓☑✅]\\s*")->Array.get(0)
    switch prefix {
    | None => line
    | Some(m) => {
        ...line,
        text: slice(line.text, m.end, String.length(line.text)),
        start: line.start + m.end,
      }
    }
  })
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
  let english = recognizeEnglishDates(text, referenceInstant, validZone(zone) ? zone : browserZone)
  let onLine = (line: lexical) =>
    english->Array.filter(e => e.start >= line.start && e.end <= line.end)
  let englishDate = (e: englishEvidence) => {
    if e.unit == "day" {
      addDays(reference, e.offset)
    } else if e.day > 0 {
      let parts = dateParts(reference)
      makeDate(
        parts.year + (parts.month == 12 ? 1 : 0),
        parts.month == 12 ? 1 : parts.month + 1,
        e.day,
      )
    } else {
      ""
    }
  }
  // The external recognizer contributes evidence; calendar arithmetic and
  // composition stay here, using the draft's event-local reference date.
  let dateEvidence = (line: lexical, reference, seasonYear) => {
    let additions = onLine(line)->Array.filterMap(e => {
      let date = englishDate(e)
      date == ""
        ? None
        : Some({
            date,
            span: {start: e.start, end: e.end},
            inferred: Array.concat(
              ["english-adapter"],
              e.period == "" ? [] : [`vague-${e.period}`],
            ),
            mismatch: false,
          })
    })
    let existing =
      dateEvidence(line, reference, seasonYear)->Array.filter(d =>
        !(
          additions->Array.some(a =>
            a.date == d.date && a.span.start <= d.span.start && a.span.end >= d.span.end
          )
        )
      )
    Array.concat(existing, additions)
  }
  let season = lines->Array.filter(l => has(l.text, "운영기간|season"))
  let seasonYear =
    season
    ->Array.flatMap(l => matches(l.text, "\\d{4}"))
    ->Array.get(0)
    ->Option.map(m => number(m.text))
    ->Option.getOr(0)
  let seasonWindows =
    lines
    ->Array.filterWithIndex((line, index) =>
      has(
        line.text,
        "^\\s*\\d{4}[./-]\\d{1,2}[./-]\\d{1,2}\\s*[~–-]\\s*\\d{4}[./-]\\d{1,2}[./-]\\d{1,2}\\s*$",
      ) &&
      [index - 1, index - 2]->Array.some(i =>
        lines
        ->Array.get(i)
        ->Option.map(l => has(l.text, "season|운영기간"))
        ->Option.getOr(false)
      )
    )
    ->Array.map(l => l.text)
  let excluded = line =>
    seasonWindows->Array.includes(line) ||
      has(
        line,
        "운영기간|기간\\s*동안|season|registration|registrations|sign-ups|deadline|마감|참가비|파티비|입장료|입금|계좌|\\b(?:fee|price|admission)\\b|https?://",
      )
  let dateLines =
    lines->Array.filter(l =>
      !excluded(l.text) && !has(l.text, "^(?:제목|Title|장소|주소|Location)\\s*[:：]?|^📍")
    )
  let dates = dateLines->Array.flatMap(l => dateEvidence(l, reference, seasonYear))
  let distinctDates = dates->Array.map(d => d.date)->unique
  let explicitSchedule = has(text, "연습\\s*일정")
  let firstList = lines->Array.findIndex(l => monthList(l.text)->Option.isSome)
  let listDates =
    lines
    ->Array.filter(l => monthList(l.text)->Option.isSome)
    ->Array.flatMap(l => dateEvidence(l, reference, seasonYear))
  let practiceLine =
    firstList >= 0
      ? [firstList - 1, firstList - 2]
        ->Array.find(i =>
          lines
          ->Array.get(i)
          ->Option.map(l => has(l.text, "연습|모임") && Array.length(clocks(l, false)) >= 2)
          ->Option.getOr(false)
        )
        ->Option.getOr(-1)
      : -1
  let seriesEnd =
    lines
    ->Array.mapWithIndex((l, i) => (l, i))
    ->Array.findIndex(((l, i)) =>
      i > firstList &&
        has(l.text, "^\\s*(?:<|■)|^(?:참가비|입금|계좌|Registration|Deadline)")
    )
  let schedule = explicitSchedule || practiceLine >= 0
  let sharedDate = Array.length(distinctDates) == 1 ? dates->Array.get(0) : None
  let evening = has(text, "저녁|오후")
  let hasClockEvidence =
    lines->Array.some(l =>
      !excluded(l.text) && has(l.text, "\\d{1,2}:\\d{2}|\\d{1,2}\\s*(?:시|[ap]m?\\b)|midnight")
    )
  let mealTimes =
    [
      ("\\blunch\\b|점심", "12:00"),
      ("\\bbreakfast\\b|아침식사", "09:00"),
      ("\\bdinner\\b|저녁식사", "18:00"),
    ]->Array.filter(((pattern, _)) => has(text, pattern))
  let inferredTime = mealTimes->Array.get(0)->Option.map(((_, time)) => time)->Option.getOr("09:00")
  let inferClock =
    !hasClockEvidence &&
    Array.length(distinctDates) == 1 &&
    Array.length(mealTimes) <= 1 &&
    !has(text, "\\b(?:tonight|morning|afternoon|evening|night)\\b|저녁(?!식사)")

  let timelines =
    lines
    ->Array.mapWithIndex((header, headerIndex) => {
      let headerDates = dateEvidence(header, reference, seasonYear)
      let slots = ref([])
      if (
        !excluded(header.text) &&
        has(header.text, "^(?:일시|날짜|When|Date)\\s*[:： ]") &&
        Array.length(headerDates) == 1 &&
        Array.length(clocks(header, evening)) == 0
      ) {
        let base = headerDates->Array.get(0)->Option.getOrThrow
        let active = ref(true)
        let previous = ref(-1)
        let offset = ref(0)
        lines->Array.forEachWithIndex((line, index) => {
          if index > headerIndex && active.contents {
            let times = clocks(line, evening)
            if (
              excluded(line.text) ||
              Array.length(times) != 2 ||
              Array.length(dateEvidence(line, reference, seasonYear)) > 0 ||
              times->Array.some(c => c.ambiguous)
            ) {
              active := false
            } else {
              let start = times->Array.get(0)->Option.getOrThrow
              let ending = times->Array.get(1)->Option.getOrThrow
              if previous.contents >= 0 && start.minutes < previous.contents {
                offset := offset.contents + 1
              }
              let date = {...base, date: addDays(base.date, offset.contents)}
              let endDate = ending.minutes <= start.minutes ? addDays(date.date, 1) : date.date
              slots := Array.concat(slots.contents, [(index, date, start, ending, endDate)])
              previous := start.minutes
            }
          }
        })
      }
      slots.contents
    })
    ->Array.filter(slots => Array.length(slots) >= 2)
  let timelineSlots = timelines->Array.flatMap(slots => slots)

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
    let sourceSpan = [{start: line.start, end: line.end}]
    switch titleLabel {
    | Some(m) => add(#title, group(m, 1), "", "", "text", sourceSpan, [], 200, ["overall"], "Title")
    | None =>
      if (
        index == 0 &&
        locationLabel(locationContent(line))->Option.isNone &&
        !has(
          line.text,
          "^(?:날짜|시간|일시|When|All day|Time zone|Location|장소|주소)[:： ]|^📍",
        )
      ) {
        add(
          #title,
          headingTitle(
            line,
            reference,
            seasonYear,
            evening,
            onLine(line)->Array.map(e => {start: e.start, end: e.end}),
          ),
          "",
          "",
          "text",
          sourceSpan,
          [],
          100,
          ["overall"],
          "Heading",
        )
      }
    }
  })
  let addLocation = (line: lexical, venueAllowed, fallbackRank) => {
    let addresses = locationAddresses(line.text)->Array.filter(address => {
      // Address-shaped text inside a directions/contact/prose line is not location evidence.
      let prefix = locationContent({...line, text: slice(line.text, 0, address.start)})
      prefix.text == "" || credibleVenue(prefix.text)
    })
    addresses->Array.forEach(address =>
      add(
        #location,
        address.text,
        "",
        "",
        "text",
        [{start: line.start + address.start, end: line.start + address.end}],
        [],
        220,
        ["overall"],
        "Address",
      )
    )
    let venueEnd =
      addresses->Array.get(0)->Option.map(m => m.start)->Option.getOr(String.length(line.text))
    let venue = locationVenue({
      ...line,
      text: slice(line.text, 0, venueEnd),
      end: line.start + venueEnd,
    })
    // A separating comma belongs to neither the venue nor address evidence.
    let separator = matches(venue.text, "[,;]\\s*$")->Array.get(0)
    let venue = switch separator {
    | None => venue
    | Some(m) =>
      locationContent({...venue, text: slice(venue.text, 0, m.start), end: venue.start + m.start})
    }
    let acceptedVenue = venueAllowed && credibleVenue(venue.text)
    if acceptedVenue {
      add(
        #location,
        venue.text,
        "",
        "",
        "text",
        [{start: venue.start, end: venue.end}],
        [],
        fallbackRank,
        ["overall"],
        "Venue",
      )
    }
    (Array.length(addresses) > 0, acceptedVenue)
  }
  lines->Array.forEachWithIndex((source, index) => {
    let line = locationContent(source)
    switch locationLabel(line) {
    | Some(label) => {
        let offset = String.length(label.text) - String.length(group(label, 1))
        let value = locationContent({...line, text: group(label, 1), start: line.start + offset})
        let (address, venue) = value.text == "" ? (false, false) : addLocation(value, true, 200)
        // An inline venue starts the same bounded block as a standalone header.
        // A complete address or invalid inline value must not consume neighboring lines.
        let active = ref(value.text == "" || (!address && venue))
        let venueFound = ref(venue)
        let consumed = ref(value.text == "" ? 0 : 1)
        lines->Array.forEachWithIndex((next, nextIndex) => {
          if active.contents && nextIndex > index {
            let content = locationContent(next)
            if content.text != "" {
              if (
                consumed.contents >= 2 ||
                locationLabel(content)->Option.isSome ||
                locationSectionBoundary(content.text)
              ) {
                active := false
              } else {
                let (address, venue) = addLocation(content, !venueFound.contents, 200)
                consumed := consumed.contents + 1
                venueFound := venueFound.contents || venue
                if address || !venue {
                  active := false
                }
              }
            }
          }
        })
      }
    | None =>
      if has(line.text, "^공간") {
        ignore(addLocation(line, true, 80))
      }
    }
  })
  lines->Array.forEachWithIndex((line, index) => {
    if (
      !excluded(line.text) &&
      !has(line.text, "^(?:제목|Title|장소|주소|Location)\\s*[:：]?|^📍")
    ) {
      let relativeTimes =
        relativeDurations(line.text)
        ->Array.filter(m => !calendarDuration(m))
        ->Array.map(m => {
          let value = advanceReference(
            referenceInstant,
            zone,
            number(group(m, 1)) * (has(group(m, 2), "^(?:hour|hr)") ? 60 : 1),
          )
          (m, value)
        })
        ->Array.filter(((_, value)) => value != "")
      let unresolvedMonth =
        onLine(line)->Array.filter(e => e.unit == "month" && englishDate(e) == "")
      unresolvedMonth->Array.forEach(e => {
        let parts = dateParts(reference)
        let year = parts.year + (parts.month == 12 ? 1 : 0)
        let month = parts.month == 12 ? 1 : parts.month + 1
        let value = `${Int.toString(year)}-${pad(month)}`
        add(
          #start,
          value,
          "",
          "",
          "month-only",
          [{start: e.start, end: e.end}],
          ["english-adapter", "unresolved-day"],
          50,
          [`activity-${Int.toString(index)}`],
          e.day == 0 ? `${value}: day unresolved` : `${value}: invalid source day`,
        )
      })
      let localDates = Array.concat(
        dateEvidence(line, reference, seasonYear),
        relativeTimes->Array.map(((m, value)) => {
          date: slice(value, 0, 10),
          span: {start: line.start + m.start, end: line.start + m.end},
          inferred: [],
          mismatch: false,
        }),
      )
      let explicitClocks = clocks(line, evening)
      let lineClocks =
        Array.length(explicitClocks) > 0
          ? explicitClocks
          : relativeTimes->Array.map(((m, value)) => {
              let time = slice(value, 11, 16)
              {
                time,
                minutes: number(slice(time, 0, 2)) * 60 + number(slice(time, 3, 5)),
                span: {start: line.start + m.start, end: line.start + m.end},
                ambiguous: false,
              }
            })
      let allDay =
        has(line.text, "all[ -]day|종일") ||
        (relativeDurations(line.text)->Array.some(calendarDuration) &&
        Array.length(distinctDates) == 1 &&
        !hasClockEvidence &&
        Array.length(mealTimes) == 0 &&
        !has(text, "\\b(?:tonight|morning|afternoon|evening|night)\\b|저녁"))
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
        : has(line.text, "연습\\s*[:：]|연습\\s*모임")
        ? "practice"
        : overall
        ? "overall"
        : `activity-${Int.toString(index)}`
      let rank = overall ? 200 : activity == "practice" ? 180 : activity == "free-lesson" ? 70 : 100
      let label = trim(line.text)
      let dateOptions = if Array.length(unresolvedMonth) > 0 {
        localDates
      } else if Array.length(localDates) > 0 {
        localDates
      } else if timelineSlots->Array.some(((i, _, _, _, _)) => i == index) {
        timelineSlots
        ->Array.filter(((i, _, _, _, _)) => i == index)
        ->Array.map(((_, d, _, _, _)) => d)
      } else if (
        practiceLine >= 0 &&
        index >= practiceLine &&
        (seriesEnd < 0 || index < seriesEnd) &&
        Array.length(lineClocks) > 0
      ) {
        listDates
      } else if explicitSchedule {
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
            localDates->Array.forEach(d => {
              if inferClock {
                let startValue = `${d.date} ${inferredTime}`
                let inferred = Array.concat(d.inferred, ["inferred-time"])
                add(
                  #start,
                  startValue,
                  d.date,
                  inferredTime,
                  "complete",
                  [d.span],
                  inferred,
                  rank,
                  [`${activity}:${d.date}`],
                  "Inferred time",
                )
                let ending = elapsedEnd(startValue, zone, 60)
                if ending != "" {
                  add(
                    #end,
                    ending,
                    slice(ending, 0, 10),
                    slice(ending, 11, 16),
                    "complete",
                    [d.span],
                    Array.concat(inferred, ["assumed-end"]),
                    rank - 1,
                    [`${activity}:${d.date}`],
                    "Inferred 60-minute duration",
                  )
                }
              } else {
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
                  has(line.text, "tonight|night")
                    ? "Date known; night has no exact time"
                    : has(line.text, "evening|저녁")
                    ? "Date known; evening has no exact time"
                    : has(line.text, "morning|afternoon")
                    ? "Date known; period has no exact time"
                    : "Date known; time missing",
                )
              }
            })
          }
        }
      }
    }
  })
  timelines->Array.forEach(slots => {
    let (_, date, start, _, _) = slots->Array.get(0)->Option.getOrThrow
    let (_, _, _, ending, endDate) = slots->Array.get(Array.length(slots) - 1)->Option.getOrThrow
    add(
      #start,
      `${date.date} ${start.time}`,
      date.date,
      start.time,
      "complete",
      [date.span, start.span],
      date.inferred,
      220,
      ["overall"],
      "Full listed schedule",
    )
    add(
      #end,
      `${endDate} ${ending.time}`,
      endDate,
      ending.time,
      "complete",
      [date.span, start.span, ending.span],
      date.inferred,
      220,
      ["overall"],
      "Full listed schedule",
    )
  })
  // A labeled deadline is actionable on its own. Keep undated activity clocks
  // separate, and refuse to choose among conflicting/contextual dates.
  let deadlineLines =
    lines->Array.filter(l =>
      has(
        l.text,
        "^\\s*(?:registration\\s+deadline|deadline|등록\\s*마감|신청\\s*마감)\\s*[:：]",
      )
    )
  let contextualDates =
    lines
    ->Array.filter(l => excluded(l.text))
    ->Array.flatMap(l => dateEvidence(l, reference, seasonYear))
  switch deadlineLines->Array.get(0) {
  | Some(line) if Array.length(deadlineLines) == 1 && Array.length(distinctDates) == 0 => {
      let deadlineDates = dateEvidence(line, reference, seasonYear)
      if (
        Array.length(deadlineDates) == 1 &&
        Array.length(contextualDates) == 1 &&
        Array.length(clocks(line, false)) == 0
      ) {
        let d = deadlineDates->Array.get(0)->Option.getOrThrow
        [#start, #end]->Array.forEach(field =>
          add(
            field,
            d.date,
            d.date,
            "",
            "all-day",
            [d.span],
            d.inferred,
            210,
            ["deadline"],
            line.text,
          )
        )
        add(
          #title,
          trim(slice(line.text, 0, d.span.start - line.start)),
          "",
          "",
          "text",
          [{start: line.start, end: line.end}],
          [],
          190,
          ["deadline"],
          line.text,
        )
      }
    }
  | _ => ()
  }
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
  let eventYears = dates->Array.map(d => dateParts(d.date).year)->unique
  let contextYear =
    seasonYear != 0
      ? seasonYear
      : Array.length(eventYears) == 1
      ? eventYears->Array.get(0)->Option.getOr(0)
      : 0
  let contextDates =
    lines
    ->Array.filter(l => excluded(l.text) && !has(l.text, "계좌|입금|https?://"))
    ->Array.flatMap(line =>
      dateEvidence(line, reference, contextYear)->Array.map(d => {
        value: d.date,
        spans: [d.span],
        label: line.text,
      })
    )
  let warnings = unique(
    [
      merged->Array.flatMap(c => c.inferred),
      english->Array.some(e => e.unit == "month" && englishDate(e) == "")
        ? ["unresolved-source-day"]
        : [],
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
    contextDates,
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
