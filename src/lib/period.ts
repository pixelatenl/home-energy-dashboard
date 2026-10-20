// Pure period logic for the analytical pages: day/week/month/year
// periods anchored on a calendar day, labels, stepping, data
// boundaries and URL (de)serialisation. No React, no local timezone
// effects: all calendar math runs on UTC midnights, and "now" is
// always passed in by the caller.

export type PeriodKind = "day" | "week" | "month" | "year"

export interface Period {
  kind: PeriodKind
  // Anchor day inside the period as YYYY-MM-DD. Any day of the period
  // maps to the same start and end.
  date: string
}

// First calendar day of the data history; periods ending before this
// have no data and pages use it for empty states.
export const DEFAULT_DATA_START = "2026-10-10"

const DAY_MS = 86_400_000
const PERIOD_KINDS: PeriodKind[] = ["day", "week", "month", "year"]

// ---- Internal day helpers (UTC calendar math) ----

function isValidDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && toDay(parsed) === value
}

function toUtc(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, delta: number): Date {
  return new Date(date.getTime() + delta * DAY_MS)
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

// Local calendar day of `now` as YYYY-MM-DD; the anchor used when URL
// params are missing or invalid.
export function todayString(now: Date): string {
  const month = `${now.getMonth() + 1}`.padStart(2, "0")
  const day = `${now.getDate()}`.padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

// Local midnight of a calendar day, as a boundary for elapsed-time
// fractions (periods are calendar-local; DST shifts are part of the
// real elapsed time).
function localMidnight(day: string): Date {
  const [year, month, date] = day.split("-").map(Number)
  return new Date(year, month - 1, date)
}

// ---- Period boundaries ----

export function periodStart(period: Period): string {
  const anchor = toUtc(period.date)
  switch (period.kind) {
    case "day":
      return period.date
    // ISO weeks start Monday (getUTCDay: 0 = Sunday).
    case "week":
      return toDay(addDays(anchor, -((anchor.getUTCDay() + 6) % 7)))
    case "month":
      return toDay(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1)))
    case "year":
      return toDay(new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1)))
  }
}

export function periodEnd(period: Period): string {
  const anchor = toUtc(period.date)
  switch (period.kind) {
    case "day":
      return period.date
    case "week":
      return toDay(addDays(toUtc(periodStart(period)), 6))
    case "month":
      return toDay(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)))
    case "year":
      return toDay(new Date(Date.UTC(anchor.getUTCFullYear(), 11, 31)))
  }
}

// ---- Labels (en-GB, like the rest of the app) ----

const DAY_LABEL = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
})
const DAY_NUMBER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
})
const MONTH_SHORT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "short",
})
const MONTH_LONG_YEAR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
})

// ISO-8601 week number: the week of the Thursday of `date`'s week,
// counted from the year that Thursday belongs to.
function isoWeekNumber(date: Date): number {
  const thursday = addDays(date, 4 - (date.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1))
  return Math.ceil(((thursday.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7)
}

// Human label for the period. Day: "Mon 12 Oct". Week: "Week 42,
// 5-11 Oct", or "Week 1, 29 Dec-4 Jan" when start and end fall in
// different months. Month: "October 2026". Year: "2026".
export function periodLabel(period: Period): string {
  const start = toUtc(periodStart(period))
  const end = toUtc(periodEnd(period))
  switch (period.kind) {
    case "day":
      return DAY_LABEL.format(start)
    case "week": {
      const week = isoWeekNumber(start)
      const sameMonth =
        start.getUTCMonth() === end.getUTCMonth() &&
        start.getUTCFullYear() === end.getUTCFullYear()
      const range = sameMonth
        ? `${DAY_NUMBER.format(start)}-${DAY_NUMBER.format(end)} ${MONTH_SHORT.format(end)}`
        : `${DAY_NUMBER.format(start)} ${MONTH_SHORT.format(start)}-${DAY_NUMBER.format(end)} ${MONTH_SHORT.format(end)}`
      return `Week ${week}, ${range}`
    }
    case "month":
      return MONTH_LONG_YEAR.format(start)
    case "year":
      return `${start.getUTCFullYear()}`
  }
}

// ---- Stepping ----

// Steps a period by whole periods: days by delta days, weeks by
// 7 * delta days, months by delta calendar months with day clamping
// (Jan 31 minus one month is Dec 31; Mar 31 plus one month is Apr 30),
// years by delta years with Feb 29 clamping.
export function stepPeriod(period: Period, delta: number): Period {
  const anchor = toUtc(period.date)
  switch (period.kind) {
    case "day":
    case "week":
      return {
        kind: period.kind,
        date: toDay(addDays(anchor, delta * (period.kind === "day" ? 1 : 7))),
      }
    case "month": {
      const total = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + delta
      const year = Math.floor(total / 12)
      const month = total - year * 12
      const day = Math.min(
        anchor.getUTCDate(),
        daysInMonth(year, month),
      )
      return { kind: period.kind, date: toDay(new Date(Date.UTC(year, month, day))) }
    }
    case "year": {
      const year = anchor.getUTCFullYear() + delta
      const day = Math.min(
        anchor.getUTCDate(),
        daysInMonth(year, anchor.getUTCMonth()),
      )
      return { kind: period.kind, date: toDay(new Date(Date.UTC(year, anchor.getUTCMonth(), day))) }
    }
  }
}

// ---- Current-period and data checks ----

// True when the period contains `now` (local time): the local calendar
// day of now lies between the period's start and end days.
export function isCurrentPeriod(period: Period, now: Date): boolean {
  const today = todayString(now)
  return periodStart(period) <= today && today <= periodEnd(period)
}

// True when the period can hold data: it ends on or after dataStart.
export function periodHasData(
  period: Period,
  dataStart: string = DEFAULT_DATA_START,
): boolean {
  return periodEnd(period) >= dataStart
}

export interface ComparisonPeriod {
  // The previous period of the same kind, aligned on the same anchor
  // day-of-period (step of -1).
  period: Period
  // Fraction (0-1) of the current period already elapsed at `now`.
  // Only set when `period` itself is the current, still in-progress
  // period; null when it lies fully in the past or future. A later
  // analytics pass can time-align comparisons by measuring only this
  // fraction of the previous period.
  elapsedFraction: number | null
}

// The previous period of the same kind, plus - when the current
// period is in progress - how much of it has elapsed, so a later
// analytics pass can time-align comparisons.
export function comparisonPeriod(period: Period, now: Date): ComparisonPeriod {
  let elapsedFraction: number | null = null
  if (isCurrentPeriod(period, now)) {
    const startMs = localMidnight(periodStart(period)).getTime()
    const endMs = localMidnight(
      toDay(addDays(toUtc(periodEnd(period)), 1)),
    ).getTime()
    const fraction = (now.getTime() - startMs) / (endMs - startMs)
    elapsedFraction = Math.min(1, Math.max(0, fraction))
  }
  return { period: stepPeriod(period, -1), elapsedFraction }
}

// ---- URL (de)serialisation ----

// Encodes a period as URL params: period=day|week|month|year and
// date=YYYY-MM-DD (the anchor).
export function encodePeriod(period: Period): {
  period: PeriodKind
  date: string
} {
  return { period: period.kind, date: period.date }
}

// Decodes URL params back into a period. Invalid or missing values
// normalise: an unknown period kind falls back to "week" (the pages'
// default view), an invalid or missing date falls back to the current
// day. Valid parts are kept.
export function decodeParams(params: URLSearchParams, now: Date = new Date()): Period {
  const rawKind = params.get("period")
  const kind = PERIOD_KINDS.includes(rawKind as PeriodKind)
    ? (rawKind as PeriodKind)
    : "week"
  const rawDate = params.get("date")
  const date = rawDate !== null && isValidDay(rawDate) ? rawDate : todayString(now)
  return { kind, date }
}

// The "today" period: the day period is the app's "today" view (the
// navigator's Day segment, the goToday target). The hub's stat cards
// preset it so a card always opens its tab on today, never the
// pages' week default.
export const TODAY_PERIOD: PeriodKind = "day"

// The URL a hub stat card links to: the tab's path with the "today"
// period preset. The date param is left out on purpose: decodeParams
// falls back to the current day when it is missing, so a link clicked
// after midnight still lands on today.
export function todayTabUrl(path: string): string {
  return `${path}?period=${TODAY_PERIOD}`
}
