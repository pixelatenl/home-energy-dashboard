# The AI advisory card — specification

This document is the source of truth for the advisory card (the
SummaryInsight component on the hub and everything that feeds it).
Every future prompt touching the advisory must respect this contract.

## Content classes

The card advises; every number it shows is computed server-side. The
model never does arithmetic — it selects, phrases and never invents.

1. **Action** — a specific recommendation with an exact EUR saving.
   Server-computed candidates only: an appliance with at least
   0.5 kWh measured today (saving = kWh x the exact price difference
   between what it paid and the cheapest remaining window), or a real
   battery discharge (saving = discharged kWh x the difference between
   the hours it covered and the window). Candidates under EUR 0.05
   stay in the list, marked `below_threshold`.
2. **Guidance** — generic today advice from the price data: the
   cheapest remaining window (start, end, average), today's peak hour
   and price, and the spread per kWh. Omitted on flat-price days
   (spread under EUR 0.03). Never attached to an appliance load or an
   EUR total.
3. **Day-ahead advisory** — defer or advance heavy usage: tomorrow's
   average price at least 20% above the cheapest known day (defer) or
   20% below today (advance); or tomorrow's solar forecast at least
   40% below the best following day (defer) or 40% above today's
   (advance). Null when no meaningful difference exists.
4. **Week outlook** — every forecast day after today with weekday,
   expected solar kWh, a home-language condition, and a grid price
   field that is non-null only for tomorrow (unpublished prices are
   null, never a number). Names the best solar day and the rain day.
5. **Context note** — one coherent sentence about the home (why no
   candidates exist, why the battery is where it is). Rendered as a
   muted footnote, never amber.
6. **Warning** — amber, and only for something that needs attention
   and implies what to check or do. Explanatory text never goes here.

## Voice rules

- The imperative belongs to today: when a today window exists, the
  today row is the card's only imperative.
- Future days (tomorrow and later) speak in planning voice — "If you
  can wait: ..." — and never command.
- Household register everywhere: address the user directly, name
  everyday objects (washing machine, dryer, dishwasher, appliances),
  state the benefit in the sentence. No operator abstractions
  ("heavy loads", "plan usage", "defer consumption").
- Plain language: user-facing text never contains internal vocabulary
  (candidates, threshold, belowThreshold, payload, context, insight,
  budget, signature, mechanism).
- English only.

## Honesty rules

- Every number the model states is copied verbatim from the context;
  it never multiplies, divides or derives. The saving in the returned
  insight matches a candidate's exact value.
- No grid price is ever stated for a day beyond tomorrow — those
  prices are unpublished; beyond tomorrow only solar kWh and weather
  condition are spoken of.
- While `tomorrow_prices_available` is false, tomorrow is not
  mentioned at all.
- No raw formulas or arithmetic expressions in user-facing text.
- No-opportunity is honest: with zero candidates the insight states
  that no actionable opportunity exists and the saving is 0; absence
  never renders as a value of zero.
- Horizon honesty: the horizon note renders exactly when the outlook
  extends beyond tomorrow, once: "Grid prices for later days are not
  yet published; there the solar forecast is the deciding signal."
  A defer advisory may carry its own referent note (cheapest known
  day); an advance advisory carries none.

## Money format

- Every monetary value carries the euro sign.
- Two decimals at EUR 0.10 and above; below that, the smallest exact
  decimals that keep a nonzero value nonzero (EUR 0.0035 stays
  0.0035). A nonzero saving never renders as EUR 0.00.
- Full precision lives only in the payload and the debug view.

## Validator rules (server, in ai.mjs)

A model response is rejected — one retry, then the previous insight
is kept — when any of these fail:

- Schema: primaryAction with non-empty what, a finite savingEur
  (number or numeric string) and a known confidence (missing
  confidence defaults to medium); supportingFacts must be empty.
- The claimed saving matches a candidate exactly (0 only when no
  candidates exist).
- Guidance and advisory numbers match the price and forecast data
  exactly; absent when the context object is null, present when it
  exists; the lines carry no EUR total.
- No arithmetic expressions in any user-facing text.
- No internal vocabulary in any user-facing text.
- No sentence naming a beyond-tomorrow weekday together with a price
  claim.
- While tomorrow's prices are unpublished, no text may claim them.

## Rendering structure (SummaryInsight.tsx)

- Blue gradient card (`from-blue-800 to-sky-600`, dark
  `blue-950 to sky-800`), never flat blue.
- Every content row is a glass block: 15% translucent white, rounded,
  subtle white border, backdrop blur (`GLASS_BLOCK`); chips are
  borderless glass (`GLASS_CHIP`).
- Each row opens with an eyebrow line: a day chip (TODAY, TOMORROW or
  the weekday) on the left, the value chip on the right, so all row
  text starts on one vertical line.
- Every row has a title and a descriptive text. Titles are verb-first;
  the guidance title is the only imperative when it exists, the
  advisory title then reads as planning.
- The action row may highlight its saving chip and carries the
  confidence label. The honest no-opportunity box renders only when
  the card has nothing else to say.
- The best solar day renders when it clearly exceeds tomorrow
  (>= 1.2x and not tomorrow itself); the rain day renders whenever the
  forecast shows rain, phrased plainly as the day to avoid.
- The context note is a single muted footnote; the warning stays the
  amber exception.
- Old-format insights (pre-restructuring payload) render unchanged:
  summary paragraph, glass action rows, prose fallback.
- The debug endpoint (`/api/insight/debug`) exposes the exact
  context, the system prompt and the last insight; its consistency
  checks are green when the rules hold.
