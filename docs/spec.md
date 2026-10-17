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
- The Anker Solarbank has its own DC solar input (up to 5.8 kW
  observed), measured only as instantaneous power. Its stored share
  flows through the charge counter, so - if anything - the total
  under-counts by the home-served share of that second array.

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
- Category colors are fixed per key (dishwasher blue, dryer orange,
  washing machine purple, heat pump rose), shared with the appliance
  widgets where the categories overlap.
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
  the totals table's leading column, and the appliance tiles' primary
  figure.
- Periods before the data start, periods with no recorded usage and
  fetch failures each show their own empty or error state inside the
  panel.

## 6. Home model registry

The steady background devices without their own measured counter
are estimated per local day by the HOME_MODEL registry in
`server/queries.mjs`. Extensible like the category registry; each
entry carries a name, an estimated kWh per day and a basis note
stating where the estimate comes from.

| key | entry | kWh/day | basis |
| --- | --- | --- | --- |
| lighting | Lighting | 1.5 | 36 Hue lights including standby draw; evening use plus idle |
| refrigerators | Refrigerators | 2.5 | two compressor refrigerators at roughly 50 W average each |
| kitchen_boiler | Kitchen boiler | 1.0 | small keep-hot water boiler at roughly 40 W average |
| microwave | Microwave | 0.2 | standby draw plus a few minutes of daily use |
| coffee_machine | Coffee machine | 0.3 | keep-hot element plus the daily brews |
| network_standby | Network and standby | 0.6 | router, switches and hub idle draw |

Per period, each entry's estimate is `kwh_per_day` times the
window's data-covered days - the local days that carry measured
data, from the grid import counter's first to last row in the
window, capped at the calendar days. A fully covered period scales
by its calendar days; an in-progress month (or a window that
starts before the data history) never models a whole month of
standby draw against the days that actually have usage. The
breakdown payload carries `home_model` with `days`, the scaled
`entries`, `modeled_kwh` and `unexplained_kwh` = `max(0, remainder -
modeled_kwh)`, plus `avg_price_eur` (the window's average hourly
price, null without price rows) as the flat basis for costing
modeled energy.

## 7. Summary strip and right column (Usage tab)

The tab's grid is two columns: the left column stacks the period
summary strip above the Usage breakdown panel, the right column
holds the Rest of your home card alone. On narrow screens the
single-column order is summary, treemap, Rest of your home. Both
panels use the shared PanelHeader. Toggling Energy/Cost swaps
their metrics in place, no remount.

### 7.1 Period summary strip

The period at a glance, inline across the full width: the mode's
primary metric large with the secondary metric beside it, the
window's average price, and the previous-period delta in both
metrics (signed, "+64.9 kWh · +€25.20"). Cost figures over a window
without price rows show the unavailable state - a dash and an
explicit note - never zero. The strip is the predecessor of the U6
widget 1.

### 7.2 Rest of your home

- Header line: the remainder for the period and its share of the
  period total - the same figures as the treemap's gray remainder
  tile, from the same payload numbers.
- One horizontal bar per modeled device: the estimate times the
  window's days, with its percentage of the remainder (shares
  against the remainder, not the period total) and its basis note.
  Every modeled number carries the "model" label.
- A final striped bar: the unexplained remainder the model does not
  cover. The bar percentages plus the unexplained share equal 100
  percent of the remainder (or, when the model over-explains a
  low-usage period, 100 percent of the modeled sum with no
  unexplained bar).
- One-line footnote: every category is measured except the heat
  pump (Est.); the bars are home-model averages.
- Cost mode costs every modeled figure flat at the window's average
  price; without price rows the cost figures read unavailable, never
  zero.
