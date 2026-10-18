import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import PageLayout from "@/components/PageLayout";
import { useModeSearch } from "@/lib/mode";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  fetchBatteryContext,
  fetchCheapestBlock,
  fetchDailyInsight,
  fetchDebugTime,
  fetchInsightDebug,
  fetchPriceContext,
  fetchPrices,
  fetchSummary,
  fetchWeatherContext,
  fetchWeatherDaily,
  fetchWeatherHourly,
  getCurrentMeasurements,
  getDailyTotals,
  getEntities,
  getHourlySeries,
  getHourlyTotals,
  type DebugHaFetch,
  type DebugMistral,
  type InsightCandidate,
  type InsightDebugData,
} from "@/lib/api";

interface EndpointResult {
  status: "loading" | "ok" | "error";
  data?: unknown;
  error?: string;
  durationMs?: number;
  loadedAt?: string;
}

interface ParamSpec {
  key: "days" | "hours";
  label: string;
  fallback: number;
  max: number;
}

interface EndpointSpec {
  key: string;
  label: string;
  description: string;
  params: ParamSpec[];
  run: (args: Record<string, number>) => Promise<unknown>;
}

const ENDPOINTS: EndpointSpec[] = [
  {
    key: "debug-time",
    label: "GET /api/debug/time",
    description:
      "Server clock, timezone and the local Amsterdam buckets it computes, with raw rows, HA price fetch state and the Mistral budget",
    params: [],
    run: () => fetchDebugTime(),
  },
  {
    key: "entities",
    label: "GET /api/entities",
    description: "All rows from the entity table",
    params: [],
    run: () => getEntities(),
  },
  {
    key: "summary",
    label: "GET /api/summary",
    description:
      "Today, this week and this month headline metrics, with the context signature, the AI insight and the remaining Mistral budget",
    params: [],
    run: () => fetchSummary(),
  },
  {
    key: "insight-daily",
    label: "GET /api/insight/daily",
    description: "AI-generated daily summary with recommended actions",
    params: [],
    run: () => fetchDailyInsight(),
  },
  {
    key: "battery-context",
    label: "GET /api/battery/context",
    description: "AI-generated insight over the battery state and flow",
    params: [],
    run: () => fetchBatteryContext(),
  },
  {
    key: "totals-daily",
    label: "GET /api/totals/daily",
    description: "Per-entity daily kWh sums from energy_daily",
    params: [{ key: "days", label: "days", fallback: 7, max: 365 }],
    run: (args) => getDailyTotals(args.days),
  },
  {
    key: "totals-hourly",
    label: "GET /api/totals/hourly",
    description: "Per-entity hourly kWh sums from energy_hourly",
    params: [{ key: "hours", label: "hours", fallback: 24, max: 744 }],
    run: (args) => getHourlyTotals(args.hours),
  },
  {
    key: "series-hourly",
    label: "GET /api/series/hourly",
    description:
      "Average and max power per entity per hour from measurement_hourly",
    params: [{ key: "hours", label: "hours", fallback: 24, max: 744 }],
    run: (args) => getHourlySeries(args.hours),
  },
  {
    key: "current",
    label: "GET /api/current",
    description: "Latest measurement row per entity",
    params: [],
    run: () => getCurrentMeasurements(),
  },
  {
    key: "prices",
    label: "GET /api/prices",
    description:
      "Merged hourly price curve with per-day stats and the cheapest window",
    params: [{ key: "days", label: "days", fallback: 2, max: 7 }],
    run: (args) => fetchPrices(args.days),
  },
  {
    key: "prices-cheapest",
    label: "GET /api/prices/cheapest",
    description: "Cheapest N consecutive hours from now, by average price",
    params: [{ key: "hours", label: "hours", fallback: 3, max: 12 }],
    run: (args) => fetchCheapestBlock(args.hours),
  },
  {
    key: "prices-context",
    label: "GET /api/prices/context",
    description: "AI-generated insight over the price curve",
    params: [],
    run: () => fetchPriceContext(),
  },
  {
    key: "weather-daily",
    label: "GET /api/weather/daily",
    description: "Per-day weather forecast with solar score and PV estimate",
    params: [{ key: "days", label: "days", fallback: 5, max: 6 }],
    run: (args) => fetchWeatherDaily(args.days),
  },
  {
    key: "weather-hourly",
    label: "GET /api/weather/hourly",
    description: "Hourly forecast for today (pass a date on the server)",
    params: [],
    run: () => fetchWeatherHourly(),
  },
  {
    key: "weather-context",
    label: "GET /api/weather/context",
    description: "AI-generated insight over the forecast period",
    params: [],
    run: () => fetchWeatherContext(),
  },
];

// The per-endpoint fallback params (in each spec) are used on mount;
// the shared params state only holds values the user has typed.
function rowCount(data: unknown): number | null {
  return Array.isArray(data) ? data.length : null;
}

function formatJson(data: unknown): string {
  if (data === undefined) {
    return "";
  }
  return JSON.stringify(data, null, 2);
}

function StatusBadge({ result }: { result?: EndpointResult }) {
  if (!result || result.status === "loading") {
    return <Badge variant="secondary">loading</Badge>;
  }
  if (result.status === "error") {
    return <Badge variant="destructive">error</Badge>;
  }
  return <Badge>ok</Badge>;
}

function EndpointCard({
  spec,
  params,
  result,
  onParamChange,
  onReload,
}: {
  spec: EndpointSpec;
  params: Record<string, number>;
  result?: EndpointResult;
  onParamChange: (key: string, value: number) => void;
  onReload: (key: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="font-mono text-sm">{spec.label}</CardTitle>
            <CardDescription>{spec.description}</CardDescription>
          </div>
          <StatusBadge result={result} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          {spec.params.map((param) => (
            <label key={param.key} className="text-sm text-muted-foreground">
              <span className="mb-1 block font-mono">{param.label}</span>
              <Input
                type="number"
                min={1}
                max={param.max}
                value={params[param.key] ?? param.fallback}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  onParamChange(
                    param.key,
                    Number.isFinite(parsed) && parsed >= 1
                      ? Math.min(parsed, param.max)
                      : param.fallback,
                  );
                }}
                className="w-24"
              />
            </label>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onReload(spec.key)}
            disabled={result?.status === "loading"}
          >
            Reload
          </Button>
          {result?.status === "ok" && (
            <span className="text-xs text-muted-foreground">
              {rowCount(result.data)} rows &middot; {result.durationMs} ms
              &middot; {result.loadedAt}
            </span>
          )}
          {result?.status === "error" && (
            <span className="text-xs text-destructive">{result.error}</span>
          )}
        </div>
        <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
          {result?.status === "error" ? result.error : formatJson(result?.data)}
        </pre>
      </CardContent>
    </Card>
  );
}

// The read-only AI insight context panel: the exact payload the
// summary insight is built from, grouped by section, with the C1b
// candidates' arithmetic laid out so a hand check takes seconds.
// Fetching it never triggers a Mistral call. Section helper: a titled
// key/value group.
function DebugSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="space-y-1 text-sm">{children}</div>
    </div>
  );
}

function InsightContextCard() {
  const [data, setData] = useState<InsightDebugData | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      setData(await fetchInsightDebug());
      setStatus("ok");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void load();
  }, [load]);

  const candidates = data?.context.candidates ?? [];
  // The insight consistency check, three rules: (a) a zero claimed
  // saving with an empty candidate list or all candidates
  // belowThreshold, on a no-opportunity insight, is the honest state -
  // green and neutral; (b) a nonzero claimed saving that matches no
  // candidate is the arithmetic guard - red, unchanged; (c) the
  // inverse - an above-threshold candidate exists but the insight
  // claims no opportunity or a lower saving - is a missed real saving,
  // red.
  const CHECK_EPSILON = 0.00005;
  const bestAboveThreshold =
    candidates
      .filter((candidate) => !candidate.below_threshold)
      .reduce<InsightCandidate | null>(
        (best, candidate) =>
          best === null || candidate.saving_eur > best.saving_eur
            ? candidate
            : best,
        null,
      ) ?? null;
  const claimed = data?.insight?.primary_action?.saving_eur ?? null;
  const consistency: { ok: boolean; label: string } | null = (() => {
    const insight = data?.insight;
    if (!insight?.primary_action || claimed === null) {
      return null;
    }
    const allBelowOrNone = candidates.every(
      (candidate) => candidate.below_threshold,
    );
    if (claimed === 0 && allBelowOrNone && insight.no_opportunity) {
      return {
        ok: true,
        label:
          candidates.length === 0
            ? "no candidates today"
            : "only below-threshold candidates today",
      };
    }
    if (
      bestAboveThreshold !== null &&
      claimed < bestAboveThreshold.saving_eur - CHECK_EPSILON
    ) {
      return {
        ok: false,
        label: `insight misses a candidate saving of ${bestAboveThreshold.saving_eur} EUR`,
      };
    }
    if (
      candidates.some(
        (candidate) => Math.abs(candidate.saving_eur - claimed) < CHECK_EPSILON,
      )
    ) {
      return { ok: true, label: "saving matches candidate" };
    }
    return { ok: false, label: "saving does not match any candidate" };
  })();
  // The guidance rule: the insight's guidance numbers must match the
  // price data in the context exactly; any mismatch is red - the model
  // recomputed instead of copying.
  const contextGuidance = data?.context.guidance ?? null;
  const insightGuidance = data?.insight?.guidance ?? null;
  const guidanceMismatch =
    contextGuidance !== null &&
    insightGuidance !== null &&
    (insightGuidance.window !== contextGuidance.window ||
      Math.abs(
        insightGuidance.cheapest_window_average_eur -
          contextGuidance.cheapest_window_average_eur,
      ) > CHECK_EPSILON ||
      insightGuidance.peak_hour !== (contextGuidance.peak_hour ?? "") ||
      Math.abs(
        insightGuidance.peak_price_eur - contextGuidance.peak_price_eur,
      ) > CHECK_EPSILON ||
      Math.abs(
        insightGuidance.spread_per_kwh_eur - contextGuidance.spread_per_kwh_eur,
      ) > CHECK_EPSILON);
  // The advisory rule: the insight's advisory numbers must match the
  // price and forecast data in the context exactly; any mismatch is
  // red - the model recomputed instead of copying.
  const contextAdvisory = data?.context.advisory ?? null;
  const insightAdvisory = data?.insight?.advisory ?? null;
  const numberMatches = (a: number | null, b: number | null) =>
    a === null || b === null ? a === b : Math.abs(a - b) <= CHECK_EPSILON;
  const advisoryMismatch =
    contextAdvisory !== null &&
    insightAdvisory !== null &&
    (insightAdvisory.type !== contextAdvisory.type ||
      insightAdvisory.compare_day !== contextAdvisory.compare_day ||
      !numberMatches(
        insightAdvisory.tomorrow_average_eur,
        contextAdvisory.tomorrow_average_eur,
      ) ||
      !numberMatches(
        insightAdvisory.tomorrow_solar_kwh,
        contextAdvisory.tomorrow_solar_kwh,
      ) ||
      !numberMatches(
        insightAdvisory.compare_average_eur,
        contextAdvisory.compare_average_eur,
      ) ||
      !numberMatches(
        insightAdvisory.compare_solar_kwh,
        contextAdvisory.compare_solar_kwh,
      ) ||
      !numberMatches(
        insightAdvisory.price_difference_per_kwh,
        contextAdvisory.price_difference_per_kwh,
      ));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="font-mono text-sm">
              GET /api/insight/debug
            </CardTitle>
            <CardDescription>
              The exact context payload the summary insight is built from, with
              the precomputed candidates - read-only, no AI call
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {status === "ok" && guidanceMismatch && (
              <Badge variant="destructive">
                guidance numbers do not match the price data
              </Badge>
            )}
            {status === "ok" && advisoryMismatch && (
              <Badge variant="destructive">
                advisory numbers do not match the price and forecast data
              </Badge>
            )}
            {status === "ok" && consistency && (
              <Badge
                variant={consistency.ok ? "outline" : "destructive"}
                className={
                  consistency.ok
                    ? "border-emerald-600/40 text-emerald-600 dark:text-emerald-400"
                    : undefined
                }
              >
                {consistency.label}
              </Badge>
            )}
            <StatusBadge
              result={
                status === "loading" ? undefined : { status, data: undefined }
              }
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={status === "loading"}
            >
              Reload
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === "error" && (
          <p className="text-sm text-destructive">
            Could not load the insight context.
          </p>
        )}
        {status === "loading" && (
          <Skeleton className="h-24 w-full rounded-lg" />
        )}
        {status === "ok" && data && (
          <>
            <DebugSection title="Snapshot">
              <p className="font-mono text-xs">
                as_of {data.as_of} · signature {data.signature}
                {data.insight
                  ? ` · insight from ${data.insight.as_of} (signature ${
                      data.insight.signature === data.signature
                        ? "current"
                        : "differs"
                    }, state ${data.insight.state})`
                  : " · no insight generated yet"}
                {` · Mistral budget ${data.mistral.remaining_calls}/${data.mistral.daily_limit} left (${data.mistral.calls_today} today)`}
              </p>
              {data.insight?.primary_action && (
                <p>
                  Claimed:{" "}
                  <span className="font-mono">
                    {data.insight.primary_action.saving_eur} EUR
                  </span>{" "}
                  ({data.insight.primary_action.confidence}) -{" "}
                  {data.insight.primary_action.what}
                </p>
              )}
            </DebugSection>
            <DebugSection title={`Candidates (${candidates.length})`}>
              {candidates.length === 0 ? (
                <p className="text-muted-foreground">
                  No candidates: no appliance with at least 0.5 kWh today and no
                  battery discharge.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th className="pr-3">Label</th>
                        <th className="pr-3">Load</th>
                        <th className="pr-3">Window</th>
                        <th className="pr-3">Saving</th>
                        <th className="pr-3">Below</th>
                        <th>Basis</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {candidates.map((candidate) => (
                        <tr key={candidate.label} className="align-top">
                          <td className="py-1 pr-3">{candidate.label}</td>
                          <td className="py-1 pr-3">
                            {candidate.load_kwh} kWh
                          </td>
                          <td className="py-1 pr-3">{candidate.window}</td>
                          <td className="py-1 pr-3">
                            {candidate.saving_eur} EUR
                          </td>
                          <td className="py-1 pr-3">
                            {candidate.below_threshold ? "yes" : "no"}
                          </td>
                          <td className="py-1">{candidate.basis}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DebugSection>
            <div className="grid gap-4 sm:grid-cols-2">
              <DebugSection title="Prices">
                <p>
                  current{" "}
                  <span className="font-mono">
                    {data.context.current_price ?? "—"}
                  </span>{" "}
                  EUR/kWh · cheapest window{" "}
                  <span className="font-mono">
                    {data.context.cheapest_window?.start_hour}-
                    {data.context.cheapest_window?.end_hour} @{" "}
                    {data.context.cheapest_window?.average_price}
                  </span>
                </p>
                <p>
                  today min/avg/max{" "}
                  <span className="font-mono">
                    {data.context.today_prices?.min}/
                    {data.context.today_prices?.average}/
                    {data.context.today_prices?.max}
                  </span>{" "}
                  · peaks above{" "}
                  <span className="font-mono">
                    {data.context.price_peak_threshold_eur}
                  </span>
                  :{" "}
                  <span className="font-mono">
                    {(data.context.today_prices?.peak_hours ?? []).join(", ") ||
                      "none"}
                  </span>
                </p>
                <p>
                  tomorrow available:{" "}
                  <span className="font-mono">
                    {String(data.context.tomorrow_prices_available ?? false)}
                  </span>
                  {data.context.tomorrow_prices && (
                    <>
                      {" "}
                      · min/avg/max{" "}
                      <span className="font-mono">
                        {data.context.tomorrow_prices.min}/
                        {data.context.tomorrow_prices.average}/
                        {data.context.tomorrow_prices.max}
                      </span>
                    </>
                  )}
                </p>
                <p>
                  guidance:{" "}
                  {data.context.guidance ? (
                    <span className="font-mono">
                      {data.context.guidance.window} @{" "}
                      {data.context.guidance.cheapest_window_average_eur} avg ·
                      peak {data.context.guidance.peak_hour} @{" "}
                      {data.context.guidance.peak_price_eur} · spread{" "}
                      {data.context.guidance.spread_per_kwh_eur} EUR/kWh ·
                      practical {String(data.context.guidance.practical)} ·
                      gate: start {data.context.guidance.window_start_hour}h,
                      left {data.context.guidance.hours_remaining}h, window{" "}
                      {data.context.guidance.cheapest_window_average_eur} vs day{" "}
                      {data.context.guidance.day_average_eur} · day's cheapest{" "}
                      {data.context.guidance.day_cheapest_window} @{" "}
                      {data.context.guidance.day_cheapest_average_eur}
                    </span>
                  ) : (
                    "none (flat prices or below the spread threshold)"
                  )}
                </p>
                <p>
                  advisory:{" "}
                  {data.context.advisory ? (
                    <span className="font-mono">
                      {data.context.advisory.type} · tomorrow{" "}
                      {data.context.advisory.tomorrow_average_eur} EUR avg /{" "}
                      {data.context.advisory.tomorrow_solar_kwh} kWh solar ·{" "}
                      {data.context.advisory.compare_day}{" "}
                      {data.context.advisory.compare_average_eur} EUR /{" "}
                      {data.context.advisory.compare_solar_kwh} kWh · diff{" "}
                      {data.context.advisory.price_difference_per_kwh} EUR/kWh
                      {data.context.advisory.horizon_note
                        ? ` · ${data.context.advisory.horizon_note}`
                        : ""}
                    </span>
                  ) : (
                    "none (no meaningful difference between tomorrow and the known days)"
                  )}
                </p>
              </DebugSection>
              <DebugSection title="Today">
                <p className="font-mono text-xs">
                  {JSON.stringify(data.context.today)}
                </p>
                <p className="font-mono text-xs">
                  appliances {JSON.stringify(data.context.top_appliances ?? [])}
                </p>
                <p>
                  battery{" "}
                  <span className="font-mono">
                    {data.context.battery ?? "no data"}
                  </span>{" "}
                  · CO2{" "}
                  <span className="font-mono">
                    {data.context.co2_intensity_g_per_kwh ?? "—"} g/kWh
                  </span>
                </p>
                <p>
                  <p>
                    week outlook:{" "}
                    {data.context.week_outlook ? (
                      <span className="font-mono">
                        {data.context.week_outlook.days
                          .map(
                            (day) =>
                              `${day.weekday_short} ${day.solar_kwh}kWh ${day.condition} @ ${day.average_price_eur === null ? "no price" : day.average_price_eur}`,
                          )
                          .join(", ")}
                        {data.context.week_outlook.best_solar_day &&
                          ` · best: ${data.context.week_outlook.best_solar_day.weekday} ${data.context.week_outlook.best_solar_day.solar_kwh}kWh`}
                        {data.context.week_outlook.poor_day &&
                          ` · poor: ${data.context.week_outlook.poor_day.weekday} ${data.context.week_outlook.poor_day.solar_kwh}kWh ${data.context.week_outlook.poor_day.condition}`}
                      </span>
                    ) : (
                      "none"
                    )}
                  </p>
                  {data.context.solar_today}
                  {data.context.solar_tomorrow
                    ? ` · ${data.context.solar_tomorrow}`
                    : ""}
                </p>
              </DebugSection>
            </div>
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">
                System prompt
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
                {data.system_prompt}
              </pre>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function DebugPage() {
  const navigate = useNavigate();
  // Carries the mode param back to the dashboard.
  const modeSearch = useModeSearch();
  const [params, setParams] = useState<Record<string, number>>({});
  // Server build identifier from /api/summary, to confirm on screen that
  // the running process matches the current code.
  const [serverInfo, setServerInfo] = useState<{
    version: string | null;
    loaded: boolean;
  }>({ version: null, loaded: false });
  // Observability from /api/debug/time, shown as a compact line: HA
  // price fetch health, forecast age and the Mistral budget.
  const [observability, setObservability] = useState<{
    haFetch: DebugHaFetch | null;
    mistral: DebugMistral | null;
  }>({ haFetch: null, mistral: null });
  useEffect(() => {
    // eslint-disable-next-line react/set-state-in-effect
    void fetchSummary()
      .then((summary) =>
        setServerInfo({
          version: summary.server_version ?? null,
          loaded: true,
        }),
      )
      .catch(() => setServerInfo({ version: null, loaded: true }));
    void fetchDebugTime()
      .then((data) =>
        setObservability({
          haFetch: data.ha_fetch ?? null,
          mistral: data.mistral ?? null,
        }),
      )
      .catch(() => {});
  }, []);
  const [results, setResults] = useState<Record<string, EndpointResult>>(() =>
    Object.fromEntries(
      ENDPOINTS.map((spec) => [
        spec.key,
        { status: "loading" } as EndpointResult,
      ]),
    ),
  );

  // Runs an endpoint and stores the result. State is only updated after the
  // await, so this is safe to call from effects.
  const load = useCallback(
    async (key: string, args: Record<string, number>) => {
      const spec = ENDPOINTS.find((endpoint) => endpoint.key === key);
      if (!spec) {
        return;
      }
      const started = performance.now();
      try {
        const data = await spec.run(args);
        setResults((previous) => ({
          ...previous,
          [key]: {
            status: "ok",
            data,
            durationMs: Math.round(performance.now() - started),
            loadedAt: new Date().toLocaleTimeString(),
          },
        }));
      } catch (error) {
        setResults((previous) => ({
          ...previous,
          [key]: {
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          },
        }));
      }
    },
    [],
  );

  const markLoading = useCallback((key: string) => {
    setResults((previous) => ({ ...previous, [key]: { status: "loading" } }));
  }, []);

  const loadAll = useCallback(() => {
    for (const spec of ENDPOINTS) {
      markLoading(spec.key);
      void load(spec.key, params);
    }
  }, [load, markLoading, params]);

  useEffect(() => {
    // Load once on mount, each endpoint with its own fallback params;
    // manual reloads handle the rest. Results are set asynchronously
    // (after await) inside load; oxlint's set-state-in-effect rule
    // cannot see the await boundary here.
    for (const spec of ENDPOINTS) {
      // eslint-disable-next-line react/set-state-in-effect
      void load(
        spec.key,
        Object.fromEntries(
          spec.params.map((param) => [param.key, param.fallback]),
        ),
      );
    }
  }, [load]);

  const handleParamChange = useCallback((key: string, value: number) => {
    setParams((previous) => ({ ...previous, [key]: value }));
  }, []);

  const handleReload = useCallback(
    (key: string) => {
      markLoading(key);
      void load(key, params);
    },
    [load, markLoading, params],
  );

  return (
    <PageLayout
      title="API debug"
      subtitle={
        <>
          <p className="text-sm text-muted-foreground">
            Raw responses from the local data server
          </p>
          {serverInfo.loaded &&
            (serverInfo.version ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Server build:{" "}
                <span className="font-mono">{serverInfo.version}</span>
              </p>
            ) : (
              <p className="mt-1 text-xs text-destructive">
                Running API server predates the build identifier - restart it to
                load the current code.
              </p>
            ))}
          {observability.haFetch && observability.mistral && (
            <p className="mt-1 text-xs text-muted-foreground">
              HA price fetch:{" "}
              {observability.haFetch.price_entity_ok === null
                ? "not fetched yet"
                : observability.haFetch.price_entity_ok
                  ? "ok"
                  : "failed"}
              {" · "}forecast age:{" "}
              {observability.haFetch.price_forecast_age_min ?? "?"} min
              {" · "}Mistral budget: {observability.mistral.remaining_calls}/
              {observability.mistral.daily_limit} left (
              {observability.mistral.calls_today} today)
            </p>
          )}
        </>
      }
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadAll}>
            Reload all
          </Button>
          <Button
            onClick={() => {
              navigate(`/${modeSearch}`);
            }}
          >
            Back to dashboard
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <InsightContextCard />
        {ENDPOINTS.map((spec) => (
          <EndpointCard
            key={spec.key}
            spec={spec}
            params={params}
            result={results[spec.key]}
            onParamChange={handleParamChange}
            onReload={handleReload}
          />
        ))}
      </div>
    </PageLayout>
  );
}

export default DebugPage;
