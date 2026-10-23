# home-energy-dashboard

Home Energy App. React frontend built with Vite, TypeScript, Tailwind CSS v4, and shadcn/ui, served together with a small Express data server that reads a TimescaleDB instance on the home network.

<p align="center">
  <img src="https://pixelate.nl/home-energy-flow.jpg" alt="The home energy dashboard running on a tablet" width="820">
</p>

## Getting started

```bash
pnpm install
pnpm dev:all       # start dev server at http://localhost:5173 (including the api server)
pnpm build         # type-check and build for production
pnpm lint          # run oxlint
pnpm test          # run the node:test unit suite (tests/)
pnpm preview       # preview the production build
```

## Adding shadcn/ui components

```bash
pnpm dlx shadcn@latest add <component>
```

## Structure

```
src/
├── components/    # pages and widgets (one file each, no pages/ split)
├── components/ui/ # shadcn/ui components
├── lib/           # hooks, period/time logic, flow model, API client, formatters
└── main.tsx       # app entry point
server/            # Express API server (see "Local data server")
docs/              # advisory-spec.md (Your Advisor's source of truth) and spec.md
tests/             # unit tests (node:test)
deploy/            # systemd unit and deploy script for the mini PC
```

The app uses react-router-dom with path-based routes. The tabs are Today (the hub), Usage, Solar, Battery and Heat; `/live` (live energy flow), `/debug` and `/architecture` are routes without a tab.

## Pages and layout

The Today hub opens with a full-width grid of eight stat cards over two rows: the Live power card (a rotating circle alternating the live grid draw with the renewable grid share), Saved and earned, From the grid, Home usage, Solar forecast, Solar today (with a Self usage chip), Battery status and Battery today. Every card is one navigation target (the card-link pattern): the metric cards open today in the Usage, Solar or Battery tab, the solar and battery cards open today in their pages, and Live power opens the live energy flow page. Each card carries an info tooltip in its top-right corner with the figure's definition, and the cards share a fixed composition so their height never changes during the day. Below the stats, the Your Advisor panel (see "Your Advisor") sits beside the prices widget. The Solar today and Battery today charts render as their own compact cards beneath the flow hero on the /live page.

The /live page carries the live energy flow hero alone, with a Back to today link at its bottom. The flow draws the snapshot from `/api/summary` as four nodes (Sun left, Home center, Grid right, with Battery below Home), each with its icon, name and live figure; each active flow shows its watt value in a pill-shaped chip on its arrow. The arrows keep their strict colors and every arrow hides below 25 W. The Home node's figure is the sum of the visible incoming arrows, so the diagram always balances visually. The diagram is built as data (nodes and edges arrays) with rendering as a separate pass, so a future illustrated house view can swap the render pass without touching the data logic.

The spoke pages share a period navigator (segmented Day/Week/Month/Year control, arrows, Today button, URL params) and a global Energy/Cost mode (URL `mode` param; the mode toggle restyles figures without a refetch):

- Usage - a stat card row (Household usage, Net grid, Saved and earned, Self usage), the appliance treemap with the Rest of your home card (the data-derived base load and static home-model entries, an honest unexplained remainder), and a per-slot totals chart with a price line overlay.
- Solar - the PV production chart (energy/cost mode aware, export earnings at Zonneplan's dynamic return price) and the five-day forecast with the hourly strip.
- Battery - the period-anchored charge/discharge flow (hourly on a day, daily on week and month, monthly on a year), the SOC gauge and status block while the period contains now, and the totals as stat rows.
- Heat - the nine-zone temperature/setpoint timeline with the outdoor reference and inferred heating intervals, the gas section (mode-aware m3/EUR), and the hybrid heating cost model (gas as the cost basis, the heat pump route as visible estimates).

The visual language is a warm dark-brown glass aesthetic: near-clear glass cards over the body gradient, a muted data-viz palette, a stone text scale, and one skeleton loading system (a shared Skeleton primitive, a 650 ms skeleton floor on first mount, a 300 ms cross-fade reveal) so no card or widget shifts layout when its data lands. Refreshes never flash skeletons; the data hooks keep the previous content while revalidating.

Below roughly 1024 pixels the stats grid steps down to two cards per row (one per row on phones) and the panels stack to one column.

## Local data server

A small Express server in `server/` reads directly from the TimescaleDB instance on the local network and exposes JSON endpoints under `/api`. The Vite dev server proxies `/api` to it (see `vite.config.ts`), so the frontend calls same-origin URLs.

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
| `EMS_LAT` / `EMS_LON` | Approximate location for the Open-Meteo forecast (exact values only in local `.env`, never committed) |
| `HA_URL` / `HA_TOKEN` | Home Assistant REST API for the Zonneplan price forecast |
| `ZONNEPLAN_PRICE_ENTITY` | The quarter-hourly tariff forecast entity |
| `ZONNEPLAN_PRICES_TOMORROW_STATUS_ENTITY` | The tomorrow-prices publication status entity |
| `MISTRAL_API_KEY` | Mistral API key for the insights |
| `MISTRAL_DAILY_CALL_LIMIT` | Optional; shared daily Mistral call budget (default 100) |
| `MISTRAL_SUMMARY_MIN_INTERVAL_MINUTES` | Optional; minimum interval between summary regenerations (default 5) |
| `BATTERY_CAPACITY_KWH` | Optional; usable battery capacity for the charge/discharge time estimates (unset hides them) |
| `EMS_FEED_IN_TARIFF_EUR` | Optional; flat override in EUR/kWh for the Solar page's export earnings (unset/0 uses the dynamic return price) |
| `EMS_RETURN_*` | Optional; the dynamic return price's constants - see "Export earnings model" below |

`.env` is git-ignored and must never be committed: this repository is public, and credentials, LAN IP addresses or the exact home location must not leak into it.

### Running

Start the API server and the Vite dev server together:

```bash
pnpm dev:all
```

The API server listens on port 5273 and the Vite dev server on 5173; the frontend is at http://localhost:5173. The ports are distinct, so you can also run the processes separately in any order with `pnpm server` and `pnpm dev` - just note that `pnpm dev` alone shows the dashboard but the API endpoints return 502 until the server is started.

### Endpoints

- `GET /api/entities` - entities with id, Home Assistant entity id, domain, unit, counter flag
- `GET /api/totals/daily?days=N` - per-entity daily kWh sums (default 7 days)
- `GET /api/totals/hourly?hours=N` - per-entity hourly kWh sums (default 24 hours)
- `GET /api/series/hourly?hours=N` - average and max power per entity per hour (default 24 hours)
- `GET /api/current` - latest measurement per entity
- `GET /api/summary` - today, this week and this month headline metrics, the context snapshot's `as_of` and `signature`, the Your Advisor insight with its regeneration `state` (see "Your Advisor"), `remaining_calls` in the shared Mistral budget, and `server_version` (git hash plus process start time, so a stale process is recognizable)
- `GET /api/insight/daily` - the Your Advisor insight served on its own (the same insight `/api/summary` embeds)
- `GET /api/insight/debug` - read-only traceability for the advisory: the exact context payload, the server-computed action candidates with their exact savings, the price statistics, the composed system prompt and the last generated insight. Composing the context never calls the model.
- `GET /api/appliances?range=today|week|month|year&period=day|week|month|year&date=YYYY-MM-DD` - per-appliance kWh, cost, latest power and hourly breakdown from the smart plug counters; optional `period`/`date` anchor the window to a concrete period
- `GET /api/usage/breakdown?period=day|week|month|year&date=YYYY-MM-DD` - the household usage category breakdown for a period: measured categories, the heat pump estimate (marked "Est."), the remainder bucket, the previous period for comparison, the measured/estimated split, the grid statistics and the per-slot chart series
- `GET /api/solar/production?period=day|week|month|year&date=YYYY-MM-DD` - PV production per interval with the self-consumption avoided cost, the hourly disposition split (to home, to grid, to battery), export earnings at the dynamic return price, and the `returnPricing` meta
- `GET /api/prices?days=N` - merged hourly price curve (today plus N-1 more days, default 2) with per-day stats and the cheapest 3-hour window
- `GET /api/prices/cheapest?hours=N` - the cheapest N consecutive hours from now, by average price
- `GET /api/prices/context` - a short AI-generated commentary on the price curve, or `text: null` when unavailable
- `GET /api/battery/flow?period=day|week|month|year&date=YYYY-MM-DD` - the period-anchored battery charge/discharge flow: hourly buckets with the SOC series on a day, daily aggregates on week and month, monthly on year; money figures (charge cost, discharge value, arbitrage) priced bottom-up at the dynamic hourly price. No params means today
- `GET /api/battery/context` - a short AI-generated commentary on the battery state, or `text: null` when unavailable
- `GET /api/weather/daily?days=N` - per-day forecast starting today (default 5, max 6): weather code, min/max temperature, solar score (0-100), estimated PV kWh, sunrise, sunset; today's row also carries `actual_today_kwh`, the PV production so far today (null before any production)
- `GET /api/weather/hourly?date=YYYY-MM-DD` - hourly forecast for one day (default today) with a `current` object holding Open-Meteo's current-conditions analysis
- `GET /api/weather/context` - a short AI-generated summary of the forecast, or `text: null` when unavailable
- `GET /api/heat/zones?period=day|week|month|year&date=YYYY-MM-DD` - the zone temperature and setpoint series (5-minute samples on a day, hourly averages beyond) with the server-side inferred heating intervals and the outdoor reference
- `GET /api/heat/gas?period=day|week|month|year&date=YYYY-MM-DD` - gas consumption and cost per hour, day or month, priced bottom-up per interval with a last-known-price fallback (never a silent 0)
- `GET /api/heat/model?period=day|week|month|year&date=YYYY-MM-DD` - the hybrid heating cost model: the gas route as the cost basis, the heat pump route as a visible estimate, with the env-derived assumptions echoed back
- `GET /api/debug/time` - server clock, timezone and local bucket diagnostics with raw rows, plus `ha_fetch` (HA price fetch success, forecast age), `mistral` (daily limit, calls today, remaining calls) and `grid_score` (the grid renewables share and its raw uncapped permille)

The frontend consumes these through the typed client in `src/lib/api.ts`.

### Your Advisor

The advisory card is the hub's single deciding AI voice (the weather, prices and battery boxes are explaining voices; they only contextualize their own widget). Its architecture separates four layers so insight and data cannot disagree:

- The server computes every number exactly: the action candidates (an appliance with at least 0.5 kWh today against the cheapest remaining window, or a battery discharge), their savings, the timing guidance (the cheapest remaining window), the day-ahead advisory and the week outlook from the merged price and forecast data. The deterministic rows are composed server-side and rendered verbatim; the model never writes them, so no number can be fabricated.
- The Mistral model only narrates at most three sentences within guardrails: the primary action line, an optional warning and an optional context note. Its output is validated against the server's context (saving verbatim from a candidate, no tomorrow-price claims before the publication status entity confirms them); on failure the server fails soft and serves the previous text.
- The frontend renders a deterministic skeleton: glass rows with day chips, a saving or window value chip, the tomorrow row, optional later days (chronological), and a muted notes zone. Money figures travel raw in the payload and are formatted at display time.
- `GET /api/insight/debug` proves the loop: the claim, the candidates and the context side by side.

The advisory is cached and regenerated on a context signature change (see "Context snapshot and signature"). Beyond the per-widget 30-minute interval, the summary insight has its own shorter minimum interval (`MISTRAL_SUMMARY_MIN_INTERVAL_MINUTES`, default 5) and a proactive warm-up: when the signature changes, `/api/summary` answers immediately with the cached advisory in state `reasoning` while the regeneration runs in the background, so the card keeps itself in line with the live data without a manual refresh. The insight `state` is `fresh`, `reasoning` or `error`; the card shows a pulsing Reasoning chip while regenerating, and the provenance chip and the force-refresh control live in the advisory card's header (`?force=1` bypasses the interval but never the daily limit, and still counts). `docs/advisory-spec.md` is the source of truth for every behavioral rule.

All insight widgets share one daily Mistral call budget (`MISTRAL_DAILY_CALL_LIMIT`, default 100; retries also count). Every call decision is logged as one line with the widget, the signature, the reason and the outcome. The API key, prompts and context are never logged.

### Export earnings model

The Solar page's cost mode prices exported kWh per hour at Zonneplan's dynamic return price, derived from the same hour's all-in consumption price (the price table's series):

```
market price        = consumption price / (1 + VAT) - energy tax - handling fee
return price        = market price + feed-in handling fee
return price       *= (1 + solar bonus)   only when the market price is
                                          positive and the hour is daytime
```

- The return price excludes energy tax and VAT by construction, so the earnings figures are ex VAT and ex energy tax. Negative market prices are valid and the return price is never clamped.
- The Zonnebonus is the invoice-confirmed 10%. Zonneplan publishes it as daytime-only and excluding home-battery feed-in; the exact daytime window is not published, so `EMS_RETURN_BONUS_START_HOUR` / `EMS_RETURN_BONUS_END_HOUR` (local hours, default 7-18) are an assumption that must be calibrated against the first annual settlement (jaarafrekening). The battery's evening export rides the same grid counter, so bonus-hour earnings can be slightly overstated.
- The energy tax refund under saldering is a fixed monthly advance reconciled annually; it is not a per-kWh export component and never appears in these figures.

Constants (2026 defaults, all env-overridable): VAT 21%, energy tax EUR 0.11085/kWh excl. VAT (Belastingplan 2026; Zonneplan's own page quotes 0.1108), consumption handling fee EUR 0.0165/kWh excl. VAT (Zonneplan's published EUR 0.02/kWh incl. VAT), feed-in handling fee EUR 0.02/kWh, solar bonus 10%. The energy tax changes every 1 January and Zonneplan revises its fees: review `EMS_RETURN_ENERGY_TAX_EUR` and the handling fees each January, and cross-check the model against the annual settlement invoice. The known energy tax trajectory for easy January updates: 0.12286 (2025), 0.11085 (2026), 0.10648 (planned 2027 per the Belastingplan 2027 proposal - confirm when it is enacted). Setting `EMS_FEED_IN_TARIFF_EUR` to a positive value replaces the whole construction with that flat rate; the dashboard runs in dynamic mode and leaves it unset.

### Time and timezones

All stored timestamps are UTC; every user-facing day and hour bucket is Europe/Amsterdam local time. All conversion goes through the shared helpers in `server/time.mjs` (`localDateKey`, `localHourKey`, `localHourIndex`, `localDayStartUtcMs`, `nextDateKey`), which use `Intl.DateTimeFormat` with the named `timeZone: "Europe/Amsterdam"` option - never a fixed offset and never the server's ambient timezone. Nothing slices UTC ISO strings into buckets; the only string slicing happens on local keys the helpers themselves produced.

Day keys are advanced with calendar arithmetic (`nextDateKey`), not by adding 24 hours to a Date, because a DST day is 23 or 25 hours long. `localDayStartUtcMs` probes the offset at 00:30 UTC, before Amsterdam's transitions, so local midnight is correct on transition days too. The DST transition on 26 October therefore requires no configuration change: the helpers use the named timezone, so CET applies automatically after the transition. The daily continuous aggregates (`energy_daily`) are aligned to Europe/Amsterdam local days, so day totals match the local calendar; hourly resolution stays UTC hours.

The server logs one line at startup with the UTC time, the `TZ` variable and the resolved timezone, and `GET /api/debug/time` shows the same information live plus the local date and hour the server computes, the price row it considers current, and one raw measurement and one `energy_delta` row, so stored and displayed time can be compared when something looks misaligned.

### Weather widget

The Solar page's forecast is served from Open-Meteo (free, no API key) for the location from `EMS_LAT`/`EMS_LON` in `.env`:

- `GET /api/weather/daily?days=N` - per-day forecast (see Endpoints)
- `GET /api/weather/hourly?date=YYYY-MM-DD` - hourly forecast with the current-conditions analysis
- `GET /api/weather/context` - a short AI-generated summary of the forecast

Present conditions come from Open-Meteo's `current` analysis rather than the hourly forecast series, and the widget uses them for the current hour. The hourly data merges two models, fetched in parallel into one 30-minute cache entry: the KNMI HARMONIE AROME model (2 km inset for the Netherlands via `models=knmi_seamless`) supplies temperature, weather code, cloud cover, precipitation probability and solar radiation within its horizon - which it currently covers for the full 6-day window - and the generic blended best-match model fills any hours or variables beyond or missing from it. The solar score, estimated kWh and the AI weather context are all derived from the merged data. If the KNMI endpoint is unavailable, the widget falls back to the generic forecast for everything. If Open-Meteo itself is unreachable, the stale cache is served; with no cache the API returns a 502.

Today's tile shows a live accuracy readout: the actual production so far against the full-day forecast, for example "11.4 kWh so far (72%)", with a thin progress bar filled to that share (capped at 100 percent). The actual figure comes from the PV energy counter's `energy_delta` sum for today - the same aggregation the summary statistics use - and is null before any production today. The other tiles remain forecast-only.

Each time the forecast is read, the server also upserts today's forecast value into the `solar_forecast_daily` table (`date`, `forecast_kwh`, `created_at`, `updated_at`; one row per date, refreshed when the value changes, never deleted). Historical days thus accumulate forecast values, while actual production for any date is already recoverable from `energy_delta`; this history feeds the Solar page's actual-versus-forecast views.

### Prices widget

Electricity prices come from two sources merged into one hourly curve:

- the TimescaleDB `price` table, the source of truth for completed hours, filled by the ingest worker;
- the Zonneplan quarter-hourly tariff forecast from Home Assistant, averaged per hour for the current and future hours.

The database wins for completed hours, the forecast wins for the current and future hours; hours absent from both are simply missing and the widget renders a gap. If Home Assistant is unreachable, the widget still shows the database history. The merged curve is cached in memory for 10 minutes.

`GET /api/prices/cheapest?hours=N` returns the cheapest N consecutive hours starting from the current hour across the available horizon, by average price; the widget highlights it as the cheapest window. Tomorrow's prices appear once the Zonneplan forecast publishes them (around 18:00); until then the widget shows a placeholder. Tomorrow's prices are only included in an AI context once the Zonneplan publication status entity confirms availability - forecast rows alone are never trusted.

### Summary statistics

`GET /api/summary` returns the headline metrics for three ranges - today (local midnight to now), this week (Monday 00:00 to now) and this month (first day of the month 00:00 to now) - all in Europe/Amsterdam local time, cached in memory for 5 minutes. All metrics come from the verified `energy_delta` counters (precomputed kWh increments per entity, resolved by `ha_entity_id`); the sparse `measurement` power series is not integrated because it undercounts. Definitions:

- From grid: grid import kWh ("Electricity imported from the grid")
- PV production and battery charge/discharge: summed from their counters
- Home usage: grid import + PV production - grid export - (battery charged - battery discharged) - "Household consumption: from grid + direct solar use - export - energy stored in the battery"; energy stored in the battery is not counted as household consumption, so with a battery charging from the grid the home usage figure can be lower than the grid import. The battery net term is clamped at zero only when both battery entities are missing, otherwise the true net is used (it may be negative on discharge-heavy days). When no PV entity exists, home usage falls back to grid import and `pv_available` is false
- To grid: grid export kWh ("Electricity exported back to the grid")
- Energy cost: the sum over each local hour of the hourly import kWh times the hourly price including VAT ("Cost of imported electricity at hourly dynamic prices"); hours without a price row count toward kWh but not toward cost

The stat cards carry an info icon in the corner with these definitions as a hover/focus tooltip.

`pv_available` and `battery_available` reflect whether the counter entities have rows in `energy_delta`. Week and month values cover available data only.

#### Context snapshot and signature

`GET /api/summary` builds one context snapshot per request on top of the cached summary statistics: the day totals from `energy_delta`, the merged price curve (past and forecast), the PV forecast from the weather module and the battery state. Over the materialized context fields it computes a `signature`: a stable hash (FNV-1a) of the bucketed values - battery state, SOC, power and throughput buckets; usage, export and cost buckets; the current price hour; tomorrow-price availability; the cheapest windows; solar actual-versus-forecast buckets. Bucketing absorbs trivial drift, so the signature changes only when the underlying data changes materially.

Every response carries:

- `as_of` - the ISO timestamp of the underlying summary data (the 5-minute cache fill the snapshot was built from)
- `signature` - the stable hash over the materialized context fields
- `insight` - the cached advisory (the primary action with its saving and confidence, the supporting facts, the warning and context note, the no-opportunity marker, the server-computed candidates, and the live guidance/advisory/outlook objects composed from the current snapshot, never from the cache) with its own `insight_as_of`, its regeneration `state` and `generated_at`
- `remaining_calls` - the remaining calls in the shared daily Mistral budget
- `server_version` - the git hash and process start time

#### Kiosk reliability

The dashboard runs for months in a browser tab on a wall panel, so the frontend treats the tab as long-lived:

- `/api/summary` is refetched every 5 minutes for the lifetime of the tab (matching the server's 5-minute summary cache), and immediately when the window regains focus or the network connection comes back online (the `online` event) - the two moments a throttled or reconnected tab must catch up. Concurrent refetches share one in-flight request.
- The advisory card shows its provenance chip (the insight's own data moment, or an honest "No insight yet") and a pulsing Reasoning chip whenever a regeneration is in flight, so staleness is visible at a distance without a manual refresh.
- The force-refresh control regenerates the advisory and refreshes the widget data, but is disabled when the shared daily budget is exhausted or the signature has not changed since the insight was generated.

### Battery

The battery (Anker SOLIX Solarbank Max AC) appears in three places: the compact Battery status card in the hub's stats grid, the Battery today chart card, and the full battery panel on the Battery tab (period-anchored via `/api/battery/flow`). The net power is the latest charging power minus the latest discharging power, where a series whose latest row is more than an hour old reads as 0 W (the sensors stop updating around zero load, so a stale series is an idle one and a fresh reading on the other series still counts). The state applies a 25 W deadband: charging, discharging or idle. Charge and discharge totals come from the verified `energy_delta` counters; the summary's home usage already accounts for the battery net term since the counter correction.

The Battery tab's current-state block (the SOC gauge, the charge/discharge status and the time-to-full/empty estimate, the latter when `BATTERY_CAPACITY_KWH` is configured) renders only while the selected period contains now. The flow chart shows hourly charge and discharge kWh with the SOC line on a secondary 0-100 percent axis on a day, one bar pair per day on week and month, one per month on a year. The totals render as mode-aware stat rows: energy mode Charged/Discharged/Net, cost mode Charge cost/Discharge value/Arbitrage - both dimensions ride the payload, so the mode toggle restyles without a refetch. Money figures are priced bottom-up at each hour's dynamic price with a last-known fallback; a money figure is null when any flowing interval lacks its price, never a silent 0.

The battery insight box (`GET /api/battery/context`) comments on the charge state, today's use and a charging/discharging tip; it follows the same caching, throttling and shared daily Mistral call cap as the other insight boxes.

### Solar panel score

The solar panel score is the expected production of the day as a percentage of the theoretical clear-sky production on the best day of the year at this location. It reflects absolute production: a sunny July day scores near 100, a good October day near 35.

### Temporary layer

This server is a temporary data layer. The permanent backend will live in a separate repository (home-energy-backend). All SQL is kept in `server/queries.mjs` (parameterized, never string interpolation of user input), so the migration is a copy operation: move that file into the new backend and adapt the surrounding plumbing. If your schema uses different column names, adjust them in `server/queries.mjs` - nowhere else touches SQL.

### Deployment on the mini PC

In production the same Express process also serves the built frontend from `dist/`: `express.static` for the assets and an SPA fallback that returns `index.html` for any non-`/api` GET request, so client-side routing keeps working on refresh. The server binds to `HOST` (default `0.0.0.0`, reachable on the home network, not from the internet) and starts on `PORT` (default `API_PORT`/5273; the service below uses 8080). The frontend calls the API with relative `/api/...` paths, so no build-time configuration is needed.

Two committed files under `deploy/` handle the rest:

- `deploy/ems-dashboard.service` - a systemd unit (with a `YOUR_USER` placeholder to substitute on the machine) that runs the server from `server/` with `server/.env` and restarts it every 10 seconds on failure. The real `server/.env` on the mini PC holds the database credentials and the remaining secrets; it is never committed.
- `deploy/deploy-dashboard.sh` - pull the latest code, install dependencies, build the frontend and restart the service. It aborts on any error, so a failed build never restarts the service on stale code.

After a reboot the whole stack (Home Assistant, TimescaleDB, ingest worker and this dashboard) comes up by itself.

## License

The code in this repository is licensed under the MIT license with one addition, see [LICENSE](LICENSE): derivative works of this codebase must credit Pixelate BV as the original author in their documentation.

The visual and interaction design (layout, styling, charts, widgets and interaction design) is licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), see [DESIGN.md](DESIGN.md), with attribution to Pixelate BV as the original designer. A code license does not reach design, which is why the two are licensed separately.

The Pixelate name and logo are not part of either license.

If this project inspired your own energy dashboard, a mention of Pixelate BV is appreciated.