import type { SummaryInsight } from "@/lib/api"

// The advisory card's pure text helpers: money and number formatting,
// the today imperative with its dynamic reservation, and the advisory
// sentence. Extracted from SummaryInsight.tsx as plain functions so
// they are importable by the test suite; the card imports them from
// here. Every wording rule lives in this one place.

// Money format for every monetary value in the card: the euro sign
// always, flush against the amount (the app's one price display
// convention - €0.36, like the prices widget), and the pinned
// precision rule - two decimals whenever the value is nonzero at two
// decimals (0.0629 renders as €0.06); more decimals only when two
// would show 0.00 (0.0035 stays €0.0035), so a nonzero value never
// renders as €0.00. Full precision stays in the payload and the
// debug view; display strings are composed at display time from the
// raw values.
export function humanEur(value: number): string {
  if (value === 0) {
    return "\u20AC0.00"
  }
  const two = value.toFixed(2)
  if (Number(two) !== 0) {
    return `\u20AC${two}`
  }
  return `\u20AC${value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`
}

// Humanizes the euro amounts inside a precomposed payload string (the
// candidate basis, the model's notes): "EUR 0.2671/kWh" becomes
// "\u20AC0.27/kWh", and any four-decimal number - debug precision -
// clamps to two. Non-monetary numbers are untouched.
export function humanizeEurInText(text: string): string {
  return text
    .replace(/(?:EUR|\u20ac)\s?([\d.]+)/g, (_, amount) =>
      humanEur(Number(amount))
    )
    .replace(/([\d.]+)\s?(?:EUR|\u20ac)/g, (_, amount) =>
      humanEur(Number(amount))
    )
    // Bare four-decimal numbers follow the same pinned rule: clamp
    // to two decimals only when two decimals stay nonzero, so a tiny
    // value never renders as 0.00.
    .replace(/\b(\d+\.\d{4})\b/g, (_, amount) => {
      const two = Number(amount).toFixed(2)
      return Number(two) !== 0 ? two : amount
    })
}

// Human precision for the card's numbers: at most three decimals,
// trailing zeros trimmed, so 0.364494 renders as 0.364 and 14.29 as
// 14.29. The exact values stay in the payload and the debug view.
export function humanNumber(value: number): string {
  return value
    .toFixed(3)
    .replace(/0+$/, "")
    .replace(/\.$/, "")
}

export type GuidanceLine = NonNullable<SummaryInsight["guidance"]>

// True when a window is the day's absolute cheapest, not just the
// cheapest of the remaining hours: the strong "today's lowest price"
// phrasing is reserved for this case.
export function windowIsDayCheapest(
  window: string,
  guidance: GuidanceLine | null,
): boolean {
  if (guidance === null) {
    return false
  }
  const windowKey = window.replace(" today", "")
  return (
    (guidance.day_cheapest_window !== null &&
      windowKey === guidance.day_cheapest_window) ||
    (guidance.day_cheapest_average_eur !== null &&
      Math.abs(
        guidance.cheapest_window_average_eur -
          guidance.day_cheapest_average_eur,
      ) < 0.0005)
  )
}

// The today imperative, composed deterministically: appliance classes
// (the specific appliance and its measured load live in the
// server-computed basis line), exactly one "today" per sentence, and
// the benefit clause stating what the window is - "today's lowest
// price" only when the remaining window is also the day's absolute
// cheapest, otherwise "the best price left today".
export function todayImperative(
  window: string,
  guidance: GuidanceLine | null,
): string {
  const hours = window.replace(" today", "").replace("-", " and ")
  return windowIsDayCheapest(window, guidance)
    ? `Run your large appliances between ${hours} to pay today's lowest price`
    : `Run your large appliances between ${hours} for the best price left today`
}

export type AdvisoryLine = NonNullable<SummaryInsight["advisory"]>

// The advisory sentence, one writer: planning voice by default - the
// imperative belongs to today - and the command only when today offers
// nothing actionable (no action candidate and, when a guidance row
// exists, its practicality gate failed), so a genuinely better later
// day may carry it. Numbers join at human precision; missing parts
// fall back to the plain day comparison.
export function sentenceForAdvisory(
  advisory: AdvisoryLine,
  allowImperative: boolean,
): string {
  // The informational row (no prefer trigger fired) without
  // published prices: the row renders on solar alone. A low solar
  // score (LOW_SOLAR_SCORE) reads as grid reliance - the forecast
  // fact first, the hedged market expectation as the row's second
  // line (LOW_SOLAR_MARKET_NOTE).
  if (advisory.triggered === false && advisory.tomorrow_average_eur === null) {
    if (advisory.tomorrow_low_solar) {
      return "Tomorrow you'll rely mostly on grid energy: little sun is expected"
    }
    return advisory.compare_solar_kwh !== null
      ? `${humanNumber(advisory.tomorrow_solar_kwh ?? 0)} kWh of your own solar expected against today's ${humanNumber(advisory.compare_solar_kwh)}`
      : `${humanNumber(advisory.tomorrow_solar_kwh ?? 0)} kWh of your own solar expected`;
  }
  // The informational row with published prices: neutral information,
  // no invitation - on a neutral day waiting gains nothing on price
  // and may lose solar, so "If you can wait" belongs to genuinely
  // better days only (a fired trigger).
  if (advisory.triggered === false) {
    return advisory.tomorrow_solar_kwh !== null
      ? `Tomorrow: ${humanEur(advisory.tomorrow_average_eur ?? 0)} average grid price with ${humanNumber(advisory.tomorrow_solar_kwh)} kWh of your own solar expected`
      : `Tomorrow: ${humanEur(advisory.tomorrow_average_eur ?? 0)} average grid price`;
  }
  // Every no-trigger row has returned above, so what remains is a
  // genuinely recommended day; the imperative may carry when today
  // offers nothing actionable (the caller's condition).
  if (allowImperative) {
    return advisory.type === "defer"
      ? `Run your large appliances ${advisory.compare_day} instead of tomorrow to save on energy`
      : advisory.tomorrow_solar_kwh !== null
        ? `Run your large appliances tomorrow to make the most of ${humanNumber(
            advisory.tomorrow_solar_kwh,
          )} kWh of your own solar`
        : "Run your large appliances tomorrow to save on energy"
  }
  if (advisory.type === "advance") {
    if (
      advisory.tomorrow_solar_kwh !== null &&
      advisory.compare_solar_kwh !== null &&
      advisory.tomorrow_solar_kwh > advisory.compare_solar_kwh
    ) {
      return `If you can wait: tomorrow brings ${humanNumber(
        advisory.tomorrow_solar_kwh,
      )} kWh of your own solar against ${humanNumber(
        advisory.compare_solar_kwh,
      )} kWh today`
    }
    if (
      advisory.tomorrow_average_eur !== null &&
      advisory.compare_average_eur !== null
    ) {
      return `If you can wait: tomorrow's grid price averages ${humanEur(
        advisory.tomorrow_average_eur,
      )} against ${humanEur(advisory.compare_average_eur)} today`
    }
    return "If you can wait: tomorrow is the better day"
  }
  if (
    advisory.compare_average_eur !== null &&
    advisory.tomorrow_average_eur !== null
  ) {
    return `If you can wait: ${advisory.compare_day} averages ${humanEur(
      advisory.compare_average_eur,
    )} against ${humanEur(advisory.tomorrow_average_eur)} tomorrow`
  }
  if (
    advisory.compare_solar_kwh !== null &&
    advisory.tomorrow_solar_kwh !== null
  ) {
    return `If you can wait: ${advisory.compare_day} brings ${humanNumber(
      advisory.compare_solar_kwh,
    )} kWh of your own solar against ${humanNumber(
      advisory.tomorrow_solar_kwh,
    )} kWh tomorrow`
  }
  return `If you can wait: ${advisory.compare_day} is the better day`
}

// The hedged market expectation for a low-solar tomorrow (Phase E):
// the forecast fact is the row's sentence; this half stays hedged
// with "usually" because wind can still soften the market price even
// when the home's own solar cannot.
export const LOW_SOLAR_MARKET_NOTE =
  "Grid prices are usually higher on days like that; a better picture follows once tomorrow's prices are published"

// The peak-avoidance supporting line (Phase E): renders only while
// the day's peak hour is still ahead of now - the server's peak_ahead
// flag, a live reference, so the line never chases a passed peak.
export function peakAvoidanceLine(guidance: GuidanceLine): string {
  return `Avoid the ${guidance.peak_hour} peak at ${humanEur(guidance.peak_price_eur)}`
}

// The evening price situation (Phase E): once the today row no longer
// commands, it states the evening against live references - the
// remaining-hours average until midnight against the day's average.
// "Stay high" only when that comparison backs it.
export function eveningPriceSentence(guidance: GuidanceLine): string {
  const remaining = guidance.remaining_average_eur
  const high =
    guidance.day_average_eur !== null &&
    remaining !== null &&
    remaining >= guidance.day_average_eur
  return high
    ? `This evening's prices stay high, ${humanEur(remaining ?? 0)} average until midnight`
    : `This evening's prices average ${humanEur(remaining ?? 0)} until midnight`
}

// The evening delay advice (Phase E): tomorrow's cheapest window is
// meaningfully cheaper than the best window remaining today, so the
// imperative transfers to tomorrow per the voice rules.
export function delaySentence(delay: {
  tomorrow_window_average_eur: number
}): string {
  return `Delay your large appliances until tomorrow's cheaper hours, from ${humanEur(delay.tomorrow_window_average_eur)} average`
}
