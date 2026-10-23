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

// The read-only AI insight traceability panel: the exact sections
// context the summary insight model receives - now_local, today_date
// and every section with its composition facts and its guidance note -
// plus the last served advisory card and the composed system prompt,
// so the claim and the numbers it was built from sit side by side.
// Fetching it never triggers a Mistral call. Section helper: a
// titled key/value group.
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="font-mono text-sm">
              GET /api/insight/debug
            </CardTitle>
            <CardDescription>
              The exact sections context the summary insight is built from,
              with the last served advisory - read-only, no AI call
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {status === "ok" && data?.insight?.state === "reasoning" && (
              <Badge>reasoning</Badge>
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
                  ? ` · insight from ${data.insight.insight_as_of} (state ${data.insight.state}${data.insight.stale ? ", stale" : ""})`
                  : " · no insight generated yet"}
                {` · Mistral budget ${data.mistral.remaining_calls}/${data.mistral.daily_limit} left (${data.mistral.calls_today} today)`}
              </p>
            </DebugSection>
            <DebugSection title="Served advisory">
              {data.insight === null ? (
                <p className="text-muted-foreground">
                  No insight generated yet.
                </p>
              ) : (
                <>
                  {data.insight.primary_action ? (
                    <p>
                      Claimed:{" "}
                      <span className="font-mono">
                        {data.insight.primary_action.saving_eur} EUR
                      </span>{" "}
                      ({data.insight.primary_action.confidence}) -{" "}
                      {data.insight.primary_action.what},{" "}
                      {data.insight.primary_action.when}
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      No primary action (no opportunity:{" "}
                      {String(data.insight.no_opportunity ?? false)}).
                    </p>
                  )}
                  {data.insight.warning && (
                    <p>Warning: {data.insight.warning}</p>
                  )}
                  {data.insight.context_note && (
                    <p>Context note: {data.insight.context_note}</p>
                  )}
                  {data.insight.error && (
                    <p className="text-destructive">
                      Last generation failed: {data.insight.error}
                    </p>
                  )}
                  {(data.insight.supporting_facts ?? []).length > 0 && (
                    <ul className="list-disc space-y-1 pl-4">
                      {(data.insight.supporting_facts ?? []).map((fact) => (
                        <li key={fact}>{fact}</li>
                      ))}
                    </ul>
                  )}
                  <details>
                    <summary className="cursor-pointer text-sm text-muted-foreground">
                      Full advisory card JSON
                    </summary>
                    <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
                      {formatJson(data.insight)}
                    </pre>
                  </details>
                </>
              )}
            </DebugSection>
            <DebugSection
              title={`Sections (${data.sections_context.sections.length})`}
            >
              <div className="space-y-3">
                {data.sections_context.sections.map((section) => (
                  <div key={section.id}>
                    <p className="text-sm font-medium">
                      {section.id}
                      {section.mode ? ` (${section.mode})` : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {section.guidance}
                    </p>
                    <pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
                      {JSON.stringify(
                        { facts: section.facts, days: section.days ?? null },
                        null,
                        2,
                      )}
                    </pre>
                  </div>
                ))}
              </div>
            </DebugSection>
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
      {/* The shared card rhythm: 16 px between cards, like the stats
          cluster. */}
      <div className="space-y-4">
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
