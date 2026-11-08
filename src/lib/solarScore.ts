// Today's solar score for the Solar today card's header chip: read
// from the daily weather response (the same fetchWeatherDaily(1) call
// the retired hub forecast widget used), fail-soft. Pure: the days in,
// the score or null out; never a fabricated number.

// The score for today's date key: null when the response carries no
// entry for that day or the entry has no usable score (missing,
// non-finite), so the chip hides and the rest of the card stands.
export function todaySolarScore(
  days: readonly { date: string; solar_score?: number | null }[],
  dateKey: string,
): number | null {
  const today = days.find((day) => day.date === dateKey)
  const score = today?.solar_score
  return typeof score === "number" && Number.isFinite(score) ? score : null
}

// The chip's label, or null when there is no score to show (the chip
// then hides entirely).
export function solarScoreLabel(score: number | null): string | null {
  return score === null ? null : `Solar score ${Math.round(score)}/100`
}
