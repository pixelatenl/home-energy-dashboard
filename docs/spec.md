# Usage spec

The definitions the usage figures rely on and the calculation behind
GET /api/usage/breakdown. Sections 1-2 state the shared definitions;
section 3 is the breakdown calculation.

## 1. Total household usage

`total_usage_kwh` for a window is total home consumption, the
explicit five-counter form (all measured entities):

```
total = grid import + PV yield + battery discharge
      - grid export - battery charge
```

The charge term is a sink: energy leaving the home circuit into the
battery is not consumption, whether it came from the grid or from
solar. The discharge term counts energy the battery served back; a
discharge that goes to the grid nets out against the export term, so
it is never consumption either way. Energy that charged the battery
is not consumption on the charging day; it counts on the day the
battery discharges it. The two battery terms are zeroed only when
both battery entities are missing, and the total is floored at zero.

Energy figures come from the cumulative counters via `energy_delta`
sums, never from power integrals. Power streams are diagnostic
only; the counters are the source of truth.

### 1.1 Battery netting audit (U1c, 2026-10-16)

The claim audited: charged energy was double counted - once when it
enters the battery and again when the battery discharges. Verdict:
no double count existed. The implementation before U1c computed
`import + pv - export - (charge - discharge)`, algebraically the
same formula; U1c restructured the shared metric
(`getRangeMetrics` in `server/queries.mjs`) into the explicit
five-term form above so the two battery terms read as written.

Before/after for the week 2026-10-12..16 (energy_delta sums of the
measured entities): import 76.318, PV yield 50.600, battery
discharge 30.000, grid export 37.382, battery charge 31.600 kWh.

- before: 76.318 + 50.600 - 37.382 - (31.600 - 30.000) = 87.94
- after: 76.318 + 50.600 + 30.000 - 37.382 - 31.600 = 87.94

The total does not drop by the week's charge energy, and it must
not: removing the discharge term would make the evening hours
physically impossible (on 2026-10-16 at 18:00 the battery discharged
8.6 kWh against 2.69 kWh import and 0.94 kWh PV; only the discharge
term explains the served load).

Two data findings from the audit, for future reference:

- The `energy_daily` continuous aggregate lags `energy_delta`
  badly (week charge sum 15.7 in `energy_daily` vs 31.6 in
  `energy_delta`). The shared metric reads `energy_delta`; any
  cross-check against `energy_daily`-based views will disagree and
  can read as a double count. Cross-check against `energy_delta`
  sums instead.
- An earlier revision of this section claimed the Anker Solarbank
  had its own DC solar input (up to 5.8 kW observed), measured only
  as instantaneous power. A diagnostic disproved that claim: the
  Solarbank has no second array, and `solar_power` is an internal
  flow of the unit, not generation. The verified total is exactly
  the five-term counter formula above; no generation term is
  missing and nothing is under-counted. (The claim's origin in a
  power stream is also why energy figures must come from the
  counters via `energy_delta`, never from power integrals.)

Counter cadence caveat: the cumulative counters do not tick every
sample interval, so hourly attribution is only as granular as the
counter cadence. A battery charge or discharge bucket can land a
whole counter delta in one hour (a bursty bucket), and a low-cadence
PV counter leaves hours with no PV rows at all. Both are expected
hourly-attribution behavior: period totals stay exact because they
sum `energy_delta`, only the per-hour placement of energy can shift.
Consumers of hourly figures (the per-slot chart, the base load
method in section 6.1) guard against the bursts instead of treating
them as consumption shape.

## 2. Periods

All periods are Europe/Amsterdam local calendar windows, half-open
[start, end):

- day: local midnight to the next local midnight
- week: Monday 00:00 to the next Monday 00:00 (ISO weeks)
- month: the first to the next first of the calendar month
- year: January 1 to January 1 of the next year

The breakdown's windows match the summary card's figures exactly for
today, this week and this month.

## 3. Usage breakdown calculation

GET /api/usage/breakdown?period=day|week|month|year&date=YYYY-MM-DD
(default date: today) returns every category with kWh and cost, the
previous period's totals per category, and the measured/estimated
split. The response carries one washing machine entity, exactly one
(see 3.1).

### 3.1 Category registry

Measured categories map counter entities by `ha_entity_id`. The
registry is extensible: adding a category (the office plug, once
installed) or another entity to an existing category is a one-entry
change to `USAGE_CATEGORIES` in `server/queries.mjs`.

- dishwasher: `sensor.kitchen_dishwasher_cumulative_energy` (the
  plug counter)
- dryer: `sensor.garage_dryer_cumulative_energy` (the plug counter)
- washing_machine: `sensor.garage_washing_machine_cumulative_energy`
  (the plug counter)

R1 resolution: the Samsung counters `sensor.garage_washer_energy`
and `sensor.garage_washer_power` measure the same machine and are
excluded from the registry, since counting them would double count
the washing machine.

A measured category's kWh is the sum of its entities'
`energy_delta` in the window; its cost sums each hour's kWh at that
hour's dynamic price (hours without a price row count toward kWh but
not toward cost).

### 3.2 Heat pump estimate ("Est." class)

No heat demand entity exists (R1), so the heat pump's electricity is
estimated, never measured, and carries the "Est." class. The
estimate reuses the Heat tab hybrid model's conversion chain:

1. Activity proxy: a local day is heating-active when any heat zone's
   hourly temperature sits below its setpoint minus the heat
   hysteresis (`EMS_HEAT_HYSTERESIS`) in any hourly bucket. The
   sparse setpoint stream is forward-filled per zone, with a
   staleness guard: a forward-filled setpoint stops counting
   `EMS_HEAT_SETPOINT_STALENESS_HOURS` (default 24) after its last
   real sample, so a dead setpoint sensor cannot imply endless
   heating.
2. Heating gas, a daily figure (the gas counter updates hourly, so
   hourly gas attribution is not supported): on each heating-active
   day, measured gas minus that day's share of the configurable
   non-heating baseline (`EMS_GAS_NON_HEATING_BASELINE_M3_PER_MONTH`,
   default 20 m3 per month, prorated over the days of the day's
   calendar month), floored at zero per day. Days without heating
   activity contribute nothing, so a summer window estimates near
   zero.
3. Electricity: heating gas times the calorific value
   (`EMS_GAS_CALORIFIC_KWH_PER_M3`, default 9.9) times the boiler
   efficiency (`EMS_BOILER_EFFICIENCY`, default 0.9) gives the
   delivered heat; the flat COP converts it to electricity. The flat
   COP reuses the existing heat model config's 7 C anchor
   (`EMS_COP_AT_7C`, default 3.0) as a single value instead of its
   outdoor-temperature curve.

```
heating gas (m3)  = sum over heating-active days of
                    max(0, day gas (m3) - baseline / days in month)
heat pump (kWh)   = heating gas * calorific * boiler efficiency / flat COP
```

### 3.3 Measured/estimated split

- `measured_kwh`: the sum over the registry's categories.
- `estimated_kwh`: the heat pump estimate.
- `remainder_kwh`: the remainder bucket (3.4).

### 3.4 Remainder

The remainder is what the measured categories and the estimate do
not account for:

```
remainder (kWh) = max(0, total_usage_kwh - measured_kwh - estimated_kwh)
```

Within rounding, remainder equals total minus measured and
estimated. The floor at zero guarantees no negative value: if the
estimate ever overshoots the window's total usage, the remainder
reads zero rather than negative.

### 3.5 Costs

Every category carries a cost alongside its kWh:

- Measured categories: per hour at the dynamic price (3.1).
- The heat pump estimate and the remainder have no hourly shape, so
  they are costed flat at the window's average hourly price.
- A category with zero kWh costs zero, even when the window has no
  price rows; non-zero energy without any price row costs null.
- The window total cost is the sum of the category costs; it is null
  when the window has no price rows at all.

### 3.6 Previous period

The previous period is the same-length period immediately before the
anchored one (yesterday, the previous ISO week, the previous calendar
month, the previous calendar year). The response carries
`previous_kwh` and `previous_cost_eur` per category, the previous
total, and the previous measured/estimated/remainder split. Periods
before the gas and heat data starts estimate zero heat pump use.

### 3.7 Guarantees

- Every category appears in every response, with kWh and cost, even
  at zero.
- No value in the response is negative.
- The response contains exactly one washing machine entity
  (`categories[key=washing_machine].entities` has length 1).

## 4. Terms

Energy mode and cost mode (the Energy/Cost toggle in the page
toolbars, URL-persisted as `mode=energy|cost`): the primary metric is
kWh in energy mode and EUR in cost mode; the secondary metric is
always the other one.

## 5. Usage treemap (left panel of the Usage tab)

The Usage tab's top section is a two-column responsive grid: the
category treemap on the left, the category insights panel as a
placeholder on the right (a later phase fills it). On narrow screens
the panels stack.

### 5.1 Panel

The treemap panel uses the shared PanelHeader (the price widget's
extracted header). Its description names what the areas encode in the
active mode: "Where the household's energy went" in energy mode,
"Where the household's money went" in cost mode, each with the period
label. The caption beneath the treemap states the period total and
the previous period's total, both in the primary metric.

### 5.2 Tiles

The treemap shows the known set only: the measured categories and
the heat pump estimate. The remainder is not a tile - the Rest of
your home card (section 7.2) owns it completely.

- Tile area encodes the primary metric (section 4), normalized
  within the known set: the tiles fill the panel, while every label
  stays honest to the period total.
- Each tile shows the category label, the primary metric, the
  secondary metric and its true share of the period total; tiles
  below 3,000 px2 drop the value lines, below 9,000 px2 the label
  and primary value only.
- The panel subtitle states the coverage: the known set's total,
  the period total and the share between them, for example "Metered
  appliances and heat pump estimate, 14.5 of 91.4 kWh, 16% of the
  period" (in the active mode's metric).
- The heat pump tile carries the "Est." badge.
- Category colors are fixed per key (dishwasher slate-teal, dryer
  terracotta, washing machine plum, heat pump brick), fixed per key -
  muted, warm-leaning tones that sit with the dashboard's warm
  dark-brown glass aesthetic.
- Within the known set, categories under 2 percent of the period's
  primary total collapse into one "Other" tile (darker neutral) - 2
  percent is the smallest share that still fits a label and value on
  a laptop panel. "Other" appears only when its own share reaches 1
  percent (a smaller bucket would be an unreadable sliver and is
  omitted from the treemap).
- When the known set is zero or near zero - no category clears the
  collapse floor - the treemap shows an empty state instead, pointing
  at the Rest of your home card.

### 5.3 Tooltip

Hovering (or keyboard-focusing) a tile shows a popover anchored at the
tile's top-left corner, clamped inside the panel:

- the category label, with the "Est." badge when the category is
  estimated;
- the primary metric and its share of the period total;
- the secondary metric;
- the previous period's primary value.

### 5.4 Behavior

- Switching Day/Week/Month/Year refetches the breakdown anchored to
  the period; the previous period stays on screen while the new one
  loads, and the tiles transition to their new positions and sizes
  (no remount, no flicker).
- Toggling Energy/Cost swaps primary and secondary everywhere on the
  tab at once: the treemap areas and tile figures, the panel header,
  the period summary's stats, the Rest of your home card's figures,
  and the per-slot chart's bars.
- Periods before the data start, periods with no recorded usage and
  fetch failures each show their own empty or error state inside the
  panel.

## 6. Home model registry

The background devices without their own measured counter are
estimated per local day by the HOME_MODEL registry in
`server/queries.mjs`: the static entries below, plus one data-derived
entry, the base load, computed per covered day from that day's own
data instead of a static estimate. Extensible like the category
registry; each entry carries a name, its figure and a basis note
stating where the figure comes from. The base load's basis note
states the data-derived method. The base load absorbs all always-on
standby - the refrigerators, the network and standby, and the
standby and keep-hot draw of devices without their own entry, the
kitchen boiler, microwave and coffee machine included - so those
devices carry no static entry; their occasional usage bursts belong
to the unexplained remainder.

### 6.1 Base load (data-derived)

The base load absorbs all always-on standby - the refrigerators,
the network and standby, the standby share of the lighting, and the
kitchen devices' standby and keep-hot draw (the boiler, the
microwave, the coffee machine) - so no static entry double counts
it. Per covered day it is computed from the day's own data:

1. Hourly consumption: the five-counter formula of section 1 per
   hour, floored at zero per hour, from the same `energy_delta`
   counters as the period total.
2. Candidate hours: the day's quiet nighttime hours (default 22:00
   to 06:00 local, wrapping midnight), widened to the day's full
   24 hours when too few nighttime hours survive the guards.
3. Guards: an hour whose battery charge exceeds the configured
   threshold (default 0.05 kWh) never qualifies - the charge term
   is a sink, and a bursty battery bucket (the counter-cadence
   caveat in section 1.1) lands its whole delta in one hour, reading
   that hour's consumption artificially low; a day with fewer than
   the configured minimum candidate hours (default 3) carries no
   base load at all, so sparse counter cadence cannot fabricate one.
4. Statistic: the default method ("median_low") takes the median of
   the day's lowest few candidate hours (default 4); the alternative
   ("percentile") takes a low percentile of the candidates (default
   10). Both are robust against a residual bursty bucket reading
   high. The per-day figure is the hourly statistic times 24 hours,
   capped at the day's own total consumption and rounded to two
   decimals, so period sums stay exact.
5. In-progress day prorating: the current day - the local day
   containing now, still accumulating data - is attributed only its
   covered share: its full-day figure times the day's data-covered
   hours (the local hours that carry measured rows) over 24. A
   morning day view therefore never models a full day of standby
   draw against a few hours of usage, and the week and month views
   no longer understate the unexplained remainder until midnight.
   Every other day - past days, or the current day once all 24
   hours carry data - keeps its full-day figure unchanged; a share
   that rounds to zero carries no base load at all.

The method is tunable in config (environment variables; unset, empty
or invalid values fall back to the default):

| knob | default | meaning |
| --- | --- | --- |
| `EMS_BASELOAD_METHOD` | `median_low` | `median_low` or `percentile` |
| `EMS_BASELOAD_LOW_HOURS` | 4 | the lowest candidate hours the median method uses |
| `EMS_BASELOAD_PERCENTILE` | 10 | the percentile method's percentile |
| `EMS_BASELOAD_NIGHT_START` | 22 | quiet window start, local hour |
| `EMS_BASELOAD_NIGHT_END` | 6 | quiet window end, local hour |
| `EMS_BASELOAD_MIN_HOURS` | 3 | minimum candidate hours for a day to carry a base load |
| `EMS_BASELOAD_MAX_CHARGE_KWH` | 0.05 | battery-charge guard threshold in kWh |

### 6.2 Static entries

| key | entry | kWh/day | basis |
| --- | --- | --- | --- |
| lighting | Lighting | 1.1 | evening use of the 36 Hue lights; the lights' standby draw is covered by the data-derived base load |

The kitchen boiler, microwave and coffee machine carry no static
entry: their standby and keep-hot draw is part of the always-on
standby the base load absorbs from the quiet-night hours, so a
static entry would double count it, and their occasional usage
bursts belong to the unexplained remainder below.

Per period, each static entry's estimate is `kwh_per_day` times the
window's data-covered days - the local days that carry measured
data, from the grid import counter's first to last row in the
window, capped at the calendar days. A fully covered period scales
by its calendar days; an in-progress month (or a window that
starts before the data history) never models a whole month of
standby draw against the days that actually have usage. The base
load's per-period figure is the exact sum of its per-day figures
over those same covered days; days the guards reject contribute
nothing.

The breakdown payload carries `home_model` with `days`, the scaled
`entries` (the base load entry first, with `derived: true`),
`modeled_kwh` and `unexplained_kwh` = `max(0, remainder -
modeled_kwh)`, plus `avg_price_eur` (the window's average hourly
price, null without price rows) as the flat basis for costing
modeled energy. Every per-period entry figure is exact at two
decimals, so the entries plus the unexplained share equal the
remainder exactly for all periods.

## 7. Right column and summary card (Usage tab)

The Usage tab's final layout: the period summary leads as a
full-width page header (the section's title and period, outside any
card) with its three stats as a row of stat cards beneath - the
home page stat cards' composition, horizontal from the sm
breakpoint up, vertical on phones. One glass card then carries the
two breakdown sections side by side - the Usage breakdown left,
Rest of your home right, a soft divider between them from the lg
breakpoint up; beneath it, the per-slot chart (section 8) spans
the full width. On narrow screens the single-column order is
summary stats, breakdown, Rest of your home, chart. Every section
header uses the shared header idiom (PanelHeader for standalone
panels, SectionHeader inside the shared card). Toggling
Energy/Cost swaps their metrics in place, no remount.

### 7.1 Period summary strip

The period summary card (stacked above the treemap in the left
column) presents the with-and-without comparison as a three-stat
glass row in the price widget's stat composition. Each stat carries
the same shape: eyebrow, big primary, secondary line, one muted
detail line. On narrow screens the stats wrap like the price
widget's (`grid gap-3 sm:grid-cols-3`).

- Stat 1, Household usage: the mode's primary metric large with the
  secondary beneath, the previous-period delta (both metrics) as its
  detail line. The actual physical total and its cost - what the same
  usage would cost without solar and battery, all imported at the
  dynamic hourly price.
- Stat 2, Net grid: net grid volume (import minus export) with the
  net grid cost beneath and the gross import and export volumes as
  its detail line - the provider billing view.
- Stat 3, Saved and earned: the difference between the two cost
  figures (money by definition, in either mode, accented light green
  so the headline pops), with the kWh that never drew net from the
  grid (total minus net, self-supplied plus exported) beneath and the
  window's average price as its detail line.
- The corner info tooltip (the home page stat cards' idiom) carries
  both caveats: the valuation basis (household usage includes
  self-supplied energy, costed as if all imported at the dynamic
  hourly price) and the fixed network fees excluded from the
  provider billing view.

The payload's grid statistics back the figures: `grid_import_kwh`,
`grid_export_kwh`, `import_cost_eur` (hourly import energy times
the hourly price) and `export_credit_eur` (hourly export energy
times the hourly price). Without usable price rows the two priced
fields are null, never zero.

Sign handling: net figures carry their own sign. A positive net
reads plain ("7.3 kWh"); a net-exporter period reads negative
("\u22120.5 kWh"), and the net cost reads negative when the feed-in
credit exceeds the import cost ("\u2212€0.35"). Saved and earned is
signed the same way. Without price data the net cost and saved
figures read unavailable, never zero (the net kWh is physical and
stays available). The strip is the predecessor of the U6 widget 1.

### 7.2 Rest of your home

- Header line: the remainder for the period and its share of the
  period total - the same figures as the treemap's gray remainder
  tile, from the same payload numbers. The panel header's
  description carries the one-line basis note: household
  consumption, grid export excluded.
- One horizontal bar per modeled device: the estimate times the
  window's days, with its percentage of the remainder (shares
  against the remainder, not the period total) and its basis note.
  Every modeled number carries the "model" label; the data-derived
  base load bar carries the "data" label instead.
- A final striped bar: the unexplained remainder the model does not
  cover - the occasional usage of unnamed devices, since the base
  load already absorbs all always-on standby, the kitchen boiler,
  microwave and coffee machine included, and only their usage
  bursts and other unattributed draw land here. The bar percentages
  plus the unexplained share equal 100 percent of the remainder
  (or, when the model over-explains a low-usage period, 100 percent
  of the modeled sum with no unexplained bar).
- One-line footnote: every category is measured except the heat
  pump (Est.); the base load is data-derived, the other bars are
  home-model averages.
- Cost mode costs every modeled figure flat at the window's average
  price; without price rows the cost figures read unavailable, never
  zero.

## 8. The per-slot chart (Usage tab)

The full-width chart beneath the two-column area, with the shared
PanelHeader: one neutral bar per slot showing the slot's total
household consumption - the same five-counter formula as the period
total (section 1), computed per slot and floored at zero - so the
bars sum to the period total within that floor.

- Period granularity: every slot of the period is plotted, including
  the ones without data yet - a day period renders 24 hourly bars (a
  consistent 0 to 24 axis), a week 7 daily bars, a month one slot per
  calendar day (the days ahead sit on the axis without a bar), a year
  12 monthly slots.
- The bars carry rounded top corners (flat on the axis) and the y
  axis shows gridlines with labels at round step values; the x axis
  labels each slot (every third hour, the week's days or the
  day-of-month, the month abbreviation).
- The bars follow the mode: kWh in energy mode, the slot's EUR at
  the slot's average hourly price in cost mode.
- The hourly price overlay: an amber line on its own scale (min to
  max of the slot prices, labeled at the right edge), always
  EUR/kWh in both modes, on by default with a single toggle.
- The now marker: the dashed vertical line at the current local
  hour, on the current day period only.
- No per-series legend.
- The shared hover tooltip, one shape for every granularity: the
  slot's label (hour, day or month), the slot's total kWh, its EUR
  at the slot price, and the per-category breakdown of the slot's
  active categories - the measured plug categories plus the heat
  pump with its "Est." label at day and month granularity (the
  daily gas figure cannot be attributed to hours, so hourly slots
  carry the measured categories only).
- Without price rows a slot's price and cost read null (the
  null-cost rule), never zero.
