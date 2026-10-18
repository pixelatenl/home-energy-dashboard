# home-energy-dashboard

React frontend built with Vite, TypeScript, Tailwind CSS v4, and shadcn/ui.

## Getting started

```bash
pnpm install
pnpm dev:all       # start dev server at http://localhost:5173 (including the api server)
pnpm build     # type-check and build for production
pnpm lint      # run oxlint
pnpm preview   # preview the production build
```

## Adding shadcn/ui components

```bash
pnpm dlx shadcn@latest add <component>
```

## Structure

```
src/
├── components/ui/   # shadcn/ui components
├── lib/utils.ts    # cn() helper for class merging
├── App.tsx         # placeholder dashboard page
└── main.tsx        # app entry point
```

## Layout

The top of the page is the stats hub: a full-width grid of four
cards per row over two rows - the Saved and earned card (today's
usage-breakdown figures) leading, then the grid and home usage stat
cards, the solar forecast, the battery status, and the Solar today and
Battery today chart cards - with the eighth slot held open for a
future card. Below it, the AI insight panel (which carries the
"Insight from HH:MM" stamp with its stale badge, the summary text,
the action list and a force-refresh control that disables itself when
the AI budget is exhausted or the insight already matches the data)
sits beside the price chart. The live energy flow lives on its own
page at /live, which carries the flow hero alone and a Back to today
link at its bottom.

Below that the widgets form a 2x2 grid on wide screens: the battery panel
and the live energy flow widget side by side in the first row, the solar
forecast and the price chart in the second. The live energy flow widget
draws the flow snapshot from `/api/summary` as four nodes (Sun left, Home
center, Grid right, with Battery below Home). The diagram is enlarged to
fill the widget width: nodes one and a half times their previous size,
each carrying its icon, name and live figure in body text size - Sun the
PV watts, Home the current household consumption in watts, Battery the
SOC percent with its power, Grid the import or export watts. Each active
flow shows its watt value in a pill-shaped chip, sitting on its arrow. The arrows keep the strict mappings and
colors (solar to battery and to home in warm yellow, grid charging of the
battery in green, grid import in blue, export in violet, battery discharge
in amber), and every arrow hides below 25 W. The Home node's figure is the
sum of the visible incoming arrows, so the diagram always balances
visually regardless of the individual series' refresh moments. The
diagram is built as data (arrays of nodes with positions, icons and
values, and edges with endpoints, values and colors) with rendering as a
separate pass over that data, so a future illustrated house view can
swap the render pass without touching the data logic. The layout is
stable, so arrows appearing or disappearing never reflow it.

Below roughly 1024 pixels the stats grid stacks to two cards per
row and the advisory and price chart to one column.

## Local data server

A small Express server in `server/` reads directly from the TimescaleDB
instance on the local network and exposes JSON endpoints under `/api`. The
Vite dev server proxies `/api` to it (see `vite.config.ts`), so the frontend
calls same-origin URLs.

### Configuration

Copy `.env.example` to `.env` and fill in the connection details:

```bash
cp .env.example .env
```

| Variable      | Meaning                                  |
|--------------|------------------------------------------|
| `DB_HOST`    | TimescaleDB host on the local network    |
| `DB_PORT`    | PostgreSQL port (default `5432`)         |
| `DB_NAME`    | Database name                            |
| `DB_USER`    | Database user                            |
| `DB_PASSWORD`| Database password                        |
| `API_PORT`   | Optional; API server port (default `5273`, separate from Vite's `5173`) |
| `BATTERY_CAPACITY_KWH` | Optional; usable battery capacity for the charge/discharge time estimates (unset hides them) |
| `EMS_FEED_IN_TARIFF_EUR` | Optional; flat override in EUR/kWh for the Solar page's export earnings (unset/0 uses the dynamic return price) |
| `EMS_RETURN_*` | Optional; the dynamic return price's constants - see "Export earnings model" below |

`.env` is git-ignored and must never be committed: this repository is public,
and credentials or LAN IP addresses must not leak into it.

### Running

Start the API server and the Vite dev server together:

```bash
pnpm dev:all
```

The API server listens on port 5273 and the Vite dev server on 5173; the
frontend is at http://localhost:5173. The ports are distinct, so you can
also run the processes separately in any order with `pnpm server` and
`pnpm dev` - just note that `pnpm dev` alone shows the dashboard but the
API endpoints return 502 until the server is started.

### Endpoints

- `GET /api/entities` - entities with id, Home Assistant entity id, domain, unit, counter flag
- `GET /api/totals/daily?days=N` - per-entity daily kWh sums (default 7 days)
- `GET /api/totals/hourly?hours=N` - per-entity hourly kWh sums (default 24 hours)
- `GET /api/series/hourly?hours=N` - average and max power per entity per hour (default 24 hours)
- `GET /api/current` - latest measurement per entity
- `GET /api/summary` - today, this week and this month headline metrics, plus the context snapshot's `as_of`, its `signature`, the cached AI insight with its own `insight_as_of` and `stale` marker, and `remaining_calls` in the shared Mistral budget (see "AI insight gating")
- `GET /api/insight/daily` - AI-generated daily summary with recommended actions (the same insight `/api/summary` embeds, served on its own)
- `GET /api/prices?days=N` - merged hourly price curve (today plus N-1 more days, default 2) with per-day stats and the cheapest 3-hour window
- `GET /api/prices/cheapest?hours=N` - the cheapest N consecutive hours from now, by average price
- `GET /api/battery/flow?period=day|week|month|year&date=YYYY-MM-DD` - the period-anchored battery charge/discharge flow: hourly buckets with the SOC series on a day, daily aggregates on week and month, monthly on year; money figures (charge cost, discharge value, arbitrage) priced bottom-up at the dynamic hourly price. No params means today
- `GET /api/debug/time` - server clock, timezone and local bucket diagnostics with raw rows, plus `ha_fetch` (HA price fetch success, forecast age) and `mistral` (daily limit, calls today, remaining calls)

The frontend consumes these through the typed client in `src/lib/api.ts`.

### Export earnings model

The Solar page's cost mode prices exported kWh per hour at
Zonneplan's dynamic return price, derived from the same hour's
all-in consumption price (the price table's series):

```
market price        = consumption price / (1 + VAT) - energy tax - handling fee
return price        = market price + feed-in handling fee
return price       *= (1 + solar bonus)   only when the market price is
                                          positive and the hour is daytime
```

- The return price excludes energy tax and VAT by construction, so
  the earnings figures are ex VAT and ex energy tax. Negative market
  prices are valid and the return price is never clamped.
- The Zonnebonus is the invoice-confirmed 10%. Zonneplan publishes
  it as daytime-only and excluding home-battery feed-in; the exact
  daytime window is not published, so `EMS_RETURN_BONUS_START_HOUR`
  / `EMS_RETURN_BONUS_END_HOUR` (local hours, default 7-18) are an
  assumption that must be calibrated against the first annual
  settlement (jaarafrekening). The battery's evening export rides
  the same grid counter, so bonus-hour earnings can be slightly
  overstated.
- The energy tax refund under saldering is a fixed monthly advance
  reconciled annually; it is not a per-kWh export component and
  never appears in these figures.

Constants (2026 defaults, all env-overridable): VAT 21%, energy tax
EUR 0.11085/kWh excl. VAT (Belastingplan 2026; Zonneplan's own page
quotes 0.1108), consumption handling fee EUR 0.0165/kWh excl. VAT
(Zonneplan's published EUR 0.02/kWh incl. VAT), feed-in handling fee
EUR 0.02/kWh, solar bonus 10%. The energy tax changes every
1 January and Zonneplan revises its fees: review
`EMS_RETURN_ENERGY_TAX_EUR` and the handling fees each January, and
cross-check the model against the annual settlement invoice. The
known energy tax trajectory for easy January updates: 0.12286
(2025), 0.11085 (2026), 0.10648 (planned 2027 per the Belastingplan
2027 proposal - confirm when it is enacted).
Setting `EMS_FEED_IN_TARIFF_EUR` to a positive value replaces the
whole construction with that flat rate; the dashboard runs in
dynamic mode and leaves it unset.

### Time and timezones

All stored timestamps are UTC; every user-facing day and hour bucket is
Europe/Amsterdam local time. All conversion goes through the shared helpers
in `server/time.mjs` (`localDateKey`, `localHourKey`, `localHourIndex`,
`localDayStartUtcMs`, `nextDateKey`), which use `Intl.DateTimeFormat` with
the named `timeZone: "Europe/Amsterdam"` option - never a fixed offset and
never the server's ambient timezone. Nothing slices UTC ISO strings into
buckets; the only string slicing happens on local keys the helpers
themselves produced.

Day keys are advanced with calendar arithmetic (`nextDateKey`), not by
adding 24 hours to a Date, because a DST day is 23 or 25 hours long.
`localDayStartUtcMs` probes the offset at 00:30 UTC, before Amsterdam's
transitions, so local midnight is correct on transition days too. The DST
transition on 26 October therefore requires no configuration change: the
helpers use the named timezone, so CET applies automatically after the
transition.

The server logs one line at startup with the UTC time, the `TZ` variable
and the resolved timezone, and `GET /api/debug/time` shows the same
information live plus the local date and hour the server computes, the
price row it considers current, and one raw measurement and one
`energy_delta` row, so stored and displayed time can be compared when
something looks misaligned.

### Weather widget

Two more endpoints serve an Open-Meteo forecast (free, no API key) for the
home location from `EMS_LAT`/`EMS_LON` in `.env`:

- `GET /api/weather/daily?days=N` - per-day forecast starting today (default 5, max 6): weather code, min/max temperature, solar score (0-100), estimated PV kWh, sunrise, sunset; today's row also carries `actual_today_kwh`, the PV production so far today (null before any production)
- `GET /api/weather/hourly?date=YYYY-MM-DD` - hourly forecast for one day (default today) with a `current` object holding Open-Meteo's current-conditions analysis: temperature, weather code, cloud cover, precipitation probability, estimated PV Wh
- `GET /api/weather/context` - a short AI-generated summary of the forecast (solar outlook, today's production peak, one practical tip), or `text: null` when unavailable

Present conditions come from Open-Meteo's `current` analysis rather than the
hourly forecast series, and the widget uses them for the current hour. The
hourly data merges two models, fetched in parallel into one 30-minute cache
entry: the KNMI HARMONIE AROME model (2 km inset for the Netherlands via
`models=knmi_seamless`) supplies temperature, weather code, cloud cover,
precipitation probability and solar radiation within its horizon - which it
currently covers for the full 6-day window - and the generic blended
best-match model fills any hours or variables beyond or missing from it. The
solar score, estimated kWh and the AI weather context are all derived from
the merged data. If the KNMI endpoint is unavailable, the widget falls back
to the generic forecast for everything. If Open-Meteo itself is
unreachable, the stale cache is served; with no cache the API returns a 502.

Today's tile shows a live accuracy readout: the actual production so far
against the full-day forecast, for example "11.4 kWh so far (72%)", with a
thin progress bar filled to that share (capped at 100 percent). The actual
figure comes from the PV energy counter's `energy_delta` sum for today -
the same aggregation the summary statistics use - and is null before any
production today. The other tiles remain forecast-only.

Each time the forecast is read, the server also upserts today's forecast
value into the `solar_forecast_daily` table (`date`, `forecast_kwh`,
`created_at`, `updated_at`; one row per date, refreshed when the value
changes, never deleted). Historical days thus accumulate forecast values,
while actual production for any date is already recoverable from
`energy_delta`; this history will feed the future solar page.

The AI insight is generated by Mistral (`MISTRAL_API_KEY` in `.env`). It
is cached server-side: a new upstream call happens only when the
signature over its materialized context changes, never more than once
every 30 minutes, and at most `MISTRAL_DAILY_CALL_LIMIT` (default 100)
calls per UTC day shared by every insight widget. When the API is
unavailable or the daily limit is reached, the endpoint returns `text: null`
and the widget hides the box.

### Prices widget

Electricity prices come from two sources merged into one hourly curve:

- the TimescaleDB `price` table, the source of truth for completed hours,
  filled by the ingest worker;
- the Zonneplan quarter-hourly tariff forecast from Home Assistant
  (`HA_URL`, `HA_TOKEN`, `ZONNEPLAN_PRICE_ENTITY` in `.env`), averaged per
  hour for the current and future hours.

The database wins for completed hours, the forecast wins for the current and
future hours; hours absent from both are simply missing and the widget
renders a gap. If Home Assistant is unreachable, the widget still shows the
database history. The merged curve is cached in memory for 10 minutes.

`GET /api/prices/cheapest?hours=N` returns the cheapest N consecutive hours
starting from the current hour across the available horizon, by average
price; the widget highlights it as the cheapest window. Tomorrow's prices
appear once the Zonneplan forecast publishes them (around 18:00); until then
the widget shows a placeholder.

`GET /api/prices/context` returns a short AI-generated commentary on the
price curve (how prices develop between today and tomorrow, the cheapest
window, and a self-consumption tip combining cheap grid hours with the
solar production peak). It follows the same rules as the weather insight:
gated on the signature over its materialized context, at most one Mistral
call every 30 minutes, and HTTP 200 with `text: null` on failure. All
insight widgets share one daily Mistral call budget
(`MISTRAL_DAILY_CALL_LIMIT`, default 100). Tomorrow's prices are only
included in an AI context once the Zonneplan publication status entity
confirms availability - forecast rows alone are never trusted - and model
output that still claims unpublished tomorrow prices is rejected and
retried.

### Summary statistics

`GET /api/summary` returns the headline metrics for three ranges - today
(local midnight to now), this week (Monday 00:00 to now) and this month
(first day of the month 00:00 to now) - all in Europe/Amsterdam local time,
cached in memory for 5 minutes. All metrics come from the verified
`energy_delta` counters (precomputed kWh increments per entity, resolved by
`ha_entity_id`); the sparse `measurement` power series is not integrated
because it undercounts. Definitions:

- From grid: grid import kWh ("Electricity imported from the grid")
- PV production and battery charge/discharge: summed from their counters
- Home usage: grid import + PV production - grid export - (battery charged
  - battery discharged) - "Household consumption: from grid + direct solar
  use - export - energy stored in the battery"; energy stored in the
  battery is not counted as household consumption, so with a battery
  charging from the grid the home usage figure can be lower than the grid
  import. The battery net term is clamped at zero only when both battery
  entities are missing, otherwise the true net is used (it may be negative
  on discharge-heavy days). When no PV entity exists, home usage falls
  back to grid import and `pv_available` is false
- To grid: grid export kWh ("Electricity exported back to the grid")
- Energy cost: the sum over each local hour of the hourly import kWh times
  the hourly price including VAT ("Cost of imported electricity at hourly
  dynamic prices"); hours without a price row count toward kWh but not
  toward cost

The four stats cards carry an info icon in the corner with these
definitions as a hover/focus tooltip.

`pv_available` and `battery_available` reflect whether the counter entities
have rows in `energy_delta`. Week and month values cover available data
only.

#### Context snapshot and signature

`GET /api/summary` builds one context snapshot per request on top of the
cached summary statistics: the day totals from `energy_delta`, the merged
price curve (past and forecast), the PV forecast from the weather module
and the battery state. Over the materialized context fields it computes a
`signature`: a stable hash (FNV-1a) of the bucketed values - battery
state, SOC, power and throughput buckets; usage, export and cost buckets;
the current price hour; tomorrow-price availability; the cheapest windows;
solar actual-versus-forecast buckets. Bucketing absorbs trivial drift, so
the signature changes only when the underlying data changes materially.

Every response carries:

- `as_of` - the ISO timestamp of the underlying summary data (the 5-minute
  cache fill the snapshot was built from)
- `signature` - the stable hash over the materialized context fields
- `insight` - the cached daily insight (`one_liner`, `summary`, `actions`)
  with its own `insight_as_of` (the data moment the text is based on, which
  can trail `as_of`), a `stale` marker, and `generated_at`
- `remaining_calls` - the remaining calls in the shared daily Mistral budget

#### AI insight gating

The signature is the primary gate for every Mistral call; the 30-minute
minimum interval per widget sits underneath it:

- An insight is cached together with the signature it was generated from
  and served until the signature changes.
- When the signature changes, a new call is made - but at most once every
  30 minutes per widget. A change inside the interval is served from the
  cache with `stale: true`, and regenerated on the first request after the
  interval expires.
- `?force=1` bypasses the interval but never the daily limit, and still
  counts.
- All four insight widgets (summary, prices, weather, battery) share one
  daily counter against `MISTRAL_DAILY_CALL_LIMIT` (read from the
  environment, default 100; retries also count).
- The model output is validated (schema for the structured actions, and
  context integrity: no claims about tomorrow's prices while the
  publication status entity has not confirmed them). On failure the server
  fails soft: it serves the previous insight with the `stale` marker rather
  than an unverified text. Concurrent requests join one in-flight
  generation.

Every Mistral call decision is logged as one line with the widget, the
signature, the reason (`signature_change`, `throttle_expiry`, `force`) and
the outcome, for example
`[mistral] widget=summary signature=2baba019 reason=signature_change outcome=ok`.
The API key, prompts and context are never logged.

#### Kiosk reliability

The dashboard runs for months in a browser tab on a wall panel, so the
frontend treats the tab as long-lived:

- `/api/summary` is refetched every 5 minutes for the lifetime of the tab
  (matching the server's 5-minute summary cache), and immediately when the
  window regains focus or the network connection comes back online (the
  `online` event) - the two moments a throttled or reconnected tab must
  catch up. Concurrent refetches share one in-flight request.
- The page header shows a visible "Insight from HH:MM" label (the
  `insight_as_of` stamp) with a stale badge whenever the insight is older
  than the underlying data signature.
- The force-refresh button regenerates all AI insights and refreshes the
  widget data, but is disabled when the shared daily budget is exhausted or
  the signature has not changed since the insight was generated.

### Battery

The battery (Anker SOLIX Solarbank Max AC) is fully represented by the
battery panel below the chart widgets; it reads the same `/api/summary`
battery data. The net power is the latest charging power minus the latest
discharging power, where a series whose latest row is more than an hour
old reads as 0 W (the sensors stop updating around zero load, so a stale
series is an idle one and a fresh reading on the other series still
counts). The state applies a 25 W deadband: charging, discharging or
idle. Charge and discharge totals come from the verified `energy_delta`
counters for today, this week and this month; the summary's home usage
already accounts for the battery net term since the counter correction.

### Battery panel

Below the chart widgets a full-width battery panel expands on the compact
card (both consume the same `/api/summary` battery data). Left: a
battery-shaped gauge with the state of charge inside, a caption such as
"91% - Charging +3010 W" and, when `BATTERY_CAPACITY_KWH` is configured and
the battery is active, an estimate of the minutes until full or empty.
Middle: a live energy flow diagram with Sun, Home, Grid and Battery as
circle nodes, arrows and wattage labels drawn from the latest power
readings (`flow` in the summary; each series counts while its most recent
row is less than an hour old). Next: today's throughput (in, out and net
kWh) with this week's and this month's in/out totals beneath. Right: a
combined chart for today - hourly charge kWh as green bars upward from the
zero line, discharge kWh as amber bars downward, and the SOC series (from
the SOC sensor's `measurement` rows) as a line on a secondary 0-100 percent
axis; an empty state appears when there is no data. The battery AI insight
also receives the current price and the cheapest window as context.

The state is derived from net power with a 25 W deadband; a power series
whose latest row is stale reads as 0 W, because the sensors stop updating
around zero load. The panel also carries an AI insight box below the chart
(`GET /api/battery/context`) that comments on the charge state, today's use
and a charging/discharging tip; it follows the same caching, throttling
and shared daily Mistral call cap as the other insight boxes. The AI
summary context also received an actual-versus-forecast rule: it reports pv
production as actual and forecast separately and never presents the
forecast as realized production. The solar facts in the summary context are
strictly separated, explicitly dated lines - "today Sun 11 Oct: actual
11.48 kWh, forecast 15.91 kWh", "tomorrow Mon 12 Oct: forecast 13.27 kWh",
"following days Tue 13 Oct 12 kWh, ..." - so today never appears in a
future series.

`GET /api/insight/daily` returns an AI-generated one-liner for the dashboard
header, a daily summary and up to three recommended actions as structured
data. Each action carries the schema `{ date: "YYYY-MM-DD", start: "HH:MM",
end: "HH:MM", type: "appliance"|"battery"|"ev"|"solar"|"general", title,
reason, price_eur }`; the model is told to recommend only future windows,
to use a short imperative title and a one-sentence reason containing the
key number. The server validates the payload (schema, at most three
actions, non-empty fields, start before end, ascending by start time),
normalizes unknown types to "general" and non-numeric prices to null, and
retries once on invalid JSON. If structured output fails twice, a single
prose fallback call produces the legacy `{ text, window, reason }` format
so the dashboard never breaks; the frontend renders that as a simple list.
Before responding, any structured action whose window has already ended
relative to the summary `as_of` time is dropped - advice for the past is
never shown.

The frontend renders structured actions as designed rows: a day chip
("Today" / "Tomorrow") above the prominent window, a type icon (washing
machine, battery, car, sun, bolt), the title with the reason in smaller
muted text beneath, and the price as a small tag on the right. Actions are
grouped under small day headings when they span multiple days, and the
nearest upcoming action carries a subtle "next" badge. The summary
paragraph keeps its text but renders kWh, price and percentage figures
as chips. The response also carries `as_of` (the summary cache timestamp
the text is based on, shown with its weekday and date) and `stale` (true
when the inputs materially changed but the daily Mistral cap was
exhausted, so the cached text is served).

The daily summary regenerates on a context signature, not a fixed cadence:
the battery state, SOC (10% buckets), power (500 W buckets) and today's
in/out (0.5 kWh buckets); from-grid, home-usage and to-grid kWh (0.5 kWh
buckets) and cost (EUR 0.10 buckets); the current price hour, the cheapest
window ids for today and tomorrow, and the highest remaining price (EUR
0.05 buckets); and actual plus forecast solar production (0.5 kWh
buckets). The bucketed values are hashed into one signature - when it
changes, the insight regenerates immediately; otherwise the cached text is
served. This yields roughly one regeneration per hour from the price hour
changing, plus a handful per day from battery state transitions and kWh
buckets crossing. `?force=1` regenerates once regardless of the signature
and counts against the shared daily cap (`MISTRAL_DAILY_CALL_LIMIT`,
default 100) like any other call; the other insight boxes (weather, prices,
battery) keep their 30-minute refresh cadence under the same cap.

Responses are cached in memory for 30 minutes (10-second upstream timeout).
If Open-Meteo is unreachable, the stale cache is served; with no cache the
endpoints return a 502. Malformed query parameters are rejected with a 400.

The solar panel score is the expected production of the day as a percentage
of the theoretical clear-sky production on the best day of the year at this
location. It reflects absolute production: a sunny July day scores near 100,
a good October day near 35.

### Temporary layer

This server is a temporary data layer. The permanent backend will live in a
separate repository. All SQL is kept in `server/queries.mjs` (parameterized,
never string interpolation of user input), so the migration is a copy
operation: move that file into the new backend and adapt the surrounding
plumbing. If your schema uses different column names, adjust them in
`server/queries.mjs` - nowhere else touches SQL.

### Deployment on the mini PC

In production the same Express process also serves the built frontend from
`dist/`: `express.static` for the assets and an SPA fallback that returns
`index.html` for any non-`/api` GET request, so client-side routing keeps
working on refresh. The server binds to `HOST` (default `0.0.0.0`, reachable
on the home network, not from the internet) and starts on `PORT`
(default `API_PORT`/5273; the service below uses 8080). The frontend calls
the API with relative `/api/...` paths, so no build-time configuration is
needed.

Two committed files under `deploy/` handle the rest:

- `deploy/ems-dashboard.service` - a systemd unit (with a `YOUR_USER`
  placeholder to substitute on the machine) that runs the server from
  `server/` with `server/.env` and restarts it every 10 seconds on failure.
  The real `server/.env` on the mini PC holds the database credentials and
  the remaining secrets; it is never committed.
- `deploy/deploy-dashboard.sh` - pull the latest code, install
  dependencies, build the frontend and restart the service. It aborts on
  any error, so a failed build never restarts the service on stale code.

After a reboot the whole stack (Home Assistant, TimescaleDB, ingest worker
and this dashboard) comes up by itself.
