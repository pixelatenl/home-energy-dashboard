import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import {
  decodeParams,
  encodePeriod,
  isCurrentPeriod,
  stepPeriod,
  todayString,
  type Period,
  type PeriodKind,
} from "@/lib/period"

// URL-driven period state: period=day|week|month|year plus date=YYYY-MM-DD
// in the query string. Every change writes the params back, so reloads
// and shared links restore the exact period; invalid or missing params
// normalise to the current day.
export function usePeriod(): {
  period: Period
  setKind: (kind: PeriodKind) => void
  shift: (delta: number) => void
  goToday: () => void
  isCurrent: boolean
} {
  const [searchParams, setSearchParams] = useSearchParams()
  // Fresh on every render, so the current-day checks follow the clock
  // across long-lived kiosk sessions (a frozen mount-time clock would
  // stick past midnight).
  // eslint-disable-next-line react/purity
  const now = new Date()
  const period = decodeParams(searchParams, now)
  const isCurrent = isCurrentPeriod(period, now)

  // Writes period and date, merging into the existing params (mode)
  // instead of replacing them.
  const applyPeriod = useCallback(
    (next: Period) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev)
        const encoded = encodePeriod(next)
        params.set("period", encoded.period)
        params.set("date", encoded.date)
        return params
      })
    },
    [setSearchParams],
  )

  const setKind = useCallback(
    (kind: PeriodKind) => {
      applyPeriod({ kind, date: period.date })
    },
    [applyPeriod, period.date],
  )

  const shift = useCallback(
    (delta: number) => {
      applyPeriod(stepPeriod(period, delta))
    },
    [applyPeriod, period],
  )

  const goToday = useCallback(() => {
    applyPeriod({ kind: period.kind, date: todayString(new Date()) })
  }, [applyPeriod, period.kind])

  return { period, setKind, shift, goToday, isCurrent }
}
