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

The top of the page has the stats header row - the four stat cards (From
grid, Home usage, To grid, Energy cost) with their labels, week/month
sublines and info tooltips - beside the AI insight panel, which carries
the "Based on data from {as_of}" stamp, the stale note when the daily AI
limit is reached, the summary text, the action list and a force-refresh
control.

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

Below roughly 1024 pixels the widget grid stacks to one column in the
order battery panel, live energy flow, solar forecast, price chart.

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
- `GET /api/summary` - today, this week and this month headline metrics
- `GET /api/insight/daily` - AI-generated daily summary with recommended actions
- `GET /api/prices?days=N` - merged hourly price curve (today plus N-1 more days, default 2) with per-day stats and the cheapest 3-hour window
- `GET /api/prices/cheapest?hours=N` - the cheapest N consecutive hours from now, by average price

The frontend consumes these through the typed client in `src/lib/api.ts`.

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

The AI insight is generated by Mistral (`MISTRAL_API_KEY` in `.env`). It is
cached server-side: a new upstream call happens only when the forecast
payload changes, never more than once every 30 minutes, and at most
`MISTRAL_DAILY_CALL_LIMIT` (default 20) calls per UTC day. When the API is
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
cached on the source data, at most one Mistral call every 30 minutes, and
HTTP 200 with `text: null` on failure. Both insight boxes share one daily
Mistral call cap (`MISTRAL_DAILY_CALL_LIMIT`, default 20).

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
production as actual and forecast separately (e.g. "pv today: 9.5 kWh
actual (forecast 15.88 kWh)") and never presents the forecast as realized
production.

`GET /api/insight/daily` returns an AI-generated one-liner for the dashboard
header, a daily summary with up to three recommended actions (a bold time
window, the action and the reason), all from a single JSON response that is
parsed defensively with one retry. The response also carries `as_of` (the
summary cache timestamp the text is based on) and `stale` (true when the
inputs materially changed but the daily Mistral cap was exhausted, so the
cached text is served).

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
default 20) like any other call; the other insight boxes (weather, prices,
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

