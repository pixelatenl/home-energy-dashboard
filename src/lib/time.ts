// Time helpers for the Europe/Amsterdam timezone the server data (forecast,
// prices) uses.

function partsIn(
  date: Date,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    ...options,
  }).formatToParts(date)
}

function partValue(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find((part) => part.type === type)?.value ?? ""
}

// Local "today" as YYYY-MM-DD, through the same local-day helper as
// every other daily date (never a UTC-serialized timestamp).
export function todayInAmsterdam(): string {
  return localDateOf(new Date().toISOString())
}

// Calendar-safe date key N days after another "YYYY-MM-DD" key; correct
// across DST transitions, unlike adding 24 hours.
export function dateKeyPlus(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate()
  )}`
}

// Local date "YYYY-MM-DD" of an ISO timestamp.
export function localDateOf(iso: string): string {
  const parts = partsIn(new Date(iso), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  return `${partValue(parts, "year")}-${partValue(parts, "month")}-${partValue(parts, "day")}`
}

// UTC milliseconds of local midnight for a "YYYY-MM-DD" date key - the
// frontend twin of the server's localDayStartUtcMs, with identical
// semantics (the same 00:30 UTC offset probe), so daily buckets and
// window boundaries compare against the same instants on both sides.
// Amsterdam's DST transitions (always at 01:00/02:00 UTC) never fall
// between local midnight and that probe, so the offset matches the one
// in effect at local midnight on every day of the year.
export function amsterdamDayStartMs(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number)
  const early = Date.UTC(year, month - 1, day, 0, 30)
  const parts = partsIn(new Date(early), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  const wallClockMs = Date.UTC(
    Number(partValue(parts, "year")),
    Number(partValue(parts, "month")) - 1,
    Number(partValue(parts, "day")),
    Number(partValue(parts, "hour")),
    Number(partValue(parts, "minute"))
  )
  return Date.UTC(year, month - 1, day) - (wallClockMs - early)
}

// Local hour of an ISO timestamp (0-23).
export function localHourOf(iso: string): number {
  const parts = partsIn(new Date(iso), { hour: "2-digit", hourCycle: "h23" })
  return Number(partValue(parts, "hour"))
}

// The wall-clock hour (0-23) of chronological hour slot `index` of an
// Amsterdam local day: on the fall-back day both slots 2 and 3 read
// 02, which is the truth of that 25-hour day.
export function amsterdamSlotHourOf(dateKey: string, index: number): number {
  return localHourOf(
    new Date(amsterdamDayStartMs(dateKey) + index * 3_600_000).toISOString(),
  )
}

// Local hour fraction (e.g. 13.5 for 13:30) of an ISO timestamp.
export function localHourFractionOf(iso: string): number {
  const parts = partsIn(new Date(iso), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  return (
    Number(partValue(parts, "hour")) + Number(partValue(parts, "minute")) / 60
  )
}

// Local time "HH:MM" of an ISO timestamp.
export function localTimeOf(iso: string): string {
  const parts = partsIn(new Date(iso), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  return `${partValue(parts, "hour")}:${partValue(parts, "minute")}`
}

// Hour of the local clock (integer 0-23) in Europe/Amsterdam.
export function amsterdamHour(nowTick: number): number {
  const parts = partsIn(new Date(nowTick), { hour: "2-digit", hourCycle: "h23" })
  return Number(partValue(parts, "hour"))
}

// Time-of-day greeting for the dashboard header.
export function greetingFor(nowTick: number): string {
  const hour = amsterdamHour(nowTick)
  if (hour >= 5 && hour < 12) {
    return "Good morning"
  }
  if (hour >= 12 && hour < 18) {
    return "Good afternoon"
  }
  if (hour >= 18 && hour < 23) {
    return "Good evening"
  }
  return "Good night"
}

// A snapshot older than this is flagged stale by the hub header label:
// the 5-minute poll keeps data young under normal operation, so a stamp
// past this means the refresh cycle has stopped (server down, network
// gone) and the screen shows an old picture.
export const DATA_STALE_AFTER_MS = 15 * 60_000

// Age of a snapshot stamp in milliseconds against a given clock: null
// when the stamp is missing or unparseable (never throws), clamped at
// zero so a future-dated stamp can never read as negative age.
export function snapshotAgeMs(
  asOf: string | null | undefined,
  now: number
): number | null {
  if (typeof asOf !== "string" || asOf === "") {
    return null
  }
  const parsed = Date.parse(asOf)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return Math.max(0, now - parsed)
}

// The stale boundary: inclusive at exactly DATA_STALE_AFTER_MS.
export function isDataStale(ageMs: number): boolean {
  return ageMs >= DATA_STALE_AFTER_MS
}

// Current local date plus the fractional local hour of the clock, used to
// place "Now" markers in charts.
export function amsterdamNow(nowTick: number): {
  date: string
  fraction: number
} {
  const parts = partsIn(new Date(nowTick), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
  const get = (type: string) => Number(partValue(parts, type))
  return {
    date: `${partValue(parts, "year")}-${partValue(parts, "month")}-${partValue(parts, "day")}`,
    fraction: get("hour") + get("minute") / 60,
  }
}
