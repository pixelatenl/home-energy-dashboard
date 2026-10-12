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

  const setKind = useCallback(
    (kind: PeriodKind) => {
      setSearchParams(encodePeriod({ kind, date: period.date }))
    },
    [period.date, setSearchParams],
  )

  const shift = useCallback(
    (delta: number) => {
      setSearchParams(encodePeriod(stepPeriod(period, delta)))
    },
    [period, setSearchParams],
  )

  const goToday = useCallback(() => {
    setSearchParams(
      encodePeriod({ kind: period.kind, date: todayString(new Date()) }),
    )
  }, [period.kind, setSearchParams])

  return { period, setKind, shift, goToday, isCurrent }
}
