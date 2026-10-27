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
  dateSpans?: array<span>,
  timeSpans?: array<span>,
  textSpans?: array<span>,
  inferred: array<string>,
  rank: int,
  groups: array<string>,
  label: string,
}

let unique = values =>
  values->Array.reduce([], (acc, v) => acc->Array.includes(v) ? acc : Array.concat(acc, [v]))

// Preserve ranked identity and raw evidence; presentation evidence uses reference equality.
@genType
let consolidate = (candidates: array<candidate>): array<candidate> => {
  let ranked = candidates->Array.toSorted((a, b) => {
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
              dateSpans: unique(Array.concat(
                v.dateSpans->Option.getOr([]),
                c.dateSpans->Option.getOr([]),
              )),
              textSpans: unique(Array.concat(v.textSpans->Option.getOr([]), c.textSpans->Option.getOr([]))),
              timeSpans: unique(Array.concat(
                v.timeSpans->Option.getOr([]),
                c.timeSpans->Option.getOr([]),
              )),
              groups: unique(Array.concat(v.groups, c.groups)),
              inferred: unique(Array.concat(v.inferred, c.inferred)),
            }
          : v
      )
    }
  })
  merged
}

