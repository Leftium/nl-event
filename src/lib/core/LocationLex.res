// Regions use original UTF-16 coordinates. Match offsets are relative to their input text.
// This module recognizes and slices text; Parser decides which regions are event evidence.
type lexical = {text: string, groups: array<string>, start: int, end: int}
@module("./primitives.ts") external matches: (string, string) => array<lexical> = "matches"
@module("./primitives.ts") external slice: (string, int, int) => string = "slice"
let group = (m: lexical, i) => m.groups->Array.get(i)->Option.getOr("")

// Keep lexical offsets while removing presentation only at the edges.
let content = (line: lexical): lexical => {
  let leading = matches(line.text, "^[\\s~*#>•·✓✔☑✅-]+")->Array.get(0)
  let start = leading->Option.map(m => m.end)->Option.getOr(0)
  let rest = slice(line.text, start, String.length(line.text))
  let trailing = matches(rest, "[\\s*~]+$")->Array.get(0)
  let end = trailing->Option.map(m => m.start)->Option.getOr(String.length(rest))
  {text: slice(rest, 0, end), groups: [], start: line.start + start, end: line.start + start + end}
}
let label = (line: lexical) =>
  matches(
    line.text,
    "^(?:(?:장소|주소|위치|Location|Venue)(?:\\*{1,2})?(?:\\s*[:：]\\s*|\\s+|$)|📍\\s*)(.*)$",
  )->Array.get(0)
let labelContent = (line: lexical, heading: lexical): lexical => {
  let offset = String.length(heading.text) - String.length(group(heading, 1))
  content({...line, text: group(heading, 1), start: line.start + offset})
}

let addresses = text =>
  matches(
    text,
    "(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|제주|[가-힣]+(?:특별시|광역시|도|시|군|구))\\s+)*[가-힣0-9]+(?:동|읍|면|리|로\\d*길|로|길)\\s+(?:산\\s*)?\\d+(?:-\\d+)?(?:번지)?(?![\\d가-힣-])|\\b\\d+[A-Za-z]?\\s+(?:[A-Za-z0-9.'-]+\\s+){1,5}(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct)\\b\\.?",
  )
let trimVenueAnnotation = (line: lexical): lexical => {
  let annotation =
    matches(
      line.text,
      "\\s*(?:\\((?:B\\d+|지하[^)]*|\\d+\\s*(?:층|F)|(?:floor|unit|suite)[^)]*)\\)|(?:지하\\s*)?\\d+\\s*층|\\d+호|\\b(?:floor|unit|suite)\\b|[가-힣]+역\\s*\\d+\\s*번?\\s*출구)",
    )->Array.get(0)
  let end = annotation->Option.map(m => m.start)->Option.getOr(String.length(line.text))
  content({...line, text: slice(line.text, 0, end), end: line.start + end})
}
// Trailing removal only, with the parser's historical host/path contract.
// Link-chip recognition in announcementLinks.ts deliberately differs.
let withoutTrailingMap = (line: lexical): lexical => {
  let map =
    matches(
      line.text,
      "\\s+https?://(?:map\\.naver\\.com|naver\\.me|map\\.kakao\\.com|kko\\.kakao\\.com|maps\\.google\\.com|(?:www\\.)?google\\.com/maps|maps\\.app\\.goo\\.gl)(?:[/?#]\\S*)?\\s*$",
    )->Array.get(0)
  switch map {
  | None => line
  | Some(m) => content({...line, text: slice(line.text, 0, m.start), end: line.start + m.start})
  }
}

// Parser supplies the cutoff from its accepted addresses, not every lexical match.
let venueBefore = (line: lexical, end: int): lexical => {
  let venue = trimVenueAnnotation({
    ...line,
    text: slice(line.text, 0, end),
    end: line.start + end,
  })
  // A separating comma belongs to neither the venue nor address evidence.
  let separator = matches(venue.text, "[,;]\\s*$")->Array.get(0)
  switch separator {
  | None => venue
  | Some(m) => content({...venue, text: slice(venue.text, 0, m.start), end: venue.start + m.start})
  }
}
