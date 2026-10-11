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

// Local "today" as YYYY-MM-DD.
export function todayInAmsterdam(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
  }).format(new Date())
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

// Local hour of an ISO timestamp (0-23).
export function localHourOf(iso: string): number {
  const parts = partsIn(new Date(iso), { hour: "2-digit", hourCycle: "h23" })
  return Number(partValue(parts, "hour"))
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
