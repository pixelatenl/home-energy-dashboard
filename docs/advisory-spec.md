# The AI advisory card — specification

This document keeps the advisory card's purpose statement, its content
classes and its rendering and visual rules. The advisory pipeline
itself - the facts layer, the model context, the model output, the
served payload schema and the validation guard sets - is specified by
`docs/advisory-contract.md`, which is the source of truth for
everything it lists and supersedes the pipeline rules this spec once
carried. (Stage 3b note: the legacy summary insight path is removed;
the advisory core under `server/advisory/`, wrapped by
`server/advisory-adapter.mjs`, is the only advisory pipeline.)

## Content classes

The card advises; every number it shows is computed server-side. The
model writes prose only - the two narrative slots (`warning` and
`contextNote`); the action, its candidate and saving, the guidance,
the day-ahead advisory and the week outlook are server-computed and
composed into the card by the advisory core, never through the model.

One writer per sentence. The guidance, day-ahead advisory and week
outlook objects are server-computed and served from the live facts on
every request - never from the cached insight. They are also absent
from the context signature, so a reshaping forecast no longer triggers
a regeneration; only the candidates (and the bucketed live values)
do. The card renders their rows from its own deterministic templates.

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
3. **Day-ahead advisory (the TOMORROW row)** — always computed when
   the forecast carries tomorrow's expected solar; omitted only when
   no forecast data exists (honest absence). Fields: tomorrow's
   expected solar, today's solar for comparison, tomorrow's average
   price only when the feed has published it (null otherwise). The
   prefer triggers (tomorrow's average at least 20% above the cheapest
   known day = defer, 20% below today = advance; tomorrow's solar at
   least 40% below the best following day = defer, 40% above today's
   = advance) decide the recommendation and its prefer chip — they no
   longer decide whether the row exists. The `triggered` flag carries
   the decision. Without published prices the row renders on solar
   alone and labels the horizon honestly: "Grid prices for tomorrow
   are not yet published; a fuller comparison follows once they are
   available." The informational row (no trigger) never commands —
   and it carries no invitation either: the "If you can wait"
   phrasing belongs only to genuinely better days (a fired trigger).
   A neutral day reads as plain information: the Tomorrow
   description is a server-composed narrative about what the figures
   mean (cheaper or pricier than today at the
   PRACTICAL_MIN_ADVANTAGE_EUR boundary, more or less or similar
   solar at a 20 percent swing), never a restatement of the figures -
   the numbers line beneath carries the exact comparison. It never
   opens with "Tomorrow", a missing figure omits its half, and were
   it ever model-generated it would have to pass the advisory
   integrity checker with every figure matching the computed values.
   A neutral day narrates: "Grid power should cost about the same as
   today, with about as much of your own solar."
4. **Week outlook** — every forecast day after today with weekday,
   expected solar kWh, its solar score (0 to 100 versus the annual
   peak), a home-language condition, and a grid price
   field that is non-null only for tomorrow (unpublished prices are
   null, never a number). Names the best solar day and the rain day.
   The best day speaks qualitative solar language grounded in the
   score, served as a server-composed line the card renders verbatim:
   "A genuinely good solar day: score 68, 15.3 kWh expected"
   at or above GOOD_SOLAR_SCORE (default 60, EMS_GOOD_SOLAR_SCORE); a
   lower score reads honestly as "the week's best solar" without the
   good claim. Below LOW_SOLAR_SCORE (default 20, EMS_LOW_SOLAR_SCORE)
   tomorrow's row reads as grid reliance before its prices are
   published: "Tomorrow you'll rely mostly on grid energy: little sun
   is expected." followed by the hedged market expectation - "Grid
   prices are usually higher on days like that; a better picture
   follows once tomorrow's prices are published" - the forecast fact
   stated as fact, the price half hedged with "usually" because wind
   can still soften the market price.
5. **Context note** — one coherent sentence about the home, written
   and rendered only on quiet days: why no candidates exist, or a
   genuine insight the rows do not carry (the
   battery-charging-reduces-shifting-value class). It never restates
   the action's numbers, appliance names or windows. On action days
   the basis line does the explaining and the note is omitted
   entirely. Rendered as a muted footnote, never amber.
6. **Warning** — amber, and only for something that needs attention
   and implies what to check or do. Explanatory text never goes here.
7. **Price and battery facts** — server-computed grounding fields
   served next to the advisory: today's lowest and peak price, each
   with its own timestamp, and the battery state (SOC percentage and
   charging/discharging/idle) verbatim from the context values. The
   card renders the price sentence from its deterministic template
   ("Lowest price around 02:00 (€0.19); peak around 08:00 (€0.41).")
   at full description weight, leading the Today block in the fact
   register - verbatim from the served fields, the frontend composes
   nothing, omitted cleanly when the price fields are missing. The
   battery sentence is served but not rendered on the card: the hub
   battery widgets already show the state. The model never writes
   these sentences. When a fact is missing its sentence is omitted
   entirely - never approximated, never filled by the model. The
   model may reference the battery only abstractly; battery-state
   claims in its own words are rejected by the validator.

## Practicality gate (the today imperative)

The today imperative renders only when ALL hold:

- the window starts before the evening pivot hour - the named constant
  EVENING_PIVOT_HOUR, default 18:00, overridable via
  EMS_EVENING_PIVOT_HOUR (one cutoff, shared with the evening pivot);
- at least PRACTICAL_MIN_HOURS (default 2) hours of the window remain;
- the window average is at least PRACTICAL_MIN_ADVANTAGE_EUR (default
  0.05) below the day's average - a live reference comparison.

The gate's inputs (window start hour, hours remaining, window average,
day average) ride the guidance object and the debug payload. When the
gate fails, the today row states the situation honestly in muted
planning register - never a command - and the Phase E today modes pick
the honest statement:

- **Peak avoidance** (while commanding): the supporting line "Avoid
  the 08:00 peak at €0.51" renders only while the day's peak hour
  is still ahead of the current hour (`peak_ahead`) - a live
  reference, gone once the peak has passed.
- **Passed hours**: when the day's actual cheap hours are gone
  (`day_cheapest_passed`), the row states "Today's cheap hours (...)
  have passed".
- **Evening situation**: when the cheap hours are still ahead tonight
  but the pivot blocks the command, the row states the evening against
  live references - today's remaining-hours average until midnight
  (`remaining_average_eur`) against the day's average: "This evening's
  prices stay high, €0.41 average until midnight", or the neutral
  average when the comparison does not back "stay high".
- **Evening delay rule**: with tomorrow's prices published, the server
  compares tomorrow's cheapest window against the best window
  remaining today; when tomorrow is at least
  DELAY_MIN_ADVANTAGE_EUR (default 0.05, EMS_DELAY_MIN_ADVANTAGE_EUR)
  cheaper, the tomorrow row carries the transferred imperative:
  "Delay your large appliances until tomorrow's cheaper hours, from
  €0.19 average". It never renders while today commands, and a
  defer trigger (an even better later day) supersedes it.

- **Evening-window gate (C17)**: an evening window (starting at or
  after EVENING_PIVOT_HOUR, e.g. 21:00-00:00) whose expected benefit
  against the day's average - the actual curve's day average minus the
  window's average, an honest live reference, never a fabricated
  figure - sits below PRACTICAL_MIN_ADVANTAGE_EUR is stated in the
  served guidance line as a plain fact: "Prices are low between
  21:00 and 00:00 (€0.03 below average)." No imperative wording
  below the threshold. Windows at or above the threshold keep the
  line's imperative advisory voice, and windows outside the evening
  range are untouched. The two thresholds live in
  server/advisory-constants.mjs, defined once with the distinction:
  GUIDANCE_MIN_SPREAD_EUR (0.03) is the minimum detectable spread
  (below it the day reads as flat and the guidance object is omitted
  entirely); PRACTICAL_MIN_ADVANTAGE_EUR (0.05) is the minimum benefit
  worth acting on (the practicality gate and this gate). The gate
  inputs (`evening_window`, `expected_benefit_eur`) ride the guidance
  object with the other gate inputs.

## Voice rules

- The imperative belongs to today: when a today window exists, the
  today row is the card's only imperative.
- Exactly one "today" per sentence.
- Single imperative composition: when a real action exists, the
  action row is the card's only command. The generic guidance row
  then carries no imperative — it does not render when the action
  already names its window, and renders as the plain timing fact
  ("Cheapest window today: ..." / "Cheapest remaining window: ...")
  otherwise. The advisory stays in planning voice.
- Dynamic reservation: the benefit clause reads "to pay today's
  lowest price" only when the best remaining window is also the
  day's absolute cheapest (it matches the guidance object's
  day_cheapest_window or day_cheapest_average_eur); otherwise "for
  the best price left today".
- Appliance classes in the imperative: the action title always reads
  "Run your large appliances between ...", composed deterministically
  by the frontend. The specific appliance and its measured load
  appear only in the server-computed basis line ("your dishwasher used
  0.59 kWh so far today at €0.45/kWh average versus ...") — never
  a model duty, never a command implying a second run.
- Future days (tomorrow and later) speak in planning voice — "If you
  can wait: ..." — and never command. The imperative may transfer to
  a later day only when today offers nothing actionable (no action
  candidate and the practicality gate failed).
- Household register everywhere: address the user directly, name
  everyday objects (washing machine, dryer, dishwasher, appliances),
  state the benefit in the sentence. No operator abstractions
  ("heavy loads", "plan usage", "defer consumption").
- Plain language: user-facing text never contains internal vocabulary
  (candidates, threshold, belowThreshold, payload, context, insight,
  budget, signature, mechanism).
- No user-facing text states a fixed publication hour for tomorrow's
  prices; they "become available later today".
- English only.

## Honesty rules

- Every number on the card is copied verbatim from the facts layer;
  the model states no figures at all (contract section 4), so nothing
  is ever multiplied, derived or invented.
- No grid price is ever stated for a day beyond tomorrow — those
  prices are unpublished; beyond tomorrow only solar kWh and weather
  condition are spoken of.
- While `tomorrow_prices_available` is false, tomorrow is not
  mentioned at all.
- No raw formulas or arithmetic expressions in user-facing text.
- No-opportunity is honest: with zero candidates the insight states
  that no actionable opportunity exists and the saving is 0; absence
  never renders as a value of zero. The no-opportunity action is the
  plain honest statement, "No action worth taking today" — never
  deferral phrasing such as "Wait for tomorrow": the tomorrow
  comparison belongs to the planning rows, which already carry it.
- Horizon honesty: the horizon note renders exactly when the outlook
  extends beyond tomorrow, once: "Note: Beyond tomorrow, grid prices
  are not yet published; there the solar forecast is the deciding
  signal." A fixed standard note - the constant (with its "Note:"
  prefix) lives in advisoryText.ts, identical every day, never
  through the model or the checker. The wording names the days
  beyond tomorrow explicitly, so
  it never reads as covering the published tomorrow row.
  A defer advisory may carry its own referent note (cheapest known
  day); an advance advisory carries none.

## Money format

- Every monetary value carries the euro sign, flush against the
  amount (€0.36, never "EUR 0.36"), matching the subtext line's
  spacing style - applied at server composition time, never by
  frontend substitution. No served sentence uses the three-letter
  code.
- Every sentence served beneath a card title opens with a capital
  letter, deterministically at server composition time (the model's
  fields are normalized when the insight is validated); a figure or
  currency symbol opening is legitimate and is never capitalized.
- The pinned precision rule: two decimals whenever the value is
  nonzero at two decimals (€0.0629 renders as €0.06); more decimals
  only when two would show €0.00 (€0.0035 stays €0.0035). A nonzero
  value never renders as €0.00. Prices keep two decimals.
- Full precision lives only in the payload and the debug view.
- The payload carries raw numbers; every display string (chip texts,
  sentences, fact lines) is composed at display time from the raw
  values through the one shared money formatter. Formatter fixes
  therefore apply on the next page refresh, never on insight
  regeneration.

## Validation

The validation pipeline is specified by `docs/advisory-contract.md`
(section 6) and lives in the advisory core: `checker.mjs` verifies
price-plus-hour pairs and battery claims against the section facts,
`narrative-guards.mjs` carries the figure, register, vocabulary,
arithmetic, tomorrow-price and no-opportunity guards, and a failing
slot is regenerated once and then dropped - a mismatched narrative is
never served. The deterministic card rows are composed by the core
from the live facts; there is no model copy to drift.

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
  the action row's title is composed by the frontend in appliance
  classes; the guidance title is imperative only when no action
  exists, the advisory title then reads as planning.
- Every rendered sentence has exactly one writer: the today imperative
  (action and guidance titles) comes from `todayImperative`, the
  advisory sentence from the server-composed narrative line
  (`sentenceForAdvisory` remains only as the fallback for payloads
  that carry no line). The only model-authored
  text on the card is the no-opportunity statement, the warning and
  the context note.
- The action row may highlight its saving chip and carries the
  confidence label. The honest no-opportunity box renders only when
  the card has nothing else to say.
- The final composition reads as a timeline, strictly chronological:
  one TODAY row, one TOMORROW row (always, with forecast data), then
  the noteworthy weekday rows by date, ascending - the earliest
  upcoming day first. The best-day designation travels with whichever
  day earns it, wherever it falls in the order. The best solar day
  renders when it clearly exceeds tomorrow (>= 1.2x and not tomorrow
  itself); the rain day renders whenever the forecast shows rain,
  phrased plainly as the day to avoid, its advice line served
  server-composed as one narrative household sentence ("With rain
  expected, it is not a good day to run your large appliances.").
  No noteworthy days, no weekday
  rows.
- The notes zone is the card's fine print: the fixed standard note
  (the "Note: Beyond tomorrow, ..." constant), the
  context note (quiet days only - never alongside a real action) and
  the stale note render below a hairline separator
  in the muted register (smaller text, more line spacing), as plain
  text - no glass, no chips. The price sentence leads the Today block
  at full description weight instead, and the battery sentence is not
  rendered at all - the hub battery widgets already show the state.
  The warning stays the amber exception
  above the zone.
- The value chips carry their qualifiers inside the chip text: the
  saving chip reads "€ 0.16 potential savings", the guidance chip
  "€ 0.26/kWh in the cheap hours" - same glass treatment, same size,
  same position as before.
- The structured decision payload is the only insight format: there
  is no legacy prose path (no one_liner, summary or actions fields).
  The card composes its rows data-driven: `buildAdvisoryContent`
  (src/lib/advisoryRows.ts, a pure module the test suite imports)
  computes the row list (chip, value chip, sentence, supporting
  lines, muted flag, footer) for the current insight, and one generic
  glass-row renderer maps it.
- The day's whole-day cheapest window has one source: the server's
  `day_cheapest_block` on the prices payload. The advisory card's
  passed-hours fact and the prices widget's "Cheapest today" line both
  read it, so the two surfaces can never disagree about the day's
  cheapest hours.
- The debug endpoint (`/api/insight/debug`) exposes the exact sections
  context the model receives (contract section 3), the style brief and
  the recomposed card for the cached narrative; it is the advisory
  debug view, read-only and costing no model call.
