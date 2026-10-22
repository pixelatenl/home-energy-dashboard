// The advisory text helpers shared by every AI surface: money
// formatting for the euro register the dashboard displays prices in.
// The legacy advisory card's sentence composers lived here too;
// they retired with the card (the owner decision of 22 October) -
// the monologue-based advisory area renders the server's prose
// verbatim and composes no sentences of its own. The AI context
// boxes (prices, weather, battery) still humanize their payload
// strings through these functions.

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
    // Bare long-decimal numbers (three digits or more - payload
    // precision the model copied verbatim) follow the same pinned
    // rule: clamp to two decimals only when two decimals stay
    // nonzero, so a tiny value never renders as 0.00.
    .replace(/\b(\d+\.\d{3,})\b/g, (_, amount) => {
      const two = Number(amount).toFixed(2)
      return Number(two) !== 0 ? two : amount
    })
    // The last display guard: a NaN token - a model artifact for a
    // value the context never carried; the server-side validators
    // reject it - renders as an honest dash, never as €NaN.
    .replace(/(?:\u20ac|EUR)\s?NaN/gi, "\u2014")
    .replace(/\bNaN\b/gi, "\u2014")
}
