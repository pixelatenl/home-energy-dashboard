# AI Advisory Card Contract

Version 2.0, 20 October 2026. This document is the source of truth for the AI Advisory card, its model context, its model output and the separation of the four AI consumers. It supersedes the advisory sections of `docs/advisory-spec.md` for everything listed here; the spec keeps its purpose statement, the rendering structure and the visual rules. Every prompt that touches the advisory must respect this contract.

**Stage 3b note.** The legacy summary insight path is removed. The advisory core under `server/advisory/`, wrapped by `server/advisory-adapter.mjs`, is the only advisory pipeline; every insight endpoint serves the composed card through the adapter, and the model-authored slots are exactly `warning` and `contextNote`.

## 1. Purpose

The AI Advisory card helps the household interpret the energy data on screen and act on it: what is happening today, what happened today after the evening pivot, what might happen tomorrow, and what the rest of the five-day forecast holds. It states when to run large appliances, when prices are cheapest, whether off-peak prices are low or high, and how to avoid cost by shifting usage. It is honest by construction: every number is server-computed, and the model writes prose only.

## 2. Architecture: one facts layer, four consumers

**Facts layer (single writer).** One server layer owns the computed facts: the price curve with low and peak (each with its own timestamp), the cheapest remaining window and its average, the spread per kWh, the practical benefit against the day average, the peak threshold, battery state and throughput, solar actuals and forecast per day, appliance candidates with exact savings, CO2 intensity, the day-cheapest window and whether it has passed, and the evening pivot decision. Its builders currently live in `context.mjs` and are consolidated into `facts.mjs` during integration without behavior change. Every consumer reads from this layer; no consumer assembles its own view of the same data.

**Consumers.** Four model calls, each with a narrow context carved from the facts layer by exactly one function:

| Consumer | Role | Facts it may receive | Output |
| --- | --- | --- | --- |
| Advisory card | Decides and interprets | All sections of section 3 | Optional per-section narratives, warning, contextNote |
| Prices box | Explains the prices widget | Current price, today stats, cheapest window, tomorrow availability and stats, solar peak hours | 2 to 3 sentences |
| Weather box | Explains the forecast | Daily forecast, top production hours, current conditions | 2 to 3 sentences |
| Battery box | Explains the battery | SOC, state, power, today/week/month throughput, hourly flow, solar forecast | 2 to 3 sentences |

**Separation rules (standing, apply to all future passes):**

- Shared data, never shared prompts: a fact may be stated by several consumers, but each consumer's context is assembled from the facts layer by one dedicated function.
- The advisory card decides; the boxes explain. No box issues an imperative; the advisory card is the only imperative voice.
- Any narrative sentence is validated against the facts that its consumer actually received. A sentence with no matching fact is rejected.
- Missing facts omit their clause; a section with nothing to say is omitted entirely. Never approximate, never guess.
- This pass builds the advisory consumer only. The boxes migrate to the same pattern later; nothing in this pass touches their prompts, contexts or validators.

## 3. Model context: the sections model

The model receives `now_local`, `today_date` and a `sections` array. The server decides which sections exist and their mode. Each section carries `facts` plus one inline `guidance` note stating how the model may use it.

```json
{
  "now_local": "2026-10-20T15:30:00+02:00",
  "today_date": "2026-10-20",
  "sections": [
    {
      "id": "today",
      "mode": "plan",
      "facts": {
        "cheapest_window": { "start": "14:00", "end": "17:00", "average_eur": 0.26 },
        "day_average_eur": 0.38,
        "spread_per_kwh_eur": 0.12,
        "practical_benefit_eur": 0.12,
        "practical": true,
        "peak": { "hour": "19:00", "eur": 0.47 },
        "peak_ahead": true,
        "low": { "hour": "12:00", "eur": 0.25 },
        "day_cheapest_window": "12:00-15:00",
        "day_cheapest_passed": false,
        "solar_today": { "actual_kwh": 8.6, "forecast_kwh": 14.4 },
        "battery": { "soc_pct": 72, "state": "charging", "today_in_kwh": 4.3, "today_out_kwh": 2.4 },
        "co2_intensity_g_per_kwh": 133,
        "candidate": { "label": "dishwasher", "kwh": 1.07, "saving_eur": 0.12, "window": "14:00-17:00", "worthwhile": true }
      },
      "guidance": "State what the household should do today and why, in household terms. Numbers are rendered by the card; your sentence carries meaning only."
    },
    {
      "id": "today_evening",
      "mode": "recap",
      "facts": {
        "remaining_window": { "start": "21:00", "end": "00:00", "average_eur": 0.33, "practical_benefit_eur": 0.03, "practical": false },
        "remaining_average_eur": 0.35,
        "day_usage_kwh": 18.2,
        "day_cost_eur": 2.40
      },
      "guidance": "Summarize the day that has passed. The remaining window is below the benefit worth acting on: state it as a plain fact, never as an instruction."
    },
    {
      "id": "tomorrow",
      "facts": { "prices_published": false, "prices": null, "solar_kwh": 11.99, "solar_score": 28, "low_solar": false, "compare_solar_kwh": 14.4 },
      "guidance": "Prices are null because they are not published; make no price claim about tomorrow. Speak about tomorrow's solar only."
    },
    {
      "id": "coming_days",
      "days": [
        { "weekday": "Wednesday", "date": "2026-10-21", "solar_kwh": 8.4, "solar_score": 20, "condition": "cloudy" },
        { "weekday": "Friday", "date": "2026-10-23", "solar_kwh": 1.2, "solar_score": 5, "condition": "rain" }
      ],
      "best_day": "Wednesday",
      "poor_day": "Friday",
      "guidance": "Qualitative solar talk only; no prices exist for these days. Never state a price for any day beyond tomorrow."
    }
  ]
}
```

**Mode rules.** Before `EVENING_PIVOT_HOUR` the today section is in mode `plan`; from the pivot to midnight it is in mode `recap` and a `today_evening` section carries the remaining-window advice per the practicality gate. The today imperative renders only when the window starts before the pivot, at least `PRACTICAL_MIN_HOURS` remain, and the window average is at least `PRACTICAL_MIN_ADVANTAGE_EUR` below the day average. Below that, the window is stated as a plain fact, never as an instruction.

**Recap facts (added this pass).** In recap mode the today section may carry two optional facts: `solar_share_pct`, the integer percent of today's home usage covered by the household's own solar (null when unknown), and `battery_earned_eur`, today's battery result in euros (null when unknown). Plan-mode sections never carry them. The recap guidance note states that the achievement lines are server-written, and that the model may acknowledge them qualitatively but must never restate their figures.

**Null encoding.** Unpublished or unavailable prices are null with the reason in the guidance note. The model is never offered a slot to fill.

## 4. Model output

```json
{
  "warning": "string or null",
  "contextNote": "string or null"
}
```

The payload shape (section 5) carries exactly two model-authored slots, `warning` and `context_note`; the model output therefore carries exactly two fields. The sections model is the model's input contract, not an output surface: the model reads all sections and may draw on any of them, but its words reach the card only through these two slots.

- `warning` only for something that needs attention and implies what to check.
- `contextNote` only on quiet days (no candidate), explaining why no candidate exists, or for a genuine insight the rows do not carry, grounded in any section's facts. Null when an action exists. It never restates the action's numbers, appliance names or windows, and it carries meaning rather than figures.
- The no-opportunity statement is the deterministic constant "No action worth taking today"; the model never writes it in any slot, and deferral advice is banned wherever the model writes (`guardNoOpportunityPhrasing`, applied to every model-authored slot).
- If a future pass wants per-section narratives on the card, it requires an explicit payload extension plus rendering; nothing in this contract provides for it silently.

**Voice register.** Model sentences (`warning`, `contextNote`) speak to the household in the second person, in plain household words, warm but factual. No motivational filler, no exclamation marks, no flattery (`guardRegister`, applied to every model-authored slot). The deterministic achievement lines carry the positives.

**Monologue specification (Stage 4).** Model prose may contain figures only as verbatim copies of the pre-formatted strings served in the section's fact set; every figure token must be a member of that section's own set, amounts with the currency marker exactly, times and ranges exact; sections validate only against their own fact set, which makes cross-section figure leakage structurally impossible. An opportunity claim requires a matched, above-threshold, positive candidate; negative or below-threshold savings are never framed as opportunities. Server-owned notes (the low-solar grid note, rain-day advice, horizon statement, achievement lines, no-opportunity statement) are served verbatim, and the parity append guarantees their presence in the final narrative. Sentence budgets, advisory not asserted: TODAY 5 on an action day, 3 on a quiet day, 4 in recap mode; TOMORROW at most 3; days beyond tomorrow 1 sentence, rain-poorest days 2. Action-day structure: generic imperative carrying the price comparison and no saving figure; the named appliance and its measured load in a supporting baseline sentence with the saving exactly once; an optional meaning-only habit close. Presentation (owner decision of 22 October 2026, superseding the earlier no-chips rule and the interim single-block divider framing): one card per section, matching the legacy advisory card's per-day cards - the day label as the same chip at the top-left, the narrative beneath, the same card chrome, spacing and typography; pure narrative, no row titles, no muted notes; the header keeps reasoning state and insight timestamp; confidence is not displayed. Deterministic fallbacks render as plain sentences. The phrase 'the largest opportunity today' is retired from all served composition.

**Achievement lines (server-written, recap mode only).**

- They render only in today recap mode, never in plan mode.
- Solar line: "Your own solar covered {n}% of today's usage." Fires only when `solar_share_pct` is at least `ACHIEVEMENT_MIN_SOLAR_SHARE_PCT` (default 40).
- Battery line: "Your battery earned {amount} today." in the existing € money style (€ flush, two decimals). Fires only when `battery_earned_eur` is at least `ACHIEVEMENT_MIN_BATTERY_EARN_EUR` (default €1.00).
- Honest absence: below the threshold, or when the fact is null or missing, the line is omitted entirely. Never a vague substitute, never a fabricated number.
- The existing vocabulary ban, including "genuinely good", remains in force for these lines.
- At most one solar line and one battery line, in that order.

**Server-injected fields (never model-written):** `primary_action` (title, window, saving from the selected candidate), `no_opportunity`, `candidates`, `guidance`, `advisory`, `outlook`, `priceSentence`, `achievements`. Confidence mapping: high with a worthwhile candidate, medium when all candidates are below the action threshold, low when data is thin.

## 5. Served payload schema

`composeAdvisoryCard` emits the existing `SummaryInsight` shape consumed by `src/lib/advisoryRows.ts` and `src/lib/advisoryText.ts`. The row builder and renderer are unchanged; the existing frontend tests over those modules are the acceptance suite for the composer and must remain green without modification.

The authoritative definition:

```ts
// The AI insight embedded in /api/summary: the structured decision
// payload (the only format) plus the metadata the kiosk needs to
// judge freshness. The guidance, advisory and outlook objects are
// served from the live snapshot extras at request time.
export interface SummaryInsight {
  // The decision structure: the primary action the server-side
  // candidates produced, its warning and context note.
  primary_action?: {
    what: string
    when: string
    saving_eur: number
    confidence: "high" | "medium" | "low"
  } | null
  supporting_facts?: string[]
  warning?: string | null
  // Explanatory context (why no candidates exist), rendered as a
  // muted footnote - never a warning.
  context_note?: string | null
  // True when no meaningful saving was available: every candidate is
  // belowThreshold (or none exists). The card leads with the honest
  // statement and omits the highlighted saving.
  no_opportunity?: boolean
  // The server-computed C1b candidates, for the muted largest-
  // opportunity line in the no-opportunity state.
  candidates?: InsightCandidate[]
  // Generic per-kWh timing guidance from the price data: leads the
  // card when no action exists, a muted fact line when one does.
  // Null on flat-price days.
  guidance?: {
    window: string
    cheapest_window_average_eur: number
    peak_hour: string
    peak_price_eur: number
    spread_per_kwh_eur: number
    // The practicality gate: the today imperative renders only when
    // the window starts before the evening pivot, enough of it
    // remains and its average sits meaningfully below the day's.
    practical: boolean
    window_start_hour: number
    hours_remaining: number
    day_average_eur: number | null
    day_cheapest_window: string | null
    day_cheapest_average_eur: number | null
    // The Phase E today modes: the peak-avoidance line renders while
    // the day's peak hour is ahead of now; the passed-hours fact only
    // when the day's cheap hours are actually gone; the evening price
    // situation carries today's remaining-hours average; the delay
    // comparison advises tomorrow's window once today stops
    // commanding.
    peak_ahead: boolean
    day_cheapest_passed: boolean
    remaining_average_eur: number | null
    delay: {
      tomorrow_window: string
      tomorrow_window_average_eur: number
      today_window_average_eur: number
    } | null
    line: string
  } | null
  // The week outlook rows, planning voice.
  outlook?: WeekOutlook | null
  // The day-ahead advisory: defer or advance heavy usage based on
  // tomorrow's prices and solar forecast versus the known days.
  // Renders as a distinct line beneath the guidance. Null when no
  // meaningful difference exists.
  advisory?: {
    type: "defer" | "advance"
    // Whether a prefer trigger fired: the row always renders with
    // forecast data; the recommendation only when this is true.
    triggered: boolean
    tomorrow_average_eur: number | null
    tomorrow_solar_kwh: number | null
    // Tomorrow's solar score and its low-solar flag: below
    // LOW_SOLAR_SCORE the unpublished-prices row reads as little sun
    // with the hedged market expectation.
    tomorrow_solar_score: number | null
    tomorrow_low_solar: boolean
    compare_day: string
    compare_average_eur: number | null
    compare_solar_kwh: number | null
    price_difference_per_kwh: number | null
    horizon_note: string
    // The server-composed narrative description (what the figures
    // mean - cheaper or pricier, more or less solar): the card's
    // description writer. Null when no honest narrative exists.
    line: string | null
  } | null
  // The grounding facts served next to the advisory: today's lowest
  // and peak price, each with its own timestamp, and the battery
  // state (SOC percentage and charging/discharging/idle) verbatim
  // from the context values. Each is null when its data is missing,
  // and the matching sentence is omitted with it - never guessed.
  lowPrice?: { timestamp: string; price: number } | null
  peakPrice?: { timestamp: string; price: number } | null
  battery?: {
    soc_pct: number
    state: "charging" | "discharging" | "idle"
  } | null
  // The deterministic sentences the server composes from the fields
  // above; the model never writes them. Rendered verbatim.
  priceSentence?: string | null
  batterySentence?: string | null
  // The deterministic achievement sentences (contract section 4):
  // recap mode only, at most one solar line and one battery line, in
  // that order, rendered verbatim. Always present, possibly empty -
  // below the threshold or without the fact, the line is omitted
  // entirely, never a vague substitute.
  achievements: string[]
  generated_at: string | null
  // The data moment the cached insight text is based on; can trail the
  // top-level as_of while a regeneration is in flight.
  insight_as_of: string | null
  // The insight's regeneration state, computed server-side: "fresh"
  // (the cached insight matches the live signature), "reasoning" (the
  // signatures differ and a regeneration is in flight) or "error" (no
  // cached insight at all).
  state: "fresh" | "reasoning" | "error"
  // Deprecated mirror of state === "reasoning", kept one release for
  // old payload comparisons; remove with the C25 cleanup.
  stale?: boolean
  error: string | null
}

// One forecast day beyond today in the week outlook.
export interface OutlookDay {
  date: string
  weekday: string
  weekday_short: string
  solar_kwh: number
  solar_score: number | null
  condition: string
  // Null for every day except tomorrow: unpublished prices are null,
  // never a number.
  average_price_eur: number | null
}

export interface WeekOutlook {
  days: OutlookDay[]
  best_solar_day: {
    date: string
    weekday: string
    weekday_short: string
    solar_kwh: number
    solar_score: number | null
    // "Looks good for solar" only when the score backs it
    // (GOOD_SOLAR_SCORE).
    good: boolean
    // The server-composed narrative description for the card; the
    // card renders it verbatim. Optional so payloads from before the
    // line existed keep rendering through the local fallback.
    line?: string | null
  } | null
  poor_day: {
    date: string
    weekday: string
    weekday_short: string
    solar_kwh: number
    condition: string
    // The server-composed narrative description for the card; the
    // card renders it verbatim. Optional for pre-line payloads.
    line?: string | null
    // The server-composed narrative advice line (reason and guidance
    // in one household sentence); the card renders it verbatim.
    // Optional for pre-line payloads.
    advice?: string | null
  } | null
}

export interface InsightCandidate {
  label: string
  load_kwh: number
  window: string
  saving_eur: number
  below_threshold: boolean
  basis: string
}
```

**Field ownership.** `composeAdvisoryCard` fills the content fields (`primary_action`, `supporting_facts`, `warning`, `context_note`, `no_opportunity`, `candidates`, `guidance`, `outlook`, `advisory`, `lowPrice`, `peakPrice`, `battery`, `priceSentence`, `batterySentence`, `achievements`). The transport layer in the summary insight path (`getSummaryInsight` and its cache) fills `generated_at`, `insight_as_of`, `state`, `stale` and `error`; the composer never touches them.

**Non-finite facts are missing facts.** A numeric fact that is not a finite number is null before the core uses it: facts are normalized once at entry (`buildSections`, `composeAdvisoryCard`), so sections, the model context and every composed sentence see null, and the existing null handling omits the sentence or clause. A price point, battery or window whose core number is missing drops entirely, and so does a candidate without finite figures. A literal `NaN`, `null`, `undefined` or `Infinity` token never reaches served text; the served-text audit rejects any sentence carrying one.

**Achievements rendering (Stage 3a).** Frontend rendering of the `achievements` field is a named Stage 3a addition - the single deliberate exception to this pass's zero-frontend rule. Until then the field is served, audited and pinned by tests, but no frontend file renders it.

## 6. Validation: one guard set, per narrative

Each returned sentence (`warning`, `contextNote`) is validated against the facts of the sections the model received:

- `checker.mjs` guards: price-plus-hour pairs against the day curve, battery SOC and state claims against the section battery values.
- `narrative-guards.mjs` guards: tomorrow-price claims while unpublished (including the "day after" and "next day" paraphrases), prices for days beyond tomorrow, arithmetic expressions, internal system vocabulary, NaN or Infinity, figures of any kind (`guardNoFigures`), and register violations - exclamation marks and flattery (`guardRegister`). The action-restatement ban (`guardActionRestatement`) keeps its contextNote scope, its figure class now covered globally by `guardNoFigures`; the no-opportunity and deferral ban (`guardNoOpportunityPhrasing`) applies to every model-authored slot.
- On failure: the server regenerates once and validates the second output in full. Slots failing in the second attempt are dropped; sentences that passed only in the first attempt are not carried over - the second output replaces the first wholesale. This is a deliberate simplicity decision. The card is then served without the failing sentence; a mismatched narrative is never served.

## 7. Constants (ENV-overridable, one definition each, in advisory-constants.mjs)

| Constant | Default | Meaning |
| --- | --- | --- |
| `EVENING_PIVOT_HOUR` | 18:00 (`EMS_EVENING_PIVOT_HOUR`) | Shared cutoff for the today imperative and the evening recap. Open decision: a separate one-line change may move it to 19:00; this restructure does not change behavior. |
| `PRACTICAL_MIN_HOURS` | 2 | Hours that must remain in the window for an imperative. |
| `PRACTICAL_MIN_ADVANTAGE_EUR` | 0.05 | Minimum benefit worth acting on (the practicality gate). |
| `DELAY_MIN_ADVANTAGE_EUR` | 0.05 (`EMS_DELAY_MIN_ADVANTAGE_EUR`) | Tomorrow cheaper than the best remaining today window: the delay advice fires. |
| `GUIDANCE_MIN_SPREAD_EUR` | 0.03 | Minimum detectable spread; below it the day reads as flat and the guidance object is omitted. |
| `GOOD_SOLAR_SCORE` | 60 (`EMS_GOOD_SOLAR_SCORE`) | At or above: the best day may claim "genuinely good". |
| `LOW_SOLAR_SCORE` | 20 (`EMS_LOW_SOLAR_SCORE`) | Below: tomorrow reads as grid reliance. |
| `SAVING_CHIP_MIN_EUR` | 1.00 | The saving chip renders only above this. |

Checker comparison constants stay in `checker.mjs` only.

**Stage note (this pass).** The two new achievement constants, `ACHIEVEMENT_MIN_SOLAR_SHARE_PCT` (default 40) and `ACHIEVEMENT_MIN_BATTERY_EARN_EUR` (default €1.00), live in `advisory-core.mjs` for now; `checker.mjs` and `advisory-constants.mjs` stay byte identical to the repo copies. The constants fold into `advisory-constants.mjs` at Stage 3a, ENV-overridable there as `EMS_ACHIEVEMENT_MIN_SOLAR_SHARE_PCT` and `EMS_ACHIEVEMENT_MIN_BATTERY_EARN_EUR`.

## 8. Pinned acceptance fixtures (sentences that must survive)

- **F1 poor day:** a coming_days rain day must yield the served poor-day advice line ("With rain expected, it is not a good day to run your large appliances."), with kWh verbatim from the facts.
- **F2 best ordinary day:** the best solar day below `GOOD_SOLAR_SCORE` must yield "the week's best solar" phrasing with score and kWh verbatim, never the "genuinely good" claim.
- **F3 low solar tomorrow:** the low-solar mode must yield the grid-reliance fact plus the hedged market note; the hedge word "usually" stays intact because wind can still soften the market price.
- **F4 prefer verdict:** a genuinely better day must produce the prefer chip and the comparison numbers strip from server-computed fields; the model never chooses the preferred day.

## 9. Standing rules carried forward

- One writer per sentence; every wording rule has exactly one home.
- Every behavior-changing prompt updates this contract in the same pass.
- Money: euro sign flush against the amount (€0.36), two decimals when nonzero at two decimals, more only when two would show €0.00. Raw numbers travel in the payload; display strings compose at display time.
- Titles never end in a period; descriptions always do; every sentence opens with a capital letter or a legitimate figure or currency symbol.
- English only; household register; no operator abstractions; no internal vocabulary in user-facing text.

## 10. Known limitations

- **Qualitative duplication (C21 class).** A model slot that restates served row content without figures ("Your own solar carried the house for much of the day") is not machine-guarded: no guard detects duplication or paraphrase of served sentences. This relies on the production style brief and fixture stub discipline.
- **`guidance.day_cheapest_average_eur`.** Served null until the facts layer supplies the day-cheapest window's average; folding it in is a Stage 3a task.
- **`composeAdvisoryCard` requires `facts.nowIso`.** The request's local moment travels as pure data in the facts layer, injected by `generateAdvisoryCard`; a direct call without it throws a clear error naming the missing fact.